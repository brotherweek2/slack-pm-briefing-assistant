/**
 * 29. 오후업데이트 — 14:00 오후 업데이트(새 업무·새 Slack·남은 회의)
 *
 * 알아둘 것
 * - 새 업무 = 오늘 오전 정기 DM에 없던 업무. 오전 DM이 실패했으면 직전 정기 DM(7일 안)과 비교한다.
 * - 새 소식이 없으면 한 줄 인사 + 남은 회의. 점심·한마디·날씨는 싣지 않는다.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - 🔍 previewMyAfternoonBriefing(): 지금 자료로 14:00 문안을 로그로 본다
 *
 * 내부 함수 (직접 실행하지 않음)
 * - briefingSlotLabel_(slot): 내부 회차 이름('11:00'·'14:00'·'17:00') → 실제 시각·표시 이름
 * - currentBriefingSlot_(now): 지금 시각에 해당하는 회차(미리보기·수동 점검용)
 * - morningTaskKeys_(prior, day, pm): 비교 기준 업무 키 — 오늘 오전 정기 DM, 없으면 직전 정기 DM(7일 안), 둘 다 없으면 null
 * - formatAfternoonUpdate_(pm, day, newRows, freshSlack, slackFailure, basis, calendarSection): 14:00 오후 업데이트 문안(새 업무·남은 회의·새 Slack)
 */
const SLOT_TIME = Object.freeze({'11:00':'10:30', '14:00':'14:00', '17:00':'17:00'}); // 내부 회차 이름 → 실제 실행 시각

function briefingSlotLabel_(slot) {
  return slot === '11:00' ? '10:30 오전' : slot === '14:00' ? '14:00 오후' : slot === '17:00' ? '17:00 마무리' : String(slot);
}

function currentBriefingSlot_(now) {
  const hhmm = Utilities.formatDate(now, BRIEFING.timezone, 'HH:mm');
  return hhmm < '12:00' ? '11:00' : hhmm < '16:00' ? '14:00' : '17:00';
}

// 비교 기준: 오늘 10:30 정기 DM. 오전 DM이 실패해 없으면 그 전의 마지막 정기 DM(보통 전날 17:00, 7일 안)을 쓴다.
// 둘 다 없으면 null(업무 비교 안 함).
function morningTaskKeys_(prior, day, pm) {
  const sent = r => Object.prototype.toString.call(r[0]) === '[object Date]' && r[2] === pm &&
    /^scheduled-/.test(String(r[1])) && /^sent/.test(String(r[4]));
  const dayOf = r => Utilities.formatDate(r[0], BRIEFING.timezone, 'yyyy-MM-dd');
  const oldest = new Date(Date.parse(day + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
  const row = prior.find(r => sent(r) && dayOf(r) === day && r[1] === 'scheduled-11:00') ||
    prior.filter(r => sent(r) && dayOf(r) < day && dayOf(r) >= oldest).sort((a, b) => b[0] - a[0])[0];
  return row ? String(row[3] || '').split(',').map(key => key.trim()).filter(Boolean) : null;
}

function formatAfternoonUpdate_(pm, day, newRows, freshSlack, slackFailure, basis, calendarSection) {
  const greeting = '🕑 *' + escapeSlack_(pm) + '* 님, ' + formatBriefingDay_(day);
  const meetings = calendarSection || '';
  if (!newRows.length && !freshSlack.length && !slackFailure) {
    return {text:greeting + ' 오전 이후 새로운 알림이 없습니다. 점심 맛있게 드셨나요? 🍚' + meetings + (meetings ? basis || '' : ''), quiet:true};
  }
  let text = greeting + ' 오후 업데이트입니다.';
  if (newRows.length) {
    const body = formatHaCvBriefing_(pm, newRows, day, null, 'send').split('\n');
    const at = body.indexOf('*오늘 확인할 업무*');
    text += '\n\n📌 *오전 이후 새로 생긴 업무*\n' + (at < 0 ? [] : body.slice(at + 1)).join('\n');
  }
  text += meetings;
  if (slackFailure) text += '\n\n💬 *Slack*\n⚠️ Slack 확인사항을 읽어오지 못했습니다 — ' + slackFailure;
  else if (freshSlack.length) text += formatPersonalSlackDigest_(freshSlack, day, '14:00').replace('💬 *Slack*', '💬 *새 Slack*');
  else text += '\n\n💬 *새 Slack*\n• 오전 이후 새 요청·안내 없음';
  return {text:text + (basis || ''), quiet:false};
}

function previewMyAfternoonBriefing() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const users = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const pilot = findPilotRecipient_(users);
  if (!pilot || !/^[UW][A-Z0-9]{8,}$/.test(pilot.id)) throw new Error('본인 Slack 연결을 확인하세요.');
  const route = {pm:getPilotPmName_(users), id:pilot.id};
  const rows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders), BOT_WORKBOOK.taskHeaders.length);
  const log = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.logTab, BOT_WORKBOOK.logHeaders), BOT_WORKBOOK.logHeaders.length);
  const now = new Date(), day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const own = rows.filter(row => row[12] === true && String(row[1] || '').trim() === route.pm && isHaCvBriefingTask_(row[0]));
  const keys = morningTaskKeys_(log, day, route.pm);
  const newRows = keys ? own.filter(row => !keys.includes(String(row[0]))) : [];
  let fresh = [], failure = '', asOf = '';
  try {
    const snapshot = loadFreshBbpmSnapshot_(props, bot, now, 1440); // 미리보기는 하루 안의 최근 완료본
    let items = buildSlackDigestItems_(classifySlackSnapshot_(snapshot, [route]));
    items = attachSlackAuthorNames_(items, '', true);
    fresh = selectPersonalSlackItems_(route.pm, items, readSlackDigestSeen_(props, route.id), day, '14:00').filter(item => !item.previouslySent);
    asOf = Utilities.formatDate(new Date(snapshot.meta.newest * 1000), BRIEFING.timezone, 'yyyy-MM-dd HH:mm');
  } catch (error) { failure = describeSlackFailure_(error, props); }
  const withCalendar = props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true';
  let meetings = '';
  if (withCalendar) {
    try { meetings = buildLiveCalendarSection_(route, props, '14:00', now, null); }
    catch (error) { meetings = '\n\n📅 *오늘 회의*\n⚠️ 본인 회의 일정을 불러오지 못했습니다.'; }
  }
  const update = formatAfternoonUpdate_(route.pm, day, newRows, fresh, failure, formatBriefingBasis_(now, asOf, day, withCalendar, true), meetings);
  console.log((keys ? '' : '(최근 7일 정기 DM 기록이 없어 업무는 비교하지 않음)\n') + update.text);
  console.log('미리보기만 | 발송·시트/이력 변경 없음');
}
