/**
 * 32. 업무일지 — Work Log(업무일지 Slack 앱) 업무를 10:30·17:00 DM에 한 칸으로 붙인다
 *
 * 하는 일
 * - Work Log 시트의 TASKS 탭을 읽기만 해서, BOT_WORKLOG 탭에서 켠 PM에게만 "📝 내 업무일지" 칸을 붙인다.
 * - 보여 주는 것: 오늘 업무·이번 주 업무 중 미완료, 지난 미완료(최근 14일) 개수. 17:00에는 오늘 완료 개수도.
 *
 * 알아둘 것
 * - 사람 연결은 Slack ID로 한다(Work Log도 Slack ID로 저장). 시트 업무와 합치지 않는다(1차: 따로 칸).
 * - ENABLE_WORKLOG_BRIEFING=true이고 WORKLOG_SPREADSHEET_ID가 있을 때만 동작한다(BOT_SETTINGS로 반영).
 * - 14:00 오후 업데이트에는 넣지 않는다. Work Log 시트를 못 읽어도 다른 DM 내용은 그대로 보낸다.
 * - Work Log 시트는 쓰지 않는다. BOT_WORKLOG 탭(봇 시트)만 setupWorkLogBriefing이 만든다.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⚠️ setupWorkLogBriefing(): 봇 시트에 BOT_WORKLOG 탭을 만들고 BOT_USERS의 PM을 꺼짐(FALSE)으로 채운다(켠 값은 유지)
 * - 🔍 previewWorkLogBriefing(): BOT_WORKLOG에서 켠 PM의 업무일지 칸을 로그로만 본다(Slack 발송 없음)
 *
 * 내부 함수 (직접 실행하지 않음)
 * - workLogSpreadsheetId_(value): 주소 또는 ID에서 시트 ID만 꺼낸다
 * - workLogEnabledIds_(bot): BOT_WORKLOG에서 켠 PM의 Slack ID 목록
 * - loadWorkLogBriefing_(props, bot, routes): 이번 발송 대상 중 켠 PM의 Work Log 업무를 한 번에 읽는다
 * - readWorkLogTasks_(spreadsheetId, ids): TASKS 탭에서 그 PM들의 지워지지 않은 업무만 꺼낸다
 * - formatWorkLogForRoute_(workLog, slackId, day, slot): 한 PM의 업무일지 칸 문안(없으면 빈 문자열)
 * - workLogMonday_(day): 그 주 월요일(yyyy-MM-dd)
 */
const WORKLOG_BRIEFING = Object.freeze({tab:'BOT_WORKLOG', headers:['pm_name', 'slack_user_id', 'worklog_enabled', 'note'],
  tasksTab:'TASKS', carryDays:14, maxItems:8});

function workLogSpreadsheetId_(value) {
  const text = String(value || '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : '';
}

// 봇 시트에만 쓴다. 이미 있는 줄의 켜짐 값과 메모는 그대로 두고, 새 PM만 꺼짐으로 덧붙인다.
function setupWorkLogBriefing() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const sheet = ensureBotSheet_(bot, WORKLOG_BRIEFING.tab, WORKLOG_BRIEFING.headers);
  const users = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const have = new Set(readBotRows_(sheet, WORKLOG_BRIEFING.headers.length).map(row => String(row[1] || '').trim()));
  const add = users.map(row => [String(row[0] || '').trim(), String(row[1] || '').trim()])
    .filter(([pm, id]) => pm && /^[UW][A-Z0-9]{8,}$/.test(id) && !have.has(id))
    .map(([pm, id]) => [pm, id, false, '']);
  if (add.length) sheet.getRange(sheet.getLastRow() + 1, 1, add.length, WORKLOG_BRIEFING.headers.length).setValues(add);
  const height = Math.max(0, sheet.getLastRow() - 1);
  if (height) sheet.getRange(2, 3, height, 1).insertCheckboxes();
  console.log('BOT_WORKLOG 준비 완료 | 새로 추가 ' + add.length + '명 · 전체 ' + height + '명 · 켠 PM ' + workLogEnabledIds_(bot).length + '명');
  console.log('다음: 켤 PM의 worklog_enabled를 체크 → BOT_SETTINGS에 ENABLE_WORKLOG_BRIEFING=true, WORKLOG_SPREADSHEET_ID 입력 → applyBotSettings');
}

function previewWorkLogBriefing() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const users = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const routes = users.map(row => ({pm:String(row[0] || '').trim(), id:String(row[1] || '').trim()})).filter(route => route.pm && route.id);
  const workLog = loadWorkLogBriefing_(props, bot, routes, true);
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  if (!workLog.ids.length) { console.log('업무일지를 켠 PM이 없습니다(BOT_WORKLOG의 worklog_enabled 확인).'); return; }
  for (const route of routes.filter(r => workLog.ids.includes(r.id))) {
    ['11:00', '17:00'].forEach(slot => console.log(route.pm + ' | ' + slot + '\n' + (formatWorkLogForRoute_(workLog, route.id, day, slot).trim() || '(업무일지 칸 없음: 보여 줄 업무 없음)')));
  }
}

function workLogEnabledIds_(bot) {
  const sheet = bot.getSheetByName(WORKLOG_BRIEFING.tab);
  if (!sheet) return [];
  assertBotHeaders_(sheet, WORKLOG_BRIEFING.headers);
  return readBotRows_(sheet, WORKLOG_BRIEFING.headers.length)
    .filter(row => row[2] === true && /^[UW][A-Z0-9]{8,}$/.test(String(row[1] || '').trim()))
    .map(row => String(row[1]).trim());
}

// 발송 1회에 Work Log 시트를 한 번만 읽는다. ignoreSwitch: 미리보기는 ENABLE 값과 무관하게 본다.
function loadWorkLogBriefing_(props, bot, routes, ignoreSwitch) {
  const off = {ids:[], byUser:{}, error:''};
  if (!ignoreSwitch && props.getProperty('ENABLE_WORKLOG_BRIEFING') !== 'true') return off;
  const enabled = workLogEnabledIds_(bot);
  const ids = routes.map(route => route.id).filter(id => enabled.includes(id));
  if (!ids.length) return off;
  const spreadsheetId = workLogSpreadsheetId_(props.getProperty('WORKLOG_SPREADSHEET_ID'));
  if (!spreadsheetId) return {ids, byUser:{}, error:'Work Log 시트 주소(WORKLOG_SPREADSHEET_ID)가 비어 있어요.'};
  try { return {ids, byUser:readWorkLogTasks_(spreadsheetId, ids), error:''}; }
  catch (error) {
    console.log('업무일지 읽기 실패 | ' + error.message);
    return {ids, byUser:{}, error:'Work Log 시트를 읽지 못했어요.'};
  }
}

function readWorkLogTasks_(spreadsheetId, ids) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(WORKLOG_BRIEFING.tasksTab);
  if (!sheet) throw new Error('Work Log 시트에 ' + WORKLOG_BRIEFING.tasksTab + ' 탭이 없습니다.');
  const values = sheet.getDataRange().getValues();
  const head = (values[0] || []).map(String);
  const col = name => head.indexOf(name);
  const need = ['user_id', 'kind', 'date_key', 'title', 'priority', 'children_json', 'done', 'source', 'deleted'];
  const missing = need.filter(name => col(name) < 0);
  if (missing.length) throw new Error('Work Log TASKS 머리글 없음: ' + missing.join(', '));
  const text = v => v instanceof Date ? Utilities.formatDate(v, BRIEFING.timezone, 'yyyy-MM-dd') : String(v == null ? '' : v).replace(/^'/, '').trim();
  const flag = v => v === true || String(v).toUpperCase() === 'TRUE';
  const byUser = {};
  ids.forEach(id => { byUser[id] = []; });
  values.slice(1).forEach(row => {
    const id = text(row[col('user_id')]);
    if (!byUser[id] || flag(row[col('deleted')])) return;
    let children = [];
    try { children = JSON.parse(text(row[col('children_json')]) || '[]'); } catch (_) { children = []; }
    byUser[id].push({kind:text(row[col('kind')]), key:text(row[col('date_key')]), title:text(row[col('title')]),
      priority:text(row[col('priority')]), source:text(row[col('source')]), done:flag(row[col('done')]),
      children:Array.isArray(children) ? children : []});
  });
  return byUser;
}

function workLogMonday_(day) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

// 10:30(11:00)·17:00 DM에 붙일 칸. 켠 PM이 아니거나 보여 줄 것이 없으면 빈 문자열.
function formatWorkLogForRoute_(workLog, slackId, day, slot) {
  if (!workLog || !workLog.ids.includes(slackId)) return '';
  const title = '📝 *내 업무일지 (Work Log)*';
  if (workLog.error) return '\n\n' + title + '\n⚠️ ' + workLog.error + ' 다른 업무는 그대로 보냈어요.';
  const tasks = workLog.byUser[slackId] || [];
  const order = ['P0', 'P1', 'P2', 'P3'];
  const byPriority = (a, b) => (order.indexOf(a.priority) + 1 || 9) - (order.indexOf(b.priority) + 1 || 9);
  const week = workLogMonday_(day);
  const from = new Date(Date.parse(day + 'T12:00:00Z') - WORKLOG_BRIEFING.carryDays * 86400000).toISOString().slice(0, 10);
  const today = tasks.filter(t => t.kind === 'day' && t.key === day && !t.done).sort(byPriority);
  const thisWeek = tasks.filter(t => t.kind === 'week' && t.key === week && !t.done).sort(byPriority);
  const carried = tasks.filter(t => t.kind === 'day' && t.key < day && t.key >= from && !t.done).length;
  const doneToday = slot === '17:00' ? tasks.filter(t => t.kind === 'day' && t.key === day && t.done).length : 0;
  if (!today.length && !thisWeek.length && !carried && !doneToday) return '';
  const line = (t, suffix) => {
    const kids = t.children.length ? ' (' + t.children.filter(c => c && c.done).length + '/' + t.children.length + ')' : '';
    return '• ' + escapeSlack_(t.title) + '  `' + escapeSlack_(t.priority || '-') + '`' + kids + (t.source === 'repeat' ? ' 🔁' : '') + suffix;
  };
  const items = today.map(t => line(t, '')).concat(thisWeek.map(t => line(t, ' · 이번 주')));
  const lines = [title];
  if (items.length) {
    lines.push(...items.slice(0, WORKLOG_BRIEFING.maxItems));
    if (items.length > WORKLOG_BRIEFING.maxItems) lines.push('… 외 ' + (items.length - WORKLOG_BRIEFING.maxItems) + '개');
  } else lines.push('오늘 남은 업무일지 업무가 없어요.');
  if (carried) lines.push('↪ 지난 미완료 ' + carried + '개 · Work Log 앱 홈에서 확인');
  if (doneToday) lines.push('✅ 오늘 완료 ' + doneToday + '개');
  return '\n\n' + lines.join('\n');
}
