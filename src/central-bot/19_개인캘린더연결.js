/**
 * 19. 개인캘린더연결 — 연결 앱이 보낸 회의 받기(서명 확인), 연결 상태 점검
 *
 * 알아둘 것
 * - 연결 앱 요청은 HMAC 서명·2분 시간 창·같은 요청 재사용 차단으로 검증한다.
 * - 봇 전용 BOT_CALENDAR_PERSONAL만 갱신한다. 원천 시트·Slack·트리거는 바꾸지 않는다.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⏰ doPost(e): Slack 버튼·연결 앱 요청을 받는 웹 앱 입구(직접 실행하지 않음)
 * - 🔍 previewSelfCalendarSetup(): 캘린더 연결 설정 유무와 연결 인원만 조회한다
 * - 🔍 previewConnectedCalendarStatus(): PM별 실제 자동 갱신·원천 상태·당일 10:30/14:00/17:00 성공 기록 조회
 *
 * 내부 함수 (직접 실행하지 않음)
 * - selfCalendarAuthenticate_(e, props, now): HMAC·시각·요청 형식 검사
 * - selfCalendarUsesConnectColumn_(sheet): 등록 명단의 기준: BOT_USERS E열 calendar_connect 체크박스
 * - selfCalendarRosterConfigured_(props): 캘린더 연결 명단(체크박스 열 또는 이메일 목록)이 설정됐는지 확인
 * - selfCalendarRegistry_(props): BOT_USERS에서 캘린더 연결 대상(이름·Slack ID·이메일)을 읽는다
 * - selfCalendarApply_(r, props): 잠금 안에서 요청 순서·연결 ID 검사 후 제한된 캐시 교체
 * - selfCalendarValidateEvents_(snapshot, sentAt): 수집 날짜·행 수·필드·시간·크기 검사
 * - selfCalendarExtras_(snapshot): 4개 캘린더 원천 조회 상태 검증
 * - selfCalendarStore_(props, create): 허용된 봇 전용 저장소만 개방
 * - calendarConnectLink_(props,label): 실제 배포 URL일 때만 연결 앱 Slack 링크를 만든다
 * - selfCalendarSection_(route, props, slot, now, viewFrom, allowStale): 본인 수신자와 일치하는 최신 회의만 DM 문안으로 변환(시험·미리보기는 오늘 마지막 갱신본 허용)
 * - selfCalendarFormatSources_(state,snapshot,includeTomorrow): 회의 영역에 본인 일정·휴일만 표시하고 조회 실패 캘린더를 알린다
 * - selfCalendarFilterRoutes_(routes, props): 발송 TRUE 명단 중 본인 연결 완료 수신자만 통과
 * - selfCalendarSignature_(payload,key): 연결 앱 요청의 서명(HMAC)을 만든다
 * - selfCalendarEqual_(a,b): 서명 두 개를 안전하게(시간 차 없이) 비교한다
 * - selfCalendarJson_(data): 웹 앱 응답을 JSON으로 만든다
 */
function doPost(e) {
  if (e && e.parameter && typeof e.parameter.payload === 'string') return handleSlackInteraction_(e);
  try {
    const props = PropertiesService.getScriptProperties();
    const request = selfCalendarAuthenticate_(e, props, Date.now());
    // 수신 앱은 고정 배포자 계정으로 실행한다. 수신끼리는 직렬화하되,
    // DM 발송의 ScriptLock과 분리해 긴 발송 중에도 캐시를 갱신한다.
    const lock = LockService.getUserLock();
    if (!lock.tryLock(10000)) return selfCalendarJson_({ok:false, code:'BUSY'});
    let outcome;
    try { outcome=selfCalendarApply_(request, props); }
    finally { lock.releaseLock(); }
    return selfCalendarJson_({ok:true,...outcome});
  } catch (_) {
    // 응답이나 로그에 본문·서명·이메일·회의명을 출력하지 않는다.
    return selfCalendarJson_({ok:false, code:'REJECTED'});
  }
}

function selfCalendarAuthenticate_(e, props, now) {
  if (props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') !== 'true') throw new Error('DISABLED');
  const raw = e && e.postData && e.postData.contents;
  if (typeof raw !== 'string' || raw.length > 60000) throw new Error('BODY');
  const envelope = JSON.parse(raw);
  const key = props.getProperty('CONNECTOR_SIGNING_KEY');
  if (!key || key.length < 43 || typeof envelope.payload !== 'string' ||
      !selfCalendarEqual_(envelope.signature, selfCalendarSignature_(envelope.payload, key))) throw new Error('SIGNATURE');
  const r = JSON.parse(envelope.payload);
  if (r.v !== 1 || !['connect','snapshot','disconnect','activate'].includes(r.action) ||
      !Number.isSafeInteger(r.sentAt) || r.sentAt < now-120000 || r.sentAt > now+30000 ||
      !/^[a-f0-9-]{36}$/i.test(r.requestId || '') || !/^[a-f0-9-]{36}$/i.test(r.connectionId || '') ||
      typeof r.email !== 'string' || r.email !== r.email.trim().toLowerCase()) throw new Error('REQUEST');
  if (r.origin && !['connect','disconnect','manual','auto','activate'].includes(r.origin)) throw new Error('ORIGIN');
  return r;
}

const CALENDAR_CONNECT_HEADER = 'calendar_connect';

// 등록 명단의 기준: BOT_USERS E열 calendar_connect 체크박스. 열이 없으면 예전 이메일 JSON 속성을 쓴다.
function selfCalendarUsesConnectColumn_(sheet) {
  if (typeof sheet.getLastColumn !== 'function' || sheet.getLastColumn() < 5) return false;
  return String(sheet.getRange(1,5).getValue() || '').trim() === CALENDAR_CONNECT_HEADER;
}

function selfCalendarRosterConfigured_(props) {
  if (props.getProperty('SELF_CALENDAR_ALLOWED_EMAILS')) return true;
  const sheet = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID')).getSheetByName(BOT_WORKBOOK.usersTab);
  return !!sheet && selfCalendarUsesConnectColumn_(sheet);
}

function selfCalendarRegistry_(props) {
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const sheet = bot.getSheetByName(BOT_WORKBOOK.usersTab);
  if (!sheet || sheet.getRange(1,4).getValue() !== 'email') throw new Error('EMAIL_HEADER');
  const useColumn = selfCalendarUsesConnectColumn_(sheet);
  let allowedSet = null;
  if (!useColumn) {
    const allowed = JSON.parse(props.getProperty('SELF_CALENDAR_ALLOWED_EMAILS') || '[]');
    if (!Array.isArray(allowed) || !allowed.length || allowed.length > 100 ||
        allowed.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('ALLOWLIST');
    allowedSet = new Set(allowed.map(email => email.trim().toLowerCase()));
  }
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,useColumn ? 5 : 4).getValues() : [];
  if (useColumn && rows.filter(row => row[4] === true).length > 100) throw new Error('ALLOWLIST');
  // 문제 있는 줄(이름·Slack ID 누락/형식 오류, 이메일·이름·ID 중복)은 그 PM만 빼고 나머지는 그대로 쓴다.
  // 중복은 어느 줄이 맞는지 알 수 없으므로 겹치는 줄을 모두 뺀다. 빠진 줄은 records.skipped에 남긴다.
  const candidates = [];
  rows.forEach((row,index) => {
    const email = String(row[3] || '').trim().toLowerCase();
    if (useColumn ? row[4] !== true || !email : !allowedSet.has(email)) return;
    candidates.push({email,pm:String(row[0] || '').trim(),slackId:String(row[1] || '').trim(),sendEnabled:row[2]===true,row:index+2});
  });
  const dup = (key, value) => candidates.filter(other => other[key] === value).length > 1;
  const records = [], skipped = [];
  candidates.forEach(item => {
    const reason = !item.pm || !/^[UW][A-Z0-9]{8,}$/.test(item.slackId) ? '이름·Slack ID 확인' :
      dup('email', item.email) || dup('pm', item.pm) || dup('slackId', item.slackId) ? '이메일·이름·Slack ID 중복' : '';
    if (reason) skipped.push((item.pm || item.row + '행') + ': ' + reason);
    else records.push(item);
  });
  records.skipped = skipped;
  return records;
}

function selfCalendarApply_(r, props) {
  const route = selfCalendarRegistry_(props).find(row => row.email === r.email);
  if (!route) throw new Error('NOT_REGISTERED');
  if(r.action==='activate') return activateCalendarOnboarding_(r,props,route);
  const events = r.action === 'disconnect' ? [] : selfCalendarValidateEvents_(r.snapshot, r.sentAt);
  const extras = r.action === 'disconnect' ? {sources:[]} : selfCalendarExtras_(r.snapshot);
  let sheet = selfCalendarStore_(props, false);
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues() : [];
  if (rows.length > 100) throw new Error('STORE_LIMIT');
  const found = rows.map((row,index) => ({email:row[0], state:row[1], row:index+2})).filter(row => row.email === r.email);
  if (found.length > 1) throw new Error('DUPLICATE_CACHE');
  const old = found.length ? JSON.parse(found[0].state) : null;
  // 최초 연결이 저장되기 전에 실패한 경우의 해제 재시도도 성공시킨다.
  if (r.action === 'disconnect' && !old) {
    if(props.getProperty('ENABLE_CALENDAR_SELF_ENROLLMENT')==='true') disconnectCalendarOnboarding_(r,props,route);
    return;
  }
  if (old && (r.sentAt <= old.sentAt || old.requestId === r.requestId)) throw new Error('REPLAY');
  if (r.action !== 'connect' && (!old || old.connectionId !== r.connectionId)) throw new Error('CONNECTION');
  // 해제된 세션은 connect가 명시적으로 다시 실행되기 전 갱신 불가.
  if (r.action === 'snapshot' && !old.connected) throw new Error('DISCONNECTED');
  const state = {pm:route.pm,slackId:route.slackId,connectionId:r.connectionId,requestId:r.requestId,
    sentAt:r.sentAt, receivedAt:Date.now(), connected:r.action !== 'disconnect', events,
    sources:extras.sources,origin:r.origin||r.action,
    lastAutomaticAt:r.action==='snapshot'&&r.origin==='auto'?r.sentAt:
      old&&old.connectionId===r.connectionId&&r.action!=='disconnect'?(old.lastAutomaticAt||0):0};
  const encoded = JSON.stringify(state);
  if (encoded.length > 45000) throw new Error('STORE_SIZE');
  if (!found.length && rows.length >= 100) throw new Error('STORE_LIMIT');
  if (!sheet) sheet = selfCalendarStore_(props, true);
  sheet.getRange(found.length ? found[0].row : rows.length+2,1,1,2).setValues([[r.email,encoded]]);
  if(r.action==='disconnect'&&props.getProperty('ENABLE_CALENDAR_SELF_ENROLLMENT')==='true') disconnectCalendarOnboarding_(r,props,route);
}

function selfCalendarValidateEvents_(snapshot, sentAt) {
  const day = Utilities.formatDate(new Date(sentAt), 'Asia/Seoul', 'yyyy-MM-dd');
  if (!snapshot || snapshot.day !== day || !Array.isArray(snapshot.events) || snapshot.events.length > 150) throw new Error('SNAPSHOT');
  const limit = Date.parse(day+'T00:00:00+09:00')+2*86400000;
  const seen = new Set();
  return snapshot.events.map(event => {
    if (!event || typeof event.key !== 'string' || event.key.length > 1024 || !event.key || seen.has(event.key) ||
        typeof event.title !== 'string' || event.title.length > 300 || typeof event.allDay !== 'boolean' ||
        !['','응답 전','참석 미정'].includes(event.status) || !Number.isSafeInteger(event.start) ||
        !Number.isSafeInteger(event.end) || event.start >= event.end || event.end <= sentAt ||
        event.start >= limit || event.start < sentAt-7*86400000 || event.end > limit+7*86400000) throw new Error('EVENT');
    seen.add(event.key);
    const source=event.source||'personal', audience=event.audience||'personal';
    if (!['personal','schedule','review','holidays'].includes(source)||!['personal','common'].includes(audience)) throw new Error('EVENT_SOURCE');
    return {key:event.key,title:event.title,start:event.start,end:event.end,allDay:event.allDay,status:event.status,source,audience};
  });
}

function selfCalendarExtras_(snapshot) {
  const keys=['personal','schedule','review','holidays'];
  const sources=snapshot.sources||keys.map(key=>({key,status:'unavailable',count:0}));
  if (!Array.isArray(sources)||sources.length!==4||new Set(sources.map(s=>s&&s.key)).size!==4||
      sources.some(s=>!s||!keys.includes(s.key)||!['ok','unavailable'].includes(s.status)||!Number.isInteger(s.count)||s.count<0||s.count>500)) throw new Error('SOURCE_STATUS');
  if (snapshot.tasks && (!Array.isArray(snapshot.tasks)||snapshot.tasks.length)) throw new Error('TASKS_DISABLED');
  return {sources:sources.map(s=>({key:s.key,status:s.status,count:s.count}))};
}

function selfCalendarStore_(props, create) {
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  let sheet = bot.getSheetByName('BOT_CALENDAR_PERSONAL');
  if (!sheet && create) {
    sheet = bot.insertSheet('BOT_CALENDAR_PERSONAL');
    sheet.getRange(1,1,1,2).setValues([['email','state_json']]);
  }
  if (sheet && sheet.getRange(1,1,1,2).getValues()[0].join('|') !== 'email|state_json') throw new Error('CACHE_HEADER');
  return sheet;
}

// 실제 배포 URL일 때만 링크를 만든다. 편집기 링크·임의 URL은 쓰지 않는다.
// 브라우저에 개인 Google 계정이 먼저 로그인돼 있으면 회사 전용 웹 앱이 "파일을 열 수 없습니다"로 막힌다.
const CALENDAR_LINK_TIP = '_링크가 "파일을 열 수 없습니다"로 막히면 회사 계정만 로그인된 창(시크릿 창)에서 열어주세요._';

function calendarConnectLink_(props,label) {
  const url=props.getProperty('CALENDAR_CONNECT_URL')||'';
  return /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-zA-Z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)?
    '<'+url+'|'+label+'>':'';
}

function selfCalendarSection_(route, props, slot, now, viewFrom, allowStale) {
  // 회의 영역 제목은 calendarSectionTitle_을 쓴다(10:30 '오늘 회의', 17:00 '회의').
  const includeTomorrow = slot === '17:00' || (!slot && Number(Utilities.formatDate(now,'Asia/Seoul','HH')) >= 17);
  const title = calendarSectionTitle_(includeTomorrow);
  const connect = calendarConnectLink_(props,'연결하기');
  const notConnected = text => title+'\n• '+text+(connect?' · '+connect+'\n'+CALENDAR_LINK_TIP:'');
  const registered = selfCalendarRegistry_(props).find(row => row.pm === route.pm && row.slackId === route.id);
  if (!registered) return title+'\n• 개인 캘린더 미연결';
  const sheet = selfCalendarStore_(props, false);
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues() : [];
  const matches = rows.filter(row => row[0] === registered.email);
  if (matches.length !== 1) return notConnected('개인 캘린더 미연결');
  const state = JSON.parse(matches[0][1]);
  if (state.pm !== route.pm || state.slackId !== route.id) throw new Error('CALENDAR_ROUTE_CHANGED');
  if (!state.connected) return notConnected('개인 캘린더 연결 해제 상태');
  // 본인 시험·미리보기는 오늘 받은 마지막 일정을 그대로 쓰고, 몇 시 기준인지 한 줄 붙인다(연결 앱 갱신은 회차 직전에만 돈다).
  const sameDay = Number.isFinite(state.sentAt) && state.sentAt <= now.getTime()+30000 &&
    Utilities.formatDate(new Date(state.sentAt),'Asia/Seoul','yyyy-MM-dd') === Utilities.formatDate(now,'Asia/Seoul','yyyy-MM-dd');
  const staleOk = allowStale && sameDay && now.getTime()-state.sentAt > 20*60000;
  if (!staleOk && (!Number.isFinite(state.sentAt) || now.getTime()-state.sentAt > 20*60000 || state.sentAt > now.getTime()+30000)) {
    const last=Number.isFinite(state.sentAt)&&state.sentAt<=now.getTime()+30000?
      Utilities.formatDate(new Date(state.sentAt),'Asia/Seoul','MM/dd HH:mm'):'확인 불가';
    const refresh=calendarConnectLink_(props,'내 일정 갱신')||'연결 화면에서 새로고침';
    return title+'\n• 회의 갱신 지연 · 마지막 확인 '+last+'\n• 최신 일정은 아직 확인하지 못했습니다. '+refresh+
      (/^</.test(refresh)?'\n'+CALENDAR_LINK_TIP:'');
  }
  const day = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  const tomorrowStart = Date.parse(day+'T00:00:00+09:00')+86400000;
  // 갱신 지연 판단은 실제 시각(now), 남은 회의 기준은 보는 회차 시각(viewFrom)을 쓴다.
  const from = viewFrom ? viewFrom.getTime() : now.getTime();
  const events = state.events.filter(event => event.end > from);
  const snapshot = {day,now:from,tomorrowDay:Utilities.formatDate(new Date(tomorrowStart),'Asia/Seoul','yyyy-MM-dd'),
    today:events.filter(event => event.start < tomorrowStart),
    tomorrow:events.filter(event => event.start < tomorrowStart+86400000 && event.end > tomorrowStart)};
  return selfCalendarFormatSources_(state,snapshot,includeTomorrow) +
    (staleOk ? '\n• 일정 기준 '+Utilities.formatDate(new Date(state.sentAt),'Asia/Seoul','HH:mm')+' (마지막 갱신본)' : '');
}

// formatCalendarBriefing_은 '\n• …'로 시작하므로 줄을 이어 붙인다(빈 줄 없이 한 영역으로 유지).
function selfCalendarFormatSources_(state,snapshot,includeTomorrow) {
  const labels={personal:'개인 캘린더',schedule:'PM Team Schedule',review:'PM Review & Delivery',holidays:'대한민국의 휴일'};
  const personal=event=>event.audience!=='common'&&event.source!=='holidays';
  const select=predicate=>({...snapshot,today:snapshot.today.filter(predicate),tomorrow:snapshot.tomorrow.filter(predicate)});
  let text=calendarSectionTitle_(includeTomorrow)+formatCalendarBriefing_(select(personal),includeTomorrow);
  const holidays=event=>event.source==='holidays';
  // 이전 버전의 캐시에도 공통 일정이 남아 있을 수 있다. 본인 대상이 아닌 일정은 DM에서 제외한다.
  const selected=select(holidays);
  if (selected.today.length||(includeTomorrow&&selected.tomorrow.length)) text+='\n*휴일*'+formatCalendarBriefing_(selected,includeTomorrow);
  const unavailable=(state.sources||Object.keys(labels).map(key=>({key,status:'unavailable'}))).filter(s=>s.status!=='ok');
  if(unavailable.length) text+='\n⚠️ 조회 확인 필요: '+unavailable.map(s=>labels[s.key]).join(', ')+' — 구독·읽기 권한/연결 설정 확인';
  return text;
}

function previewSelfCalendarSetup() {
  const props = PropertiesService.getScriptProperties();
  console.log('개인 연결 파이프라인: '+(props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') === 'true' ? 'ON' : 'OFF'));
  console.log('서명키 설정: '+(!!props.getProperty('CONNECTOR_SIGNING_KEY'))+' | 명단 설정: '+selfCalendarRosterConfigured_(props));
  console.log('설정 상태 조회만 | 캘린더·Slack 조회/발송·시트/속성/트리거 변경 없음');
}

function previewConnectedCalendarStatus() {
  const props=PropertiesService.getScriptProperties();
  const enabled=props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE')==='true';
  console.log('개인 캘린더 연결 '+(enabled?'ON':'OFF')+' | 연결 PM 발송 '+
    (props.getProperty('ENABLE_CONNECTED_PM_SEND')==='true'?'ON':'OFF'));
  if (!selfCalendarRosterConfigured_(props)) {
    console.log('관리자 연결 명단 미설정 | 배포·설정 필요 | 조회만, 발송 없음');return;
  }
  const registered=selfCalendarRegistry_(props);
  const sheet=selfCalendarStore_(props,false);
  const cached=sheet&&sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues():[];
  const bot=SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID'));
  const log=bot.getSheetByName(BOT_WORKBOOK.logTab);
  const sent=log&&log.getLastRow()>1?log.getRange(2,1,log.getLastRow()-1,5).getValues():[];
  const now=new Date(), day=Utilities.formatDate(now,'Asia/Seoul','yyyy-MM-dd');
  const stamp=value=>value?Utilities.formatDate(new Date(value),'Asia/Seoul','MM/dd HH:mm'):'기록 없음';
  registered.forEach(route=>{
    const matches=cached.filter(row=>row[0]===route.email);
    let state=null;try{state=matches.length===1?JSON.parse(matches[0][1]):null;}catch(_){}
    const valid=state&&state.pm===route.pm&&state.slackId===route.slackId;
    const good=valid&&state.connected===true;
    const age=valid?Math.floor((now.getTime()-state.sentAt)/60000):null;
    const sources=valid?state.sources||[]:[];
    const record=(slot,pattern)=>sent.some(row=>row[0] instanceof Date&&
      Utilities.formatDate(row[0],'Asia/Seoul','yyyy-MM-dd')===day&&row[1]==='scheduled-'+slot&&row[2]===route.pm&&pattern.test(String(row[4])));
    const actualSent=slot=>record(slot,/^sent/)?'성공 기록 있음':record(slot,/^skipped-leave$/)?'연차로 건너뜀':'기록 없음';
    console.log(route.pm+' | 발송 설정 '+(route.sendEnabled?'ON':'OFF')+' | 개인 연결 '+(good?'완료':'미완료')+
      ' | 네 캘린더 조회 성공 '+sources.filter(s=>s.status==='ok').length+'/4'+
      ' | 최근 수집 '+(age===null?'없음':age+'분 전')+
      ' | 실제 자동 갱신 '+stamp(valid?state.lastAutomaticAt:0)+
      ' | 오늘 정기 발송 10:30 '+actualSent('11:00')+' / 14:00 '+actualSent('14:00')+' / 17:00 '+actualSent('17:00'));
  });
  if(registered.skipped.length) console.log('⚠️ 연결 명단에서 제외된 줄: '+registered.skipped.join(' / ')+' → BOT_USERS 확인');
  const handlers=ScriptApp.getProjectTriggers().map(trigger=>trigger.getHandlerFunction());
  const count=name=>handlers.filter(h=>h===name).length;
  console.log('현재 실행 계정의 정기 발송 트리거: 10:30 '+count('sendScheduledBriefing11')+'개 / 14:00 '+
    count('sendScheduledBriefing14')+'개 / 17:00 '+count('sendScheduledBriefing17')+'개');
  console.log('동료 계정 트리거 목록은 조회할 수 없어 실제 자동 수신 기록으로 확인 | 수신 DM과 원본 일정 대조는 별도 필요 | 조회만, 변경·발송 없음');
}

function selfCalendarFilterRoutes_(routes, props) {
  if (props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') !== 'true') throw new Error('SELF_CALENDAR_DISABLED');
  const registered = selfCalendarRegistry_(props);
  const sheet = selfCalendarStore_(props, false);
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues() : [];
  return routes.filter(route => {
    const binding = registered.find(row => row.pm === route.pm && row.slackId === route.id);
    if (!binding) return false;
    const matches = rows.filter(row => row[0] === binding.email);
    if (matches.length !== 1) return false;
    // 한 사람의 저장값이 깨져도 그 사람만 빠진다.
    try {
      const state = JSON.parse(matches[0][1]);
      return state.connected === true && state.pm === route.pm && state.slackId === route.id;
    } catch (_) { return false; }
  });
}

function selfCalendarSignature_(payload,key) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload,key)); }
function selfCalendarEqual_(a,b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff === 0;
}
function selfCalendarJson_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
