/**
 * 07. 업무브리핑
 * - 역할: 시트 업무 요약·개인 미리보기·공통 표시
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 07-01. 전체 PM 업무 미리보기 [직접 실행]
 * - 함수: refreshAndPreviewPmBriefings()
 * - 기능: 업무를 갱신하고 일별 이력을 저장한 뒤 PM별 시트 문안을 로그로 출력한다.
 * - 사용: 현재 시트 업무를 갱신하고 PM별로 점검할 때 실행.
 * - 영향: BOT_TASKS·BOT_DAILY_HISTORY·필요시 BOT_USERS 변경. DM 없음.
 *
 * 07-02. 브리핑 담당자 선택 [내부]
 * - selectHaCvPreviewOwners_(pmNames, rows): 수집된 담당자와 활성 업무 담당자의 합집합을 고른다.
 *
 * 07-03. 지원 업무 확인 [내부]
 * - isHaCvBriefingTask_(key): 업무 키가 현재 지원하는 6종 알림인지 확인한다.
 *
 * 07-04. 시트 업무 문안 [내부]
 * - formatHaCvBriefing_(pm, rows, day, trend, mode, basis): PM별 업무와 인원·링크·검수 기한을 간결하게 만든다.
 *
 * 07-05. 오전·오후 업무 제목 [내부]
 * - formatPersonalWorkBriefing_(pm, rows, day, trend, slot, preview): 같은 업무 조건을 유지하며 날짜·요일과 오전/마무리 인사를 붙인다. preview=true이면 미리보기로 표시. 조회 시각은 발송부에서 조립한다.
 *
 * 07-06. 업무 유형별 표시 [내부]
 * - appendCompactHaCvGroup_(lines, label, rows, count, unit, day): 종료·인원은 건수, 어뷰저는 날짜, 직접 검수는 각 파일 링크·기한을 붙인다.
 *
 * 07-07. 시트 링크 확인 [내부]
 * - isSheetUrl_(url): Google 스프레드시트 링크인지 확인한다.
 *
 * 07-08. 짧은 날짜 [내부]
 * - formatShortDate_(value): ISO 날짜를 월/일로 표시한다.
 *
 * 07-09. 기한 표시 [내부]
 * - formatDueLabel_(date, day): 오늘·경과·미정 등을 포함해 기한을 표시한다.
 *
 * 07-10. 작업자 인원 합산 [내부]
 * - summarizeHaCvCounts_(rows): 헤즈업·HUB 근거 행 수로 담당자별 인원을 합산한다.
 *
 * 07-11. 오늘 업무인지 확인 [내부]
 * - assertFreshPilotTasks_(tasks, day): 저장 업무가 오늘 갱신됐는지 확인하고 오래되면 중지한다.
 *
 * 07-12. 봇 탭 행 읽기 [내부]
 * - readBotRows_(sheet, width): 헤더 다음의 필요한 열만 읽는다.
 *
 * 07-13. 본인 수신자 확인 [내부]
 * - findPilotRecipient_(rows): 시범 PM의 Slack ID와 발송 활성 여부를 찾는다.
 *
 * 07-14. 시범 PM 선택 [내부]
 * - getPilotPmName_(rows): 설정된 이름을 우선하고 없으면 ID가 등록된 유일한 PM을 선택한다.
 *
 * 07-15. Slack ID 가리기 [내부]
 * - maskPilotId_(id): 로그에 Slack ID 일부만 표시한다.
 *
 * 07-16. 표시 날짜 정리 [내부]
 * - formatPilotDate_(value): Date 또는 문자열 날짜를 문안용 문자열로 바꾼다.
 *
 * 07-17. 날짜·요일 표시 [내부]
 * - formatBriefingDay_(day): yyyy-MM-dd를 MM/dd(요일)로 바꾼다.
 * - 사용: 개인 브리핑 첫 줄 조립 시 호출. 외부 조회·저장·DM 없음.
 */

/** 현재 개인 브리핑의 공통 문안과 시트 미리보기. */

// 최신 BOT_TASKS로 PM마다 자기 업무만 담긴 개인 문안을 만든다. Slack에는 보내지 않는다.
function refreshAndPreviewPmBriefings() {
  const summary = refreshBotTasks();
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const sheet = requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders);
  const rows = readBotRows_(sheet, BOT_WORKBOOK.taskHeaders.length);
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  const trends = saveHaCvDailyHistory_(bot, rows, day, new Date());
  const owners = selectHaCvPreviewOwners_(summary.pmNames, rows);
  if (!owners.length) {
    console.log('HA-CV 개인 브리핑 후보가 없습니다.');
    return;
  }
  owners.forEach(pm => console.log(formatHaCvBriefing_(pm, rows, day, trends[pm])));
}

function selectHaCvPreviewOwners_(pmNames, rows) {
  const taskOwners = rows.filter(row => row[12] === true && isHaCvBriefingTask_(row[0]))
    .map(row => String(row[1] || '').trim()).filter(Boolean);
  return [...new Set(pmNames.concat(taskOwners).filter(Boolean))].sort();
}

function isHaCvBriefingTask_(key) {
  return ['HACV_ABUSE|', 'HACV_DUE_SOON|', 'HACV_HEADSUP|', 'HACV_REVIEW|',
    'PM_REVIEW|', 'TEST_REVIEW|']
    .some(prefix => String(key || '').startsWith(prefix));
}

function formatHaCvBriefing_(pm, rows, day, trend, mode, basis) {
  const tasks = rows.filter(row => row[12] === true &&
    String(row[1] || '').trim() === pm && isHaCvBriefingTask_(row[0]));
  const counts = summarizeHaCvCounts_(tasks)[pm] || { headsUp: 0, review: 0 };
  const grouped = new Map(['HACV_DUE_SOON', 'HACV_ABUSE', 'PM_REVIEW', 'TEST_REVIEW',
    'HACV_HEADSUP', 'HACV_REVIEW'].map(key => [key, []]));
  tasks.forEach(row => grouped.get(String(row[0]).split('|', 1)[0]).push(row));
  const dueSoon = grouped.get('HACV_DUE_SOON');
  const abuse = grouped.get('HACV_ABUSE');
  const pmReview = grouped.get('PM_REVIEW');
  const testReview = grouped.get('TEST_REVIEW');
  const headsUp = grouped.get('HACV_HEADSUP');
  const workerReview = grouped.get('HACV_REVIEW');
  const lines = ['📌 *' + escapeSlack_(pm) + '* 님 업무 브리핑 · ' + formatShortDate_(day) +
    (basis ? ' · ' + escapeSlack_(basis) : '') + (mode === 'send' ? '' : ' (미리보기)')];
  const trendLine = formatHaCvDailyTrend_(trend);
  if (trendLine) lines.push(trendLine);
  if (!tasks.length) return lines.concat('오늘 확인할 특이사항 없음').join('\n');
  lines.push('', '*오늘 확인할 업무*');
  appendCompactHaCvGroup_(lines, '언어쌍 종료 임박', dueSoon, dueSoon.length, '건', day);
  appendCompactHaCvGroup_(lines, '헤즈업 대상', headsUp, counts.headsUp, '명', day);
  appendCompactHaCvGroup_(lines, '예비 작업자 검토', workerReview, counts.review, '명', day);
  appendCompactHaCvGroup_(lines, '어뷰저 관리', abuse, abuse.length, '건', day);
  appendCompactHaCvGroup_(lines, '1차 검수', pmReview, pmReview.length, '건', day);
  appendCompactHaCvGroup_(lines, '테스트지 검토', testReview, testReview.length, '건', day);
  return lines.join('\n');
}

// 원천 상태상 미완료 업무는 오전/오후 모두 유지한다. 실제 완료/진척은 추정하지 않는다.
// 첫 줄은 인사만 두고, 회차·조회 시각은 발송부에서 기준 줄 하나로 모은다.
// 전일 대비·3일 연속 줄은 DM에 싣지 않는다(사용자 결정 10/22). 일별 기록 저장은 그대로 유지.
function formatPersonalWorkBriefing_(pm, rows, day, trend, slot, preview) {
  const evening = slot === '17:00';
  const body = formatHaCvBriefing_(pm, rows, day, null, 'send').split('\n').slice(1);
  const at = body.indexOf('*오늘 확인할 업무*');
  const taskLines = at < 0 ? ['• 확인할 특이사항 없음'] : body.slice(at + 1);
  return [(evening ? '🌙 ' : '☀️ ') + '*' + escapeSlack_(pm) + '* 님, ' + formatBriefingDay_(day) +
    (evening ? ' 마무리 브리핑 드립니다!' : ' 오전 브리핑 드립니다!') + (preview ? ' (미리보기)' : ''),
    '', '📌 *' + (evening ? '마무리 전 확인할 업무' : '오늘 확인할 업무') + '*'].concat(taskLines).join('\n');
}

// 'yyyy-MM-dd' → 'MM/dd(요일)'
function formatBriefingDay_(day) {
  const match = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(day || '');
  const weekday = '일월화수목금토'[new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])).getUTCDay()];
  return match[2] + '/' + match[3] + '(' + weekday + ')';
}

// 인원·종료 임박은 건수, 어뷰저는 기한별 요약, 직접 검수는 파일별 링크와 기한을 표시한다.
function appendCompactHaCvGroup_(lines, label, rows, count, unit, day) {
  if (!count || !rows.length) return;
  const sorted = [...rows].sort((a, b) =>
    (formatPilotDate_(a[17] || a[7]) || '9999').localeCompare(formatPilotDate_(b[17] || b[7]) || '9999') ||
    String(a[3] || '').localeCompare(String(b[3] || '')));
  const tabUrl = row => String(row[10] || '').trim().replace(/&range=[^&]*/, '');
  const linked = (title, url) => isSheetUrl_(url) ? '<' + url + '|' + escapeSlack_(title) + '>' : escapeSlack_(title);
  if (!['1차 검수', '테스트지 검토', '어뷰저 관리'].includes(label)) {
    const urls = [...new Set(sorted.map(tabUrl).filter(isSheetUrl_))];
    const title = urls.length ? urls.map(url => linked(label, url)).join(' · ') : escapeSlack_(label);
    const action={'언어쌍 종료 임박':'남은 작업·종료 일정 확인','헤즈업 대상':'대상자 메일 발송·상태 변경','헤즈업':'대상자 메일 발송·상태 변경','예비 작업자 검토':'유저 정보 검토·투입 판단'}[label]||'';
    lines.push('• ' + title + ' ' + count + unit + (action?' — '+action:''));
    return;
  }
  if (label === '어뷰저 관리') {
    const groups = new Map();
    sorted.forEach(row => {
      const date = formatPilotDate_(row[17] || row[7]);
      const url = tabUrl(row);
      const key = JSON.stringify([date, url]);
      if (!groups.has(key)) groups.set(key, {date, url, count:0});
      groups.get(key).count++;
    });
    groups.forEach(group => lines.push('• ' + linked(label, group.url) + ' ' + group.count +
      unit + ' · 작성 기한: ' + formatDueLabel_(group.date, day)+' — 대상 확인·리스트 작성'));
    return;
  }
  lines.push('• *' + label + ' ' + count + unit + '*');
  sorted.forEach(row => {
    const pair = String(row[3] || '언어쌍 미기재').trim();
    const source = String(row[10] || '').trim();
    const memo = [row[15], row[16]].filter(Boolean).map(escapeSlack_).join(' / ');
    const work = label === '1차 검수' ? String(row[5] || '')
      .replace(/\s*(검수 AGENT 완료|1차 검수중|1차검수중)[\s\S]*$/, '').trim() :
      label === '테스트지 검토' ? 'HT' : '';
    const name = [work, row[2] ? '프로젝트 ' + row[2] : '', pair].filter(Boolean).join(' · ');
    const line = '  • ' + linked(name, source) + ' · ' +
      (label === '1차 검수' ? '검수 기한: ' : '검토 기한: ') +
      formatDueLabel_(formatPilotDate_(row[17] || row[7]), day);
    lines.push(line + (memo ? ' — ' + memo : ''));
  });
}

function isSheetUrl_(url) {
  return String(url || '').startsWith('https://docs.google.com/spreadsheets/');
}

// 'yyyy-MM-dd' → 'MM/dd'. 형식이 다르면 그대로 둔다.
function formatShortDate_(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? match[1] + '/' + match[2] : String(value || '');
}

function formatDueLabel_(date, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '(기한 미정)';
  if (date < day) return formatShortDate_(date) + ' ⚠️ 기한 경과';
  if (date === day) return formatShortDate_(date) + ' (오늘)';
  return formatShortDate_(date);
}

function summarizeHaCvCounts_(rows) {
  const summary = {};
  rows.forEach(row => {
    if (row[12] !== true) return;
    const key = String(row[0] || '');
    const category = key.startsWith('HACV_HEADSUP|') ? 'headsUp'
      : key.startsWith('HACV_REVIEW|') ? 'review' : '';
    if (!category) return;
    const pm = String(row[1] || '').trim();
    if (!pm) return;
    if (!summary[pm]) summary[pm] = { headsUp: 0, review: 0 };
    summary[pm][category] += String(row[11] || '').split(',')
      .filter(value => /^\d+$/.test(value.trim())).length;
  });
  return summary;
}

function assertFreshPilotTasks_(tasks, day) {
  if (tasks.some(row => !(row[13] instanceof Date) ||
      Utilities.formatDate(row[13], BRIEFING.timezone, 'yyyy-MM-dd') !== day)) {
    throw new Error('오늘 갱신되지 않은 업무 후보가 있습니다. refreshAndPreviewPmBriefings를 먼저 실행하세요.');
  }
}

function readBotRows_(sheet, width) {
  return sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues()
    : [];
}

function findPilotRecipient_(rows) {
  const pm = getPilotPmName_(rows);
  const matches = rows.filter(row => String(row[0]).trim() === pm);
  if (matches.length > 1) throw new Error('BOT_USERS에 시범 PM 행이 중복됩니다.');
  return matches.length ? { id: String(matches[0][1]).trim(), enabled: matches[0][2] === true } : null;
}

// 명시 설정을 우선한다. 설정이 없으면 ID가 등록된 PM이 정확히 한 명일 때만 선택한다.
function getPilotPmName_(rows) {
  const props = PropertiesService.getScriptProperties();
  const configured = String(props.getProperty('PILOT_PM_NAME') || '').trim();
  if (configured) return configured;
  if (!rows) {
    const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
    const sheet = requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
    rows = readBotRows_(sheet, BOT_WORKBOOK.userHeaders.length);
  }
  const candidates = rows.filter(row => String(row[0] || '').trim() &&
    /^[UW][A-Z0-9]{8,}$/.test(String(row[1] || '').trim()));
  if (candidates.length !== 1) {
    throw new Error('시범 PM을 확정할 수 없습니다. PILOT_PM_NAME 속성을 설정하세요.');
  }
  return String(candidates[0][0]).trim();
}

function maskPilotId_(id) {
  return id ? id.slice(0, 2) + '…' + id.slice(-3) : '미입력';
}

function formatPilotDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, BRIEFING.timezone, 'yyyy-MM-dd');
  }
  return String(value || '').trim();
}
