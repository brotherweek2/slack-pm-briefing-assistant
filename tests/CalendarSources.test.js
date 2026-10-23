const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const fmt=(date,zone,pattern)=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 return pattern.replace(/yyyy|MM|dd|HH|mm/g,k=>p[{yyyy:'year',MM:'month',dd:'day',HH:'hour',mm:'minute'}[k]]);
};
const now=new Date('2026-10-21T10:30:00+09:00'),email='one@example.test';
const guest=(who,status='YES')=>({getEmail:()=>who,getGuestStatus:()=>status});
const event=(id,guests=[],extra={})=>({getId:()=>id,getStartTime:()=>new Date('2026-10-21T11:00:00+09:00'),
 getEndTime:()=>new Date('2026-10-21T12:00:00+09:00'),getGuestByEmail:e=>guests.find(g=>g.getEmail()===e)||null,
 getGuestList:()=>guests,getCreators:()=>['team@example.test'],getMyStatus:()=> 'YES',getEventType:()=> 'DEFAULT',
 getVisibility:()=> 'DEFAULT',isAllDayEvent:()=>false,getTitle:()=>id,...extra});
const own=event('own',[guest(email)]),solo=event('solo'),declined=event('declined',[guest(email,'NO')]);
const other=event('other-pm-only',[guest('two@example.test')]);
const common=event('delivery-deadline'),holiday=event('holiday',[],{isAllDayEvent:()=>true});
const vacation=event('someone-else-vacation',[],{isAllDayEvent:()=>true});
const organized=event('own-organized',[guest('two@example.test')],{getCreators:()=>[email]});
const cal=(id,name,items)=>({getId:()=>id,getName:()=>name,getEvents:()=>items});
const personal=cal(email,'Personal',[own,solo,declined]);
const schedule=cal('team','PM Team Schedule',[own,other,declined,vacation,organized]);
const review=cal('review','PM Review & Delivery',[common,other]);
const holidays=cal('holidays','대한민국의 휴일',[holiday]);
let calendars=[personal,schedule,review,holidays];
const properties=new Map();
const ctx=vm.createContext({Date,console,BRIEFING:{timezone:'Asia/Seoul'},Utilities:{formatDate:fmt},
 CalendarApp:{getDefaultCalendar:()=>personal,getAllCalendars:()=>calendars,getCalendarById:id=>calendars.find(c=>c.getId()===id)},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||null})},
 escapeSlack_:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')});
vm.runInContext(fs.readFileSync('src/calendar-connector/02_회의판정.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('src/calendar-connector/03_일정과할일수집.js','utf8'),ctx);
ctx.UrlFetchApp={fetch:()=>{throw new Error('Calendar-only collector must not call Tasks or external APIs');}};
const snapshot=ctx.connectorCollectSources_(email,now);
assert.equal(snapshot.sources.length,4);assert.ok(snapshot.sources.every(s=>s.status==='ok'));
assert.deepEqual(Array.from(snapshot.events,e=>e.title).sort(),['holiday','own','own-organized','solo']);
assert.equal(snapshot.events.filter(e=>e.title==='own').length,1,'same meeting across calendars deduplicated');
assert.ok(!snapshot.events.some(e=>['delivery-deadline','someone-else-vacation','other-pm-only'].includes(e.title)));
assert.equal(snapshot.events.find(e=>e.title==='holiday').source,'holidays');
assert.equal(snapshot.tasks,undefined);
calendars=[personal,schedule,holidays];
const partial=ctx.connectorCollectSources_(email,now);
assert.equal(partial.sources.find(s=>s.key==='review').status,'unavailable');
assert.ok(partial.events.some(e=>e.title==='own'));
calendars=[personal,schedule,review,holidays,cal('ambiguous','PM Review&Delivery',[])];
assert.throws(()=>ctx.connectorResolveCalendar_({property:'REVIEW_ID',names:['PM Review & Delivery','PM Review&Delivery']}),/DUPLICATE/);
properties.set('REVIEW_ID','review');
assert.equal(ctx.connectorResolveCalendar_({property:'REVIEW_ID',names:[]}).getId(),'review');
properties.set('REVIEW_ID','bad');assert.throws(()=>ctx.connectorResolveCalendar_({property:'REVIEW_ID',names:['PM Review & Delivery']}),/UNAVAILABLE/);
// Central suppresses old common entries immediately, before next user refresh or web app redeployment.
vm.runInContext(fs.readFileSync('src/central-bot/19_개인캘린더연결.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('src/central-bot/02_캘린더일정.js','utf8'),ctx);
const extras=ctx.selfCalendarExtras_(snapshot);
const events=ctx.selfCalendarValidateEvents_(snapshot,now.getTime());
const range={day:snapshot.day,tomorrowDay:'2026-10-22',now:now.getTime(),today:events,tomorrow:[]};
const state={...extras,events};
const morning=ctx.selfCalendarFormatSources_(state,range,false);
assert.doesNotMatch(morning,/공통 일정/);assert.match(morning,/휴일/);assert.doesNotMatch(morning,/Google Tasks/);
const legacy={...events[0],key:'legacy-common',title:'legacy-team-deadline',source:'review',audience:'common'};
const oldRange={...range,today:events.concat(legacy)};
const oldCacheMessage=ctx.selfCalendarFormatSources_(state,oldRange,true);
assert.doesNotMatch(oldCacheMessage,/legacy-team-deadline|공통 일정/);
assert.match(oldCacheMessage,/own-organized/);assert.match(oldCacheMessage,/solo/);
const warning=ctx.selfCalendarFormatSources_({...state,sources:partial.sources},range,false);
assert.match(warning,/조회 확인 필요:.*PM Review/);
assert.throws(()=>ctx.selfCalendarExtras_({...snapshot,sources:[]}),/SOURCE_STATUS/);
assert.throws(()=>ctx.selfCalendarValidateEvents_({...snapshot,events:[{...snapshot.events[0],source:'unapproved'}]},now.getTime()),/EVENT_SOURCE/);
assert.throws(()=>ctx.selfCalendarExtras_({...snapshot,tasks:[{title:'must not be accepted'}]}),/TASKS_DISABLED/);
const manifest=JSON.parse(fs.readFileSync('src/calendar-connector/appsscript.json','utf8'));
assert.ok(!manifest.oauthScopes.some(scope=>scope.includes('tasks')));
assert.ok(!fs.readFileSync('src/calendar-connector/03_일정과할일수집.js','utf8').includes('tasks.googleapis.com'));
console.log('Calendar-only: own invitations/creations, solo schedules, no common deadlines/vacation, legacy cache suppression, holiday, failures and Tasks exclusion passed');
