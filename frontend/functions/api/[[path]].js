import { ethers } from 'ethers';

// ABI Definition
const CONTRACT_ABI = [
  "event BetPlaced(uint256 indexed raceId, address indexed bettor, uint8[3] predictedIds)",
  "event RaceStarted(uint256 indexed raceId, uint256 deadline)",
  "event RaceResolved(uint256 indexed raceId, uint8[3] results, uint256 totalWinnerScores)",
  "function getRaceInfo() view returns (uint256 raceId, uint8 state, uint256 pool, uint256 winnersTotalScore, uint256 dl, uint8[3] results)",
  "function getUserBet(uint256 raceId, address user) view returns (uint8[3] predictedIds, uint8 score, bool hasClaimed, bool exists)",
  "function calculateScore(uint8[3] predicted, uint8[3] actual) view returns (uint8)",
  "function owner() view returns (address)"
];

const USER_PICK_UPSERT = `INSERT INTO UserPicks (walletAddress, raceId, firstPlaceId, secondPlaceId, thirdPlaceId, txHash)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(walletAddress, raceId) DO UPDATE SET
firstPlaceId=excluded.firstPlaceId,
secondPlaceId=excluded.secondPlaceId,
thirdPlaceId=excluded.thirdPlaceId,
txHash=excluded.txHash`;

const statusMap = { 0: 'PENDING', 1: 'ACTIVE', 2: 'PENDING', 3: 'ENDED' };

/** 로컬 점수 계산 로직 (가스 소모 및 RPC 지연 방지) */
function calculateScoreLocal(predicted, actual) {
    let score = 0;
    if (predicted[0] === actual[0]) score += 5;
    if (predicted[1] === actual[1]) score += 3;
    if (predicted[2] === actual[2]) score += 2;
    return score;
}

function buildDriverNumberMap(dbDrivers) {
    const map = {};
    for (const d of dbDrivers) {
        if (d.permanentNumber != null && d.permanentNumber !== '') {
            map[parseInt(d.permanentNumber, 10)] = d.driverId;
        }
    }
    return map;
}

function buildNumToIdMap(dbDrivers) {
    const map = {};
    for (const d of dbDrivers) {
        if (d.permanentNumber != null && d.permanentNumber !== '') {
            const num = String(d.permanentNumber);
            map[num] = d.driverId;
            map[String(parseInt(num, 10))] = d.driverId;
        }
    }
    return map;
}

async function upsertUserPick(env, dbRaceId, walletAddress, firstPlaceId, secondPlaceId, thirdPlaceId, txHash) {
    await env.DB.prepare(USER_PICK_UPSERT)
        .bind(walletAddress.toLowerCase(), dbRaceId, firstPlaceId, secondPlaceId, thirdPlaceId, txHash || null)
        .run();
}

async function getContract(env) {
    if (!env.SEPOLIA_RPC_URL || !env.CONTRACT_ADDRESS) {
        throw new Error('Environment variables SEPOLIA_RPC_URL or CONTRACT_ADDRESS are missing');
    }
    const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL);
    return { provider, contract: new ethers.Contract(env.CONTRACT_ADDRESS, CONTRACT_ABI, provider) };
}

async function syncRaceStatus(env, onChainRaceId, onChainState) {
    if (onChainRaceId === 0 || onChainState === 0) {
        await env.DB.prepare('UPDATE Races SET status = "PENDING" WHERE status != "PENDING"').run();
        return null;
    }
    await env.DB.prepare('UPDATE Races SET status = "PENDING" WHERE status = "ACTIVE" AND round != ?').bind(onChainRaceId).run();
    const dbStatus = statusMap[onChainState] || 'PENDING';
    await env.DB.prepare('UPDATE Races SET status = ? WHERE round = ?').bind(dbStatus, onChainRaceId).run();
    return await env.DB.prepare('SELECT id FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(onChainRaceId).first();
}

/** 
 * 온체인 BetPlaced 이벤트를 D1 UserPicks에 반영 
 * [수정] 무료 RPC 요금제 제약(10블록)을 고려하여 스캔 범위를 최소화합니다.
 */
async function syncBetEvents(env, onChainRaceId) {
    let eventsSynced = 0;
    try {
        const { provider, contract } = await getContract(env);
        const info = await contract.getRaceInfo();
        const raceId = onChainRaceId ?? Number(info.raceId);
        if (!raceId || raceId <= 0) return eventsSynced;

        const dbRace = await syncRaceStatus(env, raceId, Number(info.state));
        if (!dbRace) return eventsSynced;

        const { results: dbDrivers } = await env.DB.prepare('SELECT driverId, permanentNumber FROM Drivers').all();
        const driverMap = buildDriverNumberMap(dbDrivers);
        const latestBlock = await provider.getBlockNumber();
        
        // [무료 티어 대응] 10블록으로 제한
        const fromBlock = Math.max(0, latestBlock - 9); 
        const filter = contract.filters.BetPlaced(raceId);
        
        console.log(`syncBetEvents: Scanning blocks ${fromBlock} to ${latestBlock}`);
        const events = await contract.queryFilter(filter, fromBlock, latestBlock);

        for (const event of events) {
            const { bettor, predictedIds } = event.args;
            const nums = predictedIds.map((id) => Number(id));
            const p1 = driverMap[nums[0]];
            const p2 = driverMap[nums[1]];
            const p3 = driverMap[nums[2]];
            if (p1 && p2 && p3) {
                await upsertUserPick(env, dbRace.id, bettor, p1, p2, p3, event.transactionHash);
                eventsSynced++;
            }
        }
    } catch (e) {
        console.error('syncBetEvents error:', e);
    }
    return eventsSynced;
}

/** 
 * DB 픽이 비어도 온체인 베팅 기준으로 총 승자 점수 계산 (resolveRace용) 
 * [수정] 무료 RPC 티어는 과거 블록 스캔이 불가능하므로, 이 함수는 거의 동작하지 않을 수 있습니다.
 * 따라서 시스템은 D1 데이터베이스(UserPicks)에 저장된 데이터를 주 소스로 사용해야 합니다.
 */
async function computeTotalWinnerScoresFromChain(env, raceRound, resultNumbers) {
    try {
        const { provider, contract } = await getContract(env);
        const latestBlock = await provider.getBlockNumber();
        
        // [무료 티어 대응] 10블록으로 제한
        const fromBlock = Math.max(0, latestBlock - 9);
        const filter = contract.filters.BetPlaced(raceRound);
        
        console.log(`computeTotalWinnerScoresFromChain: Scanning blocks ${fromBlock} to ${latestBlock}`);
        const events = await contract.queryFilter(filter, fromBlock, latestBlock);

        const actual = resultNumbers.map((n) => Number(n));
        let total = 0;
        for (const event of events) {
            const predicted = event.args.predictedIds.map((id) => Number(id));
            const score = calculateScoreLocal(predicted, actual);
            total += Number(score);
        }
        return total;
    } catch (e) {
        console.error('computeTotalWinnerScoresFromChain error:', e);
        return 0;
    }
}

async function recordBetFromNumbers(env, { walletAddress, raceRound, predictedNumbers, txHash }) {
    const race = await env.DB.prepare('SELECT id FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(raceRound).first();
    if (!race) throw new Error('Race not found in database');

    const { results: dbDrivers } = await env.DB.prepare('SELECT driverId, permanentNumber FROM Drivers').all();
    const driverMap = buildDriverNumberMap(dbDrivers);
    const nums = predictedNumbers.map((n) => Number(n));
    const p1 = driverMap[nums[0]];
    const p2 = driverMap[nums[1]];
    const p3 = driverMap[nums[2]];
    if (!p1 || !p2 || !p3) throw new Error('Invalid driver numbers');

    await upsertUserPick(env, race.id, walletAddress, p1, p2, p3, txHash);
    return { raceDbId: race.id };
}

const LOCAL_DRIVER_IMAGES = {
    'Albon': '/drivers/alexander_albon.png',
    'Alonso': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/F/FERALO01_Fernando_Alonso/feralo01.png',
    'Antonelli': '/drivers/andrea_kimi_antonelli.png',
    'Bearman': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/O/OLIBEA01_Oliver_Bearman/olibea01.png',
    'Bortoleto': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/G/GABBOR01_Gabriel_Bortoleto/gabbor01.png',
    'Bottas': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/V/VALBOT01_Valtteri_Bottas/valbot01.png',
    'Colapinto': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/F/FRACOL01_Franco_Colapinto/fracol01.png',
    'Gasly': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/P/PIEGAS01_Pierre_Gasly/piegas01.png',
    'Hadjar': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/I/ISAHAD01_Isack_Hadjar/isahad01.png',
    'Hamilton': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LEWHAM01_Lewis_Hamilton/lewham01.png',
    'Hulkenberg': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/N/NICHUL01_Nico_Hulkenberg/nichul01.png',
    'Lawson': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LIALAW01_Liam_Lawson/lialaw01.png',
    'Leclerc': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CHALEC01_Charles_Leclerc/chalec01.png',
    'Lindblad': '/drivers/arvid_lindblad.png',
    'Norris': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANNOR01_Lando_Norris/lannor01.png',
    'Ocon': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/E/ESTOCO01_Esteban_Ocon/estoco01.png',
    'Piastri': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/O/OSCPIA01_Oscar_Piastri/oscpia01.png',
    'Perez': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/S/SERPER01_Sergio_Perez/serper01.png',
    'Russell': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/G/GEORUS01_George_Russell/georus01.png',
    'Sainz': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CARSAI01_Carlos_Sainz/carsai01.png',
    'Stroll': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANSTR01_Lance_Stroll/lanstr01.png',
    'Verstappen': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/M/MAXVER01_Max_Verstappen/maxver01.png',
    'Doohan': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/J/JACDOO01_Jack_Doohan/jacdoo01.png',
    'Tsunoda': 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/Y/YUKTSU01_Yuki_Tsunoda/yuktsu01.png'
};

const DRIVERS_2026 = [
    { id: 'albon', num: '23', code: 'ALB', g: 'Alexander', f: 'Albon', nat: 'Thai', team: 'Williams' },
    { id: 'alonso', num: '14', code: 'ALO', g: 'Fernando', f: 'Alonso', nat: 'Spanish', team: 'Aston Martin' },
    { id: 'antonelli', num: '12', code: 'ANT', g: 'Andrea Kimi', f: 'Antonelli', nat: 'Italian', team: 'Mercedes' },
    { id: 'bearman', num: '87', code: 'BEA', g: 'Oliver', f: 'Bearman', nat: 'British', team: 'Haas' },
    { id: 'bortoleto', num: '5', code: 'BOR', g: 'Gabriel', f: 'Bortoleto', nat: 'Brazilian', team: 'Sauber' },
    { id: 'bottas', num: '77', code: 'BOT', g: 'Valtteri', f: 'Bottas', nat: 'Finnish', team: 'Sauber' },
    { id: 'colapinto', num: '43', code: 'COL', g: 'Franco', f: 'Colapinto', nat: 'Argentine', team: 'Williams' },
    { id: 'gasly', num: '10', code: 'GAS', g: 'Pierre', f: 'Gasly', nat: 'French', team: 'Alpine' },
    { id: 'hadjar', num: '0', code: 'HAD', g: 'Isack', f: 'Hadjar', nat: 'French', team: 'Racing Bulls' },
    { id: 'hamilton', num: '44', code: 'HAM', g: 'Lewis', f: 'Hamilton', nat: 'British', team: 'Ferrari' },
    { id: 'hulkenberg', num: '27', code: 'HUL', g: 'Nico', f: 'Hulkenberg', nat: 'German', team: 'Sauber' },
    { id: 'lawson', num: '30', code: 'LAW', g: 'Liam', f: 'Lawson', nat: 'New Zealander', team: 'Red Bull' },
    { id: 'leclerc', num: '16', code: 'LEC', g: 'Charles', f: 'Leclerc', nat: 'Monegasque', team: 'Ferrari' },
    { id: 'arvid_lindblad', num: '41', code: 'LIN', g: 'Arvid', f: 'Lindblad', nat: 'British', team: 'Racing Bulls' },
    { id: 'norris', num: '4', code: 'NOR', g: 'Lando', f: 'Norris', nat: 'British', team: 'McLaren' },
    { id: 'ocon', num: '31', code: 'OCO', g: 'Esteban', f: 'Ocon', nat: 'French', team: 'Haas' },
    { id: 'piastri', num: '81', code: 'PIA', g: 'Oscar', f: 'Piastri', nat: 'Australian', team: 'McLaren' },
    { id: 'perez', num: '11', code: 'PER', g: 'Sergio', f: 'Perez', nat: 'Mexican', team: 'Red Bull' },
    { id: 'russell', num: '63', code: 'RUS', g: 'George', f: 'Russell', nat: 'British', team: 'Mercedes' },
    { id: 'sainz', num: '55', code: 'SAI', g: 'Carlos', f: 'Sainz', nat: 'Spanish', team: 'Williams' },
    { id: 'stroll', num: '18', code: 'STR', g: 'Lance', f: 'Stroll', nat: 'Canadian', team: 'Aston Martin' },
    { id: 'verstappen', num: '1', code: 'VER', f: 'Verstappen', g: 'Max', nat: 'Dutch', team: 'Red Bull' },
    { id: 'doohan', num: '15', code: 'DOO', g: 'Jack', f: 'Doohan', nat: 'Australian', team: 'Alpine' },
    { id: 'tsunoda', num: '22', code: 'TSU', g: 'Yuki', f: 'Tsunoda', nat: 'Japanese', team: 'Racing Bulls' }
];

function resolveDriverImage(driver, openF1Map) {
    const familyName = driver.familyName || "";
    if (LOCAL_DRIVER_IMAGES[familyName]) return LOCAL_DRIVER_IMAGES[familyName];
    if (openF1Map && openF1Map[String(driver.permanentNumber)]) return openF1Map[String(driver.permanentNumber)];
    if (driver.imageUrl && driver.imageUrl !== "/favicon.svg") return driver.imageUrl;
    return "/favicon.svg";
}

async function syncEverything(env) {
    const results = { drivers: 0, races: 0, events: 0 };
    let openF1Map = {};
    try {
        const f1Res = await fetch('https://api.openf1.org/v1/drivers?session_key=latest');
        if (f1Res.ok) {
            const f1Data = await f1Res.json();
            f1Data.forEach(d => { if (d.driver_number && d.headshot_url) openF1Map[String(d.driver_number)] = d.headshot_url; });
        }
    } catch (e) { console.error("OpenF1 fetch error:", e); }
    for (const d of DRIVERS_2026) {
        const headshot = resolveDriverImage(d, openF1Map);
        await env.DB.prepare(`INSERT INTO Drivers (driverId, permanentNumber, code, givenName, familyName, nationality, teamName, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(driverId) DO UPDATE SET permanentNumber=excluded.permanentNumber, code=excluded.code, teamName=excluded.teamName, imageUrl=excluded.imageUrl`).bind(d.id, d.num, d.code, d.g, d.f, d.nat, d.team, headshot).run();
        results.drivers++;
    }
    const raceRes = await fetch('https://api.jolpi.ca/ergast/f1/current.json?limit=1000');
    const raceData = await raceRes.json();
    const races = raceData.MRData.RaceTable.Races;
    for (const r of races) {
        const cleanTime = r.time ? r.time.replace('Z', '') : '00:00:00';
        await env.DB.prepare(`INSERT INTO Races (season, round, raceName, circuitId, circuitName, date, time) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(season, round) DO UPDATE SET raceName=excluded.raceName, date=excluded.date, time=excluded.time`).bind(r.season, parseInt(r.round), r.raceName, r.Circuit.circuitId, r.Circuit.circuitName, r.date, cleanTime).run();
        results.races++;
    }
    try { results.events = await syncBetEvents(env); } catch (e) { console.error("Sync error:", e); }
    return results;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    if (path === '/health') return Response.json({ status: 'ok', version: '3.1.0' }, { headers: corsHeaders });
    if (path === '/race/schedule') {
      const { results } = await env.DB.prepare('SELECT * FROM Races ORDER BY round ASC').all();
      return Response.json(results, { headers: corsHeaders });
    }
    if (path === '/race/next') {
      const urlParams = new URL(request.url).searchParams;
      const requestedRaceId = urlParams.get('raceId');
      let race;
      if (requestedRaceId) race = await env.DB.prepare('SELECT * FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(parseInt(requestedRaceId)).first();
      if (!race) race = await env.DB.prepare('SELECT * FROM Races WHERE status = "ACTIVE" ORDER BY season DESC LIMIT 1').first();
      if (!race) race = await env.DB.prepare('SELECT * FROM Races WHERE date >= date("now") ORDER BY date ASC, time ASC LIMIT 1').first();
      return Response.json(race || null, { headers: corsHeaders });
    }
    if (path === '/drivers/stats') {
      await syncBetEvents(env);
      let openF1Map = {};
      try {
          const f1Res = await fetch('https://api.openf1.org/v1/drivers?session_key=latest');
          if (f1Res.ok) {
              const f1Data = await f1Res.json();
              f1Data.forEach(d => { if (d.driver_number && d.headshot_url) openF1Map[String(d.driver_number)] = d.headshot_url; });
          }
      } catch (e) {}
      let targetRace = await env.DB.prepare('SELECT id FROM Races WHERE status = "ACTIVE" LIMIT 1').first();
      if (!targetRace) targetRace = await env.DB.prepare('SELECT id FROM Races WHERE status = "ENDED" ORDER BY date DESC, time DESC LIMIT 1').first();
      const raceId = targetRace ? targetRace.id : -1;
      const query = `SELECT d.*, (SELECT COUNT(*) FROM UserPicks WHERE (firstPlaceId = d.driverId OR secondPlaceId = d.driverId OR thirdPlaceId = d.driverId) AND raceId = ?) as pickCount, (SELECT COUNT(*) FROM UserPicks WHERE raceId = ?) as totalPicks FROM Drivers d ORDER BY pickCount DESC, d.familyName ASC`;
      const { results } = await env.DB.prepare(query).bind(raceId, raceId).all();
      const mapped = results.map(driver => ({ ...driver, imageUrl: resolveDriverImage(driver, openF1Map) }));
      return Response.json(mapped, { headers: corsHeaders });
    }
    if (path === '/bets/record' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { walletAddress, raceRound, predictedNumbers, txHash } = body;
        if (!walletAddress || !raceRound || !predictedNumbers?.length) return Response.json({ error: 'Missing required fields' }, { status: 400, headers: corsHeaders });
        const result = await recordBetFromNumbers(env, { walletAddress, raceRound, predictedNumbers, txHash });
        return Response.json({ status: 'ok', ...result }, { headers: corsHeaders });
      } catch (err) { return Response.json({ error: err.message }, { status: 500, headers: corsHeaders }); }
    }
    if (path === '/admin/calculate-scores' && request.method === 'POST') {
      try {
        const { raceId, p1, p2, p3 } = await request.json();
        const numericRaceId = Number(raceId);
        
        // [무료 티어 대응] 10블록 이내의 최신 이벤트만 동기화 시도
        try { await syncBetEvents(env, numericRaceId); } catch (e) {}

        const resultNums = [parseInt(p1, 10), parseInt(p2, 10), parseInt(p3, 10)];
        const resultStrings = [String(p1), String(p2), String(p3)];

        // [핵심] RPC 제약으로 인해 온체인 전체 스캔은 포기하고 D1 데이터베이스(UserPicks)를 주 소스로 사용
        const { results: drivers } = await env.DB.prepare('SELECT driverId, permanentNumber FROM Drivers').all();
        const numToIdMap = buildNumToIdMap(drivers);
        const targetIds = [numToIdMap[resultStrings[0]] || resultStrings[0], numToIdMap[resultStrings[1]] || resultStrings[1], numToIdMap[resultStrings[2]] || resultStrings[2]];
        
        const race = await env.DB.prepare('SELECT id FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(numericRaceId).first();
        let dbTotal = 0;
        if (race) {
            const { results: picks } = await env.DB.prepare('SELECT * FROM UserPicks WHERE raceId = ?').bind(race.id).all();
            picks.forEach(pick => {
                let s = 0;
                const userPicks = [pick.firstPlaceId, pick.secondPlaceId, pick.thirdPlaceId];
                if (userPicks[0] === targetIds[0]) s += 5;
                if (userPicks[1] === targetIds[1]) s += 3;
                if (userPicks[2] === targetIds[2]) s += 2;
                dbTotal += s;
            });
        }
        
        // 온체인 계산은 10블록 이내의 것만 보조적으로 합산 (무료 티어 대응)
        const chainTotal = await computeTotalWinnerScoresFromChain(env, numericRaceId, resultNums);

        return Response.json({ totalWinnerScores: Math.max(chainTotal, dbTotal), details: { chainTotal, dbTotal } }, { headers: corsHeaders });
      } catch (err) { return Response.json({ error: err.message }, { status: 500, headers: corsHeaders }); }
    }
    if (path === '/admin/reset-db' && request.method === 'POST') {
        await env.DB.prepare('DELETE FROM UserPicks').run();
        await env.DB.prepare('UPDATE Races SET status = "PENDING"').run();
        return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }
    if (path === '/admin/force-sync' && request.method === 'POST') {
      const results = await syncEverything(env);
      return Response.json({ status: 'ok', results }, { headers: corsHeaders });
    }
    return new Response('Not Found', { status: 404 });
  } catch (err) { return new Response(err.message, { status: 500, headers: corsHeaders }); }
}
