const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용한다. W7(체크박스 명단·연결 링크)·W8(회의 섹션 모양) 확인.
const kst = (d, _t, f) => {
  const s = new Date(d.getTime() + 9 * 3600000).toISOString();
  return {'yyyy-MM-dd': s.slice(0, 10), 'HH:mm': s.slice(11, 16), 'HH': s.slice(11, 13), 'MM/dd HH:mm': s.slice(5, 7) + '/' + s.slice(8, 10) + ' ' + s.slice(11, 16)}[f] || s;
};
function makeSheet(data) {
  return {
    data, validations: [],
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(...data.map(r => r.length)),
    getRange: (row, col, height = 1, width = 1) => ({
      getValue: () => (data[row - 1] || [])[col - 1] ?? '',
      getValues: () => data.slice(row - 1, row - 1 + height).map(r => Array.from({length: width}, (_, i) => r[col - 1 + i] ?? '')),
      setValue: value => { data[row - 1][col - 1] = value; },
      setValues: values => values.forEach((v, i) => v.forEach((cell, j) => { data[row - 1 + i][col - 1 + j] = cell; })),
      setDataValidation: rule => { data.validated = (data.validated || 0) + height; },
    }),
  };
}
const url = 'https://script.google.com/a/macros/example.test/s/AKfyc_test-123/exec';
const props = {BOT_SPREADSHEET_ID: 'bot', CALENDAR_CONNECT_URL: url};
let users, cache;
const load = () => {
  const ctx = vm.createContext({
    console: {log: () => {}}, BRIEFING: {timezone: 'Asia/Seoul'},
    Utilities: {formatDate: kst}, escapeSlack_: v => String(v),
    BOT_WORKBOOK: {usersTab: 'BOT_USERS', logTab: 'BOT_SEND_LOG'},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] || null})},
    requiredProperty_: (p, k) => { const v = p.getProperty(k); if (!v) throw new Error('missing ' + k); return v; },
    SpreadsheetApp: {openById: () => ({getSheetByName: name => name === 'BOT_USERS' ? users : name === 'BOT_CALENDAR_PERSONAL' ? cache : null}),
      newDataValidation: () => ({requireCheckbox: () => ({build: () => 'checkbox'})})},
  });
  for (const f of ['02_캘린더일정.js', '19_개인캘린더연결.js', '21_캘린더연결초대.js']) {
    vm.runInContext(fs.readFileSync('src/central-bot/' + f, 'utf8'), ctx, {filename: f});
  }
  return ctx;
};

// W8: 회의 섹션 — 제목 아래·경고 앞에 빈 줄이 없고, 제목은 기존 경로와 같다.
let ctx = load();
const day = '2026-10-22', at = hm => Date.parse(day + 'T' + hm + ':00+09:00');
const snap = {day, now: at('10:58'), tomorrowDay: '2026-10-23',
  today: [{key: '1', title: 'Scrum', start: at('16:00'), end: at('16:30'), allDay: false, status: '응답 전', source: 'personal', audience: 'personal'},
    {key: 'h', title: '임시공휴일', start: at('00:00'), end: at('23:59'), allDay: true, status: '', source: 'holidays', audience: 'personal'}],
  tomorrow: []};
const state = {sources: [{key: 'personal', status: 'ok'}, {key: 'schedule', status: 'ok'}, {key: 'review', status: 'unavailable'}, {key: 'holidays', status: 'ok'}]};
const morning = ctx.selfCalendarFormatSources_(state, snap, false);
assert.equal(morning, '\n\n📅 *오늘 회의*\n• 16:00 Scrum · 응답 전\n*휴일*\n• 종일 임시공휴일\n⚠️ 조회 확인 필요: PM Review & Delivery — 구독·읽기 권한/연결 설정 확인');
assert.doesNotMatch(morning.slice(2), /\n\n/, 'one block without blank lines');
assert.match(ctx.selfCalendarFormatSources_(state, snap, true), /^\n\n📅 \*회의\*\n• 오늘 /);
// 팀 공통 일정(다른 사람 휴가·팀 공통 검수 등)은 예전 캐시에 남아 있어도 DM 회의 목록에 넣지 않는다.
const withCommon = {...snap, today: snap.today.concat([{key: 'c', title: '타인 휴가', start: at('09:00'), end: at('18:00'), allDay: false, status: '', source: 'schedule', audience: 'common'}])};
assert.doesNotMatch(ctx.selfCalendarFormatSources_(state, withCommon, false), /타인 휴가/);

// W7: 체크박스 명단 — E열 calendar_connect에 체크된 행만 등록 명단. 예전 JSON 속성은 무시.
users = makeSheet([
  ['pm_name', 'slack_user_id', 'send_enabled', 'email', 'calendar_connect'],
  ['PM A', 'U00000001', true, 'a@example.test', true],
  ['PM B', 'U00000002', false, 'b@example.test', false],
  ['PM C', 'U00000003', false, 'c@example.test', true],
]);
props.SELF_CALENDAR_ALLOWED_EMAILS = JSON.stringify(['b@example.test']);
ctx = load();
assert.equal(JSON.stringify(ctx.selfCalendarRegistry_(ctx.PropertiesService.getScriptProperties()).map(r => r.pm)), '["PM A","PM C"]');
assert.equal(ctx.selfCalendarRosterConfigured_(ctx.PropertiesService.getScriptProperties()), true);

// 체크됐지만 아직 연결 기록이 없으면 연결 링크를 붙인다. 체크 안 된 사람은 링크 없이 미연결.
cache = makeSheet([['email', 'state_json']]);
const propsApi = ctx.PropertiesService.getScriptProperties();
const now = new Date(at('10:58'));
assert.equal(ctx.selfCalendarSection_({pm: 'PM C', id: 'U00000003'}, propsApi, '11:00', now),
  '\n\n📅 *오늘 회의*\n• 개인 캘린더 미연결 · <' + url + '|연결하기>\n' + vm.runInContext('CALENDAR_LINK_TIP', ctx));
assert.match(vm.runInContext('CALENDAR_LINK_TIP', ctx), /시크릿 창/);
assert.equal(ctx.selfCalendarSection_({pm: 'PM B', id: 'U00000002'}, propsApi, '17:00', now), '\n\n📅 *회의*\n• 개인 캘린더 미연결');
cache.data.push(['c@example.test', JSON.stringify({pm: 'PM C', slackId: 'U00000003', connected: false, sentAt: at('10:00')})]);
assert.match(ctx.selfCalendarSection_({pm: 'PM C', id: 'U00000003'}, propsApi, '11:00', now), /연결 해제 상태 · <.*\|연결하기>\n_링크가/);
cache.data[1][1] = JSON.stringify({pm: 'PM C', slackId: 'U00000003', connected: true, sentAt: at('09:00'), events: []});
assert.match(ctx.selfCalendarSection_({pm: 'PM C', id: 'U00000003'}, propsApi, '11:00', now),
  /^\n\n📅 \*오늘 회의\*\n• 회의 갱신 지연 · 마지막 확인 10\/22 09:00\n• .*\|내 일정 갱신>\n_링크가 .*시크릿 창.*_$/, 'stale state keeps the meeting title and refresh link');
// 아침 시험(18:54 실행)은 11:00 기준으로 회의를 보여 준다. 갱신 지연 판단은 실제 시각 기준.
cache.data[1][1] = JSON.stringify({pm: 'PM C', slackId: 'U00000003', connected: true, sentAt: at('18:50'), sources: state.sources.map(s => ({...s, status: 'ok'})),
  events: [{key: 'm', title: 'Scrum', start: at('16:00'), end: at('16:30'), allDay: false, status: '', source: 'personal', audience: 'personal'}]});
const evening = new Date(at('18:54'));
assert.match(ctx.selfCalendarSection_({pm: 'PM C', id: 'U00000003'}, propsApi, '11:00', evening), /남은 회의 없음/);
assert.equal(ctx.selfCalendarSection_({pm: 'PM C', id: 'U00000003'}, propsApi, '11:00', evening, new Date(at('11:00'))),
  '\n\n📅 *오늘 회의*\n• 16:00 Scrum', 'morning test shows meetings from 11:00');
props.CALENDAR_CONNECT_URL = 'https://script.google.com/home/projects/edit';
assert.equal(ctx.calendarConnectLink_(propsApi, '연결하기'), '', 'editor or arbitrary URLs are never linked');
props.CALENDAR_CONNECT_URL = url;

const crypto = require('node:crypto');
Object.assign(props, {CALENDAR_ONBOARDING_READY: 'true', ENABLE_PM_SEND: 'true', ENABLE_CONNECTED_PM_SEND: 'true',
  ENABLE_SELF_CALENDAR_PIPELINE: 'true', ENABLE_CALENDAR_BRIEFING: 'true', ENABLE_CALENDAR_SELF_ENROLLMENT: 'true',
  CONNECTOR_SIGNING_KEY: 'k'.repeat(43), CALENDAR_INVITE_PM_NAMES: JSON.stringify(['PM B'])});
ctx.ScriptApp = {getProjectTriggers: () => ['sendScheduledBriefing11', 'sendScheduledBriefing17'].map(h => ({getHandlerFunction: () => h}))};
ctx.Utilities = {formatDate: kst, DigestAlgorithm: {SHA_256: 's'}, computeDigest: (_a, t) => [...crypto.createHash('sha256').update(t).digest()],
  base64EncodeWebSafe: b => Buffer.from(b).toString('base64url')};
let invite = ctx.calendarInviteSetup_(propsApi);
assert.equal(JSON.stringify(invite.routes.map(r => r.pm)), '["PM A","PM C"]', 'checked people, not the old name list');
props[ctx.calendarInviteKey_(invite.routes[0])] = JSON.stringify({status: 'sent'});
props[ctx.calendarInviteKey_(invite.routes[1])] = JSON.stringify({status: 'rejected'});
invite = ctx.calendarInviteSetup_(propsApi);
assert.equal(JSON.stringify(invite.routes.map(r => r.pm)), '["PM C"]', 'already invited people are skipped; rejected ones retried');
props[ctx.calendarInviteKey_(invite.routes[0])] = JSON.stringify({status: 'connected'});
assert.throws(() => ctx.calendarInviteSetup_(propsApi), /새로 초대할 대상이 없습니다/);

// 열이 없으면 예전 이메일 JSON 속성을 그대로 쓴다.
users = makeSheet([
  ['pm_name', 'slack_user_id', 'send_enabled', 'email'],
  ['PM A', 'U00000001', true, 'a@example.test'],
  ['PM B', 'U00000002', false, 'b@example.test'],
]);
ctx = load();
assert.equal(JSON.stringify(ctx.selfCalendarRegistry_(ctx.PropertiesService.getScriptProperties()).map(r => r.pm)), '["PM B"]');

// 준비 함수: 열 제목·체크박스를 만들고, 예전 명단에 있던 사람을 미리 체크한다. E1에 다른 값이 있으면 중지.
ctx.setupCalendarConnectColumn();
assert.equal(users.data[0][4], 'calendar_connect');
assert.equal(JSON.stringify(users.data.slice(1).map(r => r[4])), '[false,true]');
assert.equal(users.data.validated, 2);
users = makeSheet([['pm_name', 'slack_user_id', 'send_enabled', 'email', 'memo'], ['PM A', 'U00000001', true, 'a@example.test', 'x']]);
ctx = load();
assert.throws(() => ctx.setupCalendarConnectColumn(), /E1에 다른 값/);
assert.equal(users.data[1][4], 'x', 'no change when E1 is occupied');
console.log('Connection simplification and meeting section layout checks passed');
