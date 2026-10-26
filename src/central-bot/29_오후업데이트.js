/**
 * 29. 회차 이름과 14:00 오후 업데이트 — 점심 직후, 오전(10:30) 이후 새로 생긴 것만 짧게 알린다.
 * - SLOT_TIME / briefingSlotLabel_(slot): 내부 회차 이름('11:00'·'14:00'·'17:00') → 실제 시각·표시 이름. 모든 화면 문구는 이것을 쓴다.
 * - currentBriefingSlot_(now): 지금 시각에 해당하는 회차(미리보기·수동 점검용). 12시 전 오전, 16시 전 오후, 그 뒤 마무리.
 * - 새 업무: 오늘 오전 정기 DM에 실려 간 업무(BOT_SEND_LOG의 업무 키)에 없던 업무. 오전 발송 기록이 없으면 업무는 비교하지 않는다.
 * - 새 Slack: 아직 보낸 적 없는 새·변경 항목만(이미 안내한 오늘 요청은 다시 싣지 않음).
 * - 둘 다 없으면 "오전 이후 새로운 알림이 없습니다. 점심 맛있게 드셨나요?" 한 줄. Slack을 읽지 못했으면 그 사실을 알린다.
 * - 점심 추천·한마디·회의·날씨는 싣지 않는다.
 * - morningTaskKeys_(prior, day, pm): 오늘 오전 정기 DM 기록의 업무 키 목록(없으면 null).
 * - formatAfternoonUpdate_(pm, day, newRows, freshSlack, slackFailure, basis): 14:00 문안. {text, quiet}.
 * - previewMyAfternoonBriefing(): [직접 실행] 지금 자료로 14:00 문안을 로그로 본다. 발송·저장 없음.
 */
const SLOT_TIME = Object.freeze({'11:00':'10:30', '14:00':'14:00', '17:00':'17:00'}); // 내부 회차 이름 → 실제 실행 시각

function briefingSlotLabel_(slot) {
  return slot === '11:00' ? '10:30 오전' : slot === '14:00' ? '14:00 오후' : slot === '17:00' ? '17:00 마무리' : String(slot);
}

function currentBriefingSlot_(now) {
  const hhmm = Utilities.formatDate(now, BRIEFING.timezone, 'HH:mm');
  return hhmm < '12:00' ? '11:00' : hhmm < '16:00' ? '14:00' : '17:00';
}

function morningTaskKeys_(prior, day, pm) {
  const row = prior.find(r => Object.prototype.toString.call(r[0]) === '[object Date]' && Utilities.formatDate(r[0], BRIEFING.timezone, 'yyyy-MM-dd') === day &&
    r[1] === 'scheduled-11:00' && r[2] === pm && /^sent/.test(String(r[4])));
  return row ? String(row[3] || '').split(',').map(key => key.trim()).filter(Boolean) : null;
}

function formatAfternoonUpdate_(pm, day, newRows, freshSlack, slackFailure, basis) {
  const greeting = '🕑 *' + escapeSlack_(pm) + '* 님, ' + formatBriefingDay_(day);
  if (!newRows.length && !freshSlack.length && !slackFailure) {
    return {text:greeting + ' 오전 이후 새로운 알림이 없습니다. 점심 맛있게 드셨나요? 🍚', quiet:true};
  }
  let text = greeting + ' 오후 업데이트입니다.';
  if (newRows.length) {
    const body = formatHaCvBriefing_(pm, newRows, day, null, 'send').split('\n');
    const at = body.indexOf('*오늘 확인할 업무*');
    text += '\n\n📌 *오전 이후 새로 생긴 업무*\n' + (at < 0 ? [] : body.slice(at + 1)).join('\n');
  }
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
    const snapshot = loadFreshBbpmSnapshot_(props, bot, now);
    let items = buildSlackDigestItems_(classifySlackSnapshot_(snapshot, [route]));
    items = attachSlackAuthorNames_(items, '', true);
    fresh = selectPersonalSlackItems_(route.pm, items, readSlackDigestSeen_(props, route.id), day, '14:00').filter(item => !item.previouslySent);
    asOf = Utilities.formatDate(new Date(snapshot.meta.newest * 1000), BRIEFING.timezone, 'yyyy-MM-dd HH:mm');
  } catch (error) { failure = describeSlackFailure_(error, props); }
  const update = formatAfternoonUpdate_(route.pm, day, newRows, fresh, failure, formatBriefingBasis_(now, asOf, day, false, true));
  console.log((keys ? '' : '(오늘 오전 정기 DM 기록이 없어 업무는 비교하지 않음)\n') + update.text);
  console.log('미리보기만 | 발송·시트/이력 변경 없음');
}
