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
 * 17-05. 정확도 점검 [직접 실행]
 * - previewBriefingAccuracy(): 본인(PILOT_PM_NAME) 기준으로 봇이 본 업무와 Slack 글을 모두 나열한다.
 *   업무: 봇 시트 BOT_TASKS의 내 업무 종류별 건수와 키. Slack: 나에게 해당하는 글 중 DM 항목이 된 것(안내 여부)과
 *   분류에서 뺀 것(완료·LID·단순 언급 등). 실제 Slack·업무 시트와 나란히 놓고 빠진 것·잘못 들어간 것을 찾는다.
 * - 사용: 아무 때나. 봇 시트·저장된 Slack 자료만 읽는다. 원본 시트·Slack API·발송 이력 변경 및 DM 없음.
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

function previewBriefingAccuracy() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const users = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const pilot = findPilotRecipient_(users);
  if (!pilot || !/^[UW][A-Z0-9]{8,}$/.test(pilot.id)) throw new Error('본인 Slack 연결을 확인하세요.');
  const route = {pm:getPilotPmName_(users), id:pilot.id};
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  const lines = ['[정확도 점검] ' + route.pm + ' · ' + formatBriefingDay_(day) + ' · 읽기만, 변경·발송 없음'];

  // 1) 업무: 봇 시트에 담긴 내 업무(원본 시트에서 읽어 온 결과)
  const rows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders), BOT_WORKBOOK.taskHeaders.length);
  const own = rows.filter(row => row[12] === true && String(row[1] || '').trim() === route.pm && isHaCvBriefingTask_(row[0]));
  const byType = new Map();
  own.forEach(row => { const type = String(row[0]).split('|')[0]; byType.set(type, (byType.get(type) || []).concat(String(row[0]))); });
  lines.push('', '1) 업무 · 봇 시트 기준 ' + own.length + '건 (DM에는 이 중 기한·상태 조건에 맞는 것만 실림)');
  byType.forEach((keys, type) => lines.push('• ' + type + ' ' + keys.length + '건: ' + keys.slice(0, 10).join(' / ') +
    (keys.length > 10 ? ' 외 ' + (keys.length - 10) + '건' : '')));
  if (!own.length) lines.push('• 없음 — 업무 시트 담당 탭에 내 업무가 실제로 없는지 확인');

  // 2) Slack: 나에게 해당하는 글 → DM 항목 / 분류에서 제외
  const snapshot = readBbpmSnapshot_(props, bot);
  if (!snapshot) lines.push('', '2) Slack · 저장된 자료 없음 (collectBbpmSnapshot 먼저 실행)');
  else {
    const meta = snapshot.meta;
    const records = classifySlackSnapshot_(snapshot, [route]);
    const items = buildSlackDigestItems_(records);
    const seen = readSlackDigestSeen_(props, route.id);
    const dropped = records.filter(record => !classifySlackDigest_(record));
    const posted = ts => Utilities.formatDate(new Date(Number(ts) * 1000), BRIEFING.timezone, 'MM/dd');
    const firstLine = text => Array.from(slackDigestPlain_(text).replace(/\s+/g, ' ').trim()).slice(0, 40).join('');
    lines.push('', '2) Slack · ' + Utilities.formatDate(new Date(meta.oldest * 1000), BRIEFING.timezone, 'MM/dd') + '~' +
      Utilities.formatDate(new Date(meta.newest * 1000), BRIEFING.timezone, 'MM/dd HH:mm') + ' · 나에게 해당하는 글 ' + records.length +
      '건 → DM 항목 ' + items.length + '개(묶음) · 분류 제외 ' + dropped.length + '건');
    items.forEach(item => lines.push('• [' + (item.category === 'direct' ? '개인' : 'BBPM') + '] ' + item.kind + ' · 원문 ' + posted(item.ts) +
      (item.deadline ? ' · 기한 ' + item.deadline : '') + ' · ' + (seen.includes(slackDigestFingerprint_(item)) ? 'DM 안내됨' : '아직 안 실림') +
      (item.mergedCount > 1 ? ' · ' + item.mergedCount + '건 묶음' : '') + ' · ' + item.url));
    if (dropped.length) lines.push('제외된 글 (완료·취소·LID·단순 언급 등):');
    dropped.forEach(record => lines.push('• ' + posted(record.ts) + ' · ' + firstLine(record.text) + ' · ' + record.url));
  }
  lines.push('', '👉 Slack에서 나를 멘션한 글·업무 시트 담당 탭과 비교: 목록에 없으면 놓친 것, 엉뚱한 종류면 잘못 분류된 것');
  console.log(lines.join('\n'));
}
