const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const fixed=new Date('2026-10-19T11:00:00+09:00');
class FixedDate extends Date { constructor(...args){super(...(args.length?args:[fixed]));} }
const values=new Map(),logs=[],posts=[],sendRows=[],users=[['PM A','U0000000002',true]];
let writes=0,externalCalls=0;
const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>{values.set(k,v);writes++;}};
const ctx=vm.createContext({Date:FixedDate,console:{log:s=>logs.push(s)},
  BRIEFING:{timezone:'Asia/Seoul'},escapeSlack_:s=>String(s).replace(/&/g,'&amp;'),
  PropertiesService:{getScriptProperties:()=>props},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  UrlFetchApp:{fetch:()=>{externalCalls++;throw Error('unexpected external call');}},
  Utilities:{formatDate:(date,zone,p)=>p==='yyyy-MM-dd'?'2026-10-19':p==='HH'?'11':'10/19',
    DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],
    base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')}});
for(const f of ['16_식당목록.js','15_점심추천.js']) vm.runInContext(fs.readFileSync('src/central-bot/'+f,'utf8'),ctx);
const rows=ctx.defaultLunchRestaurantRows_(),catalog=ctx.validateLunchRestaurantRows_(rows);
assert.equal(catalog.length,75);
assert.equal(catalog.filter(x=>x.category==='식당').length,54);
assert.equal(catalog.filter(x=>x.category==='카페').length,16);
assert.equal(catalog.filter(x=>x.category==='편의점').length,5);
assert.equal(catalog.filter(x=>x.observed).length,16);
assert.equal(catalog.filter(x=>x.enabled).length,75);
assert.equal(catalog.filter(x=>x.status==='confirmed').length,48);
assert.equal(catalog.filter(x=>x.status==='approximate').length,27);
assert.equal(catalog.find(x=>x.name==='예시식당 22').id,'LUNCH_023','removing earlier venues must not renumber history IDs');
assert.ok(catalog.every(x=>x.recommendation && x.cuisine));
assert.ok(!catalog.some(x=>['삭제된예시 1','삭제된예시 2'].includes(x.name)));
assert.equal(catalog.find(x=>x.name==='예시식당 54').observed,false);
for(const name of ['예시식당 45','예시식당 15','예시식당 08','예시식당 07','예시식당 40']) assert.ok(catalog.some(x=>x.name===name));
const route={pm:'PM A',id:'U0000000002'},day='2026-10-19';
const pick=()=>ctx.pickLunchRecommendation_(props,route,day,'11:00',catalog);
const first=pick();assert.ok(first);assert.equal(writes,0);
assert.equal(first.id,pick().id);assert.equal(first.menu,pick().menu);
assert.match(ctx.formatLunchRecommendation_(first),/🍚 \*점심 추천\*\n• \*/);
assert.ok(first.light && ['카페','편의점'].includes(first.light.category));
assert.match(ctx.formatLunchRecommendation_(first),/가볍게 · */);
assert.ok(ctx.formatLunchRecommendation_(first).includes(first.recommendation));
assert.doesNotMatch(ctx.formatLunchRecommendation_(first),/https?:|map\.naver|\d+,\d+원|확인 날짜|source/);
const soup=catalog.find(x=>x.name==='예시식당 48');
assert.match(ctx.formatLunchRecommendation_(soup),/뜨끈한 순대국밥 어때요/);
assert.equal(ctx.pickLunchRecommendation_(props,route,day,'17:00',catalog),null);
assert.equal(ctx.pickLunchRecommendation_(props,route,'2026-10-18','11:00',catalog),null,'future research is not represented as historically known');
assert.ok(ctx.pickLunchRecommendation_(props,route,day,'11:00',catalog.filter(x=>x.status==='approximate')),'user-approved category suggestions are eligible');
assert.equal(ctx.pickLunchRecommendation_(props,route,day,'11:00',catalog.map(x=>({...x,enabled:false}))),null);
values.set('ENABLE_LUNCH_RECOMMENDATION','false');assert.equal(pick(),null);values.delete('ENABLE_LUNCH_RECOMMENDATION');
ctx.markLunchRecommendationSent_(props,route,first);assert.equal(writes,2);
ctx.markLunchRecommendationSent_(props,route,first);assert.equal(writes,2);
assert.equal(ctx.pickLunchRecommendation_(props,route,day,'11:00',catalog.filter(x=>x.id!==first.id)).id,undefined,'deleted meal is not replaced on the same day; light option can remain');
assert.equal(pick().menu,first.menu);
const history=[],lightHistory=[];
for(let i=0;i<50;i++){
  const d=new Date(Date.UTC(2026,9,20)+i*86400000).toISOString().slice(0,10);
  const p=ctx.pickLunchRecommendation_(props,route,d,'11:00',catalog);
  assert.ok(!history.slice(-7).includes(p.id),'avoid seven most recently sent restaurants');
  assert.ok(!lightHistory.slice(-7).includes(p.light.id),'light options keep their own recent history');
  lightHistory.push(p.light.id);
  history.push(p.id);ctx.markLunchRecommendationSent_(props,route,p);
}
const state=JSON.parse(values.get(ctx.lunchRecommendationStateKey_(route)));
assert.equal(state.history.length,20);assert.ok(JSON.stringify(state).length<8000);
assert.ok(!ctx.lunchRecommendationStateKey_(route).includes(route.id));
const diversity=new Set(Array.from({length:40},(_,i)=>ctx.pickLunchRecommendation_(props,{id:'U'+String(i).padStart(8,'0')},day,'11:00',catalog).id));
assert.ok(diversity.size>15,'PM-specific choices');
assert.throws(()=>ctx.validateLunchRestaurantRows_([rows[0],rows[0]]),/중복/);
for(const [index,value] of [[4,'<@U0000000002>'],[8,'javascript:alert(1)'],[9,'2026-02-30'],[11,'TRUE']]){
  const row=[...rows[0]];row[index]=value;assert.throws(()=>ctx.validateLunchRestaurantRows_([row]),/형식/);
}
const pending=[...rows[0]];pending[10]='pending';
assert.equal(ctx.pickLunchRecommendation_(props,{id:'U0000000004'},day,'11:00',ctx.validateLunchRestaurantRows_([pending])),null,'enabling pending rows cannot bypass verification');
ctx.assertBotHeaders_=()=>{};ctx.readBotRows_=s=>s.rows;
assert.equal(ctx.readLunchRestaurantCatalog_({getSheetByName:()=>null}).length,75);
assert.equal(ctx.readLunchRestaurantCatalog_({getSheetByName:()=>({rows:[],getLastRow:()=>1})}).length,0,'empty sheet does not resurrect defaults');
const sample={rows:[rows[0]],getLastRow:()=>2,getRange:()=>({getDisplayValues:()=>[['2026-10-19']]})};
assert.equal(ctx.readLunchRestaurantCatalog_({getSheetByName:()=>sample}).length,1);

// Only the designated helper workbook can be seeded; existing nonempty data is preserved.
ctx.BOT_WORKBOOK={bootstrapId:'test-bot',usersTab:'BOT_USERS',userHeaders:Array(3),logTab:'BOT_SEND_LOG',logHeaders:Array(5)};
ctx.requiredProperty_=(_p,k)=>k==='BOT_SPREADSHEET_ID'?'test-bot':'test-token';
let opened=0,seeded=0,order=0,checkboxOrder=0,valueOrder=0;
ctx.SpreadsheetApp={openById:()=>{opened++;return {getSheetByName:()=>sample};}};
ctx.setupBotRestaurants();assert.equal(opened,1);assert.ok(logs.some(x=>x.includes('기존 1곳 보존')));
values.set('SOURCE_SPREADSHEET_ID','test-bot');assert.throws(()=>ctx.setupBotRestaurants(),/전용/);assert.equal(opened,1);values.delete('SOURCE_SPREADSHEET_ID');
ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>null})};
ctx.ensureBotSheet_=()=>({getMaxRows:()=>1000,getRange:()=>({insertCheckboxes:()=>{checkboxOrder=++order;},setNumberFormat:()=>{},setValues:data=>{valueOrder=++order;seeded=data.length;}})});
ctx.setupBotRestaurants();assert.equal(seeded,75);assert.ok(checkboxOrder<valueOrder);

// (예전 sendMyLunchRecommendationTest 시험은 제거됨 10/23. 점심 노출은 통합 DM 테스트에서 확인)
assert.equal(externalCalls,0);
// Migration touches only old pending/not_lunch rows and removes the two specifically requested venues.
const legacy=[rows[0].slice(),rows.find(x=>x[1]==='예시식당 48').slice(),
  rows.find(x=>x[2]==='카페').slice(),['LUNCH_022','삭제된예시 1'],['LUNCH_027','삭제된예시 2']];
legacy[0][11]=false;legacy[1][10]='pending';legacy[1][11]=false;legacy[2][10]='not_lunch';legacy[2][11]=false;
const modified=[],deleted=[];
const legacySheet={rows:legacy,getRange:(r,c)=>({setNumberFormat:()=>{},setValues:v=>modified.push({r,c,v})}),deleteRow:r=>deleted.push(r)};
ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>legacySheet})};
ctx.updateBotLunchRecommendations();assert.equal(modified.length,2);assert.deepEqual(deleted,[6,5]);
assert.ok(modified.every(x=>x.v[0][10]==='approximate'&&x.v[0][11]===true));
assert.equal(legacy[0][11],false,'existing confirmed disabled choices remain disabled');
values.set('SOURCE_SPREADSHEET_ID','test-bot');assert.throws(()=>ctx.updateBotLunchRecommendations(),/전용/);values.delete('SOURCE_SPREADSHEET_ID');
console.log('Lunch copy without URLs, stable IDs, two independent meal/light choices, history, safe setup/migration and test delivery passed');
