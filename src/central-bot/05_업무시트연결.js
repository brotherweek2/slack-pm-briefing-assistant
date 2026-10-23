/**
 * 05. 업무시트연결
 * - 역할: 브리핑 전용 탭 준비와 업무 후보 동기화
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 05-01. 브리핑 탭 준비 [직접 실행]
 * - 함수: setupBotWorkbook()
 * - 기능: BOT_USERS·BOT_TASKS·발송 로그·일별 기록 탭을 준비하고 업무 후보를 갱신한다.
 * - 사용: 지정된 브리핑 전용 시트를 처음 준비할 때 실행.
 * - 영향: 봇 탭/업무/수신자·설정 속성 변경. 원천 읽기만, DM 없음.
 *
 * 05-02. 업무 후보 갱신 [직접 실행]
 * - 함수: refreshBotTasks()
 * - 기능: 설정된 사본 시트를 읽어 현재 업무 후보와 담당자를 브리핑 전용 탭에 반영한다.
 * - 사용: 현재 원천 조건을 BOT_TASKS에 반영할 때 실행.
 * - 영향: 봇 업무·필요시 수신자 갱신. 원천 읽기만, DM 없음.
 *
 * 05-03. 업무 수집 통합 [내부]
 * - refreshBotTasks_({ bot, sourceId }): PM 담당 탭·헤즈업·HUB·검수·테스트 후보를 합쳐 동기화한다. 영향: 원천 읽기·봇 업무/수신자 갱신.
 *
 * 05-04. 종료 임박 후보 [내부]
 * - buildHaCvUpcomingTasks_(pm, records, day, sourceUrl, gid, now): 구축중이고 목표 종료일이 오늘부터 설정 일수 안인 프로젝트를 업무 행으로 만든다.
 *
 * 05-05. 날짜 일수 더하기 [내부]
 * - addDaysToIsoDate_(day, count): ISO 날짜에 지정 일수를 더한다.
 *
 * 05-06. 시트 날짜 통일 [내부]
 * - normalizeSheetDate_(value): 시트 Date·문자열 값을 비교 가능한 ISO 날짜로 바꾼다.
 *
 * 05-07. 열 번호 변환 [내부]
 * - columnLetters_(number): 열 번호를 A1 표기 열 문자로 바꾼다.
 *
 * 05-08. HUB 검토 후보 [내부]
 * - buildHaCvBotTasks_(byPm, now): PM·언어쌍별 검토 필요 인원과 근거 행 링크를 업무 행으로 만든다.
 *
 * 05-09. 헤즈업 후보 [내부]
 * - buildHaCvHeadsUpTasks_(byPm, now): PM·언어쌍별 헤즈업 대상 인원과 근거 행 링크를 업무 행으로 만든다.
 *
 * 05-10. 봇 탭 준비 [내부]
 * - ensureBotSheet_(bot, name, headers): 브리핑 파일에 없는 탭·헤더를 준비하고 기존 헤더가 다르면 중지한다. 영향: 호출자가 전달한 봇 파일의 탭/헤더 준비 가능.
 *
 * 05-11. 봇 탭 확인 [내부]
 * - requireBotSheet_(bot, name, headers): 필요한 탭과 헤더가 존재하는지 확인하며 없으면 중지한다.
 *
 * 05-12. 헤더 검증 [내부]
 * - assertBotHeaders_(sheet, headers): 탭 헤더가 예상 구조와 같은지 검사한다.
 *
 * 05-13. 담당자 목록 반영 [내부]
 * - syncBotUsers_(sheet, owners): 새 담당자만 BOT_USERS에 추가하고 기존 ID·발송 설정은 보존한다. 영향: BOT_USERS 새 담당자 행 추가.
 *
 * 05-14. 업무 후보 반영 [내부]
 * - syncBotTasks_(sheet, detected): 자동 필드를 갱신하고 사라진 후보는 비활성화하며 수동 승인·수정 칸은 보존한다. 영향: BOT_TASKS 자동 필드·활성 상태 갱신.
 */

/**
 * 브리핑용 Google 시트 초기화 및 HA-CV 업무 후보 적재.
 * 원천 시트는 읽기만 하며 Slack 발송은 하지 않는다.
 */
const BOT_WORKBOOK = Object.freeze({
  bootstrapId: 'YOUR_BOT_SPREADSHEET_ID',
  usersTab: 'BOT_USERS',
  tasksTab: 'BOT_TASKS',
  logTab: 'BOT_SEND_LOG',
  historyTab: 'BOT_DAILY_HISTORY',
  upcomingDays: 7,
  pmReviewCopyId: 'YOUR_PM_REVIEW_SPREADSHEET_ID',
  testManagementCopyId: 'YOUR_TEST_MANAGEMENT_SPREADSHEET_ID',
  pmReviewStatuses: ['검수 AGENT 완료', '1차 검수중', '1차검수중'],
  userHeaders: ['pm_name', 'slack_user_id', 'send_enabled'],
  taskHeaders: [
    'task_key', 'owner', 'project_id', 'pair', 'task_type', 'issue',
    'action', 'deadline', 'priority', 'source', 'source_url', 'source_rows',
    'active', 'last_seen_at', 'approval', 'issue_override',
    'action_override', 'deadline_override',
  ],
  logHeaders: ['sent_at', 'slot', 'pm_name', 'task_keys', 'result'],
  historyHeaders: ['snapshot_date', 'record_type', 'owner', 'pair', 'source_row', 'task_key', 'scanned_at'],
});

// 이 함수를 한 번 실행하면 기존의 빈 스프레드시트에 필요한 탭을 만든다.
// 다시 실행해도 수동 입력한 Slack ID, 승인 상태, 수정 문구는 유지한다.
function setupBotWorkbook() {
  const props = PropertiesService.getScriptProperties();
  const sourceId = requiredProperty_(props, 'SOURCE_SPREADSHEET_ID');
  if (sourceId === BOT_WORKBOOK.bootstrapId) {
    throw new Error('원천 시트와 브리핑용 시트 ID가 같습니다. 작업을 중단합니다.');
  }
  const bot = SpreadsheetApp.openById(BOT_WORKBOOK.bootstrapId);
  ensureBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
  ensureBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders);
  ensureBotSheet_(bot, BOT_WORKBOOK.logTab, BOT_WORKBOOK.logHeaders);
  ensureBotSheet_(bot, BOT_WORKBOOK.historyTab, BOT_WORKBOOK.historyHeaders);
  props.setProperty('BOT_SPREADSHEET_ID', BOT_WORKBOOK.bootstrapId);
  const summary = refreshBotTasks_({ bot, sourceId });
  console.log('브리핑용 시트 준비 완료: ' + bot.getUrl());
  console.log('HA-CV 업무 후보 ' + summary.tasks + '건, 담당 PM 미확정 ' + summary.unassigned + '건');
}

// 원천 시트를 다시 읽어 업무 후보를 갱신한다. Slack 발송은 하지 않는다.
function refreshBotTasks() {
  const props = PropertiesService.getScriptProperties();
  const sourceId = requiredProperty_(props, 'SOURCE_SPREADSHEET_ID');
  const botId = requiredProperty_(props, 'BOT_SPREADSHEET_ID');
  if (sourceId === botId) throw new Error('원천 시트와 브리핑용 시트 ID가 같습니다.');
  const bot = SpreadsheetApp.openById(botId);
  const summary = refreshBotTasks_({ bot, sourceId });
  console.log('HA-CV 업무 후보 ' + summary.tasks + '건 갱신, 담당 PM 미확정 ' + summary.unassigned + '건');
  return summary;
}

// 이어 보내기 묶음(8명씩)마다 원천 4개 시트를 다시 읽지 않도록, 같은 날 15분 안의 갱신 결과를 재사용한다.
function refreshBotTasksForRound_(props) {
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  let cached = null;
  try { cached = JSON.parse(props.getProperty('BOT_TASKS_REFRESHED') || 'null'); } catch (_) {}
  if (cached && cached.day === day && Date.now() - cached.at < 15 * 60000 && Array.isArray(cached.pmNames)) {
    return {pmNames:cached.pmNames, reused:true};
  }
  const summary = refreshBotTasks();
  try { props.setProperty('BOT_TASKS_REFRESHED', JSON.stringify({day, at:Date.now(), pmNames:summary.pmNames})); }
  catch (error) { console.log('업무 갱신 시각 저장 생략 | ' + error.message); }
  return summary;
}

function refreshBotTasks_({ bot, sourceId }) {
  const users = requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
  const tasks = requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders);
  const source = SpreadsheetApp.openById(sourceId);
  const collected = collectHaCvReviewCandidates_(source);
  const headsUp = collectHaCvHeadsUpCandidates_(source);
  const now = new Date();
  const detected = buildHaCvBotTasks_(collected.byPm, now)
    .concat(buildHaCvHeadsUpTasks_(headsUp.byPm, now));
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const pmDashboards = collectHaCvPmDashboards_(source);
  const upcoming = pmDashboards.flatMap(({ pm, records, gid }) =>
    buildHaCvUpcomingTasks_(pm, records, day, source.getUrl(), gid, now));
  const abuse = pmDashboards.flatMap(({ pm, records, gid }) =>
    buildHaCvAbuseTasks_(pm, records, day, source.getUrl(), gid, now));
  const props = PropertiesService.getScriptProperties();
  const pmReviewId = props.getProperty('PM_REVIEW_SPREADSHEET_ID') || BOT_WORKBOOK.pmReviewCopyId;
  const testId = props.getProperty('TEST_MANAGEMENT_SPREADSHEET_ID') || BOT_WORKBOOK.testManagementCopyId;
  if ([sourceId, bot.getId()].includes(pmReviewId) || [sourceId, bot.getId()].includes(testId)) {
    throw new Error('추가 업무 원천 ID가 HA-CV 원천 또는 브리핑용 시트 ID와 같습니다.');
  }
  const pmReviews = collectPmReviewTasks_(SpreadsheetApp.openById(pmReviewId), day, now);
  const testReviews = collectTestReviewTasks_(SpreadsheetApp.openById(testId), now);
  syncBotUsers_(users, Object.keys(collected.byPm)
    .concat(Object.keys(headsUp.byPm), pmDashboards.map(item => item.pm),
      abuse.concat(pmReviews, testReviews).map(row => row[1])));
  syncBotTasks_(tasks, detected.concat(upcoming, abuse, pmReviews, testReviews));
  if (collected.unassigned.length) {
    console.warn('담당 PM 미확정으로 BOT_TASKS에서 제외: ' + collected.unassigned.join(', '));
  }
  if (headsUp.unassigned.length) {
    console.warn('담당 PM 또는 언어쌍 미확정으로 헤즈업 후보에서 제외: ' +
      headsUp.unassigned.map(row => row + '행').join(', '));
  }
  console.log('헤즈업 대상 ' + Object.keys(headsUp.byPm).reduce((total, pm) =>
    total + Object.keys(headsUp.byPm[pm]).reduce((count, pair) =>
      count + headsUp.byPm[pm][pair].length, 0), 0) + '명');
  console.log('담당 PM ' + pmDashboards.length + '명 | 구축중·목표 종료일 ' +
    BOT_WORKBOOK.upcomingDays + '일 이내 후보 ' + upcoming.length + '건');
  console.log('오늘·전날 목표 종료일의 어뷰저 관리 후보 ' + abuse.length + '건');
  console.log('PM Review 미완료 1차 검수 (기한 경과·예정·미정) ' + pmReviews.length +
    '건, 테스트지 검토 미완료 ' + testReviews.length + '건');
  return { tasks: detected.length + upcoming.length + abuse.length + pmReviews.length + testReviews.length,
    unassigned: collected.unassigned.length + headsUp.unassigned.length,
    pmNames: pmDashboards.map(item => item.pm) };
}

function buildHaCvUpcomingTasks_(pm, records, day, sourceUrl, gid, now) {
  const endDay = addDaysToIsoDate_(day, BOT_WORKBOOK.upcomingDays);
  return records.map(item => ({item, target:normalizeSheetDate_(item.targetEnd)}))
    .filter(({item, target}) => item.status === '구축중' && target && target >= day && target <= endDay)
    .sort((a, b) => a.target.localeCompare(b.target) || a.item.pair.localeCompare(b.item.pair))
    .map(({item, target}) => {
    const column = columnLetters_(item.firstColumn);
    return [
      'HACV_DUE_SOON|' + pm + '|' + item.pair + '|' + item.stage + '|' + column,
      pm,
      /^\d+$/.test(String(item.projectId || '').trim()) ? String(item.projectId).trim() : '',
      item.pair,
      '구축 현황 확인',
      item.stage + ' ' + item.batches.join('/') + ' 구축중, 목표 종료일 임박',
      '종료 일정과 남은 작업 확인',
      target,
      '', // 우선순위를 임의로 정하지 않는다.
      'HA-CV ' + pm + ' 탭',
      sourceUrl + '#gid=' + gid + '&range=' + column + '5:' + column + '6',
      column + '5:6',
      true,
      now,
    ];
  });
}

function addDaysToIsoDate_(day, count) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

function normalizeSheetDate_(value) {
  const match = String(value || '').match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day) return '';
  return match[1] + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function columnLetters_(number) {
  let letters = '';
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  }
  return letters;
}

function buildHaCvBotTasks_(byPm, now) {
  const detected = [];
  Object.keys(byPm).sort().forEach(pm => {
    Object.keys(byPm[pm]).sort().forEach(pair => {
      const rows = byPm[pm][pair];
      detected.push([
        'HACV_REVIEW|' + pm + '|' + pair,
        pm,
        '', // 원천에서 프로젝트 ID를 확인할 수 없다.
        pair,
        '신규 유저 검토',
        'HUB 검토 필요 ' + rows.length + '건',
          '유저 정보 확인 후 투입 여부 판단; 허용 시 Advanced 5 레벨 부여 및 상태 업데이트',
        '', // 원천에서 건별 마감일을 확인할 수 없다.
        '', // 확인된 우선순위 규칙이 없다.
        'HA-CV HUB',
        rows[0].url,
        rows.map(item => item.row).join(', '),
        true,
        now,
      ]);
    });
  });
  return detected;
}

function buildHaCvHeadsUpTasks_(byPm, now) {
  const detected = [];
  Object.keys(byPm).sort().forEach(pm => {
    Object.keys(byPm[pm]).sort().forEach(pair => {
      const rows = byPm[pm][pair];
      detected.push([
        'HACV_HEADSUP|' + pm + '|' + pair,
        pm,
        '',
        pair,
        'HA-CV 헤즈업',
        '헤즈업 대상 ' + rows.length + '명',
        '대상자에게 헤즈업 메일 발송 후 헤즈업 완료로 상태 변경',
        '', // 원천에서 건별 기한을 확인할 수 없다.
        '',
        'HA-CV 헤즈업 결과 집계',
        rows[0].url,
        rows.map(item => item.row).join(', '),
        true,
        now,
      ]);
    });
  });
  return detected;
}

function ensureBotSheet_(bot, name, headers) {
  let sheet = bot.getSheetByName(name);
  if (!sheet) {
    const existing = bot.getSheets();
    if (existing.length === 1 && existing[0].getLastRow() === 0 &&
        existing[0].getLastColumn() === 0) {
      sheet = existing[0];
      sheet.setName(name);
    } else {
      sheet = bot.insertSheet(name);
    }
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  assertBotHeaders_(sheet, headers);
  return sheet;
}

function requireBotSheet_(bot, name, headers) {
  const sheet = bot.getSheetByName(name);
  if (!sheet) throw new Error(name + ' 탭이 없습니다. setupBotWorkbook을 먼저 실행하세요.');
  assertBotHeaders_(sheet, headers);
  return sheet;
}

function assertBotHeaders_(sheet, headers) {
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (headers.some((header, index) => actual[index] !== header)) {
    throw new Error(sheet.getName() + ' 헤더가 예상과 다릅니다. 기존 데이터를 덮어쓰지 않았습니다.');
  }
}

function syncBotUsers_(sheet, owners) {
  const lastRow = sheet.getLastRow();
  const existing = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map(row => row[0].trim())
    : [];
  const known = new Set(existing);
  owners.sort().forEach(pm => {
    if (!known.has(pm)) {
      sheet.appendRow([pm, '', false]);
      known.add(pm);
    }
  });
}

function syncBotTasks_(sheet, detected) {
  const lastRow = sheet.getLastRow();
  const existing = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, BOT_WORKBOOK.taskHeaders.length).getValues()
    : [];
  const rowByKey = new Map();
  existing.forEach((row, index) => {
    const key = String(row[0]).trim();
    if (!key) return;
    if (rowByKey.has(key)) throw new Error('BOT_TASKS의 task_key가 중복됩니다: ' + key);
    rowByKey.set(key, index + 2);
  });
  const currentKeys = new Set();
  // A:N 자동 필드만 메모리에서 고친 뒤 한 번에 쓴다(행마다 시트를 읽고 쓰지 않음). O:R 사람 승인/수정값은 건드리지 않는다.
  const block = existing.map(row => row.slice(0, 14));
  const reactivated = [], appended = [];
  detected.forEach(autoColumns => {
    const key = autoColumns[0];
    currentKeys.add(key);
    const rowNumber = rowByKey.get(key);
    if (rowNumber) {
      if (existing[rowNumber - 2][12] === false) reactivated.push(rowNumber);
      block[rowNumber - 2] = autoColumns.slice(0, 14);
    } else {
      appended.push(autoColumns.concat(['PENDING', '', '', '']));
    }
  });
  rowByKey.forEach((rowNumber, key) => {
    if ((key.startsWith('HACV_REVIEW|') || key.startsWith('HACV_HEADSUP|') ||
         key.startsWith('HACV_OVERDUE|') ||
        key.startsWith('HACV_DUE_SOON|') || key.startsWith('HACV_ABUSE|') ||
        key.startsWith('PM_REVIEW|') || key.startsWith('TEST_REVIEW|')) &&
        !currentKeys.has(key)) {
      block[rowNumber - 2][12] = false;
    }
  });
  if (block.length) sheet.getRange(2, 1, block.length, 14).setValues(block);
  reactivated.forEach(rowNumber => sheet.getRange(rowNumber, 15).setValue('PENDING'));
  if (appended.length) sheet.getRange(lastRow + 1, 1, appended.length, appended[0].length).setValues(appended);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 14, sheet.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
}
