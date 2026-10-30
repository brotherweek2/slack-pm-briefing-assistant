const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const digestUtilities = {DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest:(_algo,text)=>crypto.createHash('sha256').update(text).digest(),
  base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')};
const ctx = vm.createContext({console, Utilities:digestUtilities, BRIEFING:{timezone:'Asia/Seoul',slackChannels:['pm_team_channel']},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})}});
vm.runInContext(fs.readFileSync('src/central-bot/03_슬랙수집.js','utf8'),ctx);
// 공휴일 판단(28번)은 DayOff.test.js에서 검사한다. 여기서는 이 테스트의 평일 가짜 함수를 따른다.
ctx.briefingDayOff_ = now => ctx.isBriefingWeekday_(now) ? '' : '주말';
ctx.briefingSlotLabel_ = slot => slot;
const values = new Map();
let rows=[];
const sheet={getLastRow:()=>rows.length,clearContents:()=>{rows=[];},
  getRange:(row,col,height)=>({setValues:data=>{data.forEach((item,i)=>rows[row-1+i]=item);},
    getValues:()=>rows.slice(row-1,row-1+height)})};
ctx.PropertiesService={getScriptProperties:()=>({getProperty:key=>values.get(key)||null,
  setProperty:(key,value)=>values.set(key,value)})};
ctx.requiredProperty_=()=> 'test-workbook';
ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>sheet})};
const discovery = vm.runInContext('discoverBbpmThreads_',ctx);
const oldest = 1700000000;
let calls=[];
ctx.slackMentionReadApi_=(method,params)=>{
  calls.push({method,params});
  if(method==='conversations.info')return {channel:{name:'pm_team_channel'}};
  return {messages:[{ts:'1600000000.000001',reply_count:3,latest_reply:'1700000001.000001'},
    {ts:'1700000002.000001',text:'<@U00000001> HT 검수'},
    {ts:'1600000001.000001',reply_count:1,latest_reply:'1600000002.000001'}]};
};
let result=discovery({channel:'C00000001',token:'synthetic'},'example.slack.com',oldest,1800000000,{});
assert.equal(result.threads.length,1,'old parent with recent reply is discovered');
assert.equal(result.messages.length,1,'recent channel posts collected without requiring a thread');
assert.equal(calls[1].params.oldest,undefined,'history is not truncated at recent parent dates');
ctx.slackMentionReadApi_=()=>({channel:{name:'other'}});
assert.throws(()=>discovery({channel:'C00000001'},'example.slack.com',oldest,1800000000,{}),/pm_team_channel/);
ctx.slackMentionReadApi_=(method)=>method==='conversations.info'?{channel:{name:'pm_team_channel'}}:
  {messages:[],has_more:true};
values.clear();
assert.throws(()=>discovery({channel:'C00000001'},'example.slack.com',oldest,1800000000,{}),/불완전/);
values.clear();
let page=0;
ctx.slackMentionReadApi_=(method,params,token,budget)=>{
  budget.calls++;
  if(method==='conversations.info')return {channel:{name:'pm_team_channel'}};
  page++;
  assert.equal(params.cursor,page===1?undefined:'cursor-'+(page-1),'resume cursor advances');
  return {messages:page===1?[{ts:'1700000002.000001',text:'HT'}]:[],
    response_metadata:{next_cursor:page<25?'cursor-'+page:''}};
};
const config={channel:'C00000001',days:7};
result=discovery(config,'example.slack.com',oldest,1800000000,{calls:0,maxCalls:21});
assert.equal(result.pending,true,'spent budget checkpoints without failing');
assert.equal(page,20);
assert.equal(values.get('BBPM_COLLECT_LEASE'),'0','lease is released after a partial run');
result=discovery(config,'example.slack.com',oldest+60,1800000060,{calls:0,maxCalls:21});
assert.equal(page,25,'next invocation resumes remaining pages');
assert.equal(result.messages.length,1,'early-page candidates survive continuation');
assert.equal(result.newest,1800000000,'all pages use original cutoff');
discovery(config,'example.slack.com',oldest+120,1800000120,{calls:0});
assert.equal(page,25,'completed cache reused for fifteen minutes');
// 시간 상한: 남은 시간이 없으면 호출 없이 진행 상태로 멈춘다.
values.clear();page=0;
result=discovery(config,'example.slack.com',oldest,1800000000,{calls:0,deadline:Date.now()-1});
assert.equal(result.pending,true);
assert.equal(page,0,'expired time budget reads no history page');
// 다른 수집이 점유 중이면 겹쳐 읽지 않는다.
values.set('BBPM_COLLECT_LEASE',String(Date.now()+60000));
assert.throws(()=>discovery(config,'example.slack.com',oldest,1800000000,{calls:0}),/진행 중/);
values.clear();
// 호출 예산이 한 스레드의 중간에서 소진되어도 후보와 커서를 보존한다.
let replyRows=[];
const replySheet={getLastRow:()=>replyRows.length,clearContents:()=>{replyRows=[];},
  getRange:(row,col,height)=>({setValues:data=>{data.forEach((item,i)=>replyRows[row-1+i]=item);},
    getValues:()=>replyRows.slice(row-1,row-1+height)})};
ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>replySheet})};
const replyBatch=vm.runInContext('collectBbpmRepliesBatch_',ctx);
const props=ctx.PropertiesService.getScriptProperties();
const replyState={oldest,newest:1800000000};
const cache={props,state:replyState};
const thread=[{host:'example.slack.com',channel:'C00000001',ts:'1600000000.000001'}];
let replyCalls=0;
ctx.slackMentionReadApi_=(method,params,token,budget)=>{
  budget.calls++;replyCalls++;
  if(params.limit==='1')return {messages:[{ts:thread[0].ts,text:'HT 안내'}]};
  if(!params.cursor)return {messages:[{ts:'1700000001.000001',text:'<@U00000001> 요청'}],
    response_metadata:{next_cursor:'second-page'}};
  assert.equal(params.cursor,'second-page');
  return {messages:[{ts:'1700000002.000001',text:'추가 요청'}]};
};
let replyResult=replyBatch(cache,thread,{token:'synthetic'},{calls:38,maxCalls:40});
assert.equal(replyResult.pending,true,'budget boundary returns progress rather than throwing');
assert.equal(replyState.replyCursor,'second-page');
assert.equal(replyState.replyIndex,0);
replyResult=replyBatch(cache,thread,{token:'synthetic'},{calls:0});
assert.equal(replyCalls,3,'parent and first reply page are not read again');
assert.equal(replyResult.messages.length,3,'all cached parent/replies survive');
assert.equal(replyState.repliesComplete,true);
assert.equal(replyState.replyIndex,1);
replyBatch(cache,thread,{token:'synthetic'},{calls:0});
assert.equal(replyCalls,3,'completed reply cache is reused');
let sentSlots=[];
ctx.sendPmBriefings_=(pilot,slack,slot)=>sentSlots.push([pilot,slack,slot]);
vm.runInContext(fs.readFileSync('src/central-bot/09_자동실행.js','utf8'),ctx);
// 정기 DM과 수집은 평일에만. 공휴일은 판단하지 않는다.
ctx.Utilities=Object.assign({},digestUtilities,{formatDate:date=>new Date(date.getTime()+9*3600000).toISOString().slice(0,10)});
const weekday=vm.runInContext('isBriefingWeekday_',ctx);
assert.equal(weekday(new Date('2026-10-19T02:00:00Z')),true,'Monday');
assert.equal(weekday(new Date('2026-10-23T14:59:00Z')),true,'Friday 23:59 KST');
assert.equal(weekday(new Date('2026-10-23T15:00:00Z')),false,'Saturday 00:00 KST, still Friday in UTC');
assert.equal(weekday(new Date('2026-10-25T02:00:00Z')),false,'Sunday');
ctx.isBriefingWeekday_=()=>true;
ctx.sendScheduledBriefing11();ctx.sendScheduledBriefing17();
assert.equal(JSON.stringify(sentSlots),JSON.stringify([[true,true,'11:00'],[true,true,'17:00']]));
ctx.isBriefingWeekday_=()=>false;
ctx.sendScheduledBriefing11();ctx.sendScheduledBriefing17();
assert.equal(sentSlots.length,2,'scheduled DMs rest on weekends');
ctx.isBriefingWeekday_=()=>true;
// 완료본: 두 탭을 번갈아 쓰고, 발송은 정해진 시간 안의 완료본만 사용한다.
const tabs={};
const tabSheet=()=>{let data=[];return {getLastRow:()=>data.length,clearContents:()=>{data=[];},
  getRange:(row,col,height)=>({setValues:d=>{d.forEach((item,i)=>data[row-1+i]=item);},
    getValues:()=>data.slice(row-1,row-1+height)})};};
const bot={getSheetByName:name=>tabs[name]||null,insertSheet:name=>(tabs[name]=tabSheet())};
const kst=(date,fmt)=>new Date(date.getTime()+9*3600000).toISOString().replace('T',' ')
  .slice(fmt==='HH:mm'?11:0,16);
ctx.Utilities={formatDate:(date,_tz,fmt)=>kst(date,fmt)};
const snapScan=newest=>({newest,oldest:newest-7*86400,botId:'B00000009',members:['U00000002'],messageCount:3,
  messages:[{ts:String(newest-60)+'.000001',text:'<@U00000001> HT 검수 요청',sourceChannel:'C00000001',
    sourceHost:'example.slack.com',sourceThreadTs:'1600000000.000001',threadParentText:'HT 안내',reactions:[1]},
  {ts:String(newest-50)+'.000001',text:'멘션 없는 일반 답글',sourceChannel:'C00000001',sourceHost:'example.slack.com'},
  {ts:String(newest-40)+'.000001',text:'<!subteam^S00000001> 공지',sourceChannel:'C00000001',sourceHost:'example.slack.com',
    sourceThreadTs:String(newest-40)+'.000001'}]});
const write=vm.runInContext('writeBbpmSnapshot_',ctx),read=vm.runInContext('readBbpmSnapshot_',ctx);
const nowSec=1800000000;
assert.equal(write(bot,props,snapScan(nowSec),'S00000001'),true);
assert.equal(values.get('BBPM_SNAPSHOT_SLOT'),'A');
let snap=read(props,bot);
assert.equal(snap.messages.length,2,'messages without mentions are not stored');
assert.equal(snap.messages[0].reactions,undefined,'only fields needed for classification are stored');
assert.equal(snap.meta.groupId,'S00000001');
assert.equal(write(bot,props,snapScan(nowSec),'S00000001'),false,'same collection is not rewritten');
assert.equal(write(bot,props,snapScan(nowSec+600),'S00000001'),true);
assert.equal(values.get('BBPM_SNAPSHOT_SLOT'),'B','new snapshot goes to the other tab');
assert.equal(JSON.parse(tabs.BOT_SLACK_SNAPSHOT_A.getRange(2,1,1).getValues()[0][0]).newest,nowSec,
  'previous snapshot survives while the next one is written');
const fresh=vm.runInContext('loadFreshBbpmSnapshot_',ctx);
const at=sec=>new Date(sec*1000);
assert.equal(fresh(props,bot,at(nowSec+600+59*60)).meta.newest,nowSec+600);
assert.throws(()=>fresh(props,bot,at(nowSec+600+61*60)),error=>error.code==='STALE'&&error.lastAsOf===nowSec+600);
values.set('SLACK_SNAPSHOT_MAX_AGE_MINUTES','90');
assert.equal(fresh(props,bot,at(nowSec+600+61*60)).meta.newest,nowSec+600,'age limit is configurable');
values.delete('SLACK_SNAPSHOT_MAX_AGE_MINUTES');
values.set('SLACK_SNAPSHOT_MAX_AGE_MINUTES','not-a-number');
assert.throws(()=>fresh(props,bot,at(nowSec+600)),error=>error.code==='INVALID_CONFIG');
values.delete('SLACK_SNAPSHOT_MAX_AGE_MINUTES');
assert.throws(()=>fresh(props,bot,at(nowSec-600)),error=>error.code==='INVALID_SNAPSHOT');
values.set('SLACK_PM_GROUP_ID','S0000000001');
assert.throws(()=>fresh(props,bot,at(nowSec+600)),error=>error.code==='CONFIG_CHANGED');
values.delete('SLACK_PM_GROUP_ID');
const emptyProps={getProperty:()=>null};
assert.throws(()=>fresh(emptyProps,bot,at(nowSec)),error=>error.code==='NO_SNAPSHOT');
const records=vm.runInContext('classifySlackSnapshot_',ctx)(read(props,bot),[{pm:'PM A',id:'U00000001'},{pm:'PM B',id:'U00000002'}]);
assert.equal(JSON.stringify(records.map(item=>item.pm+':'+item.category).sort()),'["PM A:direct","PM B:group"]',
  'stored members and group ID drive classification');
// 수집 시간대: 트리거 실행은 시간대 밖이면 아무것도 하지 않는다.
const inWindow=vm.runInContext('isBbpmCollectWindow_',ctx);
const kstAt=hm=>new Date('2026-10-16T'+hm+':00+09:00');
// 10:30·14:00·17:00 회차 직전: 09:45~10:45, 13:30~14:15, 16:00~17:15
assert.equal(inWindow(kstAt('09:44')),false);
assert.equal(inWindow(kstAt('09:45')),true);
assert.equal(inWindow(kstAt('10:45')),true);
assert.equal(inWindow(kstAt('11:00')),false);
assert.equal(inWindow(kstAt('13:00')),false);
assert.equal(inWindow(kstAt('13:30')),true);
assert.equal(inWindow(kstAt('14:16')),false);
assert.equal(inWindow(kstAt('16:40')),true);
let steps=0;
ctx.runBbpmCollectStep_=()=>{steps++;return {progress:'synthetic'};};
ctx.SpreadsheetApp={openById:()=>bot};
ctx.console={log:()=>{}};
const realDate=ctx.Date;
const freezeAt=moment=>{ctx.Date=class extends Date{constructor(...a){super(...(a.length?a:[moment]));}
  static now(){return moment.getTime();}};};
freezeAt(kstAt('13:00'));
ctx.collectBbpmSnapshot({triggerUid:'t'});
assert.equal(steps,0,'trigger outside window does nothing');
freezeAt(new Date((nowSec+600+10*60)*1000));
ctx.isBbpmCollectWindow_=()=>true;
ctx.collectBbpmSnapshot({triggerUid:'t'});
assert.equal(steps,0,'trigger skips when the snapshot is newer than 25 minutes');
freezeAt(new Date((nowSec+600+30*60)*1000));
ctx.collectBbpmSnapshot({triggerUid:'t'});
assert.equal(steps,1,'trigger collects again once the snapshot is older than 25 minutes');
ctx.collectBbpmSnapshot();
assert.equal(steps,2,'manual run always collects');
ctx.isBriefingWeekday_=()=>false;
ctx.collectBbpmSnapshot({triggerUid:'t'});
assert.equal(steps,2,'trigger collection rests on weekends');
ctx.collectBbpmSnapshot();
assert.equal(steps,3,'manual collection still works on weekends');
ctx.isBriefingWeekday_=()=>true;
assert.equal(JSON.parse(values.get('BBPM_COLLECT_STATUS')).source,'manual');
ctx.runBbpmCollectStep_=()=>({pending:true,progress:'continue'});
ctx.collectBbpmSnapshot();
assert.equal(JSON.parse(values.get('BBPM_COLLECT_STATUS')).status,'pending');
ctx.runBbpmCollectStep_=()=>{throw Error('synthetic');};
assert.throws(()=>ctx.collectBbpmSnapshot(),/synthetic/);
assert.equal(JSON.parse(values.get('BBPM_COLLECT_STATUS')).status,'error');
assert.ok(values.get('BBPM_COLLECT_LAST_TRIGGER_AT'),'automatic wakeups are recorded');

// Installation is idempotent and never deletes existing triggers.
values.set('ENABLE_SLACK_MENTION_READ','true');
values.set('ENABLE_SLACK_CHANNEL_DISCOVERY','true');
let installed=[], created=0;
ctx.ScriptApp={EventType:{CLOCK:'CLOCK'},getProjectTriggers:()=>installed,
  newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{
    assert.equal(handler,'collectBbpmSnapshot');assert.equal(minutes,10);created++;
    installed.push({getHandlerFunction:()=>handler,getEventType:()=> 'CLOCK'});
  }})})})};
ctx.installBbpmCollectTrigger();ctx.installBbpmCollectTrigger();
assert.equal(created,1);
installed.push(installed[0]);
assert.throws(()=>ctx.installBbpmCollectTrigger(),/중복/);
installed.pop();
const diagnosticLogs=[];
ctx.console={log:line=>diagnosticLogs.push(line)};
freezeAt(new Date((nowSec+600+60*60+1)*1000));
const beforeState=JSON.stringify([...values]);
ctx.previewBriefingAutomationStatus();
assert.ok(diagnosticLogs.some(line=>line.includes('Slack 미리 수집(10분마다) 트리거: 1개')));
assert.ok(diagnosticLogs.some(line=>line.includes('최신성 범위 초과')),'60m1s already exceeds the limit');
assert.equal(JSON.stringify([...values]),beforeState,'diagnostic changes no settings');
ctx.Date=realDate;
console.log('Channel discovery, snapshot and scheduled routing checks passed');
