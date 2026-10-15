import { FOCUS_IDS, focusAvailable, focusStage, recordManualFocus, reconcileFocus } from './focus.mjs';
import { validAdultLifeFacts } from './adult-life.mjs';
import { validateCareerInterests } from './career-interest.mjs';
import { COUNTRIES, getCountry, getEnvironment, drawBirthCountry, INVESTMENTS, HOBBIES } from './world.mjs';
import { getSystemActions, applySystemAction, advanceSystems } from './systems.mjs';
import { getStoryDecision, resolveStoryDecision, advanceWorld, makeCohort, projectCohort, initializeLifeFlow } from './content.mjs';
import { DEMOGRAPHIC_META, referenceDistribution } from './demographics.mjs';
import { COUNTRY_REFERENCE_META } from './public-country-data.mjs';
import { initializeBirthIdentity, validBirthIdentity, getResidenceLabel } from './identity.mjs';
import { clamp, random, pick, log, person } from './shared.mjs';

// Independent, synthetic game rules. No probability below is an original-game
// probability, medical prediction, or a country's measured population statistic.
const STAT_KEYS = ['health', 'happiness', 'knowledge', 'social', 'energy'];
const MONEY_KEYS = ['cash', 'debt', 'assets', 'homeValue', 'mortgage', 'annualIncome', 'annualExpense', 'tax'];
const FOCUSES = FOCUS_IDS;
const MAX_MONEY = 1_000_000_000_000;
const MAX_TOTAL = MAX_MONEY * 8;
const MAX_AGE = 110;
const REFLECTION_AGES = [5, 15, 30, 50, 70];
const SPEEDS = [0.5, 1, 2, 4, 8, 12, 16];
const TARGET_MINUTES = [null, 30, 60, 90];
const CAMPAIGN_STATUSES = ['preparing', 'pending', 'approved', 'rejected', 'cancelled', 'elected', 'defeated', 'interrupted'];
const LIFE_FIELDS = new Set('schemaVersion lifeId version seed rng provenance name gender birthYear year age status countryId birthCountryId city household mode weighting stats focus education career finance family health hobbies politics migration automations settings pending seen flags history historyMarks timeline cohort notes goals receipts ending'.split(' '));
const COMMAND_FIELDS = {
  advance: ['years', 'untilDecision'], choose: ['decisionId', 'choiceId'],
  action: ['actionId', 'value', 'targetId'], set: ['key', 'value'],
  note: ['text', 'noteId'], goal: ['text', 'steps'], cancelGoal: ['goalId'],
  reflect: ['decisionId', 'text', 'auto', 'reflectionStops'],
  markHistory: ['historyId', 'marked'],
};
const fail = (state, error, message) => ({ ok: false, state, error, message });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const assert = (test, message) => { if (!test) throw new TypeError(message); };
const isReflection = state => state.pending?.kind === 'reflection' && state.pending.structure === `milestone-reflection:${state.age}`;

function seedNumber(input) {
  if (input === undefined) {
    const values = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(values)[0];
    return Date.now() >>> 0;
  }
  assert(typeof input === 'string' || (typeof input === 'number' && Number.isFinite(input)), 'seed는 문자열 또는 유한한 수여야 합니다.');
  if (typeof input === 'number') return input >>> 0;
  assert(input.length <= 200, 'seed가 너무 깁니다.');
  let seed = 2166136261;
  for (const char of input) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return seed;
}

function uniqueId() {
  if (globalThis.crypto?.randomUUID) return `life-${globalThis.crypto.randomUUID()}`;
  return `life-${Date.now().toString(36)}-${seedNumber().toString(36)}-${++uniqueId.sequence}`;
}
uniqueId.sequence = 0;

function assetSnapshot(state) {
  const parts = {
    homeValue: state.finance.homeValue, mortgage: state.finance.mortgage,
    rentalValue: state.flags.rentalValue || 0,
    businessValue: (state.finance.business?.level || 0) * 1000,
    carValue: state.flags.carValue || 0, carLoan: state.flags.carLoan || 0,
  };
  parts.netWorth = state.finance.cash + state.finance.assets + parts.homeValue + parts.rentalValue + parts.businessValue + parts.carValue - state.finance.debt - parts.mortgage - parts.carLoan;
  return parts;
}

function birthCountry(draw, options) {
  const { countryId, demographicBasis, mode, weighting, birthYear } = options;
  if (demographicBasis === 'reference-2023') {
    assert(mode === 'present' && birthYear === 2026, '2023년 참고 자료 추첨은 현재 모드의 2026년 시작에서만 사용할 수 있습니다. 과거·미래에는 합성 분포를 선택하세요.');
    const rows = referenceDistribution(COUNTRIES, weighting);
    if (countryId) {
      assert(rows.some(row => row.countryId === countryId), '선택한 국가에 해당 참고 자료가 없습니다. 합성 모형으로 선택할 수 있습니다.');
      return getCountry(countryId);
    }
    assert(rows.length > 0, '참고 자료의 유효한 추첨 대상이 없습니다.');
    let drawWeight = random(draw);
    for (const row of rows) { drawWeight -= row.share; if (drawWeight < 0) return getCountry(row.countryId); }
    return getCountry(rows.at(-1).countryId);
  }
  return countryId ? getCountry(countryId) : drawBirthCountry(draw, { year: birthYear, mode, weighting });
}

function recordYear(state) {
  const entry = {
    age: state.age, year: state.year, cash: state.finance.cash, debt: state.finance.debt,
    assets: state.finance.assets, income: state.finance.annualIncome,
    expense: state.finance.annualExpense, health: state.stats.health,
    happiness: state.stats.happiness, countryId: state.countryId,
    city: state.city, household: state.household,
    environment: getEnvironment(state.countryId, { year: state.year, mode: state.mode, city: state.city, household: state.household }),
    ...assetSnapshot(state),
    careerJobId: state.career.jobId, careerTitle: state.career.title, careerLevel: state.career.level,
  };
  if (state.timeline.at(-1)?.age === state.age) state.timeline[state.timeline.length - 1] = entry;
  else state.timeline.push(entry);
}

/** Create a separate life. Explicit lifeId exists for deterministic fixtures/import tools. */
export function createLife(options = {}) {
  assert(plain(options), '출생 설정이 올바르지 않습니다.');
  const seed = seedNumber(options.seed);
  const requestedMode = options.mode ?? 'present';
  const draw = { rng: seed };
  assert(['present', 'past', 'future', 'random'].includes(requestedMode), '지원하지 않는 세계 모드입니다.');
  assert(requestedMode !== 'random' || (options.birthYear === undefined && options.demographicBasis !== 'reference-2023'), '무작위 시대는 연도 직접 지정 또는 현재 참고 추첨과 함께 사용할 수 없습니다.');
  const mode = requestedMode === 'random' ? pick(draw, ['past', 'present', 'future']) : requestedMode;
  const weighting = options.weighting ?? 'birth';
  const demographicBasis = options.demographicBasis ?? 'synthetic';
  assert(['present', 'past', 'future'].includes(mode), '지원하지 않는 세계 모드입니다.');
  assert(['birth', 'population'].includes(weighting), '지원하지 않는 추첨 기준입니다.');
  assert(['synthetic', 'reference-2023'].includes(demographicBasis), '지원하지 않는 출생 자료 기준입니다.');
  const birthYear = options.birthYear ?? ({ past: 1950, present: 2026, future: 2026 })[mode];
  assert(integer(birthYear, 1900, 2200), '출생 연도는 1900~2200 사이여야 합니다.');
  assert(options.name === undefined || text(options.name, 40), '이름은 1~40자여야 합니다.');
  assert(options.lifeId === undefined || text(options.lifeId, 160), '인생 식별자가 올바르지 않습니다.');
  assert(options.gender === undefined || ['female', 'male', 'nonbinary'].includes(options.gender), '지원하지 않는 성별 설정입니다.');
  assert(options.household === undefined || ['low', 'middle', 'high'].includes(options.household), '가계 설정이 올바르지 않습니다.');
  assert(options.city === undefined || ['urban', 'rural'].includes(options.city), '거주 설정이 올바르지 않습니다.');
  assert(options.targetMinutes === undefined || TARGET_MINUTES.includes(options.targetMinutes), '자동 진행 호흡은 기본·30분·60분·90분 중 하나입니다.');
  assert(options.reflectionStops === undefined || typeof options.reflectionStops === 'boolean', '회고 정지 설정이 올바르지 않습니다.');
  assert(options.comparisonCountry === undefined || options.comparisonCountry === null || COUNTRIES.some(country => country.id === options.comparisonCountry), '비교 국가가 올바르지 않습니다.');
  assert(options.countryId === undefined || COUNTRIES.some(country => country.id === options.countryId), '출생 국가가 올바르지 않습니다.');
  const country = birthCountry(draw, { countryId: options.countryId, demographicBasis, mode, weighting, birthYear });
  assert(country && (!options.countryId || country.id === options.countryId), '알 수 없는 출생 국가입니다.');
  const household = options.household ?? (random(draw) < 0.45 ? 'low' : random(draw) < 0.82 ? 'middle' : 'high');
  const city = options.city ?? (random(draw) < 0.6 ? 'urban' : 'rural');
  const environment = getEnvironment(country.id, { year: birthYear, mode, city, household });
  const life = {
    schemaVersion: 1, lifeId: options.lifeId ?? uniqueId(), version: 0, seed, rng: draw.rng,
    provenance: { source: 'rule', synthetic: true, realAI: false },
    name: options.name?.trim() ?? pick(draw, ['하늘', '이솔', '다온', '여울', '가온', '나래']),
    gender: options.gender ?? pick(draw, ['female', 'male']), birthYear, year: birthYear, age: 0,
    status: 'alive', countryId: country.id, birthCountryId: country.id,
    city, household, mode, weighting,
    stats: { health: Math.round(clamp(75 + environment.health * 0.15, 65, 94)), happiness: 65, knowledge: 0, social: 45, energy: 90 },
    focus: 'balanced',
    education: { level: 'none', program: null, field: 'general', yearsLeft: 0, history: [] },
    career: { jobId: null, title: '아직 없음', level: 0, years: 0, salary: 0, retired: false, pension: 0, breakYears: 0 },
    finance: {
      cash: Math.round(environment.income * ({ low: 0.12, middle: 0.4, high: 1.5 })[household]),
      debt: 0, assets: 0, allocation: 'deposit', home: 'family', homeValue: 0,
      mortgage: 0, rentals: 0, business: null, insurance: 'basic', diet: 'balanced',
      socialBudget: 1, donation: 0, will: 'family', scholarships: 0,
      annualIncome: 0, annualExpense: 0, tax: 0,
    },
    family: { parents: [], partners: [], children: [], friends: [], relationship: null },
    health: { conditions: [], treatment: null, disability: null, addiction: 0 },
    hobbies: [], politics: { role: null, term: 0, preparation: 0 },
    migration: { status: 'citizen', years: 0, pending: null },
    automations: { certificate: false, tutoring: false, lessons: false, checkup: false, childTuition: true, childMarriage: true, dinner: false, lastRun: {}, skipped: {} },
    settings: { auto: false, speed: 1, comparisonCountry: options.comparisonCountry ?? null, sensitive: true, targetMinutes: options.targetMinutes ?? null, reflectionStops: options.reflectionStops ?? false },
    pending: null, seen: [], flags: {}, history: [], timeline: [], cohort: [], notes: [], goals: [], receipts: [], ending: null,
  };
  // Every draw belongs to this life; UI creation order never changes a seeded life.
  life.rng = draw.rng;
  life.family.parents = [person(life, 'parent', 24 + Math.floor(random(life) * 14)), person(life, 'parent', 24 + Math.floor(random(life) * 16))];
  initializeBirthIdentity(life, { explicitName: options.name !== undefined });
  life.flags.aptitude = pick(life, ['study', 'arts', 'sports', 'social', 'practical']);
  life.flags.independentRules = 'synthetic-v2';
  if (requestedMode === 'random') life.flags.requestedMode = requestedMode;
  life.flags.demographicBasis = demographicBasis;
  life.flags.demographicSource = demographicBasis === 'reference-2023' ? DEMOGRAPHIC_META.id : 'synthetic-population-birth-v2';
  life.flags.demographicReferenceYear = demographicBasis === 'reference-2023' ? DEMOGRAPHIC_META.year : null;
  // Only a new, supported birth opts into this immutable descriptive snapshot.
  // Restoring or advancing an unmarked life never fills in historical values.
  if (mode === 'present' && birthYear === 2026) life.flags.countryReferenceSnapshot = COUNTRY_REFERENCE_META.id;
  life.flags.birthEnvironment = environment;
  life.flags.careerLedger = [];
  life.flags.careerTrackingStartAge = 0;
  life.flags.residenceHistory = [{ age: 0, year: birthYear, countryId: country.id, city }];
  life.cohort = makeCohort(life);
  const householdText = { low: '생활비를 나누어 쓰는', middle: '기본 생활을 꾸려 가는', high: '돌봄에 쓸 여유가 있는' }[household];
  const birthIdentity = life.flags.birthIdentity;
  const presentParents = life.family.parents.filter(parent => parent.alive && !parent.absent);
  const careText = presentParents.length ? `${presentParents.map(parent => parent.name).join(', ')}의 보살핌을 받으며 ${householdText} 가정에서 자랍니다.` : `${householdText} 가정에서 주변의 돌봄을 받으며 자랍니다.`;
  const siblingsText = birthIdentity.version >= 2 && Number.isInteger(birthIdentity.siblings) ? birthIdentity.siblings === 0 ? '출생 당시 위 형제자매는 없었습니다.' : `출생 당시 위 형제자매가 ${birthIdentity.siblings}명 있었습니다.` : '';
  const absentText = birthIdentity.parents.some(parent => parent.role === 'father' && parent.presentAtBirth === false) ? '아버지와는 출생 당시 함께 살지 않았습니다.' : '';
  const birth = log(life, 'birth', '하나의 삶이 시작되었습니다', [`${birthYear}년 ${birthIdentity.birthMonth}월, ${country.name}의 ${getResidenceLabel(life)}에서 ${life.name}의 삶이 시작되었습니다.`, careText, siblingsText, absentText].filter(Boolean).join(' '), 'birth');
  birth.birthContext = { source: 'authored-fiction', synthetic: true, identityVersion: life.flags.birthIdentity.version, demographicBasis, demographicSource: life.flags.demographicSource, demographicReferenceYear: life.flags.demographicReferenceYear, note: demographicBasis === 'reference-2023' ? `출생 국가 추첨만 World Bank ${DEMOGRAPHIC_META.year}년 인구·조출생률 자료를 참고한 추정 가중치입니다. 생활 조건과 모든 생애 결과는 합성 규칙입니다.` : '인물 설정과 출생 추첨·생활 조건·생애 결과는 자체 합성 규칙입니다.' };
  initializeLifeFlow(life);
  if (mode === 'future') log(life, 'world', '가능한 미래', '미래의 사건은 예측이나 실제 통계가 아닌 가상의 시나리오입니다.', 'future-disclaimer');
  life.pending = getStoryDecision(life);
  recordYear(life);
  validateLife(life);
  return life;
}

function validatePeople(family) {
  const ids = new Set();
  function visit(item, depth) {
    assert(depth <= 6 && plain(item) && text(item.id, 250) && text(item.name, 80) && integer(item.age, 0, 150) && typeof item.alive === 'boolean', '인물·후손 상태가 올바르지 않습니다.');
    assert(!ids.has(item.id), '같은 인물이 가족 목록에 중복되어 있습니다.');
    ids.add(item.id);
    if (item.closeness !== undefined) assert(Number.isFinite(item.closeness) && item.closeness >= 0 && item.closeness <= 100, '인물 관계 수치가 올바르지 않습니다.');
    if (item.absent !== undefined) assert(typeof item.absent === 'boolean', '인물의 현재 부재 상태가 올바르지 않습니다.');
    if (item.deceasedAge !== undefined) assert(integer(item.deceasedAge, 0, 150) && !item.alive, '인물 사망 기록이 올바르지 않습니다.');
    if (item.assignment !== undefined && item.assignment !== null) assert(plain(item.assignment) && integer(item.assignment.yearsLeft, 1, 30) && COUNTRIES.some(country => country.id === item.assignment.countryId), '인물 파견 기록이 올바르지 않습니다.');
    if (item.business !== undefined && item.business !== null) assert(plain(item.business) && integer(item.business.level, 1, 10000) && integer(item.business.employees, 0, 10000) && integer(item.business.years, 0, 150) && integer(item.business.profit, -MAX_MONEY, MAX_MONEY), '인물의 승계 사업 기록이 올바르지 않습니다.');
    for (const key of ['businessCash', 'businessDebt']) if (item[key] !== undefined) assert(integer(item[key], 0, MAX_MONEY), '인물의 사업 재무 기록이 올바르지 않습니다.');
    if (item.supportNeeds !== undefined) {
      const support = item.supportNeeds;
      assert(plain(support) && text(support.kind, 160) && typeof support.supported === 'boolean', '자녀 지원 상태가 올바르지 않습니다.');
      if (support.annualCost !== undefined) assert(integer(support.annualCost, 0, MAX_MONEY), '자녀 지원 비용이 올바르지 않습니다.');
      for (const key of ['lastPaidAge', 'lastShortfallAge', 'fundedYears', 'unmetYears']) if (support[key] !== undefined) assert(integer(support[key], 0, MAX_AGE), '자녀 지원 이력이 올바르지 않습니다.');
    }
    if (item.children !== undefined) {
      // Early local v1 saves stored only a descendant count. Keep that count,
      // without inventing people or inheritance identities from it.
      if (typeof item.children === 'number') assert(integer(item.children, 0, 100), '후손 수가 올바르지 않습니다.');
      else {
        assert(Array.isArray(item.children), '후손 목록이 올바르지 않습니다.');
        item.children.forEach(child => visit(child, depth + 1));
      }
    }
  }
  for (const key of ['parents', 'partners', 'children', 'friends']) {
    assert(Array.isArray(family[key]), `가족 ${key} 목록이 없습니다.`);
    family[key].forEach(item => visit(item, 0));
  }
  assert(family.relationship === null || plain(family.relationship), '교제 관계가 올바르지 않습니다.');
  if (family.relationship) visit(family.relationship, 0);
}

function validateOperationalFlags(state) {
  validateCareerInterests(state);
  const flags = state.flags;
  if (flags.focusPolicyVersion !== undefined) assert(flags.focusPolicyVersion === 1, '초점 정책 버전이 올바르지 않습니다.');
  if (flags.schoolWorkPolicyVersion !== undefined) assert(flags.schoolWorkPolicyVersion === 1, '진학·첫 일자리 정책 버전이 올바르지 않습니다.');
  if (flags.schoolEntry !== undefined) {
    const e=flags.schoolEntry;
    assert(plain(e)&&flags.schoolWorkPolicyVersion===1&&e.version===1&&integer(e.age,12,15)&&e.age<=state.age&&e.year===state.birthYear+e.age&&['funded','insufficient-funds','family-work'].includes(e.outcome)&&e.source==='rule'&&e.synthetic===true&&['requiredCost','availableCash','paidCost','income'].every(k=>integer(e[k],0,MAX_MONEY)), '진학 결과 기록이 올바르지 않습니다.');
    assert(e.outcome==='funded'?e.paidCost===e.requiredCost&&e.availableCash>=e.requiredCost:e.paidCost===0, '진학 지출 기록이 일치하지 않습니다.');
    if(e.outcome==='insufficient-funds')assert(e.availableCash<e.requiredCost&&e.income===0,'학비 부족 기록이 일치하지 않습니다.');
  }
  if (flags.schoolAttendance !== undefined) assert(['regular','community','stopped'].includes(flags.schoolAttendance), '학교 생활 상태가 올바르지 않습니다.');
  if (flags.focusSelection !== undefined) {
    const f = flags.focusSelection;
    assert(plain(f) && flags.focusPolicyVersion === 1 && ['manual','rule'].includes(f.source) && integer(f.age,0,state.age) && FOCUSES.includes(f.value) && f.value === state.focus, '초점 선택 기록이 올바르지 않습니다.');
    if (f.source === 'rule') assert(FOCUSES.includes(f.from) && f.reason === 'unavailable-in-stage' && ['school','working','out-of-school-child','outside-work'].includes(f.stage), '초점 전환 근거가 올바르지 않습니다.');
  }
  assert(validBirthIdentity(state), '출생 인물 설정의 보존 기록이 올바르지 않습니다.');
  if (flags.absentParentId !== undefined) assert(text(flags.absentParentId, 250) && state.family.parents.some(parent => parent.id === flags.absentParentId), '부재 부모의 연결 기록이 올바르지 않습니다.');
  if (flags.reunionResult !== undefined) assert(['contact-established', 'contact-declined', 'player-declined'].includes(flags.reunionResult), '부모와의 연락 결과가 올바르지 않습니다.');
  if (flags.countryReferenceSnapshot !== undefined) assert(text(flags.countryReferenceSnapshot, 160), '국가 참고 자료의 보존 표식이 올바르지 않습니다.');
  for (const key of ['carValue', 'carLoan', 'carAnnualCost', 'rentalValue', 'rentalMortgage', 'investmentPrincipal', 'childSupport', 'lastWorkingSalary', 'lastEarnedSalary', 'salaryEnvironment']) {
    if (flags[key] !== undefined) assert(integer(flags[key], 0, MAX_MONEY), `${key} 금액이 올바르지 않습니다.`);
  }
  for (const key of ['certificates', 'prisonYears', 'serviceYears', 'childcareYears', 'scholarshipGraduates', 'totalYearsWorked']) {
    if (flags[key] !== undefined) assert(integer(flags[key], 0, 10000), `${key} 수치가 올바르지 않습니다.`);
  }
  for (const key of ['carOwned', 'careBreak', 'serviceCompleted', 'parentCare', 'reverseMortgage', 'addictionSupport']) {
    if (flags[key] !== undefined) assert(typeof flags[key] === 'boolean', `${key} 상태가 올바르지 않습니다.`);
  }
  if (flags.skills !== undefined) assert(plain(flags.skills) && Object.values(flags.skills).every(value => Number.isFinite(value) && value >= 0 && value <= 100), '훈련 수치가 올바르지 않습니다.');
  if (flags.systemActions !== undefined) assert(plain(flags.systemActions) && Object.values(flags.systemActions).every(value => typeof value === 'boolean'), '연간 행동 원장이 올바르지 않습니다.');
  if (flags.visited !== undefined) assert(Array.isArray(flags.visited) && flags.visited.every(id => COUNTRIES.some(country => country.id === id)), '방문 국가 기록이 올바르지 않습니다.');
  if (flags.scholarshipStudents !== undefined) assert(Array.isArray(flags.scholarshipStudents) && flags.scholarshipStudents.every(student => plain(student) && text(student.id, 160) && integer(student.years, 0, 110) && typeof student.graduated === 'boolean' && (student.stopped === undefined || typeof student.stopped === 'boolean') && (student.prepaid === undefined || integer(student.prepaid, 0, MAX_MONEY))), '장학 후원 원장이 올바르지 않습니다.');
  for (const student of flags.scholarshipStudents || []) {
    for (const key of ['graduatedAge', 'careerNotifiedAge']) if (student[key] !== undefined) assert(integer(student[key], 0, state.age) && student.graduated, '후원 학생의 졸업·진로 시점이 올바르지 않습니다.');
    if (student.careerId !== undefined) assert(['teacher', 'nurse', 'electrician'].includes(student.careerId) && student.graduated && integer(student.careerNotifiedAge, 0, state.age), '후원 학생의 진로가 올바르지 않습니다.');
    if (student.graduatedAge !== undefined && student.careerNotifiedAge !== undefined) assert(student.careerNotifiedAge > student.graduatedAge, '후원 학생의 진로 소식이 졸업보다 앞섭니다.');
  }
  if (flags.politicalCampaign !== undefined) {
    const campaign = flags.politicalCampaign;
    assert(plain(campaign) && ['local', 'national'].includes(campaign.level) && CAMPAIGN_STATUSES.includes(campaign.status) && integer(campaign.startedAge, 0, state.age), '정치 준비 상태가 올바르지 않습니다.');
    for (const key of ['appliedAge', 'resolvedAge']) if (campaign[key] !== undefined) assert(integer(campaign[key], campaign.startedAge, state.age), '정치 준비 시점이 올바르지 않습니다.');
    if (campaign.chance !== undefined) assert(Number.isFinite(campaign.chance) && campaign.chance >= 0 && campaign.chance <= 1, '공천 확률이 올바르지 않습니다.');
    if (campaign.status === 'pending') assert(integer(campaign.appliedAge, campaign.startedAge, state.age) && Number.isFinite(campaign.chance), '공천 심사의 근거가 없습니다.');
  }
  if (flags.politicalHistory !== undefined) assert(Array.isArray(flags.politicalHistory) && flags.politicalHistory.every(entry => plain(entry) && ['local', 'national'].includes(entry.level) && CAMPAIGN_STATUSES.includes(entry.status) && integer(entry.age, 0, state.age) && (entry.chance === undefined || (Number.isFinite(entry.chance) && entry.chance >= 0 && entry.chance <= 1))), '정치 이력이 올바르지 않습니다.');
  if (flags.politicalServiceYears !== undefined) assert(plain(flags.politicalServiceYears) && ['local', 'national'].every(key => integer(flags.politicalServiceYears[key], 0, state.age)), '정치 재직 기간이 올바르지 않습니다.');
  if (flags.requestedMode !== undefined) assert(flags.requestedMode === 'random' && flags.demographicBasis !== 'reference-2023', '무작위 시대 기록이 올바르지 않습니다.');
  if (flags.reflectedAges !== undefined) assert(Array.isArray(flags.reflectedAges) && new Set(flags.reflectedAges).size === flags.reflectedAges.length && flags.reflectedAges.every(age => REFLECTION_AGES.includes(age) && age <= state.age), '회고 완료 이력이 올바르지 않습니다.');
  for (const key of ['educationPaused', 'educationOnLeave']) if (flags[key] !== undefined) assert(typeof flags[key] === 'boolean', '학업 휴학·정체 상태가 올바르지 않습니다.');
  for (const key of ['educationPausedYears', 'educationPauseStartedAge', 'educationProgressAge', 'educationFundingDecisionAge']) if (flags[key] !== undefined) assert(integer(flags[key], 0, state.age), '학업 진행 이력이 올바르지 않습니다.');
  if (flags.educationFunding !== undefined) assert(['self', 'work-study', 'loan'].includes(flags.educationFunding), '학업 재원 상태가 올바르지 않습니다.');
  if (flags.lastStoryChoice !== undefined) assert(plain(flags.lastStoryChoice) && integer(flags.lastStoryChoice.age, 0, state.age) && text(flags.lastStoryChoice.structure, 500) && text(flags.lastStoryChoice.label, 400), '최근 선택의 연결 기록이 올바르지 않습니다.');
  if (flags.childFirstSteps !== undefined) {
    const choice = flags.childFirstSteps;
    assert(plain(choice) && ['observe', 'run', 'comfort', 'retry'].includes(choice.choiceId) && integer(choice.age, 0, state.age) && choice.source === 'rule' && choice.synthetic === true && choice.rulesVersion === 1 && plain(choice.effects) && Object.entries(choice.effects).every(([key, value]) => STAT_KEYS.includes(key) && Number.isFinite(value) && value >= -100 && value <= 100), '어린 시절 행동의 결과 기록이 올바르지 않습니다.');
  }
  if (flags.lifeFlow !== undefined) {
    const flow = flags.lifeFlow;
    assert(plain(flow) && flow.version === 1 && integer(flow.lastAge, 0, state.age) && (flow.lastRememberedChoice === null || text(flow.lastRememberedChoice, 600)), '생활 흐름 이력이 올바르지 않습니다.');
    if (flow.childhoodFirstStepLinked !== undefined) assert(typeof flow.childhoodFirstStepLinked === 'boolean', '어린 시절 후속 기록이 올바르지 않습니다.');
    if (flow.childhoodScenes !== undefined) assert(Array.isArray(flow.childhoodScenes) && flow.childhoodScenes.length <= 8 && flow.childhoodScenes.every(scene => plain(scene) && text(scene.key, 200) && integer(scene.age, 0, state.age)), '어린 시절 장면 원장이 올바르지 않습니다.');
    if (flow.childhoodActivity !== undefined && flow.childhoodActivity !== null) {
      const activity = flow.childhoodActivity;
      assert(plain(activity) && text(activity.key, 200) && integer(activity.startedAge, 0, state.age) && FOCUSES.includes(activity.focus) && activity.source === 'rule' && activity.synthetic === true, '어린 시절 활동 기록이 올바르지 않습니다.');
      for (const key of ['personId', 'hobbyId', 'level']) if (activity[key] !== undefined) assert(text(activity[key], 250), '어린 시절 활동 대상이 올바르지 않습니다.');
      if (activity.hobbyLevel !== undefined) assert(integer(activity.hobbyLevel, 1, 100), '어린 시절 취미 단계가 올바르지 않습니다.');
      if (activity.choiceId !== undefined) assert(['observe', 'run', 'comfort', 'retry'].includes(activity.choiceId), '어린 시절 행동 연결이 올바르지 않습니다.');
      for (const key of ['firstStep', 'healthLimited']) if (activity[key] !== undefined) assert(typeof activity[key] === 'boolean', '어린 시절 활동 조건이 올바르지 않습니다.');
    }
    const previous = flow.previous;
    if (previous !== null) {
      assert(plain(previous) && integer(previous.age, 0, state.age) && plain(previous.stats) && STAT_KEYS.every(key => Number.isFinite(previous.stats[key]) && previous.stats[key] >= 0 && previous.stats[key] <= 100), '이전 생활 능력 기록이 올바르지 않습니다.');
      assert(COUNTRIES.some(country => country.id === previous.countryId) && ['urban', 'rural'].includes(previous.city) && FOCUSES.includes(previous.focus) && integer(previous.cash, -MAX_MONEY, MAX_MONEY) && Number.isFinite(previous.workSkill) && previous.workSkill >= 0 && previous.workSkill <= 100, '이전 생활 조건 기록이 올바르지 않습니다.');
      assert((previous.jobId === null || text(previous.jobId, 160)) && (previous.programId === null || text(previous.programId, 160)) && integer(previous.yearsLeft, 0, 30), '이전 일과 학업 기록이 올바르지 않습니다.');
      assert(Array.isArray(previous.hobbies) && previous.hobbies.every(hobby => plain(hobby) && text(hobby.id, 160) && integer(hobby.level, 1, 100)) && Array.isArray(previous.children) && previous.children.every(child => plain(child) && text(child.id, 250) && Number.isFinite(child.closeness) && child.closeness >= 0 && child.closeness <= 100), '이전 가족·취미 기록이 올바르지 않습니다.');
    }
  }
  if (flags.treatmentHistory !== undefined) assert(Array.isArray(flags.treatmentHistory) && flags.treatmentHistory.every(entry => plain(entry) && integer(entry.age, 0, state.age) && Array.isArray(entry.conditions) && entry.conditions.every(id => text(id, 160))), '치료 경과 기록이 올바르지 않습니다.');
  if (flags.applications !== undefined) assert(Array.isArray(flags.applications) && flags.applications.every(entry => plain(entry) && text(entry.id, 160) && integer(entry.age, 0, state.age) && typeof entry.accepted === 'boolean' && Number.isFinite(entry.chance) && entry.chance >= 0 && entry.chance <= 1 && integer(entry.cost, 0, MAX_MONEY)), '진학 지원 기록이 올바르지 않습니다.');
  if (flags.citizenships !== undefined) assert(Array.isArray(flags.citizenships) && flags.citizenships.every(id => COUNTRIES.some(country => country.id === id)), '시민권 기록이 올바르지 않습니다.');
  for (const key of ['previousJob', 'servicePreviousJob']) if (flags[key] !== undefined && flags[key] !== null) validateCareer(flags[key]);
  for (const key of ['workYears', 'totalYearsWorked']) if (flags[key] !== undefined) assert(integer(flags[key], 0, MAX_AGE), '누적 근무 기간이 올바르지 않습니다.');
  if (flags.rentalMortgage !== undefined) assert(flags.rentalMortgage <= state.finance.mortgage, '임대 주택 대출이 전체 주택 대출보다 큽니다.');
  if (flags.insurancePaidThroughAge !== undefined) assert(integer(flags.insurancePaidThroughAge, 0, state.age + 1), '보험 선납 기록이 올바르지 않습니다.');
  if (flags.careerHistory !== undefined) assert(Array.isArray(flags.careerHistory) && flags.careerHistory.every(entry => plain(entry) && integer(entry.age, 0, state.age) && text(entry.jobId, 160) && integer(entry.years, 0, MAX_AGE) && integer(entry.salary, 0, MAX_MONEY) && text(entry.reason, 100)), '과거 직업 기록이 올바르지 않습니다.');
  if (flags.demographicBasis !== undefined) {
    assert(['synthetic', 'reference-2023'].includes(flags.demographicBasis), '출생 추첨 출처가 올바르지 않습니다.');
    if (flags.demographicBasis === 'reference-2023') assert(state.mode === 'present' && state.birthYear === 2026 && flags.demographicSource === DEMOGRAPHIC_META.id && flags.demographicReferenceYear === DEMOGRAPHIC_META.year, '공개 출생 자료의 출처와 적용 시점이 일치하지 않습니다.');
    else assert(flags.demographicReferenceYear === null && flags.demographicSource === 'synthetic-population-birth-v2', '합성 출생 자료의 출처가 일치하지 않습니다.');
  }
  if (flags.careerLedger !== undefined) {
    assert(Array.isArray(flags.careerLedger) && flags.careerLedger.every(entry => plain(entry) && integer(entry.age, 1, state.age) && entry.year === state.birthYear + entry.age && ['employment', 'service', 'care'].includes(entry.kind) && (entry.jobId === null || text(entry.jobId, 160)) && text(entry.title, 250) && integer(entry.level, 0, 1000)), '경력 연간 기록이 올바르지 않습니다.');
    assert(new Set(flags.careerLedger.map(entry => entry.age)).size === flags.careerLedger.length, '같은 해의 경력이 중복 기록되어 있습니다.');
    assert(flags.careerLedger.every((entry, index, entries) => index === 0 || entry.age > entries[index - 1].age), '경력 기록의 시간 순서가 올바르지 않습니다.');
  }
  if (flags.careerTrackingStartAge !== undefined) assert(integer(flags.careerTrackingStartAge, 0, state.age), '경력 기록 시작 시점이 올바르지 않습니다.');
  if (flags.residenceHistory !== undefined) assert(Array.isArray(flags.residenceHistory) && flags.residenceHistory.every(entry => plain(entry) && integer(entry.age, 0, state.age) && entry.year === state.birthYear + entry.age && COUNTRIES.some(country => country.id === entry.countryId) && (entry.city === undefined || ['urban', 'rural'].includes(entry.city))), '거주 이력이 올바르지 않습니다.');
}

function validateCareer(career) {
  assert(plain(career) && (career.jobId === null || text(career.jobId, 160)) && text(career.title, 250) && typeof career.retired === 'boolean', '직업 상태가 올바르지 않습니다.');
  for (const key of ['level', 'years', 'breakYears']) assert(integer(career[key], 0, 1000), '경력 수치가 올바르지 않습니다.');
  for (const key of ['salary', 'pension']) assert(integer(career[key], 0, MAX_MONEY), '급여 수치가 올바르지 않습니다.');
}

function validateCompanion(item) {
  assert(plain(item) && text(item.id, 250) && text(item.name, 80) && integer(item.age, 0, MAX_AGE) && ['alive', 'ended'].includes(item.status) && COUNTRIES.some(country => country.id === item.countryId) && ['health', 'happiness'].every(key => Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 100), '비교 생애 상태가 올바르지 않습니다.');
  assert(Array.isArray(item.milestones) && item.milestones.every(entry => plain(entry) && integer(entry.age, 0, item.age)), '비교 생애 기록이 올바르지 않습니다.');
  if (item.modelVersion !== 2) return; // Original v1 companions retain their observed history.
  if (item.demographicSource !== undefined) assert((item.demographicSource === DEMOGRAPHIC_META.id && item.demographicReferenceYear === DEMOGRAPHIC_META.year && item.mode === 'present' && item.birthYear === 2026) || (item.demographicSource === 'synthetic-population-birth-v2' && item.demographicReferenceYear === null), '비교 인물의 출생 추첨 출처가 올바르지 않습니다.');
  assert(['present', 'past', 'future'].includes(item.mode) && ['urban', 'rural'].includes(item.city) && ['low', 'middle', 'high'].includes(item.household) && Number.isFinite(item.knowledge) && item.knowledge >= 0 && item.knowledge <= 100, '비교 인물의 생활 환경이 올바르지 않습니다.');
  assert(integer(item.rng, 0, 0xFFFFFFFF) && integer(item.birthYear, 1900, 2200) && item.year === item.birthYear + item.age && typeof item.alive === 'boolean' && item.alive === (item.status === 'alive'), '비교 생애의 시간 또는 난수 상태가 올바르지 않습니다.');
  assert(item.status === 'alive' ? item.lifespan === null : item.lifespan === item.age && item.deathAge === item.age, '비교 인물의 생존 상태와 수명 기록이 일치하지 않습니다.');
  assert(plain(item.education) && text(item.education.level, 80) && integer(item.education.yearsLeft, 0, 30), '비교 인물의 교육 상태가 올바르지 않습니다.');
  assert(plain(item.career) && (item.career.jobId === null || text(item.career.jobId, 160)) && text(item.career.title, 250) && integer(item.career.salary, 0, MAX_MONEY) && integer(item.career.years, 0, MAX_AGE) && typeof item.career.retired === 'boolean', '비교 인물의 경력 상태가 올바르지 않습니다.');
  assert(plain(item.finance) && ['cash', 'debt', 'income', 'expense'].every(key => integer(item.finance[key], key === 'cash' ? -MAX_MONEY : 0, MAX_MONEY)), '비교 인물의 재무 상태가 올바르지 않습니다.');
  assert(plain(item.family) && typeof item.family.partnered === 'boolean' && ['children', 'grandchildren'].every(key => integer(item.family[key], 0, 100)), '비교 인물의 가족 상태가 올바르지 않습니다.');
  assert(typeof item.healthcare === 'boolean' && integer(item.conditions, 0, 100) && Array.isArray(item.timeline) && item.timeline.every(point => plain(point) && integer(point.age, 0, item.age) && point.year === item.birthYear + point.age), '비교 인물의 생활 기록이 올바르지 않습니다.');
}

function validateEnding(state) {
  if (state.ending === null) return;
  const ending = state.ending;
  assert(text(ending.cause, 500) && text(ending.summary, 2000) && integer(ending.estate, 0, MAX_TOTAL) && Array.isArray(ending.distribution) && plain(ending.stats), '종료 요약이 올바르지 않습니다.');
  assert(ending.distribution.every(entry => plain(entry) && text(entry.recipient, 250) && integer(entry.amount, 0, MAX_TOTAL) && ['family', 'charity', 'community'].includes(entry.kind)), '상속 분배 기록이 올바르지 않습니다.');
  assert(ending.distribution.reduce((sum, entry) => sum + entry.amount, 0) === ending.estate, '상속 분배 합계가 잔여 재산과 일치하지 않습니다.');
  if (ending.source !== undefined) assert(ending.source === 'rule' && ending.synthetic === true, '종료 요약의 출처가 올바르지 않습니다.');
  if (ending.causeConditionId !== undefined) assert(ending.causeConditionId === null || text(ending.causeConditionId, 160), '사인 조건 식별자가 올바르지 않습니다.');
  for (const key of ['decisions', 'yearsWorked', 'children', 'survivingChildren', 'scholarships', 'scholarshipGraduates', 'countries']) assert(integer(ending.stats[key], 0, 10000), '회고 통계가 올바르지 않습니다.');
  for (const key of ['happiness', 'knowledge']) assert(Number.isFinite(ending.stats[key]) && ending.stats[key] >= 0 && ending.stats[key] <= 100, '회고 능력 수치가 올바르지 않습니다.');
  assert(Array.isArray(ending.cohort) && ending.cohort.length === 5 && ending.cohort.filter(item => item?.player === true).length === 1 && ending.cohort.some(item => item?.player === true && item.id === state.lifeId && item.age === state.age), '종료 비교 기록이 올바르지 않습니다.');
  for (const companion of ending.cohort.filter(item => !item?.player)) validateCompanion(companion);
  if (ending.summaryVersion === 2) {
    assert(ending.stats.decisions === state.receipts.filter(receipt => receipt.type === 'choose').length, '회고의 선택 수가 실제 원장과 일치하지 않습니다.');
    const career = ending.careerSummary;
    assert(ending.cohort.every(item => item.status === 'ended') && new Set(ending.cohort.map(item => item.id)).size === 5, '종료 비교 인물의 식별자 또는 생존 상태가 올바르지 않습니다.');
    const player = ending.cohort.find(item => item.player);
    if (player.health !== undefined) assert(player.health === state.stats.health && player.happiness === state.stats.happiness && plain(player.education) && plain(player.career) && plain(player.finance) && plain(player.family) && player.finance.annualIncome === state.finance.annualIncome && player.family.children === state.family.children.length, '종료 비교의 본인 기록이 실제 생애와 일치하지 않습니다.');
    assert(plain(career) && (career.representativeTitle === null || text(career.representativeTitle, 250)) && integer(career.totalYears, 0, MAX_AGE) && ['tracked', 'partial', 'none'].includes(career.evidence) && Array.isArray(career.roles), '회고 경력 요약이 올바르지 않습니다.');
    assert(career.roles.every(role => plain(role) && text(role.title, 250) && (role.jobId === null || text(role.jobId, 160)) && ['employment', 'service', 'care'].includes(role.kind) && integer(role.years, 1, MAX_AGE) && integer(role.firstAge, 1, state.age) && integer(role.lastAge, role.firstAge, state.age) && role.years <= role.lastAge - role.firstAge + 1), '회고의 경력 기간이 올바르지 않습니다.');
    assert(canonical(career) === canonical(careerSummary(state)) && ending.stats.yearsWorked === career.totalYears, '회고 경력이 실제 연간 원장과 일치하지 않습니다.');
  }
}

/** Reject malformed state instead of silently repairing a damaged save. */
export function validateLife(state) {
  assert(plain(state) && state.schemaVersion === 1, '지원하지 않는 생애 저장 버전입니다.');
  assert(Object.keys(state).every(key => LIFE_FIELDS.has(key)), '지원하지 않는 생애 필드가 있습니다.');
  assert(text(state.lifeId, 160), '인생 식별자가 없습니다.');
  assert(integer(state.version, 0, Number.MAX_SAFE_INTEGER), '상태 버전이 올바르지 않습니다.');
  assert(integer(state.seed, 0, 0xFFFFFFFF) && integer(state.rng, 0, 0xFFFFFFFF), '난수 상태가 올바르지 않습니다.');
  assert(integer(state.age, 0, MAX_AGE) && integer(state.birthYear, 1900, 2200) && state.year === state.birthYear + state.age, '나이와 연도가 일치하지 않습니다.');
  assert(['alive', 'ended'].includes(state.status), '생애 상태가 올바르지 않습니다.');
  assert(text(state.name, 40) && ['female', 'male', 'nonbinary'].includes(state.gender), '인물 정보가 올바르지 않습니다.');
  assert(['present', 'past', 'future'].includes(state.mode) && ['birth', 'population'].includes(state.weighting), '세계 설정이 올바르지 않습니다.');
  assert(COUNTRIES.some(country => country.id === state.countryId) && COUNTRIES.some(country => country.id === state.birthCountryId), '국가 정보가 올바르지 않습니다.');
  assert(plain(state.provenance) && state.provenance.source === 'rule' && state.provenance.synthetic === true && state.provenance.realAI === false, '출처를 실제 모델 또는 실제 통계로 바꿀 수 없습니다.');
  assert(plain(state.stats) && STAT_KEYS.every(key => Number.isFinite(state.stats[key]) && state.stats[key] >= 0 && state.stats[key] <= 100), '능력 수치가 범위를 벗어났습니다.');
  assert(plain(state.finance) && MONEY_KEYS.every(key => integer(state.finance[key], key === 'cash' ? -MAX_MONEY : 0, MAX_MONEY)), '금전 상태가 올바르지 않습니다.');
  for (const key of ['education', 'career', 'family', 'health', 'politics', 'migration', 'automations', 'settings', 'flags']) assert(plain(state[key]), `${key} 상태가 없습니다.`);
  assert(['none', 'primary', 'secondary', 'high', 'highschool', 'certificate', 'vocational', 'bachelor', 'master', 'doctorate'].includes(state.education.level) && integer(state.education.yearsLeft, 0, 30) && Array.isArray(state.education.history) && text(state.education.field, 80), '학업 상태가 올바르지 않습니다.');
  const program = state.education.program;
  assert(program === null || (plain(program) && text(program.id, 160) && text(program.label, 200) && text(program.degree, 80) && text(program.field, 80) && integer(program.years, 1, 30) && integer(program.cost, 0, MAX_MONEY)), '재학 과정이 올바르지 않습니다.');
  assert(program === null ? state.education.yearsLeft === 0 : state.education.yearsLeft >= 1, '재학 상태와 남은 기간이 일치하지 않습니다.');
  validateCareer(state.career);
  assert(INVESTMENTS.some(item => item.id === state.finance.allocation) && ['basic', 'expanded'].includes(state.finance.insurance) && ['budget', 'balanced', 'healthy'].includes(state.finance.diet), '금융 또는 생활 선택이 올바르지 않습니다.');
  assert(['family', 'owned', 'rented', 'care'].includes(state.finance.home) && ['family', 'charity20', 'mixed', 'charity', 'scholarship'].includes(state.finance.will), '주거 또는 유언 설정이 올바르지 않습니다.');
  assert([0, 0.5, 1, 1.5].includes(state.finance.socialBudget) && integer(state.finance.rentals, 0, 10000) && integer(state.finance.scholarships, 0, 10000) && integer(state.finance.donation, 0, MAX_MONEY), '재무 계획 수치가 올바르지 않습니다.');
  const business = state.finance.business;
  assert(business === null || (plain(business) && integer(business.level, 1, 10000) && integer(business.employees, 0, 10000) && integer(business.years, 0, MAX_AGE) && integer(business.profit, -MAX_MONEY, MAX_MONEY)), '사업 상태가 올바르지 않습니다.');
  assert(FOCUSES.includes(state.focus), '생활 초점이 올바르지 않습니다.');
  assert(typeof state.settings.auto === 'boolean' && typeof state.settings.sensitive === 'boolean' && SPEEDS.includes(state.settings.speed), '진행 설정이 올바르지 않습니다.');
  // The field was added during the first local integration; earlier v1 saves
  // without it keep their original default pacing rather than being discarded.
  assert(state.settings.targetMinutes === undefined || TARGET_MINUTES.includes(state.settings.targetMinutes), '자동 진행 호흡 설정이 올바르지 않습니다.');
  assert(state.settings.reflectionStops === undefined || typeof state.settings.reflectionStops === 'boolean', '회고 정지 설정이 올바르지 않습니다.');
  assert(state.settings.comparisonCountry === null || COUNTRIES.some(country => country.id === state.settings.comparisonCountry), '비교 국가 설정이 올바르지 않습니다.');
  for (const key of ['certificate', 'tutoring', 'lessons', 'checkup', 'childTuition', 'childMarriage']) assert(typeof state.automations[key] === 'boolean', '자동 지출 상태가 올바르지 않습니다.');
  assert(state.automations.dinner === undefined || typeof state.automations.dinner === 'boolean', '자동 저녁 식사 설정이 올바르지 않습니다.');
  assert(plain(state.automations.lastRun) && Object.values(state.automations.lastRun).every(age => integer(age, 0, state.age)), '자동 지출 실행 원장이 올바르지 않습니다.');
  assert(plain(state.automations.skipped) && Object.values(state.automations.skipped).every(value => plain(value) && integer(value.age, 0, state.age) && text(value.reason, 120) && integer(value.cost, 0, MAX_MONEY)), '자동 지출 보류 원장이 올바르지 않습니다.');
  if (state.automations.skipped.dinner !== undefined) assert(['insufficient_funds', 'insufficient_reserve', 'ineligible'].includes(state.automations.skipped.dinner.reason) && state.automations.skipped.dinner.cost === 150, '자동 저녁 식사 보류 근거가 올바르지 않습니다.');
  assert(['urban', 'rural'].includes(state.city) && ['low', 'middle', 'high'].includes(state.household), '출생 환경이 올바르지 않습니다.');
  for (const key of ['hobbies', 'seen', 'history', 'timeline', 'cohort', 'notes', 'goals', 'receipts']) assert(Array.isArray(state[key]), `${key} 목록이 없습니다.`);
  assert(state.hobbies.every(hobby => plain(hobby) && HOBBIES.some(item => item.id === hobby.id) && integer(hobby.level, 1, 100)), '취미 상태가 올바르지 않습니다.');
  validatePeople(state.family);
  validateOperationalFlags(state);
  assert(Array.isArray(state.health.conditions) && state.health.conditions.every(condition => plain(condition) && text(condition.id, 160) && text(condition.name, 200) && Number.isFinite(condition.severity) && condition.severity >= 0 && condition.severity <= 100 && integer(condition.years, 0, MAX_AGE)), '건강 상태가 올바르지 않습니다.');
  const treatment = state.health.treatment;
  assert(treatment === null || (plain(treatment) && integer(treatment.yearsLeft, 1, 30) && Array.isArray(treatment.conditionIds) && treatment.conditionIds.every(id => text(id, 160))), '치료 상태가 올바르지 않습니다.');
  assert(state.health.disability === null || (plain(state.health.disability) && typeof state.health.disability.supported === 'boolean'), '장애 지원 상태가 올바르지 않습니다.');
  assert(Number.isFinite(state.health.addiction) && state.health.addiction >= 0 && state.health.addiction <= 100, '건강 지원 수치가 올바르지 않습니다.');
  assert((state.politics.role === null || text(state.politics.role, 80)) && integer(state.politics.term, 0, 20) && integer(state.politics.preparation, 0, 1000), '지역 활동 상태가 올바르지 않습니다.');
  assert(['citizen', 'resident', 'permanent', 'refugee', 'irregular'].includes(state.migration.status) && integer(state.migration.years, 0, MAX_AGE), '체류 상태가 올바르지 않습니다.');
  const migration = state.migration.pending;
  assert(migration === null || (plain(migration) && ['citizen', 'resident', 'permanent'].includes(migration.kind) && integer(migration.yearsLeft, 1, 30)), '체류 심사 상태가 올바르지 않습니다.');
  assert(state.pending === null || (plain(state.pending) && text(state.pending.id, 250) && Array.isArray(state.pending.choices) && state.pending.choices.length > 0 && state.pending.choices.every(choice => text(choice.id, 120) && text(choice.label, 400))), '결정 카드가 올바르지 않습니다.');
  if (state.pending?.structure?.startsWith('milestone-reflection:')) assert(isReflection(state) && state.settings.reflectionStops === true && REFLECTION_AGES.includes(state.age) && !(state.flags.reflectedAges || []).includes(state.age) && state.pending.id === `${state.lifeId}:reflection:${state.age}` && state.pending.choices.length === 1 && state.pending.choices[0].id === 'continue', '회고 대기 상태가 올바르지 않습니다.');
  assert(state.status !== 'ended' || (plain(state.ending) && state.pending === null && state.ending.age === state.age && state.ending.year === state.year), '종료 상태가 일치하지 않습니다.');
  assert(state.status !== 'alive' || state.ending === null, '진행 중인 삶에 종료 기록이 있습니다.');
  assert(state.receipts.length === state.version, '실행 원장과 상태 버전이 일치하지 않습니다.');
  const receiptIds = new Set();
  for (const [index, receipt] of state.receipts.entries()) {
    assert(plain(receipt) && text(receipt.id, 160) && text(receipt.fingerprint, 10000) && receipt.version === index + 1 && integer(receipt.age, 0, state.age) && !receiptIds.has(receipt.id), '실행 원장이 올바르지 않습니다.');
    const recordedCommand = JSON.parse(receipt.fingerprint);
    assert(validateCommand(recordedCommand) === receipt.fingerprint && recordedCommand.id === receipt.id && recordedCommand.type === receipt.type && recordedCommand.lifeId === state.lifeId && recordedCommand.expectedVersion === receipt.version - 1, '실행 원장과 실제 명령이 일치하지 않습니다.');
    receiptIds.add(receipt.id);
  }
  assert(state.notes.length <= 200 && state.notes.every(note => plain(note) && text(note.id, 250) && typeof note.text === 'string' && note.text.length <= 2000 && integer(note.age, 0, state.age)), '메모 상태가 올바르지 않습니다.');
  assert(state.goals.length <= 100 && state.goals.every(goal => plain(goal) && text(goal.id, 250) && text(goal.text, 500) && Array.isArray(goal.steps) && goal.steps.length >= 1 && goal.steps.length <= 20 && goal.steps.every(step => text(step, 120)) && integer(goal.cursor, 0, goal.steps.length) && ['active', 'completed', 'cancelled', 'ended'].includes(goal.status) && (goal.status !== 'completed' || goal.cursor === goal.steps.length) && (goal.status !== 'active' || goal.cursor < goal.steps.length) && goal.source === 'manual' && goal.realAI === false), '계획 상태가 올바르지 않습니다.');
  assert(state.history.every(entry => plain(entry) && text(entry.id, 250) && integer(entry.age, 0, state.age) && entry.year === state.birthYear + entry.age && text(entry.category, 120) && text(entry.title, 500) && typeof entry.text === 'string' && entry.source === 'rule'), '생애 기록이 올바르지 않습니다.');
  for (const entry of state.history) if (entry.lifeFacts?.adultContext !== undefined || entry.lifeFacts?.narrative?.domain === 'adult') assert(validAdultLifeFacts(entry.lifeFacts), '성인 생활의 당시 기록이 올바르지 않습니다.');
  // Optional player annotations stay separate from immutable rule-authored events.
  // Old saves need no backfill; marks must refer to one retained event in this life.
  if (state.historyMarks !== undefined) {
    assert(Array.isArray(state.historyMarks) && state.historyMarks.length <= state.history.length, '기억할 순간 목록이 올바르지 않습니다.');
    const eventCounts = new Map(), markedIds = new Set();
    for (const entry of state.history) eventCounts.set(entry.id, (eventCounts.get(entry.id) || 0) + 1);
    for (const mark of state.historyMarks) {
      assert(plain(mark) && Object.keys(mark).length === 2 && text(mark.historyId, 250) && mark.source === 'manual' && eventCounts.get(mark.historyId) === 1 && !markedIds.has(mark.historyId), '기억할 순간의 사건 참조 또는 출처가 올바르지 않습니다.');
      markedIds.add(mark.historyId);
    }
  }
  assert(state.seen.every(key => text(key, 500)), '사건 처리 기록이 올바르지 않습니다.');
  let previousAge = -1;
  for (const point of state.timeline) {
    assert(plain(point) && integer(point.age, 0, state.age) && point.age > previousAge && point.year === state.birthYear + point.age, '생애 그래프의 시간이 일치하지 않습니다.');
    assert(['cash', 'debt', 'assets', 'income', 'expense'].every(key => integer(point[key], key === 'cash' ? -MAX_MONEY : 0, MAX_MONEY)) && ['health', 'happiness'].every(key => Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 100) && COUNTRIES.some(country => country.id === point.countryId), '생애 그래프의 값이 올바르지 않습니다.');
    for (const key of ['homeValue', 'mortgage', 'rentalValue', 'businessValue', 'carValue', 'carLoan']) if (point[key] !== undefined) assert(integer(point[key], 0, MAX_MONEY), '생애 그래프의 자산 값이 올바르지 않습니다.');
    if (point.netWorth !== undefined) {
      assert(integer(point.netWorth, -MAX_TOTAL, MAX_TOTAL) && ['homeValue', 'mortgage', 'rentalValue', 'businessValue', 'carValue', 'carLoan'].every(key => integer(point[key], 0, MAX_MONEY)), '생애 그래프의 순자산 근거가 없습니다.');
      assert(point.netWorth === point.cash + point.assets + point.homeValue + point.rentalValue + point.businessValue + point.carValue - point.debt - point.mortgage - point.carLoan, '생애 그래프의 순자산 합계가 일치하지 않습니다.');
    }
    previousAge = point.age;
  }
  assert(state.cohort.length === 4, '비교 생애 수가 올바르지 않습니다.');
  state.cohort.forEach(validateCompanion);
  validateEnding(state);
  return true;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new TypeError('명령에 저장할 수 없는 값이 있습니다.');
}

function validateCommand(command) {
  assert(plain(command) && text(command.id, 160) && text(command.lifeId, 160), '명령 식별자가 올바르지 않습니다.');
  assert(integer(command.expectedVersion, 0, Number.MAX_SAFE_INTEGER) && Object.hasOwn(COMMAND_FIELDS, command.type), '명령 종류 또는 버전이 올바르지 않습니다.');
  const fields = new Set(['id', 'lifeId', 'expectedVersion', 'type', ...COMMAND_FIELDS[command.type]]);
  assert(Object.keys(command).every(key => fields.has(key)), '지원하지 않는 명령 필드입니다.');
  const fingerprint = canonical(command);
  assert(fingerprint.length <= 10000, '명령이 너무 큽니다.');
  return fingerprint;
}

function terminalCondition(state) {
  return [...state.health.conditions].sort((a, b) => (b.severity || 0) - (a.severity || 0) || (b.years || 0) - (a.years || 0))[0] ?? null;
}

function endingCause(state) {
  const condition = terminalCondition(state);
  if (condition) return `${condition.name}과 관련된 건강 악화`;
  if (state.age < 5) return '어린 시기의 급성 건강 악화';
  if (state.age < 60) return '갑작스러운 건강 악화';
  return '노년의 건강 악화';
}

function mortality(state) {
  if (state.age >= MAX_AGE || state.stats.health <= 0) return true;
  const ageRisk = state.age < 5 ? 0.0015 : state.age < 45 ? 0.0005 : state.age < 60 ? 0.0015 : 0.003 * Math.exp((state.age - 60) / 9);
  const healthRisk = Math.max(0, 40 - state.stats.health) * 0.0015;
  const conditionRisk = state.health.conditions.reduce((total, condition) => total + Math.max(0, (condition.severity || 0) - 1) * 0.001, 0);
  return random(state) < Math.min(0.9, ageRisk + healthRisk + conditionRisk);
}

function careerSummary(state) {
  const entries = state.flags.careerLedger || [];
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.jobId || ''}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.years += 1;
      existing.lastAge = entry.age;
      existing.title = entry.title;
    } else grouped.set(key, { jobId: entry.jobId, kind: entry.kind, title: entry.title, years: 1, firstAge: entry.age, lastAge: entry.age });
  }
  const roles = [...grouped.values()].sort((a, b) => b.years - a.years || b.lastAge - a.lastAge);
  const employment = roles.filter(role => role.kind === 'employment');
  const representative = employment[0] ?? roles[0];
  const trackedYears = employment.reduce((sum, role) => sum + role.years, 0);
  const partial = state.flags.careerTrackingStartAge !== 0;
  return {
    representativeTitle: representative?.title ?? null,
    totalYears: partial ? Math.max(trackedYears, state.flags.totalYearsWorked || 0) : trackedYears,
    roles, evidence: partial ? 'partial' : entries.length ? 'tracked' : 'none',
  };
}

function recordCareerYear(state) {
  state.flags.careerLedger ??= [];
  let entry;
  if (state.career.jobId && !(state.flags.prisonYears > 0) && !(state.flags.serviceYears > 0) && !state.career.retired) {
    entry = { kind: 'employment', jobId: state.career.jobId, title: state.career.title, level: state.career.level };
    state.flags.totalYearsWorked = (state.flags.totalYearsWorked || 0) + 1;
  } else if (state.flags.serviceYears > 0) entry = { kind: 'service', jobId: null, title: '기간 복무', level: 0 };
  else if (state.flags.careBreak) entry = { kind: 'care', jobId: null, title: '가족 돌봄', level: 0 };
  if (entry) state.flags.careerLedger.push({ age: state.age, year: state.year, ...entry });
}

function finishLife(state) {
  state.status = 'ended';
  state.pending = null;
  state.settings.auto = false;
  for (const goal of state.goals) if (goal.status === 'active') goal.status = 'ended';
  const estate = Math.max(0, Math.round(assetSnapshot(state).netWorth));
  const charityRate = state.finance.will === 'charity' || state.finance.will === 'scholarship' ? 1 : ['mixed', 'charity20'].includes(state.finance.will) ? 0.2 : 0;
  const charity = Math.floor(estate * charityRate);
  const distribution = [];
  if (charity) distribution.push({ recipient: state.finance.will === 'scholarship' ? '장학 기금' : '공익 기금', amount: charity, kind: 'charity' });
  const livingDescendants = (item, depth = 0) => {
    if (depth > 5) return [];
    if (item.alive) return [item];
    return (Array.isArray(item.children) ? item.children : []).flatMap(child => livingDescendants(child, depth + 1));
  };
  // Own game rule: a spouse and each child's branch have one equal share.
  // This is not an assertion about any country's inheritance law.
  const branches = [
    ...state.family.partners.filter(item => item.alive && item.relation === 'spouse').map(item => [item]),
    ...state.family.children.map(item => livingDescendants(item)).filter(branch => branch.length),
  ];
  const remainder = estate - charity;
  if (branches.length) {
    const share = Math.floor(remainder / branches.length);
    branches.forEach((branch, branchIndex) => {
      const branchShare = share + (branchIndex === 0 ? remainder % branches.length : 0);
      const portion = Math.floor(branchShare / branch.length);
      branch.forEach((item, index) => distribution.push({ recipient: item.name, personId: item.id, amount: portion + (index === 0 ? branchShare % branch.length : 0), kind: 'family' }));
    });
  } else if (remainder) distribution.push({ recipient: '지역 공동 기금', amount: remainder, kind: 'community' });
  const aliveChildren = state.family.children.filter(child => child.alive).length;
  const cause = endingCause(state);
  const career = careerSummary(state);
  const workText = career.representativeTitle ? `${career.representativeTitle} 등 ${career.roles.length}가지 일과 돌봄의 시간을 기록했습니다.` : '배움과 일상, 관계의 시간을 기록했습니다.';
  state.ending = {
    age: state.age, year: state.year, cause, estate, distribution,
    causeConditionId: terminalCondition(state)?.id ?? null,
    summaryVersion: 2, careerSummary: career,
    summary: `${state.name}의 ${state.age}년. ${workText} ${state.family.children.length}명의 자녀와 ${state.family.friends.length}명의 친구를 삶의 기록에 남겼습니다.${career.evidence === 'partial' ? ' 이전 저장의 세부 경력 기간은 일부 미기록입니다.' : ''}`,
    stats: {
      decisions: state.receipts.filter(receipt => receipt.type === 'choose').length,
      yearsWorked: career.totalYears, children: state.family.children.length,
      survivingChildren: aliveChildren, scholarships: state.finance.scholarships,
      scholarshipGraduates: state.flags.scholarshipGraduates || 0,
      happiness: state.stats.happiness, knowledge: state.stats.knowledge,
      countries: [...new Set([state.birthCountryId, state.countryId, ...state.timeline.map(point => point.countryId), ...(state.flags.residenceHistory || []).map(point => point.countryId)])].length,
    },
    cohort: [...projectCohort(state), {
      id: state.lifeId, name: state.name, countryId: state.countryId, age: state.age, lifespan: state.age,
      status: 'ended', player: true, health: state.stats.health, happiness: state.stats.happiness,
      education: structuredClone(state.education), career: structuredClone(state.career),
      finance: { cash: state.finance.cash, debt: state.finance.debt, annualIncome: state.finance.annualIncome, annualExpense: state.finance.annualExpense, netWorth: assetSnapshot(state).netWorth },
      family: { children: state.family.children.length },
    }].sort((a, b) => b.age - a.age),
    source: 'rule', synthetic: true,
  };
  log(state, 'ending', '삶을 돌아볼 시간', `${state.age}세에 삶을 마쳤습니다. ${cause}. 남긴 메모와 선택은 기록에 보존됩니다.`, 'life-ending');
}

function normalizeDraft(state) {
  for (const key of STAT_KEYS) {
    assert(Number.isFinite(state.stats[key]), '생활 계산이 유효하지 않은 수치를 만들었습니다.');
    state.stats[key] = Math.round(clamp(state.stats[key]) * 100) / 100;
  }
  for (const key of MONEY_KEYS) {
    assert(Number.isFinite(state.finance[key]), '생활 계산이 유효하지 않은 금액을 만들었습니다.');
    state.finance[key] = Math.round(clamp(state.finance[key], key === 'cash' ? -MAX_MONEY : 0, MAX_MONEY));
  }
}

function projectPending(state) {
  if (state.settings.reflectionStops && REFLECTION_AGES.includes(state.age) && !(state.flags.reflectedAges || []).includes(state.age)) {
    // A reflection is a player pause, never an automatically selected story.
    // Story eligibility/seen remain untouched and are projected again afterwards.
    return {
      id: `${state.lifeId}:reflection:${state.age}`, kind: 'reflection',
      structure: `milestone-reflection:${state.age}`, title: `${state.age}세, 잠시 돌아보기`,
      body: '지나온 시간을 돌아보고 기억할 말을 남길 수 있습니다. 메모 없이 계속해도 됩니다.',
      choices: [{ id: 'continue', label: '메모 없이 계속' }], source: 'rule',
    };
  }
  return getStoryDecision(isReflection(state) ? { ...state, pending: null } : state);
}

function completeReflection(state, command) {
  if (!isReflection(state) || state.pending.id !== command.decisionId) return { ok: false, error: 'stale_decision', message: '현재 대기 중인 회고가 아닙니다.' };
  if (command.text !== undefined && (typeof command.text !== 'string' || command.text.length > 2000)) return { ok: false, error: 'invalid_note', message: '회고 메모는 2,000자 이내로 입력하세요.' };
  for (const key of ['auto', 'reflectionStops']) {
    if (command[key] !== undefined && typeof command[key] !== 'boolean') return { ok: false, error: 'invalid_setting', message: '회고 뒤의 진행 설정은 켜기 또는 끄기로 지정하세요.' };
  }
  const note = command.text?.trim();
  if (note) {
    if (state.notes.length >= 200) return { ok: false, error: 'note_limit', message: '이 삶에는 메모를 200개까지 보존할 수 있습니다. 메모 없이 회고를 마칠 수 있습니다.' };
    state.notes.push({ id: `${state.lifeId}:note:${state.notes.length}`, age: state.age, year: state.year, text: note, source: 'manual' });
  }
  state.flags.reflectedAges ??= [];
  state.flags.reflectedAges.push(state.age);
  // These settings are explicit completion choices, committed with the note and
  // the acknowledgement in the same transaction. Merely entering a reflection
  // never changes the user's automatic-story preference or answers the pause.
  for (const key of ['auto', 'reflectionStops']) if (command[key] !== undefined) state.settings[key] = command[key];
  state.pending = null;
  return { ok: true, message: note ? '회고 메모를 남겼습니다. 다음 선택을 이어갑니다.' : '회고를 마쳤습니다. 다음 선택을 이어갑니다.' };
}

function advanceYear(state) {
  state.age += 1;
  state.year = state.birthYear + state.age;
  recordCareerYear(state);
  reconcileFocus(state);
  advanceSystems(state);
  advanceWorld(state);
  normalizeDraft(state);
  if (mortality(state)) finishLife(state);
  else state.pending = projectPending(state);
  recordYear(state);
}

function setValue(state, key, value) {
  if (key === 'focus') {
    if (!FOCUSES.includes(value)) return { ok: false, error: 'invalid_setting', message: '지원하지 않는 생활 초점입니다.' };
    if (!focusAvailable(state, value)) return { ok:false, error:'unavailable_focus', message:'현재 생활 단계에서 선택할 수 없는 초점입니다.' };
    if (state.focus === value) return { ok: true, noOp: true, message: '현재 생활 초점을 유지합니다.' };
    recordManualFocus(state, value);
  } else if (key === 'auto' || key === 'sensitive' || key === 'reflectionStops') {
    if (typeof value !== 'boolean') return { ok: false, error: 'invalid_setting', message: '켜기 또는 끄기를 선택하세요.' };
    state.settings[key] = value;
  } else if (key === 'speed') {
    if (!SPEEDS.includes(value)) return { ok: false, error: 'invalid_setting', message: '지원하지 않는 진행 속도입니다.' };
    state.settings.speed = value;
  } else if (key === 'targetMinutes') {
    if (!TARGET_MINUTES.includes(value)) return { ok: false, error: 'invalid_setting', message: '자동 진행 호흡은 기본·30분·60분·90분 중 하나입니다.' };
    state.settings.targetMinutes = value;
  } else if (key === 'comparisonCountry') {
    if (value !== null && !COUNTRIES.some(country => country.id === value)) return { ok: false, error: 'invalid_setting', message: '비교 국가가 올바르지 않습니다.' };
    state.settings.comparisonCountry = value;
  } else if (typeof key === 'string' && key.startsWith('automations.')) {
    const option = key.slice('automations.'.length);
    if (!['certificate', 'tutoring', 'lessons', 'checkup', 'childTuition', 'childMarriage', 'dinner'].includes(option) || typeof value !== 'boolean') return { ok: false, error: 'invalid_setting', message: '자동 지출 설정이 올바르지 않습니다.' };
    state.automations[option] = value;
  } else return { ok: false, error: 'invalid_setting', message: '지원하지 않는 설정입니다.' };
  return { ok: true, message: '설정을 적용했습니다.' };
}

function executeGoal(state, goalId) {
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal || goal.status !== 'active') return { ok: false, error: 'inactive_goal', message: '진행 가능한 계획이 없습니다.' };
  const result = applySystemAction(state, { actionId: goal.steps[goal.cursor] });
  if (!result.ok) return result;
  goal.cursor += 1;
  if (goal.cursor === goal.steps.length) {
    goal.status = 'completed';
    log(state, 'goal', '계획을 마쳤습니다', goal.text, `goal-complete:${goal.id}`);
  }
  return result;
}

function applyCommand(state, command) {
  switch (command.type) {
    case 'advance': {
      if (state.pending) return { ok: false, error: 'pending_decision', message: '현재 결정을 먼저 선택해 주세요.' };
      if (command.years !== undefined && command.years !== 1) return { ok: false, error: 'invalid_duration', message: '직접 진행은 1년 단위입니다. 다음 결정까지 진행을 사용할 수 있습니다.' };
      if (command.untilDecision !== undefined && typeof command.untilDecision !== 'boolean') return { ok: false, error: 'invalid_duration', message: '진행 방식이 올바르지 않습니다.' };
      let elapsed = 0;
      do { advanceYear(state); elapsed += 1; } while (command.untilDecision && state.status === 'alive' && !state.pending && elapsed < MAX_AGE);
      return { ok: true, message: `${elapsed}년이 흘렀습니다.` };
    }
    case 'choose':
      if (!state.pending || state.pending.id !== command.decisionId) return { ok: false, error: 'stale_decision', message: '이미 끝났거나 다른 결정입니다.' };
      if (!state.pending.choices.some(choice => choice.id === command.choiceId)) return { ok: false, error: 'unknown_choice', message: '이 카드에서 고를 수 없는 선택입니다.' };
      if (isReflection(state)) return completeReflection(state, command);
      return resolveStoryDecision(state, command.choiceId);
    case 'reflect': return completeReflection(state, command);
    case 'action':
      if (!text(command.actionId, 120)) return { ok: false, error: 'invalid_action', message: '행동이 올바르지 않습니다.' };
      return command.actionId === 'goal_step' ? executeGoal(state, command.targetId ?? command.value) : applySystemAction(state, command);
    case 'set': return setValue(state, command.key, command.value);
    case 'markHistory': {
      if (typeof command.marked !== 'boolean' || !text(command.historyId, 250)) return { ok: false, error: 'invalid_history_mark', message: '기억할 사건과 표시 여부가 필요합니다.' };
      if (state.history.filter(entry => entry.id === command.historyId).length !== 1) return { ok: false, error: 'missing_history', message: '이 삶의 기록에서 사건을 찾을 수 없습니다.' };
      const marks = state.historyMarks ?? [], present = marks.some(mark => mark.historyId === command.historyId);
      if (present === command.marked) return { ok: true, noOp: true, message: '기억할 순간 표시를 유지합니다.' };
      state.historyMarks = command.marked ? [...marks, { historyId: command.historyId, source: 'manual' }] : marks.filter(mark => mark.historyId !== command.historyId);
      return { ok: true, message: command.marked ? '기억할 순간으로 표시했습니다.' : '기억할 순간 표시를 해제했습니다.' };
    }
    case 'note': {
      if (typeof command.text !== 'string' || command.text.length > 2000) return { ok: false, error: 'invalid_note', message: '메모는 2,000자 이내로 입력하세요.' };
      if (command.noteId !== undefined) {
        const note = state.notes.find(item => item.id === command.noteId);
        if (!note) return { ok: false, error: 'missing_note', message: '수정할 메모가 없습니다.' };
        note.text = command.text.trim();
        note.updatedAge = state.age;
      } else {
        if (!command.text.trim()) return { ok: false, error: 'invalid_note', message: '메모 내용을 입력하세요.' };
        if (state.notes.length >= 200) return { ok: false, error: 'note_limit', message: '이 삶에는 메모를 200개까지 보존할 수 있습니다.' };
        state.notes.push({ id: `${state.lifeId}:note:${state.notes.length}`, age: state.age, year: state.year, text: command.text.trim(), source: 'manual' });
      }
      return { ok: true, message: '메모를 저장했습니다.' };
    }
    case 'goal': {
      if (!text(command.text, 500) || !Array.isArray(command.steps) || command.steps.length < 1 || command.steps.length > 20 || !command.steps.every(step => text(step, 120))) return { ok: false, error: 'invalid_goal', message: '계획 제목과 1~20개의 행동을 지정하세요.' };
      const known = new Set(getSystemActions(state).filter(action => !Object.hasOwn(action, 'options')).map(action => action.id));
      if (!command.steps.every(step => known.has(step))) return { ok: false, error: 'unsupported_goal', message: '이 수동 계획에는 추가 선택값이 필요 없는 행동만 넣을 수 있습니다. 진학·구직 등은 해당 메뉴에서 세부 대상을 선택해 주세요.' };
      if (state.goals.length >= 100) return { ok: false, error: 'goal_limit', message: '이 삶에는 계획을 100개까지 보존할 수 있습니다.' };
      const goal = { id: `${state.lifeId}:goal:${state.goals.length}`, text: command.text.trim(), steps: [...command.steps], cursor: 0, status: 'active', age: state.age, source: 'manual', realAI: false };
      state.goals.push(goal);
      log(state, 'goal', '스스로 정한 계획', goal.text, `goal-start:${goal.id}`);
      return { ok: true, message: '수동 계획을 저장했습니다. 각 행동은 실행 시 다시 조건을 확인합니다.' };
    }
    case 'cancelGoal': {
      const goal = state.goals.find(item => item.id === command.goalId);
      if (!goal || goal.status !== 'active') return { ok: false, error: 'inactive_goal', message: '취소할 진행 중 계획이 없습니다.' };
      goal.status = 'cancelled';
      goal.cancelledAge = state.age;
      return { ok: true, message: '계획을 취소했습니다.' };
    }
    default: return { ok: false, error: 'unsupported_command', message: '지원하지 않는 명령입니다.' };
  }
}

/** Transaction boundary: no failed command, including a late response, mutates input. */
export function transition(state, command) {
  let fingerprint;
  try { validateLife(state); fingerprint = validateCommand(command); }
  catch (error) { return fail(state, 'invalid_input', error.message); }
  if (command.lifeId !== state.lifeId) return fail(state, 'wrong_life', '다른 삶의 명령은 실행할 수 없습니다.');
  const receipt = state.receipts.find(item => item.id === command.id);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) return fail(state, 'id_conflict', '같은 요청 번호에 다른 내용이 들어왔습니다.');
    return { ok: true, state, duplicate: true, message: receipt.message };
  }
  if (command.expectedVersion !== state.version) return fail(state, 'stale_version', '화면 상태가 바뀌었습니다. 최신 상태에서 다시 선택하세요.');
  const endedComparison = state.status === 'ended' && command.type === 'set' && command.key === 'comparisonCountry';
  if (state.status === 'ended' && command.type !== 'note' && !endedComparison) return fail(state, 'life_ended', '끝난 삶에는 작별 메모와 비교 국가를 기록할 수 있습니다. 새 선택은 새 삶에서 계속하세요.');
  if (state.receipts.length >= 10000) return fail(state, 'command_limit', '이 삶의 안전한 명령 보존 한도에 도달했습니다. 기록을 내보내 주세요.');
  try {
    const draft = structuredClone(state);
    const annotationOnly = command.type === 'markHistory';
    if (!annotationOnly && draft.status === 'alive' && draft.flags.careerTrackingStartAge === undefined) draft.flags.careerTrackingStartAge = draft.age;
    const result = applyCommand(draft, command);
    if (!result?.ok) return fail(state, result?.error ?? 'rejected', result?.message ?? '이 행동을 실행할 수 없습니다.');
    // Repeating the current allocation, focus or annotation makes no transaction.
    // Keep the original state, including legacy omissions and the receipt log.
    if (result.noOp === true) return { ok: true, noOp: true, state, message: result.message || '이미 적용된 선택입니다.' };
    if (!annotationOnly) normalizeDraft(draft);
    if (['choose','action'].includes(command.type) && focusStage(state) !== focusStage(draft)) reconcileFocus(draft);
    if (draft.countryId !== state.countryId || draft.city !== state.city) {
      draft.flags.residenceHistory ??= [{ age: state.age, year: state.year, countryId: state.countryId, city: state.city }];
      draft.flags.residenceHistory.push({ age: draft.age, year: draft.year, countryId: draft.countryId, city: draft.city });
    }
    // A tuition action, treatment, new relationship, or disabled child decision
    // can invalidate the open card. Re-project eligible choices after a real
    // condition change, preserving the card ID while its premise still holds.
    if (draft.status === 'alive' && ['choose', 'reflect', 'action', 'set'].includes(command.type)) draft.pending = projectPending(draft);
    draft.version += 1;
    draft.receipts.push({ id: command.id, fingerprint, type: command.type, age: draft.age, version: draft.version, message: result.message || '적용했습니다.' });
    if (draft.status === 'alive' && !annotationOnly) recordYear(draft);
    validateLife(draft);
    return { ok: true, state: draft, message: result.message || '적용했습니다.' };
  } catch (error) { return fail(state, 'invalid_transition', `상태를 보존했습니다. ${error.message}`); }
}

/** Pure menu projection. Visiting tabs never rolls RNG or changes gameplay. */
export function getAvailableActions(state) {
  validateLife(state);
  if (state.status === 'ended') return [];
  const actions = structuredClone(getSystemActions(state));
  const goals = state.goals.filter(goal => goal.status === 'active');
  if (goals.length) actions.push({ id: 'goal_step', group: 'plans', label: '계획의 다음 행동', description: '선택한 수동 계획의 한 단계를 현재 조건으로 실행합니다.', cost: 0, options: goals.map(goal => ({ value: goal.id, label: `${goal.text} (${goal.cursor + 1}/${goal.steps.length})` })) });
  return actions;
}
