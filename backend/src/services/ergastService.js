const axios = require('axios');
const pool = require('../config/db');
const { getLocalDriverImageUrl } = require('../constants/driverImages');

// Ergast API 클라이언트 설정
const ergastClient = axios.create({
    baseURL: 'https://api.jolpi.ca/ergast/f1',
    timeout: 10000,
});

// 응답 데이터를 자동으로 추출하는 인터셉터
ergastClient.interceptors.response.use(
    (response) => response.data,
    (error) => {
        console.error('Ergast API 에러:', error.response ? error.response.data : error.message);
        return Promise.reject(error);
    }
);

/**
 * 다음 경기 정보를 가져와 DB에 캐싱합니다.
 */
const getNextRace = async () => {
    try {
        const data = await ergastClient.get('/current/next.json');
        const race = data.MRData.RaceTable.Races[0];

        if (race) {
            const cleanTime = race.time ? race.time.replace('Z', '') : '00:00:00';
            
            const query = `
                INSERT INTO Races (season, round, raceName, circuitId, circuitName, date, time)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                raceName = VALUES(raceName),
                circuitId = VALUES(circuitId),
                circuitName = VALUES(circuitName),
                date = VALUES(date),
                time = VALUES(time)
            `;
            await pool.query(query, [
                race.season,
                race.round,
                race.raceName,
                race.Circuit.circuitId,
                race.Circuit.circuitName,
                race.date,
                cleanTime
            ]);
        }
        return race;
    } catch (error) {
        console.error('다음 경기 정보 캐싱 에러:', error);
        const [rows] = await pool.query('SELECT * FROM Races WHERE status != "ENDED" ORDER BY date ASC LIMIT 1');
        return rows[0];
    }
};

/**
 * 드라이버 목록을 가져와 DB에 캐싱합니다. (2025/2026 최신 데이터 우선)
 */
const getDrivers = async () => {
    try {
        console.log('드라이버 데이터 동기화 중 (OpenF1 + Ergast)...');
        
        // 1. OpenF1 세션 정보 가져오기 (2025 -> 2024 순으로 시도)
        let latestSessionKey = 'latest';
        let yearToTry = ['2025', '2024'];
        
        for (const year of yearToTry) {
            try {
                const sessionRes = await axios.get(`https://api.openf1.org/v1/sessions?year=${year}`);
                if (sessionRes.data && sessionRes.data.length > 0) {
                    latestSessionKey = sessionRes.data[sessionRes.data.length - 1].session_key;
                    console.log(`${year}년 세션 키 발견: ${latestSessionKey}`);
                    break;
                }
            } catch (err) {
                console.warn(`${year}년 세션 정보를 가져오는 데 실패했습니다.`);
            }
        }

        // 2. OpenF1 드라이버 데이터 가져오기
        const openF1Response = await axios.get(`https://api.openf1.org/v1/drivers?session_key=${latestSessionKey}`);
        const openF1Drivers = openF1Response.data;

        // 3. Ergast 드라이버 데이터 가져오기 (공식 시즌 전체 로스터)
        const ergastData = await ergastClient.get('/current/drivers.json');
        const ergastDrivers = ergastData.MRData.DriverTable.Drivers;

        for (const eDriver of ergastDrivers) {
            const driverId = eDriver.driverId;
            const givenName = eDriver.givenName;
            const familyName = eDriver.familyName;
            const permanentNumber = eDriver.permanentNumber || '0';
            const normalizedLastName = familyName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            // OpenF1 데이터와 매칭 (번호 또는 성씨 기준)
            let of1 = openF1Drivers.find(o => 
                (o.driver_number === parseInt(permanentNumber)) || 
                (o.last_name?.toLowerCase() === familyName.toLowerCase())
            );

            // [리뷰어 핫픽스 추가] latest 세션에 불참하여 누락된 드라이버 데이터 개별 보완
            if ((!of1 || !of1.headshot_url || !of1.team_name)) {
                // [안전한 API 호출 함수] 404(Not Found)나 429(Too Many Requests) 에러 발생 시 프로그램이 멈추지 않고 빈 배열을 반환하도록 예외 처리합니다.
                const getSafe = async (url) => {
                    try {
                        const res = await axios.get(url);
                        return res;
                    } catch (e) {
                        return { data: [] };
                    }
                };

                try {
                    let fallbackRes = { data: [] };
                    
                    // 0순위: 유저가 제안한 특정 세션(11291) 먼저 검색
                    fallbackRes = await getSafe(`https://api.openf1.org/v1/drivers?driver_number=${permanentNumber}&session_key=11291`);
                    
                    // 1순위: OpenF1 API에서 driver_number로 최신 세션 검색
                    if (!fallbackRes.data || fallbackRes.data.length === 0) {
                        if (permanentNumber && permanentNumber !== '0') {
                            fallbackRes = await getSafe(`https://api.openf1.org/v1/drivers?driver_number=${permanentNumber}&session_key=latest`);
                            // 최신 세션에 없다면 전체 세션에서 driver_number로 재검색
                            if (!fallbackRes.data || fallbackRes.data.length === 0) {
                                fallbackRes = await getSafe(`https://api.openf1.org/v1/drivers?driver_number=${permanentNumber}`);
                            }
                        }
                    }
                    
                    // 2순위: driver_number로 찾지 못했다면 last_name으로 검색
                    if (!fallbackRes.data || fallbackRes.data.length === 0) {
                         fallbackRes = await getSafe(`https://api.openf1.org/v1/drivers?last_name=${normalizedLastName}&session_key=latest`);
                         if (!fallbackRes.data || fallbackRes.data.length === 0) {
                             fallbackRes = await getSafe(`https://api.openf1.org/v1/drivers?last_name=${normalizedLastName}`);
                         }
                    }

                    if (fallbackRes.data && fallbackRes.data.length > 0) {
                        // 유효한 이미지를 가진 가장 최신 기록을 찾습니다. 
                        // [수정] d_driver_fallback_image.png 가 포함되어 있더라도 실제 경로(/content/dam/)가 있으면 유효한 것으로 간주합니다.
                        const validData = fallbackRes.data.slice().reverse().find(d => 
                            d.headshot_url && 
                            !d.headshot_url.endsWith('default-driver.png') &&
                            (d.headshot_url.includes('/content/dam/') || !d.headshot_url.includes('d_driver_fallback_image.png'))
                        );
                        if (validData) {
                            of1 = validData;
                        } else {
                            of1 = fallbackRes.data[fallbackRes.data.length - 1]; // 이미지가 없으면 가장 최근 세션 데이터 사용
                        }
                    }
                } catch (err) {
                    console.warn(`드라이버 ${familyName} 개별 데이터 보완 실패: ${err.message}`);
                }
            }

            // [리뷰어 핫픽스: 특정 드라이버 예외 처리 및 로컬 이미지 할당]
            let imageUrl = getLocalDriverImageUrl(familyName);

            const code = eDriver.code || (of1 ? of1.name_acronym : '');
            const nationality = eDriver.nationality;
            
            // 팀 이름이 null이면 알려진 팀으로 세팅하거나 Unknown 처리
            let teamName = (of1 && of1.team_name) ? of1.team_name : 'Unknown';
            if (teamName === 'Unknown' && familyName === 'Crawford') teamName = 'Aston Martin'; 
            if (teamName === 'Unknown' && familyName === 'Lindblad') teamName = 'Racing Bulls'; 
            
            // [이미지 URL 할당] 로컬 이미지가 설정되지 않은 경우에만 OpenF1 API 또는 보완된 URL을 사용합니다.
            if (!imageUrl) {
                imageUrl = (of1 && of1.headshot_url) ? of1.headshot_url : null;
            }
            
            // [리뷰어 핫픽스: 이미지 유효성 검증] 
            // 1. 이미지가 존재하고 2. 외부 URL이며 3. 404가 확실시되는 'default-driver.png'가 아닌 경우에만 실제 존재 여부를 체크합니다.
            if (imageUrl && imageUrl.startsWith('http') && !imageUrl.includes('default-driver.png')) {
                try {
                    // HEAD 요청으로 이미지가 서버에 실제로 존재하는지 확인합니다.
                    await axios.head(imageUrl);
                } catch (e) {
                    // 404 에러 등이 발생하면 이미지를 무효화하여 폴백 로직으로 넘깁니다.
                    console.warn(`드라이버 ${familyName} 이미지 접근 불가: ${imageUrl}`);
                    imageUrl = null;
                }
            }

            // 이미지가 없거나, 위 검증에서 실패했거나, 404 유발 URL인 경우 기본 아이콘을 할당합니다.
            if (!imageUrl || imageUrl.includes('default-driver.png')) {
                // 프론트엔드에 내장된 안전한 에셋인 '/favicon.svg'를 사용합니다.
                imageUrl = "/favicon.svg";
            }

            const query = `
                INSERT INTO Drivers (driverId, permanentNumber, code, givenName, familyName, nationality, teamName, imageUrl)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                permanentNumber = VALUES(permanentNumber),
                code = VALUES(code),
                givenName = VALUES(givenName),
                familyName = VALUES(familyName),
                nationality = VALUES(nationality),
                teamName = VALUES(teamName),
                imageUrl = VALUES(imageUrl)
            `;
            
            await pool.query(query, [
                driverId,
                permanentNumber,
                code,
                givenName,
                familyName,
                nationality,
                teamName,
                imageUrl
            ]);
            console.log(`[DEBUG] Driver: ${familyName}, Image URL sent to DB: ${imageUrl}`);
        }

        console.log(`${ergastDrivers.length}명의 드라이버 데이터 동기화 완료.`);
        return openF1Drivers;
    } catch (error) {
        console.error('드라이버 동기화 에러:', error.message);
        const [rows] = await pool.query('SELECT * FROM Drivers');
        return rows;
    }
};

/**
 * 이번 시즌 전체 일정을 가져옵니다.
 */
const getSeasonSchedule = async () => {
    try {
        const data = await ergastClient.get('/current.json');
        return data.MRData.RaceTable.Races;
    } catch (error) {
        console.error('시즌 일정 로드 에러 (API):', error.message, 'DB 캐시에서 로드합니다.');
        const [rows] = await pool.query('SELECT * FROM Races ORDER BY round ASC');
        return rows;
    }
};

/**
 * 이번 시즌 전체 일정을 가져와 DB에 저장합니다.
 */
const syncSeasonSchedule = async () => {
    try {
        console.log('이번 시즌 전체 일정 동기화 중...');
        const data = await ergastClient.get('/current.json');
        const races = data.MRData.RaceTable.Races;

        if (!races || races.length === 0) {
            throw new Error('API에서 경주 일정을 받아오지 못했습니다.');
        }

        for (const race of races) {
            // [리뷰어 주석] Ergast API의 time 필드는 UTC 기준이므로 'Z'를 단순히 제거하면
            // 브라우저나 서버 환경에서 로컬 시간으로 오인하여 파싱될 위험이 있습니다.
            // 명시적으로 UTC로 관리하거나 TIME 필드 저장 시 주의가 필요합니다.
            const cleanTime = race.time ? race.time.replace('Z', '') : '00:00:00';
            const query = `
                INSERT INTO Races (season, round, raceName, circuitId, circuitName, date, time)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                raceName = VALUES(raceName),
                circuitId = VALUES(circuitId),
                circuitName = VALUES(circuitName),
                date = VALUES(date),
                time = VALUES(time)
            `;
            await pool.query(query, [
                race.season,
                race.round,
                race.raceName,
                race.Circuit.circuitId,
                race.Circuit.circuitName,
                race.date,
                cleanTime
            ]);
        }
        console.log(`${races.length}개의 경주 일정을 동기화 완료했습니다.`);
        return races;
    } catch (error) {
        console.error('시즌 일정 동기화 에러 (API):', error.message, 'DB 캐시에서 로드합니다.');
        const [rows] = await pool.query('SELECT * FROM Races ORDER BY round ASC');
        return rows;
    }
};

module.exports = {
    getNextRace,
    getDrivers,
    getSeasonSchedule,
    syncSeasonSchedule,
};
