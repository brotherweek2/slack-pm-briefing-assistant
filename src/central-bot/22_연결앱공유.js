/**
 * 22. 연결앱공유 — 연결 앱 파일 보기 권한 확인·추가
 *
 * 알아둘 것
 * - 보기(reader) 권한만 추가한다. 기존 권한 수정·삭제, 그룹·공개 공유는 하지 않는다.
 * - 준비: CONNECTOR_PROJECT_FILE_ID, CONNECTOR_ALLOWED_DOMAIN.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - 🔍 previewCalendarConnectorAccess(): 초대 명단의 보기 권한 조회만
 * - ⚠️ ensureCalendarConnectorAccess(): 지정 연결 앱에 초대 PM의 reader 권한만 추가
 *
 * 내부 함수 (직접 실행하지 않음)
 * - calendarShareApi_(fileId, path, query, body): 지정 파일의 metadata/permissions GET, permissions POST만 허용
 * - calendarConnectorFile_(props): 실행 계정·파일 ID·종류·이름·소유자·공유 가능 여부 검사
 * - calendarConnectorPermissions_(file): 페이지 끝까지 기존 권한 조회
 * - calendarConnectorAccess_(permissions,email,domain): 연결 앱 파일에 PM 보기 권한을 확인·추가한다(기존 권한은 유지)
 * - ensureCalendarConnectorViewer_(route,file): user/reader만 추가하고 다시 조회
 */
function calendarShareApi_(fileId, path, query, body) {
  const allowed=path===''||path==='/permissions';
  if(!allowed||!/^[A-Za-z0-9_-]+$/.test(fileId)||
      (body&&(path!=='/permissions'||body.type!=='user'||body.role!=='reader'))) {
    throw new Error('연결 앱 공유 요청 범위 오류');
  }
  const params=Object.keys(query||{}).map(key=>encodeURIComponent(key)+'='+encodeURIComponent(query[key])).join('&');
  const options={method:body?'post':'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true};
  if(body){options.contentType='application/json';options.payload=JSON.stringify(body);}
  let response;
  try { response=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+fileId+path+(params?'?'+params:''),options); }
  catch(_){throw new Error('연결 앱 Drive 요청 결과 불명확 — 다시 조회 후 확인 필요');}
  const code=response.getResponseCode();
  if(code<200||code>=300) throw new Error('연결 앱 Drive 요청 실패 ('+code+') — 관리자 Drive 승인·파일 접근·API 사용 확인 필요');
  try {return JSON.parse(response.getContentText());}
  catch(_){throw new Error('연결 앱 Drive 응답 확인 불가');}
}
function calendarConnectorFile_(props) {
  // 봇 전용 파일과 고정 실행 계정 검증. 다른 계정은 공유를 시작할 수 없다.
  const botId=requiredProperty_(props,'BOT_SPREADSHEET_ID');
  const id=props.getProperty('CONNECTOR_PROJECT_FILE_ID')||'';
  const domain=(props.getProperty('CONNECTOR_ALLOWED_DOMAIN')||'').trim().toLowerCase();
  const executor=String(Session.getEffectiveUser().getEmail()||'').trim().toLowerCase();
  if(!/^[A-Za-z0-9_-]{20,}$/.test(id)||id===ScriptApp.getScriptId()||id===botId||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)||!executor.endsWith('@'+domain)) {
    throw new Error('연결 앱 파일 ID·회사 도메인·관리자 계정 설정 확인 필요');
  }
  const file=calendarShareApi_(id,'',{fields:'id,name,mimeType,trashed,capabilities(canShare),owners(emailAddress)',supportsAllDrives:true});
  if(file.id!==id||file.trashed||file.mimeType!=='application/vnd.google-apps.script'||
      file.name!=='NAC Calendar Connection Pilot'||!file.capabilities||file.capabilities.canShare!==true||
      !Array.isArray(file.owners)||!file.owners.some(owner=>String(owner.emailAddress||'').toLowerCase()===executor)) {
    throw new Error('관리자 소유의 지정 캘린더 연결 앱이 아닙니다. 공유 중지');
  }
  return {id,domain};
}
function calendarConnectorPermissions_(file) {
  const result=[];let pageToken='';
  for(let page=0;page<20;page++) {
    const query={pageSize:100,fields:'nextPageToken,permissions(id,type,role,emailAddress,domain,deleted,expirationTime)',supportsAllDrives:true};
    if(pageToken)query.pageToken=pageToken;
    const data=calendarShareApi_(file.id,'/permissions',query);
    if(!Array.isArray(data.permissions))throw new Error('연결 앱 기존 권한 조회 불완전');
    result.push(...data.permissions);
    if(!data.nextPageToken)return result;
    if(data.nextPageToken===pageToken)throw new Error('연결 앱 권한 페이지 반복. 공유 중지');
    pageToken=data.nextPageToken;
  }
  throw new Error('연결 앱 기존 권한 조회 상한. 공유 중지');
}
function calendarConnectorAccess_(permissions,email,domain) {
  let expiring=false;
  for(const permission of permissions) {
    if(permission.deleted)continue;
    const direct=permission.type==='user'&&String(permission.emailAddress||'').toLowerCase()===email;
    const covered=direct||permission.type==='anyone'||
      (permission.type==='domain'&&permission.domain===domain&&email.endsWith('@'+domain));
    if(!covered)continue;
    if(!['reader','commenter','writer','owner','organizer','fileOrganizer'].includes(permission.role)) {
      if(direct)throw new Error('기존 연결 앱 권한의 수동 확인 필요');
      continue;
    }
    if(permission.expirationTime){expiring=true;continue;}
    return 'existing';
  }
  return expiring?'expiring':'missing';
}
function ensureCalendarConnectorViewer_(route,file) {
  if(!route.email.endsWith('@'+file.domain))throw new Error('초대 대상 회사 도메인 불일치');
  const status=calendarConnectorAccess_(calendarConnectorPermissions_(file),route.email,file.domain);
  if(status==='existing')return 'existing';
  if(status==='expiring')throw new Error('만료일이 있는 기존 보기 권한 — 관리자 확인 필요');
  let createError=null;
  try {
    calendarShareApi_(file.id,'/permissions',{sendNotificationEmail:false,supportsAllDrives:true,fields:'id,type,role'},
      {type:'user',role:'reader',emailAddress:route.email});
  } catch(error){createError=error;}
  // 응답 유실일 수도 있으므로 다시 생성하지 않고 실제 ACL을 재조회한다.
  if(calendarConnectorAccess_(calendarConnectorPermissions_(file),route.email,file.domain)==='existing')return 'added';
  throw createError||new Error('연결 앱 보기 권한 추가 결과를 확인하지 못했습니다. DM 중지');
}
function previewCalendarConnectorAccess() {
  const props=PropertiesService.getScriptProperties(),setup=calendarInviteSetup_(props),file=calendarConnectorFile_(props);
  const permissions=calendarConnectorPermissions_(file);
  setup.routes.forEach(route=>{
    if(!route.email.endsWith('@'+file.domain))throw new Error('초대 대상 회사 도메인 불일치');
    const status=calendarConnectorAccess_(permissions,route.email,file.domain);
    console.log(route.pm+' | 연결 앱 보기 권한 '+({existing:'있음',missing:'추가 필요',expiring:'만료 설정 확인 필요'}[status]));
  });
  console.log('보기 권한 조회만 | 공유·Slack 발송·시트/속성/트리거 변경 없음');
}
function ensureCalendarConnectorAccess() {
  const props=PropertiesService.getScriptProperties(),setup=calendarInviteSetup_(props);
  if(props.getProperty('ENABLE_CALENDAR_AUTO_SHARE')!=='true')throw new Error('ENABLE_CALENDAR_AUTO_SHARE 승인 후 true로 설정하세요.');
  const lock=LockService.getUserLock();
  if(!lock.tryLock(1000))throw new Error('다른 연결/공유 작업 진행 중. 잠시 후 다시 시도하세요.');
  try {
    const file=calendarConnectorFile_(props);
    setup.routes.forEach(route=>{
      const status=ensureCalendarConnectorViewer_(route,file);
      console.log(route.pm+' | 연결 앱 보기 권한 '+(status==='existing'?'기존 유지':'추가 확인'));
    });
  } finally {lock.releaseLock();}
  console.log('지정 연결 앱의 보기 권한만 보완 | Slack/메일 발송·업무 시트/트리거 변경 없음');
}
