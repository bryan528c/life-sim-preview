// Authored fictional characters, not sampled census records or name statistics.
// City references establish place names only; selecting a city is a game rule.
const PROFILES = Object.freeze({
  KR: { female: ['서연', '지우', '하윤', '민서'], male: ['민준', '도윤', '서준', '지호'] },
  IN: { female: ['Anika', 'Meera', 'Kavya', 'Priya'], male: ['Arjun', 'Ravi', 'Ishaan', 'Dev'], city: '델리', url: 'https://delhi.gov.in/' },
  MY: { female: ['Aina', 'Mei Ling', 'Priya', 'Farah'], male: ['Amir', 'Wei Jian', 'Arun', 'Hakim'], city: '쿠알라룸푸르', url: 'https://www.dbkl.gov.my/' },
  NE: { female: ['Aïcha', 'Amina', 'Fati', 'Mariam'], male: ['Ibrahim', 'Moussa', 'Abdou', 'Amadou'], city: '니아메', url: 'https://villedeniamey.ne/' },
  JP: { female: ['Yui', 'Hana', 'Aoi', 'Sakura'], male: ['Haruto', 'Ren', 'Sota', 'Yuto'] },
  US: { female: ['Maya', 'Olivia', 'Emma', 'Sofia'], male: ['Noah', 'Liam', 'Lucas', 'Ethan'] },
  BR: { female: ['Ana', 'Julia', 'Beatriz', 'Mariana'], male: ['João', 'Pedro', 'Lucas', 'Rafael'] },
});
const GENERIC = Object.freeze(['Ari', 'Noa', 'Lina', 'Alex', 'Mika', 'Robin']);
const OCCUPATIONS = Object.freeze({
  urban: ['가게 판매원', '조리사', '수선 일을 하는 사람', '운송 종사자', '돌봄 종사자', '사무 직원'],
  rural: ['농업 종사자', '가게 판매원', '수선 일을 하는 사람', '운송 종사자', '돌봄 종사자', '조리사'],
});
const KEYS = new Set('version source countryId mode birthMonth cityLabel citySource settlement parents religion ethnicity siblings nameBasis'.split(' '));
const PARENT_KEYS = new Set(['personId', 'role', 'occupationLabel']);
const PARENT_V2_KEYS = new Set([...PARENT_KEYS, 'presentAtBirth']);
const index = (seed, salt, length) => {
  let n = seed >>> 0;
  for (const ch of salt) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n % length;
};
const select = (seed, salt, values) => values[index(seed, salt, values.length)];

export function authoredName(countryId, gender, seed, salt = 'name') {
  const profile = PROFILES[countryId];
  const pool = profile ? (gender === 'male' ? profile.male : gender === 'female' ? profile.female : [...profile.female, ...profile.male]) : GENERIC;
  return select(seed, salt, pool);
}

/** New births only. Existing saves and already-recorded names are never migrated. */
export function initializeBirthIdentity(state, { explicitName = false } = {}) {
  if (state.age !== 0 || state.flags.birthIdentity || state.history.length) return;
  const profile = PROFILES[state.birthCountryId];
  if (!explicitName) state.name = authoredName(state.birthCountryId, state.gender, state.seed, 'player');
  const city = state.mode === 'present' && state.birthYear === 2026 && state.city === 'urban' ? profile?.city ?? null : null;
  const parents = state.family.parents.map((parent, i) => {
    parent.name = authoredName(state.birthCountryId, i === 0 ? 'female' : 'male', state.seed, `parent:${i}`);
    // The observed reference shows birth absence, but supplies no probability
    // or reason. One of eight hash buckets is an explicit authored game rule,
    // independent of country, period, household and the gameplay RNG stream.
    const presentAtBirth = i !== 1 || index(state.seed, 'birth-father-presence', 8) !== 0;
    if (!presentAtBirth) {
      parent.absent = true;
      state.flags.absentParentId = parent.id;
    }
    return { personId: parent.id, role: i === 0 ? 'mother' : 'father', occupationLabel: select(state.seed, `occupation:${i}`, OCCUPATIONS[state.city]), presentAtBirth };
  });
  state.flags.birthIdentity = {
    version: 2, source: 'authored-fiction', countryId: state.birthCountryId, mode: state.mode,
    birthMonth: 1 + index(state.seed, 'birth-month', 12), cityLabel: city, citySource: city ? profile.url : null,
    settlement: state.city, parents, religion: null, ethnicity: null, siblings: index(state.seed, 'birth-older-siblings', 3),
    nameBasis: profile ? 'country-name-pool' : 'generic-fictional',
  };
}

export const getBirthIdentity = state => state.flags?.birthIdentity ?? null;
export const getPersonBirthContext = (state, personId) => getBirthIdentity(state)?.parents.find(p => p.personId === personId) ?? null;
export function getResidenceLabel(state) {
  const birth = getBirthIdentity(state);
  // Never turn a move back to the country into proof of a return to this city.
  const noMove = (state.flags?.residenceHistory?.length ?? 1) === 1;
  return birth?.cityLabel && noMove && state.countryId === birth.countryId && state.city === birth.settlement
    ? birth.cityLabel : state.city === 'urban' ? '도시' : '농촌';
}

export function validBirthIdentity(state) {
  const b = getBirthIdentity(state);
  if (b === null) return true;
  if (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !KEYS.has(k))) return false;
  if (![1, 2].includes(b.version) || b.source !== 'authored-fiction' || b.countryId !== state.birthCountryId || b.mode !== state.mode) return false;
  if (!Number.isInteger(b.birthMonth) || b.birthMonth < 1 || b.birthMonth > 12 || !['urban', 'rural'].includes(b.settlement)) return false;
  if (b.religion !== null || b.ethnicity !== null || !['country-name-pool', 'generic-fictional'].includes(b.nameBasis)) return false;
  if (b.version === 1 ? b.siblings !== null : !Number.isInteger(b.siblings) || b.siblings < 0 || b.siblings > 2) return false;
  const profile = PROFILES[b.countryId];
  if (b.cityLabel !== null && (b.cityLabel !== profile?.city || b.citySource !== profile.url || b.mode !== 'present' || state.birthYear !== 2026 || b.settlement !== 'urban')) return false;
  if (b.cityLabel === null && b.citySource !== null) return false;
  if (!Array.isArray(b.parents) || b.parents.length !== state.family.parents.length) return false;
  const ids = new Set();
  return b.parents.every(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !(b.version === 1 ? PARENT_KEYS : PARENT_V2_KEYS).has(k))) return false;
    if (ids.has(p.personId) || !state.family.parents.some(parent => parent.id === p.personId)) return false;
    ids.add(p.personId);
    // This is immutable birth context, not today's contact or survival state.
    // A later reunion must not rewrite it, and a later death must not reject it.
    return ['mother', 'father'].includes(p.role) && OCCUPATIONS[b.settlement].includes(p.occupationLabel)
      && (b.version === 1 || typeof p.presentAtBirth === 'boolean');
  });
}

export const IDENTITY_META = Object.freeze({
  version: 2, source: 'authored-fiction', nameCountries: Object.keys(PROFILES), cityCountries: ['IN', 'MY', 'NE'],
  birthFamily: Object.freeze({ source: 'authored-fiction', fatherAbsentBuckets: 1, totalBuckets: 8, olderSiblingCounts: Object.freeze([0, 1, 2]), referenceObservationVersion: 'v0.6.99 beta', referenceProbabilityKnown: false }),
  note: '가상 이름·출생 월·부모 직업·출생 가족은 자체 인물 설정입니다. 새 출생의 아버지 부재는 독립 해시 8구간 중 1구간, 위 형제자매 수는 별도 해시로 0~2명을 정하며 원작 확률·국가별 통계·문화 대표값이 아닙니다. 종교·민족은 미기록이고, 도시 지명만 지방정부 자료로 확인했습니다. 형제자매 수는 출생 당시 정보이며 개별 인물의 이후 생애를 뜻하지 않습니다.',
});
