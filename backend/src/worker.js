import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ethers } from 'ethers';

const app = new Hono();

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

async function upsertUserPick(db, dbRaceId, walletAddress, p1, p2, p3, txHash) {
    await db.prepare(USER_PICK_UPSERT)
        .bind(walletAddress.toLowerCase(), dbRaceId, p1, p2, p3, txHash || null)
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

/** 온체인 BetPlaced 이벤트를 D1 UserPicks에 반영 */
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
        const fromBlock = Math.max(0, latestBlock - 100000);
        const filter = contract.filters.BetPlaced(raceId);
        const events = await contract.queryFilter(filter, fromBlock, latestBlock);

        for (const event of events) {
            const { bettor, predictedIds } = event.args;
            const nums = predictedIds.map((id) => Number(id));
            const p1 = driverMap[nums[0]];
            const p2 = driverMap[nums[1]];
            const p3 = driverMap[nums[2]];
            if (p1 && p2 && p3) {
                await upsertUserPick(env.DB, dbRace.id, bettor, p1, p2, p3, event.transactionHash);
                eventsSynced++;
            }
        }
    } catch (e) { console.error('syncBetEvents error:', e); }
    return eventsSynced;
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

app.use('*', cors());

app.get('/api/race/schedule', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM Races ORDER BY round ASC').all();
    return c.json(results);
});

app.get('/api/race/next', async (c) => {
    const requestedRaceId = c.req.query('raceId');
    let race;
    if (requestedRaceId) race = await c.env.DB.prepare('SELECT * FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(parseInt(requestedRaceId)).first();
    if (!race) race = await c.env.DB.prepare('SELECT * FROM Races WHERE status = "ACTIVE" ORDER BY season DESC LIMIT 1').first();
    if (!race) race = await env.DB.prepare('SELECT * FROM Races WHERE date >= date("now") ORDER BY date ASC, time ASC LIMIT 1').first();
    return c.json(race || null);
});

app.get('/api/drivers/stats', async (c) => {
    await syncBetEvents(c.env);
    let targetRace = await c.env.DB.prepare('SELECT id FROM Races WHERE status = "ACTIVE" LIMIT 1').first();
    if (!targetRace) targetRace = await c.env.DB.prepare('SELECT id FROM Races WHERE status = "ENDED" ORDER BY date DESC, time DESC LIMIT 1').first();
    const raceId = targetRace ? targetRace.id : -1;
    const query = `SELECT d.*, (SELECT COUNT(*) FROM UserPicks WHERE (firstPlaceId = d.driverId OR secondPlaceId = d.driverId OR thirdPlaceId = d.driverId) AND raceId = ?) as pickCount, (SELECT COUNT(*) FROM UserPicks WHERE raceId = ?) as totalPicks FROM Drivers d ORDER BY pickCount DESC, d.familyName ASC`;
    const { results } = await c.env.DB.prepare(query).bind(raceId, raceId).all();
    const mapped = results.map(d => ({ ...d, imageUrl: LOCAL_DRIVER_IMAGES[d.familyName] || d.imageUrl || "/favicon.svg" }));
    return c.json(mapped);
});

app.post('/api/bets/record', async (c) => {
    try {
        const body = await c.req.json();
        const { walletAddress, raceRound, predictedNumbers, txHash } = body;
        const race = await c.env.DB.prepare('SELECT id FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(raceRound).first();
        if (!race) return c.json({ error: 'Race not found' }, 404);
        const { results: dbDrivers } = await c.env.DB.prepare('SELECT driverId, permanentNumber FROM Drivers').all();
        const driverMap = buildDriverNumberMap(dbDrivers);
        const p1 = driverMap[Number(predictedNumbers[0])], p2 = driverMap[Number(predictedNumbers[1])], p3 = driverMap[Number(predictedNumbers[2])];
        if (!p1 || !p2 || !p3) throw new Error('Invalid drivers');
        await upsertUserPick(c.env.DB, race.id, walletAddress, p1, p2, p3, txHash);
        return c.json({ status: 'ok' });
    } catch (err) { return c.json({ error: err.message }, 500); }
});

app.post('/api/admin/calculate-scores', async (c) => {
    try {
        const { raceId, p1, p2, p3 } = await c.req.json();
        const numericRaceId = Number(raceId);
        await syncBetEvents(c.env, numericRaceId);
        const actualNums = [parseInt(p1, 10), parseInt(p2, 10), parseInt(p3, 10)];
        const { provider, contract } = await getContract(c.env);
        const latestBlock = await provider.getBlockNumber();
        const filter = contract.filters.BetPlaced(numericRaceId);
        let events = [];
        try { events = await contract.queryFilter(filter, Math.max(0, latestBlock - 100000), latestBlock); } catch (e) { events = await contract.queryFilter(filter, latestBlock - 5000, latestBlock); }

        let chainTotal = 0;
        for (const event of events) {
            chainTotal += calculateScoreLocal(event.args.predictedIds.map(id => Number(id)), actualNums);
        }

        const { results: drivers } = await c.env.DB.prepare('SELECT driverId, permanentNumber FROM Drivers').all();
        const numToIdMap = buildNumToIdMap(drivers);
        const targetIds = [numToIdMap[String(p1)], numToIdMap[String(p2)], numToIdMap[String(p3)]];
        const race = await c.env.DB.prepare('SELECT id FROM Races WHERE round = ? ORDER BY season DESC LIMIT 1').bind(numericRaceId).first();
        let dbTotal = 0;
        if (race) {
            const { results: picks } = await c.env.DB.prepare('SELECT * FROM UserPicks WHERE raceId = ?').bind(race.id).all();
            picks.forEach(pick => {
                let s = 0;
                const userPicks = [pick.firstPlaceId, pick.secondPlaceId, pick.thirdPlaceId];
                if (userPicks[0] === targetIds[0]) s += 5;
                if (userPicks[1] === targetIds[1]) s += 3;
                if (userPicks[2] === targetIds[2]) s += 2;
                dbTotal += s;
            });
        }
        return c.json({ totalWinnerScores: Math.max(chainTotal, dbTotal) });
    } catch (err) { return c.json({ error: err.message }, 500); }
});

app.post('/api/admin/reset-db', async (c) => {
    await c.env.DB.prepare('DELETE FROM UserPicks').run();
    await c.env.DB.prepare('UPDATE Races SET status = "PENDING"').run();
    return c.json({ status: 'ok' });
});

app.post('/api/admin/force-sync', async (c) => {
    const results = await syncEverything(c.env);
    return c.json({ status: 'ok', results });
});

async function syncEverything(env) {
    const results = { drivers: 0, races: 0, events: 0 };
    // Skip full driver/race insert for brevity in sync, just call event sync
    results.events = await syncBetEvents(env);
    return results;
}

export default app;
