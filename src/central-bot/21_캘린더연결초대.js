/**
 * 21. Slack DM으로 개인 캘린더 연결
 * - previewCalendarConnectionInvites(): 지정 PM의 초대 문안·중복 상태 조회만. 발송/저장 없음.
 * - sendCalendarConnectionInvites(): 관리자 지정 PM에게 실제 연결 링크 DM. 초대 이력 저장.
 *   ENABLE_CALENDAR_AUTO_SHARE=true이면 22번 파일로 연결 앱 보기 권한 확보 후 DM.
 *   기존 초대자의 권한도 보완하되 중복 DM은 보내지 않는다. 공유 실패 대상은 DM 중지.
 *   CALENDAR_CONNECT_URL, CALENDAR_ONBOARDING_READY=true 필요. 초대 대상은 BOT_USERS E열 calendar_connect에
 *   체크된 사람 중 아직 초대 기록이 없는 사람(한 번에 25명). 열이 없으면 예전 CALENDAR_INVITE_PM_NAMES JSON.
 * - setupCalendarConnectColumn(): BOT_USERS E열에 calendar_connect 체크박스를 만들고, 예전 이메일 명단
 *   (SELF_CALENDAR_ALLOWED_EMAILS)에 있던 사람을 미리 체크한다. 이 탭의 E열만 변경. DM·속성·트리거 변경 없음.
 * - calendarInviteSetup_: 실제 배포 URL·개인 연결 모드·정기 트리거·허용 명단 확인.
 * - calendarInviteKey_/calendarInviteRecord_: 등록 이메일과 Slack ID에 묶인 비공개 초대 이력.
 * - calendarInviteMessage_: 초대 DM의 계정 승인/연결 안내 생성. 발송 없음.
 * - activateCalendarOnboarding_: 본인 인증·초대·연결 세션 대조 후 봇 전용 BOT_USERS C만 활성화.
 * - calendarOnboardingNotice_: 본인 연결 완료 DM. 응답 유실 시 중복 전송 차단.
 * - calendarEnrollmentFlag_: 지정 봇의 현재 행/계정을 다시 대조한 뒤 발송 값만 변경.
 * - disconnectCalendarOnboarding_: 이 연결이 자동 활성화했던 발송만 해제. 기존 활성 설정 보존.
 * - 원본/운영 시트 변경 없음. 초대 대상 및 개인 식별자는 코드에 넣지 않는다.
 */
function calendarInviteKey_(route) {
  return 'CALENDAR_INVITE_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,route.email+'|'+route.slackId));
}
function calendarInviteRecord_(props,route) {
  return JSON.parse(props.getProperty(calendarInviteKey_(route))||'null');
}
function calendarInviteSetup_(props) {
  requiredProperty_(props,'BOT_SPREADSHEET_ID');
  const url=props.getProperty('CALENDAR_CONNECT_URL');
  if(props.getProperty('CALENDAR_ONBOARDING_READY')!=='true'||
      !/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-zA-Z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(url||'')) throw new Error('실제 연결 앱 배포·확인 후 CALENDAR_CONNECT_URL과 CALENDAR_ONBOARDING_READY를 설정하세요.');
  if(props.getProperty('ENABLE_PM_SEND')!=='true'||props.getProperty('ENABLE_CONNECTED_PM_SEND')!=='true'||
      props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE')!=='true'||props.getProperty('ENABLE_CALENDAR_BRIEFING')!=='true'||
      props.getProperty('ENABLE_CALENDAR_SELF_ENROLLMENT')!=='true') throw new Error('개인 일정·자기 연결·정기 발송 모드를 먼저 준비하세요.');
  if((props.getProperty('CONNECTOR_SIGNING_KEY')||'').length<43) throw new Error('연결 앱과 중앙의 서명키 설정을 먼저 확인하세요.');
  const handlers=ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction());
  if(['sendScheduledBriefing11','sendScheduledBriefing14','sendScheduledBriefing17'].some(name=>handlers.filter(h=>h===name).length!==1)) throw new Error('현재 실행 계정의 정기 DM 트리거(10:30·14:00·17:00)를 확인하세요. 09_자동실행.gs → installBriefingTriggers');
  const registry=selfCalendarRegistry_(props);
  const users=SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID')).getSheetByName(BOT_WORKBOOK.usersTab);
  if(users&&selfCalendarUsesConnectColumn_(users)) {
    // 체크박스 기준: 체크된 사람 중 초대 기록이 없거나 거절로 끝난 사람만, 한 번에 25명.
    const pending=registry.filter(route=>{const old=calendarInviteRecord_(props,route);return !old||old.status==='rejected';});
    if(!pending.length) throw new Error('새로 초대할 대상이 없습니다. BOT_USERS calendar_connect 체크와 기존 초대 기록을 확인하세요.');
    if(pending.length>25) console.log('초대 대상 '+pending.length+'명 중 25명만 이번에 처리합니다. 나머지는 다시 실행하세요.');
    return {url,routes:pending.slice(0,25)};
  }
  const names=JSON.parse(props.getProperty('CALENDAR_INVITE_PM_NAMES')||'[]');
  if(!Array.isArray(names)||!names.length||names.length>25||names.some(n=>typeof n!=='string'||!n.trim())||new Set(names).size!==names.length) throw new Error('CALENDAR_INVITE_PM_NAMES에 초대할 PM 이름 1~25명을 JSON 배열로 지정하세요.');
  const routes=names.map(name=>{
    const matches=registry.filter(route=>route.pm===name.trim());
    if(matches.length!==1) throw new Error('초대 대상의 이름·회사 이메일·Slack 연결을 확인하세요.');
    return matches[0];
  });
  return {url,routes};
}
function calendarInviteMessage_(route,url) {
  return '📅 *'+escapeSlack_(route.pm)+'* 님, 개인 일정 브리핑을 연결해주세요.\n\n'+
    '<'+url+'|회사 Google 계정으로 내 일정 연결>\n\n'+
    '개인 캘린더 · PM Team Schedule · PM Review & Delivery · 대한민국의 휴일을 읽습니다.\n'+
    '본인 계정으로 Google 권한을 승인한 뒤 화면에서 동의하고 연결을 완료해주세요.\n'+
    '연결되면 확인 DM을 보내고, 평일 10:30·14:00·17:00 부근 개인 업무 브리핑에 내 회의를 함께 넣어 드립니다. Google Tasks는 읽지 않습니다.\n'+
    CALENDAR_LINK_TIP;
}
function previewCalendarConnectionInvites() {
  const props=PropertiesService.getScriptProperties();
  let setup;
  // 새 대상이 없는 것은 정상 상태라 미리보기에서는 오류 대신 안내로 끝낸다.
  try { setup=calendarInviteSetup_(props); }
  catch(error) { if(/새로 초대할 대상이 없습니다/.test(error.message)) {console.log('새로 초대할 대상 없음 · 체크된 PM은 모두 초대·연결 기록이 있습니다 | 발송 없음');return;} throw error; }
  setup.routes.forEach(route=>{
    const record=calendarInviteRecord_(props,route);
    console.log(route.pm+' | 초대 상태 '+(record?record.status:'미발송'));
    console.log(calendarInviteMessage_(route,setup.url));
  });
  console.log('초대 미리보기만 | Slack 발송·시트/속성/트리거 변경 없음');
}
function sendCalendarConnectionInvites() {
  const props=PropertiesService.getScriptProperties(),setup=calendarInviteSetup_(props);
  const token=requiredProperty_(props,'SLACK_BOT_TOKEN');
  const lock=LockService.getUserLock();
  if(!lock.tryLock(1000)) throw new Error('다른 캘린더 연결 작업 진행 중. 잠시 후 다시 시도하세요.');
  try {
    const shareFile=props.getProperty('ENABLE_CALENDAR_AUTO_SHARE')==='true'?calendarConnectorFile_(props):null;
    setup.routes.forEach(route=>{
      if(shareFile) {
        try {
          const access=ensureCalendarConnectorViewer_(route,shareFile);
          console.log(route.pm+' | 연결 앱 보기 권한 '+(access==='existing'?'기존 유지':'추가 확인'));
        } catch(_) {console.log(route.pm+' | 연결 앱 보기 권한 확인 실패. 초대 DM 중지');return;}
      }
      const old=calendarInviteRecord_(props,route);
      if(old&&old.status!=='rejected') {console.log(route.pm+' | 기존 초대/연결 기록 있음. 중복 DM 없음');return;}
      const record={pm:route.pm,slackId:route.slackId,status:'pending',issuedAt:Date.now()};
      props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
      try {
        postSlackDm_(token,route.slackId,calendarInviteMessage_(route,setup.url),'calendar-connect-invite');
        record.status='sent';props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
        console.log(route.pm+' | 캘린더 연결 링크 DM 발송 완료');Utilities.sleep(1100);
      } catch(error) {
        record.status=error.definitive===true?'rejected':'uncertain';
        props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
        console.log(route.pm+' | 초대 발송 '+(record.status==='rejected'?'거절됨':'결과 확인 필요')+' | 자동 중복 발송 없음');
      }
    });
  } finally {lock.releaseLock();}
}
function calendarEnrollmentFlag_(route,props,enabled) {
  const bot=SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID'));
  const sheet=bot.getSheetByName(BOT_WORKBOOK.usersTab);
  const row=sheet.getRange(route.row,1,1,4).getValues()[0];
  if(String(row[0]).trim()!==route.pm||String(row[1]).trim()!==route.slackId||String(row[3]).trim().toLowerCase()!==route.email) throw new Error('가입 대상 행이 변경됐습니다. 명단 재확인 필요');
  if(row[2]!==enabled) sheet.getRange(route.row,3).setValue(enabled);
}
function activateCalendarOnboarding_(r,props,route) {
  const sheet=selfCalendarStore_(props,false);
  const rows=sheet&&sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues():[];
  const matches=rows.filter(row=>row[0]===route.email);
  const state=matches.length===1?JSON.parse(matches[0][1]):null;
  if(!state||!state.connected||state.connectionId!==r.connectionId||state.pm!==route.pm||state.slackId!==route.slackId) throw new Error('가입 대상 연결 세션 불일치');
  const record=calendarInviteRecord_(props,route);
  if(props.getProperty('ENABLE_CALENDAR_SELF_ENROLLMENT')!=='true'||props.getProperty('CALENDAR_ONBOARDING_READY')!=='true'||
      !record||!['pending','sent','uncertain','connected','confirmed'].includes(record.status)||record.pm!==route.pm||record.slackId!==route.slackId) {
    return {connected:true,scheduleEnabled:false,notice:'not-enabled',pm:route.pm};
  }
  if(props.getProperty('ENABLE_PM_SEND')!=='true'||props.getProperty('ENABLE_CONNECTED_PM_SEND')!=='true'||props.getProperty('ENABLE_CALENDAR_BRIEFING')!=='true') return {connected:true,scheduleEnabled:false,notice:'pending',pm:route.pm};
  const handlers=ScriptApp.getProjectTriggers().map(trigger=>trigger.getHandlerFunction());
  if(['sendScheduledBriefing11','sendScheduledBriefing17'].some(name=>handlers.filter(h=>h===name).length!==1)) return {connected:true,scheduleEnabled:false,notice:'pending',pm:route.pm};
  if(record.connectionId!==r.connectionId) {
    record.previousSendEnabled=route.sendEnabled;record.connectionId=r.connectionId;
    record.confirmedAt=0;record.noticeAttempts=0;record.noticeUncertain=false;
  }
  // DM 실패 후 재시도 시에도 자동 활성화의 이전 상태를 잃지 않도록 먼저 기록한다.
  record.status='connected';props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
  calendarEnrollmentFlag_(route,props,true);
  const notice=calendarOnboardingNotice_(props,route,record,state);
  props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
  return {connected:true,scheduleEnabled:true,notice,pm:route.pm};
}
function calendarOnboardingNotice_(props,route,record,state) {
  if(record.confirmedAt) {record.status='confirmed';return 'sent';}
  if(record.noticeUncertain) return 'uncertain';
  const slot='calendar-connected-'+record.connectionId;
  const journalKey='BOT_DELIVERY_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,route.slackId+'|'+slot));
  const journal=JSON.parse(props.getProperty(journalKey)||'null');
  if(journal&&journal.state==='sent') {record.confirmedAt=Date.now();record.status='confirmed';return 'sent';}
  if(journal&&journal.state==='pending') {record.noticeUncertain=true;return 'uncertain';}
  if((record.noticeAttempts||0)>=3) return 'uncertain';
  record.noticeAttempts=(record.noticeAttempts||0)+1;
  props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
  const sources=state.sources||[],ok=sources.filter(source=>source.status==='ok').length;
  const message='✅ *'+escapeSlack_(route.pm)+'* 님, 개인 일정 브리핑 연결이 완료됐습니다.\n'+
    '평일 10:30(오전) · 14:00(새 소식만) · 17:00(마무리) 부근에 업무·회의·Slack 요청을 모아 DM으로 보내 드립니다.\n'+
    '캘린더 조회 '+ok+'/4'+(ok<4?' · 일부 캘린더의 구독·읽기 권한은 연결 화면에서 확인해주세요.':'');
  try {
    postSlackDm_(requiredProperty_(props,'SLACK_BOT_TOKEN'),route.slackId,message,slot);
    record.confirmedAt=Date.now();record.status='confirmed';return 'sent';
  } catch(error) {
    if(error.definitive!==true&&error.code!=='SLACK_RATE_LIMIT') record.noticeUncertain=true;
    return record.noticeUncertain?'uncertain':'pending';
  }
}
function disconnectCalendarOnboarding_(r,props,route) {
  const record=calendarInviteRecord_(props,route);
  if(!record||record.connectionId!==r.connectionId) return;
  if(record.previousSendEnabled===false) calendarEnrollmentFlag_(route,props,false);
  record.status='sent';record.confirmedAt=0;record.connectionId='';
  props.setProperty(calendarInviteKey_(route),JSON.stringify(record));
}

// BOT_USERS E열에 calendar_connect 체크박스를 만든다. 예전 이메일 명단에 있던 사람은 미리 체크해 동작을 유지한다.
function setupCalendarConnectColumn() {
  const props=PropertiesService.getScriptProperties();
  const sheet=SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID')).getSheetByName(BOT_WORKBOOK.usersTab);
  if(!sheet||sheet.getRange(1,4).getValue()!=='email') throw new Error('BOT_USERS D열 email이 필요합니다. syncBotUsersFromSlack을 먼저 실행하세요. 시트 변경 없음.');
  const header=String(sheet.getRange(1,5).getValue()||'').trim();
  if(header&&header!==CALENDAR_CONNECT_HEADER) throw new Error('BOT_USERS E1에 다른 값('+header+')이 있어 중지합니다. 시트 변경 없음.');
  let allowed;
  try { allowed=JSON.parse(props.getProperty('SELF_CALENDAR_ALLOWED_EMAILS')||'[]'); }
  catch(_) { throw new Error('SELF_CALENDAR_ALLOWED_EMAILS 형식 오류. 시트 변경 없음.'); }
  const allowedSet=new Set((Array.isArray(allowed)?allowed:[]).map(email=>String(email).trim().toLowerCase()));
  const count=Math.max(0,sheet.getLastRow()-1);
  const rows=count?sheet.getRange(2,1,count,5).getValues():[];
  const values=rows.map(row=>[row[4]===true||allowedSet.has(String(row[3]||'').trim().toLowerCase())]);
  if(!header) sheet.getRange(1,5).setValue(CALENDAR_CONNECT_HEADER);
  if(count) {
    const range=sheet.getRange(2,5,count,1);
    range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    range.setValues(values);
  }
  const checked=values.filter(value=>value[0]).length;
  const noEmail=rows.filter((row,index)=>values[index][0]&&!String(row[3]||'').trim()).map(row=>String(row[0]).trim());
  console.log('BOT_USERS calendar_connect 열 준비 · 체크 '+checked+'명 (예전 이메일 명단 '+allowedSet.size+'명 반영)'+
    (noEmail.length?' · 이메일 없어 제외될 행: '+noEmail.join(', '):'')+
    '\n이제 이 열에 체크하면 연결 허용·초대 대상이 됩니다 · E열만 변경, DM·속성·트리거 변경 없음');
}
