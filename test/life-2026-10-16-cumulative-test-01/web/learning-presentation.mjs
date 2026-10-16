import { WORK_STUDY_PLANS } from '../src/game/school.mjs';
import { JOBS } from '../src/game/world.mjs';

// Read existing evidence only. Rendering must never advance, resolve or rewrite a life.
const LEVELS = { none:'학력 없음', primary:'초등', secondary:'중학교', high:'고등학교', highschool:'고등학교', vocational:'직업 교육', certificate:'직업 교육', bachelor:'학사', master:'석사', doctorate:'박사' };
const level = value => LEVELS[value] ?? '기록된 학력';
const when = (age, year) => `${year}년 · ${age}세`;
const money = value => `${new Intl.NumberFormat('ko-KR').format(value)} G`;

export function presentWorkStudyResult(state, attempt) {
  const plan=WORK_STUDY_PLANS.find(item=>item.id===attempt?.plan?.id),result=attempt?.result;
  if(!plan||!result||result.outcome==='withdrawn')return null;
  const work=state.career.retired?'현재는 은퇴 생활 중입니다.':state.career.jobId===attempt.plan.jobId?'신청 당시의 일을 지금도 이어 가고 있습니다.':state.career.jobId?`신청 이후 일자리가 바뀌었으며 현재 직업은 ${state.career.title}입니다.`:'현재 정해진 유급 일자리는 없습니다.';
  return `${attempt.appliedAge}세에 ‘${plan.label}’을 선택하고 준비비 ${money(attempt.paidCost)}를 한 번 냈습니다. ${result.age}세 시험에서 지식 ${Number(result.knowledgeBefore.toFixed(1))}에 준비 지식 ${Number(result.knowledgeGain.toFixed(1))}이 반영됐고, ${result.outcome==='passed'?`${level(result.degree)} 학력 시험에 합격했습니다.`:'이번에는 합격하지 못했습니다. 이전 학력은 유지됐습니다.'} ${work}`;
}

function activePreparation(state, attempt) {
  if (state.status !== 'alive') return {label:'생애 종료', text:'이 삶은 시험 결과가 기록되기 전에 끝났습니다. 합격이나 불합격으로 처리하지 않습니다.'};
  if (state.flags.educationOnLeave) return {label:'휴학 중', text:'준비를 쉬고 있습니다. 남은 준비 1년과 이미 낸 준비비는 보존됩니다. 복학 뒤 연간 경과에서 이어 갑니다.'};
  if (state.flags.serviceYears > 0 || state.flags.prisonYears > 0) return {label:'준비 보류', text:'복무·수감 중에는 준비와 시험을 보류합니다. 그 기간을 마친 뒤 연간 경과에서 다시 확인합니다.'};
  if (state.flags.educationPaused) return {label:'준비 보류', text:'현재 학업이 보류된 상태입니다. 아래 학업 선택에서 재개할 수 있는 조건을 확인하세요.'};
  if (state.age >= attempt.dueAge) return {label:'준비 이어가기', text:'처음 예정한 시점은 지났지만 아직 시험 결과가 없습니다. 남은 준비는 다음 연간 경과에서 확인합니다.'};
  return {label:'준비 중', text:`한 해를 준비하는 과정입니다. 처음 예정한 시점은 ${when(attempt.dueAge, attempt.appliedYear + 1)}이며, 휴학이나 보류가 생기면 늦어질 수 있습니다.`};
}

function attemptView(state, attempt, index) {
  const result = attempt.result;
  const plan = attempt.version === 2 ? WORK_STUDY_PLANS.find(item=>item.id===attempt.plan.id) : null;
  const planText = plan ? ` 고른 방법은 ‘${plan.label}’이며 준비 지식은 최대 +${plan.knowledgeGain}입니다. 신청 당시 직업은 ${JOBS.find(job=>job.id===attempt.plan.jobId)?.label ?? '기록된 일'}입니다.` : '';
  const application = `${when(attempt.appliedAge, attempt.appliedYear)}에 ${level(attempt.fromLevel)} 학력에서 ${level(attempt.targetLevel)} 학력 시험을 신청했습니다. 준비비 ${money(attempt.paidCost)}를 한 번 냈습니다.${planText}`;
  if (!result) {
    const preparation = activePreparation(state, attempt);
    return { key:`night-equivalency:${attempt.appliedYear}:${attempt.appliedAge}`, number:index+1, status:preparation.label,
      steps:[{label:'신청',text:application},{label:preparation.label,text:preparation.text},{label:'결과',text:'아직 시험 결과가 기록되지 않았습니다.'}] };
  }
  const status = {passed:'합격',failed:'불합격',withdrawn:'준비 중단'}[result.outcome];
  const conclusion = result.outcome === 'passed'
    ? `${when(result.age, result.year)}에 합격해 ${level(result.degree)} 학력을 얻었습니다.`
    : result.outcome === 'failed'
      ? `${when(result.age, result.year)}의 시험에는 합격하지 못했습니다. 이 시험으로 학력이 바뀌지는 않았습니다.`
      : `${when(result.age, result.year)}에 준비를 중단했습니다. 이 신청에서는 시험을 보지 않았고, 납부한 준비비는 반환되지 않았습니다.`;
  const elapsed = result.age - attempt.appliedAge;
  return { key:`night-equivalency:${attempt.appliedYear}:${attempt.appliedAge}`, number:index+1, status,
    steps:[{label:'신청',text:application},{label:'경과',text:elapsed === 0 ? '신청한 해에 이 준비를 마쳤습니다.' : `신청 후 ${elapsed}년이 지나 아래 결과가 기록됐습니다.`},{label:status,text:conclusion + (plan && result.outcome !== 'withdrawn' ? ` 이 준비에서 얻은 지식은 +${Number(result.knowledgeGain.toFixed(1))}이며, 시험 직전 ${Number(result.knowledgeBefore.toFixed(1))}에서 ${Number((result.knowledgeBefore+result.knowledgeGain).toFixed(1))}이 됐습니다.` : '')}] };
}

export function presentNightSchool(state) {
  const attempts = state.flags.nightSchoolAttempts;
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const work = state.career.retired ? '현재는 은퇴 생활 중입니다.' : state.career.jobId ? `현재 직업은 ${state.career.title}입니다.` : '현재 정해진 직업은 없습니다.';
  return { title:'학력 시험의 흐름', context:`현재 학력은 ${level(state.education.level)}입니다. ${work}`,
    attempts:attempts.map((attempt,index)=>attemptView(state,attempt,index)),
    hint:state.status === 'alive' ? '다음 학업 선택은 아래에서 현재 가능한 조건과 함께 확인할 수 있습니다.' : '이 삶의 신청과 결과를 기록으로 보관합니다.' };
}
