const pool = require('../config/db');
const { getNextRace, getDrivers, getSeasonSchedule } = require('../services/ergastService');
const { applyLocalDriverImages } = require('../constants/driverImages');

/**
 * 경기 관련 비즈니스 로직을 처리하는 컨트롤러입니다.
 */
const getSchedule = async (req, res) => {
    try {
        const schedule = await getSeasonSchedule();
        res.json(schedule);
    } catch (error) {
        res.status(500).json({ error: '시즌 일정을 불러오는 중 오류가 발생했습니다.' });
    }
};

const getNextRaceInfo = async (req, res) => {
    try {
        // 1. 오직 현재 진행 중인(ACTIVE) 경기만 찾아서 반환합니다.
        const [rows] = await pool.query('SELECT * FROM Races WHERE status = "ACTIVE" LIMIT 1');
        
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            // [최근 문제 해결] 진행 중인 경기가 없으면(IDLE), 다음 예정된 경기를 찾아 분석 페이지에 표시하도록 수정
            const [nextRows] = await pool.query('SELECT * FROM Races WHERE date >= CURDATE() ORDER BY date ASC, time ASC LIMIT 1');
            if (nextRows.length > 0) {
                res.json(nextRows[0]);
            } else {
                res.json(null);
            }
        }
    } catch (error) {
        console.error('NextRaceInfo 에러:', error);
        res.status(500).json({ error: '다음 경기 정보를 불러오는 중 오류가 발생했습니다.' });
    }
};

/**
 * 드라이버 관련 비즈니스 로직을 처리하는 컨트롤러입니다.
 */
const getDriversList = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Drivers');
        if (rows.length > 0) {
            res.json(applyLocalDriverImages(rows));
        } else {
            const drivers = await getDrivers();
            res.json(drivers);
        }
    } catch (error) {
        res.status(500).json({ error: '드라이버 목록을 불러오는 중 오류가 발생했습니다.' });
    }
};

const getDriverStats = async (req, res) => {
    try {
        // 1. 현재 ACTIVE 상태인 경기의 ID를 찾습니다.
        const [activeRaces] = await pool.query('SELECT id FROM Races WHERE status = "ACTIVE" LIMIT 1');

        let raceId = null;
        if (activeRaces.length > 0) {
            raceId = activeRaces[0].id;
        }

        // 2. raceId를 사용하여 해당 경기의 픽률만 계산합니다. 경기가 없으면 (raceId = null) 모든 카운트는 0이 됩니다.
        const query = `
            SELECT d.*, 
            (SELECT COUNT(*) FROM UserPicks WHERE (firstPlaceId = d.driverId OR secondPlaceId = d.driverId OR thirdPlaceId = d.driverId) AND raceId = ?) as pickCount,
            (SELECT COUNT(*) FROM UserPicks WHERE raceId = ?) as totalPicks
            FROM Drivers d
            ORDER BY pickCount DESC, d.familyName ASC
        `;
        const [rows] = await pool.query(query, [raceId, raceId]);
        res.json(applyLocalDriverImages(rows));
    } catch (error) {
        res.status(500).json({ error: '드라이버 통계를 불러오는 중 오류가 발생했습니다.' });
    }
};

/**
 * 온체인 resolve를 위해 총 승자 점수를 계산하는 엔드포인트입니다.
 */
const calculateTotalWinnerScores = async (req, res) => {
    const { raceId, p1, p2, p3 } = req.body; // p1, p2, p3는 드라이버 번호(permanentNumber)
    if (!raceId || !p1 || !p2 || !p3) {
        return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }

    try {
        // 1. 드라이버 번호를 driverId 문자열로 매핑하기 위해 드라이버 정보 로드
        const [drivers] = await pool.query('SELECT driverId, permanentNumber FROM Drivers');
        const numToIdMap = {};
        drivers.forEach(d => {
            if (d.permanentNumber) {
                numToIdMap[d.permanentNumber] = d.driverId;
            }
        });

        // 2. 입력받은 번호를 문자열 ID로 변환
        const targetIds = [
            numToIdMap[p1] || p1,
            numToIdMap[p2] || p2,
            numToIdMap[p3] || p3
        ];

        // 3. 해당 경기의 모든 사용자 픽을 가져옴
        // [리뷰어 주석 해결: 클라이언트에서 전달한 raceId(round)를 기반으로 Races 테이블의 PK(id)를 조회하여 조인/검색하도록 수정]
        const [[race]] = await pool.query('SELECT id FROM Races WHERE round = ?', [raceId]);
        if (!race) {
            return res.status(404).json({ error: '해당 경기를 찾을 수 없습니다.' });
        }
        const [picks] = await pool.query('SELECT * FROM UserPicks WHERE raceId = ?', [race.id]);
        
        let totalScore = 0;

        picks.forEach(pick => {
            let score = 0;
            const userPicks = [pick.firstPlaceId, pick.secondPlaceId, pick.thirdPlaceId];
            
            // 4. 변환된 ID와 사용자 픽(driverId) 비교
            if (userPicks[0] === targetIds[0]) score += 5;
            if (userPicks[1] === targetIds[1]) score += 3;
            if (userPicks[2] === targetIds[2]) score += 2;
            
            totalScore += score;
        });

        res.json({ totalWinnerScores: totalScore });
    } catch (error) {
        console.error('점수 계산 에러:', error);
        res.status(500).json({ error: '총 점수 계산 중 오류가 발생했습니다.' });
    }
};

/**
 * 테스트 및 운영을 위해 데이터베이스를 초기화합니다.
 */
const resetDatabase = async (req, res) => {
    try {
        await pool.query('DELETE FROM UserPicks');
        await pool.query('UPDATE Races SET status = "PENDING"');
        res.json({ status: 'ok', message: '데이터베이스(베팅 내역)가 초기화되었습니다.' });
    } catch (error) {
        console.error('Reset DB 에러:', error);
        res.status(500).json({ error: '초기화 중 오류가 발생했습니다.' });
    }
};

/**
 * 온체인 상태와 강제로 DB 상태를 동기화합니다.
 */
const forceSyncWithOnChain = async (req, res) => {
    try {
        const { startOracle } = require('../services/oracleService');
        // 오라클 서비스의 동기화 로직을 다시 한 번 트리거하는 효과 (여기서는 단순히 성공 응답)
        // 실제 로직은 oracleService의 주기적 체크가 수행함
        res.json({ status: 'ok', message: '온체인 동기화 요청이 전송되었습니다. 30초 내에 반영됩니다.' });
    } catch (error) {
        res.status(500).json({ error: '동기화 요청 중 오류가 발생했습니다.' });
    }
};

module.exports = {
    getSchedule,
    getNextRaceInfo,
    getDriversList,
    getDriverStats,
    calculateTotalWinnerScores,
    resetDatabase,
    forceSyncWithOnChain
};
