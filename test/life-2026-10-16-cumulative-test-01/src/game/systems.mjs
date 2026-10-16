import { reconcileFocus } from './focus.mjs';
import { earlyWorkEligible, EARLY_JOBS, NIGHT_SCHOOL, NIGHT_SCHOOL_COST, nightSchoolReason, nightSchoolDescription, startNightSchool, advanceNightSchool, withdrawNightSchool, WORK_STUDY_PLANS, workStudyReason } from './school.mjs';
import { dueCareerInterest, careerInterestWorkReason, careerInterestRequestReason, requestCareerInterest } from './career-interest.mjs';
/** Independent fictional life rules. Values are game design, never real national statistics. */
import { COUNTRIES, JOBS, INVESTMENTS, HOBBIES, DEGREES, getCountry, getEnvironment } from './world.mjs';
import { clamp, random, log, person, money } from './shared.mjs';

const RANK = { none:0, primary:1, secondary:2, high:3, highschool:3, certificate:4, vocational:4, bachelor:5, master:6, doctorate:7 };
const rank = value => RANK[value] ?? 0;
const label = item => item.label ?? item.name ?? item.id;
const alive = people => people.filter(p => p.alive);
const presentParents = s => s.family.parents.filter(p=>p.alive&&!p.absent);
const spouse = s => s.family.partners.find(p => p.alive && p.relation === 'spouse');
const skill = (s, key) => s.flags.skills?.[key] ?? 0;
const moneyInt = value => Math.max(0, Math.round(value));
const environment = s => getEnvironment(s.countryId,{year:s.year,mode:s.mode,city:s.city,household:s.household});
const incomeBase = s => Math.max(1800, environment(s).income || 12000);
const costBase = s => clamp(environment(s).cost || 1, .4, 2.5);
const hasCondition = (s,id) => s.health.conditions.some(c => c.id === id);
const DISEASES = {
  fracture:{name:'골절',severity:2,cost:1400},chronic:{name:'만성 질환',severity:2,cost:1400},
  prostate_cancer:{name:'전립선암',severity:3,cost:4000},breast_cancer:{name:'유방암',severity:3,cost:4000},
  ischemic_heart:{name:'허혈성 심장 질환',severity:3,cost:3000},stroke:{name:'뇌졸중',severity:3,cost:3200},copd:{name:'만성 폐 질환',severity:2,cost:2400}
};
function addDisease(s,id) {if(!hasCondition(s,id)){const disease=DISEASES[id];s.health.conditions.push({id,name:disease.name,severity:disease.severity,years:0});return true;}return false;}
function treatmentPrice(s) {return moneyInt(s.health.conditions.reduce((sum,c)=>sum+(DISEASES[c.id]?.cost||1400),0)*(s.finance.insurance==='expanded'?.25:1));}
const annualId = (s,id) => `${s.age}:${id}`;
const done = (s,id) => Boolean(s.flags.systemActions?.[annualId(s,id)]);
const disabled = (...reasons) => reasons.find(Boolean);
function setSkill(s,id,amount) { s.flags.skills ??= {}; s.flags.skills[id] = clamp(skill(s,id)+amount); }
function charge(s, amount) { if (s.finance.cash < amount) return false; s.finance.cash -= amount; return true; }
function annualBill(s, amount) { amount=moneyInt(amount); const paid=Math.min(s.finance.cash,amount);s.finance.cash-=paid;s.finance.debt+=amount-paid;s.finance.annualExpense+=amount; }
function say(s,group,title,text) { log(s,group,title,text,`system:${group}:${title}`); }
const DINNER_COST = 150;
function dinnerReason(s) {
  const currentPartners=s.family.partners.filter(p=>['spouse','cohabitant'].includes(p.relation));
  const cohabitant=s.family.relationship?.relation==='cohabitant'||s.family.relationship?.cohabiting?s.family.relationship:null;
  const people=[...s.family.parents,...currentPartners,...s.family.children,...s.family.friends,...(cohabitant?[cohabitant]:[])];
  return disabled(s.age<6&&'6세부터 선택하는 자체 생활 규칙입니다.',!people.some(p=>p.alive&&!p.absent&&!p.separated&&!/^(former_|late_)/.test(p.relation||''))&&'함께할 살아 있는 가족·친구가 없습니다. 부재 중인 사람은 제외합니다.');
}
function dinnerEffects(s) {
  s.stats.social=clamp(s.stats.social+4);s.stats.happiness=clamp(s.stats.happiness+2);
  s.finance.annualExpense+=DINNER_COST;s.automations.lastRun.dinner=s.age;delete s.automations.skipped.dinner;
  return '가족·친구와 외식·선물로 시간을 나누고 150 G를 지출했습니다. 관계 +4·행복 +2는 확인한 원작 화면 설명을 바탕으로 적용하며, 150 G 비용·6세 시작·연 1회 한도는 자체 규칙입니다.';
}
function aliveAdultChildren(s) { return s.family.children.filter(p => p.alive && p.age >= 18); }
const rentalDebt = s => Math.min(s.finance.mortgage,Math.max(0,s.flags.rentalMortgage||0));
const homeDebt = s => Math.max(0,s.finance.mortgage-rentalDebt(s));
function moveHomeToRental(s) {
  if(s.finance.home!=='owned')return;
  s.flags.rentalValue=(s.flags.rentalValue??s.finance.rentals*incomeBase(s)*3)+s.finance.homeValue;
  s.finance.rentals++;s.flags.rentalMortgage=s.finance.mortgage;s.finance.homeValue=0;s.flags.reverseMortgage=false;
}
/** Shared relocation accounting; narrative callers own fees, eligibility and emotional effects. */
export function relocateResidence(s,countryId,{status,city='urban'}={}) {
  if(!COUNTRIES.some(c=>c.id===countryId)||!['urban','rural'].includes(city)||(status!==undefined&&!['citizen','resident','permanent','refugee','irregular'].includes(status)))return {ok:false,error:'이주 목적지 또는 체류 상태가 올바르지 않습니다.'};
  const citizenships=new Set([s.birthCountryId,...(s.flags.citizenships||[])]);
  if(s.migration.status==='citizen')citizenships.add(s.countryId);
  s.flags.citizenships=[...citizenships];moveHomeToRental(s);s.finance.home='rented';s.countryId=countryId;s.city=city;
  s.migration={status:status??(citizenships.has(countryId)?'citizen':'resident'),years:0,pending:null};
  return {ok:true};
}
const activeCampaign = s => ['preparing','pending','approved'].includes(s.flags.politicalCampaign?.status);
function politicalRecord(s,level,status,chance) {
  s.flags.politicalHistory??=[];s.flags.politicalHistory.push({level,status,age:s.age,...(chance===undefined?{}:{chance})});
}
/** Ending an incompatible role is shared by prison stories and annual safety checks. */
export function interruptPolitics(s,reason='prison') {
  const role=s.politics.role;
  if(!activeCampaign(s)&&!role)return false;
  const campaign=s.flags.politicalCampaign;
  if(activeCampaign(s)||(role&&campaign?.status==='elected')){campaign.status='interrupted';campaign.resolvedAge=s.age;politicalRecord(s,campaign.level,'interrupted');}
  else if(role)politicalRecord(s,role,'interrupted');
  s.politics.role=null;s.politics.term=0;
  say(s,'community','정치 활동 중단',`${reason==='service'?'기간 복무':'수감'}로 정치 준비·공천·공직을 중단했습니다. 이전 봉사 경험과 정치 이력은 남아 있습니다.`);
  return true;
}
function politicalEligibility(s,level) {
  return disabled(s.flags.prisonYears>0&&'수감 중에는 정치 활동을 할 수 없습니다.',s.flags.serviceYears>0&&'기간 복무를 먼저 마쳐야 합니다.',Boolean(s.politics.role)&&'현재 임기를 마친 뒤 새 출마를 준비할 수 있습니다.',s.age<(level==='national'?30:25)&&`${level==='national'?30:25}세부터 공천에 지원합니다.`,s.stats.social<(level==='national'?65:45)&&`사회성 ${level==='national'?65:45}가 필요합니다.`,s.politics.preparation<(level==='national'?5:2)&&`지역 봉사 준비 ${level==='national'?5:2}가 필요합니다.`,level==='national'&&(s.flags.politicalServiceYears?.local||0)<1&&'실제 지방 대표 재직 경력 1년이 필요합니다.');
}
function electionReason(s,level) {return disabled(politicalEligibility(s,level),s.flags.politicalCampaign?.level!==level||s.flags.politicalCampaign?.status!=='approved'?'해당 선거의 공천 승인이 필요합니다.':false);}
function runElection(s,level) {
  const chance=level==='national'?.35+s.stats.social/250:Math.min(.85,.4+s.stats.social/200);
  const elected=random(s)<chance;const status=elected?'elected':'defeated';
  s.flags.politicalCampaign.status=status;s.flags.politicalCampaign.resolvedAge=s.age;politicalRecord(s,level,status,chance);
  if(elected){s.politics.role=level;s.politics.term=4;s.politics.preparation++;return `${level==='national'?'전국':'지방'} 대표로 선출되어 4년 임기를 시작했습니다.`;}
  s.politics.preparation++;return '이번 선거에서 선출되지 않았습니다. 공천은 소비되었으며 다음 해 새 준비와 심사부터 다시 도전할 수 있습니다.';
}
function preserveWorkHistory(s,reason) {
  s.flags.workYears=Math.max(s.flags.workYears||0,s.career.years);
  if(s.career.salary>0)s.flags.lastWorkingSalary=s.career.salary;
  if(s.career.jobId){s.flags.careerHistory??=[];s.flags.careerHistory.push({age:s.age,jobId:s.career.jobId,years:s.career.years,salary:s.career.salary,reason});}
}
function careerReturnReason(s) {
  if(!s.flags.careBreak||!s.flags.previousJob)return '돌봄 경력 공백 상태와 이전 직무 기록이 필요합니다.';
  const j=JOBS.find(item=>item.id===s.flags.previousJob.jobId);
  return j?jobEligibility(s,j):'이전 직무에 다시 지원할 수 없습니다.';
}
function migrationEligibility(s) {
  if(s.age<18)return '18세부터 선택할 수 있습니다.';
  if(s.education.program)return '재학 중에는 이주를 먼저 조정해야 합니다.';
  if(s.migration.pending)return '진행 중인 체류 심사를 마친 뒤 다시 이주할 수 있습니다.';
  if(s.stats.knowledge<30)return '정착 준비 지식 30이 필요합니다.';
  const qualified=rank(s.education.level)>=4||(s.flags.certificates||0)>0||Math.max(s.flags.workYears||0,s.career.years)>=2||s.finance.cash>=incomeBase(s)*1.5;
  if(!qualified)return '직업 교육·자격·근무 2년 또는 기준 소득 1.5년분의 정착 자금이 필요합니다.';
  return null;
}
function programCatalog() {
  return DEGREES.filter(p => p.id !== 'equivalency').map(p=>({...p,degree:p.degree??p.level,years:p.years||2,cost:moneyInt(p.cost||800),field:p.field||'general'}));
}
function admissionChance(s,p) {
  if(['vocational','remote','night'].includes(p.id))return 1;
  const base=/abroad/i.test(p.id)?.42:p.degree==='doctorate'?.48:p.degree==='master'?.58:.62;
  return clamp(base+s.stats.knowledge*.003,.1,.95);
}
/** Shared by annual decision cards and the education menu; all chances are independent design values. */
export function enrollProgram(draft,programId,{guaranteed=false,loan=false}={}) {
  const p=programCatalog().find(x=>x.id===programId);
  if(!p)return {ok:false,error:'지원하지 않는 교육 과정입니다.'};
  const why=programEligibility(draft,p);if(why)return {ok:false,error:why};
  if(!loan&&draft.finance.cash<p.cost)return {ok:false,error:`첫 등록금 ${money(p.cost)}가 필요합니다.`};
  if(loan&&draft.finance.debt+p.cost>12000)return {ok:false,error:'학업 대출 후 일반 부채가 12,000 G 한도를 넘습니다.'};
  const chance=guaranteed?1:admissionChance(draft,p);
  const accepted=chance===1||random(draft)<chance;
  const amount=accepted?p.cost:Math.ceil(p.cost*.1);
  if(loan)draft.finance.debt+=amount;else draft.finance.cash-=amount;
  draft.flags.applications??=[];draft.flags.applications.push({id:p.id,age:draft.age,chance,accepted,cost:amount,source:'rule'});
  if(!accepted){draft.education.history.push({id:p.id,age:draft.age,degree:null,result:'rejected'});return {ok:true,admitted:false,message:`${label(p)} 지원에 합격하지 못했습니다. 신청료 ${money(amount)}가 발생했습니다. 다른 경로를 선택하거나 다음 해 다시 지원할 수 있습니다.`};}
  const preferred=draft.flags.studyDestination;
  const abroad=/abroad/i.test(p.id)?(preferred&&preferred!==draft.countryId?preferred:COUNTRIES.find(c=>c.id!==draft.countryId)?.id):null;
  draft.education.program={id:p.id,label:label(p),degree:p.degree,field:draft.flags.studyField||p.field,years:p.years,cost:p.cost,...(abroad?{abroad}: {})};
  draft.education.yearsLeft=p.years;draft.education.field=draft.flags.studyField||p.field;draft.flags.educationPaused=false;
  draft.flags.educationPausedYears=0;draft.flags.educationOnLeave=false;draft.flags.educationFunding='self';delete draft.flags.educationProgressAge;delete draft.flags.educationPauseStartedAge;
  if(abroad){draft.flags.studyOriginCountry=draft.countryId;relocateResidence(draft,abroad);}
  return {ok:true,admitted:true,message:`${label(p)}에 입학했습니다. ${p.years}년 과정, 연간 ${money(p.cost)}입니다.`};
}
function programEligibility(s,p) {
  if(s.age<16) return '16세부터 진로 교육을 선택할 수 있습니다.';
  if(s.flags.serviceYears>0)return '기간 복무를 마친 뒤 진학할 수 있습니다.';
  if(s.education.program) return '현재 과정을 졸업하거나 중단한 뒤 신청합니다.';
  const required = p.degree==='doctorate'?'master':p.degree==='master'?'bachelor':p.degree==='vocational'?'secondary':'highschool';
  if(rank(s.education.level)<rank(required))return `선행 학력이 필요합니다 (${required}).`;
  if(rank(s.education.level)>=rank(p.degree))return '이미 같거나 더 높은 학위를 취득했습니다.';
  if(s.stats.knowledge<(p.minKnowledge||30))return `지식 ${p.minKnowledge||30} 이상이 필요합니다.`;
  if(/abroad/i.test(p.id) && (['refugee','irregular'].includes(s.migration.status)||s.migration.pending))return '체류 절차를 먼저 안정시켜야 합니다.';
  return null;
}
// The executor and the read-only explanation share the same ordered checks.
// Keep the original first-failure text/order: saved results and hiring do not change.
function jobRequirements(s,j) {
  const early=earlyWorkEligible(s)&&EARLY_JOBS.includes(j.id);
  const arts=['music','dance','painting','writing','photography'];
  const sportsLevel=s.hobbies.find(h=>h.id==='sports')?.level||0;
  const artLevel=Math.max(0,...s.hobbies.filter(h=>arts.includes(h.id)).map(h=>h.level));
  const check=(key,failed,reason,facts={})=>({key,met:!failed,reason,...facts});
  const minimum=(key,current,required,reason,applies=true)=>check(key,applies&&current<required,reason,{current,required});
  const minimumHealth=20,serviceAgeLimit=55;
  return [
    check('school-age',s.age<18&&!early,'15~17세에는 학업을 중단한 뒤 가능한 첫 일자리만 선택할 수 있습니다.'),
    minimum('age',s.age,j.minAge||18,'취업 가능 나이가 아닙니다.',!early),
    check('retired',s.career.retired,'은퇴 이후에는 시간제 일과 자원봉사를 선택할 수 있습니다.'),
    check('prison',s.flags.prisonYears>0,'수감 중에는 구직할 수 없습니다.'),
    check('service',s.flags.serviceYears>0,'기간 복무를 마친 뒤 구직할 수 있습니다.'),
    check('service-age',['military','officer'].includes(j.id)&&s.age>=serviceAgeLimit,'직업 복무의 신규 지원 나이를 지났습니다 (자체 설계 55세).',{limit:serviceAgeLimit}),
    check('health',s.health.treatment||s.stats.health<minimumHealth,'치료와 건강 회복이 필요합니다.',{current:s.stats.health,required:minimumHealth,inTreatment:Boolean(s.health.treatment)}),
    check('education',rank(s.education.level)<rank(j.degree),'필요 학력이 부족합니다.',{current:s.education.level,required:j.degree}),
    minimum('knowledge',s.stats.knowledge,j.minKnowledge||0,'필요 지식이 부족합니다.'),
    minimum('sports',sportsLevel,4,'운동 훈련 4단계가 필요합니다.',j.id==='athlete'),
    minimum('arts',artLevel,3,'예술 분야 취미 훈련 3단계가 필요합니다.',j.id==='artist'),
    minimum('leadership',skill(s,'leadership'),2,'자격·봉사로 지도력 2가 필요합니다.',j.id==='officer'),
    check('doctorate',j.id==='professor'&&rank(s.education.level)<7,'박사 학위가 필요합니다.',{current:s.education.level,required:'doctorate'})
  ];
}
function jobEligibility(s,j) { return jobRequirements(s,j).find(requirement=>!requirement.met)?.reason??null; }
export function getCareerQualification(s,jobId) {
  const job=JOBS.find(j=>j.id===jobId);if(!job)return null;
  const missing=jobRequirements(s,job).filter(requirement=>!requirement.met);
  return {jobId:job.id,label:label(job),qualified:missing.length===0,qualificationReason:missing[0]?.reason??null,missing};
}
function salary(s,j) { return moneyInt((j.salary || incomeBase(s)) * clamp(incomeBase(s)/16000,.35,2.8)); }
export function getCareerOpportunities(s) {return JOBS.filter(j=>j.id!==s.career.jobId&&!jobEligibility(s,j)).map(j=>({...j,salary:salary(s,j)}));}
function startJob(s,j) {
  preserveWorkHistory(s,'job_change');s.career.jobId=j.id;s.career.title=label(j);s.career.salary=salary(s,j);s.career.level=1;s.career.years=0;s.flags.salaryEnvironment=incomeBase(s);s.flags.careBreak=false;s.flags.previousJob=null;
  return `${label(j)} 일을 시작했습니다. 기준 연봉 ${money(s.career.salary)}입니다.`;
}
export function getCareerChallengeOptions(s) {
  return (dueCareerInterest(s)?.candidates??[]).map(c=>{const j=JOBS.find(j=>j.id===c.jobId);return {...c,label:label(j),salary:salary(s,j),qualificationReason:jobEligibility(s,j)};});
}
export function resolveCareerChallenge(s,jobId) {
  const request=dueCareerInterest(s);if(!request)return {ok:false,error:'아직 선택할 탐색 결과가 없습니다.'};
  const previousJobId=s.career.jobId;
  const finish=(outcome,reason,knowledgeGain=0)=>{request.result={age:s.age,year:s.year,outcome,jobId,previousJobId,knowledgeGain,reason};return {ok:true,message:reason};};
  if(jobId===null)return finish('deferred','알아본 준비 조건을 기록해 두고 지금의 생활을 이어 가기로 했습니다.');
  if(!request.candidates.some(c=>c.jobId===jobId))return {ok:false,error:'이번에 알아본 직업 중에서 선택해 주세요.'};
  if(previousJobId===jobId)return finish('already-working','이미 시작한 일을 이어 갑니다. 직급과 근무 경력은 그대로 유지합니다.');
  const unavailable=careerInterestWorkReason(s);if(unavailable)return {ok:false,error:unavailable};
  if(done(s,'job_apply'))return {ok:false,error:'올해 이미 새 일을 시작했습니다. 이번 탐색은 보류할 수 있습니다.'};
  const j=JOBS.find(j=>j.id===jobId),why=jobEligibility(s,j);
  if(why){const before=s.stats.knowledge;s.stats.knowledge=clamp(before+1);return finish('not-qualified',`${label(j)} 지원은 채용으로 이어지지 않았습니다. ${why} 준비하며 배운 것을 남기고 기존 생활을 이어 갑니다.`,s.stats.knowledge-before);}
  const message=startJob(s,j);s.flags.systemActions??={};s.flags.systemActions[annualId(s,'job_apply')]=true;
  return finish('hired',message);
}
function workStudyJob(s) {return getCareerOpportunities(s).filter(j=>['general','trade'].includes(j.category)).sort((a,b)=>b.salary-a.salary)[0];}
export function getEducationFundingOptions(s) {
  if(!s.education.program)return [];
  if(s.flags.educationOnLeave)return ['resume','dropout'];
  if(!s.flags.educationPaused)return ['pause','dropout'];
  const modes=[];
  if(s.flags.educationFunding!=='work-study'&&!(s.flags.prisonYears>0)&&!(s.flags.serviceYears>0)&&(s.career.jobId||(!done(s,'job_apply')&&workStudyJob(s))))modes.push('work-study');
  if(s.finance.debt+Math.max(0,s.education.program.cost-s.finance.cash)<=12000)modes.push('loan');
  modes.push('pause','dropout');return modes;
}
/** A paused year is resolved once; voluntary leave preserves the current degree and credits. */
export function resolveEducationFunding(s,mode) {
  if(!getEducationFundingOptions(s).includes(mode))return {ok:false,error:'현재 선택할 수 없는 학업 재정 조정입니다.'};
  if(s.flags.educationFundingDecisionAge===s.age&&mode!=='dropout')return {ok:false,error:'올해 학업 재정 계획을 이미 조정했습니다. 다음 해 경과를 확인하세요.'};
  if(mode==='dropout')return applySystemAction(s,{actionId:'dropout'});
  if(mode==='work-study'){
    if(!s.career.jobId){const job=workStudyJob(s);const result=applySystemAction(s,{actionId:'job_apply',value:job.id});if(!result.ok)return result;}
    s.flags.educationFunding='work-study';s.flags.educationPaused=false;s.flags.educationOnLeave=false;s.flags.educationFundingDecisionAge=s.age;
    return {ok:true,message:`${s.career.title} 일과 학업을 병행합니다. 다음 해부터 근무 소득 100%와 추가 피로를 반영하며 남은 학기와 등록금은 유지됩니다.`};
  }
  if(mode==='loan'){
    s.flags.educationFunding='loan';s.flags.educationFundingDecisionAge=s.age;advanceEducation(s);
    return {ok:true,message:'미납 학비의 부족분만 학자금으로 보전해 이번 수강을 이어 갔습니다. 이후 학비도 일반 부채 12,000 G 한도 안에서 부족액만 보전하며 연 4% 이자가 발생합니다.'};
  }
  if(mode==='pause'){
    s.flags.educationOnLeave=true;s.flags.educationPaused=false;s.flags.educationFunding='self';s.flags.educationFundingDecisionAge=s.age;
    return {ok:true,message:s.education.program.id===NIGHT_SCHOOL?'학력 시험 준비를 쉬기로 했습니다. 현재 학력과 남은 준비 기간, 이미 낸 준비비는 보존합니다. 복학할 때 준비비를 다시 내지 않습니다.':'자발적으로 휴학했습니다. 현재 학력·과정·남은 수강 기간은 보존하고 학비 청구를 멈춥니다. 일을 시작해 자금을 모은 뒤 복학할 수 있습니다.'};
  }
  s.flags.educationOnLeave=false;s.flags.educationPaused=false;s.flags.educationFundingDecisionAge=s.age;
  return {ok:true,message:s.education.program.id===NIGHT_SCHOOL?'학력 시험 준비를 다시 이어 갑니다. 다음 연간 경과에서 남은 준비를 진행하며, 이미 낸 준비비는 다시 내지 않습니다.':'남겨 둔 과정에 복학했습니다. 다음 연간 경과부터 학비를 내고 남은 수강을 진행합니다.'};
}
function actionRegistry(s) {
  const list=[];
  const add=(id,group,title,description,cost,reason,run,options=null,repeatable=false)=>{
    const unavailable=disabled(s.status!=='alive'&&'종료된 생애입니다.',s.flags.prisonYears>0&&!['health','education','hobbies'].includes(group)&&!['parole','cancel_politics'].includes(id)&&'수감 중에는 이 활동을 할 수 없습니다.',id==='service'&&(activeCampaign(s)||s.politics.role)&&'정치 준비·공천을 취소하고 현재 공직 임기를 마친 뒤 복무할 수 있습니다.',s.flags.serviceYears>0&&(['mobility'].includes(group)||['job_apply','care_return','care_break','part_time','retire','health_retire','politics_prepare','nomination_apply','local_election','national_election'].includes(id))&&'기간 복무를 마친 뒤 선택할 수 있습니다.',reason,!repeatable&&done(s,id)&&'올해 이미 실행했습니다.',s.finance.cash<cost&&`${money(cost)}가 필요합니다.`);
    list.push({id,group,label:title,description,cost,disabledReason:unavailable||undefined,...(options?{options}:{}),run,repeatable});
  };
  const adult=s.age>=18;
  const adulthood=!adult&&'18세부터 선택할 수 있습니다.';
  const programs=programCatalog();
  const availablePrograms=programs.filter(p=>!programEligibility(s,p));
  add('study','education','자율 학습','올해 지식을 5 높입니다. 비용과 시간은 연간 활동에 포함됩니다.',100,s.age<6&&'6세부터 가능합니다.',d=>{d.stats.knowledge=clamp(d.stats.knowledge+5);d.stats.energy=clamp(d.stats.energy-4);return '책과 연습으로 이해가 깊어졌습니다.';});
  add('equivalency','education','야간학교·검정고시 준비 (1년)',nightSchoolDescription(s),NIGHT_SCHOOL_COST,nightSchoolReason(s),d=>startNightSchool(d));
  for(const p of WORK_STUDY_PLANS)add('work_study_'+p.id,'education',p.label,`${p.description} 준비비는 한 번 내고 1년 뒤 시험을 봅니다. 준비 지식 최대 +${p.knowledgeGain}, 시험 때 지식 35 이상이면 합격합니다. 현재 일의 급여 계산은 유지됩니다. 자체 게임 규칙입니다.`,p.cost,workStudyReason(s),d=>startNightSchool(d,p.id));
  add('enroll','education','진학 신청','등록금은 매년 납부합니다. 선택지의 합격률은 자체 설계값입니다. 불합격 시 등록금 10%의 신청료만 발생하며 재학 상태는 바뀌지 않습니다.',0,disabled(!availablePrograms.length&&'진학 가능한 과정이 없습니다. 선행 학력·지식·재학 상태를 확인하세요.'),(d,v)=>enrollProgram(d,v),availablePrograms.map(p=>({value:p.id,label:`${label(p)} · ${p.years}년 · 연 ${money(p.cost)} · 합성 합격률 ${Math.round(admissionChance(s,p)*100)}%`})));
  add('study_field','education','희망 전공 선택','다음 진학 과정에 적용할 관심 분야를 선택합니다.',0,s.age<12&&'12세부터 선택할 수 있습니다.',(d,v)=>{d.flags.studyField=v;return '다음 과정의 희망 전공을 기록했습니다.';},[{value:'general',label:'일반·인문'},{value:'science',label:'과학·공학'},{value:'arts',label:'예술·공연'},{value:'sports',label:'체육'},{value:'health',label:'보건'},{value:'law',label:'법·사회'},{value:'technical',label:'직업 기술'}],true);
  add('study_destination','education','유학 희망 국가 선택','해외 과정에 지원할 때 사용할 목적지입니다. 선택만으로 이동하거나 입학하지 않습니다.',0,adulthood,(d,v)=>{d.flags.studyDestination=v;return `${getCountry(v).name}를 유학 희망 국가로 기록했습니다.`;},COUNTRIES.filter(c=>c.id!==s.countryId).map(c=>({value:c.id,label:c.name})),true);
  add('education_loan','education','학업 대출','최대 3,000 G를 빌립니다. 일반 부채 12,000 G 한도 안에서 남은 금액만 대출하며 연 4% 이자가 발생합니다.',0,disabled(adulthood,s.finance.debt>=12000&&'현재 부채가 대출 한도에 도달했습니다.',!s.education.program&&rank(s.education.level)<2&&'중등 과정 이상이 필요합니다.'),d=>{const amount=Math.min(3000,12000-d.finance.debt);d.finance.cash+=amount;d.finance.debt+=amount;return `학업 자금 ${money(amount)}와 상환 의무가 생겼습니다.`;});
  add('education_pause','education','휴학과 수강 보존',s.education.program?.id===NIGHT_SCHOOL?'준비를 쉬며 현재 학력과 남은 기간을 보존합니다. 이미 낸 준비비는 유지되며 복학할 때 다시 내지 않습니다.':'학비 지출을 멈추고 현재 과정·남은 기간을 보존합니다. 일을 이어 가며 자금을 마련한 뒤 복학할 수 있습니다.',0,disabled(!s.education.program&&'진행 중인 과정이 없습니다.',s.flags.educationOnLeave&&'이미 휴학 중입니다.',s.flags.educationFundingDecisionAge===s.age&&'올해 계획을 이미 조정했습니다.'),d=>resolveEducationFunding(d,'pause'));
  add('education_resume','education','보존한 과정에 복학',s.education.program?.id===NIGHT_SCHOOL?'다음 연간 경과에서 남은 시험 준비를 이어 갑니다. 이미 낸 준비비는 다시 내지 않습니다.':'휴학 전 남은 기간부터 수강을 다시 시작합니다. 다음 연간 경과부터 학비를 납부합니다.',0,disabled(!s.education.program||!s.flags.educationOnLeave?'휴학 중인 과정이 없습니다.':false,s.flags.educationFundingDecisionAge===s.age&&'휴학한 해에는 먼저 생활 경과를 확인하세요.'),d=>resolveEducationFunding(d,'resume'));
  add('dropout','education','학업 중단','현재 과정과 지출을 중단합니다. 이미 낸 등록금은 반환하지 않습니다.',0,!s.education.program&&'진행 중인 과정이 없습니다.',d=>{if(d.education.program.id===NIGHT_SCHOOL)return withdrawNightSchool(d);d.education.history.push({id:d.education.program.id,age:d.age,degree:null,result:'withdrawn'});d.education.program=null;d.education.yearsLeft=0;d.flags.educationPaused=false;d.flags.educationOnLeave=false;d.flags.educationFunding='self';d.flags.educationPausedYears=0;return '현재 학업을 중단했습니다. 다시 조건을 갖추면 재입학할 수 있습니다.';});

  const jobs=JOBS.filter(j=>j.id!==s.career.jobId&&!jobEligibility(s,j));
  add('job_apply','career','구직·직업 변경','현재 학력·지식·훈련 조건에 맞는 직업입니다. 주간 학업과 병행하면 실제 연간 근무 소득은 50%, 원격·야간 과정은 100%로 계산합니다. 총 근무 경력은 직업 변경 뒤에도 남습니다.',0,disabled(!jobs.length&&'현재 지원 가능한 직업이 없습니다.'), (d,v)=>{const j=JOBS.find(x=>x.id===v);const why=jobEligibility(d,j);if(why)return {ok:false,error:why};return startJob(d,j);},jobs.map(j=>({value:j.id,label:`${label(j)} · 연 ${money(salary(s,j))}`})));
  add('career_interest','career','해 보고 싶던 일에 도전','관심 전공·취미·기질에서 연결된 일을 알아봅니다. 다음 해 최대 세 후보 중에서 지원하거나 보류합니다. 다시 알아보기까지 2년이 걸립니다.',0,careerInterestRequestReason(s),requestCareerInterest);
  add('train','career','직무 훈련','직무 경험과 지식을 쌓아 승진·재취업을 준비합니다.',400,s.age<16&&'16세부터 가능합니다.',d=>{setSkill(d,'work',2);d.stats.knowledge=clamp(d.stats.knowledge+3);return '직무 훈련을 마쳤습니다.';});
  add('certificate','career','자격증 취득','직무 능력 2와 지도력 1을 쌓습니다. 자격 수는 기록됩니다.',600,s.age<16&&'16세부터 가능합니다.',d=>{d.flags.certificates=(d.flags.certificates||0)+1;setSkill(d,'work',2);setSkill(d,'leadership',1);d.stats.knowledge=clamp(d.stats.knowledge+2);return '직무 자격을 취득했습니다.';});
  add('promotion','career','승진 심사','근무 2년과 직무 능력 2가 필요합니다. 급여가 15% 늘고 근무 연수는 유지됩니다.',200,disabled(!s.career.jobId&&'직업이 필요합니다.',s.career.years<2&&'근무 2년이 필요합니다.',skill(s,'work')<(s.career.level||1)*2&&'직무 훈련이 더 필요합니다.'),d=>{d.career.level++;if(d.career.jobId==='military')d.career.title=d.career.level>=4?'상급 부사관':'부사관';d.career.salary=moneyInt(d.career.salary*1.15);return `직급 ${d.career.level}로 승진했습니다.`;});
  add('care_break','career','돌봄을 위한 휴직·퇴직','유급 일을 멈추고 가족을 돌봅니다. 이후 재취업 경로가 남습니다.',0,disabled(!s.career.jobId&&'현재 유급 일이 없습니다.',!alive(s.family.children).length&&!presentParents(s).some(p=>p.age>=65)&&'돌봄 대상 자녀나 고령 부모가 없습니다.'),d=>{d.flags.previousJob={...d.career};d.flags.careBreak=true;d.flags.careBreakAge=d.age;d.career.jobId=null;d.career.title='가족 돌봄';d.career.salary=0;d.career.breakYears=0;d.stats.happiness=clamp(d.stats.happiness+3);return '유급 일을 멈추고 돌봄을 맡았습니다.';});
  add('care_return','career','돌봄 이후 재취업','이전 직무의 현재 지원 자격을 다시 검사합니다. 긴 공백은 시작 급여에 반영됩니다.',300,careerReturnReason(s),d=>{const prev=d.flags.previousJob;const gap=d.career.breakYears;d.career={...prev,salary:moneyInt(prev.salary*Math.max(.65,1-gap*.02)),breakYears:gap};d.flags.salaryEnvironment=incomeBase(d);d.flags.careBreak=false;d.flags.previousJob=null;return `${gap}년 공백 뒤 ${d.career.title}로 복귀했습니다.`;});
  add('retire','career','은퇴 신청','55세부터 일을 마무리하고 근무 경력에 따른 연금을 받습니다. 직업 변경 이전에 쌓은 근무 경력도 포함합니다.',0,disabled(s.age<55&&'55세부터 신청할 수 있습니다.',s.career.retired&&'이미 은퇴했습니다.',!s.career.jobId&&Math.max(s.career.years,s.flags.workYears||0)<3&&'연금을 위한 근무 경력이 부족합니다.'),d=>{retire(d);return `은퇴했습니다. 연간 연금 ${money(d.career.pension)}입니다.`;});
  add('health_retire','career','건강 사유로 일 마무리','중한 질환이나 낮은 건강 때문에 상근 일을 끝내고 합성 지원 연금으로 전환합니다.',0,disabled(adulthood,!s.career.jobId&&'현재 상근 일이 없습니다.',s.career.retired&&'이미 은퇴했습니다.',s.stats.health>=40&&!s.health.conditions.some(c=>c.severity>=2)&&'현재 건강 사유 은퇴 조건에 해당하지 않습니다.'),d=>{retire(d);d.flags.retirementReason='health';return `건강을 우선하여 일을 마무리했습니다. 연간 지원·연금 ${money(d.career.pension)}입니다.`;});
  add('part_time','career','시간제 일','학생·무직·은퇴 후에도 연간 한 번 시간제 일을 할 수 있습니다. 건강과 에너지를 사용합니다.',0,disabled(s.age<16&&'16세부터 가능합니다.',s.stats.energy<15&&'회복이 필요합니다.',Boolean(s.career.jobId)&&'현재 상근 일이 있습니다.'),d=>{const pay=moneyInt(incomeBase(d)*.1);d.finance.cash+=pay;d.stats.energy=clamp(d.stats.energy-10);d.stats.health=clamp(d.stats.health-1);return `시간제 일을 마치고 ${money(pay)}를 받았습니다.`;});
  add('service','career','2년 복무 과정','입영·2년 복무·전역으로 이어지는 독립 경로입니다. 현재 일과 전담 돌봄을 멈추며 연 2,000 G의 복무 수당을 받습니다. 실제 국가의 병역 법규가 아닙니다.',0,disabled(s.age<18||s.age>35?'18~35세 사이에 선택합니다.':false,s.career.retired&&'은퇴 상태에서는 복무를 시작할 수 없습니다.',Boolean(s.education.program)&&'현재 학업을 먼저 마치거나 중단하세요.',s.flags.serviceCompleted&&'이미 복무를 마쳤습니다.',s.flags.serviceYears>0&&'이미 복무 중입니다.',s.health.disability&&'현재 지원 여건에서는 다른 진로를 선택할 수 있습니다.',s.health.treatment&&'치료를 먼저 마쳐야 합니다.'),d=>{preserveWorkHistory(d,'service');d.flags.serviceYears=2;d.flags.serviceStarted=d.age;d.flags.servicePreviousJob={...d.career};d.flags.careBreak=false;d.flags.previousJob=null;d.career.jobId=null;d.career.salary=0;d.career.title='기간 복무';return '2년 복무 과정을 시작했습니다. 전역 뒤 직업군인 또는 민간 진로를 선택할 수 있습니다.';});

  add('meet','family','새로운 사람 만나기','성인이 된 후 교제 상대를 만납니다. 관계는 그 사람의 선택과 함께 이어집니다.',150,disabled(adulthood,Boolean(s.family.relationship)&&'이미 교제 중입니다.',Boolean(spouse(s))&&'현재 배우자 관계가 있습니다.'),d=>{const p=person(d,'partner',Math.max(18,d.age+Math.floor(random(d)*7)-3));d.family.relationship=p;d.stats.social=clamp(d.stats.social+3);return `${p.name}와 서로를 알아가기 시작했습니다.`;});
  add('date','family','관계에 시간 쓰기','교제 상대 또는 배우자와 시간을 보내며 친밀도를 높입니다.',200,!s.family.relationship&&!spouse(s)&&'교제 상대나 배우자가 없습니다.',d=>{const p=d.family.relationship||spouse(d);p.closeness=clamp((p.closeness||50)+15);d.stats.happiness=clamp(d.stats.happiness+5);return `${p.name}와 함께 시간을 보냈습니다.`;});
  add('cohabit','family','동거 논의와 함께 살기','성인 교제 상대와 친밀도 60 이상에서 함께 살기로 합의합니다. 혼인 여부는 별도이며 가족 집에 살고 있었다면 독립 임대 주거로 옮깁니다.',400,disabled(adulthood,!s.family.relationship&&'교제 상대가 없습니다.',s.family.relationship?.closeness<60&&'서로를 더 알아갈 시간이 필요합니다.',s.family.relationship?.cohabiting&&'이미 함께 살고 있습니다.',Boolean(spouse(s))&&'현재 배우자 관계를 먼저 정리해야 합니다.'),d=>{const p=d.family.relationship;p.relation='cohabitant';p.cohabiting=true;p.cohabitationStartedAge=d.age;d.flags.cohabitationSince=d.age;if(d.finance.home==='family')d.finance.home='rented';d.stats.happiness=clamp(d.stats.happiness+4);return `${p.name}와 함께 살기 시작했습니다. 동거와 혼인 상태는 구분해 기록합니다.`;});
  add('marry','family','결혼 논의','교제·동거 친밀도 60 이상에서 혼인 관계를 선택합니다. 이전 교제·동거 이력은 유지됩니다.',800,disabled(adulthood,!s.family.relationship&&'교제 상대가 없습니다.',s.family.relationship?.closeness<60&&'서로를 더 알아갈 시간이 필요합니다.',Boolean(spouse(s))&&'현재 배우자가 있습니다.'),d=>{const p=d.family.relationship;p.relation='spouse';p.cohabiting=false;p.marriageAge=d.age;d.family.partners.push(p);d.family.relationship=null;delete d.flags.cohabitationSince;d.stats.happiness=clamp(d.stats.happiness+8);return `${p.name}와 결혼했습니다.`;});
  add('end_relationship','family','교제·동거 관계 정리','교제 관계를 끝내고 기록은 보존합니다. 동거 중이었다면 400 G의 생활 정리 비용을 냅니다. 혼인 관계는 별도의 이혼 절차를 이용합니다.',s.family.relationship?.cohabiting?400:0,!s.family.relationship&&'정리할 교제·동거 관계가 없습니다.',d=>{const p=d.family.relationship;p.relation='former_partner';p.cohabiting=false;p.separated=true;p.separationAge=d.age;d.family.partners.push(p);d.family.relationship=null;delete d.flags.cohabitationSince;d.stats.happiness=clamp(d.stats.happiness-3);return `${p.name}와의 관계를 정리했습니다. 함께한 기록은 남아 있습니다.`;});
  add('plural_marriage','family','합의한 복수 배우자 관계','관계 모형을 함께 논의하고 기존 배우자 전원의 신뢰 70을 충족해야 합니다. 최대 세 명이라는 자체 설계 한도를 사용하며 실제 국가 법률·문화를 일반화하지 않습니다.',1200,disabled(adulthood,s.flags.familyModel!=='plural-consensual'&&'당사자들이 복수 관계 모형에 합의하지 않았습니다.',!spouse(s)&&'기존 배우자와의 합의 관계가 필요합니다.',s.family.partners.filter(p=>p.alive&&p.relation==='spouse').some(p=>(p.closeness||0)<70)&&'모든 기존 배우자의 신뢰 70이 필요합니다.',s.family.partners.filter(p=>p.alive&&p.relation==='spouse').length>=3&&'현재 관계 모형의 세 명 한도입니다.'),d=>{const p=person(d,'spouse',Math.max(18,d.age+Math.floor(random(d)*5)-2));p.closeness=70;p.consensual=true;d.family.partners.push(p);d.stats.happiness=clamp(d.stats.happiness+3);return `${p.name}와 당사자 모두의 합의를 바탕으로 새로운 배우자 관계를 맺었습니다.`;});
  add('divorce','family','이혼·양육 협의','자산 일부를 정산하고 관계를 끝냅니다. 미성년 자녀의 연간 지원은 계속됩니다.',500,!spouse(s)&&'현재 배우자가 없습니다.',d=>{const p=spouse(d);p.relation='former_spouse';p.separated=true;const settlement=moneyInt(d.finance.cash*.25);d.finance.cash-=settlement;d.flags.childSupport=alive(d.family.children).filter(c=>c.age<18).length*250;d.stats.happiness=clamp(d.stats.happiness-8);return `관계와 생활비 분담을 정리했습니다. 현금 정산 ${money(settlement)}입니다.`;});
  add('child','family','자녀 맞이 계획','가족의 돌봄을 합의합니다. 출산·입양 방식 모두 동일한 존중과 지원 규칙을 사용합니다.',700,disabled(adulthood,s.age>60&&'이 생애의 양육 계획 나이 범위를 지났습니다.',!spouse(s)&&!s.family.relationship&&'함께 양육할 관계가 필요합니다.',alive(s.family.children).filter(c=>c.age<18).length>=6&&'현재 양육 여력을 먼저 확보해야 합니다.'),d=>{const child=person(d,'child',0);child.education='none';child.support=true;child.premature=d.settings.sensitive&&random(d)<.08;d.family.children.push(child);d.stats.happiness=clamp(d.stats.happiness+5);d.flags.childcareYears=3;return `${child.name}를 가족으로 맞았습니다. ${child.premature?'조기 출생으로 처음 두 해에 추가 돌봄비가 발생합니다.':'돌봄과 교육비가 매년 반영됩니다.'}`;});
  add('adopt','family','입양 준비와 가족 형성','독립 생활과 돌봄 여력을 갖춘 성인이 아동을 가족으로 맞습니다. 합성 경로이며 실제 법률이 아닙니다.',1800,disabled(s.age<25&&'25세부터 준비할 수 있습니다.',s.age>65&&'이 생애의 입양 준비 나이를 지났습니다.',alive(s.family.children).filter(c=>c.age<18).length>=6&&'현재 양육 여력을 먼저 확보해야 합니다.'),d=>{const p=person(d,'child',3);p.education='none';p.support=true;p.adopted=true;d.family.children.push(p);d.stats.happiness=clamp(d.stats.happiness+5);return `${p.name}를 가족으로 맞았습니다.`;});
  add('family_time','family','가족과 대화','부모·배우자·자녀의 친밀도와 행복을 높입니다. 부재 중인 부모는 직접 대화 대상에서 제외합니다.',100,!alive([...presentParents(s),...s.family.partners,...s.family.children]).length&&'현재 연락할 가족이 없습니다.',d=>{for(const p of [...presentParents(d),...d.family.partners,...d.family.children])if(p.alive)p.closeness=clamp((p.closeness||50)+8);d.stats.happiness=clamp(d.stats.happiness+5);return '서로의 일상을 듣고 시간을 나눴습니다.';});
  add('parent_care','family','부모 돌봄 지원','고령 부모의 생활을 지원하고 매년 돌봄 비용을 부담합니다. 부재 중인 부모는 직접 돌봄 대상에서 제외합니다.',300,!presentParents(s).some(p=>p.age>=60)&&'고령 부모 돌봄 대상이 없습니다.',d=>{d.flags.parentCare=true;return '부모 돌봄 지원을 시작했습니다. 연 300 G가 필요합니다.';});
  add('spouse_assignment','family','배우자의 해외 파견 논의','배우자가 동의한 3년 파견을 시작합니다. 본인 거주지는 유지되며 연간 가족 송금과 귀환이 기록됩니다.',300,disabled(!spouse(s)&&'현재 배우자가 없습니다.',(Boolean(spouse(s)?.assignment)||(spouse(s)?.awayUntil||0)>s.age)&&'이미 배우자가 파견 중입니다.'),(d,v)=>{spouse(d).assignment={countryId:v,yearsLeft:3};return `${spouse(d).name}가 ${getCountry(v).name}에서 3년 파견 근무를 시작했습니다.`;},COUNTRIES.filter(c=>c.id!==s.countryId).map(c=>({value:c.id,label:c.name})));
  add('remit','family','가족 송금','가족에게 500 G를 보냅니다. 지원과 관계 기록으로 남습니다. 부재 중인 부모는 직접 송금 대상에서 제외합니다.',500,disabled(adulthood,!alive([...presentParents(s),...s.family.children]).length&&'지원할 가족이 없습니다.'),d=>{d.stats.happiness=clamp(d.stats.happiness+2);for(const p of [...presentParents(d),...d.family.children])if(p.alive)p.closeness=clamp((p.closeness||50)+3);return '가족에게 500 G를 보냈습니다.';});
  add('child_tuition','family','자녀 학비 지원','16세 이상 자녀 한 명의 진학 비용을 지원합니다.',1200,!s.family.children.some(c=>c.alive&&c.age>=16&&!c.tuitionPaid&&c.education!=='college')&&'현재 학비 지원 대상이 없습니다.',d=>{const c=d.family.children.find(c=>c.alive&&c.age>=16&&!c.tuitionPaid&&c.education!=='college');c.tuitionPaid=true;c.education='college';c.closeness=clamp((c.closeness||50)+10);return `${c.name}의 진학을 지원했습니다.`;});

  add('checkup','health','건강 검진','건강 상태를 확인하고 예방 관리를 합니다. 숨은 위험은 독립 규칙으로 발견됩니다.',250,s.age<6&&'어린 시기 검진은 가족 돌봄에 포함됩니다.',d=>{runCheckup(d);return d.health.conditions.length?'검진 결과와 치료 선택을 확인하세요.':'현재 치료가 필요한 질환을 찾지 못했습니다. 건강 관리 효과를 얻었습니다.';});
  const treatmentCost=treatmentPrice(s);
  add('treat','health','치료 시작','연간 치료 경과를 거쳐 질환을 관리합니다. 보험 확대 시 본인 부담이 줄어듭니다.',treatmentCost,disabled(!s.health.conditions.length&&'치료 대상 질환이 없습니다.',Boolean(s.health.treatment)&&'이미 치료 중입니다.'),d=>{d.health.treatment={yearsLeft:2,conditionIds:d.health.conditions.map(c=>c.id)};d.stats.health=clamp(d.stats.health+8);return '치료를 시작했습니다. 경과는 이후 연도에 반영됩니다.';});
  add('rehabilitation','health','재활·접근성 지원','장애 또는 후유증에 맞춘 도구·재활을 마련하여 생활 능력을 높입니다.',700,!s.health.disability&&'현재 장애·후유증 지원 대상이 아닙니다.',d=>{d.health.disability.supported=true;d.stats.health=clamp(d.stats.health+6);d.stats.energy=clamp(d.stats.energy+10);return '맞춤 재활과 접근성 지원을 마련했습니다.';});
  add('recovery','health','휴식과 생활 회복','건강 4·에너지 15를 회복합니다. 한 해에 한 번 가능합니다.',100,s.age<6&&'어린 시기 휴식은 돌봄에 포함됩니다.',d=>{d.stats.health=clamp(d.stats.health+4);d.stats.energy=clamp(d.stats.energy+15);return '충분히 쉬며 생활 리듬을 회복했습니다.';});
  add('addiction_help','health','의존 문제 상담','상담과 생활 지원으로 의존 위험을 줄입니다. 즉시 완치로 처리하지 않습니다.',500,!(s.health.addiction>0)&&'현재 의존 문제 기록이 없습니다.',d=>{d.health.addiction=clamp(d.health.addiction-25);d.stats.happiness=clamp(d.stats.happiness+3);d.flags.addictionSupport=true;return '전문적 도움과 생활 지원을 이어가기로 했습니다.';});
  add('insurance','health','보험 선택','확대 보험은 처음 선택할 때 첫해 500 G를 선납합니다. 보장을 이용한 뒤 기본 보장으로 바꿔도 이미 낸 보험료는 반환되지 않습니다. 이후 연간 500 G가 발생합니다.',0,adulthood,(d,v)=>{if(v==='expanded'&&(d.flags.insurancePaidThroughAge??-1)<d.age){if(!charge(d,500))return {ok:false,error:'첫해 보험료 500 G가 필요합니다.'};d.flags.insurancePaidThroughAge=d.age+1;}d.finance.insurance=v;return v==='expanded'?'확대 보험을 선택했습니다. 납부한 기간 이후에는 매년 보험료가 발생합니다.':'기본 보장으로 변경했습니다. 이미 낸 보험료는 반환되지 않습니다.';},[{value:'basic',label:'기본 보장'},{value:'expanded',label:'확대 보장 · 첫해/연간 500 G'}],true);
  add('diet','health','식생활 선택','식비와 연간 건강 변화가 함께 달라집니다.',0,adulthood,(d,v)=>{d.finance.diet=v;return '식생활 예산을 변경했습니다.';},[{value:'budget',label:'절약 식단'},{value:'balanced',label:'균형 식단'},{value:'healthy',label:'건강 식단 · 연 추가 400 G'}],true);

  add('dinner','finance','가족·친구와 외식·선물','관계 +4 · 행복 +2는 확인한 원작 화면의 표시 효과입니다. 비용 150 G·6세 이상·수동과 자동 합산 연 1회는 자체 규칙이며 실제 원화 환산이 아닙니다.',DINNER_COST,disabled(dinnerReason(s),s.automations.lastRun.dinner===s.age&&'올해 이미 실행했습니다.'),d=>dinnerEffects(d));
  add('auto_dinner','finance','가족·친구와 외식·선물 · 해마다','지금은 설정만 바꿉니다. 연간 필수 비용 처리 후 현금이 450 G를 넘고, 150 G 지출 뒤에도 합성 기준 연소득만큼 남을 때 실행합니다. 수동 실행과 합쳐 연 1회입니다.',0,s.age<6&&'6세부터 선택하는 자체 생활 규칙입니다.',(d,v)=>{d.automations.dinner=v==='on';return v==='on'?'외식·선물 자동 지출을 켰습니다. 다음 연간 정산부터 조건을 확인하며 지금 지출하지 않습니다.':'외식·선물 자동 지출을 껐습니다. 이전 실행 기록은 유지합니다.';},[{value:'on',label:'사용'},{value:'off',label:'중지'}],true);
  // Reference v0.7.2 accepted this setting at ages 0 (Mexico) and 7 (Bangladesh).
  // Choosing a strategy does not require buying assets. Costs/catalog stay local.
  add('allocate','finance','투자 배분 변경','보유 금융자산 전체의 전략을 바꿉니다. 변경 시 1% 비용, 실현 이익에는 합성 세율 15%가 적용됩니다. 해외 지수에는 별도의 가상 환율 변동도 반영됩니다.',0,null,(d,v)=>{const gain=Math.max(0,d.finance.assets-(d.flags.investmentPrincipal||0));const fee=moneyInt(d.finance.assets*.01);const tax=moneyInt(gain*.15);d.finance.assets=Math.max(0,d.finance.assets-fee-tax);d.flags.investmentPrincipal=d.finance.assets;d.finance.allocation=v;d.finance.tax+=tax;return `투자 전략을 변경했습니다. 비용 ${money(fee)}, 실현 이익세 ${money(tax)}입니다.`;},INVESTMENTS.map(i=>({value:i.id,label:label(i)})),true);
  add('invest','finance','1,000 G 투자','현금을 현재 투자 전략의 금융자산으로 옮깁니다.',1000,adulthood,d=>{d.finance.assets+=1000;d.flags.investmentPrincipal=(d.flags.investmentPrincipal||0)+1000;return '1,000 G를 투자했습니다.';},null,true);
  add('withdraw','finance','투자금 1,000 G 인출','가능한 금액을 현금화합니다. 이익 부분에만 합성 세율 15%를 적용합니다.',0,disabled(adulthood,s.finance.assets<=0&&'인출할 금융자산이 없습니다.'),d=>{const gross=Math.min(1000,d.finance.assets);const basis=d.flags.investmentPrincipal||0;const portion=gross/d.finance.assets;const tax=moneyInt(Math.max(0,d.finance.assets-basis)*portion*.15);d.finance.assets-=gross;d.flags.investmentPrincipal=Math.max(0,moneyInt(basis*(1-portion)));d.finance.cash+=gross-tax;d.finance.tax+=tax;return `${money(gross-tax)}를 인출했습니다. 세금 ${money(tax)}입니다.`;},null,true);
  add('repay','finance','부채 1,000 G 상환','현재 부채와 현금 중 가능한 범위에서 최대 1,000 G를 상환합니다.',0,disabled(s.finance.debt<=0&&'상환할 부채가 없습니다.',s.finance.cash<=0&&'상환할 현금이 없습니다.'),d=>{const amount=Math.min(1000,d.finance.cash,d.finance.debt);d.finance.cash-=amount;d.finance.debt-=amount;return `${money(amount)}를 상환했습니다.`;},null,true);
  const carPrice=moneyInt(incomeBase(s)*.65);
  add('buy_car','finance','자동차 구입','현금 또는 20% 계약금·연 6% 할부를 선택합니다. 연간 유지비와 감가상각이 발생합니다. 자체 설계값입니다.',0,disabled(adulthood,s.flags.carOwned&&'현재 자동차가 있습니다.'),(d,v)=>{const deposit=v==='cash'?carPrice:moneyInt(carPrice*.2);if(v==='installment'&&d.finance.debt+d.finance.mortgage+(d.flags.carLoan||0)>incomeBase(d)*4)return {ok:false,error:'현재 부채 규모로는 자동차 할부를 신청할 수 없습니다.'};if(!charge(d,deposit))return {ok:false,error:`자동차 계약에 ${money(deposit)}가 필요합니다.`};d.flags.carOwned=true;d.flags.carValue=carPrice;d.flags.carLoan=v==='cash'?0:carPrice-deposit;d.flags.carAnnualCost=moneyInt(incomeBase(d)*.025);d.stats.happiness=clamp(d.stats.happiness+3);return `자동차를 마련했습니다. 차량 가치 ${money(carPrice)}, 할부 잔액 ${money(d.flags.carLoan)}, 연간 유지비 ${money(d.flags.carAnnualCost)}입니다.`;},[{value:'cash',label:`현금 구입 · ${money(carPrice)}`},{value:'installment',label:`할부 구입 · 계약금 ${money(carPrice*.2)}`}]);
  add('sell_car','finance','자동차 처분','현재 차량 가치의 95%로 매각한 뒤 할부를 정산합니다. 부족분은 일반 부채로 남습니다.',0,!s.flags.carOwned&&'처분할 자동차가 없습니다.',d=>{const net=moneyInt(d.flags.carValue*.95)-(d.flags.carLoan||0);if(net>=0)d.finance.cash+=net;else d.finance.debt-=net;d.flags.carOwned=false;d.flags.carValue=0;d.flags.carLoan=0;d.flags.carAnnualCost=0;return '자동차를 처분하고 잔여 할부를 정산했습니다.';});
  add('repay_car','finance','자동차 할부 1,000 G 상환','현금과 할부 잔액 범위에서 최대 1,000 G를 추가 상환합니다.',0,disabled(!(s.flags.carLoan>0)&&'남은 자동차 할부가 없습니다.',s.finance.cash<=0&&'상환할 현금이 없습니다.'),d=>{const amount=Math.min(d.finance.cash,d.flags.carLoan,1000);d.finance.cash-=amount;d.flags.carLoan-=amount;return `자동차 할부 ${money(amount)}를 상환했습니다.`;},null,true);
  const homePrice=moneyInt(incomeBase(s)*3);
  add('buy_home','finance','주택 구입·대출','주택 가격의 20%를 계약금으로 내고 나머지는 주택 대출로 납부합니다. 기존 임대 주택에 남은 대출은 그대로 유지됩니다.',moneyInt(homePrice*.2),disabled(adulthood,s.finance.home==='owned'&&'이미 자가 주택이 있습니다.',s.finance.home==='care'&&'돌봄 주거 이용 중입니다.'),d=>{d.finance.home='owned';d.finance.homeValue=homePrice;d.finance.mortgage+=moneyInt(homePrice*.8);d.flags.homeCountry=d.countryId;return `자가 주택을 마련했습니다. 전체 주택 대출 ${money(d.finance.mortgage)}입니다.`;});
  add('rent_home','finance','독립 임대 주거','가족 집에서 독립합니다. 연간 주거비가 생활비에 반영됩니다.',500,disabled(adulthood,s.finance.home==='owned'&&'자가 주택을 먼저 정리하세요.',s.finance.home==='rented'&&'이미 임대 주거입니다.'),d=>{d.finance.home='rented';d.stats.happiness=clamp(d.stats.happiness+3);return '독립 임대 주거로 옮겼습니다.';});
  add('renovate','finance','주택 수리·확장','주택 가치와 생활 만족을 높입니다.',2000,s.finance.home!=='owned'&&'자가 주택이 필요합니다.',d=>{d.finance.homeValue+=1500;d.stats.happiness=clamp(d.stats.happiness+5);return '주택을 수리하고 공간을 개선했습니다.';});
  add('downsize','finance','주택 규모 줄이기','주택 가치의 25%를 정리하고 매각액의 거래비 5%와 해당 주택 대출을 먼저 정산합니다.',0,disabled(s.finance.home!=='owned'&&'자가 주택이 필요합니다.',s.finance.homeValue<10000&&'더 줄일 주택 여력이 없습니다.'),d=>{const sale=moneyInt(d.finance.homeValue*.25);const proceeds=moneyInt(sale*.95);d.finance.homeValue-=sale;const payment=Math.min(proceeds,homeDebt(d));d.finance.mortgage-=payment;d.finance.cash+=proceeds-payment;return '더 작은 주거로 옮겨 거래비와 해당 주택의 대출을 정산했습니다.';});
  add('sell_home','finance','자가 주택 매각','매각대금에서 해당 주택의 대출·거래비를 정산하고 임대 주거로 옮깁니다. 다른 임대 주택의 대출은 유지됩니다.',0,s.finance.home!=='owned'&&'매각할 자가 주택이 없습니다.',d=>{const debt=homeDebt(d);const net=moneyInt(d.finance.homeValue*.95)-debt;if(net>=0)d.finance.cash+=net;else d.finance.debt-=net;d.finance.home='rented';d.finance.homeValue=0;d.finance.mortgage-=debt;d.flags.reverseMortgage=false;return '자가 주택을 매각하고 해당 주택 대출을 정산했습니다.';});
  add('buy_rental','finance','임대 주택 투자','주택 한 채를 현금으로 구입해 임대 수입과 유지비를 정산합니다.',homePrice,disabled(adulthood,s.finance.rentals>=8&&'현재 관리 가능한 임대 주택 한도입니다.'),d=>{d.flags.rentalValue=(d.flags.rentalValue??d.finance.rentals*homePrice)+homePrice;d.finance.rentals++;return '임대 주택 한 채를 구입했습니다.';});
  add('sell_rental','finance','임대 주택 매각','평균 보유 가치에서 거래비 5%와 그 한 채에 배분된 대출을 정산합니다. 부족분은 일반 부채로 남습니다.',0,s.finance.rentals<1&&'매각할 임대 주택이 없습니다.',d=>{const total=d.flags.rentalValue??homePrice*d.finance.rentals;const unit=moneyInt(total/d.finance.rentals);const debt=moneyInt(rentalDebt(d)/d.finance.rentals);const net=moneyInt(unit*.95)-debt;d.finance.rentals--;d.flags.rentalValue=Math.max(0,total-unit);d.flags.rentalMortgage=Math.max(0,rentalDebt(d)-debt);d.finance.mortgage-=debt;if(net>=0)d.finance.cash+=net;else d.finance.debt-=net;return '임대 주택 한 채의 거래비와 배분 대출을 정산했습니다.';});
  add('reverse_mortgage','finance','주택연금 신청','65세 이상·자가 주택 대출 상환 후 주택 가치 일부를 연간 현금화합니다. 남은 주택 가치가 줄어듭니다.',0,disabled(s.age<65&&'65세부터 신청합니다.',s.finance.home!=='owned'&&'자가 주택이 필요합니다.',homeDebt(s)>0&&'해당 자가 주택의 대출 상환이 필요합니다.',s.flags.reverseMortgage&&'이미 주택연금을 이용 중입니다.'),d=>{d.flags.reverseMortgage=true;return '주택연금을 시작했습니다.';});
  add('care_home','finance','돌봄 주거 입주','65세부터 돌봄 주거에서 생활합니다. 소유 주택과 그 대출을 함께 임대자산으로 옮깁니다.',1000,disabled(s.age<65&&'65세부터 선택할 수 있습니다.',s.finance.home==='care'&&'이미 돌봄 주거를 이용 중입니다.'),d=>{moveHomeToRental(d);d.finance.home='care';d.stats.health=clamp(d.stats.health+3);return '돌봄 주거로 옮겼습니다. 연간 돌봄 비용과 기존 주택 대출은 유지됩니다.';});
  add('business_start','finance','소규모 사업 시작','연간 매출·임금·위험을 독립 규칙으로 정산합니다.',4000,disabled(adulthood,Boolean(s.finance.business)&&'이미 운영 중인 사업이 있습니다.'),d=>{d.finance.business={level:1,employees:0,years:0,profit:0};return '소규모 사업을 시작했습니다.';});
  add('business_hire','finance','직원 채용','직원당 연간 임금 1,000 G가 발생하며 생산 규모가 커집니다.',1000,disabled(!s.finance.business&&'운영 중인 사업이 없습니다.',s.finance.business?.employees>=10&&'현재 사업의 채용 한도입니다.'),d=>{d.finance.business.employees++;return '동의한 고용 조건으로 직원을 채용했습니다.';});
  add('business_expand','finance','사업 확장','시설 투자로 사업 규모를 한 단계 늘립니다.',5000,disabled(!s.finance.business&&'운영 중인 사업이 없습니다.',s.finance.business?.level>=5&&'현재 사업 확장 한도입니다.'),d=>{d.finance.business.level++;return '사업 시설을 확장했습니다.';});
  add('business_succession','finance','가업 승계','성인 자녀에게 사업을 증여하고 500 G의 지원·정리 비용을 냅니다. 현금 매각대금은 생기지 않으며 이후 이익·운영 의무는 자녀의 기록에 남습니다.',500,disabled(!s.finance.business&&'운영 사업이 없습니다.',!aliveAdultChildren(s).some(c=>!c.business)&&'사업을 넘겨받을 성인 자녀가 없습니다.'),(d,v,targetId)=>{const c=aliveAdultChildren(d).find(c=>!c.business&&(!targetId||c.id===targetId));c.businessInherited=true;c.business={...d.finance.business,receivedAt:d.year};c.businessCash=0;c.businessDebt=0;d.flags.businessSuccessorId=c.id;d.flags.businessSuccession='transferred';d.finance.business=null;return `${c.name}에게 사업 자산과 운영 책임을 넘겼습니다.`;});
  add('business_close','finance','사업 정리','사업 시설 일부를 현금화하고 운영·고용 비용을 끝냅니다.',0,!s.finance.business&&'운영 사업이 없습니다.',d=>{d.finance.cash+=d.finance.business.level*1000;d.finance.business=null;return '사업을 정리했습니다.';});
  add('social_budget','finance','경조사·사회 예산','사회적 관계에 드는 연간 비용을 조절합니다.',0,adulthood,(d,v)=>{d.finance.socialBudget=Number(v);return '사회 예산을 변경했습니다.';},[{value:'0',label:'최소화'},{value:'0.5',label:'절반'},{value:'1',label:'기본'},{value:'1.5',label:'여유 있게'}],true);
  add('will','finance','유언 계획','가족·자선·장학 목적을 지정합니다. 종료 시 실제 잔여 재산을 분배합니다.',0,adulthood,(d,v)=>{d.finance.will=v;return '유언 계획을 기록했습니다.';},[{value:'family',label:'가족 상속'},{value:'charity20',label:'자선 20% · 나머지 가족'},{value:'charity',label:'전액 자선'},{value:'scholarship',label:'전액 장학 목적'}],true);

  add('move_city','mobility','도시·농촌 이사','같은 나라에서 생활 공간을 바꾸고 주거·경험을 이어갑니다.',600,adulthood,(d,v)=>{if(v===d.city)return {ok:false,error:'이미 해당 지역에 살고 있습니다.'};d.city=v;d.stats.happiness=clamp(d.stats.happiness+2);return `${v==='urban'?'도시':'농촌'}로 이사했습니다.`;},[{value:'urban',label:'도시'},{value:'rural',label:'농촌'}]);
  const destinations=COUNTRIES.filter(c=>c.id!==s.countryId);
  add('travel','mobility','해외 여행','다른 나라를 방문해 경험을 넓힙니다. 거주국·시민권은 바뀌지 않습니다.',1200,adulthood,(d,v)=>{const c=getCountry(v);d.stats.happiness=clamp(d.stats.happiness+6);d.stats.knowledge=clamp(d.stats.knowledge+2);d.flags.visited??=[];if(!d.flags.visited.includes(v))d.flags.visited.push(v);return `${c.name} 여행을 마치고 돌아왔습니다.`;},destinations.map(c=>({value:c.id,label:c.name})));
  add('migrate','mobility','합법 이주 신청·정착','직업 교육·자격·경력 또는 충분한 정착 자금을 갖추어 이주합니다. 이전 자가 주택과 대출은 임대 자산으로 보존하며 새 거주지에서는 임대료가 발생합니다. 보유 시민권은 사라지지 않습니다.',3000,migrationEligibility(s),(d,v)=>{relocateResidence(d,v);if(d.career.jobId){d.career.salary=moneyInt(d.career.salary*.8);d.career.title=label(JOBS.find(j=>j.id===d.career.jobId)||{id:d.career.title});d.flags.salaryEnvironment=incomeBase(d);}d.stats.happiness=clamp(d.stats.happiness-3);return `${getCountry(v).name}에서 ${d.migration.status==='citizen'?'기존 시민권을 유지하며':'거주자로'} 정착을 시작했습니다.`;},destinations.map(c=>({value:c.id,label:c.name})));
  add('permanent_residence','mobility','영주권 신청','거주 3년과 지식 35 이후 신청하며 다음 연도에 심사가 완료됩니다.',800,disabled(s.migration.status!=='resident'&&'일반 거주자 체류 상태가 필요합니다.',s.migration.years<3&&'거주 3년이 필요합니다.',s.stats.knowledge<35&&'정착 지식 35가 필요합니다.',Boolean(s.migration.pending)&&'이미 체류 심사가 진행 중입니다.'),d=>{d.migration.pending={kind:'permanent',yearsLeft:1};return '영주권 심사를 신청했습니다.';});
  add('citizenship','mobility','시민권 신청','영주권·총 거주 6년·지식 45 후 신청합니다. 다음 연도에 선서와 승인이 이어집니다.',1000,disabled(s.migration.status!=='permanent'&&'영주권이 필요합니다.',s.migration.years<6&&'총 거주 6년이 필요합니다.',s.stats.knowledge<45&&'시민 지식 45가 필요합니다.',Boolean(s.migration.pending)&&'이미 체류 심사가 진행 중입니다.'),d=>{d.migration.pending={kind:'citizen',yearsLeft:1};return '시민권 심사와 선서 절차를 신청했습니다.';});
  add('refugee_support','mobility','피난·체류 지원 요청','위기·불안정 체류 기록이 있을 때 법적·생활 지원으로 거주 절차를 시작합니다. 실제 이민 조언이 아닙니다.',200,disabled(!['refugee','irregular'].includes(s.migration.status)&&'위기 또는 불안정 체류 상태가 아닙니다.',s.migration.pending&&'이미 체류 지원 심사가 진행 중입니다.'),d=>{d.migration.pending={kind:'resident',yearsLeft:2};return '체류 지원 절차를 시작했습니다.';});

  add('volunteer','community','지역 봉사','사회성 4와 지도력 1을 쌓고 관계를 형성합니다.',100,s.age<12&&'12세부터 가능합니다.',d=>{d.stats.social=clamp(d.stats.social+4);setSkill(d,'leadership',1);d.politics.preparation++;d.stats.happiness=clamp(d.stats.happiness+2);return '지역 활동에 힘을 보탰습니다.';});
  const campaign=s.flags.politicalCampaign;
  add('politics_prepare','community','정치 출마 준비','봉사 경험을 바탕으로 목표 선거를 정합니다. 준비비 200 G는 반환되지 않으며 공천 심사와 선거는 별도 단계입니다. 전국 진로는 실제 지방 대표 재직 1년이 필요합니다.',200,disabled(adulthood,Boolean(s.politics.role)&&'현재 임기를 먼저 마쳐야 합니다.',activeCampaign(s)&&'현재 준비·공천을 마치거나 취소하세요.'),(d,v)=>{if(v==='national'&&(d.flags.politicalServiceYears?.local||0)<1)return {ok:false,error:'전국 진로에는 실제 지방 대표 재직 경력 1년이 필요합니다.'};d.flags.politicalCampaign={level:v,status:'preparing',startedAge:d.age};politicalRecord(d,v,'preparing');return `${v==='national'?'전국':'지방'} 선거 준비를 시작했습니다. 조건을 갖추어 공천에 지원할 수 있습니다.`;},[{value:'local',label:'지방 대표 진로'},...((s.flags.politicalServiceYears?.local||0)>=1?[{value:'national',label:'전국 대표 진로'}]:[])]);
  add('nomination_apply','community','공천 지원','준비한 선거의 공천을 신청합니다. 지방 500 G·전국 1,500 G의 심사 비용을 내고 다음 해 승인 또는 거절을 받습니다. 합격률은 사회성과 준비에 따른 자체 규칙입니다.',campaign?.level==='national'?1500:500,disabled(campaign?.status!=='preparing'&&'먼저 목표 선거를 준비해야 합니다.',politicalEligibility(s,campaign?.level||'local')),d=>{const c=d.flags.politicalCampaign;c.status='pending';c.appliedAge=d.age;c.chance=clamp(.4+d.stats.social*.003+Math.min(10,d.politics.preparation)*.02,.2,.9);politicalRecord(d,c.level,'pending',c.chance);return `공천을 신청했습니다. 자체 규칙의 승인 확률은 ${Math.round(c.chance*100)}%이며 다음 해 결과가 나옵니다.`;});
  add('cancel_politics','community','정치 준비·공천 취소','아직 시작하지 않은 임기를 위한 준비·심사를 취소합니다. 이미 낸 비용과 이전 봉사 경험은 유지됩니다.',0,!activeCampaign(s)&&'취소할 준비·공천이 없습니다.',d=>{const c=d.flags.politicalCampaign;c.status='cancelled';c.resolvedAge=d.age;politicalRecord(d,c.level,'cancelled');return '정치 준비와 공천 절차를 취소했습니다. 다시 시작하려면 새 준비가 필요합니다.';});
  add('local_election','community','지방 선거 출마','25세·사회성 45·봉사 준비 2 및 지방 공천 승인 후 선거에 도전합니다. 공천은 결과와 관계없이 한 번 소비됩니다.',1200,electionReason(s,'local'),d=>runElection(d,'local'));
  add('national_election','community','전국 선거 출마','실제 지방 대표 재직 1년·30세·사회성 65·준비 5 및 전국 공천 승인 후 도전합니다. 합성 경로이며 실제 선거 제도가 아닙니다.',4000,electionReason(s,'national'),d=>runElection(d,'national'));
  add('donate','community','지역에 기부','현금 500 G를 기부하고 나눔 이력을 남깁니다.',500,adulthood,d=>{d.finance.donation+=500;d.stats.happiness=clamp(d.stats.happiness+3);return '지역 단체에 500 G를 기부했습니다.';});
  add('scholarship','community','장학 후원 시작','학생 한 명에게 매년 500 G를 후원합니다. 첫해 지원금을 지금 납부하고 4년 지원 후 졸업 소식이 도착합니다.',500,disabled(adulthood,s.finance.scholarships>=10&&'현재 후원 가능 인원 한도입니다.'),d=>{d.finance.scholarships++;d.flags.scholarshipStudents??=[];d.flags.scholarshipStudents.push({id:`scholar:${d.age}:${d.finance.scholarships}`,years:0,graduated:false,prepaid:500});return '학생 한 명의 장학 후원을 시작하고 첫해 지원금을 납부했습니다.';});
  add('stop_scholarship','community','장학 후원 규모 줄이기','활성 후원 한 명을 줄입니다. 지원 중단도 이력에 남습니다.',0,s.finance.scholarships<1&&'진행 중인 후원이 없습니다.',d=>{d.finance.scholarships--;const student=d.flags.scholarshipStudents?.find(x=>!x.graduated&&!x.stopped);if(student)student.stopped=true;return '현재 사정에 맞게 장학 후원 규모를 줄였습니다.';});
  add('parole','community','가석방 심사','수감 중 교육·반성을 이어가며 심사를 신청합니다. 성공을 보장하지 않습니다.',200,!(s.flags.prisonYears>0)&&'수감 상태가 아닙니다.',d=>{if(d.stats.knowledge>=40&&random(d)<.55){d.flags.prisonYears=0;return '가석방 심사를 통과했습니다.';}return '이번 가석방 심사를 통과하지 못했습니다.';});
  add('friend','community','친구와 교류','새 친구를 만나거나 우정을 이어갑니다.',100,s.age<6&&'6세부터 가능합니다.',d=>{if(d.family.friends.length<12)d.family.friends.push(person(d,'friend',d.age));for(const f of d.family.friends)if(f.alive)f.closeness=clamp((f.closeness||50)+5);d.stats.social=clamp(d.stats.social+4);d.stats.happiness=clamp(d.stats.happiness+4);return '친구와 이야기를 나누며 관계를 넓혔습니다.';});

  add('hobby_start','hobbies','취미 시작','등록된 관심사 중 새 취미를 하나 시작합니다. 매년 한 가지씩 넓힐 수 있습니다.',200,disabled(s.age<6&&'6세부터 가능합니다.',s.hobbies.length>=HOBBIES.length&&'등록된 모든 취미를 이미 이어가고 있습니다.'),(d,v)=>{if(d.hobbies.some(h=>h.id===v))return {ok:false,error:'이미 이어가는 취미입니다.'};d.hobbies.push({id:v,level:1});d.stats.happiness=clamp(d.stats.happiness+3);return `${label(HOBBIES.find(h=>h.id===v))} 활동을 시작했습니다.`;},HOBBIES.filter(h=>!s.hobbies.some(x=>x.id===h.id)).map(h=>({value:h.id,label:label(h)})));
  add('hobby_practice','hobbies','취미 레슨·연습','선택한 취미를 연습합니다. 숙련도는 20단계까지 한 단계 오르며, 20단계에서는 더 오르지 않습니다.',300,!s.hobbies.length&&'먼저 취미를 선택하세요.',(d,v)=>{const h=d.hobbies.find(x=>x.id===v),previousLevel=h.level;h.level=Math.min(20,h.level+1);d.stats.happiness=clamp(d.stats.happiness+4);return h.level>previousLevel?'연습과 레슨으로 숙련도가 높아졌습니다.':'연습과 레슨을 했습니다. 현재 숙련도는 연습 상한인 20단계입니다.';},s.hobbies.map(h=>({value:h.id,label:`${label(HOBBIES.find(x=>x.id===h.id)||h)} · ${h.level}단계`})));
  add('perform','hobbies','발표·대회 참가','숙련도 3 이상이면 작품·공연·스포츠 대회에 참가할 수 있습니다.',300,!s.hobbies.some(h=>h.level>=3)&&'취미 숙련도 3이 필요합니다.',d=>{const h=[...d.hobbies].sort((a,b)=>b.level-a.level)[0];if(random(d)<clamp(.25+h.level*.05,0,.9)){d.finance.cash+=500;d.stats.social=clamp(d.stats.social+5);setSkill(d,'performance',1);return '발표가 좋은 반응을 얻고 500 G의 사례를 받았습니다.';}d.stats.happiness=clamp(d.stats.happiness+2);return '결과와 별개로 다음 활동을 위한 경험을 쌓았습니다.';});
  const automations=[['certificate','자격증 · 2년마다 600 G'],['tutoring','자녀 과외 · 연 250 G'],['lessons','취미 레슨 · 연 300 G'],['checkup','건강 검진 · 연 250 G'],['childTuition','자녀별 학비 결정'],['childMarriage','성인 자녀의 결혼 결정']];
  for(const [key,title]of automations)add(`auto_${key}`,'finance',`${title} 설정`,'자동 지출은 잔액이 부족하면 건너뛰고 이후 다시 시도합니다. 최근 실행과 부족 상태를 기록합니다.',0,adulthood,(d,v)=>{d.automations[key]=v==='on';return `${title}: ${v==='on'?'사용':'중지'}으로 변경했습니다.`;},[{value:'on',label:'사용'},{value:'off',label:'중지'}],true);
  return list;
}

export function getSystemActions(state) { return actionRegistry(state).map(({run,repeatable,...meta})=>meta); }

export function applySystemAction(draft,command) {
  if(!command||typeof command.actionId!=='string')return {ok:false,error:'행동 ID가 필요합니다.'};
  const action=actionRegistry(draft).find(a=>a.id===command.actionId);
  if(!action)return {ok:false,error:'지원하지 않는 행동입니다.'};
  if(action.disabledReason)return {ok:false,error:action.disabledReason};
  if(action.options&&!action.options.some(o=>o.value===command.value))return {ok:false,error:'선택지 값이 올바르지 않습니다.'};
  // Valid reselection is not a committed command: no charge, log, or annual ledger.
  if(command.actionId==='allocate'&&draft.finance.allocation===command.value)return {ok:true,noOp:true,message:'이미 선택한 투자 배분을 유지합니다.'};
  if(command.actionId==='business_succession'&&command.targetId!==undefined&&!aliveAdultChildren(draft).some(c=>c.id===command.targetId&&!c.business))return {ok:false,error:'사업을 넘겨받을 유효한 성인 자녀가 아닙니다.'};
  if(command.actionId==='service'&&(activeCampaign(draft)||draft.politics.role))return {ok:false,error:'정치 준비·공천을 취소하고 현재 공직 임기를 마친 뒤 복무할 수 있습니다.'};
  // The engine applies this to a disposable clone; failed results must not be committed.
  if(!charge(draft,action.cost))return {ok:false,error:'잔액이 부족합니다.'};
  const result=action.run(draft,command.value,command.targetId);
  if(result&&typeof result==='object'&&result.ok===false)return result;
  if(command.actionId==='job_apply'&&(draft.age<18||command.value==='domestic'))draft.flags.schoolWorkPolicyVersion=1;
  draft.flags.systemActions??={};
  if(!action.repeatable)draft.flags.systemActions[annualId(draft,action.id)]=true;
  const message=typeof result==='string'?result:result?.message||action.label;
  say(draft,action.group,action.label,message);
  return {ok:true,message};
}

function retire(s) {preserveWorkHistory(s,'retirement');const years=Math.max(s.career.years,s.flags.workYears||0);const basis=s.career.salary||s.flags.lastWorkingSalary||s.flags.previousJob?.salary||0;s.career.retired=true;s.career.pension=moneyInt(Math.max(incomeBase(s)*.12,basis*Math.min(.6,.2+years*.01)));s.career.title=`은퇴 · ${s.career.title}`;s.career.jobId=null;s.career.salary=0;s.flags.careBreak=false;s.flags.previousJob=null;}
function runCheckup(s) {
  s.stats.health=clamp(s.stats.health+2);s.flags.lastCheckup=s.age;
  if(s.age>=45&&random(s)<.18){const candidates=['chronic',...(s.age>=55?[s.gender==='male'?'prostate_cancer':'breast_cancer']:[]),...(s.age>=60?['ischemic_heart','copd']:[])].filter(id=>!hasCondition(s,id));if(candidates.length){const id=candidates[Math.floor(random(s)*candidates.length)];addDisease(s,id);say(s,'health','검진 이후',`${DISEASES[id].name}을 발견했습니다. 치료·보험·건강 사유 은퇴를 검토할 수 있습니다. 진단 조건과 확률은 게임의 합성 규칙입니다.`);}}
}
function automaticExpense(s,key,cost,effect,interval=1,eligible=true) {
  if(!s.automations[key]||!eligible)return;
  const last=s.automations.lastRun[key];if(last!==undefined&&s.age-last<interval)return;
  if(s.finance.cash<cost){s.automations.skipped[key]={age:s.age,reason:'insufficient_funds',cost};return;}
  s.finance.cash-=cost;s.finance.annualExpense+=cost;effect();s.automations.lastRun[key]=s.age;delete s.automations.skipped[key];
  say(s,'finance','자동 지출 실행',`${key}: ${money(cost)}를 지출했습니다.`);
}
function advanceDinner(s) {
  if(!s.automations.dinner||done(s,'dinner')||s.automations.lastRun.dinner===s.age)return;
  const reason=(dinnerReason(s)||s.flags.prisonYears>0)?'ineligible':s.finance.cash<DINNER_COST?'insufficient_funds':s.finance.cash<=DINNER_COST*3||s.finance.cash-DINNER_COST<incomeBase(s)?'insufficient_reserve':null;
  if(reason){
    const previous=s.automations.skipped.dinner;s.automations.skipped.dinner={age:s.age,reason,cost:DINNER_COST};
    if(previous?.reason!==reason)say(s,'finance','외식·선물 자동 지출 보류',reason==='ineligible'?'나이·참여 대상·현재 활동 조건이 맞지 않아 지출을 보류했습니다.':reason==='insufficient_funds'?'외식·선물 비용 150 G가 부족하여 지출하지 않았습니다.':'외식·선물 뒤에 남겨 둘 준비금이 부족하여 지출하지 않았습니다. 준비금은 자체 게임 규칙입니다.');
    return;
  }
  const resumed=Boolean(s.automations.skipped.dinner);
  const result=applySystemAction(s,{actionId:'dinner'});
  if(result.ok&&resumed)say(s,'finance','외식·선물 자동 지출 재개','참여 조건과 준비금을 갖추어 보류했던 연간 지출을 재개했습니다.');
}
function advanceEducation(s) {
  if(!s.education.program||s.flags.educationOnLeave||s.flags.educationProgressAge===s.age)return;
  const p=s.education.program;
  if(p.id===NIGHT_SCHOOL){advanceNightSchool(s);return;}
  if(s.education.yearsLeft>1&&s.finance.cash<p.cost&&s.flags.educationFunding==='loan'){
    const shortfall=p.cost-s.finance.cash;
    if(s.finance.debt+shortfall<=12000){s.finance.cash+=shortfall;s.finance.debt+=shortfall;say(s,'education','학자금으로 수강 지속',`부족한 학비 ${money(shortfall)}만 빌려 수강을 이어 갑니다. 부채와 이자 의무가 함께 남습니다.`);}
  }
  if(s.education.yearsLeft>1 && !charge(s,p.cost)){s.flags.educationPaused=true;s.flags.educationPausedYears=(s.flags.educationPausedYears||0)+1;s.flags.educationPauseStartedAge??=s.age;say(s,'education','학비 부족','올해 학비가 부족해 수강을 보류했습니다. 일·학업 병행, 한도 내 학자금, 학점을 보존하는 휴학 중 다음 계획을 결정할 수 있습니다.');return;}
  if(s.education.yearsLeft>1)s.finance.annualExpense+=p.cost;
  s.flags.educationPaused=false;s.flags.educationPausedYears=0;delete s.flags.educationPauseStartedAge;s.flags.educationProgressAge=s.age;s.education.yearsLeft--;s.stats.knowledge=clamp(s.stats.knowledge+4);
  if(s.education.yearsLeft<=0){s.education.level=p.degree;s.education.history.push({id:p.id,age:s.age,degree:p.degree,field:p.field,result:'graduated',...(p.abroad?{abroad:p.abroad}:{})});if(p.abroad||/abroad/i.test(p.id))s.flags.studiedAbroad=true;s.education.program=null;s.flags.educationFunding='self';s.flags.educationOnLeave=false;say(s,'education','졸업',`${p.label} 과정을 마쳤습니다. 새로운 진로가 열렸습니다.`);}
}
function advanceFamily(s) {
  const descendants=people=>people.flatMap(p=>[p,...(Array.isArray(p.children)?descendants(p.children):[])]);
  const people=[...s.family.parents,...s.family.partners,...descendants(s.family.children),...s.family.friends];if(s.family.relationship)people.push(s.family.relationship);
  for(const p of people){if(!p.alive)continue;p.age++;const childRisk=s.settings.sensitive&&p.relation==='child'&&p.age<=8?(p.premature&&p.age<=2?.008:.001):0;const deathRisk=p.age>=72?Math.min(.65,.015+(p.age-72)*.008):childRisk;if(deathRisk>0&&random(s)<deathRisk){p.alive=false;p.deceasedAge=p.age;if(p.relation==='spouse')p.relation='late_spouse';if(p===s.family.relationship){p.relation='late_partner';p.cohabiting=false;s.family.partners.push(p);s.family.relationship=null;delete s.flags.cohabitationSince;}s.stats.happiness=clamp(s.stats.happiness-10);say(s,'family','가족과 이별',`${p.name}가 ${p.age}세에 세상을 떠났습니다. 남은 이들이 슬픔을 나누고 지원을 찾습니다.`);continue;}
    if(p.assignment){p.assignment.yearsLeft--;if(p.assignment.yearsLeft<=0){p.assignment=null;p.assignmentCompletedAge=s.age;say(s,'family','파견 이후 귀환',`${p.name}가 파견을 마치고 돌아왔습니다.`);}}
    if(['child','grandchild','great_grandchild'].includes(p.relation)){
      if(p.age===6)p.education='primary';if(p.age===12)p.education='secondary';
      if(!p.graduated&&(p.tuitionPaid||p.education==='college')&&p.age>=18)p.yearsStudied=(p.yearsStudied||0)+1;
      if(p.yearsStudied>=4&&!p.graduated){p.graduated=true;p.education='bachelor';say(s,'family','자녀의 졸업',`${p.name}가 학업을 마쳤습니다.`);}
      if(p.relation!=='child'&&p.age===25&&p.partnered===undefined)p.partnered=random(s)<.65;
      if(p.age>=30&&p.age<=45&&(p.married||p.partnered)&&!Array.isArray(p.children)){p.children=[person(s,p.relation==='child'?'grandchild':'great_grandchild',0)];say(s,'family','다음 세대',`${p.name}의 가정에 새로운 구성원이 태어났습니다.`);}
      if(p.business){const b=p.business;b.years++;const gross=moneyInt((800*b.level+700*b.employees)*(.65+random(s)*1.1));b.profit=gross-b.employees*1000-b.level*250;const balance=(p.businessCash||0)+b.profit;if(balance<0){p.businessCash=0;p.businessDebt=(p.businessDebt||0)-balance;}else{const repayment=Math.min(balance,p.businessDebt||0);p.businessDebt=(p.businessDebt||0)-repayment;p.businessCash=balance-repayment;}}
    }
  }
  const minors=alive(s.family.children).filter(c=>c.age<18).length;
  if(s.flags.childSupport>0)s.flags.childSupport=minors*250;
  const childCost=minors*350+alive(s.family.children).filter(c=>c.premature&&c.age<=2).length*500;annualBill(s,childCost+(s.flags.childSupport||0));
  if(s.flags.parentCare&&presentParents(s).some(p=>p.age>=60))annualBill(s,300);
  for(const child of s.family.children){
    if(!child.alive||!child.supportNeeds)continue;
    const support=child.supportNeeds;support.annualCost=300;
    if(charge(s,support.annualCost)){
      const resumed=support.supported===false;support.supported=true;support.lastPaidAge=s.age;support.fundedYears=(support.fundedYears||0)+1;s.finance.annualExpense+=support.annualCost;child.closeness=clamp((child.closeness||50)+2);s.stats.energy=clamp(s.stats.energy-1);
      if(resumed||support.fundedYears===1)say(s,'family',resumed?'자녀 지원 재개':'자녀 지속 지원',`${child.name}의 접근성·생활 지원에 300 G를 사용했습니다. 지원비와 돌봄 시간을 매년 반영합니다.`);
    }else{support.supported=false;support.lastShortfallAge=s.age;support.unmetYears=(support.unmetYears||0)+1;s.stats.energy=clamp(s.stats.energy-3);say(s,'family','자녀 지원비 부족',`${child.name}의 지원비 300 G가 부족해 지출을 보류했습니다. 가족의 돌봄 부담이 늘었으며 자금이 확보되면 다음 해 다시 지원합니다.`);}
  }
  if(s.flags.careBreak){s.career.breakYears++;s.stats.happiness=clamp(s.stats.happiness+1);}
}
function advanceHealth(s) {
  const env=environment(s);
  const ageLoss=s.age>=75?2.5:s.age>=55?1.2:s.age>=35?.5:0;
  const dietBonus=s.finance.diet==='healthy'?1:s.finance.diet==='budget'?-.5:.2;
  const environmentEffect=clamp((env.health-65)*.01,-.35,.3)-env.climatePressure*.4;
  s.stats.health=clamp(Math.round((s.stats.health-ageLoss+dietBonus+environmentEffect)*10)/10);
  s.stats.energy=clamp(s.stats.energy+12-(s.career.jobId?8:0)-(s.education.program&&!s.flags.educationOnLeave?5:0)-(s.education.program&&s.flags.educationFunding==='work-study'?4:0)-(s.flags.careBreak?5:0));
  for(const c of s.health.conditions){c.years++;s.stats.health=clamp(s.stats.health-(c.severity||1)*1.5);}
  if(s.health.treatment){s.health.treatment.yearsLeft--;s.stats.health=clamp(s.stats.health+7);if(s.health.treatment.yearsLeft<=0){const ids=s.health.treatment.conditionIds;s.flags.treatmentHistory??=[];s.flags.treatmentHistory.push({age:s.age,conditions:[...ids]});s.health.conditions=s.health.conditions.filter(c=>!ids.includes(c.id));s.health.treatment=null;say(s,'health','치료 경과','치료 과정을 마쳤습니다. 이후 다른 질환이나 재발 위험이 사라지는 것은 아니며 검진과 생활 관리를 이어갑니다.');}}
  if(s.health.disability&&!s.health.disability.supported)s.stats.energy=clamp(s.stats.energy-3);
  if(s.health.addiction>0){s.stats.health=clamp(s.stats.health-s.health.addiction/25);if(s.flags.addictionSupport)s.health.addiction=clamp(s.health.addiction-5);}
  if(s.age>=35&&random(s)<.025+(s.age>60?.025:0)){const ids=(s.age>=60?['ischemic_heart','stroke','copd','chronic']:['chronic','fracture']).filter(id=>!hasCondition(s,id));if(ids.length){const id=ids[Math.floor(random(s)*ids.length)];addDisease(s,id);say(s,'health','건강의 변화',`${DISEASES[id].name}으로 생활 관리가 필요해졌습니다. 검진과 치료를 선택할 수 있습니다.`);}}
}
function advanceFinance(s) {
  const f=s.finance, env=environment(s), wasRetired=s.career.retired, openingDebt=f.debt;
  f.annualIncome=0;f.annualExpense=0;f.tax=0;let operatingCosts=0,nonTaxable=0;
  if(s.career.jobId&&!(s.flags.prisonYears>0)&&!(s.flags.serviceYears>0)&&!s.career.retired){
    s.flags.workYears=Math.max(s.flags.workYears||0,s.career.years)+1;s.career.years++;
    const priorEnvironment=s.flags.salaryEnvironment||env.income;
    s.career.salary=moneyInt(s.career.salary*clamp(env.income/priorEnvironment,.9,1.1));s.flags.salaryEnvironment=env.income;
    const studyFactor=s.education.program&&!s.flags.educationOnLeave&&s.flags.educationFunding!=='work-study'&&!['remote','night',NIGHT_SCHOOL].includes(s.education.program.id)?.5:1;
    const earned=moneyInt(s.career.salary*studyFactor*env.jobDemand);f.annualIncome+=earned;s.flags.lastEarnedSalary=earned;s.flags.lastWorkingSalary=s.career.salary;
    setSkill(s,'work',1);
    if(['military','officer'].includes(s.career.jobId)&&s.age>=55){retire(s);say(s,'career','복무 종료와 은퇴','복무를 마치고 다음 해부터 연금 생활을 시작합니다.');}
  }
  if(wasRetired)f.annualIncome+=s.career.pension;
  if(s.flags.serviceYears>0)f.annualIncome+=2000;
  if(s.age<18)f.annualIncome+=moneyInt(env.income*(s.household==='high'?.06:s.household==='low'?.015:.03));
  if(f.business){const b=f.business;b.years++;const gross=moneyInt((800*b.level+700*b.employees)*(.65+random(s)*1.1)*env.jobDemand);const costs=b.employees*1000+b.level*250;b.profit=gross-costs;f.annualIncome+=gross;operatingCosts+=costs;}
  if(f.rentals>0){f.annualIncome+=moneyInt((s.flags.rentalValue??f.rentals*env.income*3)*.05);operatingCosts+=f.rentals*300;}
  if(s.politics.role)f.annualIncome+=s.politics.role==='national'?6000:1800;
  if(s.flags.reverseMortgage&&f.homeValue>0){const draw=Math.min(f.homeValue,moneyInt(env.income*.08));f.homeValue-=draw;f.annualIncome+=draw;nonTaxable+=draw;}
  const familyTransfers=s.family.partners.filter(p=>p.alive&&p.relation==='spouse'&&p.assignment).length*600;f.annualIncome+=familyTransfers;nonTaxable+=familyTransfers;
  f.tax=moneyInt(Math.max(0,f.annualIncome-operatingCosts-nonTaxable-3000)*.15);
  f.cash+=f.annualIncome;annualBill(s,f.tax+operatingCosts);
  if(s.age>=18){const food=f.diet==='healthy'?400:f.diet==='budget'?-200:0;const housing=f.home==='care'?2500:f.home==='rented'?moneyInt(env.income*.12):0;const living=moneyInt(env.income*.18*costBase(s)+(s.city==='urban'?250:0));let insurance=0;if(f.insurance==='expanded'&&(s.flags.insurancePaidThroughAge??-1)<s.age){insurance=500;s.flags.insurancePaidThroughAge=s.age;}annualBill(s,Math.max(100,living+food)+housing+moneyInt(200*f.socialBudget)+insurance);}
  const debtInterest=moneyInt(openingDebt*.04);f.debt+=debtInterest;f.annualExpense+=debtInterest;
  if(f.mortgage>0){const oldRentalDebt=rentalDebt(s),total=f.mortgage;const interest=moneyInt(total*.03),principal=Math.min(total,moneyInt(env.income*.08));const rentalPrincipal=Math.min(oldRentalDebt,moneyInt(principal*oldRentalDebt/total));annualBill(s,interest+principal);f.mortgage-=principal;s.flags.rentalMortgage=oldRentalDebt-rentalPrincipal;}
  if(s.flags.carOwned){annualBill(s,s.flags.carAnnualCost||400);s.flags.carValue=moneyInt(s.flags.carValue*.85);if(s.flags.carLoan>0){const interest=moneyInt(s.flags.carLoan*.06);const principal=Math.min(s.flags.carLoan,moneyInt(env.income*.08));annualBill(s,interest+principal);s.flags.carLoan-=principal;}if(s.settings.sensitive&&random(s)<.015&&addDisease(s,'fracture'))say(s,'health','이동 중 사고 이후','이동 중 부상으로 골절 치료가 필요해졌습니다. 치료비에는 현재 보험 보장이 적용됩니다.');}
  if(f.assets>0){const inv=INVESTMENTS.find(i=>i.id===f.allocation)||INVESTMENTS[0];const nominal=Number(inv.return??inv.expectedReturn??.03);const risk=Number(inv.risk??.05);let rate=clamp(nominal+(random(s)-.5)*risk*2,-.45,.35);if(f.allocation==='global'){const fx=(random(s)-.5)*.16;s.flags.lastExchangeChange=Math.round(fx*10000)/10000;s.flags.exchangeIndex=Math.round((s.flags.exchangeIndex||100)*(1+fx)*100)/100;rate=clamp((1+rate)*(1+fx)-1,-.5,.45);if(Math.abs(fx)>.05)say(s,'finance','해외 자산의 환산 변동',`가상 환율이 ${(fx*100).toFixed(1)}% 변해 해외 자산 평가에 함께 반영되었습니다. 실제 통화 예측이 아닙니다.`);}f.assets=moneyInt(f.assets*(1+rate));}
  if(f.homeValue>0&&!s.flags.reverseMortgage)f.homeValue=moneyInt(f.homeValue*1.01);
}

function advancePolitics(s) {
  if(s.politics.role&&s.politics.term>0){
    const level=s.politics.role;s.flags.politicalServiceYears??={local:0,national:0};s.flags.politicalServiceYears[level]=(s.flags.politicalServiceYears[level]||0)+1;s.politics.term--;
    if(s.politics.term===0){s.politics.role=null;say(s,'community','임기 마무리','대표 임기를 마쳤습니다. 실제 재직 경력은 남으며 다음 출마는 새 준비와 공천부터 시작합니다.');}
  }
  const c=s.flags.politicalCampaign;
  if(c?.status==='pending'&&c.appliedAge<s.age){
    const approved=random(s)<c.chance;c.status=approved?'approved':'rejected';c.resolvedAge=s.age;politicalRecord(s,c.level,c.status,c.chance);
    say(s,'community',approved?'공천 승인':'공천 거절',approved?`${c.level==='national'?'전국':'지방'} 선거 공천이 승인되었습니다. 선거에 출마하거나 준비를 취소할 수 있습니다.`:'공천 심사에서 승인되지 않았습니다. 심사비는 반환되지 않으며 다시 준비한 뒤 지원할 수 있습니다.');
  }
}
function advanceScholarships(s) {
  for(const student of s.flags.scholarshipStudents||[]){
    if(student.stopped)continue;
    if(student.graduated){
      if(student.careerNotifiedAge===undefined&&(student.graduatedAge===undefined||s.age>student.graduatedAge)){
        student.careerId=['teacher','nurse','electrician'][Math.floor(random(s)*3)];student.careerNotifiedAge=s.age;
        say(s,'community','후원 학생의 진로 소식',`후원으로 졸업한 학생이 ${label(JOBS.find(j=>j.id===student.careerId))} 일을 시작했다는 소식을 전했습니다. 진로와 시점은 자체 설계 규칙이며 추가 후원금은 청구하지 않습니다.`);
      }continue;
    }
    const prepaid=(student.prepaid||0)>=500;
    if(prepaid||charge(s,500)){if(prepaid)student.prepaid-=500;else s.finance.annualExpense+=500;student.years++;if(student.years>=4){student.graduated=true;student.graduatedAge=s.age;s.finance.scholarships=Math.max(0,s.finance.scholarships-1);s.flags.scholarshipGraduates=(s.flags.scholarshipGraduates||0)+1;say(s,'community','후원 학생의 졸업','4년간 후원한 학생이 학업을 마쳤다는 소식을 전했습니다.');}}
    else say(s,'finance','장학 후원 보류','올해 자금이 부족해 후원을 잠시 보류했습니다.');
  }
}

export function advanceSystems(s) {
  if(s.flags.prisonYears>0||s.flags.serviceYears>0)interruptPolitics(s,s.flags.prisonYears>0?'prison':'service');
  advanceFinance(s);advanceEducation(s);advanceFamily(s);advanceHealth(s);
  reconcileFocus(s);
  const focus=s.focus;
  if(focus==='study')s.stats.knowledge=clamp(s.stats.knowledge+3);
  else if(focus==='career'){setSkill(s,'work',1);s.stats.knowledge=clamp(s.stats.knowledge+1);}
  else if(focus==='family'){s.stats.happiness=clamp(s.stats.happiness+2);for(const p of s.family.children)if(p.alive)p.closeness=clamp((p.closeness||50)+2);}
  else if(focus==='health'){s.stats.health=clamp(s.stats.health+1.5);s.stats.energy=clamp(s.stats.energy+4);}
  else if(focus==='hobby'&&s.hobbies.length){const h=s.hobbies[s.age%s.hobbies.length];h.level=Math.min(20,h.level+1);s.stats.happiness=clamp(s.stats.happiness+2);}
  else if(focus==='social')s.stats.social=clamp(s.stats.social+3);
  else if(focus==='rest'){s.stats.health=clamp(s.stats.health+1);s.stats.happiness=clamp(s.stats.happiness+1);s.stats.energy=clamp(s.stats.energy+4);}
  else {s.stats.knowledge=clamp(s.stats.knowledge+1);s.stats.happiness=clamp(s.stats.happiness+1);}
  if(s.flags.prisonYears>0){s.flags.prisonYears--;if(s.flags.prisonYears===0)say(s,'community','사회 복귀','수감 기간이 끝났습니다. 일과 관계를 다시 이어갈 수 있습니다.');}
  if(s.flags.serviceYears>0){s.flags.serviceYears--;setSkill(s,'leadership',1);if(s.flags.serviceYears===0){s.flags.serviceCompleted=true;s.career.title='전역 · 진로 준비';say(s,'career','복무 완료와 전역','2년의 복무를 마쳤습니다. 민간 구직과 직업 복무 지원을 선택할 수 있습니다.');}}
  advancePolitics(s);
  reconcileFocus(s);
  s.migration.years++;if(s.migration.pending){s.migration.pending.yearsLeft--;if(s.migration.pending.yearsLeft<=0){s.migration.status=s.migration.pending.kind;s.migration.pending=null;if(s.migration.status==='citizen')s.flags.citizenships=[...new Set([s.birthCountryId,...(s.flags.citizenships||[]),s.countryId])];say(s,'mobility','체류 절차 완료',`${s.migration.status==='citizen'?'시민권 선서와 승인':s.migration.status==='permanent'?'영주권 승인':'거주 지원 승인'}이 완료되었습니다.`);}}
  automaticExpense(s,'certificate',600,()=>{s.flags.certificates=(s.flags.certificates||0)+1;setSkill(s,'work',2);setSkill(s,'leadership',1);},2,s.age>=16);
  automaticExpense(s,'tutoring',250,()=>{for(const c of s.family.children)if(c.alive&&c.age>=6&&c.age<18)c.tutoringYears=(c.tutoringYears||0)+1;},1,s.family.children.some(c=>c.alive&&c.age>=6&&c.age<18));
  automaticExpense(s,'lessons',300,()=>{for(const h of s.hobbies)h.level=Math.min(20,h.level+1);},1,s.hobbies.length>0);
  automaticExpense(s,'checkup',250,()=>runCheckup(s),1,s.age>=6);
  advanceScholarships(s);
  advanceDinner(s);
  // Keep the annual action ledger bounded without permitting repeat actions this year.
  if(s.flags.systemActions)for(const key of Object.keys(s.flags.systemActions))if(Number(key.split(':')[0])<s.age-1)delete s.flags.systemActions[key];
  for(const [key,value]of Object.entries(s.stats))s.stats[key]=Math.round(clamp(value)*10)/10;
}
