const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 연차 건너뛰기·직전 회차 누락 경고·금요일 피드백 집계·연차 PM 점심 메이트 제외를 확인한다.
const kst = (date, _tz, pattern) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(x => [x.type, x.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g, k => p[{yyyy: 'year', MM: 'month', dd: 'day', HH: 'hour', mm: 'minute'}[k]]);
};
const t = (day, hm) => Date.parse(day + 'T' + hm + ':00+09:00');
const DAY = '2026-10-30'; // 금요일

function fixture(options) {
  options = options || {};
  const values = new Map(Object.entries(Object.assign({ENABLE_SELF_CALENDAR_PIPELINE: 'true', ENABLE_LUNCH_MATE: 'true'}, options.props || {})));
  const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, String(v)),
    deleteProperty: k => values.delete(k), getProperties: () => Object.fromEntries(values)};
  const registry = [{pm: 'PM A', slackId: 'U00000001', email: 'a@example.test'}, {pm: 'PM B', slackId: 'U00000002', email: 'b@example.test'},
    {pm: 'PM C', slackId: 'U00000003', email: 'c@example.test'}];
  const state = (pm, id, events) => JSON.stringify({connected: true, pm, slackId: id, sentAt: t(DAY, '10:20'), events});
  const allDay = (title, extra) => Object.assign({key: title, title, start: t(DAY, '00:00'), end: t(DAY, '00:00') + 86400000,
    allDay: true, status: '', source: 'schedule', audience: 'personal'}, extra || {});
  const cache = options.cache || [
    ['a@example.test', state('PM A', 'U00000001', [allDay('PM A 연차')])],
    ['b@example.test', state('PM B', 'U00000002', [allDay('오전 반차'), allDay('PM C 휴가')])],
    ['c@example.test', state('PM C', 'U00000003', [allDay('휴가', {audience: 'common'})])]];
  const sheets = options.sheets || {};
  const bot = {getSheetByName: name => sheets[name] || null};
  const logs = [];
  const ctx = vm.createContext({
    console: {log: m => logs.push(m)}, BRIEFING: {timezone: 'Asia/Seoul'}, escapeSlack_: v => String(v),
    BOT_WORKBOOK: {usersTab: 'BOT_USERS', userHeaders: Array(3), logTab: 'BOT_SEND_LOG'},
    FEEDBACK: {tab: 'BOT_FEEDBACK', headers: Array(6)},
    PropertiesService: {getScriptProperties: () => props},
    Utilities: {formatDate: kst, newBlob: s => ({getBytes: () => Buffer.from(String(s))})},
    SpreadsheetApp: {openById: () => bot}, requiredProperty_: () => 'bot',
    requireBotSheet_: () => ({}), readBotRows_: () => [['PM A', 'U00000001', true]],
    findPilotRecipient_: r => ({id: r[0][1], enabled: true}), formatBriefingDay_: day => day.slice(5),
    readBbpmSnapshot_: () => ({meta: {newest: t(DAY, '16:50') / 1000}}),
    selfCalendarRegistry_: () => registry,
    selfCalendarStore_: () => ({getLastRow: () => cache.length + 1, getRange: () => ({getValues: () => cache})}),
    isBriefingWeekday_: date => ![0, 6].includes(new Date(Date.parse(kst(date, '', 'yyyy-MM-dd') + 'T00:00:00Z')).getUTCDay()),
  });
  for (const file of ['29_오후업데이트.js', '28_공휴일.js', '23_운영알림.js', '25_점심메이트.js'])
    vm.runInContext(fs.readFileSync('src/central-bot/' + file, 'utf8'), ctx);
  // 28번의 실제 휴일 캘린더 조회 대신 합성 휴일표를 쓴다.
  ctx.publicHolidayName_ = day => (options.holidays || {})[day] || '';
  return {ctx, props, values, logs};
}

// 1) 연차 판단: 본인 종일 "연차"만. 반차·남의 휴가(다른 PM 이름)·공통 일정은 근무일.
let f = fixture();
const routes = [{pm: 'PM A', id: 'U00000001'}, {pm: 'PM B', id: 'U00000002'}, {pm: 'PM C', id: 'U00000003'}];
const now = new Date(t(DAY, '10:30'));
assert.deepEqual(f.ctx.briefingLeaveRoutes_(routes, f.props, now).map(item => item.route.pm), ['PM A']);
// 09~18시를 다 덮지 않는 일정(오후만)은 연차로 보지 않는다.
f = fixture({cache: [['a@example.test', JSON.stringify({connected: true, pm: 'PM A', slackId: 'U00000001', sentAt: t(DAY, '10:20'),
  events: [{key: 'x', title: '연차', start: t(DAY, '13:00'), end: t(DAY, '18:00'), allDay: false, status: '', source: 'personal', audience: 'personal'}]})]]});
assert.equal(f.ctx.briefingLeaveRoutes_(routes, f.props, now).length, 0);
// 스위치를 끄면 아무도 건너뛰지 않는다. 연결 자료를 못 읽으면 모두 보낸다.
f = fixture({props: {ENABLE_PERSONAL_LEAVE_SKIP: 'false'}});
assert.equal(f.ctx.briefingLeaveRoutes_(routes, f.props, now).length, 0);
f = fixture();
f.ctx.selfCalendarStore_ = () => { throw new Error('CACHE_HEADER'); };
assert.equal(f.ctx.briefingLeaveRoutes_(routes, f.props, now).length, 0);
assert.ok(f.logs.some(line => /연차 확인 생략 · 모두 보냄/.test(line)));

// 2) 건너뛴 기록: 발송 로그(skipped-leave)와 관리자 요약의 연차 줄.
f = fixture();
const appended = [];
f.ctx.noteBriefingLeave_(f.props, {appendRow: row => appended.push(row)}, '11:00', f.ctx.briefingLeaveRoutes_(routes, f.props, now));
assert.equal(appended[0][1], 'scheduled-11:00');
assert.equal(appended[0][4], 'skipped-leave');
// 기록 날짜는 실제 오늘이라, 요약 기준일(DAY)에 맞춰 옮긴 뒤 확인한다.
const saved = JSON.parse(f.values.get('LEAVE_SKIPS'));
assert.deepEqual(saved.items, ['PM A']);
f.values.set('LEAVE_SKIPS', JSON.stringify(Object.assign(saved, {day: DAY})));
const summary = f.ctx.buildAdminRoundSummary_(f.props, '11:00', {state: 'complete', total: 3, pendingIds: [], failedIds: [], failed: 0}, now);
assert.match(summary.text, /• 발송 2\/3명 완료 · 연차 1명 건너뜀/);
assert.match(summary.text, /• 연차: PM A/);

// 3) 점심 메이트: 연차인 PM은 짝에서 빠진다(점심 메이트는 실제 오늘 기준이라 오늘 날짜 연차로 만든다).
const today = kst(new Date(), '', 'yyyy-MM-dd');
f = fixture({props: {LUNCH_MATE_U00000001: 'on', LUNCH_MATE_U00000002: 'on'}, cache: [['a@example.test', JSON.stringify({connected: true,
  pm: 'PM A', slackId: 'U00000001', sentAt: t(today, '09:00'), events: [{key: 'l', title: '연차', start: t(today, '00:00'),
    end: t(today, '00:00') + 86400000, allDay: true, status: '', source: 'personal', audience: 'personal'}]})]]});
assert.deepEqual(f.ctx.lunchMateParticipants_(f.props, [['PM A', 'U00000001', true], ['PM B', 'U00000002', true]]).map(p => p.pm), ['PM B']);

// 4) 직전 회차: 14:00→같은 날 10:30, 17:00→같은 날 14:00, 10:30→직전 근무일 17:00(주말·공휴일 건너뜀).
f = fixture({holidays: {'2026-11-02': '임시 공휴일'}});
assert.deepEqual({...f.ctx.adminPreviousRound_(f.props, '14:00', DAY)}, {day: DAY, slot: '11:00'});
assert.deepEqual({...f.ctx.adminPreviousRound_(f.props, '17:00', DAY)}, {day: DAY, slot: '14:00'});
assert.deepEqual({...f.ctx.adminPreviousRound_(f.props, '11:00', '2026-11-03')}, {day: DAY, slot: '17:00'});
f.values.set('COMPANY_HOLIDAYS', '2026-10-30');
assert.deepEqual({...f.ctx.adminPreviousRound_(f.props, '11:00', '2026-11-03')}, {day: '2026-10-29', slot: '17:00'});
f.ctx.publicHolidayName_ = () => { throw new Error('calendar'); };
assert.equal(f.ctx.adminPreviousRound_(f.props, '11:00', '2026-11-03'), null, 'holiday lookup failure → no warning');

// 5) 관리자 요약: 직전 회차 기록이 없으면 경고, 있으면(연차 건너뜀 포함) 경고 없음.
const logSheet = rows => ({getLastRow: () => rows.length + 1, getRange: () => ({getValues: () => rows})});
f = fixture({sheets: {BOT_SEND_LOG: logSheet([[new Date(t(DAY, '10:31')), 'scheduled-11:00']])}});
const at14 = new Date(t(DAY, '14:05'));
assert.doesNotMatch(f.ctx.buildAdminRoundSummary_(f.props, '14:00', {state: 'complete', total: 1, pendingIds: [], failedIds: [], failed: 0}, at14).text, /직전 회차/);
const missed = f.ctx.buildAdminRoundSummary_(f.props, '17:00', {state: 'complete', total: 1, pendingIds: [], failedIds: [], failed: 0}, new Date(t(DAY, '17:05')));
assert.match(missed.text, /• ⚠️ 직전 회차\(14:00 오후\) 발송 기록 없음/);
assert.match(missed.text, /installBriefingTriggers/);

// 6) 금요일 17:00: 이번 주 피드백 집계(지난주 기록 제외, 날짜 칸이 날짜형이어도 읽음). 금요일이 아니면 넣지 않는다.
const feedback = [
  [new Date(), 'U00000001', 'a', '2026-10-26', '10:30 오전', '👍'],
  [new Date(), 'U00000002', 'b', new Date(t('2026-10-29', '12:00')), '14:00 오후', '👎'],
  [new Date(), 'U00000001', 'a', '2026-10-30', '10:30 오전', '👍'],
  [new Date(), 'U00000003', 'c', '2026-10-23', '17:00 마무리', '👎']];
f = fixture({sheets: {BOT_FEEDBACK: logSheet(feedback), BOT_SEND_LOG: logSheet([[new Date(t(DAY, '14:01')), 'scheduled-14:00']])}});
const friday = f.ctx.buildAdminRoundSummary_(f.props, '17:00', {state: 'complete', total: 1, pendingIds: [], failedIds: [], failed: 0}, new Date(t(DAY, '17:05')));
assert.match(friday.text, /• 이번 주 피드백 👍 2 · 👎 1 \(2명\)/);
assert.doesNotMatch(friday.text, /직전 회차/);
assert.equal(f.ctx.adminWeeklyFeedbackLine_({getSheetByName: () => null}, DAY), '• 이번 주 피드백 없음');
const thursday = f.ctx.buildAdminRoundSummary_(f.props, '17:00', {state: 'complete', total: 1, pendingIds: [], failedIds: [], failed: 0}, new Date(t('2026-10-29', '17:05')));
assert.doesNotMatch(thursday.text, /피드백/);

console.log('Personal leave skip, missed-round warning and weekly feedback checks passed');
