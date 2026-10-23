const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const fixed=new Date('2026-10-16T18:30:00+09:00');
class FixedDate extends Date { constructor(...args){super(...(args.length?args:[fixed]));} static now(){return fixed.getTime();} }
const fmt=(date,zone,pattern)=>{
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g,k=>p[{yyyy:'year',MM:'month',dd:'day',HH:'hour',mm:'minute'}[k]]);
};
const logs=[],values={PILOT_PM_NAME:'PM A',ENABLE_CALENDAR_BRIEFING:'true',ENABLE_SLACK_MENTION_READ:'true'};
const props={getProperty:key=>values[key]||null,setProperty:()=>{throw Error('preview must not write properties');}};
const ctx=vm.createContext({Date:FixedDate,console:{log:s=>logs.push(s)},BRIEFING:{timezone:'Asia/Seoul'},
  PropertiesService:{getScriptProperties:()=>props},escapeSlack_:s=>String(s),
  Utilities:{formatDate:fmt,DigestAlgorithm:{SHA_256:'sha256'},
    computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],
    base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')}});
for(const file of ['03_슬랙수집.js','12_슬랙키워드.js','04_슬랙업무분류.js','08_일별업무기록.js','07_업무브리핑.js','11_문구목록.js','10_응원문구.js','01_슬랙DM발송.js'])
  vm.runInContext(fs.readFileSync('src/central-bot/'+file,'utf8'),ctx);
require('./test-briefing-blocks.cjs')(ctx);
const stamp=String(Date.parse('2026-10-16T09:00:00+09:00')/1000)+'.000001';
const item=(name,extra={})=>({pm:'PM A',category:'direct',ts:stamp,url:'https://example.slack.com/'+name,
  text:name,kind:'데이터 검수',task:'HT',deadline:'',state:'요청・안내',...extra});
const old=item('old request'),today=item('today',{deadline:'2026-10-16까지'}),
  tomorrow=item('tomorrow',{deadline:'2026-10-17까지'}),past=item('past',{deadline:'2026-10-15까지'}),
  notice=item('old notice',{notice:true,summary:'시트 사용 재개'}),
  unknown=item('unknown',{kind:'확인 필요',needsReview:true,matchedKinds:['파일 변환']}),
  group=item('group',{category:'group'}),other=item('other',{pm:'PM B'}),
  undated=item('undated',{deadline:'퇴근 전'}),cancelled=item('cancelled',{deadline:'2026-10-16까지',needsReview:true});
const seen=[old,today,tomorrow,past,notice,undated,cancelled].map(ctx.slackDigestFingerprint_);
const all=[old,today,tomorrow,past,notice,unknown,group,other,undated,cancelled];
const morning=ctx.selectPersonalSlackItems_('PM A',all,seen,'2026-10-16','11:00');
assert.deepEqual(Array.from(morning,x=>x.text),['today','unknown','group','old request','undated']);
const evening=ctx.selectPersonalSlackItems_('PM A',all,seen,'2026-10-16','17:00');
assert.deepEqual(Array.from(evening,x=>x.text),['today','tomorrow','unknown','group','old request','undated']);
const changed={...old,text:'old request edited'};
assert.equal(ctx.selectPersonalSlackItems_('PM A',[changed],seen,'2026-10-16','11:00').length,1);
const text=ctx.formatPersonalSlackDigest_(evening,'2026-10-16','17:00');
assert.match(text,/오늘 기한/);assert.match(text,/내일 기한/);assert.match(text,/개인 · 새·변경/);assert.match(text,/BBPM · 새·변경/);
assert.match(text,/확인 필요/);assert.doesNotMatch(text,/other|old notice|cancelled/);
assert.match(text,/오늘 요청 · 이전 회차에 안내됨/);assert.match(text,/old request/);assert.doesNotMatch(text,/※/,'no separate system-style note');
assert.equal(old.previouslySent,undefined,'selection does not mutate cached source items');
const yesterday={...old,text:'yesterday request',ts:String(Date.parse('2026-10-15T09:00:00+09:00')/1000)+'.000001'};
assert.equal(ctx.selectPersonalSlackItems_('PM A',[yesterday],[ctx.slackDigestFingerprint_(yesterday)],'2026-10-16','17:00').length,0,'older already-sent undated requests are not repeated forever');
const many=Array.from({length:15},(_,i)=>item('new-'+i));
const manyText=ctx.formatPersonalSlackDigest_(ctx.selectPersonalSlackItems_('PM A',many,[],'2026-10-16','11:00'),'2026-10-16','11:00');
many.forEach(x=>assert.ok(manyText.includes(x.url+ '|'),'no newly selected link is hidden by arbitrary top-N'));
assert.match(ctx.formatPersonalSlackDigest_([],'2026-10-16','17:00'),/💬 \*Slack\*\n• 새로 온 요청·안내 없음/);

// Real read-only preview path: same work and Slack formatters as delivery, no refresh/send/ledger writes.
const row=Array(18).fill('');
Object.assign(row,{0:'PM_REVIEW|test',1:'PM A',2:'12345',3:'en_US-ja_JP',5:'HT train 검수 AGENT 완료',
  7:'2026-10-17',10:'https://docs.google.com/spreadsheets/d/test/edit#gid=1&range=J2:K2',12:true,13:new FixedDate()});
const users=[['PM A','U0000000002',true]],rows=[row];
ctx.BOT_WORKBOOK={usersTab:'BOT_USERS',tasksTab:'BOT_TASKS',userHeaders:Array(3),taskHeaders:Array(18)};
ctx.requiredProperty_=()=> 'test';ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>null})};
ctx.requireBotSheet_=(_bot,name)=>({getLastRow:()=>2,getRange:()=>({getValues:()=>name==='BOT_USERS'?users:rows})});
ctx.refreshBotTasks=()=>{throw Error('no source refresh');};ctx.postSlackDm_=()=>{throw Error('no sending');};
ctx.loadFreshBbpmSnapshot_=()=>({meta:{newest:fixed.getTime()/1000}});
ctx.classifySlackSnapshot_=()=>all;ctx.buildSlackDigestItems_=items=>items;ctx.readSlackDigestSeen_=()=>seen;
ctx.buildLiveCalendarSection_=(_route,_props,slot)=>'\n\n📅 *회의*\n• 오늘 남은 회의 없음'+(slot==='17:00'?'\n• 내일 10:00 회의 테스트':'');
ctx.previewMyMorningBriefing();
const am=logs.at(-2);
assert.match(am,/오전 브리핑 드립니다! \(미리보기\)/);assert.match(am,/오늘 확인할 업무/);assert.match(am,/프로젝트 12345/);
assert.doesNotMatch(am,/• 내일 10:00|내일 기한/);
assert.match(am,/_미리보기 · 업무/,'preview shows the basis line');
assert.match(am.split('\n').at(-1),/^> /,'phrase is the last line');
assert.ok(am.indexOf('_미리보기 · 업무')<am.indexOf('점심 추천')||!/점심 추천/.test(am),'basis line closes the information part');
assert.match(am,/^☀️ /,'morning preview includes one phrase without committing history');
ctx.previewMyEveningBriefing();
const pm=logs.at(-2);
assert.match(pm,/^🌙 [\s\S]*마무리 브리핑 드립니다! \(미리보기\)/);assert.match(pm,/마무리 전 확인할 업무/);
assert.match(pm,/• 내일 10:00 회의 테스트/);assert.match(pm,/내일 기한/);
assert.ok(pm.indexOf('마무리 전 확인할 업무')<pm.indexOf('📅 *회의*'));
assert.ok(pm.indexOf('📅 *회의*')<pm.indexOf('💬 *Slack*'));
assert.doesNotMatch(pm,/PM B|old notice/);assert.match(pm,/오늘 요청 · 이전 회차에 안내됨/);
assert.match(pm.split('\n').at(-1),/^> /,'evening preview ends with its own phrase');
ctx.loadFreshBbpmSnapshot_=()=>{throw Object.assign(new Error('stale'),{code:'STALE',lastAsOf:fixed.getTime()/1000-7200});};
ctx.previewMyEveningBriefing();
assert.match(logs.at(-2),/최신성 기준을 초과함/);
assert.doesNotMatch(logs.at(-2),/새로 온 요청·안내 없음/,'read failure cannot become no issues');
console.log('Morning/evening selection, source dates, all links, recipient isolation and read-only previews passed');
