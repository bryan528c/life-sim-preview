import { HOBBIES } from './world.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max;
const score = v => Number.isFinite(v) && v >= 0 && v <= 100;
export function validAdultLifeFacts(f) {
  const c = f?.adultContext, n = f?.narrative;
  return plain(c) && ['prison','service','care','retired','student','work','unemployed'].includes(c.role)
    && (c.jobId === null || text(c.jobId)) && (c.programId === null || text(c.programId))
    && typeof c.paused === 'boolean' && typeof c.onLeave === 'boolean' && typeof c.healthLimited === 'boolean'
    && text(c.countryId) && ['urban','rural'].includes(c.city) && Array.isArray(c.carePeople) && c.carePeople.every(id => text(id))
    && plain(n) && n.domain === 'adult' && text(n.key) && ['start','follow'].includes(n.stage)
    && text(n.focus) && text(n.contextKey, 10000) && plain(n.targets) && Object.values(n.targets).every(id => text(id))
    && n.source === 'rule' && n.synthetic === true
    && (n.stage !== 'follow' || (text(n.followupHistoryId) && Number.isInteger(n.followupOfAge) && n.followupOfAge >= 18))
    && plain(f.stats) && Object.values(f.stats).every(score) && plain(f.statChanges) && Object.values(f.statChanges).every(v => Number.isFinite(v) && Math.abs(v) <= 100)
    && score(f.workSkill) && (f.workSkillChange === null || (Number.isFinite(f.workSkillChange) && Math.abs(f.workSkillChange) <= 100))
    && ['income','expense','cash'].every(k => Number.isSafeInteger(f[k]))
    && plain(f.career) && Number.isInteger(f.career.years) && f.career.years >= 0
    && plain(f.education) && Number.isInteger(f.education.yearsLeft) && f.education.yearsLeft >= 0
    && Array.isArray(f.hobbies) && f.hobbies.every(h => plain(h) && text(h.id) && Number.isInteger(h.level) && h.level >= 1 && h.level <= 100)
    && Array.isArray(f.children) && f.children.every(p => plain(p) && text(p.id) && text(p.name) && score(p.closeness))
    && (f.choiceContext === null || (plain(f.choiceContext) && text(f.choiceContext.structure) && text(f.choiceContext.label) && Number.isInteger(f.choiceContext.age)));
}

// Authored, fictional everyday prose. This projection never runs an action,
// changes a relationship/statistic, consumes RNG, or invents a country fact.
function roleOf(s) {
  if (s.flags.prisonYears > 0) return 'prison';
  if (s.flags.serviceYears > 0) return 'service';
  if (s.flags.careBreak) return 'care';
  if (s.career.retired) return 'retired';
  if (s.education.program) return 'student';
  return s.career.jobId ? 'work' : 'unemployed';
}

function roleLine(s, context, prior) {
  const p = s.education.program;
  switch (context.role) {
    case 'prison': return '수감 중 허용된 활동과 쉼으로 하루를 꾸렸습니다.';
    case 'service': return '복무 일정에 맞추어 맡은 일과 쉬는 시간을 나누었습니다.';
    case 'care': return context.carePeople.length
      ? (prior?.role === 'care' ? '유급 일 대신 가족 돌봄을 이어 간 한 해였습니다.' : '유급 일을 내려놓고 가족 돌봄을 중심으로 하루를 바꾸었습니다.')
      : '유급 일을 쉬며 돌봄 이후의 생활을 돌아보았습니다.';
    case 'retired': return prior && prior.role !== 'retired'
      ? '일을 마무리하고 은퇴 뒤의 하루를 새로 꾸리기 시작했습니다.'
      : '은퇴 후 자신의 속도로 하루를 꾸렸습니다.';
    case 'student':
      if (s.flags.educationOnLeave) return `${p.label}의 수강을 남겨 두고 휴학 중의 생활을 꾸렸습니다.`;
      if (s.flags.educationPaused) return `${p.label} 학비가 부족해 수강을 멈추고 다음 계획을 살폈습니다.`;
      if (prior?.paused && prior.programId === context.programId) return `막혔던 ${p.label} 수강을 다시 이어 갔습니다.`;
      return `${p.label} 공부${s.career.jobId ? `와 ${s.career.title} 일` : ''}을 이어 갔습니다.`;
    case 'work':
      if (prior?.role === 'care') return `돌봄으로 쉬었던 유급 일을 ${s.career.title}로 다시 이어 갔습니다.`;
      if (prior?.jobId && prior.jobId !== s.career.jobId) return `${s.career.title}로 일터를 옮겨 새 업무에 적응했습니다.`;
      if (prior && !prior.jobId) return `${s.career.title} 일을 시작한 뒤 하루의 리듬이 달라졌습니다.`;
      return `${s.career.title} 일을 이어 갔습니다.`;
    default: return '유급 일을 쉬며 다음 생활을 준비했습니다.';
  }
}

export function adultLifeScene(s) {
  if (s.age < 18) return null;
  const parents = s.family.parents.filter(p => p.alive && !p.absent);
  const children = s.family.children.filter(p => p.alive && !p.absent);
  const partner = [s.family.relationship, ...s.family.partners.filter(p => p.relation === 'spouse')].find(p => p?.alive && !p.absent && !p.separated);
  const friend = s.family.friends.find(p => p.alive && !p.absent);
  const person = children[0] ?? partner ?? parents[0];
  const hobby = s.hobbies[0];
  const role = roleOf(s);
  const context = { role, jobId: s.career.jobId, programId: s.education.program?.id ?? null,
    paused: Boolean(s.flags.educationPaused), onLeave: Boolean(s.flags.educationOnLeave),
    countryId: s.countryId, city: s.city, carePeople: [...children, ...parents.filter(p => p.age >= 65)].map(p => p.id),
    healthLimited: Boolean(s.health.conditions.length || s.health.disability) };
  const previous = s.history.findLast(h => h.category === 'daily' && h.age === s.age - 1 && h.lifeFacts?.adultContext);
  const prior = previous?.lifeFacts.adultContext;
  const episodes = [];
  const add = (key, title, start, follow, focuses, facts = {}) => episodes.push({key, title, start, follow, focuses, facts});
  if (person && !['prison', 'service'].includes(role)) {
    add('family:listen', '귀 기울인 하루', `${person.name}의 안부를 묻고 요즘의 이야기를 들었습니다.`, `${person.name}에게 지난번 들은 이야기의 뒷일을 물었습니다.`, ['family', 'balanced'], {personId: person.id});
    add('family:remember', '서로의 하루', `${person.name}에게 자신의 하루에서 기억에 남은 일을 전했습니다.`, `${person.name}에게 전에 나눈 이야기를 이어 전했습니다.`, ['family'], {personId: person.id});
  }
  if (friend && !['prison', 'service'].includes(role)) {
    add('friend:news', '이어지는 안부', `${friend.name}에게 안부를 건네며 서로의 근황을 나누었습니다.`, `${friend.name}에게 지난번 들었던 일의 경과를 물었습니다.`, ['social', 'balanced', 'family'], {personId: friend.id});
    add('friend:listen', '들어 주는 시간', `${friend.name}의 이야기를 서두르지 않고 들었습니다.`, `${friend.name}에게 전에 나눴던 생각을 다시 물었습니다.`, ['social', 'family'], {personId: friend.id});
  }
  if (hobby && !['prison', 'service'].includes(role)) {
    const label = HOBBIES.find(h => h.id === hobby.id)?.label ?? hobby.id;
    add('hobby:practice', '손에 남은 연습', `${label}에서 더 익히고 싶은 부분을 골라 연습했습니다.`, `지난번 남겨 둔 ${label} 연습을 다시 이어 갔습니다.`, ['hobby', 'balanced'], {hobbyId: hobby.id});
    add('hobby:revisit', '다시 찾은 취미', `${label}에서 즐거웠던 부분을 돌아보며 시간을 보냈습니다.`, `지난번 돌아본 ${label}의 즐거움을 떠올리며 다시 시간을 냈습니다.`, ['hobby'], {hobbyId: hobby.id});
  }
  if (role === 'work' || (role === 'student' && s.career.jobId)) {
    add('work:order', '익숙한 일의 순서', '업무에서 자주 막히는 순서를 적고 하나씩 정리했습니다.', '지난번 적어 둔 업무 순서를 다시 살펴보았습니다.', ['career', 'balanced'], {jobId: s.career.jobId});
    add('work:learn', '일하며 배운 것', '일하며 새로 알게 된 점을 잊지 않도록 적었습니다.', '전에 적어 둔 업무 메모를 꺼내 필요한 부분을 보탰습니다.', ['career'], {jobId: s.career.jobId});
  }
  add('learning:question', '남겨 둔 질문', '배우고 싶은 것에서 질문 하나를 골라 천천히 살펴보았습니다.', '지난번 남겨 둔 질문을 다시 읽고 자신의 말로 정리했습니다.', ['study', 'career']);
  add('learning:review', '배운 것을 돌아보며', '이미 배운 것 중 설명하기 어려운 부분을 다시 살펴보았습니다.', '전에 살펴본 내용을 다시 읽으며 이해가 남아 있는지 돌아보았습니다.', ['study', 'career']);
  add('rest:pace', '쉬어 갈 자리', context.healthLimited ? '몸의 불편을 살피며 활동 사이에 쉬는 시간을 두었습니다.' : '바쁜 일 사이에 잠깐 쉬어 갈 시간을 남겼습니다.', '지난번 정한 쉼의 간격을 돌아보며 하루의 속도를 조절했습니다.', ['health', 'balanced', 'family', 'social', 'hobby', 'rest']);
  add('rest:day', '하루의 여유', '하루를 돌아보며 무리했던 일과 편안했던 때를 적었습니다.', '전에 적어 둔 하루를 다시 보며 여유를 둘 곳을 찾았습니다.', ['health', 'balanced', 'family', 'social', 'hobby', 'rest']);

  const contextKey = JSON.stringify(context), active = previous?.lifeFacts.narrative;
  const continuation = active?.stage === 'start' && active.focus === s.focus && active.contextKey === contextKey
    && episodes.find(e => e.key === active.key && JSON.stringify(e.facts) === JSON.stringify(active.targets));
  const recent = s.history.filter(h => h.category === 'daily' && h.lifeFacts?.narrative?.domain === 'adult').slice(-8);
  const candidates = episodes.filter(e => e.focuses.includes(s.focus));
  const lastUsed = e => recent.findLast(h => h.lifeFacts.narrative.key === e.key)?.age ?? -1;
  const selected = continuation || candidates.toSorted((a, b) => lastUsed(a) - lastUsed(b))[0];
  const stage = continuation ? 'follow' : 'start';
  let lead = roleLine(s, context, prior);
  if (prior?.programId && !context.programId && s.education.history.some(e => e.age === s.age && e.result === 'graduated')) lead = '남겨 둔 공부를 마치고 다음 생활을 준비했습니다.';
  return { title: selected.title, text: `${lead} ${selected[stage]}`, context,
    facts: { domain: 'adult', key: selected.key, stage, focus: s.focus, contextKey,
      targets: selected.facts, ...(continuation ? {followupHistoryId: previous.id, followupOfAge: previous.age} : {}),
      source: 'rule', synthetic: true } };
}
