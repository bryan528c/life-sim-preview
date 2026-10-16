// A record of an executed choice, not a new relationship rule or automatic contact.
// Existing histories without this evidence are never backfilled.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 250) => typeof value === 'string' && value.length > 0 && value.length <= max;
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const MEMORY_KEYS = ['version', 'kind', 'personId', 'personName', 'choiceId', 'outcome', 'sourceHistoryId', 'source', 'synthetic'];
const RECALL_KEYS = ['version', 'sourceHistoryId'];
const outcomes = ['contact-established', 'contact-declined', 'player-declined'];

export function parentReunionMemory(s, choiceId, historyId) {
  const parent = s.family.parents.find(person => person.id === s.flags.absentParentId);
  return { version: 1, kind: 'parent-reunion', personId: parent.id, personName: parent.name,
    choiceId, outcome: s.flags.reunionResult, sourceHistoryId: historyId, source: 'rule', synthetic: true };
}

export function parentReunionResult(memory) {
  if (memory.outcome === 'contact-established') return `${memory.personName}에게서 답이 왔고, 끊겼던 연락이 다시 이어졌습니다.`;
  if (memory.outcome === 'contact-declined') return `${memory.personName}에게서 지금은 연락을 이어 가고 싶지 않다는 답이 왔습니다.`;
  return `${memory.personName}에게 이번에는 연락하지 않기로 했습니다. 관계의 거리를 그대로 두었습니다.`;
}

export function parentReunionRecall(s) {
  const source = s.history.find(entry => entry.relationshipMemory?.kind === 'parent-reunion'
    && entry.age === s.age - 1 && entry.year === s.year - 1
    && !s.history.some(row => row.lifeFacts?.relationshipRecall?.sourceHistoryId === entry.id));
  if (!source) return null;
  const memory = source.relationshipMemory;
  const remembered = memory.outcome === 'contact-established'
    ? `${memory.personName}에게서 답을 받고 끊겼던 연락이 다시 이어졌던 일`
    : memory.outcome === 'contact-declined'
      ? `${memory.personName}에게서 당시에는 연락을 이어 가고 싶지 않다는 답을 받았던 일`
      : `${memory.personName}에게 연락하지 않기로 정했던 일`;
  return { text: `지난해 ${remembered}을 떠올렸습니다.`, reference: { version: 1, sourceHistoryId: source.id } };
}

export function validRelationshipMemories(s) {
  const sources = new Map(), counts = new Map();
  for (const entry of s.history) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  for (const [index, entry] of s.history.entries()) {
    const memory = entry.relationshipMemory;
    if (memory === undefined) continue;
    if (!exactKeys(memory, MEMORY_KEYS) || memory.version !== 1 || memory.kind !== 'parent-reunion'
      || !text(memory.personId) || !text(memory.personName, 500) || !text(memory.sourceHistoryId)
      || memory.source !== 'rule' || memory.synthetic !== true || !outcomes.includes(memory.outcome)
      || (memory.choiceId !== 'contact' && memory.choiceId !== 'boundary')
      || (memory.choiceId === 'boundary') !== (memory.outcome === 'player-declined')
      || entry.structure !== 'parent-reunion' || entry.category !== 'family' || entry.source !== 'rule'
      || memory.sourceHistoryId !== entry.id || counts.get(entry.id) !== 1
      || !Number.isInteger(entry.age) || entry.age < 35 || entry.age > 60 || entry.age > s.age
      || entry.year !== s.birthYear + entry.age
      || !s.family.parents.some(parent => parent.id === memory.personId)
      || s.flags.absentParentId !== memory.personId || s.flags.reunionResult !== memory.outcome
      || !s.seen.includes('parent-reunion')) return false;
    sources.set(entry.id, { entry, index });
  }
  // This existing story can execute only once per life.
  if (sources.size > 1) return false;
  const recalled = new Set();
  for (const [index, entry] of s.history.entries()) {
    const recall = entry.lifeFacts?.relationshipRecall;
    if (recall === undefined) continue;
    if (!exactKeys(recall, RECALL_KEYS) || recall.version !== 1 || !text(recall.sourceHistoryId)) return false;
    const source = sources.get(recall.sourceHistoryId);
    if (!source || source.index >= index || recalled.has(recall.sourceHistoryId)
      || counts.get(entry.id) !== 1 || entry.category !== 'daily'
      || !((entry.lifeFacts?.narrative?.domain === 'adult' && plain(entry.lifeFacts.adultContext))
        || (entry.lifeFacts?.yearEvent?.version === 1 && entry.lifeFacts.yearEvent.kind === 'activity' && entry.lifeFacts.yearEvent.stage === 'start' && entry.moment?.version === 1))
      || entry.age !== source.entry.age + 1 || entry.year !== source.entry.year + 1) return false;
    recalled.add(recall.sourceHistoryId);
  }
  return true;
}
