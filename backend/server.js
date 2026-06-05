require('dotenv').config();
const app = require('./app');
const { syncSeasonSchedule, getDrivers } = require('./src/services/ergastService');
const { startOracle } = require('./src/services/oracleService');

const port = process.env.PORT || 3001;

/**
 * 백엔드 서비스를 초기화하고 서버를 시작합니다.
 */
const init = async () => {
    console.log('백엔드 서비스 초기화 중...');
    try {
        // 초기 데이터 동기화 (전체 일정 및 드라이버)
        await getDrivers();
        await syncSeasonSchedule();
        
        // 블록체인 오라클 시작
        startOracle();

        // 10분마다 주기적으로 데이터 갱신 (캐싱)
        setInterval(async () => {
            console.log('주기적 데이터 동기화 실행 중...');
            await getDrivers();
            await syncSeasonSchedule();
        }, 10 * 60 * 1000);

    } catch (err) {
        console.error('초기화 실패:', err.message);
    }
};

app.listen(port, () => {
    console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
    init();
});
