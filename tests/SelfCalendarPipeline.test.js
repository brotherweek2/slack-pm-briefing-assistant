const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const fmt = (date,zone,pattern) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g,key=>parts[{yyyy:'year',MM:'month',dd:'day',HH:'hour',mm:'minute'}[key]]);
};
const values = new Map([['ENABLE_SELF_CALENDAR_PIPELINE','true'],['CONNECTOR_SIGNING_KEY','x'.repeat(64)],
  ['SELF_CALENDAR_ALLOWED_EMAILS','["one@example.test","two@example.test"]']]);
const props = {getProperty:k=>values.get(k)||null};
const utilities = {formatDate:fmt, sleep:()=>{}, computeHmacSha256Signature:(p,k)=>crypto.createHmac('sha256',k).update(p).digest(),
  base64EncodeWebSafe:b=>Buffer.from(b).toString('base64'), getUuid:()=>crypto.randomUUID()};
let cacheRows = [['email','state_json']], createCount = 0;
const cache = {getLastRow:()=>cacheRows.length,getRange:(r,c,h=1,w=1)=>({
  getValues:()=>cacheRows.slice(r-1,r-1+h).map(row=>row.slice(c-1,c-1+w)),
  setValues:data=>data.forEach((row,i)=>cacheRows[r-1+i]=row)})};
let roster = [['One','U000000001',true,'one@example.test'],['Two','U000000002',true,'two@example.test']];
const users = {getLastRow:()=>roster.length+1,getRange:(r,c)=>({getValue:()=>c===4?'email':null,getValues:()=>roster})};
const book = {getSheetByName:n=>n==='BOT_USERS'?users:cache,
  insertSheet:()=>{createCount++;return cache;}};
const ctx = vm.createContext({Date,console,Utilities:utilities,PropertiesService:{getScriptProperties:()=>props},
  SpreadsheetApp:{openById:id=>{assert.equal(id,'allowed-bot');return book;}}, requiredProperty_:()=> 'allowed-bot',
  BOT_WORKBOOK:{usersTab:'BOT_USERS'},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
  calendarSectionTitle_:()=> '\nMEETINGS',formatCalendarBriefing_:snapshot=>JSON.stringify(snapshot)});
vm.runInContext(fs.readFileSync('src/central-bot/19_개인캘린더연결.js','utf8'),ctx);
const now = Date.now(), day=fmt(new Date(now),'Asia/Seoul','yyyy-MM-dd');
const id=crypto.randomUUID();
const request=(action='connect',extra={})=>({v:1,action,email:'one@example.test',connectionId:id,
  sentAt:now,requestId:crypto.randomUUID(),snapshot:{day,events:[{key:'meeting',title:'Own meeting',start:now+1000,end:now+60000,allDay:false,status:''}]},...extra});
const envelope=r=>{const payload=JSON.stringify(r);return {postData:{contents:JSON.stringify({payload,signature:ctx.selfCalendarSignature_(payload,'x'.repeat(64))})}};};
const r=request();
assert.equal(ctx.selfCalendarAuthenticate_(envelope(r),props,now).email,r.email);
assert.throws(()=>ctx.selfCalendarAuthenticate_({postData:{contents:'{}'}},props,now));
const modified=envelope(r);modified.postData.contents=modified.postData.contents.replace('one@example.test','two@example.test');
assert.throws(()=>ctx.selfCalendarAuthenticate_(modified,props,now),/SIGNATURE/);
assert.throws(()=>ctx.selfCalendarAuthenticate_(envelope(request('connect',{sentAt:now-120001})),props,now),/REQUEST/);
values.set('ENABLE_SELF_CALENDAR_PIPELINE','false');
assert.throws(()=>ctx.selfCalendarAuthenticate_(envelope(r),props,now),/DISABLED/);
values.set('ENABLE_SELF_CALENDAR_PIPELINE','true');
ctx.selfCalendarApply_(request('disconnect',{snapshot:null}),props);
assert.equal(cacheRows.length,1,'cleanup before first connect is idempotent and stores no meetings');
ctx.selfCalendarApply_(r,props);
assert.equal(cacheRows.length,2);
assert.throws(()=>ctx.selfCalendarApply_(r,props),/REPLAY/);
assert.throws(()=>ctx.selfCalendarApply_(request('snapshot',{sentAt:now+1,connectionId:crypto.randomUUID()}),props),/CONNECTION/);
assert.throws(()=>ctx.selfCalendarApply_(request('connect',{email:'outsider@example.test'}),props),/NOT_REGISTERED/);
assert.equal(ctx.selfCalendarFilterRoutes_([{pm:'One',id:'U000000001'},{pm:'Two',id:'U000000002'}],props).length,1);
assert.match(ctx.selfCalendarSection_({pm:'One',id:'U000000001'},props,'11:00',new Date(now)),/Own meeting/);
assert.doesNotMatch(ctx.selfCalendarSection_({pm:'Two',id:'U000000002'},props,'11:00',new Date(now)),/Own meeting/);
const otherRequest=request('connect',{email:'two@example.test',connectionId:crypto.randomUUID(),
 snapshot:{day,events:[{key:'second-only',title:'Second PM private meeting',start:now+1000,end:now+60000,allDay:false,status:''}]}});
ctx.selfCalendarApply_(otherRequest,props);
for (const slot of ['11:00','17:00']) {
 const firstText=ctx.selfCalendarSection_({pm:'One',id:'U000000001'},props,slot,new Date(now));
 const secondText=ctx.selfCalendarSection_({pm:'Two',id:'U000000002'},props,slot,new Date(now));
 assert.match(firstText,/Own meeting/);assert.doesNotMatch(firstText,/Second PM private meeting/);
 assert.match(secondText,/Second PM private meeting/);assert.doesNotMatch(secondText,/Own meeting/);
}
assert.equal(ctx.selfCalendarFilterRoutes_([{pm:'One',id:'U000000001'},{pm:'Two',id:'U000000002'}],props).length,2);
assert.equal(JSON.parse(cacheRows[1][1]).lastAutomaticAt,0,'manual connection is not proof of automatic sync');
ctx.selfCalendarApply_(request('snapshot',{sentAt:now+1,origin:'auto'}),props);
assert.equal(JSON.parse(cacheRows[1][1]).lastAutomaticAt,now+1,'only authenticated automatic sync records auto evidence');
assert.match(ctx.selfCalendarSection_({pm:'One',id:'U000000001'},props,'11:00',new Date(now+21*60000)),/갱신 지연/);
const staleSection=ctx.selfCalendarSection_({pm:'One',id:'U000000001'},props,'11:00',new Date(now+21*60000));
assert.match(staleSection,/마지막 확인/);assert.doesNotMatch(staleSection,/권한/,'staleness alone is not an authorization failure');
ctx.selfCalendarApply_(request('disconnect',{sentAt:now+2,snapshot:null}),props);
assert.equal(JSON.parse(cacheRows[1][1]).events.length,0,'disconnect removes cached meetings');
assert.equal(ctx.selfCalendarFilterRoutes_([{pm:'One',id:'U000000001'}],props).length,0);
assert.throws(()=>ctx.selfCalendarApply_(request('snapshot',{sentAt:now+3}),props),/DISCONNECTED/);
const reconnect=request('connect',{sentAt:now+4,connectionId:crypto.randomUUID()});ctx.selfCalendarApply_(reconnect,props);
assert.throws(()=>ctx.selfCalendarApply_(request('disconnect',{sentAt:now+5}),props),/CONNECTION/);
assert.throws(()=>ctx.selfCalendarValidateEvents_({day:'2000-01-01',events:[]},now),/SNAPSHOT/);
assert.throws(()=>ctx.selfCalendarValidateEvents_({day,events:[{...r.snapshot.events[0],title:'x'.repeat(301)}]},now),/EVENT/);
roster.push(['Other','U000000003',true,'one@example.test']);
// 한 줄의 중복은 그 줄들만 빼고 나머지 PM은 계속 쓴다(회차 전체를 멈추지 않음).
{const reg=ctx.selfCalendarRegistry_(props);
 assert.ok(!reg.some(row=>row.email==='one@example.test'),'duplicate email rows are excluded');
 assert.ok(reg.some(row=>row.pm==='Two'),'other PMs keep working');
 assert.equal(reg.skipped.length,2);}
roster.pop();
// Connector uses Google identity, never user-supplied email/Slack ID; mocks perform no network calls.
const userValues=new Map();
const user={getProperty:k=>userValues.get(k)||null,setProperty:(k,v)=>userValues.set(k,v),
  setProperties:o=>Object.entries(o).forEach(([k,v])=>userValues.set(k,v)),deleteProperty:k=>userValues.delete(k)};
let effective='one@example.test',active=effective,triggers=[],triggerCreations=0,sent=[];
const connectorValues = new Map([['CONNECTOR_ALLOWED_DOMAIN','example.test']]);
const c=vm.createContext({Date,console,Utilities:utilities,
  Session:{getEffectiveUser:()=>({getEmail:()=>effective}),getActiveUser:()=>({getEmail:()=>active})},
  PropertiesService:{getUserProperties:()=>user,getScriptProperties:()=>({getProperty:k=>connectorValues.get(k)||null})},
  LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t);},
    newTrigger:handler=>({timeBased:()=>({everyMinutes:()=>({create:()=>{triggerCreations++;triggers.push({getHandlerFunction:()=>handler});}})})})}});
vm.runInContext(fs.readFileSync('src/calendar-connector/01_개인회의연결.js','utf8'),c);
c.connectorSnapshot_=()=>({day,events:[]});c.connectorSend_=(...args)=>sent.push(args);
assert.equal(c.connectCalendar().connected,true);
c.connectCalendar();assert.equal(triggerCreations,1,'repeated connect retains one user trigger');
assert.equal(sent[0][1],'one@example.test');
const clockTime=new Date('2026-10-21T10:30:00+09:00');
class ClockDate extends Date { constructor(...args){super(...(args.length?args:[clockTime]));} }
c.Date=ClockDate;
c.Utilities={...utilities,formatDate:(date,zone,pattern)=>pattern==='u'?'3':fmt(date,zone,pattern)};
triggers[0].getUniqueId=()=> 'installed-user-trigger';
c.syncMyMeetings();assert.equal(sent.at(-1)[4],'manual','manual handler invocation is not automatic proof');
c.syncMyMeetings({triggerUid:'installed-user-trigger'});assert.equal(sent.at(-1)[4],'auto');
c.Date=Date;c.Utilities=utilities;
active='two@example.test';assert.throws(()=>c.connectCalendar(),/회사 계정/);active=effective;
c.disconnectCalendar();assert.equal(triggers.length,0);assert.equal(userValues.get('CONNECTED'),'false');
c.connectorSend_=()=>{throw Error('network');};
assert.throws(()=>c.connectCalendar(),/완료하지 못/);
assert.equal(userValues.get('CONNECTED'),'false');assert.equal(userValues.get('DISCONNECT_PENDING'),'true');
c.connectorSend_=(...args)=>sent.push(args);c.disconnectCalendar();
const html=fs.readFileSync('src/calendar-connector/Connect.html','utf8');
assert.ok(html.includes('textContent'));assert.ok(!html.includes('innerHTML'));assert.ok(!html.includes('SIGNING_KEY'));
const manifest=JSON.parse(fs.readFileSync('src/calendar-connector/appsscript.json','utf8'));
assert.ok(!manifest.oauthScopes.some(s=>s.includes('spreadsheets')));
assert.ok(!manifest.oauthScopes.some(s=>s.includes('tasks')));
assert.equal(createCount,0);
// 정기 발송은 기본 본인 시험을 유지하고, 관리자가 양쪽 플래그를 켠 경우에만 확대한다.
let dispatch=[];
const schedule=vm.createContext({Date,console,PropertiesService:{getScriptProperties:()=>props},
  sendPmBriefings_:(...args)=>dispatch.push(args),startConnectedBriefingRound_:slot=>dispatch.push([false,true,slot]),notifyAdminRoundSummary_:()=>{}});
vm.runInContext(fs.readFileSync('src/central-bot/09_자동실행.js','utf8'),schedule);
// 공휴일 판단(28번)은 DayOff.test.js에서 검사한다. 여기서는 이 테스트의 평일 가짜 함수를 따른다.
schedule.briefingDayOff_ = now => schedule.isBriefingWeekday_(now) ? '' : '주말';
schedule.isBriefingWeekday_=()=>true;
values.delete('ENABLE_CONNECTED_PM_SEND');schedule.sendScheduledBriefing_('11:00');
assert.equal(dispatch[0][0],true);
values.set('ENABLE_CONNECTED_PM_SEND','true');values.set('ENABLE_SELF_CALENDAR_PIPELINE','false');
assert.throws(()=>schedule.sendScheduledBriefing_('11:00'),/파이프라인/);
assert.equal(dispatch.length,1);
values.set('ENABLE_SELF_CALENDAR_PIPELINE','true');schedule.sendScheduledBriefing_('17:00');
assert.equal(dispatch[1][0],false);assert.equal(dispatch[1][2],'17:00');
console.log('Self calendar: signature, replay, isolation, disconnect, stale cache, registry, user trigger and scope checks passed');
