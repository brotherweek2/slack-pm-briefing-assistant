/**
 * 27. 설정반영 — BOT_SETTINGS 탭으로 스크립트 속성 바꾸기(토큰 포함)
 *
 * 알아둘 것
 * - 허용한 이름만 받는다. 민감한 값은 반영 직후 시트에서 지운다. '삭제'를 적으면 그 속성을 지운다(봇 토큰은 제외).
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⚠️ applyBotSettings(): 봇 시트 BOT_SETTINGS 탭의 A열 이름·B열 값을 스크립트 속성에 반영한다
 * - 🔍 previewBotSettings(): 허용 설정의 현재 값을 로그로 본다(민감한 값은 있음/없음만)
 *
 * 내부 함수 (직접 실행하지 않음)
 * - botSettingsSheet_(props, create): BOT_SETTINGS 탭을 연다(없으면 양식 생성)
 * - refreshBotSettingsNotes_(sheet): 기존 탭의 C열 설명을 최신 문구로 맞추고, 새로 생긴 허용 설정은 빈 줄로 추가한다(B열 값은 건드리지 않음)
 */
const BOT_SETTINGS = Object.freeze({tab:'BOT_SETTINGS', headers:['setting', 'value', 'note'],
  allowed:{
    ENABLE_LUNCH_MATE:{note:'true면 10:30 점심 추천에 점심 메이트 버튼 표시(Slack 버튼 응답 주소 등록 후)'},
    SLACK_VERIFICATION_TOKEN:{note:'Slack 앱 Basic Information의 Verification Token. 반영 후 시트에서 자동 삭제', secret:true},
    // 속성 화면 50개 한도로 편집기에서 못 바꿀 때(앱 재설치로 토큰이 바뀐 경우 등). xoxb- 형식만 받는다.
    SLACK_BOT_TOKEN:{note:'Slack 앱 OAuth & Permissions의 Bot User OAuth Token(xoxb-…). 반영 후 시트에서 자동 삭제', secret:true,
      pattern:/^xoxb-[A-Za-z0-9-]+$/},
    ENABLE_WEATHER:{note:'true면 17:00 DM에 내일 날씨(Open-Meteo, 비상업적 무료 조건 확인 후)'},
    WEATHER_LAT:{note:'날씨 위도(비우면 서울 시청)'}, WEATHER_LON:{note:'날씨 경도'}, WEATHER_PLACE:{note:'날씨에 표시할 지역 이름(예: 강남)'},
    FEEDBACK_FORM_URL:{note:'피드백 "✍️ 자세히 남기기" 버튼이 여는 구글 폼 주소(docs.google.com/forms 또는 forms.gle)'},
    ENABLE_FEEDBACK:{note:'false면 DM 아래 피드백 버튼 끄기'},
    COMPANY_HOLIDAYS:{note:'회사만 쉬는 날(쉼표로 구분, 예: 2026-12-31,2027-01-02). 정기 DM·수집 건너뜀'},
    ENABLE_LUNCH_RECOMMENDATION:{note:'false면 점심 추천 끄기'}, ENABLE_BRIEFING_PHRASES:{note:'false면 한마디 끄기'},
    // 원본 업무 시트 주소(05번 previewOriginalSheetConnection용). 로그·시트에 남기지 않는다.
    ORIGINAL_HACV_SPREADSHEET_ID:{note:'원본 HA-CV 유저 관리 시트 주소. 반영 후 시트에서 자동 삭제', secret:true},
    ORIGINAL_PM_REVIEW_SPREADSHEET_ID:{note:'원본 PM Review 시트 주소. 반영 후 시트에서 자동 삭제', secret:true},
    ORIGINAL_TEST_MANAGEMENT_SPREADSHEET_ID:{note:'원본 테스트지 관리 시트 주소. 반영 후 시트에서 자동 삭제', secret:true},
    ENABLE_PERSONAL_LEAVE_SKIP:{note:'false면 연차인 PM에게도 정기 DM 보내기'},
    ENABLE_TASK_DONE:{note:'false면 DM 업무 줄의 ✅ 완료 버튼 끄기'},
  }});

function botSettingsSheet_(props, create) {
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  let sheet = bot.getSheetByName(BOT_SETTINGS.tab);
  if (!sheet && create) {
    sheet = ensureBotSheet_(bot, BOT_SETTINGS.tab, BOT_SETTINGS.headers);
    const rows = Object.entries(BOT_SETTINGS.allowed).map(([key, info]) => [key, '', info.note]);
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  if (sheet) assertBotHeaders_(sheet, BOT_SETTINGS.headers);
  return sheet;
}

// 기존 탭의 C열 설명을 최신 문구로 맞추고, 새로 생긴 허용 설정은 빈 줄로 추가한다(B열 값은 건드리지 않음).
function refreshBotSettingsNotes_(sheet) {
  const height = Math.max(0, sheet.getLastRow() - 1);
  const keys = height ? sheet.getRange(2, 1, height, 1).getValues().map(r => String(r[0] || '').trim()) : [];
  keys.forEach((key, i) => {
    const info = BOT_SETTINGS.allowed[key];
    if (info) sheet.getRange(i + 2, 3).setValue(info.note);
  });
  const missing = Object.keys(BOT_SETTINGS.allowed).filter(key => !keys.includes(key));
  if (missing.length) sheet.getRange(height + 2, 1, missing.length, 3)
    .setValues(missing.map(key => [key, '', BOT_SETTINGS.allowed[key].note]));
}

function applyBotSettings() {
  const props = PropertiesService.getScriptProperties();
  const sheet = botSettingsSheet_(props, true);
  refreshBotSettingsNotes_(sheet);
  const height = Math.max(0, sheet.getLastRow() - 1);
  const rows = height ? sheet.getRange(2, 1, height, 2).getValues() : [];
  const applied = [], skipped = [], invalid = [];
  rows.forEach((row, index) => {
    const key = String(row[0] || '').trim(), value = String(row[1] == null ? '' : row[1]).trim();
    if (!key || !value) return;
    const info = BOT_SETTINGS.allowed[key];
    if (!info) { skipped.push(key); return; }
    if (info.pattern && !info.pattern.test(value)) {
      // 형식이 다르면 반영하지 않는다('삭제'도 받지 않음). 잘못 붙인 비밀 값도 시트에 남기지 않는다.
      invalid.push(key);
      if (info.secret) sheet.getRange(index + 2, 2).setValue('');
      return;
    }
    if (value === '삭제') props.deleteProperty(key);
    else props.setProperty(key, value);
    applied.push(key + (value === '삭제' ? ' 삭제' : info.secret ? ' 저장(값 숨김)' : ' = ' + value));
    // 민감한 값은 시트에 남기지 않는다. 그 외 값도 반영 후 비워서 다음 실행에 다시 적용되지 않게 한다.
    sheet.getRange(index + 2, 2).setValue('');
  });
  if (!applied.length && !invalid.length) {
    // 무엇을 읽었는지 보여 준다(값 자체는 출력하지 않음). 다른 파일·다른 열에 적은 경우를 바로 알 수 있게.
    const file = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
    const wide = height ? sheet.getRange(2, 1, height, 3).getValues() : [];
    const misplaced = wide.filter(r => String(r[0] || '').trim() && !String(r[1] == null ? '' : r[1]).trim() &&
      String(r[2] || '').trim() && !Object.values(BOT_SETTINGS.allowed).some(info => info.note === String(r[2]).trim()))
      .map(r => String(r[0]).trim());
    console.log('반영할 값 없음 · 읽은 위치: 파일 "' + file.getName() + '" → 탭 ' + BOT_SETTINGS.tab + ' B2:B' + (height + 1) +
      ' (' + height + '행, 값이 있는 칸 0개)');
    if (misplaced.length) console.log('C열(설명 칸)에 값이 적힌 것 같습니다: ' + misplaced.join(', ') + ' → B열(value)로 옮겨 주세요.');
    console.log('B열에 값을 적었는데도 0개라면, 위 파일 이름이 값을 적은 시트와 같은지 확인하세요.');
  } else console.log('반영: ' + applied.join(' | '));
  if (skipped.length) console.log('허용되지 않은 이름이라 건너뜀: ' + skipped.join(', '));
  if (invalid.length) console.log('값 형식이 달라 반영하지 않음(시트 값은 지움): ' + invalid.join(', ') +
    ' — 봇 토큰은 xoxb-로 시작하는 Bot User OAuth Token을 넣으세요.');
  console.log('봇 시트 BOT_SETTINGS·스크립트 속성만 변경 | DM·원천 시트·트리거 변경 없음');
}

function previewBotSettings() {
  const props = PropertiesService.getScriptProperties();
  Object.entries(BOT_SETTINGS.allowed).forEach(([key, info]) => {
    const value = props.getProperty(key);
    console.log(key + ' : ' + (value === null ? '(없음)' : info.secret ? '설정됨' : value));
  });
  console.log('조회만 | 변경 없음');
}
