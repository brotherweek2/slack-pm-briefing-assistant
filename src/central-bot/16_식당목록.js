/**
 * 16. 식당목록
 * - 기능: 식당54·카페16·편의점5곳과 매장별 짧은 추천 문장을 보관한다.
 * - 사용:15번 점심추천에서 읽는다. 직접 실행 함수·검색 API 없음.
 * - observed=true: 사용자 방문 또는 다른 사람의 이용을 본 표시(*). 가중치가 아니다.
 * - confirmed는 공개 메뉴 자료, approximate는 사용자가 허용한 음식 종류 기반 제안이다.
 * - approximate 메뉴는 해당 매장의 판매·재고를 확인한 상품명이 아니다.
 * - source/지도 링크는 내부 참고용이며 DM에 출력하지 않는다.
 * - 13시 점심에 맞지 않는 오후 개점 안내2곳은 삭제. 남은 매장의 실시간 영업은 판정하지 않는다.
 * - 각 항목의8번째 값은 기존 선택 이력을 보존하는 고정ID이다. 순서가 바뀌어도 재사용하지 않는다.
 */
const BRIEFING_RESTAURANT_SEEDS = Object.freeze([
  [
    "예시식당 01",
    "식당",
    false,
    [
      "훈제 연어 샐러드 빅볼",
      "훈제오리 샐러드 빅볼",
      "구운 야채 샐러드 빅볼"
    ],
    "https://example.com/menu/001",
    "confirmed",
    "",
    "LUNCH_001"
  ],
  [
    "예시식당 02",
    "식당",
    false,
    [
      "참치김밥",
      "양푼 비빔밥",
      "라볶이"
    ],
    "https://example.com/menu/002",
    "confirmed",
    "",
    "LUNCH_002"
  ],
  [
    "예시식당 03",
    "식당",
    true,
    [
      "소공동순두부",
      "명란순두부",
      "육회비빔밥"
    ],
    "https://example.com/menu/003",
    "confirmed",
    "",
    "LUNCH_003"
  ],
  [
    "예시식당 04",
    "식당",
    true,
    [
      "한식뷔페"
    ],
    "https://example.com/menu/004",
    "confirmed",
    "업체 홈페이지 확인. 당일 반찬 구성은 저장하지 않음",
    "LUNCH_004"
  ],
  [
    "예시식당 05",
    "식당",
    true,
    [
      "미카츠",
      "함박 스테이크",
      "연어 츠케동"
    ],
    "https://example.com/menu/005",
    "confirmed",
    "",
    "LUNCH_005"
  ],
  [
    "예시식당 06",
    "식당",
    true,
    [
      "김치찌개",
      "된장찌개"
    ],
    "https://example.com/menu/006",
    "confirmed",
    "해당 지점 점심 방문 후기에서 확인",
    "LUNCH_006"
  ],
  [
    "예시식당 07",
    "식당",
    false,
    [
      "한식뷔페"
    ],
    "https://example.com/menu/007",
    "confirmed",
    "당일 반찬 구성은 저장하지 않음",
    "LUNCH_007"
  ],
  [
    "예시식당 08",
    "식당",
    true,
    [
      "샐러드 파스타",
      "아보카도 에그 토스트"
    ],
    "https://example.com/menu/008",
    "confirmed",
    "해당 지점 방문 후기에서 메뉴 확인",
    "LUNCH_008"
  ],
  [
    "예시식당 09",
    "식당",
    false,
    [
      "샌드위치류"
    ],
    "https://example.com/menu/009",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_009"
  ],
  [
    "예시식당 10",
    "식당",
    true,
    [
      "김치찌개",
      "된장찌개"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_010"
  ],
  [
    "예시식당 11",
    "식당",
    false,
    [
      "유니짜장면",
      "차돌짬뽕",
      "볶음밥"
    ],
    "https://example.com/menu/010",
    "confirmed",
    "",
    "LUNCH_011"
  ],
  [
    "예시식당 12",
    "식당",
    false,
    [
      "삼계탕"
    ],
    "https://example.com/menu/011",
    "confirmed",
    "근처 지점 확인된 메뉴1개만 보존. 타 지점 메뉴 혼합 안 함",
    "LUNCH_012"
  ],
  [
    "예시식당 13",
    "식당",
    true,
    [
      "치즈버거세트",
      "더블치즈버거세트",
      "트리플치즈버거세트"
    ],
    "https://example.com/menu/012",
    "confirmed",
    "",
    "LUNCH_013"
  ],
  [
    "예시식당 14",
    "식당",
    false,
    [
      "청국장 + 육회비빔밥",
      "청국장 + 생선",
      "청국장 + 제육"
    ],
    "https://example.com/menu/013",
    "confirmed",
    "",
    "LUNCH_014"
  ],
  [
    "예시식당 15",
    "식당",
    true,
    [
      "100% 사골 순대국",
      "순대국(특)"
    ],
    "https://example.com/menu/014",
    "confirmed",
    "사용자 확정 상호 유지",
    "LUNCH_015"
  ],
  [
    "예시식당 16",
    "식당",
    false,
    [
      "장어덮밥",
      "장어탕",
      "오징어덮밥"
    ],
    "https://example.com/menu/015",
    "confirmed",
    "평일 점심 메뉴에서 선택",
    "LUNCH_016"
  ],
  [
    "예시식당 17",
    "식당",
    false,
    [
      "고기 곁들인 한식류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_017"
  ],
  [
    "예시식당 18",
    "식당",
    false,
    [
      "슈퍼야채김밥",
      "무말랭이김밥",
      "달콤유부우엉김밥"
    ],
    "https://example.com/menu/016",
    "confirmed",
    "",
    "LUNCH_018"
  ],
  [
    "예시식당 19",
    "식당",
    true,
    [
      "한우국수전골 (2인 이상)",
      "소고기 국수전골 (2인 이상)"
    ],
    "https://example.com/menu/017",
    "confirmed",
    "최소 주문 인원 표기 보존",
    "LUNCH_019"
  ],
  [
    "예시식당 20",
    "식당",
    true,
    [
      "메콩세트",
      "메콩타이세트"
    ],
    "https://example.com/menu/018",
    "confirmed",
    "검색 상호 메콩타이 근처 지점",
    "LUNCH_020"
  ],
  [
    "예시식당 21",
    "식당",
    false,
    [
      "맑은 돼지곰탕",
      "매콤 낙지비빔밥",
      "들기름 메밀국수"
    ],
    "https://example.com/menu/019",
    "confirmed",
    "",
    "LUNCH_021"
  ],
  [
    "예시식당 22",
    "식당",
    false,
    [
      "빅맥 세트",
      "맥스파이시 상하이 버거 세트",
      "1955 버거 세트"
    ],
    "https://example.com/menu/020",
    "confirmed",
    "가격 수집·표시 안 함",
    "LUNCH_023"
  ],
  [
    "예시식당 23",
    "식당",
    false,
    [
      "한우 육회 비빔밥",
      "한우 국밥",
      "한우 된장찌개"
    ],
    "https://example.com/menu/021",
    "confirmed",
    "",
    "LUNCH_024"
  ],
  [
    "예시식당 24",
    "식당",
    false,
    [
      "보쌈정식",
      "바베큐불보쌈정식",
      "김치찌개"
    ],
    "https://example.com/menu/022",
    "confirmed",
    "계절 한정 굴보쌈 제외",
    "LUNCH_025"
  ],
  [
    "예시식당 25",
    "식당",
    false,
    [
      "얌샘김밥",
      "참치샐러드김밥",
      "순두부찌개와비빔밥"
    ],
    "https://example.com/menu/023",
    "confirmed",
    "한티역 근처 지점 구분",
    "LUNCH_026"
  ],
  [
    "예시식당 26",
    "식당",
    false,
    [
      "수육국밥",
      "순두부수육국밥",
      "얼큰국밥"
    ],
    "https://example.com/menu/024",
    "confirmed",
    "",
    "LUNCH_028"
  ],
  [
    "예시식당 27",
    "식당",
    false,
    [
      "짜장",
      "짬뽕",
      "볶음밥"
    ],
    "https://example.com/menu/025",
    "confirmed",
    "",
    "LUNCH_029"
  ],
  [
    "예시식당 28",
    "식당",
    false,
    [
      "육회비빔밥",
      "우삼겹비빔밥",
      "삼겹비빔밥"
    ],
    "https://example.com/menu/026",
    "confirmed",
    "",
    "LUNCH_030"
  ],
  [
    "예시식당 29",
    "식당",
    false,
    [
      "멸치칼국수",
      "바지락칼국수",
      "사골칼국수"
    ],
    "https://example.com/menu/027",
    "confirmed",
    "여름 한정 서리태콩국수 제외",
    "LUNCH_031"
  ],
  [
    "예시식당 30",
    "식당",
    false,
    [
      "샤브로21 샤브샤브",
      "얼큰 샤브샤브",
      "미소 샤브샤브"
    ],
    "https://example.com/menu/028",
    "confirmed",
    "공식 지점 안내의 영동대로86길27과 대조",
    "LUNCH_032"
  ],
  [
    "예시식당 31",
    "식당",
    false,
    [
      "바스버거",
      "크런치 치킨버거",
      "스리라차 치즈버거"
    ],
    "https://example.com/menu/029",
    "confirmed",
    "",
    "LUNCH_033"
  ],
  [
    "예시식당 32",
    "식당",
    true,
    [
      "삼선짬뽕",
      "유니짜장면",
      "새우볶음밥"
    ],
    "https://example.com/menu/030",
    "confirmed",
    "근처 지점 매장. 성동구 동명 상호와 구분",
    "LUNCH_034"
  ],
  [
    "예시식당 33",
    "식당",
    false,
    [
      "로스까스(등심)",
      "히레까스(안심)",
      "돈까스카레"
    ],
    "https://example.com/menu/031",
    "confirmed",
    "근처 지점 매장. 예술의전당 본점과 구분",
    "LUNCH_035"
  ],
  [
    "예시식당 34",
    "식당",
    false,
    [
      "고기구이류"
    ],
    "https://example.com/menu/032",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_036"
  ],
  [
    "예시식당 35",
    "식당",
    false,
    [
      "칼국수류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_037"
  ],
  [
    "예시식당 36",
    "식당",
    true,
    [
      "얼큰탄탄면",
      "큐브스테이크덮밥",
      "연어덮밥"
    ],
    "https://example.com/menu/033",
    "confirmed",
    "",
    "LUNCH_038"
  ],
  [
    "예시식당 37",
    "식당",
    false,
    [
      "닭가슴살 샐러드",
      "목살스테이크 샐러드",
      "닭다리살 포케"
    ],
    "https://example.com/menu/034",
    "confirmed",
    "",
    "LUNCH_039"
  ],
  [
    "예시식당 38",
    "식당",
    false,
    [
      "징거",
      "징거타워"
    ],
    "https://example.com/menu/035",
    "confirmed",
    "단품으로 확인. 세트 여부 추측 안 함",
    "LUNCH_040"
  ],
  [
    "예시식당 39",
    "식당",
    false,
    [
      "기본카레",
      "믹스카츠카레"
    ],
    "https://example.com/menu/036",
    "confirmed",
    "메뉴 목록과 해당 근처 지점 매장 후기 확인. 신림점 제외",
    "LUNCH_041"
  ],
  [
    "예시식당 40",
    "식당",
    false,
    [
      "야채김밥",
      "참치김밥",
      "제육정식"
    ],
    "https://example.com/menu/037",
    "confirmed",
    "이름에 카페가 있으나 식당",
    "LUNCH_042"
  ],
  [
    "예시식당 41",
    "식당",
    false,
    [
      "소고기 쌀국수 S",
      "나시고랭",
      "팟타이"
    ],
    "https://example.com/menu/038",
    "confirmed",
    "영동대로106길33 매장",
    "LUNCH_043"
  ],
  [
    "예시식당 42",
    "식당",
    true,
    [
      "장어 솥밥",
      "스테이크 솥밥",
      "가지 솥밥"
    ],
    "https://example.com/menu/039",
    "confirmed",
    "",
    "LUNCH_044"
  ],
  [
    "예시식당 43",
    "식당",
    false,
    [
      "오사리멸치국수",
      "오사리멸치칼국수",
      "수제비보쌈정식"
    ],
    "https://example.com/menu/040",
    "confirmed",
    "사용자 상호 유지. 검색 상호 류창희국수 근처 지점",
    "LUNCH_045"
  ],
  [
    "예시식당 44",
    "식당",
    false,
    [
      "누룽지정식",
      "제육볶음",
      "돼지불고기"
    ],
    "https://example.com/menu/041",
    "confirmed",
    "근처 지점 매장 메뉴 기준",
    "LUNCH_046"
  ],
  [
    "예시식당 45",
    "식당",
    true,
    [
      "한식뷔페"
    ],
    "https://example.com/menu/042",
    "confirmed",
    "사용자 정정 반영. 근처 지점 매장 기준, 당일 반찬 미수집",
    "LUNCH_047"
  ],
  [
    "예시식당 46",
    "식당",
    true,
    [
      "부대찌개",
      "부대전골"
    ],
    "https://example.com/menu/043",
    "confirmed",
    "",
    "LUNCH_048"
  ],
  [
    "예시식당 47",
    "식당",
    false,
    [
      "육전소고기국밥",
      "소고기국밥",
      "미소곰탕"
    ],
    "https://example.com/menu/044",
    "confirmed",
    "",
    "LUNCH_049"
  ],
  [
    "예시식당 48",
    "식당",
    false,
    [
      "순대국밥류"
    ],
    "https://example.com/menu/045",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_050"
  ],
  [
    "예시식당 49",
    "식당",
    false,
    [
      "에그마요",
      "로티세리 바비큐 치킨",
      "이탈리안 비엠티"
    ],
    "https://example.com/menu/046",
    "confirmed",
    "",
    "LUNCH_051"
  ],
  [
    "예시식당 50",
    "식당",
    true,
    [
      "로스가츠 정식",
      "히레가츠 정식",
      "치즈가츠 정식"
    ],
    "https://example.com/menu/047",
    "confirmed",
    "",
    "LUNCH_052"
  ],
  [
    "예시식당 51",
    "식당",
    false,
    [
      "탄탄멘",
      "돈코츠라멘"
    ],
    "https://example.com/menu/048",
    "confirmed",
    "근처 지점 점심 메뉴만 선택",
    "LUNCH_053"
  ],
  [
    "예시식당 52",
    "식당",
    false,
    [
      "순두부찌개",
      "해물된장찌개",
      "고향쌈밥"
    ],
    "https://example.com/menu/049",
    "confirmed",
    "",
    "LUNCH_054"
  ],
  [
    "예시식당 53",
    "식당",
    false,
    [
      "로스트닭다리살 샐러디 세트",
      "우삼겹 메밀 누들볼 세트",
      "칠리베이컨 포케볼 세트"
    ],
    "https://example.com/menu/050",
    "confirmed",
    "",
    "LUNCH_055"
  ],
  [
    "예시식당 54",
    "식당",
    false,
    [
      "한식뷔페"
    ],
    "https://example.com/menu/051",
    "confirmed",
    "사용자 추가. 식사 유형만 확인, 당일 반찬은 추측하지 않음",
    "LUNCH_056"
  ],
  [
    "예시카페 01",
    "카페",
    false,
    [
      "샌드위치·베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_057"
  ],
  [
    "예시카페 02",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_058"
  ],
  [
    "예시카페 03",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_059"
  ],
  [
    "예시카페 04",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_060"
  ],
  [
    "예시카페 05",
    "카페",
    false,
    [
      "샌드위치류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_061"
  ],
  [
    "예시카페 06",
    "카페",
    false,
    [
      "샌드위치류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_062"
  ],
  [
    "예시카페 07",
    "카페",
    false,
    [
      "카페 간단식류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_063"
  ],
  [
    "예시카페 08",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_064"
  ],
  [
    "예시카페 09",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_065"
  ],
  [
    "예시카페 10",
    "카페",
    false,
    [
      "카페 간단식류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_066"
  ],
  [
    "예시카페 11",
    "카페",
    false,
    [
      "샌드위치·베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_067"
  ],
  [
    "예시카페 12",
    "카페",
    false,
    [
      "카페 간단식류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_068"
  ],
  [
    "예시카페 13",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_069"
  ],
  [
    "예시카페 14",
    "카페",
    false,
    [
      "샌드위치류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_070"
  ],
  [
    "예시카페 15",
    "카페",
    false,
    [
      "카페 간단식류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_071"
  ],
  [
    "예시카페 16",
    "카페",
    false,
    [
      "베이커리류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_072"
  ],
  [
    "예시편의점 01",
    "편의점",
    false,
    [
      "도시락·김밥류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_073"
  ],
  [
    "예시편의점 02",
    "편의점",
    false,
    [
      "도시락류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_074"
  ],
  [
    "예시편의점 03",
    "편의점",
    false,
    [
      "김밥류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_075"
  ],
  [
    "예시편의점 04",
    "편의점",
    false,
    [
      "도시락·샌드위치류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_076"
  ],
  [
    "예시편의점 05",
    "편의점",
    false,
    [
      "김밥·도시락류"
    ],
    "",
    "approximate",
    "사용자 허용에 따른 음식 종류 기반 제안. 실제 메뉴·상품·재고 미확인",
    "LUNCH_077"
  ]
]);

const BRIEFING_LUNCH_REMOVED_NAMES = Object.freeze(["삭제된예시 1","삭제된예시 2"]);

const BRIEFING_LUNCH_COPY = Object.freeze({
  "예시식당 01": {
    "cuisine": "샐러드",
    "text": "오늘은 산뜻한 샐러드 한 그릇 어때요?",
    "basis": "public-menu"
  },
  "예시식당 02": {
    "cuisine": "분식",
    "text": "김밥에 라볶이 곁들여 든든하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 03": {
    "cuisine": "한식",
    "text": "보글보글 순두부찌개로 속부터 데워볼까요?",
    "basis": "public-menu"
  },
  "예시식당 04": {
    "cuisine": "한식뷔페",
    "text": "먹고 싶은 반찬 골라 한식뷔페 한 상 어때요?",
    "basis": "public-menu"
  },
  "예시식당 05": {
    "cuisine": "일식",
    "text": "바삭한 돈카츠로 점심 기분 전환 어때요?",
    "basis": "public-menu"
  },
  "예시식당 06": {
    "cuisine": "한식",
    "text": "뜨끈한 김치찌개나 된장찌개 한 그릇 어때요?",
    "basis": "public-menu"
  },
  "예시식당 07": {
    "cuisine": "한식뷔페",
    "text": "반찬 고민 없이 한식뷔페로 든든하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 08": {
    "cuisine": "브런치",
    "text": "샐러드와 토스트로 가볍게 점심 어때요?",
    "basis": "public-menu"
  },
  "예시식당 09": {
    "cuisine": "샌드위치",
    "text": "오늘은 샌드위치로 간편하게 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시식당 10": {
    "cuisine": "한식",
    "text": "오늘 뜨끈한 김치찌개나 된장찌개 어때요?",
    "basis": "category-suggestion"
  },
  "예시식당 11": {
    "cuisine": "중식",
    "text": "짜장면이냐 짬뽕이냐, 오늘은 중식 어때요?",
    "basis": "public-menu"
  },
  "예시식당 12": {
    "cuisine": "한식",
    "text": "따끈한 삼계탕 한 그릇으로 든든하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 13": {
    "cuisine": "버거",
    "text": "치즈 듬뿍 버거로 점심 기분 좀 낼까요?",
    "basis": "public-menu"
  },
  "예시식당 14": {
    "cuisine": "한식",
    "text": "구수한 청국장으로 집밥 같은 점심 어때요?",
    "basis": "public-menu"
  },
  "예시식당 15": {
    "cuisine": "국밥",
    "text": "뜨끈한 순대국밥 한 그릇 어때요?",
    "basis": "public-menu"
  },
  "예시식당 16": {
    "cuisine": "한식",
    "text": "장어덮밥으로 오후까지 든든하게 가볼까요?",
    "basis": "public-menu"
  },
  "예시식당 17": {
    "cuisine": "한식",
    "text": "고기 곁들인 든든한 한식 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시식당 18": {
    "cuisine": "분식",
    "text": "재료 꽉 찬 김밥으로 간편하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 19": {
    "cuisine": "전골",
    "text": "따끈한 국수전골 같이 나눠 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 20": {
    "cuisine": "동남아식",
    "text": "오늘은 동남아식으로 점심 분위기를 바꿔볼까요?",
    "basis": "public-menu"
  },
  "예시식당 21": {
    "cuisine": "한식",
    "text": "맑은 돼지곰탕으로 따뜻하게 속을 채울까요?",
    "basis": "public-menu"
  },
  "예시식당 22": {
    "cuisine": "버거",
    "text": "익숙한 버거 세트로 간편하게 점심 어때요?",
    "basis": "public-menu"
  },
  "예시식당 23": {
    "cuisine": "한식",
    "text": "육회비빔밥이나 한우국밥으로 든든하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 24": {
    "cuisine": "한식",
    "text": "보쌈정식으로 밥 한 공기 든든하게 어때요?",
    "basis": "public-menu"
  },
  "예시식당 25": {
    "cuisine": "분식",
    "text": "김밥부터 따뜻한 식사까지, 오늘은 분식 어때요?",
    "basis": "public-menu"
  },
  "예시식당 26": {
    "cuisine": "국밥",
    "text": "뜨끈한 수육국밥 한 그릇으로 채워볼까요?",
    "basis": "public-menu"
  },
  "예시식당 27": {
    "cuisine": "중식",
    "text": "짜장면이나 볶음밥으로 중식 한 끼 어때요?",
    "basis": "public-menu"
  },
  "예시식당 28": {
    "cuisine": "한식",
    "text": "육회나 우삼겹 비빔밥 쓱쓱 비벼 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 29": {
    "cuisine": "국수",
    "text": "따끈한 칼국수 한 그릇으로 속을 풀까요?",
    "basis": "public-menu"
  },
  "예시식당 30": {
    "cuisine": "샤브샤브",
    "text": "따뜻한 국물에 채소 듬뿍, 샤브샤브 어때요?",
    "basis": "public-menu"
  },
  "예시식당 31": {
    "cuisine": "버거",
    "text": "수제버거로 오늘 점심에 작은 변화를 줄까요?",
    "basis": "public-menu"
  },
  "예시식당 32": {
    "cuisine": "중식",
    "text": "짬뽕이나 볶음밥으로 중식 한 끼 어때요?",
    "basis": "public-menu"
  },
  "예시식당 33": {
    "cuisine": "일식",
    "text": "바삭한 돈까스로 점심 기분 전환 어때요?",
    "basis": "public-menu"
  },
  "예시식당 34": {
    "cuisine": "한식",
    "text": "오늘은 고기 곁들인 든든한 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시식당 35": {
    "cuisine": "국수",
    "text": "따끈한 칼국수 한 그릇 어때요?",
    "basis": "category-suggestion"
  },
  "예시식당 36": {
    "cuisine": "일식",
    "text": "탄탄면이나 덮밥으로 든든한 점심 어때요?",
    "basis": "public-menu"
  },
  "예시식당 37": {
    "cuisine": "샐러드",
    "text": "샐러드나 포케로 산뜻하게 한 끼 어때요?",
    "basis": "public-menu"
  },
  "예시식당 38": {
    "cuisine": "치킨·버거",
    "text": "치킨버거로 바삭한 점심 한 끼 어때요?",
    "basis": "public-menu"
  },
  "예시식당 39": {
    "cuisine": "카레",
    "text": "따뜻한 카레 한 접시로 든든하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 40": {
    "cuisine": "분식",
    "text": "김밥이나 제육정식으로 부담 없이 골라볼까요?",
    "basis": "public-menu"
  },
  "예시식당 41": {
    "cuisine": "베트남식",
    "text": "뜨끈한 쌀국수로 점심 속풀이 어때요?",
    "basis": "public-menu"
  },
  "예시식당 42": {
    "cuisine": "솥밥",
    "text": "따뜻한 솥밥 한 그릇으로 여유 있게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 43": {
    "cuisine": "국수",
    "text": "따끈한 멸치국수나 칼국수 어때요?",
    "basis": "public-menu"
  },
  "예시식당 44": {
    "cuisine": "한식",
    "text": "제육볶음으로 밥 한 공기 든든하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 45": {
    "cuisine": "한식뷔페",
    "text": "좋아하는 반찬 골라 한식 한 상 어때요?",
    "basis": "public-menu"
  },
  "예시식당 46": {
    "cuisine": "한식",
    "text": "보글보글 부대찌개로 든든한 점심 어때요?",
    "basis": "public-menu"
  },
  "예시식당 47": {
    "cuisine": "국밥",
    "text": "따끈한 국밥 한 그릇으로 오후를 준비할까요?",
    "basis": "public-menu"
  },
  "예시식당 48": {
    "cuisine": "국밥",
    "text": "뜨끈한 순대국밥 어때요?",
    "basis": "category-suggestion"
  },
  "예시식당 49": {
    "cuisine": "샌드위치",
    "text": "내 취향대로 샌드위치 한 끼 어때요?",
    "basis": "public-menu"
  },
  "예시식당 50": {
    "cuisine": "일식",
    "text": "돈가츠 정식으로 든든하게 점심 어때요?",
    "basis": "public-menu"
  },
  "예시식당 51": {
    "cuisine": "일식",
    "text": "뜨끈한 라멘 한 그릇으로 속을 채울까요?",
    "basis": "public-menu"
  },
  "예시식당 52": {
    "cuisine": "한식",
    "text": "따뜻한 찌개나 쌈밥으로 한 끼 어때요?",
    "basis": "public-menu"
  },
  "예시식당 53": {
    "cuisine": "샐러드",
    "text": "채소 듬뿍 샐러드나 포케로 산뜻하게 먹을까요?",
    "basis": "public-menu"
  },
  "예시식당 54": {
    "cuisine": "한식뷔페",
    "text": "집밥 생각나는 날, 한식뷔페 한 상 어때요?",
    "basis": "public-menu"
  },
  "예시카페 01": {
    "cuisine": "카페 간단식",
    "text": "샌드위치나 베이커리로 가볍게 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시카페 02": {
    "cuisine": "카페 간단식",
    "text": "간단히 먹을 빵과 함께 가벼운 점심 어때요?",
    "basis": "category-suggestion"
  },
  "예시카페 03": {
    "cuisine": "카페 간단식",
    "text": "바쁜 날엔 간단한 빵으로 가볍게 챙겨볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 04": {
    "cuisine": "베이커리",
    "text": "오늘은 빵으로 가볍게 점심을 바꿔볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 05": {
    "cuisine": "카페 간단식",
    "text": "샌드위치로 간편하게 한 끼 챙겨볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 06": {
    "cuisine": "카페 간단식",
    "text": "샌드위치로 가볍게 점심 어때요?",
    "basis": "category-suggestion"
  },
  "예시카페 07": {
    "cuisine": "카페 간단식",
    "text": "오늘은 카페에서 간단히 먹을 것을 골라볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 08": {
    "cuisine": "카페 간단식",
    "text": "빵과 함께 간편한 점심 어때요?",
    "basis": "category-suggestion"
  },
  "예시카페 09": {
    "cuisine": "카페 간단식",
    "text": "간단한 베이커리로 가볍게 챙겨볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 10": {
    "cuisine": "카페 간단식",
    "text": "바쁜 점심엔 카페 간단식으로 챙겨볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 11": {
    "cuisine": "베이커리",
    "text": "샌드위치나 빵으로 가볍게 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시카페 12": {
    "cuisine": "카페 간단식",
    "text": "오늘은 카페에서 간단히 먹을 것을 골라볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 13": {
    "cuisine": "카페 간단식",
    "text": "간단한 빵으로 점심을 가볍게 챙겨볼까요?",
    "basis": "category-suggestion"
  },
  "예시카페 14": {
    "cuisine": "카페 간단식",
    "text": "오늘은 샌드위치로 간편하게 먹을까요?",
    "basis": "category-suggestion"
  },
  "예시카페 15": {
    "cuisine": "카페 간단식",
    "text": "가볍게 먹고 싶은 날엔 카페 간단식 어때요?",
    "basis": "category-suggestion"
  },
  "예시카페 16": {
    "cuisine": "카페 간단식",
    "text": "간단한 빵과 함께 짧은 점심 어때요?",
    "basis": "category-suggestion"
  },
  "예시편의점 01": {
    "cuisine": "편의점 간단식",
    "text": "도시락이나 김밥으로 간편하게 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시편의점 02": {
    "cuisine": "편의점 간단식",
    "text": "오늘은 편의점 도시락으로 간편하게 먹을까요?",
    "basis": "category-suggestion"
  },
  "예시편의점 03": {
    "cuisine": "편의점 간단식",
    "text": "김밥에 간단한 한 가지 곁들여 먹을까요?",
    "basis": "category-suggestion"
  },
  "예시편의점 04": {
    "cuisine": "편의점 간단식",
    "text": "도시락이나 샌드위치로 빠르게 한 끼 어때요?",
    "basis": "category-suggestion"
  },
  "예시편의점 05": {
    "cuisine": "편의점 간단식",
    "text": "김밥이나 도시락으로 간편하게 챙겨볼까요?",
    "basis": "category-suggestion"
  }
});
