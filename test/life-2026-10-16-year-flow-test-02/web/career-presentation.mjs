import {JOBS,HOBBIES} from '../src/game/world.mjs';
import {getCareerQualification} from '../src/game/systems.mjs';

// Historical request/result evidence is kept separate from present-day eligibility.
const when = (age,year) => `${year}년 · ${age}세`;
const jobName = id => JOBS.find(job=>job.id===id)?.label ?? '정해진 직업 없음';
const FIELDS={general:'일반·인문',science:'과학·공학',arts:'예술·공연',sports:'체육',health:'보건',law:'법·사회',technical:'직업 기술'};
const APTITUDES={study:'배움',arts:'예술',sports:'운동',social:'사교',practical:'실용'};
const LEVELS={none:'별도 학력 없음',primary:'초등',secondary:'중학교',high:'고등학교',highschool:'고등학교',vocational:'직업 교육',certificate:'직업 교육',bachelor:'학사',master:'석사',doctorate:'박사'};
function basis(candidate) {
  if(candidate.reason==='field')return `${FIELDS[candidate.basis]??candidate.basis} 희망 전공`;
  if(candidate.reason==='hobby')return `${HOBBIES.find(h=>h.id===candidate.basis)?.label??candidate.basis} 취미`;
  return `${APTITUDES[candidate.basis]??candidate.basis} 기질`;
}
const PREPARATION={
  education:{group:'education',label:'배움·학력 준비 보기'},doctorate:{group:'education',label:'배움·학력 준비 보기'},knowledge:{group:'education',label:'배움·학력 준비 보기'},
  sports:{group:'hobbies',label:'취미·연습 보기'},arts:{group:'hobbies',label:'취미·연습 보기'},
  leadership:{group:'community',label:'지역 봉사 보기'},health:{group:'health',label:'건강 돌봄 보기'}
};
function currentAmount(requirement,unit='') {
  const rounded=Number(requirement.current.toFixed(1));
  return rounded>=requirement.required&&requirement.current<requirement.required?`${requirement.required}${unit} 미만`:`${rounded}${unit}`;
}
function missingText(requirement) {
  const r=requirement;
  if(r.key==='education'||r.key==='doctorate')return `${r.reason} ${LEVELS[r.required]} 이상의 학력이 필요하며 현재 학력은 ${LEVELS[r.current]??r.current}입니다.`;
  if(r.key==='knowledge')return `${r.reason} 지식 ${r.required} 이상이 필요하며 현재는 ${currentAmount(r)}입니다.`;
  if(r.key==='sports')return `${r.reason} 현재 운동 취미는 ${currentAmount(r,'단계')}입니다.`;
  if(r.key==='arts')return `${r.reason} 현재 예술 취미 중 가장 높은 숙련도는 ${currentAmount(r,'단계')}입니다.`;
  if(r.key==='leadership')return `${r.reason} 현재 지도력은 ${currentAmount(r)}입니다.`;
  if(r.key==='health')return `${r.reason} ${r.inTreatment?'치료를 마쳐야 하며, ':''}건강 ${r.required} 이상이 필요합니다. 현재 건강은 ${currentAmount(r)}입니다.`;
  if(r.key==='age')return `${r.required}세부터 지원할 수 있습니다. 현재는 ${r.current}세입니다.`;
  if(r.key==='service-age')return `이 일은 ${r.limit}세 이전에 새로 지원할 수 있습니다.`;
  return r.reason;
}
export function presentCareerQualification(state,jobId) {
  const qualification=getCareerQualification(state,jobId);if(!qualification)return null;
  if(state.career.jobId===jobId)return {jobId,label:qualification.label,text:state.career.retired?'이 일의 경력을 가진 채 은퇴 생활 중입니다.':'이미 하고 있는 일입니다.',links:[]};
  const missing=qualification.missing.filter(r=>r.key!=='doctorate'||!qualification.missing.some(other=>other.key==='education'&&other.required===r.required));
  const links=[],groups=new Set();
  if(!missing.some(r=>['retired','service-age'].includes(r.key)))for(const requirement of missing){const link=PREPARATION[requirement.key];if(link&&!groups.has(link.group)){links.push({...link});groups.add(link.group);}}
  return {jobId,label:qualification.label,text:missing.length?missing.map(missingText).join(' '):'현재 지원 자격을 충족합니다.',links};
}
function requestView(state,request,index) {
  const application=`${when(request.requestedAge,request.requestedYear)}에 ${request.candidates.map(candidate=>`${jobName(candidate.jobId)}(${basis(candidate)}에서 연결)`).join(', ')} 일을 알아보기 시작했습니다.`;
  const result=request.result;
  if(!result) {
    const ended=state.status!=='alive';
    return {key:`career-interest:${request.requestedAge}`,number:index+1,status:ended?'생애 종료':state.age<request.dueAge?'탐색 중':'선택 대기',
      steps:[{label:'탐색 신청',text:application},
        ...(ended?[]:[{label:'현재 지원 조건',text:'지금의 지원 조건을 살펴보세요.',items:request.candidates.map(candidate=>presentCareerQualification(state,candidate.jobId))}]),
        {label:'결과',text:ended?'이 삶은 탐색의 선택 결과가 기록되기 전에 끝났습니다. 채용이나 실패로 처리하지 않습니다.':state.age<request.dueAge
          ? `${when(request.dueAge,request.requestedYear+1)}부터 기존 결정에서 지원하거나 보류할 수 있습니다. 아직 지원 결과는 없습니다.`
          : '아직 지원 결과를 고르지 않았습니다. 기존 결정에서 현재 가능한 지원이나 보류를 선택합니다.'}]};
  }
  const status={hired:'채용', 'not-qualified':'채용되지 않음',deferred:'지원 보류','already-working':'기존 일 유지'}[result.outcome];
  const decision=result.outcome==='deferred'?'지원을 보류했습니다.':`${jobName(result.jobId)} 일을 선택했습니다.`;
  const work=result.outcome==='hired'
    ? `당시 직업은 ${jobName(result.previousJobId)}에서 ${jobName(result.jobId)}로 바뀌었습니다.`
    : `이 선택으로 당시 직업(${jobName(result.previousJobId)})은 바뀌지 않았습니다.`;
  return {key:`career-interest:${request.requestedAge}`,number:index+1,status,
    steps:[{label:'탐색 신청',text:application},{label:'선택',text:`${when(result.age,result.year)}에 ${decision}`},
      {label:'당시 결과',text:`${result.reason} ${work}`}]};
}

export function presentCareerInterest(state) {
  const records=state.flags.careerInterests;
  if(!Array.isArray(records)||!records.length)return null;
  const latest=records.at(-1),retry=state.status==='alive'&&!state.career.retired&&latest.result?.outcome==='not-qualified'&&latest.result.jobId!==state.career.jobId
    ? presentCareerQualification(state,latest.result.jobId):null;
  return {title:'관심 직업 탐색의 흐름',entryLabel:'탐색',
    context:state.career.retired?'현재는 은퇴 생활 중입니다.':`현재 직업은 ${state.career.jobId?state.career.title:'정해지지 않은 상태'}입니다.`,
    attempts:records.map((record,index)=>requestView(state,record,index)),
    ...(retry?{preparation:{title:'이 일을 다시 준비한다면',text:'지금의 지원 조건을 살펴보세요.',items:[retry]}}:{}),
    hint:state.status==='alive'?'아래 기존 구직 선택에서 가능한 일을 확인할 수 있습니다. 취미나 훈련 경험만으로 필요한 학력을 대신하지는 않습니다.':'이 삶의 탐색과 선택 결과를 기록으로 보관합니다.'};
}
