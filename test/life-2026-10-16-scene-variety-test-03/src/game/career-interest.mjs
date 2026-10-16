import { JOBS } from './world.mjs';

// Independent candidate policy. The reference's hidden matching and acceptance
// probabilities are unknown; no probability is inferred from one failed attempt.
const FIELDS = { general:'teacher', science:'engineer', arts:'artist', sports:'athlete', health:'nurse', law:'lawyer', technical:'engineer' };
const APTITUDES = { study:'teacher', arts:'artist', sports:'athlete', social:'entrepreneur', practical:'engineer' };
const ARTS = ['music','dance','painting','writing','photography'];
export const CAREER_INTEREST_PREFIX = 'career-interest:';

export function careerInterestCandidates(s) {
  const candidates=[];
  const add=(jobId,reason,basis)=>{if(jobId&&jobId!==s.career.jobId&&!candidates.some(c=>c.jobId===jobId))candidates.push({jobId,reason,basis});};
  if(s.flags.studyField)add(FIELDS[s.flags.studyField],'field',s.flags.studyField);
  for(const hobby of s.hobbies) {
    if(ARTS.includes(hobby.id))add('artist','hobby',hobby.id);
    if(hobby.id==='sports')add('athlete','hobby',hobby.id);
  }
  add(APTITUDES[s.flags.aptitude],'aptitude',s.flags.aptitude);
  return candidates.slice(0,3);
}

export const unresolvedCareerInterest = s => s.flags.careerInterests?.findLast(r=>r.result===null)??null;
export function dueCareerInterest(s) {
  const request=unresolvedCareerInterest(s);
  return s.status==='alive'&&request&&s.age>=request.dueAge?request:null;
}
export function careerInterestWorkReason(s) {
  if(s.status!=='alive')return '종료된 생애입니다.';
  if(s.age<18)return '18세부터 알아볼 수 있습니다.';
  if(s.career.retired)return '은퇴 후에는 새로운 정규 직업을 시작하지 않습니다.';
  if(s.flags.prisonYears>0)return '수감 생활을 마친 뒤 알아볼 수 있습니다.';
  if(s.flags.serviceYears>0)return '기간 복무를 마친 뒤 알아볼 수 있습니다.';
  if(s.health.treatment||s.stats.health<20)return '치료와 건강 회복이 먼저 필요합니다.';
  return null;
}
export function careerInterestRequestReason(s) {
  const work=careerInterestWorkReason(s);if(work)return work;
  const last=s.flags.careerInterests?.at(-1);
  const waiting=last&&s.age<last.nextAvailableAge?`${last.nextAvailableAge-s.age}년 뒤 다시 가능` : null;
  if(unresolvedCareerInterest(s))return waiting?`${waiting} · 진행 중인 탐색도 먼저 마쳐 주세요.`:'진행 중인 탐색 결과를 먼저 선택해 주세요.';
  if(waiting)return waiting;
  if(!careerInterestCandidates(s).length)return '지금 하는 일 외에 연결된 관심 분야가 없습니다. 전공이나 취미를 살펴보세요.';
  return null;
}
export function requestCareerInterest(s) {
  const reason=careerInterestRequestReason(s);if(reason)return {ok:false,error:reason};
  s.flags.careerInterests??=[];
  s.flags.careerInterests.push({version:1,requestedAge:s.age,requestedYear:s.year,dueAge:s.age+1,nextAvailableAge:s.age+2,candidates:careerInterestCandidates(s),result:null,source:'rule',synthetic:true});
  return {ok:true,message:'관심 있는 일의 준비 조건을 알아보기 시작했습니다. 다음 해에 도전할 일을 고릅니다.'};
}

export function validateCareerInterests(s) {
  const fail=()=>{throw new Error('희망 직업 탐색 기록이 올바르지 않습니다.');};
  const pending=s.pending?.structure?.startsWith(CAREER_INTEREST_PREFIX);
  const records=s.flags.careerInterests;if(records===undefined){if(pending)fail();return;}
  const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
  if(!Array.isArray(records)||!records.length||records.length>100)fail();
  let previous=null;
  for(const r of records) {
    if(!plain(r)||r.version!==1||r.source!=='rule'||r.synthetic!==true||!Number.isInteger(r.requestedAge)||r.requestedAge<18||r.requestedAge>s.age||r.requestedYear!==s.birthYear+r.requestedAge||r.dueAge!==r.requestedAge+1||r.nextAvailableAge!==r.requestedAge+2)fail();
    if(previous&&(previous.result===null||r.requestedAge<previous.nextAvailableAge||r.requestedAge<previous.result.age))fail();
    if(!Array.isArray(r.candidates)||r.candidates.length<1||r.candidates.length>3||new Set(r.candidates.map(c=>c?.jobId)).size!==r.candidates.length)fail();
    for(const c of r.candidates)if(!plain(c)||!JOBS.some(j=>j.id===c.jobId)||!((c.reason==='field'&&FIELDS[c.basis]===c.jobId)||(c.reason==='aptitude'&&APTITUDES[c.basis]===c.jobId)||(c.reason==='hobby'&&((ARTS.includes(c.basis)&&c.jobId==='artist')||(c.basis==='sports'&&c.jobId==='athlete')))))fail();
    if(r.result!==null) {
      const x=r.result;
      if(!plain(x)||!Number.isInteger(x.age)||x.age<r.dueAge||x.age>s.age||x.year!==s.birthYear+x.age||!['hired','not-qualified','deferred','already-working'].includes(x.outcome)||typeof x.reason!=='string'||x.reason.length>500)fail();
      if(x.previousJobId!==null&&!JOBS.some(j=>j.id===x.previousJobId))fail();
      if(x.outcome==='deferred'?x.jobId!==null:!r.candidates.some(c=>c.jobId===x.jobId))fail();
      if(x.outcome==='already-working'?x.jobId!==x.previousJobId:['hired','not-qualified'].includes(x.outcome)&&x.jobId===x.previousJobId)fail();
      if(!Number.isFinite(x.knowledgeGain)||x.knowledgeGain<0||x.knowledgeGain>1||(x.outcome!=='not-qualified'&&x.knowledgeGain!==0))fail();
    }
    previous=r;
  }
  if(pending&&!records.some(r=>r.result===null&&s.age>=r.dueAge&&s.pending.structure===CAREER_INTEREST_PREFIX+r.requestedAge))fail();
}
