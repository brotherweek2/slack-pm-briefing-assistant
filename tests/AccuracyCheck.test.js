const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 정확도 점검(previewBriefingAccuracy)이 업무·Slack 항목·분류 제외 글을 읽기만으로 나열하는지 확인한다.
const logs = [];
const records = [
  {pm: 'PM A', category: 'direct', ts: '1761530400.000100', text: '검수 요청', url: 'https://example.slack.com/archives/C1/p1'},
  {pm: 'PM A', category: 'group', ts: '1761530500.000100', text: '작업 완료했습니다', url: 'https://example.slack.com/archives/C1/p2'}];
const writes = [];
const ctx = vm.createContext({
  console: {log: m => logs.push(m)}, BRIEFING: {timezone: 'Asia/Seoul'},
  BOT_WORKBOOK: {usersTab: 'U', userHeaders: [1], tasksTab: 'T', taskHeaders: [1]},
  PropertiesService: {getScriptProperties: () => ({getProperty: () => null, setProperty: () => writes.push('prop')})},
  SpreadsheetApp: {openById: () => ({})}, requiredProperty_: () => 'bot', requireBotSheet_: name => name,
  readBotRows_: sheet => sheet === 'U' ? [['PM A', 'U00000001', true]] : [
    ['HACV_REVIEW|ko-en|1', 'PM A', ...Array(10).fill(''), true], ['HACV_ABUSE|ko-ja|2', 'PM B', ...Array(10).fill(''), true]],
  findPilotRecipient_: () => ({id: 'U00000001'}), getPilotPmName_: () => 'PM A',
  Utilities: {formatDate: (d, _t, p) => p === 'yyyy-MM-dd' ? '2026-10-27' : p === 'MM/dd' ? '10/27' : '10/27 14:00'},
  formatBriefingDay_: () => '10/27(화)', isHaCvBriefingTask_: () => true,
  readBbpmSnapshot_: () => ({meta: {oldest: 1761000000, newest: 1761540000}, messages: []}),
  classifySlackSnapshot_: () => records,
  buildSlackDigestItems_: list => [Object.assign({kind: '데이터 검수', deadline: '오후 5시까지', mergedCount: 1}, list[0])],
  classifySlackDigest_: record => /완료/.test(record.text) ? null : record,
  readSlackDigestSeen_: () => ['seen-hash'], slackDigestFingerprint_: () => 'seen-hash',
  slackDigestPlain_: text => text,
});
vm.runInContext(fs.readFileSync('src/central-bot/17_운영점검.js', 'utf8'), ctx);
ctx.previewBriefingAccuracy();
const out = logs.join('\n');
assert.match(out, /^\[정확도 점검\] PM A · 10\/27\(화\) · 읽기만, 변경·발송 없음/);
assert.match(out, /1\) 업무 · 봇 시트 기준 1건/);
assert.match(out, /• HACV_REVIEW 1건: HACV_REVIEW\|ko-en\|1/);
assert.doesNotMatch(out, /HACV_ABUSE/, 'other PM tasks are not listed');
assert.match(out, /나에게 해당하는 글 2건 → DM 항목 1개\(묶음\) · 분류 제외 1건/);
assert.match(out, /• \[개인\] 데이터 검수 · 원문 10\/27 · 기한 오후 5시까지 · DM 안내됨 · https:\/\/example/);
assert.match(out, /제외된 글[\s\S]*작업 완료했습니다 · https:\/\/example\.slack\.com\/archives\/C1\/p2/);
assert.equal(writes.length, 0, 'read-only');
console.log('Accuracy check preview lists tasks, Slack items and excluded posts without changes');
