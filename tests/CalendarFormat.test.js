const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. DM 회의 영역 문안(진행 중·종일·전날부터·응답 상태·빈 목록)과 본인 연결 방식 꺼짐 안내.
const kst = (date, _tz, pattern) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(x => [x.type, x.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g, k => p[{yyyy: 'year', MM: 'month', dd: 'day', HH: 'hour', mm: 'minute'}[k]]);
};
const ctx = vm.createContext({Utilities: {formatDate: kst}, BRIEFING: {timezone: 'Asia/Seoul'}, escapeSlack_: v => String(v)});
vm.runInContext(fs.readFileSync('src/central-bot/02_캘린더일정.js', 'utf8'), ctx);
const at = (d, hm) => Date.parse(d + 'T' + hm + ':00+09:00');
const snap = {day: '2026-10-23', tomorrowDay: '2026-10-24', now: at('2026-10-23', '11:00'),
  today: [
    {title: '전날부터 워크숍', start: at('2026-10-22', '15:00'), end: at('2026-10-23', '12:00'), allDay: false, status: ''},
    {title: '종일 교육', start: at('2026-10-23', '00:00'), end: at('2026-10-24', '00:00'), allDay: true, status: ''},
    {title: '스크럼', start: at('2026-10-23', '10:30'), end: at('2026-10-23', '11:30'), allDay: false, status: ''},
    {title: '리뷰\n회의', start: at('2026-10-23', '15:00'), end: at('2026-10-23', '16:00'), allDay: false, status: '응답 전'},
  ],
  tomorrow: [{title: '킥오프', start: at('2026-10-24', '10:00'), end: at('2026-10-24', '11:00'), allDay: false, status: '참석 미정'}]};
const morning = ctx.formatCalendarBriefing_(snap, false);
assert.match(morning, /• 진행 중 전날부터 워크숍/, 'started earlier and still running counts as ongoing today');
assert.match(morning, /• 종일 종일 교육/);
assert.match(morning, /• 진행 중 스크럼/);
assert.match(morning, /• 15:00 리뷰 회의 · 응답 전/, 'line breaks in titles are flattened');
assert.doesNotMatch(morning, /내일|킥오프/, 'morning shows today only');
const evening = ctx.formatCalendarBriefing_(snap, true);
assert.match(evening, /• 오늘 15:00 리뷰 회의 · 응답 전/);
assert.match(evening, /• 내일 10:00 킥오프 · 참석 미정/);
assert.match(ctx.formatCalendarBriefing_({...snap, today: [], tomorrow: []}, false), /^\n• 남은 회의 없음$/);
assert.match(ctx.formatCalendarBriefing_({...snap, today: [], tomorrow: []}, true), /오늘 남은 회의 없음\n• 내일 회의 없음$/);
assert.equal(ctx.calendarSectionTitle_(false), '\n\n📅 *오늘 회의*');
assert.equal(ctx.calendarSectionTitle_(true), '\n\n📅 *회의*');

// 회의 영역: 캘린더 꺼짐이면 비우고, 본인 연결 방식이 꺼져 있으면 그 사실만 알린다(예전 중앙 계정 조회 없음).
const props = v => ({getProperty: k => v[k] || null});
assert.equal(ctx.buildLiveCalendarSection_({}, props({}), '11:00', new Date()), '');
assert.match(ctx.buildLiveCalendarSection_({}, props({ENABLE_CALENDAR_BRIEFING: 'true'}), '11:00', new Date()), /연결 방식이 꺼져/);
ctx.selfCalendarSection_ = (_r, _p, slot) => 'SELF ' + slot;
assert.equal(ctx.buildLiveCalendarSection_({}, props({ENABLE_CALENDAR_BRIEFING: 'true', ENABLE_SELF_CALENDAR_PIPELINE: 'true'}), '17:00', new Date()), 'SELF 17:00');
console.log('Calendar section format checks passed');
