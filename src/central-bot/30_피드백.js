/**
 * 30. 피드백 — DM 맨 아래 "👍 도움됐어요 / 👎 아쉬워요 / ✍️ 자세히 남기기" 버튼.
 * - 👍/👎: 누르면 봇 시트 BOT_FEEDBACK 탭에 한 줄(받은 시각·Slack ID·이름·날짜·회차·평가)이 쌓이고, 누른 사람에게만 감사 답장.
 * - ✍️: 구글 폼으로 연결(FEEDBACK_FORM_URL, docs.google.com/forms 또는 forms.gle 주소만). 응답은 폼에서 봇 시트로 연결해 둔다.
 * - 버튼은 Slack 버튼 응답이 설정됐을 때(SLACK_VERIFICATION_TOKEN 있음)만 붙고, ENABLE_FEEDBACK=false면 끈다.
 * - appendFeedbackButtons_(blocks, props, day, slot): 블록 맨 끝에 질문 한 줄과 버튼을 붙인다(블록 상한 50 안에서만).
 * - handleFeedbackAction_(payload, action, props): [웹 앱] 25번 handleSlackInteraction_이 검증 후 넘긴다.
 */
// formUrl: 기본 피드백 폼(회사 계정만 응답). 스크립트 속성 FEEDBACK_FORM_URL이 올바른 주소면 그것을 우선한다.
const FEEDBACK = Object.freeze({tab:'BOT_FEEDBACK', headers:['received_at', 'slack_user_id', 'user_name', 'day', 'slot', 'rating'],
  up:'feedback_up', down:'feedback_down', form:'feedback_form', formUrl:'https://forms.gle/EXAMPLE'});

function feedbackEnabled_(props) {
  return props.getProperty('ENABLE_FEEDBACK') !== 'false' && !!props.getProperty('SLACK_VERIFICATION_TOKEN');
}

function appendFeedbackButtons_(blocks, props, day, slot) {
  if (!blocks || blocks.length + 2 > 50 || !feedbackEnabled_(props)) return blocks;
  const value = day + '|' + slot;
  const elements = [
    {type:'button', action_id:FEEDBACK.up, value, text:{type:'plain_text', text:'👍 도움됐어요'}},
    {type:'button', action_id:FEEDBACK.down, value, text:{type:'plain_text', text:'👎 아쉬워요'}},
  ];
  const valid = value => /^https:\/\/(?:docs\.google\.com\/forms\/|forms\.gle\/)[^\s<>|]+$/.test(value);
  const custom = String(props.getProperty('FEEDBACK_FORM_URL') || '').trim();
  const url = valid(custom) ? custom : FEEDBACK.formUrl;
  if (valid(url)) {
    elements.push({type:'button', action_id:FEEDBACK.form, url, text:{type:'plain_text', text:'✍️ 자세히 남기기'}});
  }
  return blocks.concat([{type:'context', elements:[{type:'mrkdwn', text:'이 브리핑 어땠나요?'}]},
    {type:'actions', block_id:'feedback', elements}]);
}

function handleFeedbackAction_(payload, action, props) {
  if (action.action_id === FEEDBACK.form) return; // 폼 링크는 Slack이 바로 연다. 기록할 것 없음.
  const match = String(action.value || '').match(/^(\d{4}-\d{2}-\d{2})\|(11:00|14:00|17:00)$/);
  const userId = String(payload.user && payload.user.id || '');
  if (!match || !/^[UW][A-Z0-9]{8,}$/.test(userId)) return;
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const sheet = ensureBotSheet_(bot, FEEDBACK.tab, FEEDBACK.headers);
  const name = String(payload.user.name || payload.user.username || '').slice(0, 60);
  sheet.appendRow([new Date(), userId, name, match[1], briefingSlotLabel_(match[2]), action.action_id === FEEDBACK.up ? '👍' : '👎']);
  const url = String(payload.response_url || '');
  if (/^https:\/\/hooks\.slack\.com\//.test(url)) {
    UrlFetchApp.fetch(url, {method:'post', contentType:'application/json', muteHttpExceptions:true,
      payload:JSON.stringify({response_type:'ephemeral', replace_original:false,
        text:action.action_id === FEEDBACK.up ? '👍 의견 고마워요! 계속 이렇게 보내드릴게요.' :
          '👎 의견 고마워요. 무엇이 아쉬웠는지 "✍️ 자세히 남기기"로 알려주시면 더 빨리 고칠 수 있어요.'})});
  }
}
