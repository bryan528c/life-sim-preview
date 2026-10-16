import { HOBBIES } from './world.mjs';
import { attendingSchool } from './focus.mjs';

// Authored fictional scenes, selected from current facts at the moment of play.
// No RNG, effects, forecasts, or precomputed future dialogue live in this module.
export function sceneHash(value) {
  let h=2166136261;
  for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
  return h;
}
const withParticle = (word,closed,open) => `${word}${/[가-힣]/.test(word.at(-1))&&(word.charCodeAt(word.length-1)-0xac00)%28?closed:open}`;
const withName = name => withParticle(name,'과','와');
const present = p => p?.alive&&!p.absent&&!p.separated;
function context(s) {
  return {focus:s.focus,jobId:s.career.jobId,programId:s.education.program?.id??null,
    paused:Boolean(s.flags.educationPaused),leave:Boolean(s.flags.educationOnLeave),
    place:`${s.countryId}:${s.city}`,role:s.flags.prisonYears>0?'prison':s.flags.serviceYears>0?'service':s.flags.careBreak?'care':s.career.retired?'retired':s.education.program?'student':s.career.jobId?'work':'home',
    firstStep:s.age<6?s.flags.childFirstSteps?.choiceId??null:null};
}
function episodes(s) {
  const out=[],ctx=context(s),restricted=['prison','service'].includes(ctx.role);
  const add=(key,title,start,follow,focuses,targets={},choiceId=null)=>out.push({key,title,start,follow,focuses,targets,choiceId});
  const parents=s.family.parents.filter(present),friends=s.family.friends.filter(present);
  const family=[...parents,...s.family.children.filter(present),...s.family.partners.filter(p=>present(p)&&p.relation==='spouse'),...(present(s.family.relationship)?[s.family.relationship]:[])].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
  if(s.age<3) {
    for(const p of parents)add('early:voice','소리를 주고받는 시간',`${p.name}이 부르는 소리에 고개를 돌렸습니다. 같은 소리를 되풀이하자 익숙한 얼굴에 웃음이 번졌습니다.`,`${p.name}의 목소리가 들리자 먼저 소리를 냈습니다. 지난번 주고받던 짧은 소리가 둘만 아는 인사처럼 이어졌습니다.`,['balanced','family','social'],{personId:p.id});
    add('early:reach','손이 닿는 곳',s.age===0?'눈앞에서 움직이는 물건을 눈으로 좇았습니다. 손을 뻗었다가 놓치고, 다시 바라보았습니다.':'손에 쥔 물건을 내려놓았다가 다시 집어 보았습니다. 같은 동작에도 새로운 소리와 모양이 보였습니다.','전에 관심을 보였던 움직임을 다시 좇았습니다. 이번에는 먼저 손을 뻗어 뜻을 표현했습니다.',['balanced','study','hobby','health','rest']);
  } else if(s.age<6) {
    const first=s.flags.childFirstSteps?.choiceId;
    const variants={
      observe:['작은 것들의 이름','길에서 주운 돌을 크기대로 놓아 보았습니다. 비슷해 보이던 돌에도 다른 무늬가 있었습니다.','앞서 골라 둔 돌을 다시 살폈습니다. 처음에는 크기만 보았지만, 이번에는 무늬가 비슷한 것끼리 나란히 놓았습니다.'],
      run:['어디까지 달려 볼까','힘껏 달려 본 기억을 따라 가까운 곳에 도착점을 정했습니다. 숨이 차면 쉬고, 다시 출발했습니다.','전에 정한 도착점까지 이번에는 천천히 가 보았습니다. 빨리 달릴 때 놓쳤던 주변 풍경이 눈에 들어왔습니다.'],
      comfort:['표정을 살피는 아이','울던 아이 곁에 머물렀던 때를 떠올리며 주변 표정을 살폈습니다. 무슨 말을 할지 몰라도 가까이 앉아 기다릴 수 있었습니다.','지난번 먼저 다가갔던 마음을 떠올렸습니다. 이번에는 말이 끝날 때까지 기다렸다가 자신의 이야기를 꺼냈습니다.'],
      retry:['다시 해 보는 순서','마음대로 되지 않는 놀이를 잠시 내려놓았습니다. 넘어진 뒤 다시 걸었던 때처럼, 쉬었다가 어려운 부분부터 해 보았습니다.','지난번 막혔던 부분을 다시 해 보았습니다. 한 번에 끝내려 하지 않고 작은 순서로 나누니 어디서 멈추는지 알 수 있었습니다.']};
    if(variants[first]){const [title,start,follow]=variants[first];add(`child:${first}`,title,start,follow,['balanced','study','health','hobby','rest','family','social'],{},'childhood-first-steps');}
    for(const p of friends) {
      add('child:road','나란히 놓은 작은 길',`${withName(p.name)} 놀이에 쓸 길을 만들었습니다. ${first==='observe'?'돌의 무늬를 보고 길가에 놓을 것을 골랐습니다.':first==='run'?'길 끝까지 손가락으로 달려 보았습니다.':first==='comfort'?'어느 쪽으로 가고 싶은지 먼저 물었습니다.':'서로 만든 길이 만나는 자리를 정했습니다.'} “여기는 같이 쓰자.”`,`${withName(p.name)} 전에 만들던 길을 떠올렸습니다. “오늘은 여기서 이어 볼까?” 서로 기억하는 모양이 달라, 만나게 할 자리를 다시 정했습니다.`,['balanced','family','social','hobby'],{personId:p.id},first?'childhood-first-steps':null);
      add('child:turn','내 차례 다음은',`${p.name}이 하고 싶은 놀이를 물었습니다. 먼저 해 보는 사람과 기다리는 사람을 번갈아 정했습니다.`,`${p.name}이 “이번엔 네 차례지?” 하고 물었습니다. 전에 정한 순서 덕분에 기다리는 동안 다음 놀이를 생각할 수 있었습니다.`,['social','family'],{personId:p.id});
    }
    for(const p of parents)add('child:home','집에 가져온 이야기',`${p.name}에게 오늘 눈에 띈 일을 이야기했습니다. 짧게 끊기는 말 사이로 “그다음에는?”이라는 질문이 돌아왔습니다.`,`${p.name}에게 전에 하다 만 이야기를 이어 했습니다. 이번에는 들었던 질문도 기억해 두었다가 먼저 말했습니다.`,['family','balanced'],{personId:p.id});
  }
  if(s.age>=6) {
    const turning=s.history.findLast(h=>h.structure==='adult-transition'&&h.age>=s.age-1);
    const receipt=turning&&s.receipts.findLast(r=>r.type==='choose'&&r.age===turning.age&&JSON.parse(r.fingerprint).decisionId===`${s.lifeId}:story:adult-transition`);
    const chosen=receipt?JSON.parse(receipt.fingerprint).choiceId:null;
    if(turning&&!restricted&&chosen) {
      const choices={
        explore:['진로를 더 알아보기로 한 뒤, 관심 있는 일과 지금 할 수 있는 일을 따로 적었습니다. 두 목록이 겹치는 곳부터 찾아보았습니다.','앞서 적은 두 목록을 다시 펼쳤습니다. 해 본 일이 생긴 칸에는 경험을 덧붙이고, 아직 모르는 일에는 질문을 남겼습니다.'],
        work:[`${s.career.title} 일을 시작하기로 한 뒤, 하루가 어디에서 바빠지는지 살폈습니다. 처음 맡는 순서 하나를 적어 두었습니다.`,`처음 적었던 일의 순서를 다시 읽었습니다. 이제 익숙해진 부분과 여전히 확인해야 하는 부분을 나누었습니다.`],
        training:['직업 교육을 택한 뒤, 배운 내용을 직접 해 보는 시간을 마련했습니다. 설명을 읽을 때와 손으로 해 볼 때 막히는 곳이 달랐습니다.','앞서 막혔던 연습을 다시 해 보았습니다. 아직 어려운 과정은 건너뛰지 않고 질문으로 남겼습니다.'],
        university:['대학 진학을 택한 뒤, 낯선 공부에서 흥미로운 질문을 하나 골랐습니다. 수업을 듣는 일과 스스로 찾아보는 일의 차이를 느꼈습니다.','앞서 골랐던 질문을 자신의 말로 풀어 보았습니다. 답이 선명해진 부분과 더 배우고 싶은 부분이 함께 남았습니다.'],
        loan:['대출을 받아 원격 공부를 시작한 뒤, 생활 속에서 수강할 시간을 정했습니다. 화면 앞에 앉을 시간과 쉬는 시간을 따로 남겼습니다.','앞서 정했던 수강 시간을 돌아보았습니다. 잘 지킨 날의 방식은 남기고 생활과 맞지 않는 부분만 조정했습니다.']};
      const pair=choices[chosen],applicable=chosen==='explore'||(chosen==='work'&&s.career.jobId)||(['training','university','loan'].includes(chosen)&&s.education.program&&!ctx.paused&&!ctx.leave);
      if(pair&&applicable)add(`choice:adult:${chosen}`,'선택한 길의 첫 일상',...pair,['career','study','balanced','family'],s.career.jobId?{jobId:s.career.jobId}:s.education.program?{programId:s.education.program.id}:{},'adult-transition');
    }
    if(!restricted)for(const p of family) {
      const child=s.family.children.some(c=>c.id===p.id),elder=s.family.parents.some(c=>c.id===p.id);
      // Match the existing infant boundary without giving babies adult dialogue.
      if(child&&p.age<=1) {
        add('family:infant-rhythm','작은 신호에 맞춘 하루',`${p.name}의 표정과 움직임을 살피며 먹고 쉬는 시간을 나누어 보았습니다. 대답을 기다리기보다 지금 필요한 돌봄을 찾았습니다.`,`${p.name}의 지난 신호와 요즘의 반응을 함께 살폈습니다. 익숙해 보이는 움직임도 곧바로 단정하지 않고, 편안해지는지 지켜보았습니다.`,['family','balanced'],{personId:p.id});
        add('family:infant-response','눈길이 머무는 동안',`${p.name} 곁에서 익숙한 소리로 천천히 말을 건넸습니다. 눈길이 돌아오거나 몸을 움직이면 잠시 기다리며 반응을 살폈습니다.`,`${p.name} 곁에서 전에 들려주던 소리를 다시 내 보았습니다. 말을 알아들었다고 단정하지 않고, 시선과 움직임을 보며 가까이 머물렀습니다.`,['family','balanced'],{personId:p.id});
        continue;
      }
      add('family:listen','끝까지 들은 이야기',child?`${p.name}에게 요즘 즐거운 일을 물었습니다. 답을 대신 정해 주지 않고, 무엇이 재미있는지 끝까지 들었습니다.`:elder?`${p.name}에게 요즘 하루를 어떻게 보내는지 물었습니다. 익숙한 안부 뒤에도 미처 몰랐던 이야기가 있었습니다.`:`${p.name}에게 오늘 가장 오래 마음에 남은 일을 물었습니다. 서로 다른 하루를 차례로 이야기했습니다.`,`${p.name}에게 지난번 이야기의 뒷일을 물었습니다. “그걸 기억하고 있었네.” 새로운 이야기를 꺼내기 전에, 하던 말을 먼저 이어 갔습니다.`,['family','balanced'],{personId:p.id});
      add('family:share','하루에서 고른 한 장면',`${p.name}에게 ${s.career.jobId?`${s.career.title} 일을 하며`:s.education.program?`${s.education.program.label} ${ctx.paused||ctx.leave?'공부를 잠시 쉬며':'공부를 하며'}`:'하루를 보내며'} 기억에 남은 장면을 전했습니다. 조언을 구하기보다 그때의 마음을 말해 보았습니다.`,`${p.name}에게 전에 이야기한 뒤 달라진 점을 전했습니다. 이번에는 상대의 하루에서 무엇이 남았는지도 물었습니다.`,['family'],{personId:p.id});
    }
    if(!restricted)for(const p of friends) {
      add('friend:news','먼저 건넨 안부',`${p.name}에게 먼저 안부를 전했습니다. “요즘 어떻게 지내?” 짧은 질문 뒤에 각자의 근황이 이어졌습니다.`,`${p.name}에게 지난번 들은 일은 어떻게 되었는지 물었습니다. 새 소식을 재촉하지 않고, 지금 들려주고 싶은 이야기부터 들었습니다.`,['social','family','balanced'],{personId:p.id});
      add('friend:memory','서로 다르게 기억한 날',`${withName(p.name)} 함께 보낸 시간을 떠올렸습니다. 같은 날에도 기억하는 장면이 달라 이야기가 길어졌습니다.`,`${p.name}이 앞서 나눈 기억에 빠뜨린 대목을 덧붙였습니다. 자신의 기억과 다른 부분도 지우지 않고 함께 남겨 두었습니다.`,['social','family'],{personId:p.id});
    }
    if(!restricted)for(const h of s.hobbies) {
      const label=HOBBIES.find(x=>x.id===h.id)?.label??h.id;
      add('hobby:part',`${label}, 작은 부분부터`,`${label}에서 다시 해 보고 싶은 부분 하나를 골랐습니다. ${h.level>=20?'더 높은 수치를 좇기보다 손에 익은 과정에서 재미를 찾았습니다.':'한꺼번에 끝내기보다 어디서 막히는지 살펴보았습니다.'}`,`전에 골라 둔 ${label}의 그 부분을 다시 해 보았습니다. 처음과 느낌이 다른 곳을 적고 다음에 이어 할 것을 남겼습니다.`,['hobby','balanced'],{hobbyId:h.id});
      add('hobby:explain',`${withParticle(label,'을','를')} 설명해 보다`,`${withParticle(label,'을','를')} 하면서 자신에게 익숙한 순서를 말로 풀어 보았습니다. 당연하게 지나치던 부분을 설명하려니 빠뜨린 과정이 보였습니다.`,`앞서 풀어 쓴 ${label}의 설명을 읽으며 다시 해 보았습니다. 실제로 손이 움직이는 순서와 다른 곳을 고쳤습니다.`,['hobby','study'],{hobbyId:h.id});
      add('hobby:compare',`${label}, 다르게 해 본 한 부분`,`${label}에서 늘 하던 방식 하나를 조금 바꾸어 보았습니다. 더 낫다고 곧바로 정하기보다, 익숙한 방식과 어떤 느낌이 다른지 살폈습니다.`,`앞서 바꾸어 보았던 ${label}의 한 부분을 다시 비교했습니다. 마음에 드는 점은 남기고, 계속하기 불편한 부분은 익숙한 방식으로 돌렸습니다.`,['hobby'],{hobbyId:h.id});
    }
    if(!restricted&&s.career.jobId&&!s.career.retired) {
      add('work:order','일의 순서를 적어 보다',`${s.career.title} 일에서 ${s.career.years<2?'아직 손에 익지 않은':'자꾸 되짚게 되는'} 순서를 적었습니다. 일을 마친 뒤, 다시 확인해야 했던 지점을 표시했습니다.`,`전에 적어 둔 ${s.career.title} 업무 순서를 실제 일과 맞춰 보았습니다. 잘 맞는 순서는 남기고, 돌아가게 만드는 부분만 고쳤습니다.`,['career','balanced'],{jobId:s.career.jobId});
      add('work:question','일하면서 남긴 질문',`${s.career.title} 일을 하며 바로 설명하기 어려웠던 점을 따로 적었습니다. 안다고 넘기던 부분을 다시 확인할 계기가 생겼습니다.`,`앞서 남긴 ${s.career.title} 업무 질문을 다시 보았습니다. 해 본 과정으로 설명할 수 있는 것과 더 확인할 것을 나누었습니다.`,['career'],{jobId:s.career.jobId});
      add('work:check','마치기 전에 돌아본 일',`${s.career.title} 일을 마치기 전에 빠뜨린 것이 없는지 하나씩 돌아보았습니다. 급할 때 지나치기 쉬웠던 부분을 다음에도 확인할 곳으로 남겼습니다.`,`앞서 남겨 둔 ${s.career.title} 업무의 확인 지점을 다시 살폈습니다. 매번 되짚어야 하는 곳과 이제 자연스럽게 확인하는 곳을 나누었습니다.`,['career','balanced'],{jobId:s.career.jobId});
      add('work:prepare','다음 일을 위한 준비',`${s.career.title} 일을 시작하기 전에 필요한 준비를 먼저 정리했습니다. 시작한 뒤 멈춰 찾는 일이 어디서 생기는지 살피며 준비 순서를 바꾸어 보았습니다.`,`전에 바꾸었던 ${s.career.title} 업무 준비를 실제 하루와 맞춰 보았습니다. 도움이 된 부분은 남기고, 오히려 번거로웠던 준비는 줄였습니다.`,['career'],{jobId:s.career.jobId});
    }
    if(!restricted&&(attendingSchool(s)||s.education.program)&&!ctx.paused&&!ctx.leave) {
      const course=s.education.program?.label??'지금 배우는 과정';
      add('learning:question','지우지 않은 질문',`${course}에서 헷갈린 내용을 표시했습니다. 정답만 옮기지 않고, 어디까지 이해했는지 자신의 말로 적었습니다.`,`앞서 표시한 질문을 다시 풀어 보았습니다. 설명할 수 있는 부분은 남기고 아직 막히는 대목에는 새 질문을 붙였습니다.`,['study','career','balanced'],s.education.program?{programId:s.education.program.id}:{schoolLevel:s.education.level});
    }
    if(!restricted) {
      add('learning:notes','배운 것을 한곳에','새로 알게 된 것을 짧게 적어 한곳에 모았습니다. 비슷한 내용끼리 놓아 보니 따로 알던 것 사이의 연결이 보였습니다.','앞서 모아 둔 메모를 다시 읽었습니다. 이해가 달라진 부분에는 새 설명을 덧붙이고, 처음 적었던 말도 남겨 두었습니다.',['study']);
      add('learning:explain','내 말로 풀어 보기','익숙하다고 생각한 내용을 아무것도 보지 않고 설명해 보았습니다. 말이 막히는 곳을 찾아 다시 살펴볼 부분으로 남겼습니다.','전에 설명하다 막혔던 부분을 다시 풀어 보았습니다. 여전히 설명하기 어려운 곳은 아는 척하지 않고 질문으로 바꾸었습니다.',['study']);
    }
    if(!restricted&&!attendingSchool(s)&&!s.career.jobId&&!s.education.program&&!s.career.retired)add('career:possibility','해 볼 수 있는 것부터','일과 배움 중 지금 가능한 길을 살폈습니다. 당장 지원할 일과 준비가 더 필요한 일을 나누어 적었습니다.','앞서 적은 준비 목록을 다시 보았습니다. 이미 해 본 것에는 표시하고, 아직 막힌 조건은 그대로 남겨 두었습니다.',['career','study','balanced']);
  }
  if(s.age>=6)add('rest:pace','잠시 멈춘 자리',restricted?`${ctx.role==='service'?'복무':'수감'} 일정 사이에 허용된 쉼의 시간을 가졌습니다. 할 수 있는 활동 안에서 몸의 상태를 살폈습니다.`:s.health.conditions.length||s.health.disability?'몸이 보내는 신호를 살피며 활동 사이에 쉬는 시간을 두었습니다. 오늘 할 수 있는 만큼의 속도를 찾았습니다.':'하던 일을 잠시 멈추고 주변 소리를 들었습니다. 꼭 오늘 끝낼 일과 다음에 이어도 될 일을 나누었습니다.','앞서 정한 쉼의 간격을 돌아보았습니다. 편안했던 때와 무리했던 때를 구분해 하루의 속도를 조절했습니다.',['health','rest']);
  else add('early:rest','잠깐 쉬었다가',s.age<3?'졸린 눈을 비비고 익숙한 돌봄 곁에서 쉬었습니다. 깨어나자 눈앞의 소리와 움직임이 다시 궁금해졌습니다.':'놀이를 하다 지쳐 잠깐 앉았습니다. 숨이 편안해지자 다시 해 보고 싶은 놀이를 골랐습니다.',s.age<3?'익숙한 소리를 들으며 몸을 편히 기댔습니다. 쉬고 난 뒤에는 손을 뻗어 주변을 살폈습니다.':'전에 쉬던 자리에 앉아 숨을 골랐습니다. 다시 놀 준비가 되었는지 스스로 몸을 움직여 보았습니다.',['health','rest']);
  if(s.age>=6) {
    add('rest:rhythm','편안했던 때를 기억하며','하루 중 몸이 편안했던 때를 떠올렸습니다. 더 많이 해내는 것보다, 무리하지 않고 이어갈 수 있었던 흐름을 기억해 두었습니다.','앞서 편안했다고 느낀 하루와 요즘의 생활을 비교했습니다. 그대로인 부분과 달라진 부분을 살피며 지금 맞는 속도를 찾았습니다.',['health','rest']);
    add('rest:quiet','아무것도 서두르지 않는 시간',restricted?'정해진 생활 안에서 허용된 조용한 시간을 보냈습니다. 바로 다음 일을 생각하지 않고 잠깐 가만히 있어 보았습니다.':'잠깐 빈 시간을 남겨 두었습니다. 무엇을 더 할지 곧장 정하지 않고, 그동안 지나쳤던 주변에 눈길을 주었습니다.','전에 남겨 두었던 조용한 시간을 다시 가졌습니다. 같은 자리에 있어도 마음에 걸리는 것이 달라졌다는 것을 알아차렸습니다.',['health','rest']);
  }
  return {ctx,out};
}

export function yearScene(s, source=null) {
  const {ctx,out}=episodes(s),contextKey=JSON.stringify(ctx);
  if(source) {
    const m=source.lifeFacts?.yearEvent;
    if(!m||m.stage!=='start'||m.contextKey!==contextKey)return null;
    const e=out.find(e=>e.key===m.episode&&JSON.stringify(e.targets)===JSON.stringify(m.targets));
    return e?{...e,text:e.follow,contextKey,stage:'follow',causeId:source.id,choiceHistoryId:m.choiceHistoryId}:null;
  }
  const rows=s.history.filter(h=>h.lifeFacts?.yearEvent?.stage==='start');
  let usable=out.filter(e=>e.focuses.includes(s.focus));
  // The longstanding focus rule advances age % hobbies.length. Selection must
  // describe that actual hobby, not award B while narrating practice of A.
  if(s.focus==='hobby'&&s.hobbies.length){const h=s.hobbies[s.age%s.hobbies.length];const matching=usable.filter(e=>e.targets.hobbyId===h.id);if(matching.length)usable=matching;}
  const pool=usable.length?usable:out;
  const stamp=h=>h.age*12+(h.moment?.month??0);
  const last=(e,exact)=>Math.max(-24,...rows.filter(h=>h.lifeFacts.yearEvent.episode===e.key&&(!exact||JSON.stringify(h.lifeFacts.yearEvent.targets)===JSON.stringify(e.targets))).map(stamp));
  const priority=e=>(e.key.startsWith('choice:adult:')&&last(e,false)<0?2:s.age===4&&e.key==='child:road'?1:0);
  // Rotate episodes before people, so a new target cannot hide repeated prose.
  const chosen=pool.toSorted((a,b)=>priority(b)-priority(a)||last(a,false)-last(b,false)||last(a,true)-last(b,true)||sceneHash(`${s.seed}:${s.age}:${a.key}:${JSON.stringify(a.targets)}`)-sceneHash(`${s.seed}:${s.age}:${b.key}:${JSON.stringify(b.targets)}`))[0];
  const choiceHistoryId=chosen.choiceId?s.history.findLast(h=>h.structure===chosen.choiceId)?.id??null:null;
  return {...chosen,text:chosen.start,contextKey,stage:'start',causeId:null,choiceHistoryId};
}
