const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const today = '2026-10-07';
const sent = [];
const logRows = [];
const users = [
  ['PM A', 'U0000000002', true],
  ['PM B', 'U0000000004', true],
  ['PM C', 'U0000000005', true],
];
const task = (pm, pair) => {
  const row = Array(18).fill('');
  row[0] = `HACV_DUE_SOON|${pm}|${pair}|test|A`;
  row[1] = pm;
  row[3] = pair;
  row[7] = '2026-10-12';
  row[10] = 'https://docs.google.com/spreadsheets/d/test/edit#gid=123&range=A5:A6';
  row[12] = true;
  return row;
};
const tasks = [task('PM A', 'en_US-ja_JP'), task('PM B', 'de_DE-fr_FR')];
tasks[1][10] = 'https://docs.google.com/spreadsheets/d/test/edit#gid=456&range=A5:A6';
const sheet = rows => ({
  getLastRow: () => rows.length + 1,
  getRange: () => ({ getValues: () => rows }),
  appendRow: row => rows.push(row),
});
const sheets = { BOT_USERS: sheet(users), BOT_TASKS: sheet(tasks), BOT_SEND_LOG: sheet(logRows) };
const context = vm.createContext({ briefingLeaveRoutes_: () => [],
  console: { log: () => {} },
  BOT_WORKBOOK: {
    usersTab: 'BOT_USERS', tasksTab: 'BOT_TASKS', logTab: 'BOT_SEND_LOG',
    userHeaders: Array(3), taskHeaders: Array(18), logHeaders: Array(5),
  },
  BRIEFING: { timezone: 'Asia/Seoul' },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => ({ ENABLE_PM_SEND: 'true', ENABLE_SLACK_MENTION_READ: 'true', BOT_SPREADSHEET_ID: 'bot',
      SLACK_BOT_TOKEN: 'test-only' })[key] || null,
  }) },
  SpreadsheetApp: { openById: () => ({}) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { formatDate: () => today },
  refreshBotTasks: () => ({ pmNames: ['PM A', 'PM B'] }),
  saveHaCvDailyHistory_: () => ({}),
  formatHaCvDailyTrend_: () => '',
  requireBotSheet_: (_bot, name) => sheets[name],
  requiredProperty_: (_props, key) => ({ BOT_SPREADSHEET_ID: 'bot',
    SLACK_BOT_TOKEN: 'test-only' })[key],
  postSlackDm_: (_token, id, message) => sent.push({ id, message }),
  escapeSlack_: value => String(value),
});
vm.runInContext(fs.readFileSync('src/central-bot/07_업무브리핑.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/central-bot/01_슬랙DM발송.js', 'utf8'), context);
require('./test-briefing-blocks.cjs')(context);
vm.runInContext(fs.readFileSync('src/central-bot/17_운영점검.js', 'utf8'), context);
tasks.forEach(row => { row[13] = vm.runInContext('new Date("2026-10-07T02:00:00Z")', context); });
const send = (() => context.sendPmBriefings_(false));
send();
assert.equal(sent.length, 3);
assert.equal(sent[0].id, 'U0000000002');
assert.match(sent[0].message, /\|언어쌍 종료 임박> 1건/);
assert.match(sent[0].message, /#gid=123\|/);
assert.doesNotMatch(sent[0].message, /#gid=456/);
assert.doesNotMatch(sent[0].message, /de_DE-fr_FR|PM B/);
assert.equal(sent[1].id, 'U0000000004');
assert.match(sent[1].message, /\|언어쌍 종료 임박> 1건/);
assert.match(sent[1].message, /#gid=456\|/);
assert.doesNotMatch(sent[1].message, /#gid=123/);
assert.doesNotMatch(sent[1].message, /en_US-ja_JP|PM A/);
assert.equal(sent[2].id, 'U0000000005');
assert.match(sent[2].message, /📌 \*오늘 확인할 업무\*\n• 확인할 특이사항 없음/);
assert.doesNotMatch(sent[2].message, /담당자 이름을 찾지 못해|관리자에게 알렸어요/, 'recipient without a language-pair tab gets no false warning');
assert.doesNotMatch(sent[2].message, /en_US-ja_JP|de_DE-fr_FR/);
assert.equal(logRows.length, 3);
send();
assert.equal(sent.length, 3, 'same-day rerun skips already sent recipients');
const updatedTest = (() => context.sendPmBriefings_(true));
vm.runInContext('findPilotRecipient_ = () => ({id: "U0000000002", enabled: true});', context);
assert.throws(() => updatedTest(), /본인만/, 'test cannot send to multiple enabled PMs');
assert.equal(sent.length, 3);
users[1][2] = false;
users[2][2] = false;
updatedTest();
assert.equal(sent.length, 4, 'one test message can follow a normal send');
assert.equal(sent[3].id, 'U0000000002');
assert.match(sent[3].message, /\|언어쌍 종료 임박> 1건/);
assert.equal(logRows[3][1], 'manual-test-resend');
updatedTest();
assert.equal(sent.length, 4, 'repeated test click does not send another message');
send();
assert.equal(sent.length, 4, 'normal duplicate prevention stays intact');
const digestMarked = [];
Object.assign(context, {
  SLACK_DIGEST: { perSection: 3 },
  loadFreshBbpmSnapshot_: () => ({ meta: { newest: 1790000000 } }),
  classifySlackSnapshot_: () => [{ pm: 'PM A', category: 'direct', text: 'HT 검수 요청' }],
  buildSlackDigestItems_: records => records,
  readSlackDigestSeen_: () => [],
  slackDigestFingerprint_: () => 'synthetic-hash',
  formatSlackDigestSections_: (_pm, items) => '\nBBPM/개인 확인사항 ' + items.length,
  selectPersonalSlackItems_: (pm,items) => items.filter(item=>item.pm===pm),
  formatPersonalSlackDigest_: items => '\nBBPM/개인 확인사항 ' + items.length,
  attachSlackToWorkLines_:(text,items)=>({text,rest:items,attached:0}),attachSlackAuthorNames_:items=>items,
  markSlackDigestSeen_: (_props, id, _old, items) => digestMarked.push({ id, count: items.length }),
});
const sendDigest = (() => context.sendPmBriefings_(true, true));
sendDigest();
assert.equal(sent.length, 5);
assert.match(sent[4].message, /\|언어쌍 종료 임박> 1건/);
assert.match(sent[4].message, /BBPM\/개인 확인사항 1/);
assert.equal(logRows[4][1], 'manual-test-slack-digest');
assert.equal(digestMarked.length, 1, 'successful send marks displayed records');
assert.equal(digestMarked[0].id, 'U0000000002');
sendDigest();
assert.equal(sent.length, 5, 'integrated test slot suppresses repeated clicks');
assert.equal(digestMarked.length, 1);
const scheduledSend = vm.runInContext('sendPmBriefings_', context);
scheduledSend(true, true, '11:00');
scheduledSend(true, true, '17:00');
assert.equal(sent.length, 7, 'morning and afternoon are independent delivery slots');
assert.match(sent[5].message, /^☀️ \*PM A\* 님, 10\/07\(수\) 오전 브리핑 드립니다!/);
assert.match(sent[5].message, /\n\n_업무(·회의)? \S+( · Slack \S+)? 기준_/, 'basis times are gathered into one line');
assert.doesNotMatch(sent[5].message, /회차|조회 기준/);
assert.match(sent[6].message, /^🌙 \*PM A\* 님, 10\/07\(수\) 마무리 브리핑 드립니다!/);
scheduledSend(true, true, '17:00');
assert.equal(sent.length, 7, 'same scheduled slot cannot send twice');
context.buildSlackDigestItems_=()=>Array.from({length:6},(_,index)=>({
  pm:'PM A',category:index%2?'group':'direct',text:'synthetic-item-'+index}));
scheduledSend(true,true,'test-all-links');
assert.match(sent.at(-1).message,/BBPM\/개인 확인사항 6/);
assert.equal(digestMarked.at(-1).count,6,'all displayed links are recorded after delivery');
// Slack 완료본이 없거나 오래되면 시트 업무만 보내고 사유를 남긴다.
const markedBeforeFailure=digestMarked.length;
context.loadFreshBbpmSnapshot_=()=>{throw Object.assign(new Error('stale'),{code:'STALE',lastAsOf:1790000000});};
scheduledSend(true,true,'test-slack-fail');
assert.match(sent.at(-1).message,/\|언어쌍 종료 임박> 1건/,'sheet tasks are still delivered');
assert.match(sent.at(-1).message,/⚠️ Slack 확인사항을 읽어오지 못했습니다 — 사유: 저장된 Slack 자료가 최신성 기준을 초과함 \(마지막 완료 수집 /);
assert.doesNotMatch(sent.at(-1).message,/BBPM\/개인 확인사항|Slack 조회 기준/,'no partial Slack section');
assert.equal(logRows.at(-1)[4],'sent-sheet-only');
assert.equal(digestMarked.length,markedBeforeFailure,'failed Slack read marks nothing as seen');
const countAfterFailure=sent.length;
scheduledSend(true,true,'test-slack-fail');
assert.equal(sent.length,countAfterFailure,'sheet-only delivery also blocks a duplicate in the same slot');
context.loadFreshBbpmSnapshot_=()=>{throw new Error('Unexpected token in JSON');};
scheduledSend(true,true,'test-slack-broken');
assert.match(sent.at(-1).message,/💬 \*Slack\*\n⚠️ .*사유: 기타 오류 \(실행 로그 확인\)\n\n_업무/);
const describe=vm.runInContext('describeSlackFailure_',context);
const lastError=message=>({getProperty:key=>key==='BBPM_COLLECT_LAST_ERROR'?JSON.stringify({at:1,message}):null});
const stale=Object.assign(new Error('x'),{code:'STALE'});
assert.equal(describe(stale,lastError('Slack 읽기 제한 | 30초 뒤 재실행 필요.')),'사유: Slack 읽기 제한');
assert.equal(describe(stale,lastError('Slack 읽기 실패 (conversations.history): not_in_channel')),'사유: 봇 권한·채널 참여 확인 필요');
assert.equal(describe(stale,lastError('Slack 읽기 실패 (auth.test): invalid_auth')),'사유: 봇 토큰 확인 필요');
assert.equal(describe(stale,lastError('BBPM 채널 페이지가 반복됩니다.')),'사유: 기타 오류 (실행 로그 확인)');
assert.equal(describe(Object.assign(new Error('x'),{code:'NO_SNAPSHOT'}),{getProperty:()=>null}),'사유: 완료된 수집 자료 없음');
assert.equal(describe(Object.assign(new Error('x'),{code:'READ_DISABLED'}),{getProperty:()=>null}),'사유: Slack 읽기 설정 꺼짐');
const oldPropertyService=context.PropertiesService;
context.PropertiesService={getScriptProperties:()=>({getProperty:key=>key==='ENABLE_CALENDAR_BRIEFING'?'true':
  oldPropertyService.getScriptProperties().getProperty(key)})};
let calendarReads=0;
context.buildLiveCalendarSection_=()=> '\n내 회의 · 새 조회 '+(++calendarReads);
scheduledSend(true,false,'calendar-fresh-1');
assert.match(sent.at(-1).message,/내 회의 · 새 조회 1/);
scheduledSend(true,false,'calendar-fresh-2');
assert.match(sent.at(-1).message,/내 회의 · 새 조회 2/);
scheduledSend(true,false,'calendar-fresh-2');
assert.equal(calendarReads,2,'duplicate send does not query calendar');
context.buildLiveCalendarSection_=()=>{throw Error('synthetic failure');};
scheduledSend(true,false,'calendar-failure');
assert.match(sent.at(-1).message,/본인 회의 일정을 불러오지 못했습니다/);
assert.doesNotMatch(sent.at(-1).message,/해당 회의 없음|synthetic failure/);
assert.equal(logRows.at(-1)[4],'sent-calendar-unavailable');
// 한마디: 실제 발송이 성공한 뒤에만 선택 이력을 저장하고, 같은 회차 재실행은 이력을 더 쓰지 않는다.
const phraseSaves=[];
context.readBriefingPhraseCatalog_=()=>[{id:'AM-001-1'}];
context.pickBriefingPhrase_=(_props,route,day,slot)=>({id:'AM-001-1',text:'한 줄 응원',day,slot});
context.formatBriefingPhrase_=selection=>'\n\n☀️ '+selection.text;
context.markBriefingPhraseSent_=(_props,route,selection)=>phraseSaves.push({id:route.id,selection});
const beforeTrial=sent.length;
scheduledSend(true,false,'phrase-saved');
assert.equal(sent.length,beforeTrial+1);
assert.match(sent.at(-1).message,/한 줄 응원$/);
assert.equal(phraseSaves.length,1,'phrase history is written after actual successful sending');
scheduledSend(true,false,'phrase-saved');
assert.equal(phraseSaves.length,1,'duplicate sends do not consume another phrase');
context.PropertiesService=oldPropertyService;
const goodPost=context.postSlackDm_;
context.postSlackDm_=()=>{throw Error('synthetic send failure');};
assert.throws(()=>scheduledSend(true,false,'phrase-send-failure'),/synthetic send failure/);
assert.equal(phraseSaves.length,1,'failed delivery consumes no phrase');
context.postSlackDm_=goodPost;
context.readBriefingPhraseCatalog_=()=>{throw Error('broken optional phrase bank');};
const beforeOptionalFailure=sent.length;
scheduledSend(true,false,'phrase-optional-failure');
assert.equal(sent.length,beforeOptionalFailure+1,'invalid optional phrase data cannot stop the work briefing');
assert.doesNotMatch(sent.at(-1).message,/한 줄 응원|broken optional phrase bank/);

// 자기 연결 모드: 다른 PM이 ON이어도 실행 계정 본인 한 명만. 설정/정기 슬롯은 보존한다.
users[1][2]=true;users[2][2]=true;
const originalProps=context.PropertiesService.getScriptProperties();
context.PropertiesService={getScriptProperties:()=>({getProperty:key=>
  ['ENABLE_SELF_CALENDAR_PIPELINE','ENABLE_CALENDAR_BRIEFING'].includes(key)?'true':originalProps.getProperty(key)})};
let ownEmail='own@example.test';
context.Session={getEffectiveUser:()=>({getEmail:()=>ownEmail})};
context.selfCalendarRegistry_=()=>[{pm:'PM A',email:'own@example.test',slackId:'U0000000002',sendEnabled:true},
 {pm:'PM B',email:'other@example.test',slackId:'U0000000004',sendEnabled:true}];
context.buildLiveCalendarSection_=()=> '\nOWN CALENDAR';
context.refreshBotTasks=()=>({pmNames:['PM A','PM B','PM C']});
const flags=JSON.stringify(users),beforeSelf=sent.length,oldSlots=logRows.map(row=>row[1]);
context.sendMyCurrentBriefingTest();
assert.equal(sent.length,beforeSelf+1);assert.equal(sent.at(-1).id,'U0000000002');
assert.match(sent.at(-1).message,/OWN CALENDAR/);assert.doesNotMatch(sent.at(-1).message,/PM B|de_DE-fr_FR/);
assert.equal(logRows.at(-1)[1],'manual-self-current-test-v2');assert.equal(JSON.stringify(users),flags);
assert.deepEqual(logRows.slice(0,-1).map(row=>row[1]),oldSlots);
context.sendMyCurrentBriefingTest();assert.equal(sent.length,beforeSelf+1,'self test same-day duplicate blocked');
ownEmail='not-registered@example.test';let refreshes=0;
context.refreshBotTasks=()=>{refreshes++;throw Error('should not reach source refresh');};
assert.throws(()=>context.sendMyCurrentBriefingTest(),/본인 Google 계정/);assert.equal(refreshes,0);assert.equal(sent.length,beforeSelf+1);
// 아침 버전 본인 시험: 18시에 실행해도 11시 문안(오늘 회의·점심 회차)으로 본인에게만, 별도 슬롯 하루 1회.
ownEmail='own@example.test';context.refreshBotTasks=()=>({pmNames:['PM A','PM B','PM C']});
const realFormat=context.Utilities.formatDate;context.Utilities.formatDate=(d,tz,f)=>f==='HH'?'18':realFormat(d,tz,f);
let calendarSlot=null;context.buildLiveCalendarSection_=(_r,_p,slot)=>{calendarSlot=slot;return '\nOWN CALENDAR';};
const beforeMorning=sent.length;
context.sendMyMorningBriefingTest();
assert.equal(sent.length,beforeMorning+1);assert.equal(sent.at(-1).id,'U0000000002');
assert.match(sent.at(-1).message,/오전 브리핑 드립니다!/);assert.doesNotMatch(sent.at(-1).message,/마무리 브리핑|PM B/);
assert.equal(calendarSlot,'11:00','meeting section uses the morning slot');
assert.equal(logRows.at(-1)[1],'manual-self-morning-test');assert.equal(JSON.stringify(users),flags);
context.sendMyMorningBriefingTest();assert.equal(sent.length,beforeMorning+1,'morning self test once per day');
context.Utilities.formatDate=realFormat;

// 토큰 확인: auth.test만 호출하고 chat.postMessage는 부르지 않는다.
const checkLogs = [];
const fetched = [];
const tokenContext = token => vm.createContext({
  console: { log: line => checkLogs.push(line) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
  UrlFetchApp: { fetch: url => {
    fetched.push(url);
    return { getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ ok: true, team: 'Test WS', user: 'test_bot' }) };
  } },
});
const loadCheck = token => {
  const ctx = tokenContext(token);
  vm.runInContext(fs.readFileSync('src/central-bot/01_슬랙DM발송.js', 'utf8'), ctx);
  require('./test-briefing-blocks.cjs')(ctx);
  return vm.runInContext('checkSlackBotToken', ctx);
};
loadCheck('xoxb-test-only')();
assert.deepEqual(fetched, ['https://slack.com/api/auth.test']);
assert.match(checkLogs.at(-1), /봇 토큰 정상 \| 워크스페이스 Test WS \| 봇 test_bot/);
assert.doesNotMatch(checkLogs.join('\n'), /xoxb-test-only/, 'token value is never logged');
assert.throws(() => loadCheck('xoxp-user-token')(), /사용자 토큰/);
loadCheck(null)();
assert.match(checkLogs.at(-1), /SLACK_BOT_TOKEN 없음/);
assert.equal(fetched.length, 1, 'no Slack call without a bot token');
console.log('Per-PM Slack routing checks passed');
