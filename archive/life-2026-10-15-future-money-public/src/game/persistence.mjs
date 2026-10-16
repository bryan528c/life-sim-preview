import { validateLife } from './engine.mjs';

// Only this application's namespace is accessed. A checksum detects accidental
// damage; it is not authentication, encryption, or an anti-cheat mechanism.
export const STORAGE_KEY = 'lifemap.baseline.v1';
const FORMAT = 'lifemap-session';
const SCHEMA_VERSION = 1;
const MAX_ENVELOPE_VERSION = 5;
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_NODES = 250000;
const MAX_ARRAY = 20000;
const MAX_STRING = 16000;
const LIFE_FIELDS = new Set(('schemaVersion lifeId version seed rng provenance name gender birthYear year age status countryId birthCountryId city household mode weighting stats focus education career finance family health hobbies politics migration automations settings pending seen flags history historyMarks timeline cohort notes goals receipts ending').split(' '));
const SESSION_FIELDS = new Set(['schemaVersion', 'revision', 'current', 'lives', 'archived', 'trash', 'preferences', 'experience']);
const PREFERENCE_FIELDS = new Set(['theme', 'locale', 'sound', 'volume', 'music', 'musicVolume', 'muted']);
const EXPERIENCE_FIELDS = new Set(['structures', 'countries']);
const LIFE_OBJECT_FIELDS = Object.fromEntries(Object.entries({
  provenance: 'source synthetic realAI',
  stats: 'health happiness knowledge social energy',
  education: 'level program field yearsLeft history',
  career: 'jobId title level years salary retired pension breakYears',
  finance: 'cash debt assets allocation home homeValue mortgage rentals business insurance diet socialBudget donation will scholarships annualIncome annualExpense tax',
  family: 'parents partners children friends relationship',
  health: 'conditions treatment disability addiction',
  politics: 'role term preparation',
  migration: 'status years pending',
  automations: 'certificate tutoring lessons checkup childTuition childMarriage dinner lastRun skipped',
  settings: 'auto speed comparisonCountry sensitive targetMinutes reflectionStops',
}).map(([field, allowed]) => [field, new Set(allowed.split(' '))]));

function problem(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function failure(error, extra = {}) {
  return { ok: false, code: typeof error?.code === 'string' ? error.code : 'STORAGE_UNAVAILABLE', error: error?.message || '저장소에 접근할 수 없습니다.', ...extra };
}

function record(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw problem('INVALID_DATA', `${name}: 일반 JSON 객체가 필요합니다.`);
  }
}

function keys(value, allowed, name) {
  record(value, name);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw problem('UNKNOWN_FIELD', `${name}: 지원하지 않는 필드 ${key}`);
  }
}

// Check before stringify as callers can supply cycles, accessors, NaN or class
// instances. JSON imports are checked again without merging into live objects.
function safeTree(value) {
  let nodes = 0;
  const ancestors = new Set();
  function visit(item, depth) {
    if (++nodes > MAX_NODES || depth > 32) throw problem('DATA_LIMIT', '저장 데이터의 깊이 또는 항목 수 한도를 넘었습니다. 기록은 삭제되지 않았습니다.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > MAX_STRING) throw problem('DATA_LIMIT', '저장 문자열이 너무 깁니다. 기록은 삭제되지 않았습니다.');
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw problem('INVALID_DATA', '유한한 숫자만 저장할 수 있습니다.');
      return;
    }
    if (typeof item !== 'object') throw problem('INVALID_DATA', '실행 코드나 JSON 외 자료는 저장할 수 없습니다.');
    if (ancestors.has(item)) throw problem('INVALID_DATA', '순환 참조는 저장할 수 없습니다.');
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (item.length > MAX_ARRAY) throw problem('DATA_LIMIT', '기록 배열 한도를 넘었습니다. 자동으로 잘라내지 않습니다.');
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !('value' in descriptor)) throw problem('INVALID_DATA', '희소 배열이나 접근자는 저장할 수 없습니다.');
        visit(descriptor.value, depth + 1);
      }
      if (Object.keys(item).length !== item.length) throw problem('INVALID_DATA', '배열의 추가 속성은 저장할 수 없습니다.');
    } else {
      record(item, '저장 항목');
      const fields = Object.getOwnPropertyNames(item);
      if (fields.length > 256 || Object.getOwnPropertySymbols(item).length) throw problem('DATA_LIMIT', '객체 필드 한도를 넘었습니다.');
      for (const field of fields) {
        if (['__proto__', 'prototype', 'constructor'].includes(field)) throw problem('UNSAFE_FIELD', '지원하지 않는 객체 속성입니다.');
        const descriptor = Object.getOwnPropertyDescriptor(item, field);
        if (!descriptor.enumerable || !('value' in descriptor)) throw problem('INVALID_DATA', '접근자나 숨겨진 속성은 저장할 수 없습니다.');
        if (field.length > 200) throw problem('DATA_LIMIT', '필드 이름이 너무 깁니다.');
        visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
  }
  visit(value, 0);
}

function checksum(text) {
  // FNV-1a over UTF-16 code units, explicitly non-security checksum.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function encode(value) {
  const text = JSON.stringify(value);
  if (text.length > MAX_TEXT) throw problem('DATA_LIMIT', '저장 파일이 8 MiB 문자 한도를 넘었습니다. 기존 기록을 보존했습니다.');
  return text;
}

function parse(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw problem('DATA_LIMIT', '가져올 파일이 없거나 크기 한도를 넘었습니다.');
  try { return JSON.parse(text); } catch { throw problem('INVALID_JSON', '올바른 JSON 저장 파일이 아닙니다.'); }
}

export function newSession() {
  return {
    schemaVersion: 1, revision: 0, current: null, lives: [], archived: [], trash: [],
    preferences: { theme: 'light', locale: 'ko', sound: false, volume: 0.2, music: false, musicVolume: 0.2, muted: false },
    experience: { structures: [], countries: [] },
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const sameLife = (first, second) => canonical(first) === canonical(second);

function checkLife(state) {
  keys(state, LIFE_FIELDS, '생애');
  if (state.schemaVersion > SCHEMA_VERSION) throw problem('FUTURE_VERSION', '더 최신 버전의 생애입니다. 원본을 보존했습니다.');
  for (const [field, allowed] of Object.entries(LIFE_OBJECT_FIELDS)) keys(state[field], allowed, `생애 ${field}`);
  if (state.settings.targetMinutes !== undefined && ![null, 30, 60, 90].includes(state.settings.targetMinutes)) throw problem('INVALID_DATA', '자동 진행 시간 설정은 없음·30분·60분·90분 중 하나여야 합니다.');
  try { validateLife(state); }
  catch (error) { throw problem('INVALID_DATA', `생애 데이터가 올바르지 않습니다. ${error.message}`); }
}

function validateSession(input) {
  safeTree(input);
  keys(input, SESSION_FIELDS, '세션');
  if (input.schemaVersion > SCHEMA_VERSION) throw problem('FUTURE_VERSION', '더 최신 버전에서 만든 저장입니다. 원본을 보존하고 읽기 전용으로 열었습니다.');
  if (input.schemaVersion !== SCHEMA_VERSION) throw problem('UNSUPPORTED_VERSION', '지원하지 않는 저장 버전입니다.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER) throw problem('INVALID_DATA', '저장 리비전이 올바르지 않습니다.');
  if (!Array.isArray(input.lives) || (input.archived !== undefined && !Array.isArray(input.archived)) || (input.trash !== undefined && !Array.isArray(input.trash))) throw problem('INVALID_DATA', '생애 기록 목록이 필요합니다.');
  const archived = input.archived ?? [];
  const trash = input.trash ?? [];
  if (input.lives.length + archived.length + trash.length > 500) throw problem('DATA_LIMIT', '휴지통을 포함한 생애 기록이 500개를 넘었습니다. 내보낸 파일과 기존 저장을 보존하고 개별 관리해 주세요.');
  keys(input.preferences, PREFERENCE_FIELDS, '환경 설정');
  const { theme, locale, sound, volume } = input.preferences;
  if (!['light', 'dark', 'system'].includes(theme) || !['ko', 'en'].includes(locale) || typeof sound !== 'boolean' || !Number.isFinite(volume) || volume < 0 || volume > 1) throw problem('INVALID_DATA', '환경 설정 값이 올바르지 않습니다.');
  for (const field of ['music', 'muted']) if (input.preferences[field] !== undefined && typeof input.preferences[field] !== 'boolean') throw problem('INVALID_DATA', '음악·음소거 설정은 켜기 또는 끄기여야 합니다.');
  if (input.preferences.musicVolume !== undefined && (!Number.isFinite(input.preferences.musicVolume) || input.preferences.musicVolume < 0 || input.preferences.musicVolume > 1)) throw problem('INVALID_DATA', '음악 음량은 0에서 1 사이여야 합니다.');
  keys(input.experience, EXPERIENCE_FIELDS, '경험 이력');
  for (const kind of EXPERIENCE_FIELDS) {
    const values = input.experience[kind];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.length > 200) || new Set(values).size !== values.length) throw problem('INVALID_DATA', '경험 이력에는 중복 없는 식별자 목록이 필요합니다.');
  }
  const identifiers = new Set();
  const ended = new Map();
  function life(state, group) {
    checkLife(state);
    if (identifiers.has(state.lifeId)) throw problem('DUPLICATE_LIFE', '생애 식별자가 중복되었습니다. 원본을 합치지 않았습니다.');
    if (group === 'lives' && state.status !== 'ended') throw problem('INVALID_DATA', '완료 기록에는 종료된 생애만 저장합니다.');
    identifiers.add(state.lifeId);
    if (group === 'lives') ended.set(state.lifeId, state);
  }
  for (const state of input.lives) life(state, 'lives');
  for (const state of archived) life(state, 'archived');
  for (const state of trash) life(state, 'trash');
  if (input.current !== null) {
    checkLife(input.current);
    if (identifiers.has(input.current.lifeId)) {
      const saved = ended.get(input.current.lifeId);
      if (input.current.status !== 'ended' || !saved || !sameLife(saved, input.current)) throw problem('DUPLICATE_LIFE', '현재 생애와 보관 기록이 충돌합니다.');
    }
    identifiers.add(input.current.lifeId);
  }
  if (identifiers.size > 500) throw problem('DATA_LIMIT', '현재 삶과 휴지통을 포함한 생애 기록이 500개를 넘었습니다. 기존 기록을 보존했습니다.');
  const result = JSON.parse(encode(input));
  result.archived = result.archived ?? [];
  result.trash = result.trash ?? [];
  result.preferences.music ??= false;
  result.preferences.musicVolume ??= 0.2;
  result.preferences.muted ??= false;
  return result;
}

function requestedIds(lifeIds) {
  if (!Array.isArray(lifeIds) || lifeIds.length === 0 || lifeIds.length > 500 || lifeIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 160)) throw problem('INVALID_LIFE_IDS', '옮길 생애 식별자를 선택해 주세요.');
  if (new Set(lifeIds).size !== lifeIds.length) throw problem('DUPLICATE_LIFE', '같은 생애를 두 번 선택할 수 없습니다.');
  return new Set(lifeIds);
}

/** Reversible, in-memory preparation only. The UI confirms, then saves once. */
export function moveLivesToTrash(input, lifeIds) {
  try {
    const candidate = validateSession(input);
    const ids = requestedIds(lifeIds);
    const active = new Map([...candidate.lives, ...candidate.archived, candidate.current].filter(Boolean).map(life => [life.lifeId, life]));
    for (const id of ids) {
      if (candidate.trash.some(life => life.lifeId === id)) throw problem('ALREADY_TRASHED', '이미 휴지통에 있는 생애입니다.');
      if (!active.has(id)) throw problem('LIFE_NOT_FOUND', '옮길 생애를 찾지 못했습니다. 기록은 변경하지 않았습니다.');
    }
    candidate.trash.push(...[...ids].map(id => active.get(id)));
    candidate.lives = candidate.lives.filter(life => !ids.has(life.lifeId));
    candidate.archived = candidate.archived.filter(life => !ids.has(life.lifeId));
    if (candidate.current && ids.has(candidate.current.lifeId)) candidate.current = null;
    return { ok: true, session: validateSession(candidate) };
  } catch (error) { return failure(error); }
}

export function moveLifeToTrash(input, lifeId) {
  return moveLivesToTrash(input, [lifeId]);
}

/** Restoring never replaces a different current life or edits its state. */
export function restoreLifeFromTrash(input, lifeId) {
  try {
    const candidate = validateSession(input);
    requestedIds([lifeId]);
    const life = candidate.trash.find(item => item.lifeId === lifeId);
    if (!life) throw problem('LIFE_NOT_FOUND', '휴지통에서 복원할 생애를 찾지 못했습니다.');
    candidate.trash = candidate.trash.filter(item => item.lifeId !== lifeId);
    if (candidate.current === null) candidate.current = life;
    if (life.status === 'ended') candidate.lives.push(structuredClone(life));
    else if (candidate.current.lifeId !== lifeId) candidate.archived.push(life);
    return { ok: true, session: validateSession(candidate) };
  } catch (error) { return failure(error); }
}

/** Keep all records. Active/trash conflicts require an explicit user decision. */
export function mergeSessions(existing, incoming) {
  try {
    const target = validateSession(existing);
    const source = validateSession(incoming);
    const active = new Map(), trashed = new Map();
    function add(map, life) {
      const previous = map.get(life.lifeId);
      if (previous && !sameLife(previous, life)) throw problem('LIFE_VERSION_CONFLICT', `같은 삶의 다른 버전이 있습니다 (${life.name}). 기존 기록을 덮어쓰지 않았습니다.`);
      if (!previous) map.set(life.lifeId, life);
    }
    for (const part of [target, source]) {
      for (const life of [...part.lives, ...part.archived, part.current].filter(Boolean)) add(active, life);
      for (const life of part.trash) add(trashed, life);
    }
    if ([...trashed.keys()].some(id => active.has(id))) throw problem('TRASH_CONFLICT', '같은 생애가 한 파일에서는 휴지통에, 다른 파일에서는 생애 서재에 있습니다. 복원 여부를 먼저 결정한 뒤 다시 가져와 주세요.');
    const merged = target;
    merged.current = source.current ?? target.current;
    merged.lives = [...active.values()].filter(life => life.status === 'ended');
    merged.archived = [...active.values()].filter(life => life.status === 'alive' && life.lifeId !== merged.current?.lifeId);
    merged.trash = [...trashed.values()];
    for (const kind of EXPERIENCE_FIELDS) merged.experience[kind] = [...new Set([...target.experience[kind], ...source.experience[kind]])];
    return { ok: true, session: validateSession(merged) };
  } catch (error) { return failure(error); }
}

function wrap(session) {
  const payload = encode(session);
  // Future-reader guards prevent old bundles from recovering over new focus
  // states or manual marks. Untouched legacy lives retain their old envelope.
  const lives = [session.current, ...session.lives, ...(session.archived ?? []), ...(session.trash ?? [])].filter(Boolean);
  const hasCareerInterest = lives.some(life=>life.flags.careerInterests!==undefined||life.pending?.structure?.startsWith('career-interest:'));
  const hasSchoolWork = lives.some(life=>life.flags.schoolWorkPolicyVersion===1||life.pending?.structure==='school-entry:secondary'||life.pending?.structure?.startsWith('early-career:')||life.career.jobId==='domestic'||(life.age<18&&life.career.jobId));
  const hasMarks = lives.some(life => Object.hasOwn(life, 'historyMarks'));
  return encode({ format: FORMAT, version: hasCareerInterest ? 5 : hasSchoolWork ? 4 : lives.some(life => life.flags.focusPolicyVersion === 1 || life.focus === 'rest' || life.flags.schoolAttendance === 'stopped') ? 3 : hasMarks ? 2 : 1, checksumAlgorithm: 'fnv1a-32-utf16-nonsecurity', checksum: checksum(payload), payload });
}

function unwrap(text) {
  const envelope = parse(text);
  record(envelope, '저장 봉투');
  // Inspect versions before shape/checksum checks so newer data is never
  // mistaken for corruption and overwritten with an older backup.
  if (envelope.version > MAX_ENVELOPE_VERSION) throw problem('FUTURE_VERSION', '더 최신 저장 버전입니다. 이 버전에서는 덮어쓰지 않습니다.');
  keys(envelope, new Set(['format', 'version', 'checksumAlgorithm', 'checksum', 'payload']), '저장 봉투');
  if (envelope.format !== FORMAT || ![1, 2, 3, 4, 5].includes(envelope.version) || envelope.checksumAlgorithm !== 'fnv1a-32-utf16-nonsecurity' || typeof envelope.payload !== 'string') throw problem('UNSUPPORTED_VERSION', '지원하지 않는 저장 형식입니다.');
  if (checksum(envelope.payload) !== envelope.checksum) throw problem('CHECKSUM_MISMATCH', '저장 내용의 체크섬이 일치하지 않습니다.');
  return validateSession(parse(envelope.payload));
}

function future(raw) {
  if (raw === null) return false;
  try {
    const value = parse(raw);
    if (value?.version > MAX_ENVELOPE_VERSION) return true;
    if (typeof value?.payload !== 'string') return false;
    const session = parse(value.payload);
    return session?.schemaVersion > SCHEMA_VERSION || session?.current?.schemaVersion > SCHEMA_VERSION ||
      [session?.lives, session?.archived, session?.trash].some(list => Array.isArray(list) && list.some(life => life?.schemaVersion > SCHEMA_VERSION));
  } catch { return false; }
}

export function createRepository(storage, { key = STORAGE_KEY } = {}) {
  if (typeof key !== 'string' || !/^lifemap\.baseline\.v1(?:[.:-][A-Za-z0-9_-]{1,64})?$/.test(key)) throw problem('INVALID_KEY', '이 게임의 전용 저장 이름만 사용할 수 있습니다.');
  const backupKey = `${key}.backup`;
  const stagingKey = `${key}.staging`;

  function read() {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw problem('STORAGE_UNAVAILABLE', '브라우저 저장소를 사용할 수 없습니다. 내보내기로 기록을 보관할 수 있습니다.');
    const raw = storage.getItem(key);
    const backup = storage.getItem(backupKey);
    if (future(raw) || future(backup)) throw problem('FUTURE_VERSION', '더 최신 버전의 저장이 있습니다. 모든 저장 원본을 보존하며 덮어쓰기를 막았습니다.');
    if (raw === null && backup === null) return { session: newSession(), raw, backup, source: null, recovered: false };
    let currentError;
    if (raw !== null) {
      try { return { session: unwrap(raw), raw, backup, source: raw, recovered: false }; }
      catch (error) { currentError = error; }
    }
    if (backup !== null) {
      try { return { session: unwrap(backup), raw, backup, source: backup, recovered: true }; }
      catch (error) { currentError ??= error; }
    }
    throw problem('NO_VALID_SAVE', `저장을 읽을 수 없습니다. 원본은 변경하지 않았습니다. ${currentError?.message || ''}`.trim());
  }

  function load() {
    try {
      const result = read();
      return { ok: true, session: result.session, recovered: result.recovered,
        ...(result.recovered ? { warning: '최신 저장을 읽지 못해 이전 저장으로 복구했습니다. 최근 한 번의 변경은 없을 수 있습니다.' } : {}) };
    } catch (error) { return failure(error, { session: newSession(), readOnly: true }); }
  }

  function writeVerified(storageKey, value) {
    storage.setItem(storageKey, value);
    if (storage.getItem(storageKey) !== value) throw problem('WRITE_VERIFY_FAILED', '저장 후 읽기 검증에 실패했습니다. 이전 정상 저장을 보존했습니다.');
  }

  function save(input) {
    try {
      const candidate = validateSession(input);
      const previous = read();
      if (candidate.revision !== previous.session.revision) throw problem('REVISION_CONFLICT', '다른 탭에서 저장이 바뀌었습니다. 현재 입력을 보존하고 최신 저장을 다시 불러오세요.');
      candidate.revision += 1;
      const encoded = wrap(candidate);
      // Stage and verify before touching either committed generation. localStorage
      // setItem is atomic on quota failure. No input object is changed on failure.
      writeVerified(stagingKey, encoded);
      const beforeCommit = storage.getItem(key);
      if (beforeCommit !== previous.raw || storage.getItem(backupKey) !== previous.backup) throw problem('REVISION_CONFLICT', '저장 중 다른 탭의 변경을 발견했습니다. 최신 저장을 다시 불러오세요.');
      if (previous.source !== null && previous.source !== previous.backup) writeVerified(backupKey, previous.source);
      // A final optimistic comparison catches stale writers; localStorage itself
      // has no cross-process compare-and-swap. UI should serialize its own writes.
      if (storage.getItem(key) !== previous.raw) throw problem('REVISION_CONFLICT', '저장 직전 다른 탭의 변경을 발견했습니다.');
      writeVerified(key, encoded);
      try { storage.removeItem?.(stagingKey); } catch { /* Non-committed staging data is ignored on load. */ }
      return { ok: true, session: candidate };
    } catch (error) {
      const quota = error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
      const denied = ['SecurityError', 'InvalidStateError'].includes(error?.name);
      const normalized = quota ? problem('QUOTA_EXCEEDED', '브라우저 저장 공간이 부족합니다. 이번 변경을 확정하지 않았으며 이전 기록을 보존했습니다. 내보내기로 백업해 주세요.') :
        denied ? problem('STORAGE_UNAVAILABLE', '브라우저가 저장소 접근을 막았습니다. 읽기 전용으로 유지하며 기존 저장을 변경하지 않습니다.') : error;
      return failure(normalized,
        ['FUTURE_VERSION', 'NO_VALID_SAVE', 'STORAGE_UNAVAILABLE'].includes(normalized?.code) ? { readOnly: true } : {});
    }
  }

  return Object.freeze({
    load,
    save,
    export(session) { return wrap(validateSession(session)); },
    import(text) {
      try { return { ok: true, session: unwrap(text) }; }
      catch (error) { return failure(error); }
    },
  });
}
