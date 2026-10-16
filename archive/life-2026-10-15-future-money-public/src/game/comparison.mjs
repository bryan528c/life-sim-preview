import { COUNTRIES, getEnvironment } from './world.mjs';

// A deliberately separate explanatory model. These are authored game values,
// not measured country life tables, the original game's formula, or the hazard
// used to resolve an individual life. Never sample or advance a life here.
const RULE_ID = 'synthetic-country-survival-v1';
const MIN_RISK = 0.00001;
const MAX_RISK = 0.95;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validCity = value => ['urban', 'rural'].includes(value);
const validHousehold = value => ['low', 'middle', 'high'].includes(value);

function country(id) {
  const result = COUNTRIES.find(item => item.id === id);
  if (!result) throw new TypeError('생존 비교 국가가 올바르지 않습니다.');
  return result;
}

function annualRisk(age, health) {
  const base = age === 0 ? 0.006 : age < 5 ? 0.0015 : age < 45 ? 0.0005 : age < 60 ? 0.0015 : 0.003 * Math.exp((age - 60) / 9);
  const environmentFactor = clamp(Math.exp((70 - health) / 30), 0.35, 3);
  return clamp(base * environmentFactor, MIN_RISK, MAX_RISK);
}

function curve(selectedCountry, role, conditions, lastAge) {
  const points = [{ age: 0, year: conditions.birthYear, annualDeathRisk: null, survival: 1, percent: 100 }];
  let survival = 1;
  for (let age = 1; age <= lastAge; age++) {
    // q(a) is the risk over [a,a+1), evaluated at the start of that year.
    const environment = getEnvironment(selectedCountry.id, {
      year: conditions.birthYear + age - 1, mode: conditions.mode,
      city: conditions.city, household: conditions.household,
    });
    const annualDeathRisk = annualRisk(age - 1, environment.health);
    survival *= 1 - annualDeathRisk;
    points.push({ age, year: conditions.birthYear + age, annualDeathRisk, survival, percent: survival * 100 });
  }
  return {
    role, countryId: selectedCountry.id, countryName: selectedCountry.name, points,
    checkpoints: { birth: { ...points[0] }, ageFive: lastAge >= 5 ? { ...points[5] } : null, latest: { ...points.at(-1) } },
  };
}

/**
 * Read-only, deterministic expected survival proportions for two synthetic
 * environments. Ratios use 0..1; `percent` uses 0..100. No future-age points,
 * personal-health adjustments, cohort observations, RNG, storage, or I/O.
 * Valid engine states are expected. Missing legacy selection returns null.
 */
export function getCountrySurvivalComparison(state) {
  if (state?.settings?.comparisonCountry == null || state.settings.comparisonCountry === '') return null;
  const birth = country(state.birthCountryId);
  const comparison = country(state.settings.comparisonCountry);
  if (!Number.isInteger(state.age) || state.age < 0 || state.age > 110 || !Number.isInteger(state.birthYear) || state.birthYear < 1900 || state.birthYear > 2200 || !['present', 'past', 'future'].includes(state.mode) || !['alive', 'ended'].includes(state.status)) {
    throw new TypeError('생존 비교의 나이·출생 연도·상태가 올바르지 않습니다.');
  }
  if (state.status === 'ended' && state.ending?.age !== state.age) {
    throw new TypeError('생존 비교의 종료 나이와 기록이 일치하지 않습니다.');
  }
  const birthPoint = state.timeline?.find(point => point?.age === 0);
  const hasBirthConditions = validCity(birthPoint?.city) && validHousehold(birthPoint?.household);
  const city = hasBirthConditions ? birthPoint.city : state.city;
  const household = hasBirthConditions ? birthPoint.household : state.household;
  if (!validCity(city) || !validHousehold(household)) throw new TypeError('생존 비교의 도시·가계 조건이 올바르지 않습니다.');
  const conditions = {
    birthYear: state.birthYear, mode: state.mode, city, household,
    basis: hasBirthConditions ? 'birth-snapshot' : 'legacy-current-fallback',
  };
  const explanation = '같은 출생 연도·도시/농촌·가계 조건을 두 국가에 고정하고, 각 연도의 합성 건강 환경과 자체 연간 사망 위험으로 누적 생존 비율을 계산합니다. 실제 국가 생존 통계나 개인의 생존 예측, 원작 산식이 아니며 동시 출생 5인의 실제 게임 표본과 별개입니다. 출생 100%에서 시작해 현재 또는 사망 나이까지만 표시합니다.';
  return {
    source: 'rule', synthetic: true, realStatistics: false, personalPrediction: false,
    originalFormulaVerified: false, cohortSample: false, ruleId: RULE_ID,
    label: '국가 환경별 합성 생존 비율',
    explanation: explanation + (hasBirthConditions ? '' : ' 이전 저장에 출생 당시 도시·가계 조건이 없어 현재 조건을 두 국가에 동일하게 적용했습니다.'),
    conditions, age: state.age, status: state.status,
    model: {
      ruleId: RULE_ID, source: 'rule', synthetic: true, ratioUnit: '0..1', percentUnit: '0..100',
      interval: 'q(a)는 a세부터 a+1세까지의 위험이며 출생 연도+a의 합성 환경을 사용합니다.',
      baseAnnualRisk: [
        { fromAge: 0, throughAge: 0, value: 0.006 },
        { fromAge: 1, throughAge: 4, value: 0.0015 },
        { fromAge: 5, throughAge: 44, value: 0.0005 },
        { fromAge: 45, throughAge: 59, value: 0.0015 },
        { fromAge: 60, throughAge: 109, formula: '0.003 * exp((a - 60) / 9)' },
      ],
      environmentFactor: 'clamp(exp((70 - syntheticEnvironmentHealth) / 30), 0.35, 3)',
      annualDeathRisk: 'q(a) = clamp(baseAnnualRisk(a) * environmentFactor(a), 0.00001, 0.95)',
      survival: 'S(0) = 1; S(a + 1) = S(a) * (1 - q(a))',
      fixedConditions: ['birthYear', 'mode', 'city', 'household'],
      excluded: ['individual-health', 'choices', 'migration', 'gender', 'rng', 'five-person-cohort', 'demographic-reference-weights'],
    },
    series: [curve(birth, 'birth', conditions, state.age), curve(comparison, 'comparison', conditions, state.age)],
  };
}
