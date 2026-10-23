/**
 * 13. 담당탭읽기
 * - 역할: 담당자 탭 상단의 배치·상태·일정 해석
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 13-01. 담당 탭 상단 해석 [내부]
 * - collectPilotDashboard_(top): 이미 읽어온 상단6행에서 언어쌍·프로젝트·A/B배치·상태·목표일 레코드를 만든다.
 */

/**
 * 모든 PM 담당 탭의 상단 A/B 배치를 해석하는 공통 파서.
 * 구형 개인 원천 미리보기는 제거했지만 수집 파서는 현재 파이프라인이 사용한다.
 */


function collectPilotDashboard_(top) {
  const grouped = new Map();
  let pair = '';
  let projectId = '';
  for (let col = 7; col < top[0].length; col++) {
    const marker = String(top[1][col] || '').trim();
    if (marker && marker !== 'A' && marker !== 'B') {
      pair = marker;
      projectId = '';
      continue;
    }
    if (marker !== 'A' && marker !== 'B') continue;
    const cellProject = String(top[0][col] || '').trim();
    if (marker === 'A') projectId = cellProject;
    else if (cellProject) projectId = cellProject;
    const stage = String(top[3][col] || '').trim();
    const status = String(top[4][col] || '').trim();
    const targetEnd = String(top[5][col] || '').trim();
    if (!pair || !stage || !status) continue;
    const key = [pair, projectId, stage, status, targetEnd].join('\u001f');
    if (!grouped.has(key)) {
      grouped.set(key, { pair, projectId, stage, status, targetEnd, batches: [], firstColumn: col + 1 });
    }
    grouped.get(key).batches.push(marker);
  }
  return [...grouped.values()];
}
