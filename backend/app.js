const express = require('express');
const cors = require('cors');
const apiRoutes = require('./src/routes/api');

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// API 라우터 연결
app.use('/api', apiRoutes);

// 기본 상태 확인 경로
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'F1 Podium Predictor 백엔드가 정상 작동 중입니다.' });
});

module.exports = app;
