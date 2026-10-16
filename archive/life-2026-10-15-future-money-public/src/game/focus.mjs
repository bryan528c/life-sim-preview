import { log } from './shared.mjs';

// Availability is an authored state contract. This is not the source game's
// automatic weighting algorithm, nor a reconstruction of its hidden effects.
export const FOCUS_IDS = Object.freeze(['balanced','study','career','family','health','hobby','social','rest']);
const LABELS = {balanced:'균형',study:'배움',career:'일에 몰두',family:'가족·친구',health:'건강 관리',hobby:'취미',social:'친구·놀이',rest:'휴식'};
export function attendingSchool(s) {
  if (s.flags.prisonYears > 0 || s.flags.serviceYears > 0) return false;
  if (s.education.program) return !s.flags.educationOnLeave && !s.flags.educationPaused;
  return s.age >= 6 && s.age < 18 && s.education.level !== 'none' && s.flags.schoolAttendance !== 'stopped' && !s.career.jobId;
}
export function focusStage(s) {
  if (s.age < 6) return 'early-childhood';
  if (s.career.jobId && !s.career.retired && !s.flags.careBreak && !(s.flags.prisonYears > 0) && !(s.flags.serviceYears > 0)) return 'working';
  if (attendingSchool(s)) return 'school';
  if (s.age < 15) return 'out-of-school-child';
  return 'outside-work';
}
export function focusStageLabel(s) {
  const stage = focusStage(s);
  return stage === 'early-childhood' ? '돌봄을 받는 어린 시기' : stage === 'working' ? s.career.title : stage === 'school' ? (s.education.program?.label ?? '학교에서 배우는 중') : stage === 'out-of-school-child' ? '학교 밖에서 생활하는 중' : s.flags.careBreak ? '가족 돌봄' : s.career.retired ? '은퇴 후 생활' : s.flags.educationOnLeave ? '휴학 중' : s.flags.educationPaused ? '수강 보류 중' : s.flags.serviceYears > 0 ? '기간 복무 중' : s.flags.prisonYears > 0 ? '수감 중' : '일과 다음 생활을 준비하는 중';
}
export function focusOptions(s) {
  const stage = focusStage(s), child = s.age < 15;
  const ids = stage === 'early-childhood' ? [] : stage === 'school' ? ['study','social','family','health','hobby'] : stage === 'out-of-school-child' ? ['family','social','health','hobby'] : stage === 'working' ? ['career','balanced','family','health','study','hobby'] : ['family','health','study','hobby','rest'];
  const effects = {study:'지식↑',career:'직무 능력↑ 지식↑',balanced:'지식↑ 행복↑',family:s.family.children.some(child=>child.alive)?'행복↑ 자녀와의 관계↑':'행복↑',health:'건강↑ 활력↑',hobby:s.hobbies.length?'취미 실력↑ 행복↑':'지식↑ 행복↑',social:'관계↑',rest:'건강↑ 행복↑ 활력↑'};
  return ids.map(id => [id, id === 'study' ? (stage === 'school' ? '공부' : '자기계발') : id === 'family' && child ? '집안 돕기' : id === 'health' && child ? '운동' : LABELS[id], effects[id]]);
}
export function focusLabel(s, id = s.focus) {
  return focusOptions(s).find(option => option[0] === id)?.[1] ?? LABELS[id] ?? '미기록';
}
export function focusAvailable(s, id) {
  // Pre-school commands from existing saves keep their earlier compatibility;
  // the UI begins selection at six. No read operation rewrites that preference.
  return FOCUS_IDS.includes(id) && (s.age < 6 || focusOptions(s).some(option => option[0] === id));
}
export function recordManualFocus(s, id) {
  s.focus = id;
  s.flags.focusPolicyVersion = 1;
  s.flags.focusSelection = { source:'manual', age:s.age, value:id };
}
export function reconcileFocus(s) {
  if (s.status !== 'alive' || focusAvailable(s, s.focus)) return false;
  const from = s.focus;
  s.focus = 'family'; // Explicit local fallback; never a guessed weighted draw.
  s.flags.focusPolicyVersion = 1;
  s.flags.focusSelection = { source:'rule', age:s.age, value:'family', from, reason:'unavailable-in-stage', stage:focusStage(s) };
  log(s,'life','생활에 맞춰 바뀐 초점',`${focusStageLabel(s)}에는 ‘${from === 'study' && s.age < 15 ? '공부' : LABELS[from]}’을 선택할 수 없어 ‘${focusLabel(s)}’로 옮겼습니다. 지금 가능한 초점으로 다시 고를 수 있습니다.`, 'focus-stage-change');
  return true;
}
