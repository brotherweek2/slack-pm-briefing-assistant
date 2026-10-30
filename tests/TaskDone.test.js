const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. DM 업무 줄의 ✅ 완료 버튼: 오늘 남은 회차에서만 그 업무 종류를 빼고, 시트는 바꾸지 않는다.
const values = new Map([['SLACK_VERIFICATION_TOKEN', 'verify-test']]);
const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, v)};
const replies = [];
let today = '2026-10-30';
const ctx = vm.createContext({console: {log: () => {}}, BRIEFING: {timezone: 'Asia/Seoul'},
  Utilities: {formatDate: () => today}, PropertiesService: {getScriptProperties: () => props},
  ContentService: {createTextOutput: t => t}, escapeSlack_: v => String(v),
  UrlFetchApp: {fetch: (url, opt) => replies.push(JSON.parse(opt.payload).text)}});
for (const f of ['31_완료버튼.js', '25_점심메이트.js']) vm.runInContext(fs.readFileSync('src/central-bot/' + f, 'utf8'), ctx);
const plain = v => JSON.parse(JSON.stringify(v));

const rows = [['PM_REVIEW|1', 'PM A'], ['PM_REVIEW|2', 'PM A'], ['TEST_REVIEW|x', 'PM A'], ['PM_REVIEW|9', 'PM B']];
// 버튼: 보이는 업무 종류마다 1개, 값은 날짜|종류
const block = ctx.taskDoneButtonBlock_(rows.slice(0, 3), today);
assert.deepEqual(plain(block.elements.map(e => [e.action_id, e.value, e.text.text])), [
  ['task_done_PM_REVIEW', '2026-10-30|PM_REVIEW', '✅ 1차 검수 완료'],
  ['task_done_TEST_REVIEW', '2026-10-30|TEST_REVIEW', '✅ 테스트지 검토 완료']]);
assert.equal(ctx.taskDoneButtonBlock_([], today), null, 'no tasks, no buttons');
// 위치: 업무 영역(📌) 바로 아래, 여러 문단으로 나뉘었으면 그 끝
const blocks = [{type: 'section', text: {text: '☀️ 인사'}}, {type: 'divider'},
  {type: 'section', text: {text: '📌 *오늘 확인할 업무*'}}, {type: 'section', text: {text: '• 이어지는 줄'}},
  {type: 'divider'}, {type: 'section', text: {text: '💬 *Slack*'}}];
const placed = ctx.insertTaskDoneButtons_(blocks, block);
assert.equal(placed[4].type, 'actions');
assert.equal(placed[5].type, 'divider');
assert.equal(ctx.insertTaskDoneButtons_(Array(49).fill({type: 'divider'}), block).length, 49, 'Slack block limit respected');

// 버튼 누름: 검증 토큰이 맞고, 누른 사람 본인의 오늘 목록에만 추가
const press = (user, value, token) => ctx.handleSlackInteraction_({parameter: {payload: JSON.stringify({
  token: token || 'verify-test', type: 'block_actions', user: {id: user}, response_url: 'https://hooks.slack.com/actions/x',
  actions: [{action_id: 'task_done_' + value.split('|')[1], value}]})}});
press('U00000001', '2026-10-30|PM_REVIEW');
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000001', today)), ['PM_REVIEW']);
assert.match(replies.pop(), /1차 검수 완료로 표시했어요/);
press('U00000001', '2026-10-30|PM_REVIEW');
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000001', today)), ['PM_REVIEW'], 'pressing twice keeps one entry');
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000002', today)), [], 'other people are unaffected');
press('U00000001', '2026-10-29|TEST_REVIEW');
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000001', today)), ['PM_REVIEW'], 'yesterday DM button is ignored');
assert.match(replies.pop(), /지난 DM의 버튼/);
press('U00000001', '2026-10-30|NOT_A_GROUP');
press('U00000001', '2026-10-30|TEST_REVIEW', 'wrong-token');
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000001', today)), ['PM_REVIEW'], 'unknown group and wrong token rejected');

// 되돌리기: 완료 안내에 [↩️ 되돌리기] 버튼이 붙고, 누르면 오늘 목록에서 빠진다(본인 것만, 오늘 것만).
const lastPayloads = [];
ctx.UrlFetchApp.fetch = (url, opt) => { lastPayloads.push(JSON.parse(opt.payload)); replies.push(JSON.parse(opt.payload).text); };
press('U00000003', '2026-10-30|TEST_REVIEW');
const doneReply = lastPayloads.pop();
assert.equal(doneReply.blocks[1].elements[0].action_id, 'task_undo_TEST_REVIEW', 'done reply carries an undo button');
const undo = (user, value) => ctx.handleSlackInteraction_({parameter: {payload: JSON.stringify({token: 'verify-test', type: 'block_actions',
  user: {id: user}, response_url: 'https://hooks.slack.com/actions/x', actions: [{action_id: 'task_undo_' + value.split('|')[1], value}]})}});
undo('U00000003', '2026-10-30|TEST_REVIEW');
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000003', today)), [], 'undo removes the type for today');
assert.match(lastPayloads.pop().text, /되돌렸어요/);
undo('U00000003', '2026-10-29|TEST_REVIEW');
assert.match(lastPayloads.pop().text, /지난 DM의 버튼/);
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000001', today)), ['PM_REVIEW'], 'undo by someone else does not touch this PM');
// DM 버튼 묶음: 남은 종류는 [✅ 완료], 오늘 완료한 종류는 [↩️ 되돌리기]
const mixed = ctx.taskDoneButtonBlock_([['TEST_REVIEW|x', 'PM A']], today, ['PM_REVIEW']);
assert.deepEqual(plain(mixed.elements.map(e => e.action_id)), ['task_done_TEST_REVIEW', 'task_undo_PM_REVIEW']);
assert.deepEqual(plain(ctx.taskDoneButtonBlock_([], today, ['PM_REVIEW']).elements.map(e => e.action_id)), ['task_undo_PM_REVIEW'],
  'all types done: undo buttons still shown');
// 업무 빼기: 그 PM의 그 종류만, 다른 PM은 그대로. 다음 날이면 다시 나온다.
const done = ctx.taskDoneGroups_(props, 'U00000001', today);
assert.deepEqual(plain(ctx.withoutDoneTasks_(rows, 'PM A', done).map(r => r[0])), ['TEST_REVIEW|x', 'PM_REVIEW|9']);
assert.match(ctx.taskDoneNote_(done), /✅ 오늘 완료 표시: 1차 검수/);
assert.equal(ctx.taskDoneNote_([]), '');
today = '2026-10-31';
assert.deepEqual(plain(ctx.taskDoneGroups_(props, 'U00000001', today)), [], 'resets the next day');
// 끄기 설정·검증 토큰 없음이면 버튼을 붙이지 않는다
assert.equal(ctx.taskDoneEnabled_(props), true);
values.set('ENABLE_TASK_DONE', 'false');
assert.equal(ctx.taskDoneEnabled_(props), false);
values.delete('ENABLE_TASK_DONE'); values.delete('SLACK_VERIFICATION_TOKEN');
assert.equal(ctx.taskDoneEnabled_(props), false);
console.log('Task done buttons: per task type, today only, own tasks only, sheet untouched');
