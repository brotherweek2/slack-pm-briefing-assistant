const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 32번 업무일지: BOT_WORKLOG에서 켠 PM에게만, Work Log TASKS를 읽어 10:30·17:00 DM에 한 칸을 붙인다.
const day = '2026-11-20'; // 금요일 → 그 주 월요일 2026-11-16
const A = 'U0000000011', B = 'U0000000012', C = 'U0000000013';
const tasksHead = ['id', 'user_id', 'kind', 'date_key', 'title', 'priority', 'children_json', 'done', 'source', 'template_id', 'revision', 'created_at', 'updated_at', 'deleted'];
const task = (user, kind, key, title, priority, done, extra = {}) => ['x', user, kind, key, title, priority, extra.children || '[]',
  done ? 'TRUE' : 'FALSE', extra.source || 'manual', '', 1, '', '', extra.deleted ? 'TRUE' : 'FALSE'];
let tasksValues = [tasksHead,
  task(A, 'day', day, '오늘 검수 <확인>', 'P1', false),
  task(A, 'day', day, '반복 정리', 'P0', false, {source: 'repeat'}),
  task(A, 'day', day, '끝낸 일', 'P0', true),
  task(A, 'day', day, '지운 일', 'P0', false, {deleted: true}),
  task(A, 'day', day, '세부 있는 일', 'P2', false, {children: JSON.stringify([{id: 'a', title: '1', done: true}, {id: 'b', title: '2', done: false}])}),
  task(A, 'week', '2026-11-16', '주간 보고', 'P1', false),
  task(A, 'day', '2026-11-18', '지난 미완료', 'P0', false),
  task(A, 'day', '2026-10-01', '너무 오래된 일', 'P0', false),
  task(B, 'day', day, 'B의 일', 'P0', false),
  task(C, 'day', day, '안 켠 사람 일', 'P0', false)];
const worklogRows = [['PM A', A, true, ''], ['PM B', B, true, ''], ['PM C', C, false, '']];
let opened = [];
const sheet = (name, values) => ({getName: () => name, getDataRange: () => ({getValues: () => values})});
const ctx = vm.createContext({console: {log: () => {}}, BRIEFING: {timezone: 'Asia/Seoul'},
  Utilities: {formatDate: d => d.toISOString().slice(0, 10)},
  escapeSlack_: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  assertBotHeaders_: () => {}, readBotRows_: s => s.rows,
  SpreadsheetApp: {openById: id => { opened.push(id); if (id === 'BADBADBADBADBADBADBADBAD') throw new Error('no access');
    return {getSheetByName: n => n === 'TASKS' ? sheet('TASKS', tasksValues) : null}; }}});
vm.runInContext(fs.readFileSync('src/central-bot/32_업무일지.js', 'utf8'), ctx);

// 주소·ID 모두 받는다
assert.equal(ctx.workLogSpreadsheetId_('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit#gid=0'), '1AbCdEfGhIjKlMnOpQrStUvWx');
assert.equal(ctx.workLogSpreadsheetId_('1AbCdEfGhIjKlMnOpQrStUvWx'), '1AbCdEfGhIjKlMnOpQrStUvWx');
assert.equal(ctx.workLogSpreadsheetId_('not an id'), '');
assert.equal(ctx.workLogMonday_(day), '2026-11-16');

const values = new Map([['ENABLE_WORKLOG_BRIEFING', 'true'], ['WORKLOG_SPREADSHEET_ID', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit']]);
const props = {getProperty: k => values.has(k) ? values.get(k) : null};
const bot = {getSheetByName: n => n === 'BOT_WORKLOG' ? {rows: worklogRows} : null};
const routes = [{pm: 'PM A', id: A}, {pm: 'PM B', id: B}, {pm: 'PM C', id: C}];

// 켠 PM(A·B)만 읽는다. 시트는 한 번만 연다.
let wl = ctx.loadWorkLogBriefing_(props, bot, routes);
assert.deepEqual(Array.from(wl.ids), [A, B]);
assert.equal(opened.length, 1);
assert.equal(ctx.formatWorkLogForRoute_(wl, C, day, '11:00'), '', '안 켠 PM은 칸 없음');

const morning = ctx.formatWorkLogForRoute_(wl, A, day, '11:00');
assert.match(morning, /^\n\n📝 \*내 업무일지 \(Work Log\)\*/);
assert.match(morning, /• 반복 정리  `P0` 🔁/);
assert.match(morning, /오늘 검수 &lt;확인&gt;  `P1`/, 'Slack 특수문자 처리');
assert.match(morning, /세부 있는 일  `P2` \(1\/2\)/);
assert.match(morning, /주간 보고  `P1` · 이번 주/);
assert.match(morning, /↪ 지난 미완료 1개/, '14일 넘은 일은 세지 않음');
assert.doesNotMatch(morning, /끝낸 일|지운 일|안 켠 사람|너무 오래된/);
assert.doesNotMatch(morning, /오늘 완료/, '10:30에는 완료 개수 없음');
assert(morning.indexOf('반복 정리') < morning.indexOf('오늘 검수'), '우선순위 순서');
assert.match(ctx.formatWorkLogForRoute_(wl, A, day, '17:00'), /✅ 오늘 완료 1개/);

// 스위치가 꺼져 있으면 읽지 않는다
values.set('ENABLE_WORKLOG_BRIEFING', 'false'); opened = [];
wl = ctx.loadWorkLogBriefing_(props, bot, routes);
assert.equal(wl.ids.length, 0); assert.equal(opened.length, 0);
values.set('ENABLE_WORKLOG_BRIEFING', 'true');

// 못 읽으면 켠 PM에게만 한 줄 안내(다른 업무는 그대로 보냄)
values.set('WORKLOG_SPREADSHEET_ID', 'BADBADBADBADBADBADBADBAD');
wl = ctx.loadWorkLogBriefing_(props, bot, routes);
assert.match(ctx.formatWorkLogForRoute_(wl, A, day, '11:00'), /⚠️ Work Log 시트를 읽지 못했어요/);
assert.equal(ctx.formatWorkLogForRoute_(wl, C, day, '11:00'), '');
values.delete('WORKLOG_SPREADSHEET_ID');
assert.match(ctx.formatWorkLogForRoute_(ctx.loadWorkLogBriefing_(props, bot, routes), A, day, '11:00'), /WORKLOG_SPREADSHEET_ID/);

// 머리글이 바뀌면 읽지 않고 안내
values.set('WORKLOG_SPREADSHEET_ID', '1AbCdEfGhIjKlMnOpQrStUvWx');
tasksValues = [['id', 'user'], ['x', A]];
assert.match(ctx.formatWorkLogForRoute_(ctx.loadWorkLogBriefing_(props, bot, routes), A, day, '11:00'), /읽지 못했어요/);

// 보여 줄 것이 하나도 없으면 칸을 붙이지 않는다
tasksValues = [tasksHead, task(B, 'day', '2026-11-19', '어제 끝낸 일', 'P0', true)];
assert.equal(ctx.formatWorkLogForRoute_(ctx.loadWorkLogBriefing_(props, bot, routes), B, day, '17:00'), '');

// 1번 발송 코드는 스위치가 켜졌을 때만 업무일지 함수를 부른다(다른 테스트 환경에서 함수가 없어도 안전)
const sender = fs.readFileSync('src/central-bot/01_슬랙DM발송.js', 'utf8');
assert.match(sender, /if \(props\.getProperty\('ENABLE_WORKLOG_BRIEFING'\) === 'true'\) \{\n\s+try \{ workLog = loadWorkLogBriefing_/);
assert.match(sender, /if \(workLog\) message \+= formatWorkLogForRoute_\(workLog, route\.id, day, effectiveSlot\);/);
console.log('PASS WorkLogBriefing');
