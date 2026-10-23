const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const fileId='synthetic-connector-project-0001',route={pm:'PM One',email:'one@example.test',slackId:'U000000001'};
 const map=new Map(Object.entries({BOT_SPREADSHEET_ID:'synthetic-bot',CONNECTOR_PROJECT_FILE_ID:fileId,
   CONNECTOR_ALLOWED_DOMAIN:'example.test',ENABLE_CALENDAR_AUTO_SHARE:'true',SLACK_BOT_TOKEN:'synthetic'}));
 const props={getProperty:k=>map.get(k)||null,setProperty:(k,v)=>map.set(k,v)};
 const acl=[],writes=[],dms=[],logs=[];let loseResponse=false,reject=false,canShare=true,mime='application/vnd.google-apps.script',name='NAC Calendar Connection Pilot';
 const context=vm.createContext({console:{log:m=>logs.push(m)},Date,JSON,
  PropertiesService:{getScriptProperties:()=>props},Session:{getEffectiveUser:()=>({getEmail:()=> 'admin@example.test'})},
  ScriptApp:{getScriptId:()=> 'synthetic-central-project-0001',getOAuthToken:()=> 'synthetic-oauth'},
  LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},Utilities:{sleep:()=>{}},
  requiredProperty_:(p,k)=>{assert.equal(k==='BOT_SPREADSHEET_ID'||k==='SLACK_BOT_TOKEN',true);return p.getProperty(k);},
  postSlackDm_:(_token,id,text)=>dms.push({id,text}),escapeSlack_:v=>v,
  UrlFetchApp:{fetch:(url,options)=>{
   assert.ok(url.startsWith('https://www.googleapis.com/drive/v3/files/'+fileId));
   assert.equal(options.headers.Authorization,'Bearer synthetic-oauth');
   if(reject)return {getResponseCode:()=>403,getContentText:()=>'{"error":"private-details"}'};
   let data;
   if(options.method==='post'){
    const body=JSON.parse(options.payload);assert.deepEqual(Object.keys(body).sort(),['emailAddress','role','type']);
    assert.equal(body.type,'user');assert.equal(body.role,'reader');assert.ok(url.includes('sendNotificationEmail=false'));
    writes.push(body);data={id:'permission-'+writes.length,...body};acl.push(data);
    if(loseResponse){loseResponse=false;throw Error('accepted but response lost');}
   }else if(url.includes('/permissions?'))data={permissions:acl};
   else data={id:fileId,name,mimeType:mime,trashed:false,capabilities:{canShare},owners:[{emailAddress:'admin@example.test'}]};
   return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)};
  }}
 });
 // 19번 파일의 링크 안내 상수(실제 Apps Script에서는 전역 공유)
 context.CALENDAR_LINK_TIP='_TIP_';
 for(const file of ['21_캘린더연결초대.js','22_연결앱공유.js'])vm.runInContext(fs.readFileSync('src/central-bot/'+file,'utf8'),context);
 context.calendarInviteSetup_=()=>({url:'https://script.google.com/macros/s/synthetic/exec',routes:[route]});
 context.calendarInviteKey_=r=>'invite-'+r.slackId;
 return {context,props,route,acl,writes,dms,logs,fileId,lose:()=>loseResponse=true,reject:()=>reject=true,
   mime:v=>mime=v,name:v=>name=v,canShare:v=>canShare=v};
}
let f=fixture();f.context.previewCalendarConnectorAccess();assert.equal(f.writes.length,0);assert.equal(f.dms.length,0);
f.context.ensureCalendarConnectorAccess();assert.equal(f.writes.length,1);assert.equal(f.writes[0].emailAddress,'one@example.test');
f.context.ensureCalendarConnectorAccess();assert.equal(f.writes.length,1);assert.equal(f.dms.length,0);
f=fixture();f.acl.push({type:'user',emailAddress:f.route.email,role:'writer'});f.context.ensureCalendarConnectorAccess();assert.equal(f.writes.length,0);assert.equal(f.acl[0].role,'writer');
f=fixture();f.lose();f.context.sendCalendarConnectionInvites();assert.equal(f.writes.length,1);assert.equal(f.dms.length,1);
f.context.sendCalendarConnectionInvites();assert.equal(f.writes.length,1);assert.equal(f.dms.length,1,'no duplicate permissions or invite');
f=fixture();f.props.setProperty('invite-'+f.route.slackId,JSON.stringify({status:'confirmed'}));
f.context.sendCalendarConnectionInvites();assert.equal(f.writes.length,1,'existing invite can be repaired');assert.equal(f.dms.length,0);
for(const kind of ['sheet','central','bot','name','not-owner']){
 f=fixture();
 if(kind==='sheet')f.mime('application/vnd.google-apps.spreadsheet');
 if(kind==='central')f.props.setProperty('CONNECTOR_PROJECT_FILE_ID','synthetic-central-project-0001');
 if(kind==='bot')f.props.setProperty('CONNECTOR_PROJECT_FILE_ID','synthetic-bot');
 if(kind==='name')f.name('Other Script');
 if(kind==='not-owner')f.canShare(false);
 assert.throws(()=>f.context.sendCalendarConnectionInvites());assert.equal(f.writes.length,0);assert.equal(f.dms.length,0);
}
f=fixture();f.route.email='other@outside.test';f.context.sendCalendarConnectionInvites();assert.equal(f.writes.length,0);assert.equal(f.dms.length,0);
f=fixture();f.reject();assert.throws(()=>f.context.sendCalendarConnectionInvites(),/403/);assert.equal(f.writes.length,0);assert.equal(f.dms.length,0);
f=fixture();f.acl.push({type:'user',emailAddress:f.route.email,role:'reader',expirationTime:'2099-01-01T00:00:00Z'});
f.context.sendCalendarConnectionInvites();assert.equal(f.writes.length,0);assert.equal(f.dms.length,0);
f=fixture();f.acl.push({type:'domain',domain:'example.test',role:'reader'});f.context.ensureCalendarConnectorAccess();assert.equal(f.writes.length,0);
f=fixture();f.props.setProperty('ENABLE_CALENDAR_AUTO_SHARE','false');f.reject();f.context.sendCalendarConnectionInvites();assert.equal(f.dms.length,1,'default-off path does not call Drive');
f=fixture();let requests=0;f.context.calendarShareApi_=()=>{requests++;return {permissions:[],nextPageToken:'same'};};
assert.throws(()=>f.context.calendarConnectorPermissions_({id:f.fileId}),/페이지 반복/);assert.equal(requests,2);
f=fixture();assert.throws(()=>f.context.calendarShareApi_(f.fileId,'/permissions/other',{},null),/범위/);
assert.throws(()=>f.context.calendarShareApi_(f.fileId,'/permissions',{}, {type:'domain',role:'writer'}),/범위/);
console.log('Connector-only viewer grants, read-only preview, identity/MIME guards, ACL verification, response-loss recovery, existing invitation repair and default-off compatibility passed');
