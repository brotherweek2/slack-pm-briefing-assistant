/**
 * 25. 점심메이트 — 점심 메이트 버튼, 같은 식당 매칭
 *
 * 알아둘 것
 * - 켜고 끄기는 PM이 DM 버튼으로 직접 한다(기본 꺼짐). 켠 사람끼리만 3명당 1곳 같은 식당.
 * - 버튼은 ENABLE_LUNCH_MATE=true일 때만 보인다.
 *
 * 내부 함수 (직접 실행하지 않음)
 * - lunchMateOn_(props, slackId): 이 PM이 점심 메이트를 켰는지
 * - lunchMateParticipants_(props, userRows): 발송 TRUE이면서 버튼으로 켠 PM(오늘 연차인 PM 제외)
 * - lunchMateTodayParticipants_(props, userRows, day): 정기 발송용. 첫 묶음 명단을 그날 고정(묶음마다 메이트가 달라지지 않게)
 * - lunchMateHash_(text): 날짜·ID로 섞기용 숫자를 만든다
 * - lunchMatePlan_(participants, catalog, day): 참여자 Slack ID → 오늘의 메이트 식당
 * - applyLunchMate_(selection, plan, route, day): 켠 사람의 식사 추천을 메이트 식당으로 바꾼다(가볍게 추천은 그대로)
 * - formatLunchMateLine_(route, plan, participants): "🤝 오늘 ○○ 메이트: 이름 님" 한 줄
 * - lunchMateButtonBlock_(on): DM에 붙일 켜기/끄기 버튼 블록
 * - insertLunchMateButton_(blocks, block): 점심 영역(🍚로 시작하는 section) 바로 아래에 버튼을 넣는다
 * - lunchMateToggledBlocks_(blocks, on): 누른 DM의 메이트 버튼만 켜기↔끄기로 바꾼 블록
 * - handleSlackInteraction_(e): [웹 앱] Slack 버튼 응답 처리
 */
const LUNCH_MATE = Object.freeze({prefix:'LUNCH_MATE_', actionId:'lunch_mate_toggle', groupSize:3, todayKey:'LUNCH_MATE_TODAY'});

function lunchMateOn_(props, slackId) {
  return props.getProperty(LUNCH_MATE.prefix + slackId) === 'on';
}

function lunchMateParticipants_(props, userRows) {
  if (props.getProperty('ENABLE_LUNCH_MATE') !== 'true') return [];
  const people = userRows.filter(row => row[2] === true && /^[UW][A-Z0-9]{8,}$/.test(String(row[1] || '').trim()))
    .map(row => ({pm:String(row[0] || '').trim(), id:String(row[1]).trim()}))
    .filter(person => person.pm && lunchMateOn_(props, person.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const away = briefingLeaveRoutes_(people, props, new Date()).map(item => item.route.id);
  return people.filter(person => !away.includes(person.id));
}

// 정기 발송은 4명씩 나눠 보내므로, 첫 묶음의 참여자 명단을 그날 고정해 모든 묶음이 같은 메이트를 본다.
// 발송 도중 켜고 끈 것은 다음 날부터 반영된다(버튼 안내 문구와 같음).
function lunchMateTodayParticipants_(props, userRows, day) {
  if (props.getProperty('ENABLE_LUNCH_MATE') !== 'true') return [];
  try {
    const saved = JSON.parse(props.getProperty(LUNCH_MATE.todayKey) || 'null');
    if (saved && saved.day === day && Array.isArray(saved.people)) return saved.people;
  } catch (error) { console.log('점심 메이트 오늘 명단 다시 계산'); }
  const people = lunchMateParticipants_(props, userRows);
  try { props.setProperty(LUNCH_MATE.todayKey, JSON.stringify({day, people})); }
  catch (error) { console.log('점심 메이트 오늘 명단 저장 실패 | 이번 묶음은 현재 명단으로 계속'); }
  return people;
}

function lunchMateHash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return Array.from(bytes).slice(0, 4).reduce((value, b) => value * 256 + (b + 256) % 256, 0);
}

function lunchMatePlan_(participants, catalog, day) {
  const plan = new Map();
  const active = catalog.filter(item => item.enabled && item.category === '식당' &&
    ['confirmed','approximate'].includes(item.status) && item.menus.length && item.checkedAt <= day &&
    !BRIEFING_LUNCH_REMOVED_NAMES.includes(item.name));
  if (!active.length || !participants.length) return plan;
  const count = Math.max(1, Math.min(active.length, Math.ceil(participants.length / LUNCH_MATE.groupSize)));
  const places = active.map(item => ({item, h:lunchMateHash_('mate|' + day + '|' + item.id)}))
    .sort((a, b) => a.h - b.h).slice(0, count).map(x => x.item);
  participants.map(person => ({person, h:lunchMateHash_('mate|' + day + '|' + person.id)}))
    .sort((a, b) => a.h - b.h).forEach(({person}, index) => plan.set(person.id, places[index % count]));
  return plan;
}

function applyLunchMate_(selection, plan, route, day) {
  const place = plan.get(route.id);
  if (!place) return selection;
  const menu = place.menus[lunchMateHash_('mate-menu|' + day + '|' + route.id) % place.menus.length];
  return Object.assign({}, place, {menu, day, kind:'meal', light:selection ? selection.light : null});
}

function formatLunchMateLine_(route, plan, participants) {
  const place = plan.get(route.id);
  if (!place) return '';
  const mates = participants.filter(person => person.id !== route.id && plan.get(person.id) === place).map(person => person.pm);
  return mates.length ? '\n🤝 오늘 *' + escapeSlack_(place.name) + '* 메이트: ' + mates.map(name => escapeSlack_(name) + ' 님').join(' · ') + ' — 같이 가볼까요?' :
    '\n🤝 점심 메이트 켜짐 · 오늘은 같은 곳 메이트가 없어요';
}

function lunchMateButtonBlock_(on) {
  return {type:'actions', elements:[{type:'button', action_id:LUNCH_MATE.actionId, value:on ? 'off' : 'on',
    text:{type:'plain_text', text:on ? '점심 메이트 끄기' : '🤝 점심 메이트 켜기'}}],
    block_id:'lunch_mate'};
}

// 점심 영역(🍚로 시작하는 section) 바로 아래에 버튼을 넣는다. 점심 영역이 없거나 블록 상한(50)이면 넣지 않는다.
function insertLunchMateButton_(blocks, block) {
  if (!blocks || !block || blocks.length >= 50) return blocks;
  const at = blocks.findIndex(b => b.type === 'section' && /^🍚/.test(b.text && b.text.text || ''));
  if (at < 0) return blocks;
  const help = {type:'context', elements:[{type:'mrkdwn', text:block.elements[0].value === 'on' ?
    '켜면 같은 식당을 추천받은 동료와 서로 이름이 보여요. 언제든 끌 수 있어요.' : '끄면 내일부터 내 이름이 보이지 않아요.'}]};
  return blocks.slice(0, at + 1).concat([block, help], blocks.slice(at + 1));
}

// 받은 DM 블록에서 메이트 버튼과 바로 아래 안내만 새 상태로 바꾼다. 버튼이 없으면 null(원래 DM 그대로).
function lunchMateToggledBlocks_(blocks, on) {
  if (!Array.isArray(blocks)) return null;
  const at = blocks.findIndex(b => b && b.block_id === 'lunch_mate');
  if (at < 0) return null;
  const help = blocks[at + 1] && blocks[at + 1].type === 'context' ? 1 : 0;
  const fresh = insertLunchMateButton_([{type:'section', text:{type:'mrkdwn', text:'🍚'}}], lunchMateButtonBlock_(on)).slice(1);
  return blocks.slice(0, at).concat(fresh, blocks.slice(at + 1 + help));
}

// Slack 버튼 응답(application/x-www-form-urlencoded의 payload). 3초 안에 답해야 하므로 시트를 읽지 않는다.
function handleSlackInteraction_(e) {
  const ok = () => ContentService.createTextOutput('');
  try {
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('SLACK_VERIFICATION_TOKEN');
    const payload = JSON.parse(String(e.parameter.payload || '').slice(0, 50000));
    if (!expected || payload.token !== expected || payload.type !== 'block_actions') return ok();
    const action = (payload.actions || [])[0] || {};
    if (String(action.action_id || '').startsWith('feedback_')) { handleFeedbackAction_(payload, action, props); return ok(); }
    if (/^task_(done|undo)_/.test(String(action.action_id || ''))) { handleTaskDoneAction_(payload, action, props); return ok(); }
    const userId = String(payload.user && payload.user.id || '');
    if (action.action_id !== LUNCH_MATE.actionId || !['on','off'].includes(action.value) || !/^[UW][A-Z0-9]{8,}$/.test(userId)) return ok();
    // 누른 사람 본인의 설정만 바꾼다(다른 사람 것을 바꿀 수 없음).
    props.setProperty(LUNCH_MATE.prefix + userId, action.value);
    const text = action.value === 'on' ? '🤝 점심 메이트를 켰어요. 다음 10:30 점심 추천부터 같은 식당을 추천받은 동료가 보여요.' :
      '점심 메이트를 껐어요. 다음 추천부터 내 이름이 보이지 않아요.';
    if (/^https:\/\/hooks\.slack\.com\//.test(String(payload.response_url || ''))) {
      // 누른 DM의 버튼도 바로 켜기↔끄기로 바꾼다(전에는 다음 DM에서야 바뀌어 안 눌린 것처럼 보였음).
      const blocks = lunchMateToggledBlocks_(payload.message && payload.message.blocks, action.value === 'on');
      if (blocks) {
        UrlFetchApp.fetch(payload.response_url, {method:'post', contentType:'application/json', muteHttpExceptions:true,
          payload:JSON.stringify({replace_original:true, text:String(payload.message.text || ''), blocks})});
      }
      UrlFetchApp.fetch(payload.response_url, {method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload:JSON.stringify({response_type:'ephemeral', replace_original:false, text})});
    }
  } catch (error) { console.log('Slack 버튼 처리 생략 | ' + error.message); }
  return ok();
}
