import { JOBS } from '../src/game/world.mjs';
import { CAREER_INTEREST_PREFIX } from '../src/game/career-interest.mjs';
import { WORK_STUDY_REVIEW_PREFIX } from '../src/game/school.mjs';
import { presentWorkStudyResult } from './learning-presentation.mjs';

/** Display only: never rewrite pending decisions, past records, or rule inputs. */
export function presentDecision(state, pending = state.pending) {
  if (!pending) return null;
  const view = { ...pending, choices: pending.choices.map(choice => ({ ...choice })) };
  if (pending.structure === 'adult-transition') {
    const working = Boolean(state.career.jobId);
    const returning = Boolean(state.flags.careerHistory?.length);
    const study = state.education.program;
    const context = [working ? `지금은 ‘${state.career.title}’ 일을 하고 있습니다.` : returning ? '일했던 경험을 바탕으로 다음 진로를 생각합니다.' : '앞으로 어떤 일을 하며 지낼지 생각해 봅니다.'];
    if (study) context.push(`${study.label} 과정은 ${state.flags.educationOnLeave ? '휴학 중입니다.' : state.flags.educationPaused ? '학비가 부족해 수강을 보류한 상태입니다.' : '공부를 이어 가는 중입니다.'}`);
    else if (state.flags.schoolAttendance === 'stopped') context.push('학업을 멈춘 뒤, 지금의 학력과 형편에서 가능한 길을 살펴봅니다.');
    const educationOffered = view.choices.some(choice => ['university', 'loan', 'training'].includes(choice.id));
    context.push(educationOffered
      ? '아래 교육 과정의 비용은 첫해 기준이며, 재학 중에는 해마다 학비가 듭니다.'
      : '지금 할 수 있는 선택부터 살펴보세요. 배움의 길은 교육 메뉴에서 필요한 조건을 확인할 수 있습니다.');
    view.body = context.join(' ');
    const work = view.choices.find(choice => choice.id === 'work');
    if (work) {
      const title = JOBS.find(job => job.id === 'labor').label;
      work.label = working ? `${title} 일로 옮긴다` : returning ? `${title}로 다시 일을 시작한다` : `${title}로 첫 일을 시작한다`;
      work.description = working ? '현재 일을 마치고 새 일의 첫 직급에서 시작합니다.' : '선택하면 이 일을 시작합니다. 급여는 다음 해 정산에 반영됩니다.';
    }
  } else if (pending.structure?.startsWith(CAREER_INTEREST_PREFIX)) {
    const requestedAge = Number(pending.structure.slice(CAREER_INTEREST_PREFIX.length));
    if (Number.isInteger(requestedAge) && requestedAge >= 18) {
      view.body = `${requestedAge}세에 관심을 두고 알아본 일들입니다. 지금까지의 배움과 취미가 어떤 일로 이어질지 살펴봅니다. 아래 자격 조건을 갖추면 새 일의 첫 직급에서 시작합니다. 준비가 부족하거나 지금은 미루기로 했다면 현재 생활을 이어 갑니다.`;
      const current = view.choices.find(choice => choice.id === state.career.jobId);
      if (current) {
        current.label = `지금의 ${state.career.title} 일을 이어 간다`;
        current.description = '이미 시작한 일입니다. 현재 직급·근무 경력·급여를 그대로 유지합니다.';
        const otherCandidates = view.choices.some(choice => choice !== current && choice.id !== 'later');
        view.body = `${requestedAge}세에 관심을 두고 알아본 일 중 ‘${state.career.title}’ 일을 이미 시작했습니다. ${otherCandidates ? '지금의 일은 현재 경력을 이어 갑니다. 다른 일에 지원할 때는 아래 자격 조건을 갖추면 새 일의 첫 직급에서 시작합니다.' : '지금의 일을 이어 갈지, 이번 탐색을 보류할지 고릅니다.'}`;
      }
    }
  } else if (pending.structure?.startsWith(WORK_STUDY_REVIEW_PREFIX)) {
    const attempt=state.flags.nightSchoolAttempts?.find(item=>item.version===2&&WORK_STUDY_REVIEW_PREFIX+item.appliedAge===pending.structure);
    const body=presentWorkStudyResult(state,attempt);
    if(body)view.body=body;
    const next=view.choices.find(choice=>choice.id==='plan-next');
    if(next)next.description='학업 선택에서 비용과 기간을 비교합니다. 새로 신청하기 전에는 지출하지 않습니다.';
  } else if (pending.structure === 'doctoral-invitation') {
    view.body = '해외에서 석사 과정을 마친 뒤, 연구를 더 이어 갈지 생각합니다. 박사 과정에 지원하거나 자료를 모으며 다음 진로를 준비할 수 있습니다.';
  } else if (pending.structure === 'business-handover') {
    const sale = view.choices.find(choice => choice.id === 'sale');
    if (sale) sale.description = '운영하던 사업을 정리하고 정리 자금을 받습니다.';
  }
  return view;
}
