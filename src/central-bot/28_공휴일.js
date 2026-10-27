/**
 * 28. 공휴일 — 정기 DM과 Slack 미리 수집을 쉬는 날(주말·공휴일·회사 휴무일)에 건너뛴다.
 * - briefingDayOff_(now): 쉬는 날이면 이유('주말' / '공휴일 · 이름' / '회사 휴무일'), 근무일이면 빈 문자열.
 *   공휴일은 Google "대한민국의 휴일" 캘린더에서 설명이 '공휴일'(영문 'Public holiday')인 종일 일정만 본다(어버이날 같은 기념일은 근무일).
 *   회사 휴무일은 스크립트 속성 COMPANY_HOLIDAYS(예: 2026-12-31,2027-01-02)에 적는다(BOT_SETTINGS로 반영 가능).
 *   하루 한 번만 캘린더를 읽고 속성에 저장해 둔다. 캘린더를 못 읽으면 근무일로 보고 보낸다(놓친 DM보다 한 통 더 가는 쪽이 안전).
 * - previewBriefingDayOff(): [직접 실행] 오늘과 앞으로 30일 안의 쉬는 날을 로그로 본다. 변경 없음.
 * - briefingLeaveRoutes_(routes, props, now): 오늘 연차인 PM 목록. 개인 캘린더 연결 자료에서 09~18시를 모두 덮는
 *   본인 일정 중 제목이 연차·휴가인 것만 본다(반차·반반차는 근무일). 다른 PM 이름이 든 제목(남의 휴가)은 제외.
 *   연결 자료가 없거나 읽기 실패면 보낸다. ENABLE_PERSONAL_LEAVE_SKIP=false면 끈다.
 * - noteBriefingLeave_(props, log, slot, items): 건너뛴 PM을 발송 기록(skipped-leave)과 관리자 요약용 속성에 남긴다.
 */
const DAY_OFF = Object.freeze({calendarId:'ko.south_korea#holiday@group.v.calendar.google.com', cacheKey:'BRIEFING_DAY_OFF'});

function briefingDayOff_(now) {
  if (!isBriefingWeekday_(now)) return '주말';
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  const extra = String(props.getProperty('COMPANY_HOLIDAYS') || '').split(/[,\s]+/).filter(Boolean);
  if (extra.includes(day)) return '회사 휴무일';
  let cached = null;
  try { cached = JSON.parse(props.getProperty(DAY_OFF.cacheKey) || 'null'); } catch (_) {}
  if (cached && cached.day === day) return cached.off || '';
  let off = '';
  try {
    const name = publicHolidayName_(day);
    off = name ? '공휴일 · ' + name : '';
    try { props.setProperty(DAY_OFF.cacheKey, JSON.stringify({day, off})); } catch (_) {}
  } catch (error) {
    console.log('공휴일 확인 실패 · 근무일로 보고 진행 | ' + error.message);
  }
  return off;
}

const PERSONAL_LEAVE = Object.freeze({skipsKey:'LEAVE_SKIPS',
  title:/연차|휴가|월차|병가|경조|리프레시|day\s*off|\bPTO\b|vacation|annual\s*leave|\bOOO\b|out\s*of\s*office/i,
  partial:/반차|반반차|반휴|반일|half/i});

function briefingLeaveRoutes_(routes, props, now) {
  if (!routes.length || props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') !== 'true' ||
      props.getProperty('ENABLE_PERSONAL_LEAVE_SKIP') === 'false') return [];
  try {
    const registry = selfCalendarRegistry_(props);
    const sheet = selfCalendarStore_(props, false);
    const cached = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
    return routes.map(route => ({route, title:personalLeaveTitle_(route, registry, cached, now)})).filter(item => item.title);
  } catch (error) { console.log('연차 확인 생략 · 모두 보냄 | ' + error.message); return []; }
}

function personalLeaveTitle_(route, registry, cached, now) {
  const registered = registry.find(row => row.pm === route.pm && row.slackId === route.id);
  if (!registered) return '';
  const match = cached.filter(row => row[0] === registered.email);
  let state = null; try { state = match.length === 1 ? JSON.parse(match[0][1]) : null; } catch (_) {}
  if (!state || !state.connected || state.pm !== route.pm || state.slackId !== route.id || !Array.isArray(state.events)) return '';
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const from = Date.parse(day + 'T09:00:00+09:00'), to = Date.parse(day + 'T18:00:00+09:00');
  const others = registry.map(row => row.pm).filter(pm => pm && pm !== route.pm);
  const hit = state.events.find(event => {
    const title = String(event && event.title || '');
    return event.audience !== 'common' && event.source !== 'holidays' && event.start <= from && event.end >= to &&
      PERSONAL_LEAVE.title.test(title) && !PERSONAL_LEAVE.partial.test(title) && !others.some(pm => title.includes(pm));
  });
  return hit ? String(hit.title).slice(0, 40) : '';
}

function noteBriefingLeave_(props, log, slot, items) {
  const now = new Date(), day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  items.forEach(item => {
    log.appendRow([now, 'scheduled-' + slot, item.route.pm, '', 'skipped-leave']);
    console.log(item.route.pm + ' | 연차로 ' + briefingSlotLabel_(slot) + ' 건너뜀 · ' + item.title + ' | Slack 발송 없음');
  });
  try {
    let saved = null; try { saved = JSON.parse(props.getProperty(PERSONAL_LEAVE.skipsKey) || 'null'); } catch (_) {}
    const names = saved && saved.day === day && saved.slot === slot ? saved.items : [];
    props.setProperty(PERSONAL_LEAVE.skipsKey, JSON.stringify({day, slot,
      items:[...new Set(names.concat(items.map(item => item.route.pm)))].slice(0, 20)}));
  } catch (_) {}
}

// 해당 날짜가 공휴일이면 이름, 아니면 빈 문자열. 캘린더 접근 실패는 호출부가 처리한다.
function publicHolidayName_(day) {
  const calendar = CalendarApp.getCalendarById(DAY_OFF.calendarId);
  if (!calendar) throw new Error('대한민국의 휴일 캘린더를 읽을 수 없습니다');
  const date = new Date(day + 'T12:00:00+09:00');
  const hit = calendar.getEventsForDay(date).find(event => event.isAllDayEvent() &&
    /공휴일|public holiday/i.test(String(event.getDescription() || '')));
  return hit ? String(hit.getTitle() || '공휴일') : '';
}

function previewBriefingDayOff() {
  const start = new Date();
  const lines = [];
  for (let i = 0; i <= 30; i++) {
    const date = new Date(start.getTime() + i * 86400000);
    const day = Utilities.formatDate(date, BRIEFING.timezone, 'yyyy-MM-dd');
    if (!isBriefingWeekday_(date)) continue;
    const extra = String(PropertiesService.getScriptProperties().getProperty('COMPANY_HOLIDAYS') || '').split(/[,\s]+/);
    let name = '';
    try { name = publicHolidayName_(day); } catch (error) { lines.push(day + ' 확인 실패: ' + error.message); continue; }
    if (name) lines.push(formatBriefingDay_(day) + ' 공휴일 · ' + name);
    else if (extra.includes(day)) lines.push(formatBriefingDay_(day) + ' 회사 휴무일');
  }
  console.log('앞으로 30일 안의 평일 쉬는 날(정기 DM·수집 건너뜀):\n' + (lines.length ? lines.join('\n') : '없음'));
  console.log('조회만 | 변경 없음');
}
