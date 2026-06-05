const { ethers } = require('ethers');
const pool = require('../config/db');
const abi = require('../constants/abi.json');
require('dotenv').config();

/**
 * 블록체인 이벤트를 감시하고 DB와 동기화하는 오라클 서비스입니다.
 */
const startOracle = async () => {
    if (!process.env.SEPOLIA_RPC_URL || !process.env.CONTRACT_ADDRESS) {
        console.error('오라클 서비스: .env 설정이 누락되었습니다.');
        return;
    }

    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, provider);

    console.log('오라클 서비스 시작: 이벤트를 리스닝 중...');

    /**
     * 사용자가 베팅을 완료했을 때 호출되어 DB에 기록합니다.
     */
    const handleBetPlaced = async (raceId, bettor, predictedIds, event) => {
        const txHash = event.log ? event.log.transactionHash : event.transactionHash;
        console.log(`[오라클] 베팅 감지: 경기 ${raceId}, 사용자 ${bettor}, TX: ${txHash}`);
        
        try {
            // 드라이버 ID 맵핑 (번호 -> 문자열 ID)
            const [drivers] = await pool.query('SELECT driverId, permanentNumber FROM Drivers');
            const driverMap = {};
            drivers.forEach(d => {
                if (d.permanentNumber) {
                    driverMap[parseInt(d.permanentNumber)] = d.driverId;
                }
            });

            const p1 = driverMap[Number(predictedIds[0])];
            const p2 = driverMap[Number(predictedIds[1])];
            const p3 = driverMap[Number(predictedIds[2])];

            if (!p1 || !p2 || !p3) {
                console.warn(`[오라클] 드라이버 맵핑 실패 (ID: ${predictedIds}).`);
                return;
            }

            // 현재 활성화된 경기를 찾거나 raceId로 조회
            let [races] = await pool.query('SELECT id FROM Races WHERE status = "ACTIVE" LIMIT 1');
            if (races.length === 0) {
                [races] = await pool.query('SELECT id FROM Races WHERE round = ?', [Number(raceId)]);
            }

            if (races.length === 0) {
                console.warn(`[오라클] 일치하는 경기 정보를 DB에서 찾을 수 없습니다.`);
                return;
            }
            const dbRaceId = races[0].id;

            const query = `
                INSERT INTO UserPicks (walletAddress, raceId, firstPlaceId, secondPlaceId, thirdPlaceId, txHash)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                firstPlaceId = VALUES(firstPlaceId),
                secondPlaceId = VALUES(secondPlaceId),
                thirdPlaceId = VALUES(thirdPlaceId),
                txHash = VALUES(txHash)
            `;
            await pool.query(query, [
                bettor.toLowerCase(),
                dbRaceId,
                p1,
                p2,
                p3,
                txHash
            ]);
            console.log(`[오라클] 사용자 ${bettor}의 픽이 DB에 동기화되었습니다.`);
        } catch (err) {
            console.error('[오라클] BetPlaced 처리 중 에러:', err.message);
        }
    };

    /**
     * 과거 이벤트를 동기화하여 누락된 데이터를 보충합니다.
     */
    const syncPastEvents = async () => {
        try {
            console.log('[오라클] 과거 이벤트 동기화 중...');
            const latestBlock = await provider.getBlockNumber();
            const fromBlock = latestBlock > 1000 ? latestBlock - 999 : 0;
            const filter = contract.filters.BetPlaced();
            const events = await contract.queryFilter(filter, fromBlock, latestBlock); 
            console.log(`[오라클] ${events.length}개의 과거 베팅 내역을 발견했습니다. (범위: ${fromBlock} -> ${latestBlock})`);
            
            for (const event of events) {
                const { raceId, bettor, predictedIds } = event.args;
                await handleBetPlaced(raceId, bettor, predictedIds, event);
            }
        } catch (err) {
            console.error('[오라클] 과거 동기화 실패:', err.message);
        }
    };

    // 초기 동기화 실행 (현재 RPC 문제로 임시 비활성화)
    // await syncPastEvents();

    // 실시간 이벤트 리스너 등록
    contract.on('BetPlaced', handleBetPlaced);

    contract.on('RaceStarted', async (raceId, deadline) => {
        const round = Number(raceId);
        console.log(`[오라클] 경기 시작 이벤트 감지: 경기 ID ${round}`);
        try {
            // 기존에 ACTIVE 상태였던 다른 경기가 있다면 PENDING으로 되돌려 데이터 정합성을 유지합니다.
            await pool.query('UPDATE Races SET status = "PENDING" WHERE status = "ACTIVE"');
            // 이벤트에서 받은 정확한 라운드 ID의 경주를 ACTIVE로 설정합니다.
            await pool.query('UPDATE Races SET status = "ACTIVE" WHERE round = ?', [round]);
            console.log(`[오라클] DB: 경기 ${round}번을 ACTIVE로 변경했습니다.`);
        } catch (err) {
            console.error('[오라클] RaceStarted 처리 에러:', err.message);
        }
    });

    contract.on('RaceResolved', async (raceId, results, totalWinnerScores) => {
        const round = Number(raceId);
        console.log(`[오라클] 경기 종료 이벤트 감지: 경기 ID ${round}`);
        try {
            // 정확한 라운드 ID의 경주를 ENDED로 설정합니다.
            await pool.query('UPDATE Races SET status = "ENDED" WHERE round = ?', [round]);
            console.log(`[오라클] DB: 경기 ${round}번을 ENDED로 변경했습니다.`);
        } catch (err) {
            console.error('[오라클] RaceResolved 처리 에러:', err.message);
        }
    });

    /**
     * 주기적으로 온체인 상태를 확인하여 DB와 동기화합니다 (이벤트 유실 대비).
     */
    setInterval(async () => {
        try {
            const info = await contract.getRaceInfo();
            const onChainState = Number(info.state); // 0: IDLE, 1: ACTIVE, 2: PAUSED, 3: ENDED
            const onChainRaceId = Number(info.raceId);

            if (onChainRaceId === 0 || onChainState === 0) {
                // 아직 경기가 시작되지 않았거나 IDLE 상태인 경우, DB의 모든 ACTIVE 경기를 PENDING으로 되돌립니다.
                const [result] = await pool.query('UPDATE Races SET status = "PENDING" WHERE status = "ACTIVE"');
                if (result.changedRows > 0) {
                    console.log(`[오라클-주기] 온체인(IDLE)에 맞춰 DB의 활성 경기를 대기 상태로 변경했습니다.`);
                }
                return;
            }
            
            const [[dbRace]] = await pool.query('SELECT status FROM Races WHERE round = ?', [onChainRaceId]);
            const dbState = dbRace?.status;

            if (onChainState === 1 && dbState !== 'ACTIVE') { // ACTIVE
                console.log(`[오라클-주기] 온체인(ACTIVE)과 DB(${dbState}) 상태 불일치. 동기화합니다.`);
                await pool.query('UPDATE Races SET status = "PENDING" WHERE status = "ACTIVE"'); // 다른 경기 비활성화
                await pool.query('UPDATE Races SET status = "ACTIVE" WHERE round = ?', [onChainRaceId]);
            } else if (onChainState === 3 && dbState !== 'ENDED') { // ENDED
                console.log(`[오라클-주기] 온체인(ENDED)과 DB(${dbState}) 상태 불일치. 동기화합니다.`);
                await pool.query('UPDATE Races SET status = "ENDED" WHERE round = ?', [onChainRaceId]);
            } else if (onChainState === 2 && dbState !== 'PENDING') { // PAUSED (조기종료 시 DB는 PENDING 처리하여 노출 방지)
                console.log(`[오라클-주기] 온체인(PAUSED) 감지. DB 상태를 조정합니다.`);
                await pool.query('UPDATE Races SET status = "PENDING" WHERE round = ?', [onChainRaceId]);
            }
        } catch (err) {
            // console.error('[오라클] 주기적 상태 확인 실패:', err.message);
        }
    }, 30 * 1000); // 30초마다 확인
};

module.exports = { startOracle };
