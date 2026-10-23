const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fakeSheet(name, initialRows) {
  const rows = initialRows.map(row => [...row]);
  return {
    rows,
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(0, ...rows.map(row => row.length)),
    getRange: (row, col, height = 1, width = 1) => ({
      getValues: () => rows.slice(row - 1, row - 1 + height)
        .map(item => Array.from({ length: width }, (_, index) => item[col - 1 + index] ?? '')),
      getDisplayValues: () => rows.slice(row - 1, row - 1 + height)
        .map(item => Array.from({ length: width }, (_, index) => String(item[col - 1 + index] ?? ''))),
      setValues: values => values.forEach((item, index) => {
        while (rows.length < row + index) rows.push([]);
        item.forEach((value, offset) => { rows[row - 1 + index][col - 1 + offset] = value; });
      }),
      setValue: value => { rows[row - 1][col - 1] = value; },
      getValue: () => rows[row - 1][col - 1],
      setNumberFormat: () => {},
    }),
    appendRow: row => { rows.push([...row]); },
  };
}

const context = vm.createContext({ console, PropertiesService: {}, SpreadsheetApp: {} });
vm.runInContext(fs.readFileSync('src/central-bot/14_공통설정.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), context);
const build = vm.runInContext('buildHaCvBotTasks_', context);
const buildHeadsUp = vm.runInContext('buildHaCvHeadsUpTasks_', context);
const syncTasks = vm.runInContext('syncBotTasks_', context);
const syncUsers = vm.runInContext('syncBotUsers_', context);

const detected = build({
  'PM B': {
    'en_US-ja_JP': [
      { row: 1012, url: 'https://example.com/1012' },
      { row: 1029, url: 'https://example.com/1029' },
    ],
  },
}, new Date('2026-09-29T06:00:00Z'));
assert.equal(detected.length, 1, 'same PM and pair become one task');
assert.equal(detected[0][5], 'HUB 검토 필요 2건');
assert.equal(detected[0][7], '', 'unknown deadline stays empty');
assert.equal(detected[0][8], '', 'unknown priority stays empty');
assert.equal(detected[0][9], 'HA-CV HUB');
assert.equal(detected[0][11], '1012, 1029');
assert.doesNotMatch(JSON.stringify(detected), /private@example.com|PrivateName/);
const headsUp = buildHeadsUp({ 'PM A': { 'en_US-ja_JP': [
  { row: 12, url: 'https://example.test/source/12' },
  { row: 18, url: 'https://example.test/source/18' },
] } }, new Date('2026-09-29T06:00:00Z'));
assert.equal(headsUp.length, 1);
assert.equal(headsUp[0][5], '헤즈업 대상 2명');
assert.match(headsUp[0][6], /헤즈업 메일 발송 후 헤즈업 완료/);
assert.equal(headsUp[0][7], '', 'unverified deadline stays blank');
assert.equal(headsUp[0][11], '12, 18');

const headers = vm.runInContext('BOT_WORKBOOK.taskHeaders', context);
const tasks = fakeSheet('BOT_TASKS', [
  Array.from(headers),
  ['HACV_REVIEW|PM B|en_US-ja_JP', 'PM B', '', 'en_US-ja_JP', '', 'old', '', '', '', '', '', '', true, '', 'APPROVED', '수동 이슈', '수동 액션', '2026-10-01'],
  ['HACV_REVIEW|PM B|de_DE-ja_JP', 'PM B', '', 'de_DE-ja_JP', '', 'old', '', '', '', '', '', '', false, '', 'APPROVED', '', '', ''],
  ['OTHER|1', '다른 업무', '', '', '', '', '', '', '', '', '', '', true, '', 'APPROVED', '', '', ''],
  ['HACV_OVERDUE|PM A|en_US-id_ID|ta.text|V', 'PM A', '', 'en_US-id_ID', '', 'old', '', '2026-09-22', '', '', '', '', true, '', 'PENDING', '', '', ''],
  ['HACV_HEADSUP|PM A|en_US-ja_JP', 'PM A', '', 'en_US-ja_JP', '', 'old', '', '', '', '', '', '12', true, '', 'PENDING', '', '', ''],
  ['HACV_ABUSE|PM A|en_US-ja_JP|2026-09-29', 'PM A', '', 'en_US-ja_JP', '', 'old', '', '2026-09-30', '', '', '', '', true, '', 'PENDING', '', '', ''],
]);
syncTasks(tasks, detected);
syncTasks(tasks, detected);
assert.equal(tasks.rows.length, 7, 'refresh is idempotent');
assert.equal(tasks.rows[1][5], 'HUB 검토 필요 2건');
assert.deepEqual(tasks.rows[1].slice(14), ['APPROVED', '수동 이슈', '수동 액션', '2026-10-01'], 'manual fields remain');
assert.equal(tasks.rows[2][12], false, 'missing source task becomes inactive');
assert.equal(tasks.rows[3][12], true, 'other source task is untouched');
assert.equal(tasks.rows[4][12], false, 'old overdue pilot task becomes inactive');
assert.equal(tasks.rows[5][12], false, 'completed heads-up task becomes inactive');
assert.equal(tasks.rows[6][12], false, 'past abuse reminder becomes inactive');
const reactivated = build({ 'PM B': { 'de_DE-ja_JP': [{ row: 1073, url: 'https://example.com/1073' }] } }, new Date('2026-09-30T06:00:00Z'));
syncTasks(tasks, reactivated);
assert.equal(tasks.rows[2][12], true);
assert.equal(tasks.rows[2][14], 'PENDING', 'reactivated task needs fresh approval');

const users = fakeSheet('BOT_USERS', [['pm_name', 'slack_user_id', 'send_enabled']]);
syncUsers(users, ['PM B']);
syncUsers(users, ['PM B']);
assert.equal(users.rows.length, 2);
assert.deepEqual(users.rows[1], ['PM B', '', false], 'new recipient defaults to disabled');
console.log('BotWorkbook staging checks passed');
