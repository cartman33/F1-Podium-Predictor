const express = require('express');
const router = express.Router();
const raceController = require('../controllers/raceController');

/**
 * 경기 및 드라이버 관련 라우트를 정의합니다.
 */

// 시즌 일정 및 다음 경기 정보
router.get('/race/schedule', raceController.getSchedule);
router.get('/race/next', raceController.getNextRaceInfo);

// 드라이버 목록 및 통계
router.get('/drivers', raceController.getDriversList);
router.get('/drivers/stats', raceController.getDriverStats);

// 오프체인 계산 (관리자용)
router.post('/admin/calculate-scores', raceController.calculateTotalWinnerScores);

// 시스템 초기화 및 동기화 (관리자용)
router.post('/admin/reset-db', raceController.resetDatabase);
router.post('/admin/force-sync', raceController.forceSyncWithOnChain);

module.exports = router;
