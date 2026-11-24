// Local, dependency-free checks for the linked Apps Script source. Run with: node Code.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fakeSheet(rows, headers, id) {
  return {
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map(item => item.length)),
    getSheetId: () => id,
    getRange: (row, col, height, width) => {
      if (typeof row === 'string') {
        return { getDisplayValue: () => headers[row] };
      }
      return {
        getDisplayValues: () => rows.slice(row - 1, row - 1 + height)
          .map(item => item.slice(col - 1, col - 1 + width)),
      };
    },
  };
}

const resultRows = [
  ['', '', '', '언어쌍', '담당 PM', '', '', '헤즈업 상태 (HA-CV 참여 여부)'],
  ['', '', '', 'en_US-ja_JP', 'PM A', '', '', '헤즈업 대상'],
  ['', '', '', 'en_US-ja_JP', 'PM B', '', '', '헤즈업 완료'],
  ['', '', '', 'ko_KR-en_GB', 'PM B'],
  ['', '', '', 'ko_KR-en_GB', 'PM C'],
];
const hubRows = [
  [],
  ['투입 언어쌍', '', '', '(기존) 담당자', '', '담당자 탭으로 전송 여부'],
  ['en_US-ja_JP', 'PrivateName', 'private@example.com', 'PM A', '', '검토 필요'],
  ['en_US-ja_JP', '', '', 'PM A', '', '투입 완료'],
  ['ko_KR-en_GB', '', '', '', '', '검토 필요'],
];
const tabs = {
  'HA-CV 헤즈업 결과 집계': fakeSheet(resultRows, {
    D1: '언어쌍', E1: '담당 PM', H1: '헤즈업 상태 (HA-CV 참여 여부)',
  }, 1),
  HACV_Hub: fakeSheet(hubRows, {
    A2: '투입 언어쌍', D2: '(기존) 담당자', F2: '담당자 탭으로 전송 여부',
  }, 2),
};
const spreadsheet = {
  getSheetByName: name => tabs[name],
  getUrl: () => 'https://example.test/spreadsheet',
};
const values = {
  SOURCE_SPREADSHEET_ID: 'test',
  ENABLE_LIVE_SEND: 'false',
  APPROVE_HACV_REVIEW_RULE: 'false',
};
const logs = [];
const posts = [];
const context = vm.createContext({
  console: { log: value => logs.push(value), warn: value => logs.push(value) },
  SpreadsheetApp: { openById: () => spreadsheet },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => values[key] || null,
    setProperty: (key, value) => { values[key] = value; },
  }) },
  Utilities: { formatDate: () => '2026-09-28' },
  UrlFetchApp: { fetch: (url, options) => {
    posts.push({ url, options });
    return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
  } },
});

vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), context); // columnLetters_
vm.runInContext(fs.readFileSync('src/central-bot/14_공통설정.js', 'utf8'), context, { filename: '14_공통설정.js' });
const collect = vm.runInContext('collectHaCvReviewCandidates_', context);
const collectHeadsUp = vm.runInContext('collectHaCvHeadsUpCandidates_', context);
const result = collect(spreadsheet);
assert.equal(result.byPm['PM A']['en_US-ja_JP'].length, 1);
assert.equal(result.unassigned.length, 1);
// 원본은 D열 이름이 "(현) 담당자"다. 같은 결과를 내야 한다.
hubRows[1][3] = '(현) 담당자';
assert.equal(collect(spreadsheet).byPm['PM A']['en_US-ja_JP'].length, 1);
hubRows[1][3] = '담당';
assert.throws(() => collect(spreadsheet), /머리글을 1~3행에서 찾지 못했습니다\. 필요한 이름: 투입 언어쌍 \/ \(현\) 담당자 또는 \(기존\) 담당자/);
hubRows[1][3] = '(기존) 담당자';
const headsUp = collectHeadsUp(spreadsheet);
assert.equal(headsUp.byPm['PM A']['en_US-ja_JP'].length, 1);
assert.equal(headsUp.byPm['PM A']['en_US-ja_JP'][0].row, 2);
assert.doesNotMatch(JSON.stringify(headsUp), /PrivateName|private@example.com/);
assert.match(headsUp.byPm['PM A']['en_US-ja_JP'][0].url, /range=H2$/);
// 새 원본처럼 머리글이 1행으로 올라오고 열이 밀려도 이름으로 찾는다. 링크도 상태 열을 따라간다.
const movedHub = [['', '투입 언어쌍', '유저', '이메일', '(현) 담당자', '적재 일자', '담당자 탭으로 전송 여부'],
  ['', 'en_US-ja_JP', '', '', 'PM A', '', '검토 필요']];
tabs.HACV_Hub = fakeSheet(movedHub, {}, 2);
const moved = collect(spreadsheet);
assert.equal(moved.byPm['PM A']['en_US-ja_JP'][0].row, 2);
assert.match(moved.byPm['PM A']['en_US-ja_JP'][0].url, /range=G2$/);
tabs.HACV_Hub = fakeSheet(hubRows, {}, 2);

for(const name of ['preview11','preview16','send11','send16','installDailyTriggers','runBriefing_','formatMessage_']) {
  assert.equal(vm.runInContext('typeof '+name,context),'undefined','retired entry removed: '+name);
}
assert.equal(posts.length,0,'collectors never send messages');
context.postSlackDm_('test-only','U0000000002','synthetic briefing');
assert.equal(posts.length,1);
assert.equal(posts[0].url,'https://slack.com/api/chat.postMessage');
assert.equal(JSON.parse(posts[0].options.payload).channel,'U0000000002');
assert.equal(context.escapeSlack_('<a>&'), '&lt;a&gt;&amp;');
assert.throws(()=>context.requiredProperty_({getProperty:()=>null},'EXAMPLE'),/EXAMPLE/);
console.log('Linked source collectors and Slack helper checks passed');
