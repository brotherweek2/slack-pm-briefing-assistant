/**
 * 09. 자동실행
 * - 역할: 수집·11시·17시 트리거 설치와 상태 점검
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 09-01. 11시 자동 DM [직접 실행]
 * - 함수: sendScheduledBriefing11()
 * - 기능: 평일 11시 회차를 시작한다. 연결 PM 모드(ENABLE_CONNECTED_PM_SEND)면 발송 대상 PM 전원에게 8명씩 이어 보내고, 아니면 본인 시범 1명에게 보낸다. 같은 회차는 한 번만.
 * - 사용: 설치된 11시 트리거가 호출. 수동 실행도 실제 발송이므로 주의.
 * - 영향: 실제 PM DM·업무/발송 이력 변경, 회차가 끝나면 관리자 요약 DM 1통.
 *
 * 09-02. 17시 자동 DM [직접 실행]
 * - 함수: sendScheduledBriefing17()
 * - 기능: 평일 17시 회차를 시작한다(오늘 남은·내일 회의, 점심 추천 없음). 대상·이어 보내기는 11시와 같다.
 * - 사용: 설치된 17시 트리거가 호출. 수동 실행도 실제 발송이므로 주의.
 * - 영향: 실제 PM DM·업무/발송 이력 변경, 회차가 끝나면 관리자 요약 DM 1통.
 *
 * 09-03. 정기 DM 설치 [직접 실행]
 * - 함수: installPersonalBriefingTriggers()
 * - 기능: 본인만 활성인지 확인하고 기존 동명 트리거를 한국 시간 11시·17시 부근 실행으로 교체한다.
 * - 사용: 처음 설치할 때만. 여러 PM이 발송 TRUE인 지금은 실행되지 않는다(트리거는 이미 설치됨). 정각 보장 아님.
 * - 영향: 동명11시/17시 트리거 교체. 이후 자동 DM 시작. 지금 DM 없음.
 *
 * 09-04. 정기 DM 해제 [직접 실행]
 * - 함수: removePersonalBriefingTriggers()
 * - 기능: 11시·17시 발송 함수의 현재 계정 트리거만 제거한다.
 * - 사용: 정기 DM을 중지할 때 실행.
 * - 영향: 현재계정11시/17시 트리거만 제거. DM 없음.
 *
 * 09-05. 자동 수집 설치 [직접 실행]
 * - 함수: installBbpmCollectTrigger()
 * - 기능: 없으면10분 주기 수집을 설치하고 기존1개는 보존하며 중복이면 중지한다.
 * - 사용: 수집 트리거가 없을 때 실행. 기존1개면 보존.
 * - 영향: 현재계정10분주기 수집 트리거 설치 가능. DM 없음.
 *
 * 09-06. 자동화 상태 확인 [직접 실행]
 * - 함수: previewBriefingAutomationStatus()
 * - 기능: 현재 계정 트리거 수·설정·수집 호출/결과·완료본 최신성을 조회한다.
 * - 사용: 자동화 설치·최근 수집 상태·최신성 점검 시 실행.
 * - 영향: 현재계정 상태 조회만. DM·설정/시트/트리거 변경 없음.
 *
 * 09-07. 자동 수집 해제 [직접 실행]
 * - 함수: removeBbpmCollectTrigger()
 * - 기능: 수집 함수의 현재 계정 트리거만 제거한다.
 * - 사용: 자동 수집을 중지할 때 실행.
 * - 영향: 현재계정 수집 트리거만 제거. DM 없음.
 *
 * 09-08. 평일 판단 [내부]
 * - isBriefingWeekday_(now): 한국 시간 기준 월~금이면 true. 공휴일은 판단하지 않는다.
 * - 사용: 11시·17시 정기 DM과 수집 트리거가 실행 초기에 호출. 수동 시험 함수는 영향 없음.
 * - 영향: 계산만. 외부 조회·저장·DM 없음.
 *
 * - 개인 연결 확대: ENABLE_CONNECTED_PM_SEND=true일 때만 개인 연결 완료 PM으로 정기 발송 대상을 바꾼다.
 *   ENABLE_SELF_CALENDAR_PIPELINE 및 BOT_USERS 발송 TRUE도 필요. 미설정 시 기존 본인 시험 유지.
 *   installPersonalBriefingTriggers는 본인 시험 설치용이다. 확대 전환 시 기존 11시/17시 트리거를 재사용한다.
 * - 연결 PM 확대 모드는 20번 파일의 회차별 이어 보내기를 사용한다. 기존 본인 모드는 유지한다.
 */

/** 한국 시간의 오전/오후 회차. 정각 보장이 아닌 실제 조회 시각도 표시한다. */
function sendScheduledBriefing11() { sendScheduledBriefing_('11:00'); }
function sendScheduledBriefing17() { sendScheduledBriefing_('17:00'); }

function sendScheduledBriefing_(slot) {
  if (!isBriefingWeekday_(new Date())) { console.log(slot + ' 정기 DM 건너뜀 · 주말 | Slack 발송 없음'); return; }
  const props = PropertiesService.getScriptProperties();
  const connectedMode = props.getProperty('ENABLE_CONNECTED_PM_SEND') === 'true';
  try {
    if (connectedMode && props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') !== 'true') {
      throw new Error('개인 연결 파이프라인 설정을 먼저 완료하세요.');
    }
    if(connectedMode) startConnectedBriefingRound_(slot);
    else sendPmBriefings_(true, true, slot);
  } catch (error) {
    // 시작 단계 오류(설정·권한·시트)는 이어 보내기 기록이 없으므로 여기서 관리자에게 알린다.
    notifyAdminRoundSummary_(slot, {error: error.message});
    throw error;
  }
}

// 정기 DM은 평일에만 보낸다. 공휴일은 따로 판단하지 않는다.
function isBriefingWeekday_(now) {
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const weekday = new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

// 현재 승인된 본인 시험 대상만 자동 발송한다. 다른 PM 확대는 별도 운영 전환 필요.
function installPersonalBriefingTriggers() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ENABLE_PM_SEND') !== 'true' ||
      props.getProperty('ENABLE_SLACK_MENTION_READ') !== 'true') {
    throw new Error('읽기·발송 허용 설정을 먼저 확인하세요.');
  }
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const rows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab,
    BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const pilot = findPilotRecipient_(rows);
  const enabled = rows.filter(row => row[2] === true);
  if (!pilot || !pilot.enabled || enabled.length !== 1 || String(enabled[0][1]).trim() !== pilot.id) {
    throw new Error('정기 시험은 본인만 발송 TRUE로 설정해야 합니다.');
  }
  const handlers = ['sendScheduledBriefing11', 'sendScheduledBriefing17'];
  ScriptApp.getProjectTriggers().filter(trigger => handlers.includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  try {
    handlers.forEach((handler, index) => ScriptApp.newTrigger(handler).timeBased()
      .atHour(index ? 17 : 11).nearMinute(0).everyDays(1).inTimezone(BRIEFING.timezone).create());
  } catch (error) {
    ScriptApp.getProjectTriggers().filter(trigger => handlers.includes(trigger.getHandlerFunction()))
      .forEach(trigger => ScriptApp.deleteTrigger(trigger));
    throw error;
  }
  console.log('본인 시험 트리거 설치: 한국 시간 11시·17시 부근 | 지금 Slack 발송 없음');
}

function removePersonalBriefingTriggers() {
  const handlers = ['sendScheduledBriefing11', 'sendScheduledBriefing17'];
  ScriptApp.getProjectTriggers().filter(trigger => handlers.includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  console.log('본인 시험 정기 트리거 제거 | Slack 발송 없음');
}

// 읽기 전용 미리 수집 트리거. 10분마다 깨어나되 10:00~11:15·16:00~17:15에만 수집한다.
function installBbpmCollectTrigger() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ENABLE_SLACK_MENTION_READ') !== 'true' ||
      props.getProperty('ENABLE_SLACK_CHANNEL_DISCOVERY') !== 'true') {
    throw new Error('Slack 읽기·채널 자동 발견 설정을 먼저 확인하세요.');
  }
  const existing = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'collectBbpmSnapshot');
  if (existing.length === 1 && existing[0].getEventType() === ScriptApp.EventType.CLOCK) {
    console.log('BBPM 수집 시간 트리거 1개가 이미 있습니다. 재설치하지 않음 | 실제 주기는 트리거 화면에서 확인');
    return;
  }
  if (existing.length) throw new Error('BBPM 수집 트리거 중복 또는 유형 오류. 트리거 화면에서 확인하세요.');
  ScriptApp.newTrigger('collectBbpmSnapshot').timeBased().everyMinutes(10).create();
  console.log('BBPM 미리 수집 트리거 설치: 10분마다, 10:00~11:15·16:00~17:15에만 수집 | Slack 발송 없음');
}

/** 현재 실행 계정이 설치한 트리거와 Slack 수집 상태를 읽기만 한다. */
function previewBriefingAutomationStatus() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const triggers = ScriptApp.getProjectTriggers();
  ['collectBbpmSnapshot', 'sendScheduledBriefing11', 'sendScheduledBriefing17'].forEach(handler => {
    console.log(handler + ' 트리거: ' + triggers.filter(item => item.getHandlerFunction() === handler).length + '개');
  });
  console.log('확인 범위: 현재 실행 계정이 설치한 트리거 | 다른 계정의 트리거는 표시되지 않음');
  console.log('Slack 읽기 ' + (props.getProperty('ENABLE_SLACK_MENTION_READ') === 'true' ? 'ON' : 'OFF') +
    ' | 채널 자동 발견 ' + (props.getProperty('ENABLE_SLACK_CHANNEL_DISCOVERY') === 'true' ? 'ON' : 'OFF') +
    ' | DM 발송 ' + (props.getProperty('ENABLE_PM_SEND') === 'true' ? 'ON' : 'OFF'));
  const stamp = value => value && Number.isFinite(Number(value)) ?
    Utilities.formatDate(new Date(Number(value)), BRIEFING.timezone, 'MM/dd HH:mm') : '기록 없음';
  console.log('최근 수집 트리거 호출: ' + stamp(props.getProperty('BBPM_COLLECT_LAST_TRIGGER_AT')) +
    ' | 수집 시간대 10:00~11:15 / 16:00~17:15');
  let status;
  try { status = JSON.parse(props.getProperty('BBPM_COLLECT_STATUS') || 'null'); } catch (ignored) {}
  console.log('최근 수집 실행: ' + (status ? stamp(status.at) + ' | ' +
    ({running:'시작 기록 (종료 미확인)',pending:'이어서 수집 필요',complete:'완료',error:'오류'}[status.status] || '알 수 없음') +
    ' | ' + (status.source === 'trigger' ? '자동' : '수동') : '기록 없음 (상태 기록 기능 적용 이전일 수 있음)'));
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const slot = props.getProperty(BBPM_SNAPSHOT.slotKey);
  const sheet = slot && BBPM_SNAPSHOT.tabs[slot] ? bot.getSheetByName(BBPM_SNAPSHOT.tabs[slot]) : null;
  if (!sheet || sheet.getLastRow() < 2) console.log('Slack 완료본 없음');
  else {
    const meta = JSON.parse(sheet.getRange(2, 1, 1, 1).getValues()[0][0]);
    const ageMinutes = (now.getTime() / 1000 - Number(meta.newest)) / 60;
    const age = Math.floor(ageMinutes);
    const limit = Number(props.getProperty('SLACK_SNAPSHOT_MAX_AGE_MINUTES') || BBPM_SNAPSHOT.maxAgeMinutes);
    const valid = Number.isFinite(limit) && limit >= 1 && limit <= 1440 &&
      Number.isFinite(ageMinutes) && ageMinutes >= -1;
    console.log('Slack 완료본 조회 기준: ' + stamp(Number(meta.newest) * 1000) +
      ' | ' + age + '분 경과 | 허용 ' + limit + '분 | ' + (!valid ? '설정·날짜 오류' : ageMinutes <= limit ? '최신성 범위 안' : '최신성 범위 초과'));
  }
  console.log('상태 조회만 수행 | 새 Slack 수집·발송·시트/속성/트리거 변경 없음');
}

function removeBbpmCollectTrigger() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'collectBbpmSnapshot')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  console.log('BBPM 미리 수집 트리거 제거 | Slack 발송 없음');
}
