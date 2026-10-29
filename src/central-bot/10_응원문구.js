/**
 * 10. 응원문구 — 오늘의 한마디 고르기(반복 방지)
 *
 * 알아둘 것
 * - BOT_PHRASES 탭이 없으면 코드 문구(11번 파일)를 쓴다. 같은 날·회차·사람은 같은 문구.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⚠️ setupBotPhrases(): BOT_PHRASES 탭을 만들고 기본 문구 1,000개를 채운다(있으면 보존)
 * - 🔍 previewBriefingPhraseSamples(): 회차별 활성 수·핵심 문장 수와 주제별 샘플을 로그로 출력한다
 *
 * 내부 함수 (직접 실행하지 않음)
 * - defaultBriefingPhraseRows_(): 주제별 핵심 문장과 마무리를 조합해 오전·오후 각500개 행을 만든다
 * - validateBriefingPhraseRows_(rows): ID·회차·문장그룹·한 줄 길이·체크박스·중복을 검사한다
 * - readBriefingPhraseCatalog_(bot): BOT_PHRASES를 읽고 탭이 없으면 코드 기본 목록을 사용한다
 * - briefingPhraseStateKey_(route,slot): 수신자와 회차를 해시로 바꿔 이력 속성 이름을 만든다
 * - readBriefingPhraseState_(props,key): 최근 문구·핵심 문장과 당일 선택 이력을 읽고 형식을 검증한다
 * - pickBriefingPhrase_(props,route,day,slot,catalog): 수신자·날짜·회차별로 최근 반복을 피하며 당일 같은 문구를 유지한다
 * - formatBriefingPhrase_(selection): 오전/오후 표식과 선택 문장을 브리핑 끝 문안으로 만든다
 * - markBriefingPhraseSent_(props,route,selection): 실제 DM 성공 후 당일 선택과 제한된 최근 이력을 속성에 저장한다
 */

/** 업무 브리핑 끝에 붙이는 한 줄. 기본 문구 생성·선택은 외부 API를 호출하지 않는다. */
const BOT_PHRASES = Object.freeze({tab:'BOT_PHRASES',
  headers:['phrase_id','slot','theme','family','text','enabled'], recentFamilies:20, historyLimit:60});

function defaultBriefingPhraseRows_() {
  const rows = [];
  ['11:00','17:00'].forEach(slot => {
    let coreNumber = 0;
    BRIEFING_PHRASE_SEEDS[slot].forEach(group => {
      group.cores.forEach(core => {
        const family = (slot === '11:00' ? 'AM' : 'PM') + '-' + String(++coreNumber).padStart(3,'0');
        group.tails.forEach((tail,index) => rows.push([family + '-' + (index+1),slot,group.theme,
          family,core + ' ' + tail,true]));
      });
    });
  });
  return rows;
}

function validateBriefingPhraseRows_(rows) {
  const ids = new Set(), texts = new Set();
  return rows.filter(row => row.some(value => value !== '')).map(row => {
    const [id,slot,theme,family,text] = row.slice(0,5).map(value => String(value || '').trim());
    if (!/^[A-Z0-9_-]{1,50}$/i.test(id) || !['11:00','17:00'].includes(slot) ||
        !/^[A-Z0-9_-]{1,50}$/i.test(family) || !theme || !text ||
        text.length > 120 || /[\r\n<>]/.test(text) || typeof row[5] !== 'boolean') {
      throw new Error('BOT_PHRASES의 ID·회차·주제·문장그룹·한줄문구·체크박스 형식을 확인하세요.');
    }
    if (ids.has(id) || texts.has(slot + '|' + text)) throw new Error('BOT_PHRASES에 중복 문구 또는 ID가 있습니다.');
    ids.add(id); texts.add(slot + '|' + text);
    return {id,slot,theme,family,text,enabled:row[5]};
  });
}

function readBriefingPhraseCatalog_(bot) {
  const sheet = bot.getSheetByName(BOT_PHRASES.tab);
  if (!sheet) return validateBriefingPhraseRows_(defaultBriefingPhraseRows_());
  assertBotHeaders_(sheet, BOT_PHRASES.headers);
  if (sheet.getLastRow() > 10001) throw new Error('BOT_PHRASES는 10000개 문구까지 지원합니다.');
  return validateBriefingPhraseRows_(readBotRows_(sheet, BOT_PHRASES.headers.length));
}

/** 브리핑 전용 시트에만 오전/오후 각500가지 기본값 적재. 기존 문구가 있으면 보존한다. 발송 없음. */
function setupBotPhrases() {
  const props = PropertiesService.getScriptProperties();
  const botId = requiredProperty_(props, 'BOT_SPREADSHEET_ID');
  if (botId !== BOT_WORKBOOK.bootstrapId || botId === props.getProperty('SOURCE_SPREADSHEET_ID')) {
    throw new Error('지정된 브리핑 전용 시트에서만 문구 탭을 준비할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 브리핑 작업 중입니다. 잠시 후 실행하세요.');
  try {
    const bot = SpreadsheetApp.openById(botId);
    const existing = bot.getSheetByName(BOT_PHRASES.tab);
    if (existing && existing.getLastRow() > 1) {
      const catalog = readBriefingPhraseCatalog_(bot);
      console.log('BOT_PHRASES 기존 ' + catalog.length + '개 보존 | 덮어쓰기·Slack 발송 없음');
      return;
    }
    const rows = defaultBriefingPhraseRows_();
    validateBriefingPhraseRows_(rows);
    const sheet = ensureBotSheet_(bot, BOT_PHRASES.tab, BOT_PHRASES.headers);
    if (sheet.getMaxRows() < rows.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
    sheet.getRange(2,2,rows.length,1).setNumberFormat('@');
    sheet.getRange(2,6,rows.length,1).insertCheckboxes();
    sheet.getRange(2,1,rows.length,6).setValues(rows);
    sheet.getRange(2,5,rows.length,1).setWrap(true);
    console.log('브리핑 전용 BOT_PHRASES!A1:F1001 준비 | 오전500·오후500 조합 | Slack 발송·트리거 변경 없음');
  } finally { lock.releaseLock(); }
}

function briefingPhraseStateKey_(route,slot) {
  const hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([route.id,slot]))).slice(0,24);
  return 'BRIEFING_PHRASE_' + hash;
}

function readBriefingPhraseState_(props,key) {
  const raw = props.getProperty(key);
  if (!raw) return {history:[],last:null};
  const state = JSON.parse(raw);
  if (!state || !Array.isArray(state.history) || state.history.length > BOT_PHRASES.historyLimit ||
      state.history.some(item => !item || typeof item.id !== 'string' || typeof item.family !== 'string') ||
      state.last && (typeof state.last.id !== 'string' || typeof state.last.family !== 'string' ||
        typeof state.last.text !== 'string' || state.last.text.length > 120 || /[\r\n<>]/.test(state.last.text) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(state.last.day))) {
    throw new Error('한마디 선택 이력 형식을 확인하세요.');
  }
  return state;
}

// 날짜·회차·수신자 해시로 무작위처럼 분산한다. 미리보기에서는 선택 이력을 쓰지 않는다.
function pickBriefingPhrase_(props,route,day,slot,catalog) {
  if (props.getProperty('ENABLE_BRIEFING_PHRASES') === 'false') return null;
  if (!['11:00','17:00'].includes(slot) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('한마디 회차·날짜 오류');
  const state = readBriefingPhraseState_(props,briefingPhraseStateKey_(route,slot));
  const active = catalog.filter(item => item.enabled && item.slot === slot);
  if (state.last && state.last.day === day) {
    // 같은날 문구수정에도 이미보낸문장을 유지. 문구를 비활성/삭제하면 그날은 생략한다.
    return active.some(item => item.id === state.last.id) ? {...state.last,slot} : null;
  }
  if (!active.length) return null;
  const families = new Set(state.history.slice(-BOT_PHRASES.recentFamilies).map(item => item.family));
  const ids = new Set(state.history.map(item => item.id));
  let candidates = active.filter(item => !families.has(item.family) && !ids.has(item.id));
  if (!candidates.length) candidates = active.filter(item => !ids.has(item.id));
  if (!candidates.length) candidates = active;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify([route.id,day,slot]));
  const seed = Array.from(bytes).slice(0,4).reduce((value,byte) => value*256+(byte+256)%256,0);
  return {...candidates[seed % candidates.length],day,slot};
}

// 브리핑 맨 끝에 인용 블록으로 두어 업무 내용과 구분한다. 오전/저녁 표식은 첫 줄 인사에 있다.
function formatBriefingPhrase_(selection) {
  // 점심 추천과 붙어 보이지 않도록 제목 줄을 따로 둔다.
  return selection ? '\n\n✨ *오늘의 한마디*\n> ' + escapeSlack_(selection.text) : '';
}

function markBriefingPhraseSent_(props,route,selection) {
  if (!selection) return;
  const key = briefingPhraseStateKey_(route,selection.slot);
  const state = readBriefingPhraseState_(props,key);
  if (state.last && state.last.day === selection.day && state.last.id === selection.id) return;
  const history = state.history.concat({id:selection.id,family:selection.family}).slice(-BOT_PHRASES.historyLimit);
  props.setProperty(key,JSON.stringify({last:{day:selection.day,id:selection.id,
    family:selection.family,text:selection.text},history}));
}

/** 문구 수량과 각 회차 샘플만 로그로 확인. 시트·이력 변경·Slack 발송 없음. */
function previewBriefingPhraseSamples() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID'));
  const catalog = readBriefingPhraseCatalog_(bot);
  ['11:00','17:00'].forEach(slot => {
    const active = catalog.filter(item => item.slot === slot && item.enabled);
    console.log(briefingSlotLabel_(slot) + ' 문구 ' + active.length + '개 | 핵심 문장 ' + new Set(active.map(item => item.family)).size + '종');
    [...new Set(active.map(item => item.theme))].slice(0,5).forEach(theme => {
      const sample = active.find(item => item.theme === theme);
      console.log('• ' + sample.text);
    });
  });
  console.log('문구 샘플 조회만 수행 | 시트·이력 변경·Slack 발송 없음');
}
