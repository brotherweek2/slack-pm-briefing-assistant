/**
 * 연결 앱 03. 일정과할일수집 — 캘린더 4개(개인·Schedule·Review & Delivery·휴일) 읽기
 *
 * 알아둘 것
 * - Google Tasks는 읽지 않는다.
 *
 * 내부 함수 (직접 실행하지 않음)
 * - connectorCollectSources_(email, now): 각 원천을 따로 읽고 성공/실패 상태와 최소 필드만 반환
 * - connectorResolveCalendar_(spec): 관리자 고정 ID 우선, 없으면 정확한 이름으로 유일 항목만 선택
 * - connectorReadCalendar_(calendar, source, email, now): 개인 일정·공유 본인 초대/생성 일정만
 */
function connectorCollectSources_(email, now) {
  const day = Utilities.formatDate(now,'Asia/Seoul','yyyy-MM-dd');
  const sources = [], collected = [];
  const specs = [
    {key:'personal',label:'개인 캘린더'},
    {key:'schedule',label:'PM Team Schedule',property:'CONNECTOR_TEAM_CALENDAR_ID',names:['PM Team Schedule']},
    {key:'review',label:'PM Review & Delivery',property:'CONNECTOR_REVIEW_CALENDAR_ID',names:['PM Review & Delivery','PM Review&Delivery']},
    {key:'holidays',label:'대한민국의 휴일',property:'CONNECTOR_HOLIDAY_CALENDAR_ID',names:['대한민국의 휴일','대한민국 휴일','Holidays in South Korea']}
  ];
  specs.forEach(spec => {
    try {
      const calendar = spec.key === 'personal' ? CalendarApp.getDefaultCalendar() : connectorResolveCalendar_(spec);
      if (!calendar || (spec.key === 'personal' && String(calendar.getId()).toLowerCase() !== email)) throw new Error('UNAVAILABLE');
      const snapshot = connectorReadCalendar_(calendar,spec.key,email,now);
      collected.push(snapshot);
      sources.push({key:spec.key,status:'ok',count:snapshot.events.length});
    } catch (_) { sources.push({key:spec.key,status:'unavailable',count:0}); }
  });
  // 개인 캘린더를 읽지 못하면 잘못된 실행 계정일 수 있으므로 중앙 갱신하지 않는다.
  if (!sources.some(s=>s.key==='personal'&&s.status==='ok')) throw new Error('본인 캘린더 접근 실패');
  const blocked = new Set(collected.flatMap(s=>s.declinedKeys||[]));
  const events = new Map();
  collected.forEach(snapshot=>snapshot.events.forEach(event=>{
    if (!blocked.has(event.key) && !events.has(event.key)) events.set(event.key,event);
  }));
  if (events.size>150) throw new Error('일정 수집 상한 초과');
  return {day,sources,events:[...events.values()].sort((a,b)=>a.start-b.start||a.title.localeCompare(b.title))};
}

function connectorResolveCalendar_(spec) {
  const id = PropertiesService.getScriptProperties().getProperty(spec.property);
  if (id) {
    const calendar = CalendarApp.getCalendarById(id);
    if (!calendar) throw new Error('ID_UNAVAILABLE');
    return calendar;
  }
  const normalize = name=>String(name).toLowerCase().replace(/\s/g,'');
  const names = spec.names.map(normalize);
  const matches = CalendarApp.getAllCalendars().filter(calendar=>names.includes(normalize(calendar.getName())));
  if (matches.length !== 1) throw new Error('NAME_MISSING_OR_DUPLICATE');
  return matches[0];
}

function connectorReadCalendar_(calendar, source, email, now) {
  const audiences = new Map();
  const wrapper = {getEvents:(start,end)=>calendar.getEvents(start,end).filter(event=>{
    const key = event.getId()+'|'+event.getStartTime().getTime();
    if (source === 'personal') {audiences.set(key,'personal');return true;}
    if (source === 'holidays') {audiences.set(key,'common');return true;}
    const guest = event.getGuestByEmail(email);
    const creators = typeof event.getCreators === 'function' ? event.getCreators() : [];
    const own = !!guest || creators.some(creator=>String(creator).toLowerCase()===email);
    if (own) {audiences.set(key,'personal');return true;}
    // 참석자가 없다는 이유만으로 본인 업무로 추정하지 않는다. 타인 휴가·팀 공통 검수/납품 제외.
    return false;
  })};
  const result = collectMyCalendarEvents_(wrapper,now,{account:email,days:2,ownerCalendar:true});
  result.events=result.events.map(event=>({...event,source,audience:audiences.get(event.key)}));
  return result;
}
