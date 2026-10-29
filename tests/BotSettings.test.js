const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 속성 50개 초과로 편집기에서 못 바꿀 때 봇 시트로 설정을 반영하는 경로.
const values = new Map([['BOT_SPREADSHEET_ID', 'bot']]);
const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, v), deleteProperty: k => values.delete(k)};
let sheet = null; const logs = [];
const makeSheet = rows => ({rows, getLastRow: () => rows.length, getRange: (r, c, h = 1, w = 1) => ({
  getValues: () => rows.slice(r - 1, r - 1 + h).map(x => x.slice(c - 1, c - 1 + w)),
  setValues: v => v.forEach((x, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; x.forEach((y, j) => { rows[r - 1 + i][c - 1 + j] = y; }); }),
  setValue: v => { rows[r - 1][c - 1] = v; }})});
const ctx = vm.createContext({console: {log: m => logs.push(m)}, PropertiesService: {getScriptProperties: () => props},
  requiredProperty_: (p, k) => p.getProperty(k), SpreadsheetApp: {openById: () => ({getSheetByName: () => sheet, getName: () => '봇 시트'})},
  ensureBotSheet_: (_b, _n, headers) => (sheet = makeSheet([headers.slice()])), assertBotHeaders_: () => {}});
vm.runInContext(fs.readFileSync('src/central-bot/27_설정반영.js', 'utf8'), ctx);

ctx.applyBotSettings();
assert.ok(sheet.rows.length > 5, 'first run creates the form with allowed names');
assert.match(logs.join(String.fromCharCode(10)), /반영할 값 없음 · 읽은 위치: 파일 "봇 시트" → 탭 BOT_SETTINGS B2:B/);
const row = key => sheet.rows.findIndex(r => r[0] === key);
sheet.rows[row('SLACK_VERIFICATION_TOKEN')][1] = 'synthetic-verify';
sheet.rows[row('ENABLE_LUNCH_MATE')][1] = 'true';
sheet.rows.push(['SLACK_BOT_TOKEN', 'not-a-real-token', '']);
values.set('ENABLE_WEATHER', 'true'); sheet.rows[row('ENABLE_WEATHER')][1] = '삭제';
ctx.applyBotSettings();
assert.equal(values.get('SLACK_VERIFICATION_TOKEN'), 'synthetic-verify');
assert.equal(values.get('ENABLE_LUNCH_MATE'), 'true');
assert.equal(values.has('ENABLE_WEATHER'), false, "'삭제' removes the property");
assert.equal(values.has('SLACK_BOT_TOKEN'), false, 'names outside the allow list are ignored');
assert.equal(sheet.rows[row('SLACK_VERIFICATION_TOKEN')][1], '', 'secret cleared from the sheet');
assert.equal(sheet.rows[row('ENABLE_LUNCH_MATE')][1], '', 'applied values cleared');
assert.ok(!logs.join('\n').includes('synthetic-verify'), 'secret never logged');
assert.match(logs.join('\n'), /허용되지 않은 이름이라 건너뜀: SLACK_BOT_TOKEN/);
logs.length = 0; ctx.previewBotSettings();
assert.match(logs.join('\n'), /SLACK_VERIFICATION_TOKEN : 설정됨/); assert.match(logs.join('\n'), /ENABLE_LUNCH_MATE : true/);
console.log('Bot settings via sheet checks passed');
