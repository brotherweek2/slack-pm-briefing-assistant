/**
 * 01. 개인 회의 연결 — 중앙 봇과 별도 Apps Script 프로젝트에 배포한다.
 * - doGet: 연결 화면. 접속 사용자로 실행하는 웹 앱만 사용. 방문만으로 연결하지 않는다.
 * - getConnectionStatus: 본인 연결·최근 갱신 상태 조회. 저장/DM 없음.
 * - connectCalendar: 본인 동의 후 수집·중앙 등록·트리거 설치·초대된 본인 Slack 연결 완료 요청.
 *   중앙이 초대한 수신자만 개인 발송 활성화/완료 DM. 이 앱에는 Slack 토큰 없음.
 * - refreshCalendar: 연결된 본인 회의 즉시 갱신. DM 없음.
 * - disconnectCalendar: 본인 트리거 중지·중앙 회의 삭제 요청. 실패 시 재시도 안내.
 * - syncMyMeetings: 본인 설치 트리거. 평일 수집 시간대에만 갱신한다.
 * - connectorStaggerMs_: 사용자별 자동 수집 시작을 0~30초 분산. 수동 갱신에는 미적용.
 * - connectorSend_: 저장 BUSY/HTTP 429만 제한적으로 재시도. 승인 오류는 재시도하지 않는다.
 * - 03번 수집부: 개인·Schedule·Review & Delivery·휴일을 각각 읽는다. Tasks 조회 없음.
 * - 나머지 _ 함수: 계정 검증·수집·서명 전송·잠금 내부 처리.
 * - Google 토큰 저장 없음. 중앙 Slack 토큰·시트 권한을 이 프로젝트에 넣지 않는다.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Connect').setTitle('개인 일정 연결');
}

function getConnectionStatus() {
  const email = connectorAccount_(true);
  const user = PropertiesService.getUserProperties();
  return {account:email, connected:user.getProperty('CONNECTED') === 'true',
    lastSync:user.getProperty('LAST_SYNC') || '',
    state:user.getProperty('SYNC_STATE') || '아직 연결하지 않았습니다.',
    slackLinked:user.getProperty('SLACK_LINKED')==='true',
    slackNotice:user.getProperty('SLACK_NOTICE')||'',
    sources:JSON.parse(user.getProperty('LAST_SOURCES') || '[]'),
    disconnectPending:user.getProperty('DISCONNECT_PENDING') === 'true'};
}

function connectCalendar() {
  return connectorLocked_(function () {
    const email = connectorAccount_(true);
    const user = PropertiesService.getUserProperties();
    if (user.getProperty('DISCONNECT_PENDING') === 'true') throw new Error('연결 해제 재시도를 먼저 완료하세요.');
    const existing = user.getProperty('CONNECTION_ID');
    const wasConnected = user.getProperty('CONNECTED') === 'true';
    const id = existing || Utilities.getUuid();
    // 계정/연결 ID는 사용자별 저장소에만 보관한다.
    user.setProperties({ACCOUNT:email, CONNECTION_ID:id});
    try {
      const snapshot = connectorSnapshot_(email, new Date());
      connectorSend_('connect', email, id, snapshot, 'connect');
      // 중앙 수신 성공 전에는 갱신 트리거를 설치하지 않는다.
      const triggers = connectorTriggers_();
      if (!triggers.length) ScriptApp.newTrigger('syncMyMeetings').timeBased().everyMinutes(5).create();
      else triggers.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
      user.setProperties({CONNECTED:'true', LAST_SYNC:new Date().toISOString(), SYNC_STATE:'회의 갱신 완료'});
      user.setProperty('LAST_SOURCES', JSON.stringify(snapshot.sources || []));
      connectorActivate_();
      return getConnectionStatus();
    } catch (error) {
      if (!wasConnected) {
        user.setProperties({CONNECTED:'false', DISCONNECT_PENDING:'true'});
        // 수신 이후 트리거 설치가 실패했을 수도 있으므로 중앙 등록도 회수한다.
        try { connectorSend_('disconnect', email, id, null); user.deleteProperty('DISCONNECT_PENDING'); }
        catch (_) { /* 화면에서 해제 재시도 가능. 성공으로 표시하지 않는다. */ }
      }
      user.setProperty('SYNC_STATE', '연결 미완료: 설정 또는 권한을 확인해주세요.');
      throw new Error('연결을 완료하지 못했습니다. 연결 상태 확인 후 다시 시도해주세요.');
    }
  });
}

function refreshCalendar() {
  return connectorLocked_(function () { connectorSync_('manual'); return getConnectionStatus(); });
}

function disconnectCalendar() {
  return connectorLocked_(function () {
    const email = connectorAccount_(true);
    const user = PropertiesService.getUserProperties();
    connectorTriggers_().forEach(t => ScriptApp.deleteTrigger(t));
    user.setProperties({CONNECTED:'false', DISCONNECT_PENDING:'true', SYNC_STATE:'연결 해제 처리 중'});
    const id = user.getProperty('CONNECTION_ID');
    if (id) connectorSend_('disconnect', email, id, null);
    ['CONNECTION_ID','LAST_SYNC','LAST_SOURCES','DISCONNECT_PENDING','SLACK_LINKED','SLACK_NOTICE','ACTIVATION_PENDING'].forEach(k => user.deleteProperty(k));
    user.setProperty('SYNC_STATE', '연결 해제 완료');
    return getConnectionStatus();
  });
}

function syncMyMeetings(event) {
  const now = new Date();
  const weekday = Number(Utilities.formatDate(now, 'Asia/Seoul', 'u'));
  const hhmm = Number(Utilities.formatDate(now, 'Asia/Seoul', 'HHmm'));
  if (weekday > 5 || !((hhmm >= 1000 && hhmm <= 1115) || (hhmm >= 1600 && hhmm <= 1715))) return;
  const triggered=!!(event&&event.triggerUid&&connectorTriggers_().some(trigger=>
    typeof trigger.getUniqueId==='function'&&String(trigger.getUniqueId())===String(event.triggerUid)));
  if (triggered) Utilities.sleep(connectorStaggerMs_(connectorAccount_(false)));
  connectorLocked_(function () { connectorSync_(triggered?'auto':'manual'); });
}

function connectorStaggerMs_(email) {
  let hash=0;for(let i=0;i<email.length;i++) hash=(hash*31+email.charCodeAt(i))>>>0;
  return hash%30001;
}

function connectorSync_(origin) {
  const user = PropertiesService.getUserProperties();
  if (user.getProperty('CONNECTED') !== 'true') throw new Error('먼저 본인 회의를 연결해주세요.');
  const email = connectorAccount_(false);
  if (email !== user.getProperty('ACCOUNT')) throw new Error('연결한 실행 계정과 다릅니다.');
  try {
    const snapshot = connectorSnapshot_(email, new Date());
    connectorSend_('snapshot', email, user.getProperty('CONNECTION_ID'), snapshot, origin || 'manual');
    user.setProperties({LAST_SYNC:new Date().toISOString(), SYNC_STATE:'회의 갱신 완료'});
    user.setProperty('LAST_SOURCES', JSON.stringify(snapshot.sources || []));
    if(user.getProperty('ACTIVATION_PENDING')==='true') connectorActivate_();
  } catch (_) {
    user.setProperty('SYNC_STATE', '갱신 실패: 권한·연결 설정 확인 필요');
    throw new Error('회의 갱신 실패. 연결 화면에서 다시 시도해주세요.');
  }
}

// 회의 수집/사용자 트리거가 준비된 뒤에만 호출한다. 확인 DM 실패로 유효한 연결을 취소하지 않는다.
function connectorActivate_() {
  const user=PropertiesService.getUserProperties();
  user.setProperty('ACTIVATION_PENDING','true');
  try {
    const result=connectorSend_('activate',connectorAccount_(false),user.getProperty('CONNECTION_ID'),null,'activate')||{};
    user.setProperties({SLACK_LINKED:result.scheduleEnabled===true?'true':'false',SLACK_NOTICE:result.notice||'not-enabled',
      ACTIVATION_PENDING:result.notice==='pending'?'true':'false',
      SYNC_STATE:result.scheduleEnabled===true?'Slack 개인 일정 브리핑 연결 완료':'일정 연결 완료 · Slack 발송 설정 확인 필요'});
  } catch (_) {
    user.setProperties({ACTIVATION_PENDING:'true',SYNC_STATE:'일정 연결 완료 · Slack 연결 확인 대기'});
  }
}

function connectorAccount_(interactive) {
  const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const active = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const domain = PropertiesService.getScriptProperties().getProperty('CONNECTOR_ALLOWED_DOMAIN');
  if (!domain || !email.endsWith('@' + domain.toLowerCase()) ||
      (interactive && !active) || (active && active !== email)) {
    throw new Error('회사 계정으로 접속하세요. 웹 앱은 접속 사용자로 실행해야 합니다.');
  }
  return email;
}

function connectorSnapshot_(email, now) {
  return connectorCollectSources_(email, now);
}

function connectorSend_(action, email, connectionId, snapshot, origin) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('CONNECTOR_RECEIVER_URL');
  const key = props.getProperty('CONNECTOR_SIGNING_KEY');
  if (!/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-zA-Z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '') || !key || key.length < 43) {
    throw new Error('관리자 연결 설정이 필요합니다.');
  }
  // 이메일은 클라이언트 입력이 아니라 Google 실행 계정에서만 결정한다.
  const payload = JSON.stringify({v:1, action, email, connectionId, snapshot, origin:origin || action,
    sentAt:Date.now(), requestId:Utilities.getUuid()});
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, key));
  const options={method:'post',contentType:'application/json',payload:JSON.stringify({payload,signature}),muteHttpExceptions:true};
  for(let attempt=0;attempt<4;attempt++) {
    // 재시도는 동일 서명·요청을 보낸다. BUSY/429는 중앙에 저장되지 않은 요청이다.
    const response=UrlFetchApp.fetch(url,options);
    const status=response.getResponseCode();let result;
    try { result=JSON.parse(response.getContentText()); } catch (_) { result=null; }
    if(status===200&&result&&result.ok) return result;
    const retryable=status===429||(status===200&&result&&result.code==='BUSY');
    if(!retryable||attempt===3) throw new Error('중앙 연결 미완료: 권한·설정 또는 다음 자동 갱신 확인 필요');
    const headers=typeof response.getAllHeaders==='function'?response.getAllHeaders():{};
    const headerKey=Object.keys(headers).find(name=>name.toLowerCase()==='retry-after');
    const serverWait=headerKey?Number(headers[headerKey])*1000:0;
    const wait=Math.max(1000*Math.pow(2,attempt)+Math.floor(Math.random()*1000),Number.isFinite(serverWait)?serverWait:0);
    // 긴 대기는 다음 5분 실행에 맡긴다. 한 실행에서 2분 유효기간을 넘겨 재전송하지 않는다.
    if(wait>15000) throw new Error('중앙 연결 지연: 다음 자동 갱신에서 다시 확인합니다.');
    Utilities.sleep(wait);
  }
}

function connectorTriggers_() {
  return ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncMyMeetings');
}

function connectorLocked_(work) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('본인 연결 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
  try { return work(); } finally { lock.releaseLock(); }
}
