/**
 * 05. 업무시트연결 — 봇 시트 탭 준비, 업무 시트 3개 읽어 BOT_TASKS 반영, 원본 연결·전환
 *
 * 알아둘 것
 * - 원본 업무 시트는 읽기만 한다. 원본 주소는 스크립트 속성(ORIGINAL_…)에만 두고 코드·문서에 적지 않는다.
 * - 정기 갱신은 수집기별로 격리한다: 원본 하나가 깨져도 그 업무만 직전 결과로 두고 나머지는 진행(전부 실패할 때만 중단).
 * - 미리보기·전환(previewOriginalSheetConnection, switchToOriginalSheets)은 구조가 다르면 바로 멈춘다.
 * - BOT_TASKS는 30일 넘게 안 보인 비활성 행을 50행 이상 모였을 때 정리한다(사람이 고친 행은 보존).
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⚠️ setupBotWorkbook(): BOT_USERS·BOT_TASKS·발송 로그·일별 기록 탭을 준비하고 업무 후보를 갱신한다
 * - ⚠️ refreshBotTasks(): 업무 시트 3개(지금은 원본)를 읽어 BOT_TASKS에 반영한다
 * - 🔍 previewOriginalSheetConnection(): 원본 시트를 읽기만 해서 지금 연결된 시트와 업무 건수를 비교한다
 * - 🔍 previewOriginalMyTasks(): 원본 기준 내(관리자) 업무를 한 건씩 보여 준다
 * - 🔍 inspectOriginalSheetStructure(): 원본 세 시트의 탭 목록·머리글 줄과 수집기별 통과/실패를 보인다
 * - ⚠️ switchToOriginalSheets(): 미리보기와 같은 읽기 검사를 통과하면 업무 시트 속성(SOURCE_SPREADSHEET_ID 등)을 원본으로 바꾼다
 * - ⚠️ revertToCopySheets(): COPY_SHEETS_BACKUP으로 되돌린다
 *
 * 내부 함수 (직접 실행하지 않음)
 * - refreshBotTasksForRound_(props): 이어 보내기 묶음(4명씩)마다 원천 4개 시트를 다시 읽지 않도록, 같은 날 15분 안의 갱신 결과를 재사용한다
 * - refreshBotTasks_({ bot, sourceId }): PM 담당 탭·헤즈업·HUB·검수·테스트 후보를 합쳐 동기화한다
 * - buildHaCvUpcomingTasks_(pm, records, day, sourceUrl, gid, now): 구축중이고 목표 종료일이 오늘부터 설정 일수 안인 프로젝트를 업무 행으로 만든다
 * - addDaysToIsoDate_(day, count): ISO 날짜에 지정 일수를 더한다
 * - normalizeSheetDate_(value): 시트 Date·문자열 값을 비교 가능한 ISO 날짜로 바꾼다
 * - columnLetters_(number): 열 번호를 A1 표기 열 문자로 바꾼다
 * - buildHaCvBotTasks_(byPm, now): PM·언어쌍별 검토 필요 인원과 근거 행 링크를 업무 행으로 만든다
 * - buildHaCvHeadsUpTasks_(byPm, now): PM·언어쌍별 헤즈업 대상 인원과 근거 행 링크를 업무 행으로 만든다
 * - ensureBotSheet_(bot, name, headers): 브리핑 파일에 없는 탭·헤더를 준비하고 기존 헤더가 다르면 중지한다
 * - requireBotSheet_(bot, name, headers): 필요한 탭과 헤더가 존재하는지 확인하며 없으면 중지한다
 * - assertBotHeaders_(sheet, headers): 탭 헤더가 예상 구조와 같은지 검사한다
 * - syncBotUsers_(sheet, owners): 새 담당자만 BOT_USERS에 추가하고 기존 ID·발송 설정은 보존한다
 * - pruneBotTasks_(sheet, now): 30일 넘게 안 보인 비활성 업무 행을 정리한다(50행 이상 모였을 때)
 * - syncBotTasks_(sheet, detected, keepPrefixes): 자동 필드를 갱신하고 사라진 후보는 비활성화하며 수동 승인·수정 칸은 보존한다
 * - collectAllWorkTasks_(source, pmReviewSource, testSource, now, options): 세 업무 시트에서 업무 행을 모은다(읽기만)
 * - sheetIdFromValue_(value): 시트 주소를 넣어도 ID만 꺼낸다
 * - sheetValueHint_(raw): 시트 주소 형식 오류를 값 노출 없이 안내한다
 * - originalSheetPlan_(props, alreadySwitched): 업무 시트별 지금 주소와 원본 주소를 대조한다
 * - workTaskCounts_(parts): 업무 종류(업무 키 앞부분)·PM별 건수
 * - openWorkSheets_(plan, field, label): 업무 시트 3개를 열고, 실패하면 어느 시트인지 알린다
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

// 이어 보내기 묶음(4명씩)마다 원천 4개 시트를 다시 읽지 않도록, 같은 날 15분 안의 갱신 결과를 재사용한다.
function refreshBotTasksForRound_(props) {
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  let cached = null;
  try { cached = JSON.parse(props.getProperty('BOT_TASKS_REFRESHED') || 'null'); } catch (_) {}
  if (cached && cached.day === day && Date.now() - cached.at < 15 * 60000 && Array.isArray(cached.pmNames)) {
    return {pmNames:cached.pmNames, emptyPmTabs:cached.emptyPmTabs || [], sourceFailures:cached.sourceFailures || [],
      malformedPmTabs:cached.malformedPmTabs || [], yearGuessed:cached.yearGuessed || 0,
      keptPrefixes:cached.keptPrefixes || [], reused:true};
  }
  const summary = refreshBotTasks();
  // 사라진 담당 탭 경고는 같은 날 안에서는 유지한다(다음 회차 갱신에서 직전 값이 새 목록으로 바뀌어도 그날 요약에 남게).
  const missing = [...new Set((summary.missingPmTabs || []).concat(cached && cached.day === day ? cached.missingPmTabs || [] : []))];
  try { props.setProperty('BOT_TASKS_REFRESHED', JSON.stringify({day, at:Date.now(), pmNames:summary.pmNames,
    emptyPmTabs:summary.emptyPmTabs || [], missingPmTabs:missing, sourceFailures:summary.sourceFailures || [],
    malformedPmTabs:summary.malformedPmTabs || [], yearGuessed:summary.yearGuessed || 0,
    keptPrefixes:summary.keptPrefixes || []})); }
  catch (error) { console.log('업무 갱신 시각 저장 생략 | ' + error.message); }
  return summary;
}

function refreshBotTasks_({ bot, sourceId }) {
  const users = requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
  const tasks = requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders);
  const props = PropertiesService.getScriptProperties();
  const pmReviewId = props.getProperty('PM_REVIEW_SPREADSHEET_ID') || BOT_WORKBOOK.pmReviewCopyId;
  const testId = props.getProperty('TEST_MANAGEMENT_SPREADSHEET_ID') || BOT_WORKBOOK.testManagementCopyId;
  if ([sourceId, bot.getId()].includes(pmReviewId) || [sourceId, bot.getId()].includes(testId)) {
    throw new Error('추가 업무 원천 ID가 HA-CV 원천 또는 브리핑용 시트 ID와 같습니다.');
  }
  // 시트 하나를 못 열어도(권한·주소) 나머지 업무는 갱신한다. 못 연 시트의 업무는 직전 결과를 유지한다.
  const open = (id, label) => {
    try { return SpreadsheetApp.openById(id); }
    catch (error) { console.warn(label + ' 시트 열기 실패: ' + error.message); return null; }
  };
  const {collected, headsUp, detected, notPairPm, pmDashboards, upcoming, abuse, pmReviews, testReviews, failures} = collectAllWorkTasks_(
    open(sourceId, 'HA-CV'), open(pmReviewId, 'PM Review'), open(testId, '테스트지 관리'), new Date(), {tolerant:true});
  syncBotUsers_(users, Object.keys(collected.byPm)
    .concat(Object.keys(headsUp.byPm), pmDashboards.map(item => item.pm),
      abuse.concat(pmReviews, testReviews).map(row => row[1])));
  // 정리 실패가 업무 갱신을 막지 않게 따로 감싼다.
  try { pruneBotTasks_(tasks, new Date()); } catch (error) { console.log('BOT_TASKS 정리 생략 | ' + error.message); }
  syncBotTasks_(tasks, detected.concat(upcoming, abuse, pmReviews, testReviews), failures.flatMap(item => item.prefixes));
  failures.forEach(item => console.warn('업무 시트 읽기 실패 → 직전 결과 유지: ' + item.label + ' | ' + item.message));
  // 담당 탭을 못 읽으면 담당 PM 목록도 직전 값을 쓴다(모든 PM이 '이름 불일치'로 보이지 않게).
  let previousPmNames = [];
  try { previousPmNames = (JSON.parse(props.getProperty('BOT_TASKS_REFRESHED') || 'null') || {}).pmNames || []; } catch (_) {}
  let pmNames = pmDashboards.map(item => item.pm);
  if (failures.some(item => item.label === 'HA-CV 담당 탭')) pmNames = previousPmNames;
  // 직전 갱신에 있던 담당 탭이 사라지면(탭 이름 변경·삭제) 그 PM의 언어쌍 업무가 조용히 빠진다. 관리자 요약에 알린다.
  const missingPmTabs = previousPmNames.filter(pm => !pmNames.includes(pm));
  if (missingPmTabs.length) console.warn('직전에 있던 담당 탭이 보이지 않음(탭 이름 변경·삭제 확인): ' + missingPmTabs.join(', '));
  if (notPairPm.length) {
    console.log('담당 탭 없음(언어쌍 PM 아님)으로 언어쌍 업무 제외: ' + notPairPm.length + '건 (' +
      [...new Set(notPairPm.map(row => row[1]))].join(', ') + ')');
  }
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
  // 담당 탭은 찾았는데 프로젝트를 하나도 못 읽으면 양식 변경일 가능성이 크다. 0건이 정상과 구분되도록 관리자 요약에 알린다.
  const emptyPmTabs = pmDashboards.filter(item => !item.records.length).map(item => item.pm);
  if (emptyPmTabs.length) console.warn('담당 탭에서 프로젝트를 하나도 읽지 못함(양식 확인 필요): ' + emptyPmTabs.join(', '));
  // 일부 칸만 양식이 다른 경우(그 칸의 종료 임박·어뷰저가 조용히 빠짐)와 연말·연초 연도 추정 건수.
  const malformedPmTabs = pmDashboards.filter(item => item.malformed && item.records.length).map(item => item.pm + ' ' + item.malformed + '칸');
  if (malformedPmTabs.length) console.warn('담당 탭에서 형식이 다른 프로젝트 칸: ' + malformedPmTabs.join(', '));
  const yearGuessed = pmDashboards.reduce((total, item) => total + (item.yearGuessed || 0), 0);
  console.log('PM Review 미완료 1차 검수 (기한 경과·예정·미정) ' + pmReviews.length +
    '건, 테스트지 검토 미완료 ' + testReviews.length + '건');
  return { tasks: detected.length + upcoming.length + abuse.length + pmReviews.length + testReviews.length,
    unassigned: collected.unassigned.length + headsUp.unassigned.length,
    pmNames, emptyPmTabs, missingPmTabs, malformedPmTabs, yearGuessed, sourceFailures: failures.map(item => item.label + ': ' + item.message),
    keptPrefixes: [...new Set(failures.flatMap(item => item.prefixes))] };
}

function buildHaCvUpcomingTasks_(pm, records, day, sourceUrl, gid, now) {
  const endDay = addDaysToIsoDate_(day, BOT_WORKBOOK.upcomingDays);
  return records.map(item => ({item, target:normalizeSheetDate_(item.targetEnd)}))
    .filter(({item, target}) => item.status === '구축중' && target && target >= day && target <= endDay)
    .sort((a, b) => a.target.localeCompare(b.target) || a.item.pair.localeCompare(b.item.pair))
    .map(({item, target}) => {
    const column = columnLetters_(item.firstColumn);
    // 새 양식은 프로젝트 칸 하나(sheetRow), 예전 양식은 5~6행.
    const cells = item.sheetRow ? column + item.sheetRow : column + '5:' + column + '6';
    return [
      'HACV_DUE_SOON|' + pm + '|' + item.pair + '|' + (item.sheetRow ? item.projectId : item.stage + '|' + column),
      pm,
      /^\d+$/.test(String(item.projectId || '').trim()) ? String(item.projectId).trim() : '',
      item.pair,
      '구축 현황 확인',
      (item.sheetRow ? '프로젝트 ' + item.projectId : item.stage + ' ' + item.batches.join('/')) + ' 구축중, 목표 종료일 임박',
      '종료 일정과 남은 작업 확인',
      target,
      '', // 우선순위를 임의로 정하지 않는다.
      'HA-CV ' + pm + ' 탭',
      sourceUrl + '#gid=' + gid + '&range=' + cells,
      item.sheetRow ? cells : column + '5:6',
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

// 사라진 업무는 비활성으로만 남기므로 BOT_TASKS가 계속 커진다(갱신마다 전체를 읽고 씀). 30일 넘게 다시 보이지 않은
// 비활성 행 중 사람이 고친 칸(P:R)이 빈 행만 지운다. 매 회차 쓰기를 늘리지 않게 50행 이상 모였을 때 한 번에 정리한다.
const BOT_TASKS_RETENTION = Object.freeze({days:30, minBatch:50});
function pruneBotTasks_(sheet, now) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const width = BOT_WORKBOOK.taskHeaders.length;
  const rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const cutoff = now.getTime() - BOT_TASKS_RETENTION.days * 86400000;
  const blank = value => !String(value == null ? '' : value).trim();
  const prunable = row => row[12] === false && row[13] instanceof Date && row[13].getTime() < cutoff &&
    blank(row[15]) && blank(row[16]) && blank(row[17]);
  const keep = rows.filter(row => !prunable(row));
  const removed = rows.length - keep.length;
  if (removed < BOT_TASKS_RETENTION.minBatch) return 0;
  if (keep.length) sheet.getRange(2, 1, keep.length, width).setValues(keep);
  sheet.deleteRows(keep.length + 2, removed);
  console.log('BOT_TASKS 오래된 비활성 업무 ' + removed + '행 정리(' + BOT_TASKS_RETENTION.days + '일 넘게 안 보임) | 보존 ' + keep.length + '행');
  return removed;
}

// keepPrefixes: 이번에 읽지 못한 업무 종류(키 앞부분). 그 종류는 비활성화하지 않고 직전 결과를 그대로 둔다.
function syncBotTasks_(sheet, detected, keepPrefixes) {
  const keep = keepPrefixes || [];
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
        !currentKeys.has(key) && !keep.some(prefix => key.startsWith(prefix))) {
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

// 세 업무 시트에서 업무 행을 모은다. 읽기만 하며 봇 시트 반영은 호출자(refreshBotTasks_)가 한다.
// options.tolerant(정기 갱신): 원본 하나의 탭·머리글이 바뀌어도 회차 전체를 멈추지 않는다. 실패한 수집기는 빈 결과로 두고
// failures에 {label, prefixes, message}를 남긴다(호출자가 그 업무 종류를 직전 결과로 유지). 전부 실패하면 멈춘다.
// 미리보기·전환 검사는 tolerant 없이 불러 구조가 다르면 바로 오류로 알린다.
function collectAllWorkTasks_(source, pmReviewSource, testSource, now, options) {
  const tolerant = !!(options && options.tolerant);
  const failures = [];
  const attempt = (label, prefixes, fallback, run) => {
    if (!tolerant) return run();
    try { return run(); }
    catch (error) { failures.push({label, prefixes, message:String(error && error.message || error).slice(0, 200)}); return fallback; }
  };
  const need = (sheet, label) => {
    if (!sheet) throw new Error(label + ' 시트를 열지 못했습니다(보기 권한·주소 확인).');
    return sheet;
  };
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const empty = () => ({byPm:{}, unassigned:[]});
  const collected = attempt('HA-CV HUB', ['HACV_REVIEW|'], empty(), () => collectHaCvReviewCandidates_(need(source, 'HA-CV')));
  const headsUp = attempt('HA-CV 헤즈업 결과 집계', ['HACV_HEADSUP|'], empty(), () => collectHaCvHeadsUpCandidates_(need(source, 'HA-CV')));
  // 담당 탭을 못 읽으면 언어쌍 PM을 가릴 수 없으므로 HA-CV 업무 전체를 직전 결과로 둔다.
  const hacvPrefixes = ['HACV_REVIEW|', 'HACV_HEADSUP|', 'HACV_OVERDUE|', 'HACV_DUE_SOON|', 'HACV_ABUSE|'];
  const dashboardsRead = attempt('HA-CV 담당 탭', hacvPrefixes, null, () => collectHaCvPmDashboards_(need(source, 'HA-CV')));
  const pmDashboards = dashboardsRead || [];
  // HA-CV 시트에 담당 탭이 없는 사람은 언어쌍 PM이 아니다. 예비 작업자 검토·헤즈업 같은 언어쌍 업무는 빼고,
  // PM Review·테스트지 업무만 받는다. (종료 임박·어뷰저는 담당 탭에서만 나오므로 원래 해당 없음)
  const pairPms = new Set(pmDashboards.map(item => item.pm));
  const pairTasks = dashboardsRead ? buildHaCvBotTasks_(collected.byPm, now).concat(buildHaCvHeadsUpTasks_(headsUp.byPm, now)) : [];
  const detected = pairTasks.filter(row => pairPms.has(String(row[1] || '').trim()));
  const notPairPm = pairTasks.filter(row => !pairPms.has(String(row[1] || '').trim()));
  const upcoming = pmDashboards.flatMap(({ pm, records, gid }) =>
    buildHaCvUpcomingTasks_(pm, records, day, source.getUrl(), gid, now));
  const abuse = pmDashboards.flatMap(({ pm, records, gid }) =>
    buildHaCvAbuseTasks_(pm, records, day, source.getUrl(), gid, now));
  const pmReviews = attempt('PM Review', ['PM_REVIEW|'], [], () => collectPmReviewTasks_(need(pmReviewSource, 'PM Review'), day, now));
  const testReviews = attempt('테스트지 관리', ['TEST_REVIEW|'], [], () => collectTestReviewTasks_(need(testSource, '테스트지 관리'), now));
  if (failures.length === 5) throw new Error('업무 시트를 하나도 읽지 못했습니다: ' + failures.map(item => item.label + ' — ' + item.message).join(' / '));
  return {collected, headsUp, detected, notPairPm, pmDashboards, upcoming, abuse, pmReviews, testReviews, failures};
}

const ORIGINAL_SHEETS = Object.freeze([
  {label:'HA-CV 유저 관리', key:'SOURCE_SPREADSHEET_ID', original:'ORIGINAL_HACV_SPREADSHEET_ID', fallback:''},
  {label:'PM Review', key:'PM_REVIEW_SPREADSHEET_ID', original:'ORIGINAL_PM_REVIEW_SPREADSHEET_ID', fallback:'pmReviewCopyId'},
  {label:'테스트지 관리', key:'TEST_MANAGEMENT_SPREADSHEET_ID', original:'ORIGINAL_TEST_MANAGEMENT_SPREADSHEET_ID', fallback:'testManagementCopyId'},
]);

// 시트 주소를 넣어도 ID만 꺼낸다.
function sheetIdFromValue_(value) {
  const text = String(value || '').trim();
  // /spreadsheets/u/0/d/…, drive.google.com/file/d/…, ?id=… 형태도 받는다.
  const match = text.match(/\/d\/([A-Za-z0-9_-]{20,})/) || text.match(/[?&]id=([A-Za-z0-9_-]{20,})/) ||
    text.match(/^([A-Za-z0-9_-]{20,})$/);
  return match ? match[1] : '';
}

// 형식 오류 안내용. 값 자체는 보이지 않고 길이·주소 종류만 알려 준다.
function sheetValueHint_(raw) {
  const text = String(raw || '').trim();
  const host = (text.match(/^https?:\/\/([^\/]+)/) || [])[1];
  return '(값 ' + text.length + '자, ' + (host ? host + ' 주소' : '주소 아님') + ')';
}

// 지금 쓰는 시트와 원본 후보. 원본 칸이 비면 지금 시트를 그대로 쓴다.
// alreadySwitched: 전환 뒤에도 쓰는 조회 함수용. 바뀔 시트가 없어도 멈추지 않는다.
function originalSheetPlan_(props, alreadySwitched) {
  const plan = ORIGINAL_SHEETS.map(item => {
    const current = props.getProperty(item.key) || (item.fallback ? BOT_WORKBOOK[item.fallback] : '');
    const raw = props.getProperty(item.original);
    const original = sheetIdFromValue_(raw);
    if (raw && !original) throw new Error(item.label + ': ' + item.original + ' 값이 시트 주소·ID 형식이 아닙니다 ' + sheetValueHint_(raw) +
      '. 주소의 /d/ 와 /edit 사이 ID만 BOT_SETTINGS B열에 넣고 applyBotSettings를 다시 실행하세요.');
    return {label:item.label, key:item.key, current, next:original || current, changed:!!original && original !== current};
  });
  if (!alreadySwitched && !plan.some(item => item.changed)) throw new Error('ORIGINAL_..._SPREADSHEET_ID 속성에 원본 시트 주소를 먼저 넣으세요.');
  const ids = plan.map(item => item.next);
  if (new Set(ids).size !== ids.length || ids.includes(props.getProperty('BOT_SPREADSHEET_ID')) || ids.includes(BOT_WORKBOOK.bootstrapId)) {
    throw new Error('업무 시트 셋이 서로 같거나 봇 시트와 같습니다. 주소를 확인하세요.');
  }
  return plan;
}

// 업무 종류(업무 키 앞부분)·PM별 건수.
function workTaskCounts_(parts) {
  const rows = parts.detected.concat(parts.upcoming, parts.abuse, parts.pmReviews, parts.testReviews);
  const byType = {}, byPm = {};
  rows.forEach(row => {
    const type = String(row[0]).split('|')[0];
    byType[type] = (byType[type] || 0) + 1;
    byPm[row[1]] = (byPm[row[1]] || 0) + 1;
  });
  return {total:rows.length, byType, byPm, pms:parts.pmDashboards.map(item => item.pm),
    notPairPm:[...new Set(parts.notPairPm.map(row => row[1]))], notPairPmCount:parts.notPairPm.length};
}

function openWorkSheets_(plan, field, label) {
  return plan.map(item => {
    try { return SpreadsheetApp.openById(item[field]); }
    catch (error) { throw new Error(item.label + ' ' + label + ' 열기 실패(보기 권한 확인): ' + error.message); }
  });
}

function previewOriginalSheetConnection() {
  const props = PropertiesService.getScriptProperties();
  const plan = originalSheetPlan_(props);
  const now = new Date();
  const before = workTaskCounts_(collectAllWorkTasks_(...openWorkSheets_(plan, 'current', '현재 시트'), now));
  const sheets = openWorkSheets_(plan, 'next', '원본');
  let after;
  try { after = workTaskCounts_(collectAllWorkTasks_(...sheets, now)); }
  catch (error) { throw new Error('원본 구조가 봇이 읽는 형식과 다릅니다(탭 이름·열 확인): ' + error.message); }
  const lines = ['[원본 시트 연결 미리보기] 읽기만 · 원본·봇 시트·속성 변경 없음'];
  plan.forEach((item, i) => lines.push('• ' + item.label + ': ' + (item.changed ? '원본으로 바뀜 → ' + sheets[i].getName() : '그대로')));
  lines.push('', '업무 합계: 지금 ' + before.total + '건 → 원본 ' + after.total + '건');
  [...new Set(Object.keys(before.byType).concat(Object.keys(after.byType)))].sort().forEach(type =>
    lines.push('• ' + type + ': ' + (before.byType[type] || 0) + ' → ' + (after.byType[type] || 0)));
  lines.push('', 'PM별 (담당 탭 ' + before.pms.length + '명 → ' + after.pms.length + '명)');
  [...new Set(Object.keys(before.byPm).concat(Object.keys(after.byPm)))].sort().forEach(pm =>
    lines.push('• ' + pm + ': ' + (before.byPm[pm] || 0) + ' → ' + (after.byPm[pm] || 0)));
  lines.push('원본 담당 탭: ' + (after.pms.join(', ') || '없음'));
  if (after.notPairPmCount) lines.push('담당 탭 없음(언어쌍 PM 아님) → 언어쌍 업무 ' + after.notPairPmCount + '건 제외: ' +
    after.notPairPm.join(', ') + ' (PM Review·테스트지 업무는 그대로)');
  const added = after.pms.filter(pm => !before.pms.includes(pm));
  if (added.length) lines.push('새로 보이는 담당 탭: ' + added.join(', ') + ' (전환 후 BOT_USERS에 발송 FALSE로 추가됨, 켜기 전엔 DM 없음)');
  lines.push('', '👉 숫자가 원본 시트에서 보이는 업무와 맞으면 switchToOriginalSheets 를 실행하세요.',
    '   내 업무를 한 건씩 보려면 previewOriginalMyTasks 를 실행하세요.');
  console.log(lines.join('\n'));
}

// 원본 기준 내(시범 PM) 업무를 한 건씩 보여 준다. 읽기만 한다.
function previewOriginalMyTasks() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const pm = getPilotPmName_(readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders),
    BOT_WORKBOOK.userHeaders.length));
  const parts = collectAllWorkTasks_(...openWorkSheets_(originalSheetPlan_(props, true), 'next', '원본'), new Date());
  const rows = parts.detected.concat(parts.upcoming, parts.abuse, parts.pmReviews, parts.testReviews)
    .filter(row => String(row[1] || '').trim() === pm);
  const lines = ['[원본 기준 내 업무] ' + pm + ' · ' + rows.length + '건 · 읽기만, 변경·발송 없음'];
  // 종류 · 언어쌍 · 상태 · 기한 · 원본 탭과 행
  rows.forEach(row => lines.push('• ' + [row[4], row[3], row[5], row[7] || '기한 없음', row[9] + ' ' + row[11] + (/^\d/.test(String(row[11])) ? '행' : '')]
    .map(value => String(value || '').trim()).filter(Boolean).join(' · ')));
  if (!rows.length) lines.push('• 없음');
  console.log(lines.join('\n'));
}

// 원본 세 시트의 탭·머리글과 수집기별 통과 여부를 보여 준다. 읽기만 하며, 머리글 줄만 출력하고 데이터 행은 내보내지 않는다.
// 구조가 바뀌었을 때 어느 탭·열이 달라졌는지 한 번에 보려는 용도. 원본·봇 시트·속성 변경 및 DM 없음.
function inspectOriginalSheetStructure() {
  const props = PropertiesService.getScriptProperties();
  const plan = originalSheetPlan_(props, true);
  const [hacv, pmReview, test] = openWorkSheets_(plan, 'next', '원본');
  const now = new Date();
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const lines = ['[원본 구조 점검] 읽기만 · 머리글만 표시 · 원본·봇 시트·속성 변경 없음, DM 없음'];
  const check = (label, run) => {
    try { lines.push('  ✅ ' + label + ': ' + run()); }
    catch (error) { lines.push('  ❌ ' + label + ': ' + error.message); }
  };
  const tabList = (spreadsheet, index) => {
    const names = spreadsheet.getSheets().map(sheet => sheet.getName());
    lines.push('', '■ ' + plan[index].label + (plan[index].next === plan[index].current ? ' (원본 칸 비어 있음 · 지금 시트)' : '') +
      ' · ' + spreadsheet.getName() + ' · 탭 ' + names.length + '개', '  탭: ' + names.join(' / '));
  };
  const headerRows = (spreadsheet, tab, firstRow, rowCount, width) => {
    const sheet = spreadsheet.getSheetByName(tab);
    if (!sheet) { lines.push('  · ' + tab + ': 탭 없음'); return; }
    const cols = Math.min(width, sheet.getLastColumn());
    if (cols < 1) { lines.push('  · ' + tab + ': 비어 있음'); return; }
    sheet.getRange(firstRow, 1, rowCount, cols).getDisplayValues().forEach((row, i) => {
      const cells = row.map((value, c) => String(value || '').replace(/\s+/g, ' ').trim() ? columnLetters_(c + 1) + '=' + String(value).replace(/\s+/g, ' ').trim() : '')
        .filter(Boolean);
      lines.push('  · ' + tab + ' ' + (firstRow + i) + '행: ' + (cells.join(' | ') || '(빈 줄)'));
    });
  };

  tabList(hacv, 0);
  headerRows(hacv, BRIEFING.hubTab, 1, 2, 12);
  headerRows(hacv, BRIEFING.resultTab, 1, 1, 12);
  const personTabs = hacv.getSheets().filter(sheet => /^[가-힣]{2,4}[A-Z]?$/.test(sheet.getName()));
  lines.push('  · 사람 이름 탭 ' + personTabs.length + '개 (예전 양식 H4:H6 기대: 해당 배치 / 구축 상태 / 목표 종료일)');
  personTabs.forEach(sheet => {
    const marks = sheet.getLastColumn() >= 8 ? sheet.getRange(4, 8, 3, 1).getDisplayValues().map(row => String(row[0] || '').trim()) : [];
    lines.push('    - ' + sheet.getName() + ': ' + (marks.join(' / ') || '(열 부족)'));
  });
  // 새 양식 확인용: 첫 사람 탭의 상단(언어쌍 목록·첫 프로젝트 머리글까지)만 열 위치와 함께 보인다. 유저 행은 14행부터라 출력하지 않는다.
  if (personTabs.length) headerRows(hacv, personTabs[0].getName(), 1, 13, 40);
  check('HUB 검토 필요', () => {
    const result = collectHaCvReviewCandidates_(hacv);
    return Object.keys(result.byPm).length + '명 · 미배정 ' + result.unassigned.length + '건';
  });
  check('헤즈업 대상', () => {
    const result = collectHaCvHeadsUpCandidates_(hacv);
    return Object.keys(result.byPm).length + '명 · 미배정 ' + result.unassigned.length + '건';
  });
  check('담당 탭(종료 임박·어뷰저)', () => collectHaCvPmDashboards_(hacv).map(item => item.pm + ' ' + item.records.length + '건(구축중 ' +
    item.records.filter(record => record.status === '구축중').length + ')').join(', ') || '0개');

  tabList(pmReview, 1);
  headerRows(pmReview, 'PM Review', 1, 4, 30);
  check('PM Review 1차 검수', () => collectPmReviewTasks_(pmReview, day, now).length + '건');

  tabList(test, 2);
  headerRows(test, 'HT 테스트지 제작 관리(ing)', 1, 1, 12);
  check('테스트지 검토', () => collectTestReviewTasks_(test, now).length + '건');

  console.log(lines.join('\n'));
}

function switchToOriginalSheets() {
  const props = PropertiesService.getScriptProperties();
  const plan = originalSheetPlan_(props);
  // 미리보기와 같은 읽기 검사를 통과해야만 바꾼다.
  try { collectAllWorkTasks_(...openWorkSheets_(plan, 'next', '원본'), new Date()); }
  catch (error) { throw new Error('전환 중지 · 원본을 읽지 못했습니다: ' + error.message); }
  if (!props.getProperty('COPY_SHEETS_BACKUP')) {
    props.setProperty('COPY_SHEETS_BACKUP', JSON.stringify(Object.fromEntries(plan.map(item => [item.key, props.getProperty(item.key) || '']))));
  }
  plan.filter(item => item.changed).forEach(item => props.setProperty(item.key, item.next));
  props.deleteProperty('BOT_TASKS_REFRESHED'); // 다음 회차가 원본을 새로 읽게 한다.
  console.log('원본 시트로 전환: ' + plan.filter(item => item.changed).map(item => item.label).join(', ') +
    ' | 이전 값은 COPY_SHEETS_BACKUP에 보관 · 되돌리기 revertToCopySheets | 원본에는 쓰지 않음, DM 없음');
}

function revertToCopySheets() {
  const props = PropertiesService.getScriptProperties();
  const backup = JSON.parse(props.getProperty('COPY_SHEETS_BACKUP') || 'null');
  if (!backup) throw new Error('되돌릴 기록(COPY_SHEETS_BACKUP)이 없습니다.');
  Object.keys(backup).forEach(key => backup[key] ? props.setProperty(key, backup[key]) : props.deleteProperty(key));
  props.deleteProperty('COPY_SHEETS_BACKUP');
  props.deleteProperty('BOT_TASKS_REFRESHED');
  console.log('사본 시트로 되돌림 | DM 없음');
}
