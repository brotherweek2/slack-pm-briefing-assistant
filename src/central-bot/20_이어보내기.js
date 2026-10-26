/**
 * 20. 연결 PM 정기 DM 이어 보내기 — 연결 PM 확대 모드에서만 사용.
 * - startConnectedBriefingRound_: 회차(10:30·14:00·17:00)별 수신자 명단 고정·회차 생성. 8명씩 처리.
 * - resumeConnectedBriefingSend(): 예약된 미처리 대상만 실제 DM 발송. 수동 실행도 발송 가능.
 *   날짜/회차/현재 승인/연결/발송 여부 재검사. 결과 불명확 건은 자동 재전송하지 않는다.
 * - previewConnectedSendProgress(): 대기 수·시도 수·상태 조회만. ID·내용 출력 없음.
 * - scheduleConnectedSendResume_/clearConnectedSendResume_: 현재 계정의 전용 일회성 트리거만 관리.
 * - enabledConnectedSend_: 관리자 허용 및 기존 실행 계정/봇 대상 확인.
 * - 제한: 회차 시작 20분 이내·최대 6회 시도. 다음날/다른 회차로 이월하지 않는다.
 * - 실제 정기 실행 시에만 이어 보내기 트리거를 생성. 업로드만으로 설치/발송하지 않음.
 */
function enabledConnectedSend_(props) {
  if(props.getProperty('ENABLE_PM_SEND')!=='true'||props.getProperty('ENABLE_CONNECTED_PM_SEND')!=='true'||
      props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE')!=='true') return false;
  requiredProperty_(props,'BOT_SPREADSHEET_ID');return true;
}

function startConnectedBriefingRound_(slot) {
  const props=PropertiesService.getScriptProperties();
  if(!enabledConnectedSend_(props)||!['11:00','14:00','17:00'].includes(slot)) throw new Error('연결 PM 정기 발송 설정 확인 필요');
  const now=Date.now(),day=Utilities.formatDate(new Date(now),BRIEFING.timezone,'yyyy-MM-dd');
  const request=JSON.parse(props.getProperty('CONNECTED_SEND_REQUEST')||'null');
  // 시작 시 잠금이 바빠도 요청을 잃지 않는다. 같은 회차 재호출은 유효기간을 늘리지 않는다.
  if(!request||request.day!==day||request.slot!==slot) props.setProperty('CONNECTED_SEND_REQUEST',JSON.stringify({day,slot,expiresAt:now+20*60000}));
  resumeConnectedBriefingSend();
}

function resumeConnectedBriefingSend() {
  const props=PropertiesService.getScriptProperties();
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)) {scheduleConnectedSendResume_(60000);return;}
  let job;
  try {
    const now=Date.now(),day=Utilities.formatDate(new Date(now),BRIEFING.timezone,'yyyy-MM-dd');
    job=JSON.parse(props.getProperty('CONNECTED_SEND_JOB')||'null');
    const request=JSON.parse(props.getProperty('CONNECTED_SEND_REQUEST')||'null');
    if(request&&request.day===day&&now<request.expiresAt&&(!job||job.day!==day||job.slot!==request.slot)) {
      if(!enabledConnectedSend_(props)||!['11:00','14:00','17:00'].includes(request.slot)) {clearConnectedSendResume_();return;}
      const bot=SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID'));
      const rows=readBotRows_(requireBotSheet_(bot,BOT_WORKBOOK.usersTab,BOT_WORKBOOK.userHeaders),BOT_WORKBOOK.userHeaders.length);
      const routes=selfCalendarFilterRoutes_(buildPmSlackRoutes_(rows,rows.map(row=>String(row[0]||'').trim()).filter(Boolean)),props);
      if(routes.length>100) throw new Error('수신자 상한 100명 초과');
      job={id:Utilities.getUuid(),day,slot:request.slot,state:'pending',pendingIds:routes.map(route=>route.id),total:routes.length,
        attempts:0,failed:0,expiresAt:request.expiresAt,leaseUntil:0};
      props.setProperty('CONNECTED_SEND_JOB',JSON.stringify(job));
    }
    if(!job||!['pending','running'].includes(job.state)) {clearConnectedSendResume_();return;}
    if(!enabledConnectedSend_(props)||job.day!==day||now>=job.expiresAt||job.attempts>=6) {
      job.state='stopped';props.setProperty('CONNECTED_SEND_JOB',JSON.stringify(job));clearConnectedSendResume_();
      console.log('이어 보내기 중지: 허용/날짜/기한/시도 상한 확인 | 미처리 '+job.pendingIds.length+'명');
      if(job.day===day) notifyAdminRoundSummary_(job.slot,adminInfoFromJob_(job));return;
    }
    if(job.notBefore&&now<job.notBefore) {scheduleConnectedSendResume_(job.notBefore-now);return;}
    if(job.leaseUntil>now) {scheduleConnectedSendResume_(job.leaseUntil-now+30000);return;}
    if(!job.pendingIds.length) {job.state=job.failed?'complete-with-errors':'complete';props.setProperty('CONNECTED_SEND_JOB',JSON.stringify(job));clearConnectedSendResume_();
      if(job.day===day) notifyAdminRoundSummary_(job.slot,adminInfoFromJob_(job));return;}
    job.attempts++;job.state='running';job.leaseUntil=now+360000;
    // 실행 중 비정상 종료돼도 다음 실행이 남도록 발송 전에 예약한다.
    scheduleConnectedSendResume_(390000);
    props.setProperty('CONNECTED_SEND_JOB',JSON.stringify(job));
  } finally {lock.releaseLock();}
  let report,prepError='';const batchStarted=Date.now(),batchSize=Math.min(8,job.pendingIds.length);
  try {report=sendPmBriefings_(false,true,job.slot,undefined,{recipientIds:job.pendingIds.slice(0,8)});}
  catch (error) {prepError=String(error&&error.message||error).slice(0,160);console.log('회차 준비/처리 실패: 미처리 대상을 유지하고 제한적으로 재시도 | '+prepError);}
  if(!lock.tryLock(30000)) return; // 미리 예약한 복구 실행이 이어 처리한다.
  try {
    const current=JSON.parse(props.getProperty('CONNECTED_SEND_JOB')||'null');
    if(!current||current.id!==job.id) return;
    const done=new Set(report&&report.doneIds||[]);
    current.pendingIds=current.pendingIds.filter(id=>!done.has(id));
    current.failed+=(report&&report.failedIds||[]).length;
    current.failedIds=[...new Set((current.failedIds||[]).concat(report&&report.failedIds||[]))].slice(0,100);
    current.failures=Object.assign({},current.failures||{},report&&report.failureReasons||{});
    if(prepError) current.lastError=prepError;
    // 실행 시간 기록: 25명 확대 전 6분 실행 제한 여유를 관리자 요약에서 본다.
    const batchMs=Date.now()-batchStarted;
    current.elapsedMs=(current.elapsedMs||0)+batchMs;current.batches=(current.batches||0)+1;
    current.maxBatchMs=Math.max(current.maxBatchMs||0,batchMs);current.maxBatchSize=Math.max(current.maxBatchSize||0,batchSize);
    current.leaseUntil=0;current.state=current.pendingIds.length?'pending':current.failed?'complete-with-errors':'complete';
    const delay=Math.max(60000,report&&report.retryAfterMs||0);
    current.notBefore=Date.now()+delay;
    if(!enabledConnectedSend_(props)) current.state='stopped';
    if(current.pendingIds.length&&(Date.now()+delay>=current.expiresAt||current.attempts>=6)) current.state='stopped';
    props.setProperty('CONNECTED_SEND_JOB',JSON.stringify(current));
    if(current.state==='pending') scheduleConnectedSendResume_(delay);else clearConnectedSendResume_();
    console.log('정기 DM 회차 상태 '+current.state+' | 남음 '+current.pendingIds.length+'명 | 확인 필요 '+current.failed+'명');
    job=current;
  } finally {lock.releaseLock();}
  // 회차가 끝났으면(완료·일부 실패·중지) 관리자에게 한 번 요약한다. 잠금 밖에서 보내 다른 실행을 막지 않는다.
  if(job&&job.pendingIds&&!['pending','running'].includes(job.state)) notifyAdminRoundSummary_(job.slot,adminInfoFromJob_(job));
}

function scheduleConnectedSendResume_(delayMs) {
  const previous=ScriptApp.getProjectTriggers().filter(trigger=>trigger.getHandlerFunction()==='resumeConnectedBriefingSend');
  // 새 예약을 만든 뒤 이전 예약을 제거한다. 생성 실패로 기존 복구 예약까지 잃지 않는다.
  ScriptApp.newTrigger('resumeConnectedBriefingSend').timeBased().after(Math.max(60000,delayMs)).create();
  previous.forEach(trigger=>ScriptApp.deleteTrigger(trigger));
}
function clearConnectedSendResume_() {
  ScriptApp.getProjectTriggers().filter(trigger=>trigger.getHandlerFunction()==='resumeConnectedBriefingSend')
    .forEach(trigger=>ScriptApp.deleteTrigger(trigger));
}
function previewConnectedSendProgress() {
  const job=JSON.parse(PropertiesService.getScriptProperties().getProperty('CONNECTED_SEND_JOB')||'null');
  console.log(job?'정기 DM '+briefingSlotLabel_(job.slot)+' | 상태 '+job.state+' | 전체 '+job.total+'명 | 남음 '+job.pendingIds.length+
    '명 | 확인 필요 '+job.failed+'명 | 시도 '+job.attempts+'회':'이어 보내기 기록 없음');
  console.log('상태 조회만 | ID·DM 내용 출력·설정/시트/트리거 변경·Slack 발송 없음');
}
