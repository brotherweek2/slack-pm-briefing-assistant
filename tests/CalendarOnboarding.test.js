const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function fixture(previouslyEnabled=false){
 let clock=Date.parse('2026-10-21T10:55:00+09:00'),loseNotice=false,loseActivation=false;
 class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const format=(date,zone,pattern)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));return pattern.replace(/yyyy|MM|dd|HH|mm/g,k=>p[{yyyy:'year',MM:'month',dd:'day',HH:'hour',mm:'minute'}[k]]);};
 const utility={formatDate:format,getUuid:()=>crypto.randomUUID(),sleep:ms=>clock+=ms,
  newBlob:text=>({getBytes:()=>Buffer.from(text)}),DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest:(_,text)=>crypto.createHash('sha256').update(text).digest(),
  computeHmacSha256Signature:(text,key)=>crypto.createHmac('sha256',key).update(text).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')};
 const storage=initial=>{const map=new Map(Object.entries(initial));return {map,getProperty:k=>map.get(k)||null,setProperty:(k,v)=>map.set(k,v),
  setProperties:o=>Object.entries(o).forEach(([k,v])=>map.set(k,v)),getProperties:()=>Object.fromEntries(map),deleteProperty:k=>map.delete(k)};};
 const props=storage({BOT_SPREADSHEET_ID:'synthetic-bot',BRIEFING_EXECUTOR_EMAIL:'admin@example.test',
  ENABLE_PM_SEND:'true',ENABLE_CONNECTED_PM_SEND:'true',ENABLE_SELF_CALENDAR_PIPELINE:'true',ENABLE_CALENDAR_BRIEFING:'true',
  ENABLE_CALENDAR_SELF_ENROLLMENT:'true',CALENDAR_ONBOARDING_READY:'true',CONNECTOR_SIGNING_KEY:'x'.repeat(64),
  CALENDAR_CONNECT_URL:'https://script.google.com/macros/s/synthetic-connector/exec',CALENDAR_INVITE_PM_NAMES:'["PM One"]',
  SELF_CALENDAR_ALLOWED_EMAILS:'["one@example.test","two@example.test"]',SLACK_BOT_TOKEN:'synthetic-token'});
 const values=[['pm_name','slack_user_id','send_enabled','email'],['PM One','U000000001',previouslyEnabled,'one@example.test'],['PM Two','U000000002',false,'two@example.test']];
 const makeSheet=rows=>({rows,getLastRow:()=>rows.length,getRange:(r,c,h=1,w=1)=>({
  getValues:()=>rows.slice(r-1,r-1+h).map(row=>Array.from({length:w},(_,i)=>row[c-1+i])),
  getValue:()=>rows[r-1]&&rows[r-1][c-1],setValue:value=>{rows[r-1][c-1]=value;},
  setValues:data=>data.forEach((row,i)=>{if(!rows[r-1+i])rows[r-1+i]=[];row.forEach((value,j)=>rows[r-1+i][c-1+j]=value);})})});
 const sheets={BOT_USERS:makeSheet(values)};
 const bot={getSheetByName:name=>sheets[name]||null,insertSheet:name=>sheets[name]=makeSheet([])};
 const messages=[],logs=[];
 const central=vm.createContext({Date:Clock,console:{log:m=>logs.push(m)},BRIEFING:{timezone:'Asia/Seoul',slackPostUrl:'https://slack.invalid/synthetic'},
  BOT_WORKBOOK:{bootstrapId:'synthetic-bot',usersTab:'BOT_USERS'},Utilities:utility,
  PropertiesService:{getScriptProperties:()=>props},SpreadsheetApp:{openById:id=>{assert.equal(id,'synthetic-bot');return bot;}},
  Session:{getEffectiveUser:()=>({getEmail:()=> 'admin@example.test'})},
  LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
  ScriptApp:{getProjectTriggers:()=>['sendScheduledBriefing11','sendScheduledBriefing14','sendScheduledBriefing17'].map(name=>({getHandlerFunction:()=>name}))},
  UrlFetchApp:{fetch:(_url,options)=>{const payload=JSON.parse(options.payload);messages.push(payload);
    if(loseNotice&&payload.text.startsWith('✅')){loseNotice=false;throw Error('accepted but response lost');}
    return {getResponseCode:()=>200,getContentText:()=>'{"ok":true}'};}}});
 for(const name of ['14_공통설정.js','19_개인캘린더연결.js','21_캘린더연결초대.js'])vm.runInContext(fs.readFileSync('src/central-bot/'+name,'utf8'),central);
 const connector=email=>{
  const user=storage({}),script=storage({CONNECTOR_ALLOWED_DOMAIN:'example.test',CONNECTOR_SIGNING_KEY:'x'.repeat(64),
    CONNECTOR_RECEIVER_URL:'https://script.google.com/macros/s/synthetic-receiver/exec'});let triggers=[];
  const ctx=vm.createContext({Date:Clock,console,Math,Utilities:utility,
   PropertiesService:{getScriptProperties:()=>script,getUserProperties:()=>user},
   Session:{getEffectiveUser:()=>({getEmail:()=>email}),getActiveUser:()=>({getEmail:()=>email})},
   LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
   ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>triggers=triggers.filter(x=>x!==t),
    newTrigger:name=>({timeBased:()=>({everyMinutes:()=>({create:()=>triggers.push({getHandlerFunction:()=>name})})})})},
   UrlFetchApp:{fetch:(_url,options)=>{clock+=10;const request=JSON.parse(JSON.parse(options.payload).payload);
     if(request.action==='activate'){assert.equal(triggers.length,1);assert.equal(user.getProperty('CONNECTED'),'true');}
     const result=central.doPost({postData:{contents:options.payload}});
     if(request.action==='activate'&&loseActivation){loseActivation=false;throw Error('activation response lost');}
     return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(result)};}}});
  vm.runInContext(fs.readFileSync('src/calendar-connector/01_개인회의연결.js','utf8'),ctx);
  ctx.connectorSnapshot_=()=>({day:format(new Clock(),'Asia/Seoul','yyyy-MM-dd'),events:[{key:'own',title:'Own meeting',start:clock+60000,end:clock+120000,allDay:false,status:'',source:'personal',audience:'personal'}],
    sources:['personal','schedule','review','holidays'].map(key=>({key,status:'ok',count:1}))});
  return {ctx,user,triggers:()=>triggers};
 };
 return {central,props,values,messages,logs,connector,loseNotice:()=>loseNotice=true,loseActivation:()=>loseActivation=true};
}
let f=fixture();f.central.previewCalendarConnectionInvites();assert.equal(f.messages.length,0);
f.central.sendCalendarConnectionInvites();assert.equal(f.messages.length,1);assert.equal(f.messages[0].channel,'U000000001');
assert.match(f.messages[0].text,/synthetic-connector\/exec/);assert.equal(f.values[1][2],false,'invite alone does not activate delivery');
f.central.sendCalendarConnectionInvites();assert.equal(f.messages.length,1,'repeat invite is blocked');
const one=f.connector('one@example.test');const status=one.ctx.connectCalendar();
assert.equal(status.connected,true);assert.equal(status.slackLinked,true);assert.equal(status.slackNotice,'sent');
assert.equal(f.values[1][2],true);assert.equal(f.values[2][2],false);assert.equal(one.triggers().length,1);
assert.equal(f.messages.length,2);assert.equal(f.messages[1].channel,'U000000001');assert.match(f.messages[1].text,/連|연결이 완료/);
one.ctx.connectCalendar();assert.equal(f.messages.length,2,'same session confirmation is not repeated');
const two=f.connector('two@example.test');assert.equal(two.ctx.connectCalendar().slackLinked,false);
assert.equal(f.values[2][2],false,'registered but not invited user cannot self-enable');assert.equal(f.messages.length,2);
one.ctx.disconnectCalendar();assert.equal(f.values[1][2],false);assert.equal(one.triggers().length,0);
f=fixture(true);f.central.sendCalendarConnectionInvites();const previous=f.connector('one@example.test');previous.ctx.connectCalendar();previous.ctx.disconnectCalendar();
assert.equal(f.values[1][2],true,'disconnect preserves pre-existing delivery setting');
f=fixture();f.central.sendCalendarConnectionInvites();f.loseNotice();const uncertain=f.connector('one@example.test');
const result=uncertain.ctx.connectCalendar();assert.equal(result.connected,true);assert.equal(result.slackLinked,true);
assert.equal(result.slackNotice,'uncertain');assert.equal(f.values[1][2],true);
uncertain.ctx.connectCalendar();assert.equal(f.messages.length,2,'confirmation response loss cannot duplicate the DM');
f=fixture();f.central.sendCalendarConnectionInvites();f.loseActivation();const lostActivation=f.connector('one@example.test');
assert.equal(lostActivation.ctx.connectCalendar().connected,true);assert.equal(f.values[1][2],true);
assert.equal(lostActivation.user.getProperty('ACTIVATION_PENDING'),'true');
assert.equal(lostActivation.ctx.refreshCalendar().slackLinked,true);assert.equal(f.messages.length,2,'activation response loss is recovered without another confirmation');
f=fixture();f.props.setProperty('CALENDAR_ONBOARDING_READY','false');assert.throws(()=>f.central.sendCalendarConnectionInvites(),/배포/);assert.equal(f.messages.length,0);
f=fixture();f.props.setProperty('CALENDAR_CONNECT_URL','https://example.test/not-a-deployed-link');assert.throws(()=>f.central.sendCalendarConnectionInvites(),/배포/);assert.equal(f.messages.length,0);
console.log('Actual onboarding functions: invite DM -> own Google identity -> trigger -> activation -> own confirmation DM, isolation, duplicate/lost-response and disconnect passed');
f=fixture();
f.props.setProperty('CALENDAR_CONNECT_URL','https://script.google.com/a/macros/example.test/s/synthetic-connector/exec');
f.central.previewCalendarConnectionInvites();assert.equal(f.messages.length,0);
for(const url of ['https://script.google.com.evil.test/macros/s/fake/exec','https://script.google.com/a/macros/example.test/s/fake/dev']) {
 f.props.setProperty('CALENDAR_CONNECT_URL',url);assert.throws(()=>f.central.previewCalendarConnectionInvites(),/배포/);
}
