/**
 * 13. 담당탭읽기 — 예전 양식 담당 탭 상단(배치·상태·목표 종료일) 해석
 *
 * 알아둘 것
 * - 새 양식 담당 탭은 06번 파일의 collectPmTabProjects_가 읽는다.
 *
 * 내부 함수 (직접 실행하지 않음)
 * - collectPilotDashboard_(top): 이미 읽어온 상단6행에서 언어쌍·프로젝트·A/B배치·상태·목표일 레코드를 만든다
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
