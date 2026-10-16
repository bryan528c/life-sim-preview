import { getEnvironment, JOBS } from './world.mjs';
import { clamp, money, log } from './shared.mjs';

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

export const NIGHT_SCHOOL = 'night-equivalency';
export const NIGHT_SCHOOL_COST = 300;
const NEXT_LEVEL = {none:'primary',primary:'secondary',secondary:'highschool'};
const LEVEL_LABEL = {primary:'초등',secondary:'중학교',highschool:'고등학교'};
// Selected from the preserved v7 experiment. These are authored rules, not
// new age/training policies. Version-1 preparations retain their original +4.
export const WORK_STUDY_PLANS = Object.freeze([
  Object.freeze({id:'steady',label:'기본 교재로 차근차근',cost:300,knowledgeGain:4,description:'준비비를 아끼며 기본 교재와 문제로 공부합니다.'}),
  Object.freeze({id:'practice',label:'추가 교재와 연습에 투자',cost:600,knowledgeGain:8,description:'추가 교재와 모의문제를 마련해 준비 지식을 더 쌓습니다.'})
]);
export const WORK_STUDY_REVIEW_PREFIX = 'work-study-result:';
export function workStudyReason(s) {
  // The existing attempt validator already rejects two applications at one age.
  // Expose that boundary for the new plans; do not add a new waiting period.
  return nightSchoolReason(s)||(!s.career.jobId||s.career.retired?'유급 일을 시작한 뒤 병행 계획을 고를 수 있습니다.':null)
    ||(s.flags.nightSchoolAttempts?.at(-1)?.appliedAge===s.age?'올해 이미 시험 준비를 시작했습니다. 다음 해에 다시 신청합니다.':null);
}
export function workStudyQuote(s,id) {
  const plan=WORK_STUDY_PLANS.find(p=>p.id===id);
  if(!plan)return null;
  return {...plan,years:1,dueAge:s.age+1,target:nightSchoolTarget(s),targetLabel:LEVEL_LABEL[nightSchoolTarget(s)]??'다음',cash:s.finance.cash,remainingCash:s.finance.cash-plan.cost,knowledge:s.stats.knowledge,
    disabledReason:workStudyReason(s)||(s.finance.cash<plan.cost?`${money(plan.cost)}가 필요합니다.`:null)};
}
// Only an already-saved v7 decision needs this extra confirmation. New results
// use the existing learning history, without introducing another required click.
export function dueWorkStudyReview(s) {
  return s.flags.nightSchoolAttempts?.find(r=>r.version===2&&r.result&&r.result.outcome!=='withdrawn'&&!r.review&&s.pending?.structure===WORK_STUDY_REVIEW_PREFIX+r.appliedAge)??null;
}
export function reviewWorkStudy(s,choiceId) {
  const attempt=dueWorkStudyReview(s);
  if(!attempt||!['continue','plan-next'].includes(choiceId)||(choiceId==='plan-next'&&!nightSchoolTarget(s)))return {ok:false,error:'현재 확인할 학업 계획 결과가 없습니다.'};
  attempt.review={age:s.age,choiceId,source:'rule'};
  return {ok:true,message:choiceId==='plan-next'?'시험 결과를 바탕으로 다음 준비 방법을 살펴보기로 했습니다. 새 계획을 고르기 전에는 비용이 들지 않습니다.':'시험 결과를 기록하고 지금의 생활을 이어 가기로 했습니다. 새 준비비는 지출하지 않았습니다.'};
}
export function nightSchoolTarget(s) { return NEXT_LEVEL[s.education.level] ?? null; }
export function nightSchoolReason(s) {
  if(s.status!=='alive')return '종료된 생애입니다.';
  if(s.age<18)return '18세부터 준비할 수 있습니다.';
  if(s.age>=110)return '새로운 1년 과정을 시작할 수 있는 나이를 지났습니다.';
  if(s.education.program)return '진행 중인 과정을 마치거나 중단한 뒤 신청합니다.';
  if(!nightSchoolTarget(s))return '이미 고등 과정 이상의 학력이 있습니다.';
  if(s.flags.serviceYears>0||s.flags.prisonYears>0)return '복무·수감 기간을 마친 뒤 준비할 수 있습니다.';
  return null;
}
export function nightSchoolDescription(s) {
  const target=nightSchoolTarget(s);
  return `1년을 준비한 뒤 ${target?LEVEL_LABEL[target]+' 학력':'다음 학력'} 시험을 봅니다. 준비비는 한 번 납부하며 일을 병행할 수 있습니다. 자체 규칙: 준비 지식 +4, 시험 때 지식 35 이상 합격. 불합격해도 이전 학력과 직업은 유지됩니다.`;
}
// The action transaction charges the displayed fee exactly once before this runs.
export function startNightSchool(s,planId) {
  const plan=planId===undefined?null:WORK_STUDY_PLANS.find(p=>p.id===planId);
  if(planId!==undefined&&!plan)return {ok:false,error:'알 수 없는 병행 계획입니다.'};
  const reason=plan?workStudyReason(s):nightSchoolReason(s);if(reason)return {ok:false,error:reason};
  const targetLevel=nightSchoolTarget(s);
  s.flags.nightSchoolAttempts??=[];
  s.flags.nightSchoolAttempts.push({version:plan?2:1,appliedAge:s.age,appliedYear:s.year,dueAge:s.age+1,fromLevel:s.education.level,targetLevel,paidCost:plan?.cost??NIGHT_SCHOOL_COST,result:null,source:'rule',synthetic:true,...(plan?{plan:{id:plan.id,jobId:s.career.jobId},review:null}:{})});
  s.education.program={id:NIGHT_SCHOOL,label:`${LEVEL_LABEL[targetLevel]} 학력 시험 준비`,degree:targetLevel,field:'general',years:1,cost:0};
  s.education.yearsLeft=1;s.flags.educationFunding='self';s.flags.educationPaused=false;s.flags.educationOnLeave=false;s.flags.educationPausedYears=0;
  delete s.flags.educationProgressAge;delete s.flags.educationPauseStartedAge;
  return {ok:true,message:plan?`‘${plan.label}’ 계획을 시작했습니다. ${money(plan.cost)}를 한 번 냈고 ${s.age+1}세에 ${LEVEL_LABEL[targetLevel]} 학력 시험을 봅니다. 현재 일과 학력은 유지합니다.`:`야간학교·검정고시 준비를 시작했습니다. 준비비 ${money(NIGHT_SCHOOL_COST)}를 한 번 냈습니다. 현재 학력과 일은 유지하고, 1년을 마친 뒤 ${LEVEL_LABEL[targetLevel]} 학력 시험을 봅니다.`};
}
function finishNightSchool(s,outcome,knowledgeBefore,knowledgeGain) {
  const attempt=s.flags.nightSchoolAttempts.at(-1),degree=outcome==='passed'?attempt.targetLevel:null;
  attempt.result={age:s.age,year:s.year,outcome,degree,knowledgeBefore,knowledgeGain};
  s.education.history.push({id:NIGHT_SCHOOL,age:s.age,year:s.year,appliedAge:attempt.appliedAge,degree,result:outcome,source:'rule',synthetic:true});
  if(degree)s.education.level=degree;
  s.education.program=null;s.education.yearsLeft=0;s.flags.educationFunding='self';s.flags.educationOnLeave=false;s.flags.educationPaused=false;s.flags.educationPausedYears=0;
  delete s.flags.educationPauseStartedAge;
}
export function withdrawNightSchool(s) {
  if(s.education.program?.id!==NIGHT_SCHOOL)return {ok:false,error:'준비 중인 학력 시험이 없습니다.'};
  finishNightSchool(s,'withdrawn',s.stats.knowledge,0);
  return {ok:true,message:'시험 준비를 중단했습니다. 이전 학력과 일은 유지하며, 납부한 준비비는 돌려받지 않습니다.'};
}
export function advanceNightSchool(s) {
  if(s.education.program?.id!==NIGHT_SCHOOL||s.flags.educationOnLeave||s.flags.educationProgressAge===s.age)return;
  const attempt=s.flags.nightSchoolAttempts.at(-1);
  if(attempt.result||s.age<attempt.dueAge)return;
  if(s.flags.serviceYears>0||s.flags.prisonYears>0) {
    if(attempt.lastInterruptedAge!==s.age){attempt.lastInterruptedAge=s.age;log(s,'education','시험 준비 보류','복무·수감으로 이번 해의 준비와 시험을 보류했습니다. 남은 1년과 이미 낸 준비비는 보존합니다.','night-school-interrupted');}
    return;
  }
  const gain=attempt.version===2?WORK_STUDY_PLANS.find(p=>p.id===attempt.plan.id).knowledgeGain:4;
  const before=s.stats.knowledge;s.stats.knowledge=clamp(before+gain);const passed=s.stats.knowledge>=35,target=attempt.targetLevel;
  s.flags.educationProgressAge=s.age;
  finishNightSchool(s,passed?'passed':'failed',before,s.stats.knowledge-before);
  log(s,'education',passed?'학력 시험 합격':'학력 시험 불합격',passed
    ? `1년의 준비 뒤 ${LEVEL_LABEL[target]} 학력 시험에 합격했습니다. 일과 경력은 이어 갑니다.`
    : '1년을 준비했지만 이번 학력 시험에는 합격하지 못했습니다. 이전 학력과 일을 유지하고 준비한 경험을 남겼습니다. 다시 신청하면 다음 1년을 준비합니다.','night-school-result');
}
export function validateNightSchool(s) {
  const records=s.flags.nightSchoolAttempts,active=s.education.program?.id===NIGHT_SCHOOL;
  const fail=()=>{throw new Error('야간학교·검정고시 기록이 올바르지 않습니다.');};
  if(records===undefined){if(active||s.pending?.structure?.startsWith(WORK_STUDY_REVIEW_PREFIX))fail();return;}
  const number=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
  if(!Array.isArray(records)||!records.length||records.length>100)fail();
  let previous=null;
  for(const r of records) {
    const plan=r?.version===2?WORK_STUDY_PLANS.find(p=>p.id===r.plan?.id):null;
    if(!r||![1,2].includes(r.version)||r.source!=='rule'||r.synthetic!==true||!number(r.appliedAge,18,109)||r.appliedAge>s.age||r.appliedYear!==s.birthYear+r.appliedAge||r.dueAge!==r.appliedAge+1||NEXT_LEVEL[r.fromLevel]!==r.targetLevel||!r.targetLevel||r.paidCost!==(plan?.cost??NIGHT_SCHOOL_COST))fail();
    if(r.version===1&&(r.plan!==undefined||r.review!==undefined))fail();
    if(r.version===2){
      const allowed=['version','appliedAge','appliedYear','dueAge','fromLevel','targetLevel','paidCost','result','source','synthetic','plan','review','lastInterruptedAge'];
      if(!plan||!JOBS.some(j=>j.id===r.plan.jobId)||!Object.hasOwn(r,'review')||Object.keys(r).some(k=>!allowed.includes(k))||Object.keys(r.plan).sort().join(',')!=='id,jobId')fail();
    }
    if(previous&&(!previous.result||r.appliedAge<=previous.appliedAge||r.appliedAge<previous.result.age))fail();
    if(r.lastInterruptedAge!==undefined&&!number(r.lastInterruptedAge,r.dueAge,s.age))fail();
    if(r.result!==null) {
      const x=r.result;if(!x||!number(x.age,x.outcome==='withdrawn'?r.appliedAge:r.dueAge,s.age)||x.year!==s.birthYear+x.age||!['passed','failed','withdrawn'].includes(x.outcome)||!Number.isFinite(x.knowledgeBefore)||x.knowledgeBefore<0||x.knowledgeBefore>100)fail();
      if(!Number.isFinite(x.knowledgeGain)||Math.abs(x.knowledgeGain-(x.outcome==='withdrawn'?0:Math.min(plan?.knowledgeGain??4,100-x.knowledgeBefore)))>1e-8)fail();
      if(x.degree!==(x.outcome==='passed'?r.targetLevel:null)||(x.outcome!=='withdrawn'&&(x.outcome==='passed')!==(x.knowledgeBefore+x.knowledgeGain>=35)))fail();
      if(r.version===2){
        if(Object.keys(x).sort().join(',')!=='age,degree,knowledgeBefore,knowledgeGain,outcome,year')fail();
        const matching=s.education.history.filter(h=>h.id===NIGHT_SCHOOL&&h.appliedAge===r.appliedAge);
        if(matching.length!==1||matching[0].result!==x.outcome||matching[0].degree!==x.degree||matching[0].age!==x.age||matching[0].year!==x.year||matching[0].source!=='rule'||matching[0].synthetic!==true)fail();
      }
    }
    if(r.version===2&&r.review!==null){
      const v=r.review;
      if(!v||!r.result||r.result.outcome==='withdrawn'||!number(v.age,r.result.age,s.age)||!['continue','plan-next'].includes(v.choiceId)||v.source!=='rule'||(v.choiceId==='plan-next'&&r.result.degree==='highschool')||Object.keys(v).sort().join(',')!=='age,choiceId,source')fail();
      if(!s.history.some(h=>h.structure===WORK_STUDY_REVIEW_PREFIX+r.appliedAge&&h.age===v.age))fail();
    }
    previous=r;
  }
  if(active!==(previous.result===null))fail();
  if(active&&(s.education.level!==previous.fromLevel||s.education.program.degree!==previous.targetLevel||s.education.program.years!==1||s.education.program.cost!==0||s.education.yearsLeft!==1))fail();
  if(s.pending?.structure?.startsWith(WORK_STUDY_REVIEW_PREFIX)){
    const r=dueWorkStudyReview(s),ids=r&&nightSchoolTarget(s)?['continue','plan-next']:['continue'];
    if(!r||s.pending.id!==`${s.lifeId}:story:${WORK_STUDY_REVIEW_PREFIX}${r.appliedAge}`||s.pending.kind!=='education'||s.pending.source!=='rule'||s.seen.includes(s.pending.structure)||JSON.stringify(s.pending.choices.map(c=>c.id))!==JSON.stringify(ids))fail();
  }
}
