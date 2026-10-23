const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용한다. 실제 이름·ID·이메일 없음.
const logs = [];
const apiCalls = [];
const props = {
  SLACK_BOT_TOKEN: 'xoxb-test-only', SLACK_PM_GROUP_ID: 'S00000001', BOT_SPREADSHEET_ID: 'bot',
  PM_CALENDAR_ROUTES: 'set',
};
let scopes = 'chat:write,usergroups:read,users:read,users:read.email,channels:history';
const users = {
  U00000001: {real_name: '김가나', profile: {real_name_normalized: '김가나 (BB)', email: 'gana.kim@example.test'}},
  U00000002: {real_name: '이다라', profile: {real_name_normalized: '이다라', email: 'dara.lee@example.test'}},
  U00000003: {real_name: '박마바', profile: {real_name_normalized: '박마바/PM', email: 'maba.park@example.test'}},
  U00000004: {real_name: '퇴사자', deleted: true, profile: {email: 'gone@example.test'}},
  U00000005: {real_name: 'bot', is_bot: true, profile: {}},
};
const ctx = vm.createContext({
  console: {log: line => logs.push(String(line))},
  PropertiesService: {getScriptProperties: () => ({getProperty: key => props[key] || null})},
  requiredProperty_: (p, key) => { const value = p.getProperty(key); if (!value) throw new Error('missing ' + key); return value; },
  UrlFetchApp: {fetch: url => {
    assert.equal(url, 'https://slack.com/api/auth.test', 'only auth.test is fetched directly');
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify({ok: true}),
      getAllHeaders: () => ({'X-OAuth-Scopes': scopes})};
  }},
  slackMentionReadApi_: (method, params, _token, budget) => {
    budget.calls++; apiCalls.push(method);
    if (method === 'usergroups.users.list') return {users: Object.keys(users)};
    if (method === 'users.info') return {user: Object.assign({id: params.user}, users[params.user])};
    throw new Error('unexpected ' + method);
  },
  SpreadsheetApp: {openById: () => ({})},
  BOT_WORKBOOK: {usersTab: 'BOT_USERS', tasksTab: 'BOT_TASKS', userHeaders: Array(3), taskHeaders: Array(18)},
  requireBotSheet_: (_bot, name) => ({name}),
  readBotRows_: sheet => sheet.name === 'BOT_USERS'
    ? [['김가나', 'U00000001', true], ['이다라', 'U00000002', false], ['예전이름', 'U00000003', false]]
    : [['T1', '김가나'], ['T2', '이다라'], ['T3', '최사아']].map(([key, owner]) => Object.assign(Array(18).fill(''), {0: key, 1: owner})),
  readPmCalendarRoutes_: () => [
    {pm: '김가나', email: 'gana.kim@example.test', slackId: 'U00000001', calendarId: ''},
    {pm: '이다라', email: 'old.lee@example.test', slackId: 'U00000002', calendarId: ''},
  ],
  CalendarApp: {getCalendarById: id => id === 'gana.kim@example.test' ? {} : null},
  maskPilotId_: id => id.slice(0, 2) + '…' + id.slice(-3),
  maskCalendarAccount_: email => String(email).replace(/^(.)([^@]*)(@.*)$/, '$1***$3'),
});
vm.runInContext(fs.readFileSync('src/central-bot/18_명단동기화.js', 'utf8'), ctx);

assert.equal(ctx.normalizeRosterName_('김가나 (BB)'), '김가나');
assert.equal(ctx.normalizeRosterName_('박마바/PM'), '박마바');
assert.equal(ctx.normalizeRosterName_(' 이 다라 '), '이다라');

ctx.previewRosterFromSlack();
const text = logs.join('\n');
assert.match(text, /명단 동기화에 필요한 권한 모두 있음/);
assert.match(text, /활성 구성원 3명/, 'deleted users and bots are excluded');
assert.match(text, /• 김가나 \| Slack U0…001 \| g\*\*\*@example\.test \| BOT_USERS 이름 일치 · 업무 시트 담당자 매칭\(김가나\)$/m);
assert.doesNotMatch(text, /캘린더 연결 이메일|캘린더 접근/, 'legacy central-calendar checks removed');
assert.match(text, /• 박마바 .*BOT_USERS 이름 다름\(예전이름\)/);
assert.match(text, /이메일 자동 확인 3\/3명/);
assert.match(text, /이름 일치 2 · 이름 다름 1 · 미등록 0/);
assert.match(text, /업무 시트 담당자 3명 중 Slack 구성원과 매칭 2명 · 매칭 안 됨: 최사아/);
assert.doesNotMatch(text, /캘린더 접근 가능/);
assert.doesNotMatch(text, /gana\.kim@|dara\.lee@|maba\.park@|xoxb-/, 'full emails and tokens never reach the log');
assert.deepEqual(apiCalls.filter(method => method === 'users.info').length, 5);

// 권한이 아직 없으면 그룹·사용자 조회 없이 멈춘다.
logs.length = 0; apiCalls.length = 0;
scopes = 'chat:write,usergroups:read';
ctx.previewRosterFromSlack();
assert.match(logs.join('\n'), /없음: users:read, users:read\.email/);
assert.match(logs.join('\n'), /Reinstall이 필요합니다/);
assert.equal(apiCalls.length, 0);
console.log('Roster sync proof checks passed');
