import { COUNTRIES } from './world.mjs';
import { COUNTRY_REFERENCE_META, getCountryReference } from './public-country-data.mjs';

// Read-only presentation. No RNG, mortality calculation, future cohort simulation,
// save migration or inference about the player's real identity occurs here.
const AGES = [5, 15, 30, 50, 70];
const countryName = id => COUNTRIES.find(country => country.id === id)?.name ?? '국가 기록 없음';
const number = value => Number(value.toFixed(2)).toLocaleString('ko-KR');
const OBSERVED_QUESTIONS = [
  {
    question: name => `다섯 살 ${name}에게 지금 가장 필요한 것은 무엇일까요?`,
    placeholder: '함께 있어 줄 사람이나 지금 필요한 것을 적어 보세요.',
    evidence: 'docs/evidence/reference-ui-2026-10-14/desktop-reflection-age-five.json',
  },
  {
    question: () => '당신의 다섯 살 무렵에는 어떤 것이 익숙했나요? 지금 떠오르는 기억을 남겨 보세요.',
    placeholder: '그때 익숙했던 사람, 장소, 하루의 모습을 적어 보세요.',
    evidence: 'docs/evidence/independent-final-2026-10-14T1258Z/2026-10-14T13-02-01-365Z/20-reference-desktop-reflection.json',
  },
];
const AUTHORED_QUESTIONS = {
  15: ['앞으로 배우거나 경험해 보고 싶은 것은 무엇인가요?', '지금 관심이 가는 일과 아직 망설이는 일을 적어 보세요.'],
  30: ['지금의 생활에서 계속 지키고 싶은 것과 바꾸고 싶은 것은 무엇인가요?', '지금 중요하게 여기는 것부터 적어 보세요.'],
  50: ['지나온 선택 중 오래 기억하고 싶은 순간은 무엇인가요?', '기억에 남은 사람이나 선택, 앞으로의 바람을 적어 보세요.'],
  70: ['지금까지의 삶에서 다음 시간에 남기고 싶은 이야기는 무엇인가요?', '소중했던 순간이나 아직 하고 싶은 일을 적어 보세요.'],
};

function referenceView(state, id) {
  const base = { countryId: id, countryName: countryName(id), status: 'unavailable', referenceYear: null, source: null, snapshotId: state.flags?.countryReferenceSnapshot ?? null, indicators: null, underFiveMortalityPercent: null, summary: '' };
  if (state.mode !== 'present' || state.birthYear !== 2026) {
    return { ...base, status: 'unsupported_period', summary: `${base.countryName}: 이 출생 시대에 맞는 공개 통계는 연결하지 않았습니다.` };
  }
  if (!base.snapshotId) return { ...base, status: 'not_recorded', summary: `${base.countryName}: 이 저장에는 공개 국가 자료 버전이 기록되지 않았습니다.` };
  if (base.snapshotId !== COUNTRY_REFERENCE_META.id) return { ...base, status: 'unknown_snapshot', summary: `${base.countryName}: 이 저장의 국가 자료 버전을 현재 화면에서 확인할 수 없습니다.` };
  const reference = getCountryReference(id, state.mode, state.birthYear);
  if (!reference) return { ...base, summary: `${base.countryName}: 공개 통계 자료가 없습니다.` };
  const indicators = structuredClone(reference.indicators);
  const u5 = indicators.underFiveMortality;
  const percent = Number.isFinite(u5?.value) ? u5.value / 10 : null;
  const available = Object.values(indicators).some(indicator => Number.isFinite(indicator.value));
  return {
    ...base, status: available ? 'available' : 'unavailable', referenceYear: reference.referenceYear,
    source: reference.source, indicators, underFiveMortalityPercent: percent,
    summary: percent === null
      ? `${base.countryName}: ${reference.referenceYear}년 자료에서 5세 미만 사망률은 확인되지 않았습니다.`
      : `${base.countryName}의 ${u5.year}년 5세 미만 사망률은 출생아 1,000명당 ${number(u5.value)}명입니다(백분율 환산 ${number(percent)}%).`,
  };
}

function cohortView(person) {
  const ended = person.status === 'ended' || person.alive === false;
  const age = Number.isInteger(person.age) ? person.age : null;
  let summary;
  if (ended) {
    // A legacy living person's preassigned lifespan is never disclosed or treated
    // as a real event. Ended people use only the observed death/current age.
    const deathAge = Number.isInteger(person.deathAge) ? person.deathAge : age;
    summary = deathAge === null ? '삶을 마친 것으로 기록되어 있습니다.' : `${deathAge}세에 삶을 마쳤습니다.`;
  } else if (person.career?.retired === true) summary = '은퇴 후의 시간을 보내고 있습니다.';
  else if (person.education?.yearsLeft > 0) summary = person.education.level === 'undergraduate' ? '대학 과정을 이어 가고 있습니다.' : '기록된 학업 과정을 이어 가고 있습니다.';
  else if (person.career?.jobId) summary = `${person.career.title || '기록된 직업'} 일을 하고 있습니다.`;
  else if (age !== null && age < 18 && ['primary', 'secondary', 'highschool'].includes(person.education?.level)) {
    summary = `${{ primary: '초등', secondary: '중등', highschool: '고등' }[person.education.level]} 교육을 이어 가고 있습니다.`;
  } else if (age !== null && age < 6 && person.education?.level === 'none') summary = '정규 학교 과정을 시작하기 전입니다.';
  else if (person.career?.jobId === null) summary = '현재 직업은 기록되어 있지 않습니다.';
  else summary = '현재 생활의 세부 기록이 없습니다.';
  return { id: person.id, name: person.name, countryId: person.countryId, countryName: countryName(person.countryId), age, status: ended ? 'ended' : 'alive', summary, source: 'rule', synthetic: true };
}

/** Pure current-state projection; returns null for story memories and ended lives. */
export function getReflectionView(state) {
  const pending = state?.pending;
  if (state?.status !== 'alive' || !AGES.includes(state.age) || pending?.kind !== 'reflection' || pending.structure !== `milestone-reflection:${state.age}` || pending.id !== `${state.lifeId}:reflection:${state.age}`) return null;
  const observed = state.age === 5 ? OBSERVED_QUESTIONS[(state.seed >>> 0) % OBSERVED_QUESTIONS.length] : null;
  const birth = referenceView(state, state.birthCountryId);
  const comparison = state.settings?.comparisonCountry ? referenceView(state, state.settings.comparisonCountry) : null;
  const cohort = (state.cohort || []).map(cohortView);
  const context = state.age === 5
    ? [birth.summary, comparison?.summary].filter(Boolean).join(' ')
    : `${countryName(state.birthCountryId)}에서 태어난 뒤 ${state.age}년의 시간이 흘렀습니다. 공개 국가 자료는 2023년 참고값이며 이 인물의 남은 수명을 뜻하지 않습니다.`;
  const limitations = [
    '공개 국가 통계는 게임의 개인 생존 확률이나 동기 사망률이 아닙니다. 2023년 참고값을 현재 장면의 관측값으로 바꾸지 않습니다.',
    '동기 근황은 이 게임에 저장된 합성 인물의 현재 기록입니다. 미래 결과를 계산하지 않습니다.',
  ];
  if (!observed) limitations.push('이 나이의 질문은 자체 작성 문구입니다. 원작의 같은 나이 회고 문구는 확인하지 않았습니다.');
  if (!comparison) limitations.push('비교 국가는 선택되지 않았습니다. 플레이어의 실제 국가를 추정하지 않습니다.');
  if (birth.status !== 'available') limitations.push(birth.summary);
  if (comparison && comparison.status !== 'available') limitations.push(comparison.summary);
  return {
    decisionId: pending.id, age: state.age, year: state.year, title: `${state.name}, ${state.age}세`,
    intro: context,
    question: observed ? observed.question(state.name) : AUTHORED_QUESTIONS[state.age][0],
    placeholder: observed ? observed.placeholder : AUTHORED_QUESTIONS[state.age][1],
    questionSource: observed ? 'observed_adaptation' : 'authored',
    questionEvidence: observed ? [observed.evidence] : [],
    cohortSummary: cohort.length ? cohort.map(person => `${person.name} · ${person.countryName}: ${person.summary}`).join('\n') : '이 저장에는 동기 근황이 없습니다.',
    cohort, statistics: { birth, comparison }, limitations,
  };
}
