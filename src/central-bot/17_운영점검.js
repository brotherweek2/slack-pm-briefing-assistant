/**
 * 17. 운영점검
 * 17-01. 운영 상태 확인 [직접 실행]
 * - previewBriefingHealth(): 계정 고정 여부·속성 저장량·봇 탭 행 수 확인.
 * - 사용: 업로드 후 실행. 설정·시트·트리거 변경 및 Slack 발송 없음.
 * 17-02. 실행 계정 고정 [직접 실행]
 * - pinBriefingExecutor(): 회사 계정인지 확인하고 실행 계정을 고정한다(다른 계정이 실행하면 봇 시트 접근을 막음). 속성 저장, DM 없음.
 * - 사용: 회사 계정에서 한 번 실행. 실행 계정 속성만 변경, DM 없음.
 * 17-03. 발송 로그 정리 [직접 실행]
 * - compactBriefingSendLog(): 지정 봇 파일의 BOT_SEND_LOG에서 90일 전 기록만 제거.
 * - 사용: previewBriefingHealth로 누적량 확인 후 실행. 유효하지 않은 날짜·최근 기록 보존.
 * - 원천 시트·수신자·트리거·캘린더·DM에는 영향 없음.
 * 17-04. 발송 로그 보관 [내부]
 * - retainBriefingSendLog_(sheet, rows, day): 브리핑 실행 잠금 안에서 90일 이력을 보존한다.
 * - 정기·통합 발송 전에 자동 호출. 최근 기록·판별 불가 날짜는 유지한다.
 */
function previewBriefingHealth() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const expected = props.getProperty('BRIEFING_EXECUTOR_EMAIL') || props.getProperty('CALENDAR_BRIEFING_ACCOUNT');
  console.log('실행 계정 검사: ' + (expected ? '연결 계정 일치' : '미고정 — 회사 계정에서 pinBriefingExecutor 실행 필요'));
  const all = props.getProperties();
  const bytes = value => Utilities.newBlob(String(value)).getBytes().length;
  const total = Object.keys(all).reduce((sum, key) => sum + bytes(key) + bytes(all[key]), 0);
  const largest = Math.max(0, ...Object.keys(all).map(key => bytes(all[key])));
  console.log('속성 사용량 약 ' + Math.ceil(total / 1024) + 'KB | 최대 값 ' + Math.ceil(largest / 1024) +
    'KB | ' + (total >= 400 * 1024 || largest >= 8 * 1024 ? '정리 필요' : '여유 있음'));
  [BOT_WORKBOOK.historyTab, BOT_WORKBOOK.logTab, 'BOT_SLACK_DISCOVERY_CACHE',
    'BOT_SLACK_REPLY_CACHE', 'BOT_SLACK_SNAPSHOT_A', 'BOT_SLACK_SNAPSHOT_B'].forEach(name => {
    const sheet = bot.getSheetByName(name);
    console.log(name + ': ' + (sheet ? Math.max(0, sheet.getLastRow() - 1) + '행' : '미생성'));
  });
  console.log('일별 조회·발송 로그 자동 보관 90일 | compactBriefingSendLog 수동 정리도 가능');
  console.log('조회만 수행 | 시트·속성·트리거 변경·Slack 발송 없음');
}

function pinBriefingExecutor() {
  const props = PropertiesService.getScriptProperties();
  requiredProperty_(props, 'BOT_SPREADSHEET_ID');
  const account = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!/@example\.test$/.test(account)) throw new Error('회사 계정에서 실행하세요. 계정 고정 없음');
  props.setProperty('BRIEFING_EXECUTOR_EMAIL', account);
  console.log('회사 실행 계정 고정 완료 | 시트·트리거 변경·Slack 발송 없음');
}

function compactBriefingSendLog() {
  const props = PropertiesService.getScriptProperties();
  const id = requiredProperty_(props, 'BOT_SPREADSHEET_ID');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('브리핑 실행 중: 로그 정리는 나중에 실행하세요.');
  try {
    const bot = SpreadsheetApp.openById(id);
    const sheet = requireBotSheet_(bot, BOT_WORKBOOK.logTab, BOT_WORKBOOK.logHeaders);
    const rows = readBotRows_(sheet, BOT_WORKBOOK.logHeaders.length);
    const today = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
    const keep = retainBriefingSendLog_(sheet, rows, today);
    console.log('BOT_SEND_LOG: 90일 전 ' + (rows.length - keep.length) + '행 정리 | 보존 ' + keep.length + '행 | Slack 발송 없음');
  } finally {lock.releaseLock();}
}

function retainBriefingSendLog_(sheet, rows, day) {
  const cutoff = new Date(new Date(day + 'T12:00:00Z').getTime() - 89 * 86400000).toISOString().slice(0, 10);
  const keep = rows.filter(row => {
    const raw = row[0];
    const date = Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())
      ? Utilities.formatDate(raw, BRIEFING.timezone, 'yyyy-MM-dd') : /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? String(raw) : '';
    return !date || date >= cutoff;
  });
  if (keep.length === rows.length) return rows;
  // 먼저 보존 데이터를 기록한다. 쓰기 실패 시 기존 데이터를 선행 삭제하지 않는다.
  if (keep.length) sheet.getRange(2, 1, keep.length, BOT_WORKBOOK.logHeaders.length).setValues(keep);
  sheet.getRange(keep.length + 2, 1, rows.length - keep.length, BOT_WORKBOOK.logHeaders.length).clearContent();
  return keep;
}
