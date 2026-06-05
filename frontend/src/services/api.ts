import axios from 'axios';

const API_BASE = '/api';

/**
 * 드라이버 및 경기 통계 인터페이스
 */
export interface DriverStats {
  driverId: string;
  permanentNumber: string;
  code: string;
  givenName: string;
  familyName: string;
  nationality: string;
  teamName: string;
  imageUrl: string;
  pickCount: number;
  totalPicks: number;
}

/**
 * 드라이버 통계 데이터를 가져옵니다.
 */
export const getDriversWithStats = async (): Promise<DriverStats[]> => {
  const response = await axios.get(`${API_BASE}/drivers/stats?t=${Date.now()}`);
  return response.data;
};

/**
 * 다음 경기 정보를 가져옵니다.
 */
export const getNextRace = async (raceId?: number) => {
  const url = raceId 
    ? `${API_BASE}/race/next?raceId=${raceId}&t=${Date.now()}`
    : `${API_BASE}/race/next?t=${Date.now()}`;
  const response = await axios.get(url);
  return response.data;
};

/**
 * 전체 시즌 일정을 가져옵니다.
 */
export const getRaceSchedule = async () => {
  const response = await axios.get(`${API_BASE}/race/schedule?t=${Date.now()}`);
  return response.data;
};

/**
 * 관리자가 경기 결과를 확정하기 위해 필요한 총 승자 점수를 백엔드에서 계산합니다.
 */
export const calculateTotalWinnerScores = async (raceId: number, p1: string, p2: string, p3: string) => {
  const response = await axios.post(`${API_BASE}/admin/calculate-scores`, {
    raceId, p1, p2, p3
  });
  return response.data.totalWinnerScores;
};

/**
 * 데이터베이스를 초기화합니다. (테스트용)
 */
export const resetDatabase = async () => {
  const response = await axios.post(`${API_BASE}/admin/reset-db`);
  return response.data;
};

/**
 * 온체인 상태와 강제로 DB를 동기화합니다.
 */
export const forceSync = async () => {
  const response = await axios.post(`${API_BASE}/admin/force-sync`);
  return response.data;
};

/**
 * 베팅 직후 D1에 픽을 즉시 기록합니다 (픽률 갱신용).
 */
export const recordBet = async (payload: {
  walletAddress: string;
  raceRound: number;
  predictedNumbers: number[];
  txHash?: string;
}) => {
  const response = await axios.post(`${API_BASE}/bets/record`, payload);
  return response.data;
};
