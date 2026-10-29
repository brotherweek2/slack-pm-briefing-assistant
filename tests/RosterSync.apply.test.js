const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용한다. 실제 이름·ID·이메일 없음.
function makeSheet(data) {
  return {
    data,
    getLastRow: () => data.length,
    getRange: (row, col, height, width) => ({
      getValue: () => (data[row - 1] || [])[col - 1] ?? '',
      setValue: value => { while (data.length < row) data.push(['', '', '', '']); data[row - 1][col - 1] = value; },
      getValues: () => data.slice(row - 1, row - 1 + (height || 1)).map(r => r.slice(col - 1, col - 1 + (width || 1))
        .concat(Array(Math.max(0, (width || 1) - r.slice(col - 1).length)).fill(''))),
      setValues: values => values.forEach((value, i) => { data[row - 1 + i] = value.slice(); }),
    }),
  };
}
const members = {
  U00000001: {real_name: '김가나', profile: {real_name_normalized: '김가나 (BB)', email: 'gana@example.test'}},
  U00000002: {real_name: '이다라', profile: {real_name_normalized: '이다라', email: 'dara@example.test'}},
  U00000003: {real_name: '박마바', profile: {real_name_normalized: '박마바', email: 'maba@example.test'}},
  U00000006: {real_name: '최사아', profile: {real_name_normalized: '최사아', email: 'saa@example.test'}},
  U00000007: {real_name: 'bot', is_bot: true, profile: {}},
};
function load(sheet, props) {
  const logs = [];
  const ctx = vm.createContext({
    console: {log: line => logs.push(String(line))},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => props[key] || null,
      setProperty: (key, value) => { props[key] = value; }})},
    requiredProperty_: (p, key) => { const value = p.getProperty(key); if (!value) throw new Error('missing ' + key); return value; },
    UrlFetchApp: {fetch: () => ({getResponseCode: () => 200, getContentText: () => '{"ok":true}',
      getAllHeaders: () => ({'x-oauth-scopes': 'usergroups:read,users:read,users:read.email'})})},
    slackMentionReadApi_: (method, params, _token, budget) => {
      budget.calls++;
      if (method === 'usergroups.users.list') return {users: Object.keys(members)};
      if (method === 'users.info') return {user: Object.assign({id: params.user}, members[params.user])};
      throw new Error('unexpected ' + method);
    },
    SpreadsheetApp: {openById: () => ({})},
    BOT_WORKBOOK: {usersTab: 'BOT_USERS', userHeaders: Array(3)},
    requireBotSheet_: () => sheet,
    // 실제 규칙과 같음: 설정이 없으면 Slack ID가 있는 PM이 정확히 한 명일 때만 시험 대상.
    getPilotPmName_: rows => {
      const ids = rows.filter(row => String(row[0]).trim() && /^[UW][A-Z0-9]{8,}$/.test(String(row[1]).trim()));
      if (ids.length !== 1) throw new Error('시범 PM을 확정할 수 없습니다.');
      return String(ids[0][0]).trim();
    },
    maskPilotId_: id => id.slice(0, 2) + '…' + id.slice(-3),
  });
  vm.runInContext(fs.readFileSync('src/central-bot/18_명단동기화.js', 'utf8'), ctx);
  return {ctx, logs};
}

// 1) 현재와 같은 상태: Slack ID는 본인 한 명만, 다른 PM은 이름만 있음.
const props = {SLACK_BOT_TOKEN: 'xoxb-test', SLACK_PM_GROUP_ID: 'S00000001', BOT_SPREADSHEET_ID: 'bot'};
const sheet = makeSheet([
  ['pm_name', 'slack_user_id', 'send_enabled'],
  ['김가나', 'U00000001', true],
  ['이다라', '', false],
  ['시트에만있음', '', false],
]);
let run = load(sheet, props);
run.ctx.syncBotUsersFromSlack();
assert.equal(props.PILOT_PM_NAME, '김가나', 'pilot is pinned before more Slack IDs are filled');
assert.equal(sheet.data[0][3], 'email');
assert.deepEqual(JSON.parse(JSON.stringify(sheet.data[1])), ['김가나', 'U00000001', true, 'gana@example.test'], 'existing values and send flag kept, email filled');
assert.deepEqual(JSON.parse(JSON.stringify(sheet.data[2])), ['이다라', 'U00000002', false, 'dara@example.test']);
assert.deepEqual(JSON.parse(JSON.stringify(sheet.data[3])), ['시트에만있음', '', false], 'rows not in Slack are untouched');
assert.deepEqual(JSON.parse(JSON.stringify(sheet.data.slice(4))),
  [['박마바', 'U00000003', false, 'maba@example.test'], ['최사아', 'U00000006', false, 'saa@example.test']],
  'new members are added with sending off; bots skipped');
assert.match(run.logs.join('\n'), /새 행 추가 2명 \(발송 여부 FALSE\)/);
assert.doesNotMatch(run.logs.join('\n'), /U00000002|xoxb/, 'full IDs and tokens stay out of logs');

// 2) 다시 실행해도 중복 행·변경 없음.
const before = JSON.stringify(sheet.data);
run = load(sheet, props);
run.ctx.syncBotUsersFromSlack();
assert.equal(JSON.stringify(sheet.data), before, 'rerun is idempotent');
assert.match(run.logs.join('\n'), /기존 행 채움 0건[\s\S]*새 행 추가 0명/);

// 3) 같은 이름에 다른 Slack ID가 이미 있으면 바꾸지 않는다.
const conflict = makeSheet([['pm_name', 'slack_user_id', 'send_enabled', 'email'], ['이다라', 'U00000099', false, '']]);
run = load(conflict, Object.assign({}, props, {PILOT_PM_NAME: '김가나'}));
run.ctx.syncBotUsersFromSlack();
assert.equal(conflict.data[1][1], 'U00000099');
assert.match(run.logs.join('\n'), /이다라 U0…002: 같은 이름에 다른 Slack ID 있음/);

// 4) D1에 다른 값이 있으면 아무것도 쓰지 않는다.
const occupied = makeSheet([['pm_name', 'slack_user_id', 'send_enabled', 'memo'], ['이다라', '', false, '']]);
const snapshot = JSON.stringify(occupied.data);
run = load(occupied, Object.assign({}, props, {PILOT_PM_NAME: '김가나'}));
assert.throws(() => run.ctx.syncBotUsersFromSlack(), /D1에 다른 값/);
assert.equal(JSON.stringify(occupied.data), snapshot);
console.log('Roster sync apply checks passed');
