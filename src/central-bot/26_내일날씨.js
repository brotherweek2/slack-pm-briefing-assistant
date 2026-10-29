/**
 * 26. 내일날씨 — 17:00 내일 날씨 한 줄
 *
 * 알아둘 것
 * - ENABLE_WEATHER=true일 때만(기본 꺼짐). Open-Meteo 무료 API(비상업 조건 확인 후 사용).
 * - 위치는 WEATHER_LAT·WEATHER_LON·WEATHER_PLACE(없으면 서울).
 *
 * 내부 함수 (직접 실행하지 않음)
 * - weatherCodeLabel_(code): WMO 날씨 코드 → 이모지·한국어
 * - formatTomorrowWeather_(props, day, slot): 17:00 DM의 내일 날씨 한 줄(하루 1번 조회, 실패하면 생략)
 * - formatEveningNotes_(props, day, slot): 17:00 끝부분: 내일 날씨와 주말 인사를 구분선 없이 한 영역으로 묶는다(둘 다 없으면 빈 문자열)
 */
const WEATHER = Object.freeze({cacheKey:'WEATHER_TOMORROW', lat:37.5665, lon:126.9780, place:'서울'});

function weatherCodeLabel_(code) {
  const c = Number(code);
  if (c === 0) return '☀️ 맑음';
  if (c <= 2) return '🌤️ 구름 조금';
  if (c === 3) return '☁️ 흐림';
  if (c === 45 || c === 48) return '🌫️ 안개';
  if ((c >= 51 && c <= 57)) return '🌦️ 이슬비';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return '🌧️ 비';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return '🌨️ 눈';
  if (c >= 95) return '⛈️ 뇌우';
  return '🌡️ 날씨';
}

function formatTomorrowWeather_(props, day, slot) {
  if (slot !== '17:00' || props.getProperty('ENABLE_WEATHER') !== 'true') return '';
  try {
    let cached = null;
    try { cached = JSON.parse(props.getProperty(WEATHER.cacheKey) || 'null'); } catch (_) {}
    if (!cached || cached.day !== day) {
      const lat = Number(props.getProperty('WEATHER_LAT') || WEATHER.lat), lon = Number(props.getProperty('WEATHER_LON') || WEATHER.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=2';
      const response = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
      if (response.getResponseCode() !== 200) return '';
      const daily = JSON.parse(response.getContentText()).daily || {};
      const i = (daily.time || []).indexOf(addDaysToIsoDate_(day, 1));
      if (i < 0) return '';
      cached = {day, code:daily.weather_code[i], max:Math.round(daily.temperature_2m_max[i]), min:Math.round(daily.temperature_2m_min[i]),
        rain:daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null};
      try { props.setProperty(WEATHER.cacheKey, JSON.stringify(cached)); } catch (_) {}
    }
    const place = String(props.getProperty('WEATHER_PLACE') || WEATHER.place).slice(0, 20);
    return '\n\n*내일 날씨* · ' + escapeSlack_(place) + ' ' + weatherCodeLabel_(cached.code) + ' · ' + cached.min + '~' + cached.max + '°C' +
      (Number.isFinite(cached.rain) ? ' · 강수 ' + cached.rain + '%' + (cached.rain >= 60 ? ' ☔ 우산 챙기세요' : '') : '');
  } catch (error) {
    console.log('날씨 생략 | ' + error.message);
    return '';
  }
}

// 17:00 끝부분: 내일 날씨와 주말 인사를 구분선 없이 한 영역으로 묶는다(둘 다 없으면 빈 문자열).
function formatEveningNotes_(props, day, slot) {
  const parts = [formatTomorrowWeather_(props, day, slot), formatWeekendCountdown_(day, slot)]
    .map(text => text.replace(/^\n+/, '')).filter(Boolean);
  return parts.length ? '\n\n' + parts.join('\n') : '';
}
