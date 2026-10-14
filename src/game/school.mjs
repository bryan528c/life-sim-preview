import { getEnvironment } from './world.mjs';
import { clamp, money } from './shared.mjs';

// Authored game rules: observed outcomes do not establish real tuition, wages,
// employment law, or the reference game's probabilities.
export const SCHOOL_ENTRY = 'school-entry:secondary';
export const EARLY_JOBS = Object.freeze(['labor','farmer','domestic']);
export function schoolEntryAvailable(s) {
  return s.status === 'alive' && s.age >= 12 && s.age <= 15
    && s.education.level === 'primary' && !s.education.program
    && s.flags.schoolAttendance !== 'stopped' && !s.career.jobId
    && !s.seen.includes('middle-school') && !s.seen.includes(SCHOOL_ENTRY)
    && s.pending?.structure !== 'middle-school';
}
export function schoolEntryQuote(s) {
  const env = getEnvironment(s.countryId,{year:s.year,mode:s.mode,city:s.city,household:s.household});
  const cost = Math.round(env.income * .4);
  return {cost, cash:s.finance.cash, affordable:s.finance.cash >= cost};
}
export function resolveSchoolEntry(s, choice) {
  if (!schoolEntryAvailable(s) || !['continue','family-work'].includes(choice)) return {ok:false,error:'현재 선택할 수 없는 진학 결정입니다.'};
  const q = schoolEntryQuote(s), funded = choice === 'continue' && q.affordable;
  const income = choice === 'family-work' ? Math.round(q.cost * .05) : 0;
  const outcome = funded ? 'funded' : choice === 'continue' ? 'insufficient-funds' : 'family-work';
  const entry = {version:1,age:s.age,year:s.year,requiredCost:q.cost,availableCash:q.cash,paidCost:funded?q.cost:0,income,outcome,source:'rule',synthetic:true};
  s.flags.schoolWorkPolicyVersion = 1;
  s.flags.schoolEntry = entry;
  s.education.history.push({id:SCHOOL_ENTRY,...entry,result:outcome,...(funded?{level:'secondary'}:{})});
  if (funded) {
    s.finance.cash -= q.cost;
    s.education.level = 'secondary';
    s.flags.schoolAttendance = 'regular';
    s.stats.knowledge = clamp(s.stats.knowledge + 10);
    return {ok:true,admitted:true,message:`진학 준비비 ${money(q.cost)}를 마련해 중등 교육을 이어 갑니다. 학비·교복·교통 준비에 한 번 지출했습니다.`};
  }
  s.flags.schoolAttendance = 'stopped';
  s.finance.cash += income;
  return {ok:true,admitted:false,message:choice === 'continue'
    ? `학비를 마련하지 못해 중등 진학을 이어 가지 못했습니다. 필요한 준비비는 ${money(q.cost)}, 가진 돈은 ${money(q.cash)}였습니다. 비용을 차감하지 않았고 초등 학력은 남습니다.`
    : `학교 밖에서 가족의 일을 돕기로 했습니다. 이번 일의 수입 ${money(income)}를 받았고 초등 학력은 남습니다. 정식 일자리를 정한 것은 아닙니다.`};
}
export function earlyWorkEligible(s) {
  return s.status === 'alive' && s.age >= 15 && s.age < 18
    && s.flags.schoolAttendance === 'stopped' && !s.education.program;
}
