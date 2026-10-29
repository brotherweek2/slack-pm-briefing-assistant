/**
 * 15. 점심추천 — 10:30 점심 추천(식당 1곳 + 카페·편의점 1곳)
 *
 * 알아둘 것
 * - 기본 목록은 16번 파일, BOT_RESTAURANTS 탭이 있으면 그 탭만 쓴다. 유료 API·실시간 메뉴 검색 없음.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⚠️ setupBotRestaurants(): 봇 시트에 BOT_RESTAURANTS 탭을 만들고 기본 식당 목록을 채운다
 * - 🔍 previewMyLunchRecommendation(): 오늘 본인에게 갈 점심 추천을 로그로만 보여준다
 * - ⚠️ updateBotLunchRecommendations(): BOT_RESTAURANTS 탭의 예전 항목을 새 기본값으로 고친다
 *
 * 내부 함수 (직접 실행하지 않음)
 * - defaultLunchRestaurantRows_(): 코드에 든 기본 식당 목록을 표 행으로 만든다
 * - validateLunchRestaurantRows_(rows): 식당 목록 형식(ID·분류·메뉴·상태)을 검사한다
 * - readLunchRestaurantCatalog_(bot): BOT_RESTAURANTS 탭을 읽고, 없으면 기본 목록을 쓴다
 * - lunchRecommendationStateKey_(route,kind): PM별 점심 추천 이력의 속성 이름(해시)
 * - readLunchRecommendationState_(props,key): 점심 추천 이력(최근 식당·오늘 선택)을 읽는다
 * - pickLunchRecommendation_(props,route,day,slot,catalog,kind): 오늘 PM에게 줄 식당·간단식을 고른다(날짜·사람 해시, 최근 7회 제외)
 * - formatLunchRecommendation_(selection): 점심 추천 DM 문안
 * - markLunchRecommendationSent_(props,route,selection): 발송 성공 뒤 점심 추천 이력을 저장한다
 */
const BOT_RESTAURANTS = Object.freeze({tab:'BOT_RESTAURANTS',checkedAt:'2026-10-19',recent:7,historyLimit:20,
  headers:['restaurant_id','name','category','experience_observed','menu_1','menu_2','menu_3',
    'map_url','source_url','checked_at','lunch_status','enabled','note']});

function defaultLunchRestaurantRows_() {
  return BRIEFING_RESTAURANT_SEEDS.map((item,index) => {
    const [name,category,observed,menus,source,status,note] = item;
    const query = name + (/(본점|역점)/.test(name) ? '' : ' 회사 근처');
    return [item[7] || 'LUNCH_' + String(index+1).padStart(3,'0'),name,category,observed,
      menus[0] || '',menus[1] || '',menus[2] || '',
      'https://map.naver.com/p/search/' + encodeURIComponent(query),source,
      BOT_RESTAURANTS.checkedAt,status,['confirmed','approximate'].includes(status),note];
  });
}

function validateLunchRestaurantRows_(rows) {
  const ids = new Set(), names = new Set();
  const shortText = value => typeof value === 'string' && value.length <= 150 && !/[\r\n<>|]/.test(value);
  const https = value => /^https:\/\/[^\s<>|]+$/.test(value);
  return rows.filter(row => row.some(value => value !== '') &&
    !BRIEFING_LUNCH_REMOVED_NAMES.includes(String(row[1] || '').trim())).map(row => {
    const [id,name,category] = row.slice(0,3).map(value => String(value || '').trim());
    const menus = row.slice(4,7).map(value => String(value || '').trim()).filter(Boolean);
    const [url,source,checkedAt,status] = row.slice(7,11).map(value => String(value || '').trim());
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(checkedAt) &&
      !isNaN(Date.parse(checkedAt)) && new Date(checkedAt).toISOString().slice(0,10) === checkedAt;
    if (!/^[A-Z0-9_-]{1,50}$/i.test(id) || !name || !shortText(name) ||
        !['식당','카페','편의점'].includes(category) || typeof row[3] !== 'boolean' ||
        typeof row[11] !== 'boolean' || !['confirmed','approximate','pending','evening_only','not_lunch'].includes(status) ||
        !/^https:\/\/map\.naver\.com\/p\/search\/[^\s<>|]+$/.test(url) ||
        menus.some(menu => !shortText(menu)) || new Set(menus).size !== menus.length ||
        source && !https(source) || checkedAt && !dateValid ||
        status === 'confirmed' && (!menus.length || !source || !dateValid) ||
        status === 'approximate' && (!menus.length || !dateValid)) {
      throw new Error('BOT_RESTAURANTS의 이름·메뉴·출처·확인날짜·상태·체크박스 형식을 확인하세요.');
    }
    if (ids.has(id) || names.has(name)) throw new Error('BOT_RESTAURANTS의 식당 이름 또는 ID가 중복됩니다.');
    ids.add(id); names.add(name);
    const copy = BRIEFING_LUNCH_COPY[name] || {cuisine:category,
      text:menus.length ? '오늘은 ' + menus[0] + ' 어때요?' : '오늘은 이곳에서 한 끼 어때요?',
      basis:status === 'confirmed' ? 'public-menu' : 'category-suggestion'};
    if (!shortText(copy.text)) throw new Error('점심 추천 문구 형식을 확인하세요.');
    return {id,name,category,observed:row[3],menus,url,source,checkedAt,status,enabled:row[11],
      cuisine:copy.cuisine,recommendation:copy.text,copyBasis:copy.basis,note:String(row[12] || '')};
  });
}

function readLunchRestaurantCatalog_(bot) {
  const sheet = bot.getSheetByName(BOT_RESTAURANTS.tab);
  if (!sheet) return validateLunchRestaurantRows_(defaultLunchRestaurantRows_());
  assertBotHeaders_(sheet,BOT_RESTAURANTS.headers);
  if (sheet.getLastRow() > 1001) throw new Error('BOT_RESTAURANTS는1000곳까지 지원합니다.');
  // 표시문자열로 날짜를 읽어 Date/일련번호 변환에 의한 오류를 방지한다.
  const rows = readBotRows_(sheet,BOT_RESTAURANTS.headers.length);
  if (rows.length) {
    const dates = sheet.getRange(2,10,rows.length,1).getDisplayValues();
    rows.forEach((row,i) => { row[9] = dates[i][0]; });
  }
  return validateLunchRestaurantRows_(rows);
}

function setupBotRestaurants() {
  const props = PropertiesService.getScriptProperties();
  const botId = requiredProperty_(props,'BOT_SPREADSHEET_ID');
  if (botId !== BOT_WORKBOOK.bootstrapId || botId === props.getProperty('SOURCE_SPREADSHEET_ID')) {
    throw new Error('지정된 브리핑 전용 시트에서만 식당 탭을 준비할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 브리핑 작업 중입니다.');
  try {
    const bot = SpreadsheetApp.openById(botId);
    const existing = bot.getSheetByName(BOT_RESTAURANTS.tab);
    if (existing && existing.getLastRow() > 1) {
      console.log('BOT_RESTAURANTS 기존 ' + readLunchRestaurantCatalog_(bot).length + '곳 보존 | DM 없음');
      return;
    }
    const rows = defaultLunchRestaurantRows_();
    validateLunchRestaurantRows_(rows);
    const sheet = ensureBotSheet_(bot,BOT_RESTAURANTS.tab,BOT_RESTAURANTS.headers);
    if (sheet.getMaxRows() < rows.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
    // 체크박스를 먼저 만들어 기본값 TRUE가 초기화되지 않도록 한다.
    sheet.getRange(2,4,rows.length,1).insertCheckboxes();
    sheet.getRange(2,12,rows.length,1).insertCheckboxes();
    sheet.getRange(2,10,rows.length,1).setNumberFormat('@');
    sheet.getRange(2,1,rows.length,BOT_RESTAURANTS.headers.length).setValues(rows);
    console.log('브리핑 전용 BOT_RESTAURANTS!A1:M' + (rows.length+1) + ' 준비 | ' + rows.length + '곳 | DM 없음');
  } finally { lock.releaseLock(); }
}

function lunchRecommendationStateKey_(route,kind) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(route.id));
  return 'LUNCH_CHOICE_' + Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'') + (kind === 'light' ? '_LIGHT' : '');
}

function readLunchRecommendationState_(props,key) {
  const raw = props.getProperty(key);
  if (!raw) return {last:null,history:[]};
  const state = JSON.parse(raw);
  if (!state || !Array.isArray(state.history) || state.history.length > BOT_RESTAURANTS.historyLimit ||
      state.history.some(item => !item || typeof item.id !== 'string' || item.id.length > 50) ||
      state.last && (!/^\d{4}-\d{2}-\d{2}$/.test(state.last.day) ||
        typeof state.last.id !== 'string' || typeof state.last.menu !== 'string' || state.last.menu.length > 150)) {
    throw new Error('점심 추천 이력 형식을 확인하세요.');
  }
  return state;
}

function pickLunchRecommendation_(props,route,day,slot,catalog,kind) {
  if (props.getProperty('ENABLE_LUNCH_RECOMMENDATION') === 'false' || slot !== '11:00') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('점심 추천 날짜 형식 오류');
  kind = kind === 'light' ? 'light' : 'meal';
  const active = catalog.filter(item => item.enabled &&
    (kind === 'light' ? ['카페','편의점'].includes(item.category) : item.category === '식당') &&
    ['confirmed','approximate'].includes(item.status) && item.menus.length && item.checkedAt <= day &&
    !BRIEFING_LUNCH_REMOVED_NAMES.includes(item.name));
  const light = kind === 'meal' ? pickLunchRecommendation_(props,route,day,slot,catalog,'light') : null;
  if (!active.length) return light ? {light,day,kind:'meal'} : null;
  const state = readLunchRecommendationState_(props,lunchRecommendationStateKey_(route,kind));
  if (state.last && state.last.day === day) {
    const restaurant = active.find(item => item.id === state.last.id);
    const selected = restaurant && restaurant.menus.includes(state.last.menu) ?
      {...restaurant,menu:state.last.menu,day,kind} : null;
    return kind === 'meal' ? selected ? {...selected,light} : light ? {light,day,kind} : null : selected;
  }
  const recent = new Set(state.history.slice(-BOT_RESTAURANTS.recent).map(item => item.id));
  let candidates = active.filter(item => !recent.has(item.id));
  if (!candidates.length) candidates = active;
  // 식당부터 균등 선택: 메뉴가3개인 곳이1개인 곳보다 더 자주 뽑히지 않도록 한다.
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(['lunch',route.id,day,kind]));
  const seed = Array.from(bytes).slice(0,4).reduce((v,b) => v*256+(b+256)%256,0);
  const menuSeed = Array.from(bytes).slice(4,8).reduce((v,b) => v*256+(b+256)%256,0);
  const restaurant = candidates[seed % candidates.length];
  return {...restaurant,menu:restaurant.menus[menuSeed % restaurant.menus.length],day,kind,...(kind === 'meal' ? {light} : {})};
}

function formatLunchRecommendation_(selection) {
  if (!selection) return '';
  const lines = [];
  // 식당 이름을 먼저 굵게 두어 훑어볼 때 바로 보이게 한다.
  if (selection.id) lines.push('• *' + escapeSlack_(selection.name) + '* — ' + escapeSlack_(selection.recommendation));
  if (selection.light) lines.push('• 가볍게 · *' + escapeSlack_(selection.light.name) + '* — ' + escapeSlack_(selection.light.recommendation));
  return lines.length ? '\n\n🍚 *점심 추천*\n' + lines.join('\n') : '';
}

function markLunchRecommendationSent_(props,route,selection) {
  if (!selection) return;
  if (selection.light) markLunchRecommendationSent_(props,route,selection.light);
  if (!selection.id) return;
  const key = lunchRecommendationStateKey_(route,selection.kind);
  const state = readLunchRecommendationState_(props,key);
  if (state.last && state.last.day === selection.day) return;
  props.setProperty(key,JSON.stringify({last:{day:selection.day,id:selection.id,menu:selection.menu},
    history:state.history.concat({id:selection.id}).slice(-BOT_RESTAURANTS.historyLimit)}));
}

function previewMyLunchRecommendation() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props,'BOT_SPREADSHEET_ID'));
  const users = readBotRows_(requireBotSheet_(bot,BOT_WORKBOOK.usersTab,BOT_WORKBOOK.userHeaders),BOT_WORKBOOK.userHeaders.length);
  const pilot = findPilotRecipient_(users);
  if (!pilot || !/^[UW][A-Z0-9]{8,}$/.test(pilot.id)) throw new Error('본인 Slack 연결을 확인하세요.');
  const day = Utilities.formatDate(new Date(),BRIEFING.timezone,'yyyy-MM-dd');
  const catalog = readLunchRestaurantCatalog_(bot);
  const choice = pickLunchRecommendation_(props,{pm:getPilotPmName_(users),id:pilot.id},day,'11:00',catalog);
  console.log(formatLunchRecommendation_(choice) || '활성 추천 없음 · 점심 설정과 확인된 메뉴를 확인하세요.');
  console.log('전체 ' + catalog.length + '곳 | 식당 ' + catalog.filter(x => x.category === '식당').length +
    '곳 | 식당 활성 ' + catalog.filter(x => x.category === '식당' && ['confirmed','approximate'].includes(x.status) && x.enabled).length +
    '곳 | 간단식 활성 ' + catalog.filter(x => x.category !== '식당' && ['confirmed','approximate'].includes(x.status) && x.enabled).length + '곳');
  console.log('미리보기만 | 메뉴 검색 API·시트/이력/트리거 변경·Slack 발송 없음');
}

function updateBotLunchRecommendations() {
  const props = PropertiesService.getScriptProperties();
  const botId = requiredProperty_(props,'BOT_SPREADSHEET_ID');
  if (botId !== BOT_WORKBOOK.bootstrapId || botId === props.getProperty('SOURCE_SPREADSHEET_ID')) {
    throw new Error('지정된 브리핑 전용 시트만 업데이트할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 브리핑 작업 중입니다.');
  let missing = false;
  try {
    const bot = SpreadsheetApp.openById(botId), sheet = bot.getSheetByName(BOT_RESTAURANTS.tab);
    if (!sheet) missing = true;
    else {
      assertBotHeaders_(sheet,BOT_RESTAURANTS.headers);
      const rows = readBotRows_(sheet,BOT_RESTAURANTS.headers.length);
      const defaults = defaultLunchRestaurantRows_();
      validateLunchRestaurantRows_(defaults);
      const changes = [], deletions = [];
      rows.forEach((row,index) => {
        const name = String(row[1] || '').trim();
        if (BRIEFING_LUNCH_REMOVED_NAMES.includes(name)) deletions.push(index+2);
        else if (['pending','not_lunch'].includes(String(row[10]))) {
          const replacement = defaults.find(item => item[0] === row[0] && item[1] === name);
          if (replacement) changes.push({row:index+2,values:replacement});
        }
      });
      changes.forEach(change => {
        sheet.getRange(change.row,10,1,1).setNumberFormat('@');
        sheet.getRange(change.row,1,1,BOT_RESTAURANTS.headers.length).setValues([change.values]);
      });
      deletions.sort((a,b) => b-a).forEach(row => sheet.deleteRow(row));
      console.log('봇 식당 탭 업데이트 ' + changes.length + '행·삭제 ' + deletions.length + '행 | 기존 confirmed 체크·원천·이력·트리거·DM 변경 없음');
    }
  } finally { lock.releaseLock(); }
  if (missing) setupBotRestaurants();
}
