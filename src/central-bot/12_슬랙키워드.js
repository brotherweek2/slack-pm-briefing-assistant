/**
 * 12. 슬랙키워드
 * - 역할: 업무 분류용 키워드 목록 읽기와 검색
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 12-01. 키워드 행 검증 [내부]
 * - validateSlackKeywordRows_(rows): 규칙 유형·우선순위·활성 체크박스와 검색 표현을 검사한다.
 *
 * 12-02. 키워드 규칙 읽기 [내부]
 * - getSlackKeywordRules_(): BOT_KEYWORD_RULES를 읽고 탭이 없으면 기본 규칙을 사용하며 실행 중 재사용한다.
 *
 * 12-03. 정리된 본문 검색 [내부]
 * - slackKeywordMatchesNormalized_(plain, compact, keyword): 정규화된 본문과 키워드를 경계·공백 규칙으로 비교하고 정규식을 재사용한다.
 *
 * 12-04. 단일 키워드 검색 [내부]
 * - slackKeywordMatches_(text, keyword): 본문을 정규화해 키워드 일치 여부를 확인한다.
 *
 * 12-05. 유형별 키워드 찾기 [내부]
 * - findSlackKeywordHits_(text, type): 활성 규칙 중 해당 유형에 맞는 키워드를 우선순위대로 찾는다.
 */

/** PM 업무 사전. 검색 범위/담당자/기한을 확장하지 않고 멘션 후보의 분류에만 사용한다. */
const SLACK_KEYWORD_HEADERS = ['rule_type', 'category', 'keywords', 'priority', 'enabled', 'source_basis'];
const SLACK_KEYWORD_DEFAULTS = [
  ['category', '진행 문제', '접근 불가|접속 불가|접속 오류|로그인 오류|로그인 이슈|파일 오류|링크 오류|권한 요청|권한 없음|IMPORTRANGE|#REF!|데이터 누락|파일 누락', 0, true, '사용자·Slack 조회'],
  ['category', '보류·중지·재개', '작업 보류|검수 보류|구축 보류|작업 중단|작업 중지|검수 중단|작업 재개|검수 재개', 1, true, 'Slack 조회'],
  ['category', '시트·담당 변경', '시트 사용 중지|시트 업데이트 중지|시트 이관|분기 시트|아카이빙|아카이브|경로 변경|링크 변경|양식 변경|원상 복구|원상복구|원복|언어쌍 재배정|담당 재배정|TCD|Project Progress|Batch Name', 1, true, '사용자·Slack 조회'],
  ['category', '일정 변경', '마감 변경|기한 변경|일정 변경|일정 조정|일정 지연|납품일 변경|종료 시각|종료 시간|앞당김|연기|재산정', 1, true, '사용자·Slack 조회'],
  ['category', '어뷰저 관리', '어뷰저|어뷰징|abuser|abuse|캐시아웃|캐시 아웃|cashout|cash out|어뷰저 리스트|어뷰저 판단|어뷰저 관리|유저 데이터|데이터 제외', 2, true, '사용자·Slack 조회'],
  ['category', '테스트지 검토', '테스트지|테스트 검수|테스트 검토|테스트 관리|테스트지 제작|생성 완료|생성완료|검토 완료일|업로드 완료', 2, true, '사용자 확인'],
  ['category', '데이터 검수', '1차 검수|1차검수|2차 검수|2차검수|재검수|검수 Agent|검수 AGENT 완료|검수 에이전트|PM Review|검수중|검수 중|검수 완료|검수완료|검수 파일|검수 요청|검수 일정|수정본|피드백|수정 요청|검토 요청', 2, true, '사용자·Slack 조회'],
  ['category', '파일 변환', '파일 변환|변환 완료|변환 및|변환 작업|TSV|JSONL|JSON|HTML|Validation|검증 파일', 2, true, 'Slack 조회'],
  ['category', '헤즈업·참여 확인', '헤즈업|heads-up|heads up|headsup|헤즈업 대상|헤즈업 완료|참여확정|참여 확정|참여 승인|승인 메일|참여 의사|리마인드 메일', 2, true, '사용자 확인'],
  ['category', '예비 작업자·레벨 검토', '검토 필요|검토필요|예비 작업자|신규 유저|유저 검토|HUB|HACV_Hub|투입 여부|투입 허용|투입 제외|레벨 부여|Advanced 5|Basic Level|BAN|Banned|Unbanned|IP 국가|거주 국가|모국어|참여 언어|역방향|교차 지원', 2, true, '사용자 확인'],
  ['category', '배치·할당·가용', '배치|Batch|할당|재할당|배정|추가 할당|할당 완료|작업 중|작업중|작업자 상태|유저 상태|유저 현황|가용|투입 대기|투입 완료|투입 가능|배치 작업량|payload|작업량|남은 작업', 3, true, '사용자·Slack 조회'],
  ['category', '추가 구인·인재풀', '추가 구인|구인|추가 공고|공고 게재|인재풀|인력 공유|인력 확보|작업자 모집|리소스 확보', 2, true, '사용자·Slack 조회'],
  ['category', '납품·구축 종료', '목표 종료일|구축 종료|작업 종료|순차 종료|납품 일정|납품 대상|납품 예정|납품 완료|취합 예정|회수 예정|필터 보기|대상 파일|최종 납품|리드타임|lead time|마감 기한', 3, true, '사용자·Slack 조회'],
  ['category', '검수 기준·품질', '검수 가이드라인|작업 가이드라인|검수 주의사항|평가 기준|Score Justification|Original Score|Pipeline Score|Assigned Score|Agreement|Suggested Score|Suggested Range|Rationale|Findings|Evaluation|Severity|Category|동일 SID|Needs Review|Completed|칸 너비|줄바꿈|개행 문자', 4, true, 'Slack 조회'],
  ['category', '운영 기준', '할당 기준|종합적으로 고려|균등한 분배|업무 역량|할당 원칙|배정 원칙|작업량 기준|최소 기준|최대 기준', 5, true, 'Slack 조회'],
  ['category', '회의·세션', '검수 세션|어뷰저 판단 세션|세션|회의|회의록|회의록 작성|스크럼|Scrum|미팅|참석|구글 캘린더|WBR', 4, true, '사용자·Slack 조회'],
  ['category', '업무 기록·회신', '업무 일지|업무일지|회신|이메일 초안|메일 초안|메일 발송|메일 송부|상태 업데이트|상태값 업데이트|상태 변경|제출|작성 요청', 4, true, '사용자·Slack 조회'],
  ['category', '정산·실적 참고', '정산 수단|정산|Actuals|Draft Actuals|Tracker|Throughput|청구|PO|Budget ID|Project ID', 6, true, 'Slack 조회·참고 공지'],
  ['work', 'HA-CV', 'HA-CV|HA_CV|HACV|HA CV|HA Commentary Validation', 0, true, '사용자·Slack 조회'],
  ['work', 'HT', 'HT|Human Translation', 0, true, '사용자·Slack 조회'],
  ['work', 'MTPE', 'MTPE|MT PE|Machine Translation Post Editing', 0, true, '사용자·Slack 조회'],
  ['work', 'HA-C', 'HA-C|HA_C|HAC|HA Commentary', 0, true, 'Slack 조회'],
  ['work', 'LCT', 'LCT', 0, true, 'Slack 조회'],
  ['batch', '배치 유형', 'test.web|ta.text|tests.system|sms.short|sms.long|SMS Short|SMS Long|TW|TS|A/B', 0, true, '사용자·Slack 조회'],
  ['request', '요청 표현', '요청|부탁|바랍니다|필요|필수|진행해|확인해|작성해|제출해|변경해|업데이트해|참석해|숙지|참고|기한|마감', 0, true, '사용자·Slack 조회'],
  ['completed', '완료 보고', '검수 완료했습니다|검수 완료하였습니다|검토 완료했습니다|검토 완료하였습니다|제출 완료했습니다|발송 완료했습니다|처리 완료했습니다|작업 완료했습니다|검수 완료했습니다|확인했습니다|확인하였습니다', 0, true, '완료 보고 구분 규칙'],
  ['cancel', '취소·철회', '요청 취소|요청 철회|작업 취소|진행하지 마|진행하지마|검수하지 마|검수 불필요|재검수 불필요|재납품 불필요|필요하지 않|아직 확정되지 않|미확정|미정', 0, true, 'Slack 조회·문맥 확인 규칙'],
  ['noise', '비업무·단순 응답', '감사합니다|고맙습니다|죄송합니다|수고하셨|점심 주문|메뉴 주문|차백도|커피 주문|밀크티|회식 메뉴', 0, true, 'Slack 조회·제외 규칙'],
];
let slackKeywordRulesCache_ = null;

function validateSlackKeywordRows_(rows) {
  const types = new Set(['category', 'work', 'batch', 'request', 'completed', 'cancel', 'noise']);
  return rows.filter(row => String(row[0] || '').trim()).map(row => {
    const type = String(row[0]).trim();
    const category = String(row[1] || '').trim();
    const keywords = [...new Set(String(row[2] || '').split('|').map(value => value.trim()).filter(Boolean))];
    const priority = Number(row[3]);
    if (!types.has(type) || !category || !keywords.length || !Number.isFinite(priority) || typeof row[4] !== 'boolean') {
      throw new Error('BOT_KEYWORD_RULES의 유형·카테고리·키워드·우선순위·사용 여부를 확인하세요.');
    }
    return { type, category, keywords, priority, enabled: row[4], source: String(row[5] || '') };
  });
}

function getSlackKeywordRules_() {
  if (slackKeywordRulesCache_) return slackKeywordRulesCache_;
  let rows = SLACK_KEYWORD_DEFAULTS;
  if (typeof SpreadsheetApp !== 'undefined' && typeof PropertiesService !== 'undefined') {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('BOT_SPREADSHEET_ID');
    if (id) {
      const sheet = SpreadsheetApp.openById(id).getSheetByName('BOT_KEYWORD_RULES');
      if (sheet) {
        const headers = sheet.getRange(1, 1, 1, SLACK_KEYWORD_HEADERS.length).getValues()[0];
        if (headers.join('|') !== SLACK_KEYWORD_HEADERS.join('|')) throw new Error('BOT_KEYWORD_RULES 제목줄이 예상과 다릅니다.');
        rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
      }
    }
  }
  slackKeywordRulesCache_ = validateSlackKeywordRows_(rows);
  return slackKeywordRulesCache_;
}

const slackKeywordMatchers_ = new Map();

function slackKeywordMatchesNormalized_(plain, compact, keyword) {
  if (!slackKeywordMatchers_.has(keyword)) {
    const term = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (slackKeywordMatchers_.size >= 2000) slackKeywordMatchers_.clear();
    slackKeywordMatchers_.set(keyword, /^[a-z0-9 ._-]+$/.test(term) ?
      new RegExp('(^|[^a-z0-9])' + escaped + '(?=$|[^a-z0-9])', 'i') : term.replace(/\s+/g, ''));
  }
  const matcher = slackKeywordMatchers_.get(keyword);
  return typeof matcher === 'string' ? compact.includes(matcher) : matcher.test(plain);
}

function slackKeywordMatches_(text, keyword) {
  const plain = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  return slackKeywordMatchesNormalized_(plain, plain.replace(/\s+/g, ''), keyword);
}

function findSlackKeywordHits_(text, type) {
  const plain = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const compact = plain.replace(/\s+/g, '');
  return getSlackKeywordRules_().filter(rule => rule.enabled && rule.type === type &&
    rule.keywords.some(word => slackKeywordMatchesNormalized_(plain, compact, word)))
    .sort((a, b) => a.priority - b.priority);
}
