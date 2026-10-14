import { attendingSchool } from './focus.mjs';
import { CAREER_INTEREST_PREFIX, dueCareerInterest, careerInterestWorkReason } from './career-interest.mjs';
import { SCHOOL_ENTRY, schoolEntryAvailable, schoolEntryQuote, resolveSchoolEntry, earlyWorkEligible } from './school.mjs';
import { clamp, random, log, person, money } from './shared.mjs';
import { COUNTRIES, HOBBIES, getCountry, getEnvironment, drawBirthCountry, HISTORICAL_REFERENCES, HISTORICAL_GAME_EFFECTS } from './world.mjs';
import { DEMOGRAPHIC_META, referenceDistribution } from './demographics.mjs';
import { adultLifeScene } from './adult-life.mjs';
import { authoredName } from './identity.mjs';
import { enrollProgram, applySystemAction, getSystemActions, relocateResidence, interruptPolitics, getCareerOpportunities, getEducationFundingOptions, resolveEducationFunding, getCareerChallengeOptions, resolveCareerChallenge } from './systems.mjs';

// Original Korean prose and independent synthetic rules. No external model or source-game text.
const rank = { none: 0, primary: 1, secondary: 2, highschool: 3, vocational: 4, bachelor: 5, master: 6, doctorate: 7 };
const choice = (id, label, effect, description = '', available = () => true) => ({ id, label, effect, description, available });
const stat = (s, key, amount) => { s.stats[key] = clamp(s.stats[key] + amount); };
const flag = (s, key, value = true) => { s.flags[key] = value; };
const debit = (s, amount) => { s.finance.cash -= amount; };
const enough = amount => s => s.finance.cash >= amount;
function withParticle(name,closed,open) { const last=String(name).charCodeAt(String(name).length-1);return `${name}${last>=0xac00&&last<=0xd7a3&&(last-0xac00)%28?closed:open}`; }
const eligibleEducation = (s, level) => (rank[s.education.level] || 0) >= rank[level];
function hash(value) { let h = 2166136261; for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const gate = (s, key, probability) => hash(`${s.seed}:${key}`) / 4294967296 < probability;
function learned(s, level) {
  if ((rank[s.education.level] || 0) < rank[level]) {
    s.education.level = level;
    s.education.history.push({ age: s.age, year: s.year, level, field: s.education.field || 'general', type: 'school' });
  }
}
function addHobby(s, id) { const h = s.hobbies.find(hobby => hobby.id === id); if (h) h.level++; else s.hobbies.push({ id, level: 1 }); }
function program(s, id, loan = false) {
  return enrollProgram(s,id,{loan});
}
function job(s, id) {
  return applySystemAction(s,{actionId:'job_apply',value:id});
}
function canJob(s,id) { const action=getSystemActions(s).find(a=>a.id==='job_apply');return Boolean(action&&!action.disabledReason&&action.options?.some(option=>option.value===id)); }
function canAction(s,id) { const action=getSystemActions(s).find(a=>a.id===id);return Boolean(action&&!action.disabledReason); }
function returnJob(s) { return canJob(s,'electrician')?'electrician':canJob(s,'retail')?'retail':'labor'; }
function addCondition(s, id, name, severity) { if (!s.health.conditions.some(c => c.id === id)) s.health.conditions.push({ id, name, severity, years: 0 }); }
function activePartner(s) { return s.family.partners.find(p => p.alive && p.relation==='spouse'); }
function supportChoice(s) { flag(s, 'supportNetwork'); stat(s, 'social', 8); stat(s, 'happiness', 5); }
function definition(key, kind, minAge, maxAge, title, body, choices, when = () => true) { return { key, kind, minAge, maxAge, title, body, choices, when }; }

// The reference observations establish four child actions, not their numeric
// effects. These small deterministic effects are our own synthetic rules.
const FIRST_STEPS = {
  observe:{label:'흙과 작은 돌을 자세히 살펴본다',effects:{knowledge:3},result:'손끝에 묻은 흙과 돌의 모양을 번갈아 살펴보았습니다. 작은 차이를 찾느라 걸음을 잠시 멈췄습니다.',memory:'작은 돌을 살펴보던 경험이 남아, 산책길에서 눈에 띄는 물건을 가리키며 이름을 묻기 시작했습니다.'},
  run:{label:'두 발로 힘껏 달려 본다',effects:{health:2,energy:-1},result:'두 발에 힘을 주어 달렸습니다. 잠시 숨을 고른 뒤, 어디까지 왔는지 뒤를 돌아보았습니다.',memory:'바깥에서 달려 보았던 기억을 따라, 몸을 움직이는 놀이와 쉬는 시간을 번갈아 익혔습니다.'},
  comfort:{label:'울고 있는 아이 곁으로 다가간다',effects:{social:3,happiness:1},result:'울음소리가 나는 쪽으로 다가가 곁에 머물렀습니다. 말은 짧았지만, 다른 아이의 표정을 오래 바라보았습니다.',memory:'울던 아이 곁에 머물렀던 뒤로, 함께 있는 사람의 표정과 목소리에 조금 더 귀를 기울였습니다.'},
  retry:{label:'넘어진 자리에서 일어나 다시 걷는다',effects:{energy:2,happiness:2},result:'넘어진 자리를 짚고 몸을 일으켰습니다. 곁에서 지켜보는 동안, 잠시 멈췄던 걸음을 다시 이어 갔습니다.',memory:'넘어진 뒤 다시 걸었던 경험을 떠올리며, 뜻대로 되지 않는 놀이도 쉬었다가 한 번 더 해 보았습니다.'},
};
function firstStep(s,id) {
  const action=FIRST_STEPS[id],effects={};
  for(const [key,amount] of Object.entries(action.effects)){const before=s.stats[key];stat(s,key,amount);effects[key]=s.stats[key]-before;}
  s.flags.childFirstSteps={choiceId:id,age:s.age,effects,source:'rule',synthetic:true,rulesVersion:1};
  return {ok:true,message:action.result};
}

const STORIES = [
  definition('childhood-first-steps','childhood',2,2,'두 살, 바깥에서','걸음이 익숙해지자 집 밖의 작은 풍경이 눈에 들어옵니다. 낯선 곳에서 가장 먼저 해 보고 싶은 것은 무엇인가요?',
    Object.entries(FIRST_STEPS).map(([id,action])=>choice(id,action.label,s=>firstStep(s,id))),s=>!s.seen.includes('birth-care')&&s.pending?.structure!=='birth-care'),
  // Keep the former three-choice contract solely for pending saves. A new
  // structure avoids reinterpreting old choice IDs, descriptions and history.
  // The earliest released form appeared at birth; later saves used age two.
  definition('birth-care','childhood',0,2,'두 살의 일상','주변에 손을 뻗고 자신의 뜻을 드러내기 시작했습니다. 가족과 보내는 시간에 어떤 경험을 더해 줄까요?',[
    choice('care','안정된 돌봄 시간을 만든다',s=>{stat(s,'health',5);stat(s,'happiness',5);flag(s,'earlyCare');},'건강·행복 +5'),
    choice('curiosity','호기심을 따라 함께 살펴본다',s=>{stat(s,'knowledge',7);flag(s,'curiosity');},'지식 +7'),
    choice('neighbors','이웃과 어울릴 기회를 만든다',s=>{stat(s,'social',7);flag(s,'neighbors');},'사회성 +7')],s=>s.pending?.structure==='birth-care'),
  definition('first-friend','childhood',4,7,'처음 같이 노는 사람','같은 놀이터에서 자주 만나는 아이가 당신을 기다립니다. 작은 약속을 지키는 경험이 남을 수 있습니다.',[
    choice('play','다음 놀이를 함께 정한다',s=>{s.family.friends.push(person(s,'어린 시절 친구',s.age));stat(s,'social',5);}),
    choice('quiet','혼자 좋아하는 놀이도 지킨다',s=>{stat(s,'happiness',4);addHobby(s,'craft');})]),
  definition('primary-school','education',6,9,'학교로 향하는 아침','배움의 시작을 준비합니다. 생활 형편은 다르지만 기본 교육을 받을 길이 열려 있습니다.',[
    choice('school','학교 수업을 중심으로 배운다',s=>{learned(s,'primary');stat(s,'knowledge',8);flag(s,'schoolAttendance','regular');}),
    choice('community','지역 배움터에서 시작한다',s=>{learned(s,'primary');stat(s,'knowledge',5);stat(s,'social',4);flag(s,'schoolAttendance','community');})],s=>!eligibleEducation(s,'primary')),
  definition('childhood-hobby','hobby',7,9,'시간 가는 줄 모르는 일','학교에서 돌아온 뒤에도 떠오르는 활동이 생겼습니다. 어떤 즐거움을 꾸준히 익혀 보고 싶나요?',[
    choice('reading','이야기 읽기',s=>{addHobby(s,'reading');stat(s,'knowledge',3);},'독서 취미를 시작합니다.'),
    choice('sports','몸을 움직이는 놀이',s=>{addHobby(s,'sports');stat(s,'health',3);},'운동 취미를 시작합니다.'),
    choice('music','노래와 악기',s=>{addHobby(s,'music');stat(s,'happiness',3);},'음악 취미를 시작합니다.')]),
  definition('literacy-support','education',8,13,'읽는 속도가 달라도','글을 읽는 데 시간이 더 걸립니다. 배움의 방식부터 바꾸어 볼 수 있습니다.',[
    choice('help','소규모 읽기 지원에 참여한다',s=>{stat(s,'knowledge',10);flag(s,'literacySupport');}),
    choice('practice','도서관에서 천천히 연습한다',s=>{stat(s,'knowledge',6);addHobby(s,'reading');})],s=>s.stats.knowledge<40),
  definition('child-scholarship','education',9,14,'배움을 잇는 지원','지역 배움터가 교육비 지원 대상자를 찾습니다. 이 제도는 게임을 위해 만든 지원 경로입니다.',[
    choice('apply','지원서를 내고 공부를 이어 간다',s=>{s.finance.cash+=1200;stat(s,'knowledge',5);flag(s,'receivedScholarship');},'교육 지원금 1,200 G'),
    choice('decline','지금의 학습 계획을 유지한다',s=>stat(s,'happiness',2))],s=>s.household==='low'&&gate(s,'child-scholarship',0.7)),
  definition('sport-talent','hobby',10,14,'몸으로 익히는 즐거움','학교 활동에서 움직임을 익히는 속도가 눈에 띄었습니다. 전문 진로는 이후의 노력과 선택에 달려 있습니다.',[
    choice('train','운동 동아리에 참여한다',s=>{addHobby(s,'sports');stat(s,'health',5);flag(s,'sportsTalent');}),
    choice('balance','친구들과 즐기는 취미로 둔다',s=>{stat(s,'social',4);stat(s,'happiness',4);})],s=>gate(s,'sport-talent',0.35)),
  definition('middle-school','education',12,15,'넓어진 교실','이제 더 많은 과목과 친구를 만나게 됩니다. 학교 밖의 활동과 공부의 균형을 정합니다.',[
    choice('study','기초 과목을 꼼꼼히 익힌다',s=>{learned(s,'secondary');stat(s,'knowledge',10);}),
    choice('club','수업과 동아리를 함께 챙긴다',s=>{learned(s,'secondary');stat(s,'knowledge',5);stat(s,'social',6);})],s=>s.pending?.structure==='middle-school'&&s.flags.schoolAttendance!=='stopped'),
  definition('arts-talent','hobby',13,17,'내 방식으로 표현하기','작은 발표를 준비하며 음악과 움직임이 당신에게 어떤 의미인지 생각합니다.',[
    choice('music','음악을 오래 배워 본다',s=>{addHobby(s,'music');flag(s,'artsTalent');stat(s,'happiness',6);}),
    choice('dance','무대 움직임을 배워 본다',s=>{addHobby(s,'dance');flag(s,'artsTalent');stat(s,'health',3);}),
    choice('audience','친구의 발표를 돕는다',s=>stat(s,'social',5))],s=>gate(s,'arts-talent',0.4)),
  definition('secondary-school','education',15,18,'다음 배움의 방향','일반 과목을 깊이 공부하거나 손으로 익히는 교육을 선택할 수 있습니다. 어느 길에서도 나중에 다시 배울 수 있습니다.',[
    choice('academic','일반 고교 과정을 따른다',s=>{learned(s,'highschool');stat(s,'knowledge',10);}),
    choice('technical','기술 중심 고교 과정을 따른다',s=>{learned(s,'highschool');stat(s,'knowledge',5);flag(s,'technicalExperience');})],s=>s.flags.schoolAttendance!=='stopped'),
  definition('identity','relationships',16,20,'내가 편안한 관계','다른 사람의 기대와 자신의 마음이 꼭 같지는 않습니다. 당신에게 편안한 관계와 경계를 정해도 괜찮습니다.',[
    choice('open','믿는 사람에게 내 마음을 나눈다',s=>{flag(s,'identityOpen');supportChoice(s);}),
    choice('private','나의 속도로 알아가기로 한다',s=>{flag(s,'identityPrivate');stat(s,'happiness',5);})]),
  definition('adult-transition','education',18,22,'어른의 문턱에서','일을 시작할 수도, 더 배울 수도 있습니다. 아래 비용은 첫해 학비이며 이후 학비는 재학 중 매년 발생합니다.',[
    choice('university','대학 진학에 지원한다',s=>program(s,'university'),'합격 시 첫해 4,000 G; 불합격 신청료 400 G. 합성 확률은 교육 메뉴 참고',s=>!s.flags.serviceYears&&!s.education.program&&eligibleEducation(s,'highschool')&&!eligibleEducation(s,'bachelor')&&s.stats.knowledge>=50&&s.finance.cash>=4000),
    choice('loan','학자금 대출로 원격 대학에 진학한다',s=>program(s,'remote',true),'첫해 대출 +2,200 G; 이후 연간 학비',s=>!s.flags.serviceYears&&!s.education.program&&s.finance.debt<=9800&&eligibleEducation(s,'highschool')&&!eligibleEducation(s,'bachelor')&&s.stats.knowledge>=38),
    choice('training','직업 교육을 시작한다',s=>program(s,'vocational'),'첫해 1,500 G',s=>!s.flags.serviceYears&&!s.education.program&&eligibleEducation(s,'secondary')&&!eligibleEducation(s,'vocational')&&s.stats.knowledge>=25&&s.finance.cash>=1500),
    choice('work','첫 일자리에서 경험을 쌓는다',s=>job(s,'labor'),'',s=>canJob(s,'labor')),
    choice('explore','지금의 여건에서 진로를 더 알아본다',s=>{stat(s,'knowledge',3);flag(s,'careerExploration');})]),
  definition('service-offer','career',19,23,'복무와 직업 사이','군 관련 진로 안내가 도착했습니다. 복무를 모두에게 요구하는 현실 법규의 재현은 아니며 이 삶의 선택 가능한 경로입니다.',[
    choice('term','2년 복무 과정을 선택한다',s=>applySystemAction(s,{actionId:'service'}),'복무 후 전역·민간 복귀 경로',s=>!s.flags.serviceCompleted&&!s.flags.serviceYears&&!s.health.disability),
    choice('enlist','직업 복무를 시작한다',s=>{const result=job(s,'military');if(result.ok)flag(s,'serviceStarted',s.age);return result;},'',s=>canJob(s,'military')),
    choice('civilian','민간에서의 계획을 이어 간다',s=>stat(s,'happiness',3))],s=>eligibleEducation(s,'highschool')&&!s.education.program&&!s.flags.prisonYears&&!s.flags.serviceYears&&gate(s,'service-offer',0.4)),
  definition('new-friend','relationships',21,30,'생활이 겹치는 사람','수업이나 일터 밖에서 자주 마주치는 사람이 있습니다. 관계를 맺는 데도 시간이 필요합니다.',[
    choice('connect','함께 시간을 보낸다',s=>{s.family.friends.push(person(s,'성인기 친구',s.age+1));stat(s,'social',6);}),
    choice('rest','지금은 나만의 시간을 확보한다',s=>{stat(s,'energy',10);stat(s,'happiness',3);})]),
  definition('graduate-path','education',22,50,'학위 다음의 질문','학부에서 익힌 내용을 일에 써 볼지, 연구를 더 할지 고민합니다. 진학은 별도 교육 메뉴에서도 바꿀 수 있습니다.',[
    choice('research','연구 질문을 정리하고 석사를 준비한다',s=>{flag(s,'researchInterest');stat(s,'knowledge',7);}),
    choice('practice','현장에서 경험을 쌓는 데 집중한다',s=>{stat(s,'social',5);flag(s,'practicalExperience');})],s=>s.education.level==='bachelor'&&!s.education.program),
  definition('doctoral-invitation','education',24,60,'연구를 계속할 기회','해외 석사 과정을 마쳤고 아직 직업을 정하지 않았다면 박사 연구로 이어갈 수 있습니다. 이 조건과 비용의 실행 규칙은 독립 설계입니다.',[
    choice('doctorate','박사 과정에 지원한다',s=>program(s,'doctorate'),'합격 시 첫해 5,000 G; 불합격 신청료 500 G',s=>s.finance.cash>=5000&&s.stats.knowledge>=78),
    choice('prepare','당장은 진로를 탐색하며 연구 자료를 남긴다',s=>{flag(s,'doctoralPreparation');stat(s,'knowledge',4);})],s=>s.education.level==='master'&&!s.education.program&&!s.career.jobId&&s.education.history.some(h=>h.degree==='master'&&h.result==='graduated'&&(h.abroad||h.id==='abroadMasters'))),
  definition('move-opportunity','migration',25,39,'다른 동네의 기회','도시에 모인 일자리 소식이 들려옵니다. 이동은 생활비와 주거 환경도 바꿉니다.',[
    choice('move','도시로 거처를 옮긴다',s=>{debit(s,800);s.city='urban';stat(s,'social',4);flag(s,'movedForWork');},'이동비 800 G',enough(800)),
    choice('stay','지금 사는 곳에서 기회를 찾는다',s=>{stat(s,'happiness',4);flag(s,'localRoots');})],s=>s.city==='rural'),
  definition('disaster','world',24,45,'일상이 멈춘 날','큰 비로 일부 길과 일터가 멈췄습니다. 이것은 특정 국가의 실제 재난을 재현한 사건이 아닙니다.',[
    choice('shelter','안전한 임시 거처로 이동한다',s=>{flag(s,'displaced');flag(s,'disasterAge',s.age);stat(s,'happiness',-5);}),
    choice('help','공동 대피와 복구를 돕는다',s=>{flag(s,'displaced');flag(s,'disasterAge',s.age);stat(s,'energy',-8);stat(s,'social',8);})],s=>gate(s,'disaster',.08+getEnvironment(s.countryId,{year:s.year,mode:s.mode,city:s.city,household:s.household}).climatePressure*.5)),
  definition('disaster-recovery','world',25,60,'다시 일상을 세우는 일','대피 뒤 적어도 한 해가 지났습니다. 이제 임시 생활에서 벗어날 방법을 고릅니다.',[
    choice('return','복구된 지역으로 돌아간다',s=>{flag(s,'displaced',false);stat(s,'happiness',7);flag(s,'disasterRecovered');}),
    choice('resettle','다른 도시에서 정착한다',s=>{flag(s,'displaced',false);s.city='urban';stat(s,'social',5);flag(s,'disasterResettled');})],s=>s.flags.displaced&&s.age>s.flags.disasterAge&&!gate(s,'asylum-route',0.4)),
  definition('work-injury','health',28,52,'몸의 변화에 맞추기','사고 뒤 움직임에 오래 영향을 주는 변화가 남았습니다. 필요한 지원과 일하는 방식을 함께 조정합니다.',[
    choice('adapt','보조 도구와 업무 조정을 요청한다',s=>{s.health.disability={id:'mobility',name:'이동 지원 필요',supported:true};flag(s,'workplaceAdapted');stat(s,'health',-8);stat(s,'social',4);}),
    choice('rehab','회복 시간을 확보하고 지원을 연결한다',s=>{s.health.disability={id:'mobility',name:'이동 지원 필요',supported:false};flag(s,'rehabilitation');stat(s,'health',-5);stat(s,'energy',8);})],s=>s.settings.sensitive&&!s.health.disability&&gate(s,'work-injury',0.1)),
  definition('care-interruption','family',29,46,'누군가를 돌보는 시간','가족의 일상에 더 많은 돌봄이 필요해졌습니다. 유급 일을 쉬는 선택은 소득과 경력에 영향을 줍니다.',[
    choice('shared','주변 사람과 돌봄을 나눈다',s=>{flag(s,'sharedCare');stat(s,'social',6);stat(s,'energy',-3);}),
    choice('leave','일을 쉬며 직접 돌본다',s=>applySystemAction(s,{actionId:'care_break'}),'가족·직업 메뉴와 같은 돌봄 공백 및 복귀 기록 사용',s=>canAction(s,'care_break'))],s=>s.career.jobId&&s.family.children.some(c=>c.alive&&c.age<8)&&gate(s,'care-interruption',0.6)),
  definition('care-return','career',32,64,'돌봄 이후의 일','돌봄을 맡은 뒤 시간이 흘렀습니다. 다시 일할 준비를 하거나 지금의 선택을 이어 갈 수 있습니다.',[
    choice('retrain','복귀 준비 교육을 받는다',s=>{flag(s,'returningWorker');stat(s,'knowledge',8);}),
    choice('return','유급 일을 다시 시작한다',s=>{const result=job(s,returnJob(s));if(result.ok){flag(s,'careBreak',false);flag(s,'returningWorker');}return result;},'',s=>canJob(s,returnJob(s))),
    choice('continue','돌봄을 계속하되 도움을 늘린다',s=>{flag(s,'careReturnDeferred');supportChoice(s);})],s=>s.flags.careBreak&&(s.age>=s.flags.careBreakAge+3||s.career.breakYears>=3)),
  definition('parent-care','family',35,60,'부모 세대의 속도','가족 중 나이 든 이의 일상을 살피게 되었습니다. 자신이 할 수 있는 돌봄의 범위를 정합니다.',[
    choice('visit','정기적으로 찾아가 돕는다',s=>{stat(s,'energy',-5);stat(s,'happiness',5);flag(s,'parentCarePlan','family');}),
    choice('service','돌봄 서비스를 함께 마련한다',s=>{debit(s,1000);flag(s,'parentCare',true);flag(s,'parentCarePlan','paid');stat(s,'happiness',7);},'이번 지원 1,000 G; 이후 연간 300 G',enough(1000)),
    choice('network','친척·이웃과 지원 계획을 세운다',s=>{flag(s,'parentCarePlan','network');stat(s,'social',5);})],s=>s.family.parents.some(p=>p.alive&&p.age>=65)),
  definition('relationship-conflict','relationships',27,65,'함께 사는 사람과의 거리','생활 방식의 차이로 다툼이 이어집니다. 대화의 경계와 안전한 공간을 우선 정할 수 있습니다.',[
    choice('talk','대화할 시간을 따로 정한다',s=>{const p=activePartner(s);if(p)p.closeness=clamp((p.closeness||50)+12);flag(s,'relationshipTalk');stat(s,'happiness',4);}),
    choice('distance','당분간 따로 지내며 지원을 구한다',s=>{flag(s,'safeSpace');flag(s,'conflictAge',s.age);flag(s,'conflictPartnerId',activePartner(s).id);supportChoice(s);})],s=>s.settings.sensitive&&activePartner(s)&&gate(s,'relationship-conflict',0.3)),
  definition('relationship-aftercare','relationships',28,75,'거리 뒤에 남은 선택','따로 지낸 시간이 지난 뒤, 함께 살 방식과 관계의 지속 여부를 다시 생각합니다.',[
    choice('separate','이혼·양육 협의를 진행한다',s=>{const result=applySystemAction(s,{actionId:'divorce'});if(result.ok){flag(s,'safeSpace',false);stat(s,'happiness',5);}return result;},'가족 메뉴와 같은 협의비 500 G·재산 정산 적용',s=>canAction(s,'divorce')),
    choice('agreement','경계를 합의하고 생활을 조정한다',s=>{const p=activePartner(s);if(p)p.closeness=clamp((p.closeness||50)+10);flag(s,'safeSpace',false);flag(s,'relationshipAgreement');}),
    choice('protection','안전한 공간과 지원을 유지한다',s=>{flag(s,'ongoingSeparation');supportChoice(s);},'혼인 상태는 유지되며 법적 협의는 가족 메뉴에서 진행')],s=>s.flags.safeSpace&&s.age>s.flags.conflictAge&&activePartner(s)&&(!s.flags.conflictPartnerId||activePartner(s).id===s.flags.conflictPartnerId)),
  definition('addiction-risk','health',25,50,'불편함을 덮는 습관','긴장을 풀기 위한 습관이 생활을 차지하기 시작했습니다. 혼자 감당하지 않아도 됩니다.',[
    choice('seek','가까운 사람에게 도움을 구한다',s=>{flag(s,'addictionPrevented');supportChoice(s);}),
    choice('delay','아직 정리가 어렵다는 것을 인정한다',s=>{s.health.addiction=35;flag(s,'addictionAge',s.age);stat(s,'health',-5);})],s=>s.settings.sensitive&&s.health.addiction===0&&gate(s,'addiction-risk',0.15)),
  definition('addiction-treatment','health',26,65,'습관을 바꾸는 지원','문제를 인정한 뒤 도움을 받을 통로를 찾았습니다. 회복은 한 번의 다짐보다 지속적인 지원에 가깝습니다.',[
    choice('support','지역 회복 프로그램에 참여한다',s=>{s.health.addiction=Math.max(0,s.health.addiction-25);flag(s,'recoverySupport');stat(s,'health',5);}),
    choice('therapy','전문 상담과 치료 계획을 시작한다',s=>{debit(s,500);s.health.addiction=0;flag(s,'recoverySupport');stat(s,'health',8);},'치료 지원비 500 G',enough(500))],s=>s.health.addiction>0&&s.age>s.flags.addictionAge),
  definition('debt-pressure','finance',22,60,'빚이 일상에 들어올 때','상환 부담이 커졌습니다. 먼저 무엇을 줄이고 무엇을 지킬지 정리합니다.',[
    choice('plan','상환과 생활을 분리한 계획을 세운다',s=>{flag(s,'debtPlan');s.finance.socialBudget=0.5;stat(s,'knowledge',4);}),
    choice('support','일자리와 공적 지원 정보를 모은다',s=>{flag(s,'supportNetwork');stat(s,'social',6);})],s=>s.finance.debt>5000),
  definition('illegal-offer','world',24,45,'빠른 돈을 약속하는 제안','불투명한 일을 맡으면 큰돈을 준다는 제안을 받았습니다. 세부 수법은 제시하지 않습니다. 선택에는 법적·생활상 결과가 따릅니다.',[
    choice('reject','거절하고 안전한 수입을 찾는다',s=>{flag(s,'illegalOfferRejected');stat(s,'knowledge',3);}),
    choice('accept','위험한 제안을 받아들인다',s=>{flag(s,'prisonYears',3);flag(s,'prisonStart',s.age);interruptPolitics(s,'prison');s.career.jobId=null;s.career.salary=0;s.career.title='수감으로 경력 중단';stat(s,'happiness',-15);},'적발되어 3년 수감·경력 중단')],s=>s.settings.sensitive&&s.finance.debt>3000&&gate(s,'illegal-offer',0.25)),
  definition('social-return','career',27,60,'사회로 돌아온 뒤','형기를 마친 뒤 다시 생활을 꾸릴 시간이 왔습니다. 과거가 이후의 모든 선택을 결정하지는 않습니다.',[
    choice('training','직업 교육과 상담을 받는다',s=>{learned(s,'vocational');stat(s,'knowledge',8);flag(s,'reentrySupport');}),
    choice('work','가능한 일부터 다시 시작한다',s=>{const result=job(s,'labor');if(result.ok)flag(s,'reentrySupport');return result;},'',s=>canJob(s,'labor'))],s=>Number.isInteger(s.flags.prisonStart)&&!s.flags.prisonYears&&s.age>=s.flags.prisonStart+3),
  definition('business-handover','finance',50,75,'가게의 다음 주인','오래 운영한 일을 누군가에게 넘기거나 정리할 시기가 다가옵니다. 가족의 선택을 대신 정하지는 않습니다.',[
    choice('family','희망하는 성인 자녀와 승계를 논의한다',s=>{flag(s,'businessSuccession','family-discussion');flag(s,'businessSuccessionAge',s.age);stat(s,'social',5);},'',s=>s.family.children.some(c=>c.alive&&c.age>=20)),
    choice('sale','정리 자금을 받고 운영을 마친다',s=>{const result=applySystemAction(s,{actionId:'business_close'});if(result.ok)flag(s,'businessSuccession','sold');return result;},'경제 메뉴와 같은 사업 정리 규칙 적용',s=>canAction(s,'business_close')),
    choice('keep','아직은 직접 운영한다',s=>flag(s,'businessSuccession','continued'))],s=>s.finance.business&&s.finance.business.years>=8),
  definition('career-meaning','career',40,58,'익숙해진 일의 의미','처음 일을 시작했을 때와 지금의 기준은 달라졌습니다. 어떤 방식으로 다음 시간을 채울까요?',[
    choice('mentor','후배와 경험을 나눈다',s=>{stat(s,'social',8);flag(s,'mentor');}),
    choice('study','새로운 분야를 다시 배운다',s=>{stat(s,'knowledge',8);flag(s,'lifelongLearning');}),
    choice('balance','일 밖의 생활을 회복한다',s=>{stat(s,'happiness',8);stat(s,'energy',8);})],s=>Boolean(s.career.jobId)),
  definition('midlife-check','health',45,65,'몸이 보내는 신호','검진 일정을 잡을 때가 되었습니다. 검진은 모든 병을 막지는 않지만 몸의 변화를 알아차리는 데 도움이 됩니다.',[
    choice('screen','이번에 검진을 받는다',s=>{debit(s,300);stat(s,'health',5);flag(s,'screenedAt',s.age);},'검진비 300 G',enough(300)),
    choice('habit','수면과 활동을 먼저 조정한다',s=>{stat(s,'health',3);stat(s,'energy',5);flag(s,'healthRoutine');})]),
  definition('long-condition','health',50,78,'오래 관리해야 하는 변화','몸의 변화가 한동안 계속되었습니다. 진단 뒤 치료와 일상의 균형을 다시 정합니다.',[
    choice('care','치료를 받을 준비를 한다',s=>{addCondition(s,'chronic','만성 질환',2);flag(s,'carePrepared');stat(s,'health',-6);}),
    choice('adapt','활동량을 조절하며 지원을 구한다',s=>{addCondition(s,'chronic','만성 질환',2);stat(s,'energy',8);stat(s,'health',-8);})],s=>gate(s,'long-condition',0.4)&&!s.health.conditions.length),
  definition('retirement-plan','career',58,72,'일을 마친 뒤의 시간','은퇴 이후의 수입과 하루를 생각합니다. 은퇴 실행은 직업 메뉴에서 결정할 수 있습니다.',[
    choice('prepare','연금과 주거를 함께 점검한다',s=>{flag(s,'retirementPrepared');stat(s,'knowledge',5);}),
    choice('community','이웃과 취미의 시간을 늘린다',s=>{addHobby(s,'volunteer');stat(s,'social',5);})],s=>!s.career.retired),
  definition('late-learning','education',60,80,'늦게 시작해도 좋은 것','점수나 취업을 위한 공부가 아니어도 좋습니다. 오랫동안 미뤄 둔 관심사를 펼쳐 봅니다.',[
    choice('writing','글로 경험을 정리한다',s=>{addHobby(s,'writing');stat(s,'knowledge',5);stat(s,'happiness',5);}),
    choice('garden','식물을 돌보는 생활을 배운다',s=>{addHobby(s,'gardening');stat(s,'health',4);stat(s,'happiness',5);})]),
  definition('legacy-plan','family',67,88,'남길 마음을 정리하며','남은 재산과 기억을 누구에게 어떻게 전할지 생각합니다. 유언 설정은 경제 메뉴에서 다시 바꿀 수 있습니다.',[
    choice('family','가족에게 전할 이야기를 남긴다',s=>{flag(s,'legacyMessage','함께 보낸 시간을 오래 기억해 주세요.');stat(s,'happiness',5);}),
    choice('community','공동체와 나눌 뜻을 적는다',s=>{flag(s,'legacyMessage','누군가의 다음 배움에 작은 힘이 되기를 바랍니다.');stat(s,'social',4);})]),
  definition('elder-support','family',75,100,'도움받는 일도 삶의 일부','생활에 도움이 필요한 날이 많아졌습니다. 익숙한 공간과 지원을 함께 고려합니다.',[
    choice('home','집에서 받을 지원을 연결한다',s=>{flag(s,'elderSupport','home');stat(s,'health',3);}),
    choice('community','공동 돌봄 공간을 선택한다',s=>{flag(s,'elderSupport','community');stat(s,'social',5);stat(s,'happiness',3);})]),
  definition('last-seasons','memory',85,110,'작은 계절을 바라보며','앞으로의 시간이 얼마나 남았는지는 알 수 없습니다. 오늘의 하루를 어떤 장면으로 채울지 고릅니다.',[
    choice('people','소중한 사람과 이야기를 나눈다',s=>{stat(s,'happiness',6);flag(s,'lastSeason','people');}),
    choice('quiet','좋아하는 일을 조용히 이어 간다',s=>{stat(s,'happiness',6);flag(s,'lastSeason','quiet');})]),
  definition('early-health','health',3,3,'작은 몸을 돌보는 시간','예정보다 일찍 세상에 나온 뒤 성장 속도를 살펴보고 있습니다. 가족은 필요한 돌봄과 휴식을 연결합니다.',[
    choice('clinic','성장 검진과 돌봄을 이어 간다',s=>{flag(s,'earlyHealthSupport');stat(s,'health',3);}),
    choice('network','가족의 도움을 나누어 받는다',s=>{flag(s,'earlyHealthSupport');stat(s,'social',3);stat(s,'happiness',3);})],s=>s.settings.sensitive&&gate(s,'early-health',0.12)),
  definition('absent-parent','family',5,10,'함께 살지 않는 가족','부모 중 한 사람과 떨어져 지내게 되었습니다. 함께 사는 사람들과 안정된 일상을 만드는 일이 먼저입니다.',[
    choice('ask','믿을 만한 어른에게 마음을 이야기한다',s=>{const p=s.family.parents[1];if(p){p.absent=true;flag(s,'absentParentId',p.id);}supportChoice(s);}),
    choice('routine','친구와 일상의 리듬을 지킨다',s=>{const p=s.family.parents[1];if(p){p.absent=true;flag(s,'absentParentId',p.id);}stat(s,'happiness',4);})],s=>s.settings.sensitive&&s.family.parents[1]?.alive&&!s.family.parents[1].absent&&gate(s,'absent-parent',0.18)),
  definition('learning-style','education',8,15,'배우는 방식 찾기','집중과 감각의 방식이 주변과 다를 수 있습니다. 같은 목표에 이르는 방법은 하나만 있지 않습니다.',[
    choice('adjust','수업 환경과 도구를 조정한다',s=>{flag(s,'learningSupport','adjusted');stat(s,'knowledge',8);}),
    choice('mentor','신뢰하는 지도자와 학습 계획을 만든다',s=>{flag(s,'learningSupport','mentor');stat(s,'knowledge',5);stat(s,'social',4);})],s=>gate(s,'learning-style',0.2)),
  definition('sports-school','education',15,17,'운동과 수업을 함께','운동을 이어갈 수 있는 교육 과정에서 초대가 왔습니다. 진학이 곧 전문 선수 계약을 뜻하지는 않습니다.',[
    choice('join','체육 중심 학교 과정에 참여한다',s=>{learned(s,'highschool');flag(s,'sportsSchool');addHobby(s,'sports');stat(s,'health',3);}),
    choice('remain','현재 학교와 동아리를 유지한다',s=>stat(s,'knowledge',4))],s=>s.flags.sportsTalent||s.hobbies.some(h=>h.id==='sports'&&h.level>=2)),
  definition('academy-path','education',18,22,'장교 교육을 준비하며','복무와 학업을 함께 이어 가는 진로를 살펴봅니다. 이 과정의 조건은 실제 국가별 제도와 다른 설계값입니다.',[
    choice('academy','대학 수준의 군 관련 교육에 지원한다',s=>{const result=program(s,'university');if(result.admitted){s.education.program.field='military';s.education.field='military';flag(s,'militaryAcademy');s.flags.skills??={};s.flags.skills.leadership=(s.flags.skills.leadership||0)+2;}return result;},'합격 시 첫해 4,000 G; 불합격 신청료 400 G',s=>!s.education.program&&!eligibleEducation(s,'bachelor')&&s.stats.knowledge>=60&&s.finance.cash>=4000),
    choice('explore','민간 진로와 비교하며 더 알아본다',s=>{stat(s,'knowledge',4);flag(s,'academyExplored');})],s=>eligibleEducation(s,'highschool')&&gate(s,'academy-path',0.2)),
  definition('community-vocation','career',22,45,'믿음과 돌봄의 일','종교 공동체에서 사람을 돌보는 일을 제안합니다. 어떤 믿음을 가질지는 개인의 선택입니다.',[
    choice('accept','공동체 활동가로 일한다',s=>{const result=job(s,'clergy');if(result.ok)flag(s,'communityVocation');return result;},'',s=>canJob(s,'clergy')),
    choice('volunteer','직업은 유지하고 자원활동으로 돕는다',s=>{stat(s,'social',6);flag(s,'communityVolunteer');})],s=>eligibleEducation(s,'highschool')&&s.stats.knowledge>=40&&gate(s,'community-vocation',0.15)),
  definition('asylum-route','migration',25,55,'머무를 곳이 필요한 때','재난 뒤 돌아갈 기반이 사라져 다른 지역에서 안전을 찾습니다. 실제 이주 법률이 아닌 합성 위기 경로입니다.',[
    choice('cross','다른 나라의 임시 보호를 요청한다',s=>{const destinations=COUNTRIES.filter(c=>c.id!==s.countryId);const next=destinations[hash(`${s.seed}:refuge`)%destinations.length];const result=relocateResidence(s,next.id,{status:'refugee',city:'urban'});if(!result.ok)return result;flag(s,'displaced',false);flag(s,'crisisMigration');stat(s,'happiness',-3);},'거주지가 바뀌며 체류 지원 절차가 열림. 기존 주택·담보는 이전 나라의 임대 자산으로 보존'),
    choice('local','현재 지역의 장기 거처를 구한다',s=>{flag(s,'displaced',false);flag(s,'localCrisisSupport');stat(s,'social',5);})],s=>s.flags.displaced&&s.age>s.flags.disasterAge&&gate(s,'asylum-route',0.4)),
  definition('parent-reunion','family',35,60,'오래 끊겼던 연락','함께 살지 않았던 부모에게 안부를 전할 통로를 찾았습니다. 연락 여부와 관계의 거리는 스스로 정할 수 있습니다.',[
    choice('contact','안부를 전하고 상대의 뜻을 기다린다',s=>{const p=s.family.parents.find(p=>p.id===s.flags.absentParentId);const accepted=gate(s,'parent-reunion-response',0.6);flag(s,'reunionResult',accepted?'contact-established':'contact-declined');if(p&&accepted){p.absent=false;p.closeness=55;}stat(s,'happiness',accepted?5:-2);},'상대가 연락을 원하지 않을 수도 있음'),
    choice('boundary','지금은 연락하지 않기로 한다',s=>{flag(s,'reunionResult','player-declined');stat(s,'happiness',3);})],s=>Boolean(s.flags.absentParentId)&&s.family.parents.some(p=>p.id===s.flags.absentParentId&&p.alive)),
  definition('partner-assignment','family',30,54,'서로 다른 도시에서의 시간','배우자에게 3년간 다른 나라에서 일할 기회가 생겼습니다. 가족 모두가 이동하는 것과 떨어져 지내는 것은 다른 선택입니다.',[
    choice('apart','배우자의 3년 파견을 함께 준비한다',s=>{const p=activePartner(s),destinations=COUNTRIES.filter(c=>c.id!==s.countryId),destination=destinations[hash(`${s.seed}:partner-assignment`)%destinations.length];const result=applySystemAction(s,{actionId:'spouse_assignment',value:destination.id});if(result.ok){flag(s,'partnerAssignmentId',p.id);flag(s,'partnerAssignmentStart',s.age);flag(s,'partnerAssignmentReturn',s.age+3);stat(s,'happiness',-2);}return result;},'준비비 300 G. 가족 메뉴와 같은 파견·귀환 상태 사용',s=>canAction(s,'spouse_assignment')),
    choice('local','현재 생활을 유지하는 방안을 함께 찾는다',s=>{const p=activePartner(s);p.closeness=clamp((p.closeness||50)+5);})],s=>Boolean(activePartner(s))&&!activePartner(s).assignment&&!(activePartner(s).awayUntil>s.age)&&gate(s,'partner-assignment',0.25)),
  definition('partner-return','family',32,60,'함께 사는 리듬을 다시','파견 기간이 끝났습니다. 떨어져 지내며 달라진 일상과 기대를 서로 이야기합니다.',[
    choice('reconnect','생활을 다시 맞추며 시간을 보낸다',s=>{const p=s.family.partners.find(p=>p.id===s.flags.partnerAssignmentId);if(p){p.awayUntil=null;p.closeness=clamp((p.closeness||50)+8);}stat(s,'happiness',6);}),
    choice('space','각자의 리듬도 존중하며 합의한다',s=>{const p=s.family.partners.find(p=>p.id===s.flags.partnerAssignmentId);if(p)p.awayUntil=null;stat(s,'social',5);})],s=>Number.isInteger(s.flags.partnerAssignmentReturn)&&s.age>=s.flags.partnerAssignmentReturn&&s.family.partners.some(p=>p.id===s.flags.partnerAssignmentId&&p.alive&&p.relation==='spouse'&&!p.assignment)),
  definition('guarantee-request','finance',30,55,'이름을 빌려 달라는 부탁','지인이 대출 보증을 부탁했습니다. 서명은 친분과 별개로 상환 책임을 만들 수 있습니다.',[
    choice('decline','보증은 거절하고 다른 도움을 찾는다',s=>{flag(s,'guarantee','declined');stat(s,'knowledge',3);}),
    choice('sign','위험을 감수하고 보증한다',s=>{flag(s,'guarantee','signed');flag(s,'guaranteeAge',s.age);},'다음 해 3,000 G의 채무가 발생할 수 있음')],s=>s.family.friends.some(f=>f.alive)&&gate(s,'guarantee-request',0.18)),
  definition('guarantee-result','finance',31,60,'보증 뒤에 온 연락','대출의 상환 상황을 확인할 때가 되었습니다. 약속의 결과를 장부에 반영합니다.',[
    choice('review','상환 결과를 확인하고 책임을 정리한다',s=>{const defaulted=gate(s,'guarantee-default',0.55);flag(s,'guarantee',defaulted?'defaulted':'repaid');if(defaulted)s.finance.debt+=3000;else stat(s,'happiness',3);},'독립 규칙에 따라 채무 3,000 G 또는 정상 상환으로 정산')],s=>s.flags.guarantee==='signed'&&s.age>s.flags.guaranteeAge),
  definition('stroke-recovery','health',55,85,'갑작스러운 변화 이후','갑작스러운 뇌혈관 질환 이후 치료와 재활이 필요한 시간이 왔습니다. 결과는 개인별 실제 예후를 설명하지 않습니다.',[
    choice('rehab','치료 이후 재활을 준비한다',s=>{addCondition(s,'stroke','뇌혈관 질환',3);s.health.disability={id:'stroke',name:'재활 지원 필요',supported:false};flag(s,'strokeRecovery');stat(s,'health',-12);}),
    choice('support','가족·지역의 생활 지원을 연결한다',s=>{addCondition(s,'stroke','뇌혈관 질환',3);s.health.disability={id:'stroke',name:'재활 지원 필요',supported:true};stat(s,'health',-12);stat(s,'social',5);})],s=>s.settings.sensitive&&!s.health.disability&&!s.health.conditions.some(c=>c.id==='stroke')&&gate(s,'stroke-recovery',0.13)),
  definition('family-model','relationships',25,50,'관계의 약속을 함께 정하기','배우자가 앞으로의 가족 형태를 함께 이야기하자고 합니다. 특정 국가의 법·문화 재현이 아닌, 모두의 자발적 동의를 전제로 한 게임의 관계 모형입니다.',[
    choice('exclusive','현재 두 사람의 약속을 유지한다',s=>{flag(s,'familyModel','exclusive');stat(s,'happiness',4);}),
    choice('plural','합의한 복수 배우자 모형을 선택한다',s=>{flag(s,'familyModel','plural-consensual');flag(s,'familyModelConsent',true);stat(s,'social',3);},'새 관계는 가족 메뉴에서 다시 합의하며 시작')],s=>Boolean(activePartner(s))&&s.family.partners.filter(p=>p.alive&&p.relation==='spouse').every(p=>p.closeness>=70)&&gate(s,'family-model',0.25)),
  definition('business-succession','finance',51,90,'다음 세대로 넘기는 운영','승계 논의 뒤 시간이 흘렀습니다. 일을 이어 가고 싶다는 성인 자녀가 있다면 운영권을 정식으로 넘길 수 있습니다.',[
    choice('transfer','동의한 자녀에게 운영권을 넘긴다',s=>{const child=s.family.children.find(c=>c.alive&&c.age>=20&&!c.business&&(c.closeness??50)>=60);const result=applySystemAction(s,{actionId:'business_succession',targetId:child.id});if(!result.ok)return result;stat(s,'happiness',5);return result;},'지원·정리 비용 500 G, 이후 사업 수익과 책임은 자녀에게 이전',s=>canAction(s,'business_succession')&&s.family.children.some(c=>c.alive&&c.age>=20&&!c.business&&(c.closeness??50)>=60)),
    choice('defer','자녀의 뜻을 존중하고 운영을 유지한다',s=>flag(s,'businessSuccession','continued'))],s=>Boolean(s.finance.business)&&s.flags.businessSuccession==='family-discussion'&&s.age>s.flags.businessSuccessionAge)
];

function dynamicStories(s) {
  const result=[];
  for(const child of s.family.children.filter(c=>c.alive)) {
    if(s.settings.sensitive&&child.age<=1&&gate(s,`premature:${child.id}`,0.12))result.push(definition(`premature:${child.id}`,'family',s.age,s.age,`${child.name}의 이른 시작`,'예정보다 일찍 태어난 아이의 호흡과 성장을 더 자주 살피고 있습니다. 필요한 돌봄을 가족이 나눕니다.',[
      choice('care','진료와 성장 돌봄을 이어 간다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.premature=true;target.earlyCare=true;stat(draft,'energy',-4);}),
      choice('network','지역·가족의 돌봄 지원을 연결한다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.premature=true;target.earlyCare=true;stat(draft,'social',4);})]));
    const lossKind=child.age<=1?'infant':child.age>=5&&child.age<=12?'child':null;
    if(s.settings.sensitive&&lossKind&&gate(s,`${lossKind}-loss:${child.id}`,lossKind==='infant'?0.025:0.012)) {
      const markLoss=draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.alive=false;target.deceasedAge=target.age;target.deathCause=lossKind==='infant'?'영아기의 급성 건강 악화':'아동기의 급성 질환';stat(draft,'happiness',-12);flag(draft,'bereavementSupport');};
      result.push(definition(`${lossKind}-loss:${child.id}`,'family',s.age,s.age,`${child.name}와의 너무 이른 이별`,'치료와 돌봄에도 아이를 지키지 못했습니다. 이 장면은 실제 개인의 건강 위험을 예측하지 않는 합성 사건입니다. 슬픔을 다루는 속도는 사람마다 다릅니다.',[
        choice('together','주변 사람과 함께 애도한다',draft=>{markLoss(draft);stat(draft,'social',4);}),
        choice('quiet','조용히 애도하며 지원을 받는다',draft=>{markLoss(draft);stat(draft,'energy',5);})]));
    }
    if(child.age>=3&&child.age<=12&&gate(s,`child-support-needs:${child.id}`,0.12)) result.push(definition(`child-support-needs:${child.id}`,'family',s.age,s.age,`${child.name}에게 맞는 일상`,'자녀에게 감각·학습 또는 이동을 위한 별도의 지원이 필요합니다. 어려움을 사람 전체의 가치로 판단하지 않습니다.',[
      choice('adapt','학교와 생활 환경을 함께 조정한다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.supportNeeds={kind:'individual-access',supported:true};target.closeness=clamp((target.closeness||50)+6);flag(draft,'childAccessSupport');}),
      choice('care','돌봄 시간을 나누고 전문가를 연결한다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.supportNeeds={kind:'individual-access',supported:true};stat(draft,'social',5);flag(draft,'childAccessSupport');})]));
    if(s.settings.sensitive&&child.age>=16&&child.age<18&&gate(s,`early-marriage-pressure:${child.id}`,0.18))result.push(definition(`early-marriage-pressure:${child.id}`,'family',s.age,s.age,`${child.name}를 둘러싼 기대`,'아직 미성년인 자녀의 혼인을 서두르라는 주변의 말이 들립니다. 자녀가 자라며 스스로 결정할 시간을 지킬 수 있습니다.',[
      choice('wait','성인이 될 때까지 결정을 미룬다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.marriageDeferred=true;target.closeness=clamp((target.closeness||50)+7);}),
      choice('education','학업을 이어 가도록 지원한다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.marriageDeferred=true;target.education='highschool';target.closeness=clamp((target.closeness||50)+5);})]));
    if (child.age>=17&&child.age<=23&&!child.tuitionPaid&&s.automations.childTuition) result.push(definition(`child-tuition:${child.id}`,'family',s.age,s.age,`${child.name}의 다음 배움`,'성인이 되어 가는 자녀가 학업 계획을 이야기합니다. 지원 여부는 이 자녀에게만 적용됩니다.',[
      choice('fund','첫해 학비를 지원한다',draft=>{debit(draft,1200);const target=draft.family.children.find(c=>c.id===child.id);target.education='college';target.support=1200;target.tuitionPaid=true;},'이번 학비 1,200 G',enough(1200)),
      choice('alternative','대안 교육과 장학 지원을 함께 찾는다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.education='alternative';target.alternativeStudyStartedAt=target.age;target.closeness=clamp((target.closeness||50)+5);})]));
    if(child.education==='alternative'&&Number.isInteger(child.alternativeStudyStartedAt)&&child.age>=child.alternativeStudyStartedAt+3)result.push(definition(`child-alternative-graduation:${child.id}`,'family',s.age,s.age,`${child.name}가 이어 온 배움`,'대안 교육을 선택한 뒤 세 해 동안 기술을 익혔습니다. 학업 경로의 이름이 달라도 얻은 경험을 다음 생활에 사용할 수 있습니다.',[
      choice('celebrate','과정 수료와 다음 진로를 응원한다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.education='vocational';target.graduated=true;target.closeness=clamp((target.closeness||50)+6);}),
      choice('connect','일할 기회를 함께 찾아본다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.education='vocational';target.graduated=true;target.careerSupport=true;stat(draft,'social',3);})]));
    if (child.age>=22&&child.age<=30&&!child.married&&s.automations.childMarriage) result.push(definition(`child-marriage:${child.id}`,'family',s.age,s.age,`${child.name}의 관계와 선택`,'성인 자녀가 함께 살아갈 사람에 관한 이야기를 꺼냅니다. 결정권은 자녀에게 있습니다.',[
      choice('support','자녀의 결정을 지지한다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.partnered=true;target.married=true;target.closeness=clamp((target.closeness||50)+6);}),
      choice('listen','서두르지 않고 이야기를 듣는다',draft=>{const target=draft.family.children.find(c=>c.id===child.id);target.closeness=clamp((target.closeness||50)+4);})]));
    if(child.age>=22&&child.age<=50&&s.finance.cash<2000&&s.career.retired) result.push(definition(`child-support:${child.id}`,'family',s.age,s.age,`${child.name}의 안부`,'성인 자녀가 생활비 일부를 보태고 싶다고 말합니다. 가능한 범위 안에서 도움을 나눕니다.',[
      choice('accept','제안한 도움을 받는다',draft=>{draft.finance.cash+=800;flag(draft,`supportFrom:${child.id}`);},'송금 +800 G'),
      choice('thanks','마음만 고맙게 받는다',draft=>stat(draft,'happiness',5))]));
  }
  return result;
}
// Opportunities recur only after a real state change or an explicit waiting period.
// Queries build choices without spending money, drawing people, or consuming RNG.
function lifeOpportunities(s) {
  const result=[];
  if(schoolEntryAvailable(s)) {
    const q=schoolEntryQuote(s);
    result.push(definition(SCHOOL_ENTRY,'education',12,15,'중등 교육을 이어 갈 준비',`초등 과정을 마친 뒤 학비·교복·교통비를 준비합니다. 이번 준비비는 ${money(q.cost)}, 현재 가진 돈은 ${money(q.cash)}입니다.`,[
      choice('continue','공부를 계속할 준비를 한다',draft=>resolveSchoolEntry(draft,'continue'),'준비비가 충분하면 한 번 지출하고 진학합니다. 부족하면 비용 없이 진학 실패와 학업 중단이 기록됩니다.',schoolEntryAvailable),
      choice('family-work','가족의 일을 도우며 지낸다',draft=>resolveSchoolEntry(draft,'family-work'),`학업을 중단하고 이번 일의 수입 ${money(Math.round(q.cost*.05))}를 받습니다.`,schoolEntryAvailable)
    ],schoolEntryAvailable));
  }
  if(earlyWorkEligible(s)&&!s.career.jobId&&!s.career.retired&&!s.flags.careBreak&&s.age>=(s.flags.nextEarlyCareerAge||0)) {
    const jobs=getCareerOpportunities(s).filter(j=>canJob(s,j.id)).sort((a,b)=>b.salary-a.salary);
    const accepted=draft=>{draft.flags.schoolWorkPolicyVersion=1;draft.flags.earlyCareerOfferNumber=(draft.flags.earlyCareerOfferNumber||0)+1;draft.flags.nextEarlyCareerAge=draft.age+1;};
    if(jobs.length)result.push(definition(`early-career:${s.flags.earlyCareerOfferNumber||0}`,'career',15,17,'학교 밖에서 찾는 첫 일자리','현재 학력과 생활 여건으로 시작할 수 있는 일을 살펴봅니다. 지금 기다리면 다음 해 다시 구직 제안을 받습니다.',[
      ...jobs.slice(0,3).map(j=>choice(j.id,`${j.label}로 일한다`,draft=>{const r=job(draft,j.id);if(!r.ok)return r;accepted(draft);return {ok:true,message:`제안받은 첫 일자리 가운데 ${j.label} 일을 선택했습니다.`};},`현재 환경 기준 연 ${money(j.salary)}. 실제 수입은 다음 해 정산에 반영됩니다.`,draft=>earlyWorkEligible(draft)&&canJob(draft,j.id))),
      choice('later','한 해 더 알아본다',draft=>{accepted(draft);draft.flags.careerExploration=true;},'일을 시작하지 않고 다음 해 새 제안을 기다립니다.')
    ],draft=>earlyWorkEligible(draft)&&!draft.career.jobId&&!draft.career.retired&&!draft.flags.careBreak&&draft.age>=(draft.flags.nextEarlyCareerAge||0)));
  }
  if(s.education.program&&s.flags.educationPaused&&!s.flags.educationOnLeave&&s.flags.educationFundingDecisionAge!==s.age) {
    const labels={
      'work-study':['일과 수업을 병행한다','자격에 맞는 일을 시작하거나 유지합니다. 다음 해부터 급여 100%와 추가 피로가 반영됩니다.'],
      loan:['부족한 학비만 빌려 수강을 이어 간다',`현재 부족분 ${money(Math.max(0,s.education.program.cost-s.finance.cash))}. 총부채 12,000 G 한도·연 4% 이자.`],
      pause:['학점을 남겨 두고 휴학한다','현재 학력·과정·남은 수강 기간을 보존합니다. 학비를 멈추고 일한 뒤 복학할 수 있습니다.'],
      dropout:['과정을 중단하고 다른 길을 찾는다','이미 얻은 학력과 학업 이력을 보존하고 현재 과정만 마칩니다.']
    };
    result.push(definition(`education-funding:${s.education.program.id}:${s.age}`,'education',s.age,s.age,'배움을 계속할 방법',`${s.education.program.label}의 학비가 부족해 이번 수강이 멈췄습니다. 남은 기간은 ${s.education.yearsLeft}년입니다. 생활과 배움을 함께 이어 갈 방법을 정합니다.`,getEducationFundingOptions(s).map(mode=>choice(mode,labels[mode][0],draft=>resolveEducationFunding(draft,mode),labels[mode][1],draft=>getEducationFundingOptions(draft).includes(mode))),draft=>Boolean(draft.education.program)&&draft.flags.educationPaused&&!draft.flags.educationOnLeave&&draft.flags.educationFundingDecisionAge!==draft.age));
  }
  const interest=dueCareerInterest(s);
  if(interest)result.push(definition(`${CAREER_INTEREST_PREFIX}${interest.requestedAge}`,'career',interest.dueAge,110,'꿈꾸던 일에 도전해 볼까?',`${interest.requestedAge}세에 알아보기 시작한 일의 준비 조건을 살펴봅니다. 채용되면 새 일의 첫 직급에서 시작하고, 채용되지 않거나 보류하면 현재 생활을 이어 갑니다. 이 실행물은 표시된 자격 충족 여부로 판정합니다.`,[
    ...getCareerChallengeOptions(s).map(j=>choice(j.jobId,`${j.label}에 도전한다`,draft=>resolveCareerChallenge(draft,j.jobId),`${({field:'관심 전공',hobby:'즐기는 취미',aptitude:'기질'})[j.reason]} · ${j.qualificationReason??'현재 자격 충족'} · 기준 연 ${money(j.salary)}`,draft=>draft.career.jobId===j.jobId||(!careerInterestWorkReason(draft)&&!draft.flags.systemActions?.[`${draft.age}:job_apply`]))),
    choice('later','지금은 마음에만 둔다',draft=>resolveCareerChallenge(draft,null),'현재 직업·학업·재정을 유지합니다.')
  ],draft=>dueCareerInterest(draft)?.requestedAge===interest.requestedAge));
  const graduated=s.education.history.some(entry=>entry.result==='graduated'&&entry.degree===s.education.level);
  const newQualification=graduated&&s.flags.careerOfferEducationLevel!==s.education.level;
  const jobs=s.age>=19&&(!s.education.program||s.flags.educationOnLeave)&&(!s.career.jobId||newQualification)&&!s.career.retired&&!s.flags.careBreak&&s.age>=(s.flags.nextCareerOfferAge||0)&&(s.seen.includes('adult-transition')||s.age>=23)
    ?getCareerOpportunities(s).filter(j=>canJob(s,j.id)&&(!s.career.jobId||j.salary>s.career.salary)).sort((a,b)=>b.salary-a.salary):[];
  if(jobs.length) {
    const apply=draft=>{draft.flags.careerOfferNumber=(draft.flags.careerOfferNumber||0)+1;draft.flags.nextCareerOfferAge=draft.age+3;draft.flags.careerOfferEducationLevel=draft.education.level;};
    const previous=s.education.history.at(-1);
    const context=previous?.result==='rejected'?'진학 지원은 원하는 결과로 이어지지 않았습니다.':previous?.result==='graduated'?'마친 공부를 다음 생활에 연결할 때입니다.':s.flags.educationOnLeave?'남겨 둔 학업에 돌아갈 자금을 마련하려고 합니다.':'유급 일을 찾으며 현재 조건에 맞는 채용 소식을 살펴보았습니다.';
    result.push(definition(`career-opportunity:${s.flags.careerOfferNumber||0}`,'career',s.age,s.age,s.career.jobId?'새로 배운 것을 쓸 기회':s.flags.careerHistory?.length?'다시 시작할 일':'첫 수입을 만들 기회',`${context} 지금의 나이와 학력·경험으로 지원할 수 있는 일입니다. 다른 직업도 직업 메뉴에서 살펴볼 수 있습니다.`,[
      ...jobs.slice(0,3).map(j=>choice(j.id,`${j.label}로 일한다`,draft=>{const r=job(draft,j.id);if(r.ok)apply(draft);return r;},`현재 환경 기준 연 ${money(j.salary)}. 세금·생활비·근무 형태는 연간 정산합니다.`,draft=>canJob(draft,j.id))),
      choice('later','지금은 더 알아본다',draft=>{apply(draft);draft.flags.careerExploration=true;},'3년 뒤에도 구직 중이면 새 기회를 확인합니다. 직업 메뉴는 계속 사용할 수 있습니다.')
    ],draft=>(!draft.career.jobId||(draft.flags.careerOfferEducationLevel!==draft.education.level&&draft.education.history.some(entry=>entry.result==='graduated'&&entry.degree===draft.education.level)))&&!draft.career.retired&&(!draft.education.program||draft.flags.educationOnLeave)&&draft.age>=(draft.flags.nextCareerOfferAge||0)));
  }
  const relationship=s.family.relationship,partner=activePartner(s);
  const nextRelationship=s.flags.nextRelationshipOpportunityAge||0;
  const relationshipAction=(draft,id,wait=1)=>{const r=applySystemAction(draft,{actionId:id});if(r.ok){draft.flags.relationshipOpportunityNumber=(draft.flags.relationshipOpportunityNumber||0)+1;draft.flags.nextRelationshipOpportunityAge=draft.age+wait;if(id==='meet')draft.family.relationship.metAge=draft.age;}return r;};
  const deferRelationship=draft=>{draft.flags.relationshipOpportunityNumber=(draft.flags.relationshipOpportunityNumber||0)+1;draft.flags.nextRelationshipOpportunityAge=draft.age+4;};
  const relationshipKey=s.flags.relationshipOpportunityNumber||0;
  if(s.age>=(['family','social'].includes(s.focus)?20:22)&&s.age<=70&&!relationship&&!partner&&!s.flags.independentRelationshipPreference&&s.age>=nextRelationship&&canAction(s,'meet')) {
    result.push(definition(`relationship-meeting:${relationshipKey}`,'relationships',s.age,s.age,'일상에 새로운 사람을 들이는 일','반복되는 생활 밖에서 서로를 알아갈 자리를 마련할 수 있습니다. 지금의 생활에 만족한다면 관계를 서두르지 않아도 됩니다.',[
      choice('meet','새로운 사람을 만나 본다',draft=>relationshipAction(draft,'meet'),'만남 준비 150 G. 교제·동거·혼인은 이후에 따로 결정합니다.',draft=>canAction(draft,'meet')),
      choice('later','지금은 내 생활에 집중한다',deferRelationship,'4년 뒤 다시 생각합니다.'),
      choice('independent','앞으로의 만남은 내가 직접 정한다',draft=>{deferRelationship(draft);draft.flags.independentRelationshipPreference=true;},'자동 만남 제안을 멈춥니다. 가족 메뉴에서 언제든 직접 만날 수 있습니다.')
    ]));
  }
  if(relationship&&relationship.alive&&s.age>=Math.max(nextRelationship,(relationship.metAge??s.age-1)+1)) {
    if((relationship.closeness||50)<60&&canAction(s,'date')) result.push(definition(`relationship-time:${relationship.id}:${relationshipKey}`,'relationships',s.age,s.age,`${relationship.name}와 알아 가는 시간`,'서로 만난 뒤 일상의 속도와 생각을 조금씩 알아 가고 있습니다. 관계에 시간을 내거나 지금의 거리를 유지할 수 있습니다.',[
      choice('date','둘이 보낼 시간을 마련한다',draft=>relationshipAction(draft,'date'),'함께하는 시간 200 G, 친밀도 +15.',draft=>canAction(draft,'date')),
      choice('later','당장은 지금의 거리를 유지한다',deferRelationship,'4년 동안 관계 방향을 재촉하지 않습니다.')
    ]));
    else if((relationship.closeness||50)>=60&&(canAction(s,'cohabit')||canAction(s,'marry'))) result.push(definition(`relationship-direction:${relationship.id}:${relationshipKey}`,'relationships',s.age,s.age,`${withParticle(relationship.name,'과','와')} 그리는 생활`,'서로를 알아 온 시간을 바탕으로 앞으로의 생활을 이야기합니다. 함께 살기와 혼인은 각각의 합의가 필요한 선택입니다.',[
      choice('cohabit','혼인과 별개로 함께 살기로 합의한다',draft=>relationshipAction(draft,'cohabit',3),'주거 준비 400 G.',draft=>canAction(draft,'cohabit')),
      choice('marry','혼인 관계로 함께하기로 합의한다',draft=>relationshipAction(draft,'marry',2),'혼인 준비 800 G.',draft=>canAction(draft,'marry')),
      choice('later','현재 관계를 이어 가며 더 생각한다',deferRelationship,'4년 뒤 다시 이야기합니다.')
    ]));
  }
  if(partner&&s.age>=24&&s.age<=55&&s.age>=nextRelationship&&s.age>=(s.flags.nextFamilyPlanAge||0)&&s.age>(partner.marriageAge??s.age-1)&&canAction(s,'child')) {
    const familyPlan=draft=>{draft.flags.familyPlanNumber=(draft.flags.familyPlanNumber||0)+1;draft.flags.nextFamilyPlanAge=draft.age+5;};
    result.push(definition(`family-plan:${s.flags.familyPlanNumber||0}`,'family',s.age,s.age,'함께 돌볼 여유를 생각하며',`${withParticle(partner.name,'과','와')} 생활을 이어 가며 자녀를 맞을 뜻과 돌봄의 여유를 이야기합니다. 현재 살아 있는 자녀는 ${s.family.children.filter(c=>c.alive).length}명입니다. 가족의 크기는 직접 선택합니다.`,[
      choice('child','자녀를 맞고 함께 돌보기로 합의한다',draft=>{const r=applySystemAction(draft,{actionId:'child'});if(r.ok)familyPlan(draft);return r;},'준비 700 G, 이후 매년 돌봄·교육비가 반영됩니다.',draft=>canAction(draft,'child')),
      choice('later','지금의 생활을 지키며 나중에 생각한다',familyPlan,'5년 뒤 다시 생각합니다. 가족 메뉴에서 직접 선택할 수도 있습니다.'),
      choice('complete','가족 계획은 앞으로 직접 정한다',draft=>{familyPlan(draft);draft.flags.nextFamilyPlanAge=111;},'이 제안을 멈춥니다. 가족 메뉴는 계속 사용할 수 있습니다.')
    ]));
  }
  return result;
}
function availableDefinitions(s) { return [...lifeOpportunities(s), ...STORIES, ...dynamicStories(s)]; }
function canOffer(s,d) { return s.status==='alive'&&s.age>=d.minAge&&s.age<=d.maxAge&&!s.seen.includes(d.key)&&d.when(s); }
function toDecision(s,d) {
  return { id:`${s.lifeId}:story:${d.key}`, kind:d.kind, structure:d.key, title:d.title, body:d.body, source:'rule', choices:d.choices.filter(c=>c.available(s)).map(({id,label,description})=>({id,label,description})) };
}
/** Pure query: deterministic gates never consume RNG and repeated rendering cannot alter a life. */
export function getStoryDecision(s) {
  if(s.status!=='alive'||(s.age<2&&s.pending?.structure!=='birth-care')) return null;
  const definitions=availableDefinitions(s);
  const current=s.pending?definitions.find(d=>d.key===s.pending.structure&&canOffer(s,d)):null;
  if(current)return current.key==='birth-care'?structuredClone(s.pending):toDecision(s,current);
  const d=definitions.find(d=>canOffer(s,d));
  return d?toDecision(s,d):null;
}
export function resolveStoryDecision(s,choiceId) {
  if(s.status!=='alive'||!s.pending) return {ok:false,error:'해결할 결정이 없습니다.'};
  const d=availableDefinitions(s).find(d=>d.key===s.pending.structure);
  if(!d||!canOffer(s,d)||s.pending.id!==`${s.lifeId}:story:${d.key}`) return {ok:false,error:'현재 삶에서 유효하지 않은 결정입니다.'};
  const selected=d.choices.find(c=>c.id===choiceId&&c.available(s));
  if(!selected||!s.pending.choices.some(c=>c.id===choiceId)) return {ok:false,error:'현재 조건에서 선택할 수 없습니다.'};
  const result=selected.effect(s);if(result&&result.ok===false)return result;
  s.seen.push(d.key);s.pending=null;
  const message=result?.message||selected.label;
  s.flags.lastStoryChoice={age:s.age,year:s.year,structure:d.key,label:selected.label};
  log(s,d.kind,d.title,message,d.key);
  return {ok:true,message};
}

export function makeCohort(s) {
  const referenceRows=s.mode==='present'&&s.birthYear===2026&&s.flags.demographicBasis==='reference-2023'?referenceDistribution(COUNTRIES,s.weighting):null;
  return Array.from({length:4},(_,index)=>{
    let c;
    if(referenceRows){let draw=random(s);c=getCountry(referenceRows.at(-1).countryId);for(const row of referenceRows){draw-=row.share;if(draw<0){c=getCountry(row.countryId);break;}}}
    else c=drawBirthCountry(s,{year:s.birthYear,mode:s.mode,weighting:s.weighting});
    const household=random(s)<.4?'low':random(s)<.75?'middle':'high',city=random(s)<.6?'urban':'rural';
    const env=getEnvironment(c.id,{year:s.birthYear,mode:s.mode,city,household});
    return {id:`${s.lifeId}:cohort:${index}`,name:s.flags.birthIdentity?authoredName(c.id,null,s.seed,`cohort:${index}`):['여울','아람','다니','노아'][index],modelVersion:2,countryId:c.id,birthCountryId:c.id,birthYear:s.birthYear,year:s.birthYear,age:0,status:'alive',alive:true,lifespan:null,rng:Math.floor(random(s)*4294967296)>>>0,health:clamp(55+env.health*.35),happiness:55,knowledge:5,household,city,mode:s.mode,demographicSource:referenceRows?DEMOGRAPHIC_META.id:'synthetic-population-birth-v2',demographicReferenceYear:referenceRows?DEMOGRAPHIC_META.year:null,education:{level:'none',yearsLeft:0},career:{jobId:null,title:'아직 없음',salary:0,years:0,retired:false},finance:{cash:household==='high'?5000:household==='low'?500:2000,debt:0,income:0,expense:0},family:{partnered:false,children:0,grandchildren:0},healthcare:false,conditions:0,milestones:[],timeline:[],synthetic:true};
  });
}
function cohortLog(c,key,text) { if(!c.milestones.some(m=>m.key===key))c.milestones.push({age:c.age,year:c.year,key,text,source:'rule'}); }
function initializeLegacyCompanion(c,s) {
  if(c.modelVersion===2)return;
  // Preserve old observed ages/deaths. Only future progression adopts the new model.
  c.modelVersion=2;c.rng=hash(`${s.seed}:${c.id}:cohort-upgrade`);c.birthYear=s.birthYear;c.year=s.birthYear+c.age;c.birthCountryId=c.countryId;c.mode=s.mode;c.city='urban';c.household='middle';c.knowledge=Math.min(70,5+c.age*1.5);c.education={level:c.age<6?'none':c.age<12?'primary':c.age<18?'secondary':'highschool',yearsLeft:0};c.career={jobId:c.age>=18&&c.age<65?'labor':null,title:c.age>=65?'은퇴':'생활을 이어가는 중',salary:0,years:Math.max(0,c.age-18),retired:c.age>=65};c.finance={cash:2000,debt:0,income:0,expense:0};c.family={partnered:false,children:0,grandchildren:0};c.healthcare=false;c.conditions=0;c.timeline=[];c.alive=c.status!=='ended';c.legacyProjection=c.lifespan;if(c.alive)c.lifespan=null;else c.deathAge=c.age;cohortLog(c,'model-upgrade','기존 기록을 보존하고 이후부터 확장된 합성 생활 규칙을 적용함');
}
function advanceCompanion(c,s) {
  initializeLegacyCompanion(c,s);if(c.status==='ended')return;
  c.age++;c.year=c.birthYear+c.age;
  const env=getEnvironment(c.countryId,{year:c.year,mode:c.mode,city:c.city,household:c.household});
  if(c.age<18){c.knowledge=clamp(c.knowledge+env.education/22+(c.household==='high'?.6:0));c.finance.cash+=Math.round(env.income*(c.household==='high'?.025:.008));}
  if(c.age===6){c.education.level='primary';cohortLog(c,'primary','주변의 교육 환경에서 기초 배움을 시작함');}
  if(c.age===12){c.education.level='secondary';cohortLog(c,'secondary','중등 교육을 이어 감');}
  if(c.age===18){
    c.education.level='highschool';
    if(c.knowledge>=50&&random(c)<clamp(env.education/130+(c.household==='high'?.15:0),.15,.9)){c.education.yearsLeft=4;c.education.level='undergraduate';cohortLog(c,'university','가계와 교육 여건을 바탕으로 대학에 진학함');}
    else {c.education.level=random(c)<.4?'vocational':'highschool';cohortLog(c,'work-route','일과 직업 훈련으로 성인기를 시작함');}
  }
  if(c.education.yearsLeft>0&&c.age>18){const tuition=Math.round(1200*env.cost),paid=Math.min(c.finance.cash,tuition);c.finance.cash-=paid;c.finance.debt+=tuition-paid;c.education.yearsLeft--;c.knowledge=clamp(c.knowledge+5);if(!c.education.yearsLeft){c.education.level='bachelor';cohortLog(c,'graduated','학비를 마련하며 학사 과정을 마침');}}
  if(c.age>=18&&c.age<65&&!c.education.yearsLeft&&!c.career.jobId&&random(c)<clamp(env.jobDemand*.5+c.knowledge/250,.1,.9)){c.career.jobId=c.education.level==='bachelor'?'teacher':c.education.level==='vocational'?'craft':'labor';c.career.title=c.career.jobId==='teacher'?'교육 업무':c.career.jobId==='craft'?'기술 업무':'현장 업무';cohortLog(c,`job:${c.age}`,`${c.career.title} 일을 구함`);}
  if(c.career.jobId){c.career.years++;c.career.salary=Math.round(env.income*(c.career.jobId==='teacher'?1.2:c.career.jobId==='craft'?.95:.65)*(1+Math.min(.5,c.career.years*.01)));if(env.jobDemand<.93&&random(c)<.12){c.career.jobId=null;c.career.salary=0;cohortLog(c,`jobloss:${c.age}`,'경기 변화로 일을 쉬며 다음 일자리를 찾음');}}
  if(c.age===65){c.career.retired=true;c.career.jobId=null;c.career.salary=0;cohortLog(c,'retired','일을 마무리하고 경력에 따른 연금을 받기 시작함');}
  if(c.age>=23&&c.age<=50&&!c.family.partnered&&random(c)<.13){c.family.partnered=true;cohortLog(c,'partnership','서로 동의한 사람과 생활을 함께하기 시작함');}
  if(c.family.partnered&&c.age>=25&&c.age<=45&&c.family.children<5&&random(c)<.12){c.family.children++;cohortLog(c,`child:${c.family.children}`,'가족에 새 구성원을 맞이하고 양육을 시작함');}
  if(c.family.children&&c.age===58){c.family.grandchildren=Math.floor(random(c)*(c.family.children+2));if(c.family.grandchildren)cohortLog(c,'grandchildren','다음 세대의 성장을 지켜봄');}
  if(c.age>=24&&c.age<=50&&random(c)<.012){const destination=drawBirthCountry(c,{year:c.year,mode:c.mode,weighting:'population'});if(destination.id!==c.countryId){c.countryId=destination.id;c.city='urban';cohortLog(c,`migration:${c.age}`,`${destination.name}에서 새로운 생활을 시작함`);}}
  c.finance.income=c.career.retired?Math.round(env.income*Math.min(.55,.12+c.career.years*.008)):c.career.salary;
  c.finance.expense=c.age<18?0:Math.round(env.income*.2*env.cost+c.family.children*120);
  const balance=c.finance.cash+c.finance.income-c.finance.expense;if(balance<0){c.finance.cash=0;c.finance.debt+=-balance;}else c.finance.cash=balance;
  if(c.finance.debt>0&&c.finance.cash>3000){const pay=Math.min(c.finance.debt,Math.floor(c.finance.cash*.1));c.finance.debt-=pay;c.finance.cash-=pay;}
  if(c.age>=40&&random(c)<.02+env.climatePressure*.025){c.conditions=Math.min(4,c.conditions+1);cohortLog(c,`condition:${c.age}`,'몸의 변화를 발견하고 생활과 치료를 조정함');}
  c.healthcare=c.conditions>0&&c.finance.cash>=500&&env.health>=45;if(c.healthcare){c.finance.cash-=500;c.finance.expense+=500;if(random(c)<.3)c.conditions=Math.max(0,c.conditions-1);}
  const ageLoss=c.age>=75?2.2:c.age>=55?.9:c.age>=35?.3:0;
  c.health=clamp(c.health-ageLoss-c.conditions*.7-env.climatePressure*.5+(env.health-60)/90+(c.healthcare?.6:0));
  c.happiness=clamp(c.happiness+(c.family.partnered?.3:0)+(c.career.jobId?.2:0)-(c.finance.debt>10000?.8:0)-c.conditions*.15+(random(c)-.5)*3);
  const risk=(c.age<5?.002:c.age<45?.0005:c.age<60?.0015:.003*Math.exp((c.age-60)/9))+Math.max(0,40-c.health)*.0015+c.conditions*.001;
  if(c.age>=110||c.health<=0||random(c)<Math.min(.9,risk)){c.status='ended';c.alive=false;c.deathAge=c.age;c.lifespan=c.age;cohortLog(c,'death','삶을 마침');}
  c.health=Math.round(c.health*10)/10;c.happiness=Math.round(c.happiness*10)/10;
  c.timeline.push({age:c.age,year:c.year,countryId:c.countryId,city:c.city,household:c.household,health:c.health,happiness:c.happiness,education:c.education.level,career:c.career.title,income:c.finance.income,cash:c.finance.cash,debt:c.finance.debt,children:c.family.children,status:c.status,environment:{countryId:env.countryId,education:env.education,health:env.health,income:env.income,cost:env.cost,jobDemand:env.jobDemand,historicalReferences:env.historicalContext.map(item=>item.reference.id),synthetic:true}});
}
/** Complete only copies for the ending comparison; the player's RNG and observed companion history stay intact. */
export function projectCohort(s) {
  return s.cohort.map(original=>{const c=structuredClone(original);initializeLegacyCompanion(c,s);const projected=c.status!=='ended';while(c.status!=='ended'&&c.age<110)advanceCompanion(c,s);return {...c,projected};});
}
export function getCohortComparison(s) {
  const self={id:s.lifeId,name:s.name,countryId:s.countryId,age:s.age,status:s.status,player:true,health:s.stats.health,education:s.education,career:s.career,finance:s.finance,family:{children:s.family.children.length}};
  const people=s.status==='ended'&&s.ending?.cohort?s.ending.cohort:[self,...s.cohort];
  const maxAge=s.status==='ended'?Math.max(...people.map(p=>p.age||0)):s.age;
  const survival=Array.from({length:maxAge+1},(_,age)=>({age,value:people.filter(p=>p.status!=='ended'||(p.deathAge??p.age)>age).length/people.length*100}));
  return {people,survival,source:'rule',synthetic:true,sampleSize:people.length,projected:s.status==='ended'&&people.some(p=>p.projected)};
}
const focusNames={balanced:'균형 있는 생활',study:'배움',career:'일과 진로',family:'가족',health:'건강',hobby:'취미',social:'사람들과의 교류',rest:'휴식'};
function dailySnapshot(s) {
  return {age:s.age,countryId:s.countryId,city:s.city,focus:s.focus,stats:{...s.stats},cash:s.finance.cash,jobId:s.career.jobId,workSkill:s.flags.skills?.work||0,educationLevel:s.education.level,programId:s.education.program?.id||null,yearsLeft:s.education.yearsLeft,hobbies:s.hobbies.map(h=>({id:h.id,level:h.level})),children:s.family.children.filter(c=>c.alive).map(c=>({id:c.id,closeness:c.closeness||50}))};
}
function dailyRecord(s,title,text,facts={}) {
  const entry=log(s,'daily',title,text);
  entry.lifeFacts={...facts,source:'rule',synthetic:true};
  return entry;
}
// Small authored episodes follow stored people, interests and school progress.
// They are fictional personal experiences, never country facts or new RNG draws.
function childhoodScene(s,flow,previous) {
  const friend=s.family.friends.find(p=>p.alive),parent=s.family.parents.find(p=>p.alive&&!p.absent);
  const hobby=s.hobbies[0],school=attendingSchool(s);
  const course={primary:'초등',secondary:'중등',highschool:'고교'}[s.education.level]||'학교';
  const recently=flow.childhoodScenes||[],active=flow.childhoodActivity;
  const episodes=[];
  const add=(key,title,start,follow,focuses=['balanced'],facts={})=>episodes.push({key,title,start,follow,focuses,facts});
  const first=s.flags.childFirstSteps?.choiceId;
  if(s.career.jobId) {
    add(`work:${s.career.jobId}`,'일터에서 익힌 순서',`${s.career.title} 일을 하며 자주 맡는 작업의 순서를 익혔습니다. 낯선 일은 설명을 듣고 하나씩 확인했습니다.`,`${s.career.title} 일에서 지난번 익힌 순서를 다시 써 보았습니다. 서두르다 놓치는 부분을 살피고 쉬는 시간도 챙겼습니다.`,['career','balanced','study'],{jobId:s.career.jobId});
  }
  if(school&&FIRST_STEPS[first]&&(!flow.childhoodFirstStepLinked||active?.key===`first-step:${first}`)) {
    const scenes={
      observe:['그림으로 남긴 작은 발견','어릴 때 돌을 들여다보던 것처럼, 수업에서 눈에 띈 모양을 종이에 그려 보았습니다. 비슷해 보이는 것들의 차이를 찾아 옆에 표시했습니다.','지난번 그린 종이를 다시 펼쳤습니다. 처음에는 지나쳤던 부분을 찾아 덧그리며, 본 것을 설명하는 말도 보탰습니다.'],
      run:['빠르게, 그리고 천천히','어릴 때 힘껏 달리던 기억이 놀이 시간에 떠올랐습니다. 먼저 몸을 움직이고, 숨이 차면 멈춰 쉬는 순서를 스스로 정해 보았습니다.','지난번 정한 움직임과 쉼의 순서를 다시 써 보았습니다. 서두르다 놓친 동작은 속도를 늦추어 하나씩 해 보았습니다.'],
      comfort:['먼저 건넨 말',friend?`${friend.name}의 말을 끊지 않고 끝까지 들어 보았습니다. 어릴 때 울던 아이 곁에 머물렀던 마음이, 이제는 먼저 안부를 묻는 말이 되었습니다.`:'함께 배우는 사람의 이야기를 끝까지 들어 보았습니다. 어릴 때 울던 아이 곁에 머물렀던 마음을 이제는 짧은 안부로 표현했습니다.','지난번 들었던 이야기를 떠올리고 안부를 다시 물었습니다. 한 번 말을 건네는 것과 관심을 이어 가는 것이 다르다는 것을 알았습니다.'],
      retry:['틀린 자리부터 다시','뜻대로 풀리지 않은 연습을 지우지 않고 남겨 두었습니다. 어릴 때 넘어진 자리에서 다시 일어났듯, 막힌 부분부터 천천히 해 보았습니다.','남겨 두었던 연습을 다시 꺼냈습니다. 전에 막힌 부분을 작은 순서로 나누고, 끝낸 곳마다 표시를 남겼습니다.']
    };
    const [title,start,follow]=scenes[first];
    add(`first-step:${first}`,title,start,follow,['balanced','study','health','social','family','hobby','career'],{choiceId:first,...(first==='comfort'&&friend?{personId:friend.id}:{}),firstStep:true});
  }
  if(hobby) {
    const label=HOBBIES.find(h=>h.id===hobby.id)?.label||hobby.id;
    const hobbyScenes={
      reading:['책갈피를 꽂은 자리','읽던 이야기에서 오래 생각하게 된 장면에 책갈피를 꽂았습니다. 끝까지 읽고 나서 그 장면의 뜻이 달라지는지 살펴보기로 했습니다.','책갈피를 꽂아 둔 장면으로 돌아갔습니다. 뒤에 일어난 일을 알고 다시 읽으니, 처음 눈에 들어오지 않던 말이 보였습니다.'],
      sports:['해 보고 싶은 동작','즐기는 운동에서 마음처럼 되지 않는 동작 하나를 골랐습니다. 다른 동작을 늘리기보다 그 부분을 나누어 연습해 보았습니다.','지난번 나누어 연습한 동작을 이어 해 보았습니다. 몸에 힘이 들어가는 지점을 알아차리고, 쉬는 시간을 끼워 넣었습니다.'],
      music:['다시 듣고 싶은 가락','좋아하는 가락에서 짧은 부분을 골라 소리 내어 보았습니다. 잘 이어지지 않는 부분은 따로 기억해 두었습니다.','지난번 멈추던 가락을 다시 불러 보았습니다. 앞부분과 이어 보며 자신의 소리를 듣는 시간을 가졌습니다.']
    };
    const [title,start,follow]=hobbyScenes[hobby.id]||[`${label}에 남긴 메모`,`${label}을 하며 마음에 든 점과 다음에 해 볼 것을 적었습니다. 한꺼번에 완성하기보다 작은 부분부터 손에 익혔습니다.`,`지난번 ${label} 메모를 펼쳐, 해 보고 싶었던 부분을 이어 갔습니다. 끝낸 것과 더 해 볼 것을 나누어 남겼습니다.`];
    add(`hobby:${hobby.id}`,title,start,follow,['hobby','balanced'],{hobbyId:hobby.id,hobbyLevel:hobby.level});
  }
  if(friend) {
    add('friend:turns','함께 정한 차례',`${withParticle(friend.name,'과','와')} 놀이 순서를 다르게 생각했습니다. 둘 다 하고 싶은 것을 말한 뒤, 번갈아 해 보기로 정했습니다.`,`${withParticle(friend.name,'과','와')} 다시 놀며 전에 정한 차례를 기억했습니다. 기다리는 시간이 길어지는 부분은 함께 바꾸었습니다.`,['social','balanced'],{personId:friend.id});
    add('friend:explain','설명하는 쪽이 되다',`${friend.name}에게 익숙한 놀이 방법을 설명했습니다. 이미 아는 것을 말로 전하려니, 빠뜨린 순서가 드러났습니다.`,`${withParticle(friend.name,'과','와')} 지난번 설명을 바꾸어 보았습니다. 이번에는 순서를 직접 보여 주고, 서로 이해한 것이 같은지 확인했습니다.`,['social','career'],{personId:friend.id});
  }
  if(parent) {
    add('family:day','집에 돌아와 나눈 이야기',`${parent.name}에게 하루 중 기억에 남는 일을 이야기했습니다. 바로 답을 듣기보다, 자신이 무엇을 느꼈는지 천천히 말해 보았습니다.`,`${parent.name}에게 전에 이야기했던 일의 뒷이야기를 전했습니다. 듣고 싶은 말만 기다리던 때와 달리, 상대의 하루도 물었습니다.`,['family','balanced'],{personId:parent.id});
    add('family:organize','내가 쓰는 자리',`${withParticle(parent.name,'과','와')} 집에서 쓰는 물건을 정리했습니다. 자주 찾는 것은 어디에 둘지 직접 정하고, 쓴 뒤 돌려놓을 자리를 만들었습니다.`,`${withParticle(parent.name,'과','와')} 전에 정한 물건 자리를 돌아보았습니다. 잘 지켜지지 않는 곳은 쓰기 편한 쪽으로 옮겼습니다.`,['family'],{personId:parent.id});
  }
  if(school) {
    add('school:question','질문 하나를 남겨 두다',`${course} 과정에서 바로 이해되지 않는 내용을 따로 적었습니다. 답을 급히 외우기보다 어디에서 헷갈렸는지 찾아보기로 했습니다.`,'남겨 둔 질문을 다시 읽고 자신의 말로 답을 써 보았습니다. 아직 설명하기 어려운 부분은 지우지 않고 다음에 물을 것으로 남겼습니다.',['study','balanced'],{level:s.education.level});
    add('school:practice','익숙한 것에도 순서가 있다',`${course} 과정의 연습에서 쉽게 넘어가던 부분을 천천히 해 보았습니다. 결과뿐 아니라 그곳까지 간 순서도 적었습니다.`,'앞서 적은 순서를 보지 않고 연습해 보았습니다. 중간에 막힌 곳을 확인하고, 필요한 설명을 노트에 보탰습니다.',['study','career'],{level:s.education.level});
  }
  add('rest:pace','쉬는 시간을 정하다',s.health.conditions.length||s.health.disability?'몸의 불편을 살피며 하루의 속도를 낮추었습니다. 하고 싶은 활동도 쉬는 시간을 사이에 두고 나누어 해 보았습니다.':'마음이 급해지면 잠시 멈추고 쉬는 시간을 정했습니다. 하루에 하고 싶은 일을 모두 끝내기보다, 내일 이어 할 것도 남겼습니다.','전에 정한 쉼의 간격을 돌아보았습니다. 피곤해지는 때에 맞추어 활동 시간을 줄이고, 여유가 있을 때 천천히 이어 갔습니다.',['health','balanced'],{healthLimited:Boolean(s.health.conditions.length||s.health.disability)});
  add('interest:work','어떤 일을 해 보고 싶을까','하루에 즐겁게 했던 일과 어렵게 느낀 일을 적었습니다. 잘한다는 말을 듣는 것보다, 계속 해 보고 싶은 일이 무엇인지 생각했습니다.','지난번 적은 관심사를 다시 보았습니다. 지금도 해 보고 싶은 일 하나를 골라, 작은 연습부터 시작했습니다.',['career','hobby'],{});
  // Continue a real stored activity only while its person/interest/context exists.
  // A changed focus starts a relevant activity instead of forcing an old thread.
  const continuation=active&&episodes.find(e=>e.key===active.key&&(!active.personId||e.facts.personId===active.personId)&&(!active.hobbyId||e.facts.hobbyId===active.hobbyId)&&(!active.level||e.facts.level===active.level));
  let scene;
  if(continuation&&active.startedAge===s.age-1&&(s.focus===active.focus||s.focus==='balanced')) {
    scene={key:`${active.key}:follow`,title:continuation.title,text:continuation.follow,facts:{...active,followupOfAge:active.startedAge}};
    flow.childhoodActivity=null;
  } else {
    flow.childhoodActivity=null;
    const candidates=episodes.filter(e=>e.focuses.includes(s.focus)&&(!(s.focus==='career'&&s.career.jobId)||e.facts.jobId===s.career.jobId));
    const pool=candidates.length?candidates:episodes;
    const lastUsed=e=>Math.max(-1,...recently.filter(r=>r.key.startsWith(`${e.key}:`)).map(r=>r.age));
    const fresh=pool.filter(e=>!e.facts.firstStep||!flow.childhoodFirstStepLinked);
    const selection=fresh.length?fresh:pool;
    const unused=episodes.filter(e=>(!e.facts.firstStep||!flow.childhoodFirstStepLinked)&&lastUsed(e)<s.age-5);
    const selected=selection.find(e=>e.facts.firstStep&&!flow.childhoodFirstStepLinked)||selection.find(e=>lastUsed(e)<s.age-5)||unused[0]||selection.toSorted((a,b)=>lastUsed(a)-lastUsed(b))[0];
    const facts={key:selected.key,startedAge:s.age,focus:s.focus,...selected.facts,source:'rule',synthetic:true};
    flow.childhoodActivity=facts;
    if(selected.facts.firstStep)flow.childhoodFirstStepLinked=true;
    scene={key:`${selected.key}:start`,title:selected.title,text:selected.start,facts};
  }
  if(previous&&previous.countryId!==s.countryId)scene.text=`새 거주지인 ${getCountry(s.countryId).name}의 생활에 적응하는 시간을 보냈습니다. ${scene.text}`;
  flow.childhoodScenes=[...recently,{key:scene.key,age:s.age}].slice(-8);
  return scene;
}
/** Call only for a new life; restoring an existing life never replays its childhood. */
export function initializeLifeFlow(s) {
  if(s.age!==0||s.flags.lifeFlow)return;
  const parents=s.family.parents.filter(p=>p.alive&&!p.absent);
  const household={low:'생활비를 조심스럽게 나누어 쓰는',middle:'기본 생활을 꾸려 가는',high:'교육과 돌봄에 쓸 여유가 있는'}[s.household];
  dailyRecord(s,'처음 함께 사는 사람들',parents.length?`처음 당신을 돌보는 사람은 ${parents.map(p=>p.name).join(', ')}입니다. 돌봄을 나누며 하루의 리듬을 맞춥니다. 가족 관계는 이후의 선택과 시간이 쌓이며 달라집니다.`:'주변의 돌봄을 받으며 하루의 리듬을 만들어 갑니다.',{people:parents.map(p=>p.id),age:0});
  dailyRecord(s,'자라게 될 생활의 자리',`${getCountry(s.countryId).name}의 ${s.city==='urban'?'도시':'농촌'}에서, ${household} 가정의 일상이 시작됩니다. 지금의 형편은 출발 조건이며 이후의 삶을 미리 정하지 않습니다.`,{countryId:s.countryId,city:s.city,household:s.household});
  s.flags.lifeFlow={version:1,lastAge:0,previous:dailySnapshot(s),lastRememberedChoice:null};
}
function advanceEverydayLife(s) {
  const flow=s.flags.lifeFlow||{version:1,lastAge:s.age-1,previous:null,lastRememberedChoice:null};
  if(flow.lastAge===s.age)return;
  const previous=flow.previous;
  if(s.age===1||s.age===2) {
    s.flags.earlyMilestones??={};
    const caregiver=s.family.parents.find(p=>p.alive&&!p.absent);
    if(s.age===1&&!s.flags.earlyMilestones.firstWords) {
      s.flags.earlyMilestones.firstWords=true;stat(s,'knowledge',1);stat(s,'social',1);
      dailyRecord(s,'익숙한 목소리에 답하며',`${caregiver?caregiver.name+'의':'익숙한'} 목소리를 따라 짧은 소리로 뜻을 전합니다. 반복해서 주고받는 말이 조금씩 늘었습니다.`,{milestone:'firstWords',caregiverId:caregiver?.id||null,knowledgeGain:1,socialGain:1});
    }
    if(s.age===2&&!s.flags.earlyMilestones.preferences) {
      s.flags.earlyMilestones.preferences=true;stat(s,'knowledge',1);
      dailyRecord(s,'좋아하는 것을 가리키다','익숙한 물건을 찾아 가리키고 원하는 놀이를 표현하기 시작했습니다. 어른이 정해 주던 하루에 자신의 뜻이 조금씩 들어옵니다.',{milestone:'preferences',knowledgeGain:1});
    }
  }
  if(s.age===4&&!s.seen.includes('first-friend')) {
    const friend=person(s,'어린 시절 친구',s.age);s.family.friends.push(friend);stat(s,'social',5);s.seen.push('first-friend');
    dailyRecord(s,'놀이를 기다리는 친구',`${withParticle(friend.name,'과','와')} 다시 만나 함께 놀기 시작했습니다. 이제 익숙한 어른뿐 아니라 또래와 보내는 시간도 생겼습니다.`,{personId:friend.id,relationship:'friend',socialGain:5});
  }
  if(s.age===6&&!eligibleEducation(s,'primary')) {
    learned(s,'primary');stat(s,'knowledge',8);s.flags.schoolAttendance='regular';
    if(!s.seen.includes('primary-school'))s.seen.push('primary-school');
    dailyRecord(s,'학교로 향하는 아침','기본 학교 과정에 들어가 글과 수를 배우기 시작했습니다. 수업 사이에 또래와 지내는 시간이 늘었습니다. 앞으로 무엇에 더 집중할지는 생활 초점에서 정할 수 있습니다.',{educationLevel:'primary',knowledgeGain:8});
  }
  const parts=[];
  const adult=s.age>=18?adultLifeScene(s):null;
  const scene=adult||(s.age>=6&&s.age<18?childhoodScene(s,flow,previous):null);
  const parents=s.family.parents.filter(p=>p.alive&&!p.absent);
  const partner=s.family.relationship||activePartner(s);
  const friends=s.family.friends.filter(p=>p.alive);
  const children=s.family.children.filter(p=>p.alive);
  const p=s.education.program;
  if(s.age<3) parts.push(`${parents.length?parents.map(p=>p.name).join(', ')+'의 돌봄을 받으며':'주변의 돌봄을 받으며'} ${s.city==='urban'?'도시':'농촌'}의 집에서 하루를 보냈습니다.`);
  else if(s.age<6) parts.push(friends.length?`${withParticle(friends[0].name,'과','와')} 함께 노는 시간과 집에서 쉬는 시간이 하루에 자리 잡았습니다.`:'집과 가까운 동네를 오가며 익숙한 사람·장소가 늘어났습니다.');
  else if(scene) parts.push(scene.text);
  const change=(key)=>previous?(Math.round((s.stats[key]-previous.stats[key])*10)/10 || 0):null;
  let choiceContext=null;
  const last=s.flags.lastStoryChoice;
  if(last&&last.age<s.age&&flow.lastRememberedChoice!==`${last.structure}:${last.age}`) {
    const linked=last.structure==='childhood-first-steps'?FIRST_STEPS[s.flags.childFirstSteps?.choiceId]?.memory:last.structure==='birth-care'?'가족이 정한 초기 돌봄의 방향을 기억하며 자라고 있습니다.':last.structure.startsWith('education-funding:')?`학비가 막혔을 때 정한 “${last.label}” 이후의 경과입니다.`:last.structure.startsWith('career-opportunity:')?`지난 구직 기회에서 “${last.label}”를 선택한 뒤의 생활입니다.`:last.structure.startsWith('relationship-')||last.structure.startsWith('family-plan:')?`“${last.label}”라고 정했던 관계의 선택이 지금의 생활로 이어졌습니다.`:null;
    if(linked){if(adult)choiceContext={structure:last.structure,age:last.age,label:last.label};else parts.push(linked);}
    flow.lastRememberedChoice=`${last.structure}:${last.age}`;
  }
  dailyRecord(s,scene?.title||`${s.age}세, ${focusNames[s.focus]||'일상'}`,parts.join(' '),{focus:s.focus,stats:{...s.stats},statChanges:previous?Object.fromEntries(Object.keys(s.stats).map(key=>[key,change(key)])):{},...(scene?{narrative:{...scene.facts,...(scene.key?{key:scene.key}:{}),source:'rule',synthetic:true}}:{}),...(adult?{adultContext:adult.context,choiceContext,workSkill:s.flags.skills?.work||0,workSkillChange:previous?(s.flags.skills?.work||0)-previous.workSkill:null,hobbies:s.hobbies.map(h=>({...h})),children:children.map(c=>({id:c.id,name:c.name,closeness:c.closeness??50})),cash:s.finance.cash}:{}),education:{level:s.education.level,programId:p?.id||null,yearsLeft:s.education.yearsLeft,paused:Boolean(s.flags.educationPaused),onLeave:Boolean(s.flags.educationOnLeave)},career:{jobId:s.career.jobId,years:s.career.years},income:s.finance.annualIncome,expense:s.finance.annualExpense,people:[...parents,...friends,...children,...(partner?[partner]:[])].map(p=>p.id)});
  flow.lastAge=s.age;flow.previous=dailySnapshot(s);s.flags.lifeFlow=flow;
}
export function advanceWorld(s) {
  if(s.flags.worldAdvancedYear===s.year)return;
  for(const companion of s.cohort) {
    initializeLegacyCompanion(companion,s);
    while(companion.age<s.age&&companion.status!=='ended')advanceCompanion(companion,s);
  }
  const env=getEnvironment(s.countryId,{year:s.year,mode:s.mode,city:s.city,household:s.household});
  s.flags.environment=env;s.flags.worldModelVersion=2;s.flags.worldAdvancedYear=s.year;
  if(s.age<18&&attendingSchool(s))stat(s,'knowledge',Math.round(Math.max(0,(env.education-35)/35)*10)/10);
  for(const reference of HISTORICAL_REFERENCES.filter(item=>item.year===s.year&&s.year<=2026)) {
    const structure=`reference:${reference.id}`;
    if(s.seen.includes(structure))continue;
    const effect=HISTORICAL_GAME_EFFECTS[reference.id];s.seen.push(structure);
    const item=log(s,'world',reference.title,`${reference.summary} 확인된 사실의 출처: ${reference.url} 게임에서는 ${effect.description}를 적용합니다. 수치·지속 기간·개인별 영향은 실제 통계가 아닌 독립 합성 규칙입니다.`,structure);
    item.reference={...reference};item.effect={...effect,source:'rule',synthetic:true};
  }
  if(s.age>0&&s.age%10===0) {
    const structure=`world:${s.mode}:${s.year}`;
    if(!s.seen.includes(structure)) {
      const phase=s.year>2026?'future':s.year<2026?'past':'present';
      const descriptions={past:['과거 배경의 합성 흐름','교통과 교육 기회가 변화하는 과거 배경을 가정합니다. 실제 역사 사건의 재현 자료는 아닙니다.'],present:['함께 변하는 생활','동네의 일자리와 생활 방식이 달라지는 환경을 가정합니다.'],future:['미래를 상상한 갈림길','새 기술과 기후 적응이 영향을 주는 미래를 가정합니다. 미래 예측 자료가 아닙니다.']};
      const [title,text]=descriptions[phase];
      s.seen.push(structure);log(s,'world',title,`${text} 합성 교육 환경 ${env.education}, 건강 환경 ${env.health}, 일자리 여건 ${Math.round(env.jobDemand*100)}%, 기후 부담 ${Math.round(env.climatePressure*100)}를 연간 생활에 반영합니다.`,structure);
    }
  }
  advanceEverydayLife(s);
}

export const STORY_STRUCTURE_COUNT = STORIES.length;
