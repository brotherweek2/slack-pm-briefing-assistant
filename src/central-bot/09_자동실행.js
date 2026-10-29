/**
 * 09. 자동실행
 * - 역할: 정기 DM 3회차(10:30 오전 · 14:00 오후 · 17:00 마무리)와 Slack 미리 수집 트리거의 설치·해제·상태 점검.
 * - 내부 회차 이름은 '11:00' / '14:00' / '17:00'으로 유지한다(발송 이력·문구 시트가 이 이름을 쓴다).
 *   실제 실행 시각과 화면 표시는 29번 파일의 SLOT_TIME·briefingSlotLabel_을 따른다. ('11:00' → 10:30 실행)
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 자동 호출. 이름 끝 _ 는 내부 함수.
 *
 * 09-01. 정기 DM 회차 [트리거가 호출 — 수동 실행도 실제 발송]
 * - sendScheduledBriefing11(): 10:30 오전 DM(업무·오늘 회의·Slack·점심 추천·한마디).
 * - sendScheduledBriefing14(): 14:00 오후 업데이트(오전 이후 새 업무·Slack만, 없으면 한 줄 인사).
 * - sendScheduledBriefing17(): 17:00 마무리 DM(업무·남은/내일 회의·Slack·내일 날씨·한마디).
 * - 쉬는 날(주말·공휴일·회사 휴무일, 28번 파일)은 건너뛴다. 연결 PM 모드면 20번 파일로 4명씩 이어 보낸다.
 * - 같은 날짜·회차는 PM마다 한 번만. 회차가 끝나면 관리자 요약 DM 1통(23번 파일).
 *
 * 09-02. 정기 DM 트리거 설치 [직접 실행]
 * - installBriefingTriggers(): 위 3개 트리거를 현재 계정에 다시 만든다(같은 이름은 지우고 1개씩). 지금 DM 없음.
 *   Apps Script는 정각을 보장하지 않는다(지정 시각 ±15분).
 *
 * 09-03. 정기 DM 트리거 해제 [직접 실행]
 * - removePersonalBriefingTriggers(): 현재 계정의 정기 DM 트리거 3개를 지운다. DM 없음.
 *
 * 09-04. Slack 미리 수집 트리거 [직접 실행]
 * - installBbpmCollectTrigger(): 10분마다 깨어나는 수집 트리거 1개 설치(있으면 그대로). 실제 수집은
 *   09:45~10:45 · 13:30~14:15 · 16:00~17:15에만 한다(03번 파일). DM 없음.
 * - removeBbpmCollectTrigger(): 수집 트리거 제거. DM 없음.
 *
 * 09-05. 자동화 상태 확인 [직접 실행]
 * - previewBriefingAutomationStatus(): 트리거 4개(수집·10:30·14:00·17:00) 개수, 최근 수집, Slack 자료 최신성 조회만.
 *
 * 09-06. 평일 판단 [내부]
 * - isBriefingWeekday_(now): 한국 시간 월~금이면 true. 공휴일·회사 휴무일은 28번 briefingDayOff_가 판단한다.
 */

/** 정기 DM 회차(트리거가 호출). 내부 이름 11:00 = 10:30 실행. */
function sendScheduledBriefing11() { sendScheduledBriefing_('11:00'); }
function sendScheduledBriefing14() { sendScheduledBriefing_('14:00'); }
function sendScheduledBriefing17() { sendScheduledBriefing_('17:00'); }

// 정기 DM 트리거 3개(10:30 오전 · 14:00 오후 업데이트 · 17:00 마무리)를 현재 계정에 다시 만든다.
// Apps Script는 정각을 보장하지 않는다(지정 시각 ±15분). 기존 같은 이름 트리거는 지우고 새로 만든다. 지금 DM 없음.
function installBriefingTriggers() {
  const plan = [['sendScheduledBriefing11', 10, 30], ['sendScheduledBriefing14', 14, 0], ['sendScheduledBriefing17', 17, 0]];
  const names = plan.map(p => p[0]);
  ScriptApp.getProjectTriggers().filter(trigger => names.includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  plan.forEach(([handler, hour, minute]) => ScriptApp.newTrigger(handler).timeBased()
    .atHour(hour).nearMinute(minute).everyDays(1).inTimezone(BRIEFING.timezone).create());
  console.log('정기 DM 트리거 설치: 10:30 · 14:00 · 17:00 부근 (각 1개) | 지금 Slack 발송 없음');
}

function sendScheduledBriefing_(slot) {
  const dayOff = briefingDayOff_(new Date());
  if (dayOff) { console.log(briefingSlotLabel_(slot) + ' 정기 DM 건너뜀 · ' + dayOff + ' | Slack 발송 없음'); return; }
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

// 월~금 판단만. 공휴일·회사 휴무일은 briefingDayOff_(28번)가 이 함수 위에서 판단한다.
function isBriefingWeekday_(now) {
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const weekday = new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

// 정기 DM 트리거 3개를 현재 계정에서 지운다. 다시 켜려면 installBriefingTriggers.
function removePersonalBriefingTriggers() {
  const handlers = ['sendScheduledBriefing11', 'sendScheduledBriefing14', 'sendScheduledBriefing17'];
  ScriptApp.getProjectTriggers().filter(trigger => handlers.includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  console.log('정기 DM 트리거(10:30·14:00·17:00) 제거 | Slack 발송 없음');
}

// 읽기 전용 미리 수집 트리거. 10분마다 깨어나되 09:45~10:45·13:30~14:15·16:00~17:15에만 수집한다.
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
  console.log('BBPM 미리 수집 트리거 설치: 10분마다, 09:45~10:45·13:30~14:15·16:00~17:15에만 수집 | Slack 발송 없음');
}

/** 현재 실행 계정이 설치한 트리거와 Slack 수집 상태를 읽기만 한다. */
function previewBriefingAutomationStatus() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const triggers = ScriptApp.getProjectTriggers();
  [['collectBbpmSnapshot', 'Slack 미리 수집(10분마다)'], ['sendScheduledBriefing11', '10:30 오전 DM'],
    ['sendScheduledBriefing14', '14:00 오후 업데이트'], ['sendScheduledBriefing17', '17:00 마무리 DM']].forEach(([handler, label]) => {
    const count = triggers.filter(item => item.getHandlerFunction() === handler).length;
    console.log(label + ' 트리거: ' + count + '개' + (count === 1 ? ' ✅' : ' ⚠️ 1개여야 함 → installBriefingTriggers 확인'));
  });
  console.log('확인 범위: 현재 실행 계정이 설치한 트리거 | 다른 계정의 트리거는 표시되지 않음');
  console.log('Slack 읽기 ' + (props.getProperty('ENABLE_SLACK_MENTION_READ') === 'true' ? 'ON' : 'OFF') +
    ' | 채널 자동 발견 ' + (props.getProperty('ENABLE_SLACK_CHANNEL_DISCOVERY') === 'true' ? 'ON' : 'OFF') +
    ' | DM 발송 ' + (props.getProperty('ENABLE_PM_SEND') === 'true' ? 'ON' : 'OFF'));
  const stamp = value => value && Number.isFinite(Number(value)) ?
    Utilities.formatDate(new Date(Number(value)), BRIEFING.timezone, 'MM/dd HH:mm') : '기록 없음';
  console.log('최근 수집 트리거 호출: ' + stamp(props.getProperty('BBPM_COLLECT_LAST_TRIGGER_AT')) +
    ' | 수집 시간대 09:45~10:45 / 13:30~14:15 / 16:00~17:15');
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
