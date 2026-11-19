'use strict';

// 2026-11-20 팬페이지 눈 효과: Pages 배포 때(매일 09:00 KST 예약 배포 포함) 서울 시간대별 예보를 한 번 받아
// static-data/weather/seoul.json으로 올린다. Firebase 서버·DB를 쓰지 않고(비용 0), 방문자 정보도 외부로 가지 않는다.
// 날씨 데이터: Open-Meteo (https://open-meteo.com, CC BY 4.0). 실패해도 배포는 계속하고 파일만 빠진다(화면은 눈 없음).
const fs = require('node:fs/promises');
const path = require('node:path');

const SEOUL = { latitude: 37.5665, longitude: 126.978 };
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]); // WMO: 눈·싸락눈·소낙눈
const HEAVY_CODES = new Set([75, 86]);

// 0=눈 없음, 1=눈, 2=함박눈. 시각 키는 한국시간 "YYYY-MM-DDTHH".
function snowLevel(code, snowfallCm) {
  const snow = Number(snowfallCm) || 0;
  if (HEAVY_CODES.has(Number(code)) || snow >= 1) return 2;
  if (SNOW_CODES.has(Number(code)) || snow > 0) return 1;
  return 0;
}

function buildForecast(payload, generatedAt = new Date().toISOString()) {
  const hourly = payload && payload.hourly;
  if (!hourly || !Array.isArray(hourly.time)) throw new Error('Open-Meteo 응답 형식이 다릅니다.');
  const hours = {};
  hourly.time.forEach((time, index) => {
    const key = String(time).slice(0, 13);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key)) return;
    const level = snowLevel(hourly.weather_code && hourly.weather_code[index], hourly.snowfall && hourly.snowfall[index]);
    if (level) hours[key] = level; // 눈 오는 시간만 담아 파일을 작게 유지
  });
  return { schemaVersion: 1, region: 'seoul', timezone: 'Asia/Seoul', generatedAt, source: 'Open-Meteo (CC BY 4.0)', hours };
}

async function main() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(SEOUL.latitude));
  url.searchParams.set('longitude', String(SEOUL.longitude));
  url.searchParams.set('hourly', 'snowfall,weather_code');
  url.searchParams.set('timezone', 'Asia/Seoul');
  url.searchParams.set('forecast_days', '2');
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 1000) });
  if (!response.ok) throw new Error('Open-Meteo 요청 실패 (' + response.status + ')');
  const forecast = buildForecast(await response.json());
  const outputDirectory = process.env.WEATHER_EXPORT_DIR || path.resolve(__dirname, '..', 'static-data', 'weather');
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, 'seoul.json'), JSON.stringify(forecast));
  console.log('Weather forecast exported: ' + Object.keys(forecast.hours).length + ' snowy hour(s).');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Could not export weather forecast:', error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { snowLevel, buildForecast };
