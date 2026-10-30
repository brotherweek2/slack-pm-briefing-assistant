/**
 * 31. 완료버튼 — DM 업무 줄마다 [✅ 완료] 버튼, 누르면 그 업무 종류를 오늘 남은 회차에서만 뺀다. 잘못 누르면 [↩️ 되돌리기]
 *
 * 알아둘 것
 * - 원본 시트는 바꾸지 않는다. 다음 날 원본에 그대로 남아 있으면 다시 알린다(완료 여부를 봇이 판단하지 않음).
 * - 누른 사람 본인의 업무에만 적용한다. 오늘 날짜 DM의 버튼만 받는다.
 * - 버튼은 Slack 버튼 응답(SLACK_VERIFICATION_TOKEN)이 설정됐을 때만 붙고, ENABLE_TASK_DONE=false면 끈다.
 * - 버튼 응답은 웹 앱(doPost)으로 들어오므로, 이 파일을 바꾸면 웹 앱 배포를 새 버전으로 갱신해야 반영된다.
 *
 * 내부 함수 (직접 실행하지 않음)
 * - taskDoneEnabled_(props): 완료 버튼을 붙일 조건(검증 토큰·설정)
 * - taskDoneGroups_(props, userId, day): 오늘 완료로 표시한 업무 종류 목록(날짜가 바뀌면 빈 목록)
 * - withoutDoneTasks_(rows, pm, done): 그 PM의 업무 중 완료 표시한 종류를 뺀다
 * - taskDoneNote_(done): 업무 영역 끝 "✅ 오늘 완료 표시: …" 한 줄
 * - taskDoneButtonBlock_(rows, day, done): DM에 보이는 업무 종류마다 [✅ 완료], 오늘 완료 표시한 종류는 [↩️ 되돌리기]
 * - taskUndoButton_(day, group): [↩️ 되돌리기] 버튼 1개
 * - insertTaskDoneButtons_(blocks, block): 업무 영역(📌로 시작) 바로 아래에 버튼을 넣는다
 * - handleTaskDoneAction_(payload, action, props): 버튼 응답 처리. 누른 본인의 오늘 목록에 넣거나(완료) 뺀다(되돌리기). 완료 안내에도 되돌리기 버튼
 */
const TASK_DONE = Object.freeze({prefix:'TASK_DONE_', actionId:'task_done', undoId:'task_undo',
  groups:Object.freeze({HACV_DUE_SOON:'종료 임박', HACV_HEADSUP:'헤즈업', HACV_REVIEW:'예비 작업자 검토',
    HACV_ABUSE:'어뷰저 관리', PM_REVIEW:'1차 검수', TEST_REVIEW:'테스트지 검토'})});

function taskDoneEnabled_(props) {
  return props.getProperty('ENABLE_TASK_DONE') !== 'false' && !!props.getProperty('SLACK_VERIFICATION_TOKEN');
}

function taskDoneGroups_(props, userId, day) {
  try {
    const saved = JSON.parse(props.getProperty(TASK_DONE.prefix + userId) || 'null');
    return saved && saved.day === day && Array.isArray(saved.groups) ? saved.groups.filter(group => TASK_DONE.groups[group]) : [];
  } catch (_) { return []; }
}

function withoutDoneTasks_(rows, pm, done) {
  if (!done.length) return rows;
  return rows.filter(row => !(String(row[1] || '').trim() === pm && done.includes(String(row[0] || '').split('|', 1)[0])));
}

function taskDoneNote_(done) {
  return done.length ? '\n• ✅ 오늘 완료 표시: ' + done.map(group => TASK_DONE.groups[group]).join(' · ') +
    ' (내일 원본에 남아 있으면 다시 알려요)' : '';
}

// done(선택): 오늘 완료 표시한 종류. 그 종류는 [↩️ 되돌리기] 버튼으로 붙인다(잘못 눌렀을 때).
function taskDoneButtonBlock_(rows, day, done) {
  const present = new Set(rows.map(row => String(row[0] || '').split('|', 1)[0]));
  const groups = Object.keys(TASK_DONE.groups).filter(group => present.has(group));
  const undo = (done || []).filter(group => TASK_DONE.groups[group]);
  if (!groups.length && !undo.length) return null;
  return {type:'actions', block_id:'task_done', elements:groups.map(group => ({type:'button',
    action_id:TASK_DONE.actionId + '_' + group, value:day + '|' + group,
    text:{type:'plain_text', text:'✅ ' + TASK_DONE.groups[group] + ' 완료'}}))
    .concat(undo.map(taskUndoButton_.bind(null, day)))};
}

function taskUndoButton_(day, group) {
  return {type:'button', action_id:TASK_DONE.undoId + '_' + group, value:day + '|' + group,
    text:{type:'plain_text', text:'↩️ ' + TASK_DONE.groups[group] + ' 되돌리기'}};
}

function insertTaskDoneButtons_(blocks, block) {
  if (!blocks || !block || blocks.length >= 49) return blocks;
  const start = blocks.findIndex(b => b.type === 'section' && /^📌/.test(b.text && b.text.text || ''));
  if (start < 0) return blocks;
  // 업무 영역이 길어 문단이 여러 개로 나뉘었으면 그 영역 끝(다음 구분선 앞)에 넣는다.
  let end = start + 1;
  while (end < blocks.length && blocks[end].type === 'section') end++;
  return blocks.slice(0, end).concat([block], blocks.slice(end));
}

// [✅ 완료]는 오늘 목록에 넣고, [↩️ 되돌리기]는 오늘 목록에서 뺀다(다음 회차부터 다시 나옴).
function handleTaskDoneAction_(payload, action, props) {
  const userId = String(payload.user && payload.user.id || '');
  const undo = String(action.action_id || '').startsWith(TASK_DONE.undoId + '_');
  const [day, group] = String(action.value || '').split('|');
  if (!/^[UW][A-Z0-9]{8,}$/.test(userId) || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !TASK_DONE.groups[group]) return;
  const today = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  const label = TASK_DONE.groups[group];
  let reply;
  if (day !== today) {
    reply = {text:'지난 DM의 버튼이라 반영하지 않았어요. 오늘 받은 DM에서 눌러 주세요.'};
  } else {
    // 누른 사람 본인의 오늘 목록만 바꾼다(다른 사람 것은 바꿀 수 없음).
    const groups = taskDoneGroups_(props, userId, today).filter(item => item !== group);
    if (!undo) groups.push(group);
    props.setProperty(TASK_DONE.prefix + userId, JSON.stringify({day:today, groups}));
    if (undo) {
      reply = {text:'↩️ ' + label + ' 완료 표시를 되돌렸어요. 다음 브리핑부터 다시 보여 드려요.'};
    } else {
      const text = '✅ ' + label + ' 완료로 표시했어요. 오늘 남은 브리핑에서는 빼고, 내일 원본 시트에 남아 있으면 다시 알려요.';
      // 잘못 눌렀을 때 바로 되돌릴 수 있게 안내에 버튼을 붙인다.
      reply = {text, blocks:[{type:'section', text:{type:'mrkdwn', text}},
        {type:'actions', block_id:'task_undo', elements:[taskUndoButton_(today, group)]}]};
    }
  }
  const url = String(payload.response_url || '');
  if (/^https:\/\/hooks\.slack\.com\//.test(url)) {
    UrlFetchApp.fetch(url, {method:'post', contentType:'application/json', muteHttpExceptions:true,
      payload:JSON.stringify(Object.assign({response_type:'ephemeral', replace_original:false}, reply))});
  }
}
