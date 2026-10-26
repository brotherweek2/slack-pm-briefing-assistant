const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 주말·공휴일(설명 '공휴일')·기념일(근무)·회사 휴무일·캘린더 실패(보냄)·하루 1회 조회.
const kst = (date, _tz, p) => {
  const x = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(date).map(v => [v.type, v.value]));
  return p.replace('yyyy', x.year).replace('MM', x.month).replace('dd', x.day);
};
const values = new Map();
const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, v)};
let reads = 0, failing = false;
const events = {
  '2026-10-09': [{allDay: true, title: '한글날', desc: '공휴일'}],
  '2026-05-08': [{allDay: true, title: '어버이날', desc: '기념일'}],
  '2026-12-25': [{allDay: true, title: 'Christmas Day', desc: 'Public holiday'}],
};
const ctx = vm.createContext({console: {log: () => {}}, BRIEFING: {timezone: 'Asia/Seoul'}, Utilities: {formatDate: kst},
  PropertiesService: {getScriptProperties: () => props},
  CalendarApp: {getCalendarById: () => { if (failing) throw new Error('no access'); return {getEventsForDay: d => { reads++;
    return (events[kst(d, '', 'yyyy-MM-dd')] || []).map(e => ({isAllDayEvent: () => e.allDay, getTitle: () => e.title, getDescription: () => e.desc})); }}; }}});
for (const f of ['09_자동실행.js', '28_공휴일.js', '29_오후업데이트.js']) vm.runInContext(fs.readFileSync('src/central-bot/' + f, 'utf8'), ctx);
const at = d => new Date(d + 'T10:30:00+09:00');
assert.equal(ctx.briefingDayOff_(at('2026-10-24')), '주말');
assert.equal(ctx.briefingDayOff_(at('2026-10-09')), '공휴일 · 한글날');
assert.equal(ctx.briefingDayOff_(at('2026-05-08')), '', 'observances are workdays');
assert.equal(ctx.briefingDayOff_(at('2026-12-25')), '공휴일 · Christmas Day');
reads = 0; ctx.briefingDayOff_(at('2026-12-25')); ctx.briefingDayOff_(at('2026-12-25'));
assert.equal(reads, 0, 'cached for the day');
values.set('COMPANY_HOLIDAYS', '2026-12-31, 2027-01-04');
assert.equal(ctx.briefingDayOff_(at('2026-12-31')), '회사 휴무일');
failing = true;
assert.equal(ctx.briefingDayOff_(at('2026-11-02')), '', 'calendar failure → treat as workday and send');
// 정기 발송 진입점은 쉬는 날 아무것도 하지 않는다.
let started = 0;
ctx.startConnectedBriefingRound_ = () => started++; ctx.sendPmBriefings_ = () => started++; ctx.notifyAdminRoundSummary_ = () => {};
ctx.Date = class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-10-09T10:30:00+09:00'])); } static now() { return Date.parse('2026-10-09T10:30:00+09:00'); } };
failing = false; values.delete('BRIEFING_DAY_OFF');
vm.runInContext('sendScheduledBriefing_("11:00")', ctx);
assert.equal(started, 0, 'no round on a public holiday');
console.log('Day-off (weekend, public holiday, company holiday) checks passed');
