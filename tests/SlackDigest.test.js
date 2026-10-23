const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ctx = vm.createContext({
  console, escapeSlack_: value => String(value),
  BRIEFING: {timezone:'Asia/Seoul'},
  Utilities: { DigestAlgorithm: { SHA_256: 'sha256' },
    formatDate: () => '2026-10-15',
    computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()],
    base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') },
});
for (const file of ['03_슬랙수집.js', '12_슬랙키워드.js', '04_슬랙업무분류.js']) {
  vm.runInContext(fs.readFileSync('src/central-bot/' + file, 'utf8'), ctx);
}
const record = (text, extra = {}) => Object.assign({ pm: 'PM A', category: 'direct',
  ts: '1790000000.000001', text, threadKey: 'C00000001|1790000000.000001',
  url: 'https://example.slack.com/archives/C00000001/p1790000000000001' }, extra);
const classify = ctx.classifySlackDigest_;
assert.equal(classify(record('감사합니다!')), null);
assert.equal(classify(record('죄송합니다!')), null);
const correction = classify(record('언급이 누락되었습니다. 죄송합니다!',
  { threadParentText: 'MTPE 검수 일정\n기한: 10/15\n2차 기한: 10/16' }));
assert.equal(correction.kind, '대상 확인');
assert.equal(correction.task, 'MTPE·스레드 문맥');
assert.equal(correction.deadline, '', 'correction does not inherit another assignee deadline');
const fileContext = classify(record('언급이 누락되었습니다. 죄송합니다!', {
  threadParentText: '[MTPE 1차 납품 대상 파일 검수 일정]\n대상 파일: lct-99-example\n기한: 10/15',
}));
assert.equal(fileContext.task, 'MTPE·스레드 문맥', 'dataset LCT prefix is not a second task');
assert.equal(fileContext.deadline, '', 'title context does not inherit deadlines');
assert.match(fileContext.contextTitle, /MTPE 1차 납품 대상 파일 검수 일정/);
assert.match(fileContext.detail, /언급이 누락/);
const policy = classify(record('검수 업무 할당 공지. 업무 역량을 종합적으로 고려합니다.',
  { category: 'group', threadParentText: 'MTPE 검수 일정' }));
assert.equal(policy.kind, '운영 기준');
assert.equal(policy.task, '공통 운영', 'policy does not inherit specific work assignment');
assert.match(policy.detail, /업무 역량/);
assert.equal(policy.contextTitle, '', 'generic policy does not adopt MTPE parent title');
assert.equal(classify(record('HA-CV 작업자 상태 확인 부탁드립니다.')).kind, '배치·할당·가용');
assert.equal(classify(record('HT 검수 파일 오류로 접근 불가')).kind, '진행 문제');
assert.equal(classify(record('HA-CV 시트 사용 중지 및 담당 재배정')).kind, '운영 변경');
assert.equal(classify(record('MTPE 마감 일정 변경: 10/16')).kind, '일정 변경');
assert.equal(classify(record('HT 검수 세션 참석 부탁드립니다.')).kind, '회의·세션');
const minutes = classify(record('[NAC Scrum 일정 안내 및 회의록 작성 요청]\n회의 전 작성 부탁드립니다.\nHA-CV 진행 내용과 검수 피드백 참고',
  {ts:'1791859077.256619'}));
assert.equal(minutes.kind, '회의록 작성', 'explicit meeting action wins over incidental review keywords');
assert.equal(minutes.task, 'NAC Scrum', 'meeting subject does not inherit an incidental project');
assert.equal(classify(record('[HT 검수 요청]\n회의록 내용을 참고하여 1차 검수 부탁드립니다.')).kind, '데이터 검수');
assert.equal(ctx.slackDigestPostedAt_('1791859077.256619'), '10/13');
assert.equal(ctx.slackDigestPostedAt_('1767223800.000001'), '01/01');
assert.equal(ctx.slackDigestPostedAt_(''), '');
assert.match(ctx.formatSlackDigestSections_('PM A', [minutes]), /NAC Scrum · 회의록 작성> · 원문 10\/13(?:\n|$)/);
const pause = classify(record('잠시 시트 사용을 중지해주시면 감사하겠습니다. 전달 감사합니다!'));
const resume = classify(record('복구 완료하여 시트 사용 가능합니다! 감사합니다.'));
assert.equal(pause.kind, '운영 변경', 'actionable notice survives thanks filter');
assert.equal(resume.kind, '운영 변경', 'availability notice survives thanks filter');
assert.match(resume.summary, /사용 재개/);
const guide = classify(record('[자동화 플러그인 공유 및 활용 안내]\nHA-CV 1차 검수 피드백과 할당 상태를 참고합니다. 사용해 주세요.'));
assert.equal(guide.kind, '도구·사용 안내');
assert.equal(guide.task, '작업명 확인 필요');
assert.doesNotMatch(ctx.formatSlackDigestSections_('PM A',[guide]), /오늘 먼저 확인/);
assert.equal(classify(record('HACV_Hub 신규 유저 투입 및 레벨 부여 부탁드립니다. 헤즈업 탭도 확인 부탁드립니다.')).kind,
  '예비 작업자 검토·헤즈업');
const abuseRequest = classify(record('HA-CV 담당 재배정 이후 어뷰저 목록 작성 요청'));
assert.equal(abuseRequest.kind, '어뷰저 관리', 'abuse action takes precedence over reassignment context');
const completedNotice = classify(record('HA-CV 중앙 탭 담당 변경 완료'));
assert.equal(completedNotice.kind, '운영 변경', 'operational completion stays as a notice');
const noticeText = ctx.formatSlackDigestSections_('PM A', [completedNotice]);
assert.match(noticeText, /업무별 링크 모음[\s\S]*운영 안내/);
assert.doesNotMatch(noticeText, /오늘 먼저 확인/, 'completed operational notices do not receive action priority');
assert.match(noticeText, /<https:[^>]+\|HA-CV · 담당자 재배정 완료>/);
assert.doesNotMatch(noticeText, /관련 공지|기한:|내용:/, 'operational notice is keyword and link only');
const participation = classify(record('아직 참여하지 않은 사용자는 오늘 퇴근 전까지 참여 부탁드립니다.'));
assert.equal(participation.summary, '미참여자 참여 요청');
assert.equal(participation.deadline, '오늘 퇴근 전');
const deadlineText = ctx.formatSlackDigestSections_('PM A', [participation]);
assert.equal((deadlineText.match(/퇴근 전/g) || []).length, 1, 'deadline shown once');
assert.match(ctx.formatSlackDigestSections_('PM A', [abuseRequest]), /어뷰저 관리/);
assert.equal(classify(record('HT MTPE HA-CV 검수 안내')).task, '여러 작업');
const unknown = classify(record('새 절차의 입력 항목을 준비해 주세요.'));
assert.equal(unknown.kind, '확인 필요');
assert.equal(unknown.needsReview, true);
const unknownText = ctx.formatSlackDigestSections_('PM A', [unknown]);
assert.match(unknownText, /\|확인 필요>/);
assert.doesNotMatch(unknownText, /새 절차의 입력 항목/, 'comments are not printed in keyword output');
assert.ok(unknownText.includes(unknown.url), 'uncertain items keep their source link');
assert.doesNotMatch(unknownText, /작업명 확인 필요/, 'avoid duplicate uncertainty labels');
const compactAbuse = classify(record('HA-CV 어뷰저 작성 요청. 언어쌍 재배정 전 자료를 확인해 주세요.',
  {threadParentText:'HA-CV 운영 안내'}));
const compactText = ctx.formatSlackDigestSections_('PM A', [compactAbuse]);
assert.match(compactText, /HA-CV · 어뷰저 관리 · 이전 담당 기준/);
assert.doesNotMatch(compactText, /자료를 확인해 주세요|관련 공지|내용:|스레드 문맥/);
assert.match(ctx.formatSlackDigestSections_('PM A', [policy]), /검수 배정 기준/);
const mixed = classify(record('HT MTPE HA-CV 검수 안내'));
assert.equal(mixed.kind, '확인 필요', 'multiple works are not forced into one assignment');
assert.equal(classify(record('HA-CV 재검수 불필요, 기준 미정')).kind, '확인 필요');
const review = classify(record('HT en_US-ko_KR 파일 검수 요청\n마감: 10/15 오후 5시까지'));
assert.equal(review.task, 'HT');
assert.equal(review.pairs, 'en_US-ko_KR');
assert.equal(review.deadline, '10/15 오후 5시까지');
const multiple = classify(record('MTPE 1차 검수\n마감 기한: 10/15\n2차 마감 기한: 10/16'));
assert.equal(multiple.deadline, '기한 여러 개 — 원문 확인');
assert.equal(classify(record('검수 요청', { threadParentText: 'HT MTPE 일정' })).task, '작업명 확인 필요');
assert.equal(classify(record('<https://example.test/HT|자료> 확인 요청')).task, '작업명 확인 필요');
const data = [record('HT 검수 요청'), record('HT 검수 요청'),
  record('MTPE 검수 요청', { category: 'group' }), record('고맙습니다 감사합니다')];
const items = ctx.buildSlackDigestItems_(data);
assert.equal(items.length, 2, 'same thread and substantive content collapse');
const repeated = ctx.buildSlackDigestItems_([
  record('HA-CV 어뷰저 작성 요청. 재배정 **전** 자료 확인', {ts:'1790000000.000001',url:'https://example.test/first'}),
  record('HA-CV en_US-ko_KR 어뷰저 작성 부탁드립니다. 마감: 10/15까지',
    {ts:'1790000001.000001',url:'https://example.test/second'}),
  record('HA-CV de_DE-fr_FR 어뷰저 작성 요청. 마감: 10/15까지',
    {ts:'1790000002.000001',url:'https://example.test/latest'}),
]);
assert.equal(repeated.length,1,'repeated same-thread work becomes one briefing item');
assert.equal(repeated[0].mergedCount,3);
assert.equal(repeated[0].url,'https://example.test/latest','latest source reply is linked');
assert.match(repeated[0].pairs,/en_US-ko_KR/);
assert.match(repeated[0].pairs,/de_DE-fr_FR/);
assert.equal(repeated[0].deadline,'10/15까지');
assert.match(ctx.formatSlackDigestSections_('PM A',repeated),/이전 담당 기준/);
const changedDue = ctx.buildSlackDigestItems_([
  record('HT 검수 요청. 마감: 10/15까지'),
  record('HT 검수 요청. 마감: 10/16까지',{url:'https://example.test/changed'}),
]);
assert.equal(changedDue[0].deadline,'기한 여러 개 — 원문 확인','conflicting dates are not resolved by guessing');
assert.equal(ctx.buildSlackDigestItems_([
  record('HT 프로젝트 12345 검수 요청'),record('HT 프로젝트 67890 검수 요청'),
]).length,2,'different projects stay separate');
assert.equal(ctx.buildSlackDigestItems_([
  record('HA-CV 6차 납품 어뷰저 작성 요청'),record('HA-CV 7차 납품 어뷰저 작성 요청'),
]).length,2,'different delivery rounds stay separate');
assert.equal(ctx.buildSlackDigestItems_([
  record('HA-CV 6차 납품 어뷰저 작성 요청'),
  record('HA-CV 6차 납품 어뷰저 작성 요청. test.web 및 sms.short 배치 참고'),
]).length,1,'incidental worker batch keywords do not duplicate an abuse reminder');
const mixedHeading = ctx.formatSlackDigestSections_('PM A', [
  classify(record('HA-CV 어뷰저 작성 요청')),classify(record('HA-CV 검수 요청')),
]);
assert.match(mixedHeading,/어뷰저 관리/);
assert.match(mixedHeading,/데이터 검수/);
assert.doesNotMatch(mixedHeading,/\*어뷰저 관리 요청\*/);
const broadPairs = Object.assign({}, repeated[0], {pairs:'en_US-ko_KR, de_DE-fr_FR, ja_JP-en_US'});
const broadText = ctx.formatSlackDigestSections_('PM A',[broadPairs]);
assert.match(broadText,/언어쌍 3개/);
assert.doesNotMatch(broadText,/외 1|en_US-ko_KR|de_DE-fr_FR/,'broad source lists do not appear as personal assignments');
assert.equal(ctx.buildSlackDigestItems_([
  record('HT 검수 요청'),record('HT 검수 요청',{category:'group'}),
  record('HT 검수 요청',{threadKey:'other-thread'}),
]).length,3,'recipient category and source thread remain distinct');
const formatted = ctx.formatSlackDigestSections_('PM A', items);
assert.match(formatted, /\[개인\]/);
assert.match(formatted, /\[BBPM\]/);
assert.match(formatted, /오늘 먼저 확인/);
assert.match(formatted, /업무별 링크 모음/);
const many = Array.from({ length: 5 }, (_, index) => classify(record('HT 파일 ' + index + ' 검수 요청',
  { url: 'https://example.test/' + index })));
const allLinks = ctx.formatSlackDigestSections_('PM A', many);
many.forEach(item=>assert.ok(allLinks.includes(item.url),'every retained item has a visible source link'));
assert.doesNotMatch(allLinks,/추가 확인 시작|외 \d+건/);
const todayItem = classify(record('MTPE 프로젝트 23456 검수 요청. 기한: 2026-10-15 오후 5시까지'));
const earlierItem = classify(record('HA-CV 어뷰저 작성 요청. 기한: 2026-10-13까지'));
const priorityText = ctx.formatSlackDigestSections_('PM A', [earlierItem,todayItem],{day:'2026-10-15'});
assert.ok(priorityText.indexOf('오늘 마감')<priorityText.indexOf('기한 경과·상태 확인'));
assert.match(priorityText,/오늘 마감 · \[개인\]/);
const mixedNoticeText=ctx.formatSlackDigestSections_('PM A',[completedNotice,todayItem],{day:'2026-10-15'});
assert.ok(mixedNoticeText.indexOf('오늘 마감')<mixedNoticeText.indexOf('업무별 링크 모음'));
assert.ok(mixedNoticeText.indexOf('업무별 링크 모음')<mixedNoticeText.indexOf('담당자 재배정 완료'));
const infoChange=classify(record('MTPE 마감 일정 변경: 10/16',{category:'group'}));
assert.doesNotMatch(ctx.formatSlackDigestSections_('PM A',[infoChange]),/오늘 먼저 확인/,
  'a schedule change without a request stays in the link collection');
const actionChange=classify(record('MTPE 마감 일정 변경 확인 부탁드립니다.',{category:'group'}));
assert.match(ctx.formatSlackDigestSections_('PM A',[actionChange]),/변경 요청/);
assert.equal(ctx.slackDigestDueDay_({deadline:'퇴근 전',ts:todayItem.ts}),'','no date is inferred from time only');
assert.equal(ctx.slackDigestDueDay_({deadline:'2026-02-30까지',ts:todayItem.ts}),'','invalid dates not prioritized');
assert.equal(ctx.slackDigestDueDay_({deadline:'내일까지',ts:String(Date.parse('2026-10-14T01:00:00Z')/1000)}),
  '2026-10-15','relative deadline anchored to source message day');
const sentText = ctx.formatSlackDigestSections_('PM A',[todayItem],{day:'2026-10-15',seen:[ctx.slackDigestFingerprint_(todayItem)]});
assert.match(sentText,/새 항목 0건/);
assert.match(sentText,/읽음 여부와 다름/);
const store = {};
const props = { getProperty: key => store[key], setProperty: (key, value) => { store[key] = value; } };
assert.equal(ctx.readSlackDigestSeen_(props, 'U00000001').length, 0);
ctx.markSlackDigestSeen_(props, 'U00000001', [], items);
assert.equal(ctx.readSlackDigestSeen_(props, 'U00000001').length, 2);
assert.notEqual(ctx.slackDigestFingerprint_(items[0]), ctx.slackDigestFingerprint_({ ...items[0], text: 'HT 수정본 검수 요청' }));
assert.doesNotMatch(JSON.stringify(store), /검수 요청|example/, 'ledger contains hashes only');
console.log('Slack digest category, context, brevity and history checks passed');
const cases = [
  ['HA-CV 헤즈업 대상에게 메일 발송 요청', '헤즈업·참여 확인'],
  ['HACV 신규 유저 Advanced 5 레벨 부여 요청', '예비 작업자·레벨 검토'],
  ['HT 테스트지 생성 완료, 검토 부탁드립니다', '테스트지 검토'],
  ['HT 파일 변환 요청', '파일 변환'],
  ['HA-CV 캐시아웃 어뷰저 리스트 작성 요청', '어뷰저 관리'],
  ['MTPE 추가 구인과 인재풀 확보 요청', '추가 구인·인재풀'],
  ['HA-CV sms.short 추가 할당 요청', '배치·할당·가용'],
  ['HA-CV 검수 보류 후 기준 확인', '보류·중지·재개'],
  ['HA-CV Findings와 Suggested Score 가이드라인 참고', '검수 기준·품질'],
  ['HT 납품 일정 및 최종 납품 안내', '납품·구축 종료'],
];
cases.forEach(([text, expected]) => assert.equal(classify(record(text)).kind, expected, text));
assert.equal(classify(record('HT LID 요청')), null, 'LID-only task excluded');
assert.doesNotMatch(classify(record('HT LID 및 파일 변환 요청')).summary, /\bLID\b/i);
assert.equal(classify(record('HT 검수 완료했습니다')), null);
assert.notEqual(classify(record('HT 검수 완료 후 파일 제출 부탁드립니다')), null);
assert.notEqual(classify(record('검수 AGENT 완료, HT 1차 검수 필요')), null);
assert.match(classify(record('HA-CV 재검수 불필요, 기준 미정')).state, /문맥 확인/);
assert.deepEqual(Array.from(ctx.slackDigestWorkNames_('HA Commentary Validation')), ['HA-CV']);
assert.deepEqual(Array.from(ctx.slackDigestWorkNames_('https://example.test/HT')), []);
assert.equal(ctx.slackKeywordMatches_('Unbanned', 'BAN'), false);
assert.equal(ctx.slackKeywordMatches_('할당완료', '할당 완료'), true);
assert.throws(() => ctx.validateSlackKeywordRows_([['category', 'x', '검수', 1, 'TRUE', 'test']]), /사용 여부/);
const disabled = ctx.validateSlackKeywordRows_([['category', 'x', '검수', 1, false, 'test']]);
assert.equal(disabled[0].enabled, false);
vm.runInContext('slackKeywordRulesCache_ = validateSlackKeywordRows_([["category", "사용자 추가", "특수 요청", 1, true, "test"]]);', ctx);
assert.equal(classify(record('특수 요청 확인 바랍니다')).kind, '사용자 추가', 'edited sheet rules drive classification');
console.log('Expanded PM keyword coverage and editable rules checks passed');
// 저장 결과 미리보기는 새 history/replies 요청 없이 캐시를 현재 문안으로 분류한다.
const savedLogs = [], savedApi = [];
ctx.console = {log:line=>savedLogs.push(line)};
ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
const savedState={complete:true,repliesComplete:true,channel:'C00000001',
  host:'example.slack.com',oldest:1789999900,newest:1790000100};
ctx.PropertiesService={getScriptProperties:()=>({getProperty:key=>
  key==='ENABLE_SLACK_MENTION_READ'?'true':key==='BBPM_DISCOVERY_CHECKPOINT'?JSON.stringify(savedState):null})};
ctx.readSlackMentionConfig_=()=>({channel:'C00000001',token:'synthetic',groupId:'S00000001'});
ctx.slackMentionReadApi_=method=>{
  savedApi.push(method);
  if(method==='auth.test')return {url:'https://example.slack.com/',bot_id:'B00000001'};
  if(method==='usergroups.users.list')return {users:['U00000001']};
  throw new Error('must not collect new messages');
};
const cachedMessage={ts:'1790000000.000001',text:'<@U00000001> HA-CV 담당 변경 완료'};
ctx.SpreadsheetApp={openById:()=>({getSheetByName:name=>name==='BOT_SLACK_DISCOVERY_CACHE'?
  {getLastRow:()=>2,getRange:()=>({getValues:()=>[[cachedMessage.ts,JSON.stringify(cachedMessage)]]})}:
  name==='BOT_SLACK_REPLY_CACHE'?{getLastRow:()=>1}:null})};
ctx.requiredProperty_=()=> 'synthetic-workbook';
ctx.BOT_WORKBOOK={usersTab:'BOT_USERS',userHeaders:Array(3)};
ctx.requireBotSheet_=()=>({getLastRow:()=>2,getRange:()=>({getValues:()=>[['PM A','U00000001',false]]})});
ctx.readBotRows_=sheet=>sheet.getRange().getValues();
ctx.Utilities.formatDate=()=> '2026-10-14 18:31';
ctx.BRIEFING={timezone:'Asia/Seoul'};
vm.runInContext('slackKeywordRulesCache_ = null;',ctx);
// 완료본이 없으면 예전 캐시로 대체하지 않고, 수집 함수를 안내하며 멈춘다(구 캐시 호환 제거 10/23).
assert.throws(()=>ctx.previewSavedSlackBriefings(),/collectBbpmSnapshot/);
assert.deepEqual(savedApi,[],'no Slack call without a snapshot');
// 완료본이 있으면 Slack API 없이 완료본으로 분류한다.
savedLogs.length = 0; savedApi.length = 0;
const snapRows = [[JSON.stringify({newest:1790000100,oldest:1789999900,botId:'B00000009',groupId:'S00000001',
  members:['U00000001'],messageCount:5})],[JSON.stringify(Object.assign({},cachedMessage,
  {sourceChannel:'C00000001',sourceHost:'example.slack.com',sourceThreadTs:cachedMessage.ts,threadParentText:''}))]];
ctx.PropertiesService={getScriptProperties:()=>({getProperty:key=>
  key==='ENABLE_SLACK_MENTION_READ'?'true':key==='BBPM_SNAPSHOT_SLOT'?'A':null})};
ctx.SpreadsheetApp={openById:()=>({getSheetByName:name=>name==='BOT_SLACK_SNAPSHOT_A'?
  {getLastRow:()=>3,getRange:()=>({getValues:()=>snapRows})}:null})};
ctx.previewSavedSlackBriefings();
assert.deepEqual(savedApi,[],'snapshot preview makes no Slack call');
assert.match(savedLogs.join('\n'),/운영 안내/);
assert.match(savedLogs.join('\n'),/Slack 완료본 기준: 2026-10-14 18:31 \| 조회 메시지 5개/);
console.log('Snapshot presentation checks passed');
