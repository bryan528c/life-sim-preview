import { createLife, transition, getAvailableActions } from '../src/game/engine.mjs';
import { COUNTRIES } from '../src/game/world.mjs';
import {actionCommandFromForm} from './action-form.mjs';
import { referenceDistribution } from '../src/game/demographics.mjs';
import {createBirthSequence,renderBirthSelection,createBirthCardCanvas,birthCardText} from './birth-presentation.mjs';
import { createPlaybackClock, playbackStage, shouldStopPlayback } from './playback-clock.mjs';
import {birthOptionsFromForm,birthSetupContext} from './birth-setup.mjs';
import { STORAGE_KEY, createRepository, newSession, moveLivesToTrash, restoreLifeFromTrash, mergeSessions } from '../src/game/persistence.mjs';
import { escape, amount, countryName, birthComparison, renderBirthDistribution, yearDurationMs, renderStart, renderLife, renderBirthCertificate, renderSystemsDialog, renderJournalDialog, renderRecords, renderSettings, renderHelp, dialogShell, tr } from './views.mjs';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const dialogContent = document.querySelector('#dialog-content');
const errorBanner = document.querySelector('#error-banner');
const fileInput = document.querySelector('#import-file');
const SAVE_KEY = STORAGE_KEY;
let storage = null;
try { storage = window.localStorage; } catch { /* Repository reports unavailable storage without discarding it. */ }
const repository = createRepository(storage,{key:SAVE_KEY});
let loaded = repository.load();
let session = loaded.session ?? newSession();
let readOnly = !loaded.ok || Boolean(loaded.readOnly);
let saveError = loaded.ok ? '' : loaded.error || '저장을 읽지 못했습니다. 원본을 덮어쓰지 않도록 읽기 전용으로 열었습니다.';
let saveWarning = loaded.recovered ? loaded.warning || '이전 저장 세대에서 복구했습니다. 다음 저장부터 복구된 내용을 사용합니다.' : '';
if (!navigator.locks?.request) saveWarning += `${saveWarning ? ' ' : ''}이 브라우저는 탭 간 저장 잠금을 지원하지 않습니다. 게임은 한 탭에서만 열어 주세요.`;
let busy = false, viewing = null, showStart = !session.current, tab = 'education', journal = 'chronicle';
let minimized = false, historyFilter = '', historyLimit = 24, mapAge = null, graphAge = null;
let playing = false, pauseReason = session.current?.status==='alive'?'reloaded':'initial', timer = null, toastTimer = null, lastIntent = '', lastIntentAt = 0, dialogKind = '';
let pendingImport = null, pendingResume = null, beforeDialogFocus = null, beforeDialogAction = '', audioContext = null;
let settingsFocusId = '';
let birthCertificate=false,moreOpen=false,importPicking=false;
let birthReveal=null,birthRevealTimer=null,birthCardCanvas=null,birthCardOpening=false;
let focusPickerOpen=false;
const playbackClock = createPlaybackClock();
let pendingDeletion = [], selectedRecords = new Set(), recordsTrash = false, lastMainFocus = null, nextFocusId = '';
let audioUnlocked = false, musicTimer = null, musicBus = null, musicStep = 0, musicState = 'off', announcementTimer = null;
const musicVoices = new Set();
const drafts = new Map();
const panels = {systems:false,focus:false,routines:false,plan:false,journal:false,overview:false,startadvanced:false,financeLifestyle:false,financeAll:false};
const clone = value => structuredClone(value);
const activeLife = () => viewing || session.current;
const isMilestoneReflection=life=>life?.pending?.kind==='reflection'&&life.pending.structure?.startsWith('milestone-reflection:');
const uiBlocked = () => busy || readOnly || Boolean(viewing);
function reflectionCommand(options={}) {
  const text=document.querySelector('#reflection-form [name="text"]')?.value??new Map(drafts.get('reflection-form')??[]).get('text')??'';
  return {type:'reflect',decisionId:session.current.pending.id,text:String(text).trim(),...options};
}

function announce(message) {
  clearTimeout(announcementTimer);
  const node = document.querySelector('#announcement'); node.textContent = '';
  announcementTimer = setTimeout(() => { node.textContent = message; }, 50);
}
function focusIdentity(node) {
  if (!node || (!main.contains(node)&&!dialogContent.contains(node))) return null;
  if (node.id) return { id: node.id, selection: node.selectionStart };
  for (const key of ['ui','command','choice','focus','goalStep','goalCancel','mapAge','graphDelta','editNote','historyOpen','historyMark']) {
    if (node.dataset?.[key] !== undefined) return { key, value: node.dataset[key] };
  }
  const form = node.closest('form');
  if (form) return { formId: form.id, action: form.dataset.actionForm, name: node.name, tag: node.tagName, type: node.type };
  return null;
}
function focusElement(identity) {
  if (!identity) return null;
  if (identity.id) return document.getElementById(identity.id);
  if (identity.key) return [...main.querySelectorAll('button,input,select,textarea')].find(node => node.dataset?.[identity.key] === identity.value);
  const form = identity.formId ? document.getElementById(identity.formId) : [...document.querySelectorAll('#main form,#dialog form')].find(node => node.dataset.actionForm === identity.action);
  return form && [...form.elements].find(node => node.name === identity.name && node.tagName === identity.tag && node.type === identity.type);
}
function updateMusicStatus() {
  document.documentElement.dataset.musicState = musicState;
  const label = ({off:'배경음악 꺼짐',playing:'배경음악 재생 중',muted:'모든 소리 음소거',hidden:'다른 탭으로 이동하여 음악 일시 정지',gesture:'음악을 켠 상태입니다. 화면을 누르거나 키보드를 조작하면 시작합니다.',unavailable:'이 브라우저에서 오디오를 시작하지 못했습니다.'})[musicState];
  for (const node of document.querySelectorAll('[data-music-status]')) node.textContent = label;
}
function ensureAudio() {
  if (!audioUnlocked) return false;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    musicBus ||= audioContext.createGain();
    if (!musicBus._connected) { musicBus.connect(audioContext.destination); musicBus._connected = true; }
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => { musicState = 'unavailable'; updateMusicStatus(); });
    return true;
  } catch { musicState = 'unavailable'; updateMusicStatus(); return false; }
}
function stopMusic() {
  clearTimeout(musicTimer); musicTimer = null;
  for (const voice of musicVoices) { try { voice.stop(); } catch { /* Already ended. */ } }
  musicVoices.clear();
}
function scheduleMusic() {
  if (!session.preferences.music || session.preferences.muted || document.hidden || !audioUnlocked) return;
  if (!ensureAudio()) return;
  musicBus.gain.setTargetAtTime(Number(session.preferences.musicVolume ?? .2), audioContext.currentTime, .08);
  // Original procedural harmony. No recorded samples, downloaded assets, or network calls.
  const chords = [[196,246.94,293.66],[174.61,220,261.63],[164.81,196,246.94],[146.83,196,220]];
  const chord = chords[musicStep++ % chords.length], start = audioContext.currentTime + .02;
  chord.forEach((frequency,index) => {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + index * .13);
    gain.gain.linearRampToValueAtTime(.035, start + .8 + index * .13);
    gain.gain.exponentialRampToValueAtTime(.0001, start + 4.9);
    oscillator.connect(gain); gain.connect(musicBus); musicVoices.add(oscillator);
    oscillator.onended = () => { musicVoices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start + index * .13); oscillator.stop(start + 5);
  });
  musicState = 'playing'; updateMusicStatus();
  musicTimer = setTimeout(scheduleMusic, 4000);
}
function syncAudio() {
  const preferences = session.preferences;
  if (document.hidden || preferences.muted || !preferences.music || !audioUnlocked) {
    stopMusic(); musicState = document.hidden && preferences.music ? 'hidden' : preferences.muted ? 'muted' : !preferences.music ? 'off' : 'gesture';
    if (document.hidden) void audioContext?.suspend?.();
    updateMusicStatus(); return;
  }
  if (!ensureAudio()) return;
  musicBus.gain.setTargetAtTime(Number(preferences.musicVolume ?? .2), audioContext.currentTime, .08);
  if (!musicTimer) scheduleMusic();
}
function unlockAudio(event) {
  if (!event.isTrusted || document.hidden) return;
  audioUnlocked = true;
  if (session.preferences.music) syncAudio();
}

function toast(message, error = false) {
  const floating = document.querySelector('#toast');
  const inline = document.querySelector('#dialog-notice');
  const node = (dialog.open && inline) || document.querySelector('#play-notice') || floating;
  if (node !== floating) floating.hidden = true;
  node.textContent = message;
  node.classList.toggle('error', error);
  node.setAttribute('aria-live', error ? 'assertive' : 'polite');
  node.setAttribute('role', error ? 'alert' : 'status');
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (node !== inline) node.hidden = true; }, error ? 6500 : 3300);
}
function beep() {
  if (!session.preferences.sound || session.preferences.muted || document.hidden || !audioUnlocked) return;
  try {
    if (!ensureAudio()) return;
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, audioContext.currentTime + .07);
    gain.gain.setValueAtTime(0, audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(Math.min(.15, session.preferences.volume * .15), audioContext.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .15);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .16);
  } catch { toast('이 브라우저에서는 소리를 재생하지 못했습니다. 게임은 계속할 수 있습니다.'); }
}
function captureDrafts() {
  moreOpen=document.querySelector('#life-more')?.open??moreOpen;
  for(const detail of document.querySelectorAll('details[data-panel]'))panels[detail.dataset.panel]=detail.open;
  for (const form of document.querySelectorAll('#main form,#dialog form')) {
    const key = form.id || `action:${form.dataset.actionForm}`;
    const checkboxes=[...form.querySelectorAll('input[type=checkbox][name]')],names=new Set(checkboxes.map(input=>input.name));
    drafts.set(key,[...[...new FormData(form).entries()].filter(([name])=>!names.has(name)),...checkboxes.map(input=>[input.name,input.checked])]);
    if(form.id==='birth-form'&&form.elements.birthYear?.disabled)drafts.get(key).push(['birthYear',form.elements.birthYear.value]);
  }
}
function restoreDrafts() {
  for (const form of document.querySelectorAll('#main form,#dialog form')) {
    const key = form.id || `action:${form.dataset.actionForm}`;
    for (const [name, value] of drafts.get(key) || []) {
      const element = form.elements.namedItem(name);
      // A sole successor is shown from the current roster, not a stale form draft.
      if(form.dataset.actionForm==='business_succession'&&name==='targetId'&&element?.type==='hidden')continue;
      if(element?.type==='checkbox')element.checked=Boolean(value);
      else if (element && 'value' in element) element.value = value;
    }
  }
}
function refreshBirthForm({announceChange=false}={}) {
  const form=document.querySelector('#birth-form');if(!form)return;
  const mode=form.elements.mode.value,basis=form.elements.demographicBasis,weighting=form.elements.weighting.value;
  const yearInput=form.elements.birthYear;
  yearInput.disabled=mode!=='past';yearInput.required=mode==='past';
  document.querySelector('#birth-year-field').hidden=mode!=='past';
  const referenceOption=[...basis.options].find(option=>option.value==='reference-2023');referenceOption.disabled=mode!=='present';
  if(mode!=='present'&&basis.value==='reference-2023'){basis.value='synthetic';if(announceChange)announce('과거·미래·시대 무작위 모드에서는 합성 게임 분포를 사용합니다.');}
  const context=birthSetupContext({mode,birthYear:yearInput.value,weighting,basis:basis.value});
  document.querySelector('#birth-era-hint').textContent=context.eraHint;
  document.querySelector('#birth-weighting-hint').textContent=context.weightingHint;
  for(const [i,value] of ['birth','population'].entries())form.querySelector(`input[name="weighting"][value="${value}"]`).nextElementSibling.textContent=context.labels[i];
  const reference=basis.value==='reference-2023',rows=reference?referenceDistribution(COUNTRIES,weighting):[],supported=new Set(rows.map(row=>row.countryId));
  const country=form.elements.countryId;
  for(const option of country.options)option.disabled=reference&&option.value!=='random'&&!supported.has(option.value);
  const unavailable=reference&&country.value!=='random'&&!supported.has(country.value);
  country.setCustomValidity(unavailable?'선택한 국가에는 이 공개 자료가 없습니다. 합성 분포 또는 자료가 있는 국가를 선택해 주세요.':'');
  form.querySelector('[type=submit]').disabled=busy||readOnly||unavailable;
  document.querySelector('#birth-data-info').textContent=reference?`2023 WDI 공개 자료 · ${rows.length}/${COUNTRIES.length}개 국가·지역. 누락 ${COUNTRIES.length-rows.length}개는 제외합니다. ${weighting==='birth'?'인구 × 조출생률 ÷ 1,000으로 추정한 출생 가중치이며 직접 관측 출생수가 아닙니다.':'공개 인구수를 추첨 가중치로 사용합니다.'} 생활·건강·소득·사건은 합성 규칙입니다.`:`합성 게임 분포입니다. ${mode==='present'?'현재 모드에서는 2023 공개 추첨 자료를 선택할 수 있습니다.':'과거·미래·시대 무작위에는 합성 분포를 사용하며 2023 자료를 역사·예측으로 사용하지 않습니다.'} 생활·사건 확률도 합성 규칙입니다.`;
  const row=rows.find(item=>item.countryId===country.value);
  document.querySelector('#birth-country-info').textContent=unavailable?'선택한 국가의 공개 자료가 없어 시작할 수 없습니다. 합성 분포 또는 다른 국가를 선택해 주세요.':row?`${countryName(country.value)}의 공개 자료 추첨 비중 ${(row.share*100).toLocaleString('ko-KR',{maximumFractionDigits:4})}%. 국가를 직접 고르면 추첨 없이 그곳에서 시작합니다.`:'국가명은 실제 지명입니다. 가중 추첨을 선택하면 정해진 자료 분포로 출생 국가를 고릅니다.';
  document.querySelector('#birth-distribution').innerHTML=renderBirthDistribution({mode,birthYear:yearInput.value,weighting,basis:basis.value,countryId:country.value});
  document.querySelector('#birth-comparison').innerHTML=birthComparison(country.value,form.elements.comparisonCountry.value,basis.value,{mode,birthYear:context.year??undefined,gender:form.elements.gender?.value});
}

function viewModel(){return {busy,readOnly,viewing:Boolean(viewing),tab,journal,minimized,historyFilter,historyLimit,mapAge,graphAge,playing,pauseReason,panels,moreOpen,focusPickerOpen};}
function openSystems(group){tab=group;panels.systems=true;openDialog(renderSystemsDialog(activeLife(),session,viewModel()),'systems');}
function openJournal(section){journal=section;openDialog(renderJournalDialog(activeLife(),viewModel()),'journal');}
function syncDynamicDialog(vm){
 if(!dialog.open||!['systems','journal'].includes(dialogKind)||!activeLife())return;
 const focus=focusIdentity(document.activeElement),scroll=dialog.scrollTop;
 dialogContent.innerHTML=dialogKind==='systems'?renderSystemsDialog(activeLife(),session,vm):renderJournalDialog(activeLife(),vm);
 restoreDrafts();dialog.scrollTop=scroll;const node=focusElement(focus);if(node&&!node.disabled)node.focus({preventScroll:true});
}

function syncSettingsDialog() {
  if(!dialog.open || dialogKind!=='settings')return;
  const active=document.activeElement;
  if(dialogContent.contains(active)&&active?.id)settingsFocusId=active.id;
  const fieldset=dialogContent.querySelector('.settings-fieldset');
  if(fieldset)fieldset.disabled=busy||readOnly;
  for(const input of dialogContent.querySelectorAll('[data-preference],[data-setting]')) {
    const value=input.dataset.preference?session.preferences[input.dataset.preference]:session.current?.settings[input.dataset.setting];
    if(input.type==='checkbox')input.checked=Boolean(value);
    else input.value=value??'';
    if(input.type==='range')input.setAttribute('aria-valuetext',Math.round(Number(value??0)*100)+'%');
  }
  if(!busy&&!readOnly&&settingsFocusId){const input=document.getElementById(settingsFocusId);if(input&&dialogContent.contains(input)&&!input.disabled)input.focus({preventScroll:true});settingsFocusId='';}
}
function render({ capture = true } = {}) {
  if (capture) captureDrafts();
  if(showStart||birthCertificate||viewing||!session.current||session.current.status!=='alive'||session.current.age<6||(session.current.pending&&!minimized))focusPickerOpen=false;
  const activeElement=document.activeElement;
  const focus = focusIdentity(activeElement) || (activeElement===document.body||activeElement===main?lastMainFocus:null);
  if (focus) lastMainFocus = focus;
  document.documentElement.dataset.theme = session.preferences.theme;
  document.documentElement.lang = 'ko'; // English currently covers navigation labels; game narratives remain Korean.
  document.body.classList.toggle('ui-busy', busy);
  main.setAttribute('aria-busy', String(busy));
  const vm = { busy, readOnly, viewing: Boolean(viewing), tab, journal, minimized, historyFilter, historyLimit, mapAge, graphAge, playing, pauseReason, panels, moreOpen,focusPickerOpen };
  // Keep the notice and its expiry timer through the final save render.
  const playNotice = document.getElementById('play-notice');
  main.innerHTML = birthReveal ? renderBirthSelection(birthReveal.sequence,birthReveal.index) : showStart || !activeLife() ? renderStart(session, vm) : birthCertificate ? renderBirthCertificate(activeLife(),session,vm) : renderLife(activeLife(), session, vm);
  if (playNotice) document.getElementById('play-notice')?.replaceWith(playNotice);
  restoreDrafts();
  refreshBirthForm();
  if (!dialog.open && (focus || nextFocusId)) {
    let next = nextFocusId && !busy ? document.getElementById(nextFocusId) : focusElement(focus);
    if(!busy && (!next || next.disabled) && (focus?.action||focus?.formId)) next = document.getElementById('system-title');
    if (next && !next.disabled) {
      next.focus({ preventScroll: true });
      if (typeof focus?.selection === 'number' && typeof next.setSelectionRange === 'function' && ['text','search','textarea'].includes(next.type)) {
        try { next.setSelectionRange(focus.selection, focus.selection); } catch { /* A select does not have a text cursor. */ }
      }
    }
    if (!busy) nextFocusId = '';
  }
  document.querySelector('#record-count').textContent = session.lives.length;
  document.querySelector('#save-status').textContent = busy ? '저장 중…' : readOnly ? '읽기 전용' : `브라우저에 보관 · r${session.revision}`;
  const mute = document.querySelector('#mute-button');
  mute.setAttribute('aria-pressed', String(Boolean(session.preferences.muted)));
  mute.setAttribute('aria-label', session.preferences.muted ? '모든 소리 음소거 해제' : '모든 소리 음소거');
  mute.title = mute.getAttribute('aria-label'); mute.textContent = session.preferences.muted ? '♫̸' : '♪';
  syncDynamicDialog(vm);
  syncSettingsDialog();
  document.body.dataset.stage=birthReveal?'birth-selection':showStart?'start':birthCertificate?'birth-certificate':'life';
  const decision=document.getElementById('decision-dialog');
  for(const section of main.querySelectorAll('.life-toolbar,.life-wrap'))section.inert=!!decision&&!dialog.open;
  if(decision&&!dialog.open&&!decision.contains(document.activeElement))document.getElementById('decision-title')?.focus({preventScroll:true});
  errorBanner.hidden = !(saveError || saveWarning);
  errorBanner.innerHTML = saveError ? `${escape(saveError)} <button data-ui="reload">다시 불러오기</button><button data-ui="export">현재 메모리 내용 내보내기</button>` : `${escape(saveWarning)} <button data-ui="dismiss-warning">확인</button>`;
  updateMusicStatus();
}
function stop({ rerender = false, reason = 'manual' } = {}) {
  playing = false; pauseReason=reason;
  suspendClock();
  if (rerender) render();
}
function suspendClock() {
  clearTimeout(timer); timer = null;
  playbackClock.suspend(performance.now());
}
function isEditing() {
  return Boolean(document.activeElement?.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="number"],[contenteditable="true"]'));
}
function canRunClock() {
  // Panels and every unanswered reflection suspend the clock, not the user's
  // play intent. Explicit/safety stops still set playing=false through stop().
  const life=session.current;
  // A save blocks command execution, but non-time preferences keep their deadline.
  return playing&&!readOnly&&!viewing&&life?.status==='alive'&&!document.hidden&&!dialog.open&&!showStart&&!birthCertificate&&!importPicking&&!isEditing()&&!isMilestoneReflection(life)&&(!life.pending||life.settings.auto);
}
function canTick() { return !busy && canRunClock(); }
function armTimer() {
  clearTimeout(timer); timer=null;
  const clock=playbackClock.reconcile({key:playbackStage(session.current),duration:session.current?yearDurationMs(session.current.settings):1,running:canRunClock()},performance.now());
  updateFlowClock();
  if (!canTick()) return;
  timer = setTimeout(async () => {
    timer=null;
    // A save spanning the deadline re-arms at zero in finally, without polling.
    if (!canTick()) { armTimer(); return; }
    const s = session.current;
    if (s.pending) {
      const choice = s.pending.choices[0];
      if (!choice) { stop({reason:'error'}); return; }
      await dispatch({ type: 'choose', decisionId: s.pending.id, choiceId: choice.id }, { automated: true });
    } else await dispatch({ type: 'advance', years: 1 }, { automated: true });
    armTimer();
  }, clock.remaining);
}
function updateFlowClock(){
  const label=document.querySelector('#flow-clock'),bar=document.querySelector('#flow-progress');
  const clock=playbackClock.snapshot(performance.now());
  const active=playing&&clock.running&&!dialog.open&&!document.hidden&&!showStart&&!viewing;
  const remaining=active?clock.remaining:0;
  if(label)label.textContent=active?'다음 해까지 '+Math.ceil(remaining/1000)+'초':'';
  if(bar)bar.style.width=active?Math.max(0,Math.min(100,(1-remaining/Math.max(1,clock.duration))*100))+'%':'0%';
}
async function lockedSave(candidate) {
  if (navigator.locks?.request) return navigator.locks.request(`${SAVE_KEY}:save`, { mode: 'exclusive' }, () => repository.save(candidate));
  return repository.save(candidate);
}
async function commit(candidate, { message = '', after = null } = {}) {
  if (busy) return false;
  if (readOnly) { toast('읽기 전용 상태입니다. 저장을 다시 불러온 뒤 진행해 주세요.', true); return false; }
  busy = true; render(); armTimer();
  try {
    const result = await lockedSave(candidate);
    if (!result.ok) {
      saveError = result.error || '저장을 완료하지 못했습니다. 이번 선택을 적용하지 않았습니다.';
      if (result.readOnly || ['REVISION_CONFLICT','FUTURE_VERSION','NO_VALID_SAVE','STORAGE_UNAVAILABLE'].includes(result.code)) readOnly = true;
      stop({reason:'error'}); toast(saveError, true); return false;
    }
    session = result.session;
    saveError = '';
    after?.();
    syncAudio();
    if (message) toast(message);
    beep();
    return true;
  } catch (error) {
    saveError = `저장을 완료하지 못했습니다. 이번 선택은 적용되지 않았습니다. ${error.message}`;
    stop({reason:'error'}); toast(saveError, true); return false;
  } finally {
    // Hold the UI lock for a frame: a queued double-click cannot become a second command.
    await new Promise(resolve => {
      let completed = false;
      const complete = () => { if (!completed) { completed = true; resolve(); } };
      requestAnimationFrame(complete); setTimeout(complete, 80);
    });
    busy = false; render({ capture: false });
    armTimer();
  }
}
function syncEnded(candidate) {
  const life = candidate.current;
  if (!life) return;
  if (life.status === 'ended') {
    const index = candidate.lives.findIndex(s => s.lifeId === life.lifeId);
    if (index < 0) candidate.lives.push(clone(life));
    else candidate.lives[index] = clone(life);
  }
  candidate.experience.structures = [...new Set([...candidate.experience.structures, ...life.seen])];
  candidate.experience.countries = [...new Set([...candidate.experience.countries, life.birthCountryId, life.countryId])];
}
async function dispatch(payload, { automated = false } = {}) {
  const viewingNote = viewing?.status === 'ended' && (payload.type==='note'||(payload.type==='set'&&payload.key==='comparisonCountry'));
  if (busy || readOnly || (viewing && !viewingNote) || (!viewingNote && !session.current)) return false;
  const signature = JSON.stringify(payload), now = performance.now();
  if (!automated && signature === lastIntent && now - lastIntentAt < 320) return false;
  lastIntent = signature; lastIntentAt = now;
  const s = viewingNote ? viewing : session.current;
  let fingerprint = 2166136261;
  for (const character of `${s.lifeId}:${signature}`) fingerprint = Math.imul(fingerprint ^ character.charCodeAt(0), 16777619) >>> 0;
  const command = { id: `ui:v${s.version}:${fingerprint.toString(16)}`, lifeId: s.lifeId, expectedVersion: s.version, ...payload };
  const result = transition(s, command);
  if (!result.ok) {
    // Manual validation errors are recoverable; automation must not retry an
    // invalid command forever after its deadline has already elapsed.
    if (shouldStopPlayback(result,automated)) stop({reason:'error'});
    toast(result.message || result.error || '지금은 이 선택을 실행할 수 없습니다.', true);
    render(); armTimer(); return false;
  }
  if (result.noOp) {
    if (shouldStopPlayback(result,automated)) stop({reason:'error'});
    if (!automated) toast(result.message || '이미 선택된 상태입니다.');
    render(); armTimer(); return true;
  }
  const candidate = clone(session);
  if (viewingNote) {
    candidate.lives = candidate.lives.map(life => life.lifeId === s.lifeId ? clone(result.state) : life);
    if (candidate.current?.lifeId === s.lifeId) candidate.current = result.state;
  } else candidate.current = result.state;
  syncEnded(candidate);
  const saved = await commit(candidate, { message: automated ? '' : result.message || '선택을 기록했습니다.', after: () => {
    if(result.state.pending?.id!==s.pending?.id)minimized=false;
    if (viewingNote) viewing = findLife(s.lifeId);
    if (payload.type === 'note') drafts.delete('note-form');
    if (payload.type === 'reflect') drafts.delete('reflection-form');
    if (payload.type === 'goal') drafts.delete('goal-form');
    if(result.state.status==='ended')stop({reason:'ended'});
    if (!automated && ['advance','choose','reflect'].includes(payload.type)) nextFocusId = 'decision-title';
    if (!automated) announce(`${result.state.age}세. ${result.state.pending ? `다음 결정: ${result.state.pending.title}. 선택지 ${result.state.pending.choices.length}개.` : result.message || '선택을 저장했습니다.'}`);
  }});
  if(saved&&!automated&&payload.type==='choose'&&payload.choiceId==='plan-next'&&s.pending?.structure?.startsWith('work-study-result:'))openSystems('education');
  if(saved&&automated&&result.state.pending&&!isMilestoneReflection(result.state)&&result.state.pending.id!==s.pending?.id)announce(`${result.state.age}세, ${result.state.pending.title}. 선택을 기다립니다.`);
  if(saved&&isMilestoneReflection(result.state))announce(`${result.state.age}세 회고입니다. 답변을 기다립니다. ${playing?'답변하면 시간이 다시 흐릅니다.':'일시 정지 상태를 유지합니다.'}`);
  armTimer();
  return saved;
}
function openDialog(html, kind = '') {
  focusPickerOpen=false;
   suspendClock(); beforeDialogFocus = document.activeElement; beforeDialogAction = beforeDialogFocus?.dataset?.ui || ''; dialogKind = kind; dialog.dataset.kind=kind;
  const moreMenu=document.querySelector('#life-more');
  if(moreMenu?.open){
    if(moreMenu.contains(beforeDialogFocus))beforeDialogAction='life-more';
    moreMenu.open=false;moreOpen=false;
  }
  document.querySelector('#dialog-notice').hidden=true;
  settingsFocusId='';
  dialogContent.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  render();
}
function closeDialog() {
  if (busy) return;
  document.querySelector('#dialog-notice').hidden=true;
  dialog.close(); dialogKind = ''; dialog.dataset.kind=''; birthCardCanvas=null; pendingImport = null; pendingResume = null; pendingDeletion = [];
  const focusTarget = beforeDialogAction==='life-more' ? document.querySelector('#life-more > summary') : beforeDialogFocus?.isConnected ? beforeDialogFocus : [...document.querySelectorAll('[data-ui]')].find(element => element.dataset.ui === beforeDialogAction && !dialog.contains(element));
  (focusTarget??document.querySelector('[data-ui=records]'))?.focus?.({ preventScroll: true });
  render(); armTimer();
  if(beforeDialogAction==='life-more')document.querySelector('#life-more > summary')?.focus({preventScroll:true});
}
function findLife(id) { return [session.current, ...session.lives, ...(session.archived || []), ...(session.trash || [])].filter(Boolean).find(s => s.lifeId === id); }
function recordLives() {
  return [...new Map([session.current,...session.lives,...session.archived].filter(Boolean).map(life => [life.lifeId,life])).values()];
}
function showRecords({ trash = recordsTrash, resetSelection = false } = {}) {
  recordsTrash = trash;
  if (resetSelection) selectedRecords.clear();
  const html = renderRecords(session, { trashView: recordsTrash, selectedIds: [...selectedRecords], readOnly });
  if (dialog.open && dialogKind === 'records') {
    const focused = document.activeElement?.id;
    dialogContent.innerHTML = html; if (focused) document.getElementById(focused)?.focus();
  } else openDialog(html,'records');
}
function requestDeletion(ids) {
  if (busy || readOnly || !ids.length) return;
  const lives = ids.map(id => findLife(id)).filter(Boolean);
  if (lives.length !== ids.length) { toast('선택한 기록을 찾지 못했습니다.',true); return; }
  pendingDeletion = [...ids];
  openDialog(dialogShell('선택한 삶을 휴지통으로 옮길까요?', `<p>선택한 ${lives.length}개 삶은 목록에서 숨기고 전체 상태를 휴지통에 보관합니다. 영구 삭제하지 않으며 언제든 복원할 수 있습니다.</p><ul>${lives.map(life=>`<li>${escape(life.name)} · ${life.age}세${life.lifeId===session.current?.lifeId?' · 현재 삶의 진행이 멈춥니다.':''}</li>`).join('')}</ul><div class="buttons"><button class="danger-button" data-ui="confirm-delete">${lives.length}개 삶을 휴지통으로 이동</button><button class="secondary" data-ui="cancel-delete" autofocus>취소하고 기록 유지</button></div>`),'delete');
  pendingDeletion = [...ids];
}
async function restoreRecord(id) {
  if (busy || readOnly) return;
  const result = restoreLifeFromTrash(session,id);
  if (!result.ok) { toast(result.error,true); return; }
  await commit(result.session,{message:'삶의 기록을 복원했습니다.',after:()=>{viewing=null;showStart=!session.current;selectedRecords.clear();}});
  showRecords({trash:false,resetSelection:true});
}
function preserveCurrent(candidate) {
  const current = candidate.current;
  if (!current) return;
  if (current.status === 'ended') syncEnded(candidate);
  else if (!candidate.archived.some(s => s.lifeId === current.lifeId)) candidate.archived.push(clone(current));
}
function beginNewLife() {
  suspendClock();
  if (session.current?.status === 'alive') {
    openDialog(dialogShell('현재 삶을 보관하고 새로 시작할까요?', `<p>${escape(session.current.name)}의 ${session.current.age}세 상태와 모든 기록을 생애 서재에 보관합니다. 새 삶이 저장된 후에도 언제든 이어할 수 있습니다.</p><div class="buttons"><button class="primary" data-ui="confirm-new">보관하고 새 삶 설정하기</button><button class="secondary" data-ui="close-dialog">현재 삶 계속하기</button></div>`), 'new');
  } else { viewing = null; showStart = true; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportSave() {
  try { download(new Blob([repository.export(session)], { type: 'application/json' }), `life-map-save-${new Date().toISOString().slice(0,10)}-r${session.revision}.json`); toast('현재 기록의 JSON 백업 다운로드를 요청했습니다.'); }
  catch(error) { toast(`내보내기 실패: ${error.message}`, true); }
}
function mergeImported(incoming) {
  const result = mergeSessions(session,incoming);
  if (!result.ok) throw new Error(result.error);
  return result.session;
}
async function readImport(file) {
  try {
    if (!file) return;
    if (readOnly) { toast('저장을 다시 불러온 뒤 가져오세요. 읽을 수 없는 원본은 덮어쓰지 않습니다.', true); return; }
    if (file.size > 24 * 1024 * 1024) { toast('24 MB보다 큰 파일은 가져올 수 없습니다.', true); return; }
    const result = repository.import(await file.text());
    if (!result.ok) throw new Error(result.error || '유효하지 않은 저장 파일입니다.');
    pendingImport = mergeImported(result.session);
    const candidate = pendingImport;
    openDialog(dialogShell('저장 파일을 합칠까요?', `<p>파일을 검증했습니다. 현재 기록과 휴지통을 모두 보존하며 서로 다른 삶을 합칩니다. 같은 삶의 내용 또는 휴지통 상태가 충돌하면 자동으로 덮어쓰지 않습니다.</p><div class="import-preview">완료 기록 ${candidate.lives.length}개 · 진행 중 보관 ${candidate.archived.length}개 · 휴지통 ${candidate.trash.length}개<br>가져온 현재 삶: ${escape(candidate.current?.name??'없음')} · ${candidate.current?.age??0}세</div><div class="buttons"><button class="primary" data-ui="confirm-import">검증된 기록 합치기</button><button class="secondary" data-ui="export">기존 기록 먼저 백업</button><button class="text-button" data-ui="close-dialog">취소</button></div>`), 'import');
    pendingImport = candidate;
  } catch(error) { toast(`가져오기 실패: ${error.message}`, true); }
  finally { importPicking=false;armTimer(); }
}
function runBirthReveal() {
 clearTimeout(birthRevealTimer);
 const reveal=birthReveal;if(!reveal)return;
 birthRevealTimer=setTimeout(()=>{
  if(birthReveal!==reveal)return;
  if(++reveal.index>=reveal.sequence.frames.length){
   birthReveal=null;render({capture:false});window.scrollTo({top:0,behavior:'instant'});
   const heading=document.querySelector('.certificate-body h1');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});
   announce(countryName(session.current.birthCountryId)+'의 출생 신고를 확인해 주세요.');
  }else{render({capture:false});runBirthReveal();}
 },reveal.sequence.frames[reveal.index].duration);
}
async function openBirthCard(){
 if(birthCardOpening||!birthCertificate||!activeLife())return;
 birthCardOpening=true;const life=activeLife();
 try{
  const canvas=await createBirthCardCanvas(life,document);
  if(!birthCertificate||activeLife()?.lifeId!==life.lifeId)return;
  birthCardCanvas=canvas;
  const shareAvailable=typeof navigator.share==='function'&&typeof navigator.canShare==='function';
  const html='<div class="birth-card-preview"><img src="'+canvas.toDataURL('image/png')+'" width="900" height="1120" alt="'+escape(life.name)+'의 가상 출생 카드"><div class="buttons"><button class="primary" data-ui="share-birth-card" '+(shareAvailable?'':'disabled')+'>이미지 공유하기</button><button class="secondary" data-ui="save-birth-card">이미지 저장</button><button class="secondary" data-ui="copy-birth-card">글 복사</button></div><p class="hint">'+(shareAvailable?'이미지 공유하기를 누르면 기기의 공유 창이 열립니다.':'이 브라우저는 이미지 공유를 지원하지 않습니다. 이미지 저장을 사용할 수 있어요.')+' 미리보기를 여는 것만으로 전송되지 않습니다.</p></div>';
  openDialog(dialogShell('출생 카드',html),'birth-card');
 }catch(error){toast('카드를 만들지 못했습니다. '+error.message,true);}
 finally{birthCardOpening=false;}
}
async function birthCardAction(action){
 if(dialogKind!=='birth-card'||!birthCardCanvas)return;
 try{
  if(action==='copy'){await navigator.clipboard.writeText(birthCardText(activeLife()));toast('출생 카드 글을 복사했습니다.');return;}
  const blob=await new Promise(resolve=>birthCardCanvas.toBlob(resolve,'image/png'));
  if(!blob)throw Error('이미지를 만들지 못했습니다.');
  const filename='birth-card-'+activeLife().lifeId.slice(-12)+'.png';
  if(action==='save'){download(blob,filename);toast('출생 카드 이미지 저장을 요청했습니다.');return;}
  const file=new File([blob],filename,{type:'image/png'});
  if(!navigator.canShare?.({files:[file]})){toast('이 기기에서는 이미지 공유를 지원하지 않습니다.');return;}
  await navigator.share({files:[file],title:'출생 카드'});
 }catch(error){if(error.name!=='AbortError')toast('카드 작업을 완료하지 못했습니다. '+error.message,true);}
}
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 5) {
  let line = '', lines = 0;
  for (const character of String(text)) {
    if (ctx.measureText(line + character).width > maxWidth && line) {
      ctx.fillText(line, x, y); y += lineHeight; lines += 1; line = '';
      if (lines >= maxLines - 1) { line = '…'; break; }
    }
    line += character;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}
function exportCard(life = activeLife()) {
  if (!life) { toast('먼저 삶을 시작해 주세요.'); return; }
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const c = canvas.getContext('2d');
  c.fillStyle = '#f4f0e5'; c.fillRect(0,0,1080,1350);
  c.fillStyle = '#dfe6d6'; c.fillRect(52,52,976,1246);
  c.fillStyle = '#f3e3b0'; c.beginPath(); c.arc(828,241,100,0,Math.PI*2); c.fill();
  c.fillStyle = '#b2c2a3'; c.beginPath(); c.moveTo(52,490); c.bezierCurveTo(300,240,620,550,1028,360); c.lineTo(1028,710); c.lineTo(52,710); c.closePath(); c.fill();
  c.fillStyle = '#819c79'; c.beginPath(); c.moveTo(52,640); c.bezierCurveTo(420,410,700,690,1028,500); c.lineTo(1028,710); c.lineTo(52,710); c.closePath(); c.fill();
  c.fillStyle = '#253c30'; c.font = '600 22px "Malgun Gothic", sans-serif'; c.fillText('인생의 지도 / 개발 기준판',104,116);
  c.font = '700 70px "Malgun Gothic", sans-serif'; c.fillText(life.name.slice(0,12),104,241);
  c.font = '400 29px "Malgun Gothic", sans-serif'; c.fillText(`${life.birthYear} — ${life.year}  ·  ${life.age}년의 시간`,108,302);
  c.font = '400 23px "Malgun Gothic", sans-serif'; c.fillText(`${countryName(life.birthCountryId)}에서 시작한 삶`,108,350);
  c.fillStyle = '#fffdf5'; c.fillRect(52,710,976,588);
  c.fillStyle = '#c16b43'; c.font = '600 20px "Malgun Gothic", sans-serif'; c.fillText(life.status==='ended'?'A LIFE, REMEMBERED':'A LIFE, STILL UNFOLDING',104,781);
  c.fillStyle = '#263b30'; c.font = '600 35px "Malgun Gothic", sans-serif'; wrapCanvasText(c,life.ending?.careerSummary?.representativeTitle??(life.career.retired?`은퇴한 ${life.career.title}`:life.career.title),104,851,870,47,2);
  c.font = '400 24px "Malgun Gothic", sans-serif'; wrapCanvasText(c,life.ending?.summary??'매일의 작은 선택들이 아직 끝나지 않은 이야기를 만들고 있습니다.',104,932,870,42,4);
  c.fillStyle = '#65725f'; c.font = '400 20px "Malgun Gothic", sans-serif';
  c.fillText(`기록 ${life.history.length}개  ·  자녀 ${life.family.children.length}명  ·  ${life.status==='ended'?'완료된 삶':'진행 중인 삶'}`,104,1141);
  c.fillText('독립 규칙 · 합성 게임 기록 · 실제 인물의 전기가 아닙니다.',104,1223);
  canvas.toBlob(blob => { if(blob){download(blob,`life-map-${life.lifeId.slice(-12)}.png`);toast('1080 × 1350 PNG 카드 다운로드를 요청했습니다.');}else toast('카드 이미지를 만들지 못했습니다.',true); },'image/png');
}
async function reloadSession() {
  if (busy) return;
  stop(); playbackClock.reset(); loaded = repository.load();
  if (!loaded.ok) { readOnly = true; saveError = loaded.error; render(); return; }
  session = loaded.session; pauseReason='reloaded'; syncAudio(); readOnly = Boolean(loaded.readOnly); saveError = '';
  saveWarning = loaded.recovered ? loaded.warning || '이전 저장 세대로 복구했습니다.' : '';
  viewing = null; showStart = !session.current; minimized = false; drafts.clear(); closeDialog(); render({capture:false});
  toast('저장된 최신 상태를 불러왔습니다.');
}

function closeFocusPicker({restoreFocus=false}={}) {
  if(!focusPickerOpen)return;
  focusPickerOpen=false;
  document.getElementById('mobile-focus-picker')?.remove();
  const trigger=document.getElementById('mobile-focus-trigger');
  trigger?.setAttribute('aria-expanded','false');
  if(restoreFocus)trigger?.focus({preventScroll:true});
}

document.addEventListener('click', async event => {
  if(focusPickerOpen&&!event.target.closest('.mobile-minibar'))closeFocusPicker();
  const target = event.target.closest('button,[data-ui],[data-history-open]');
  if (!target || target.disabled || birthReveal) return;
  if (target.dataset.historyMark) { await dispatch({type:'markHistory',historyId:target.dataset.historyMark,marked:target.dataset.marked==='true'}); return; }
  if (target.dataset.historyOpen) {
    if (event.target.closest('a,summary,details,input,select,textarea')) return;
    const key=`history:${target.dataset.historyOpen}`;panels[key]=!panels[key];render();armTimer();return;
  }
  if (target.dataset.tab) { captureDrafts();tab=target.dataset.tab;panels.systems=true;if(dialogKind!=='systems')openSystems(tab);else render({capture:false});document.getElementById('system-title')?.focus({preventScroll:true});return; }
  if (target.dataset.journal) { captureDrafts();journal=target.dataset.journal;if(dialogKind!=='journal')openJournal(journal);else render({capture:false});document.getElementById('journal-'+journal)?.focus({preventScroll:true});return; }
  if(target.dataset.actionOption){const action=getAvailableActions(session.current).find(a=>a.id===target.dataset.actionOption),option=action?.options?.find(o=>String(o.value)===target.dataset.optionValue);if(option)await dispatch({type:'action',actionId:action.id,value:option.value});return;}
  if(target.dataset.speed){await dispatch({type:'set',key:'speed',value:Number(target.dataset.speed)});return;}
  if (target.dataset.choice) { await dispatch({type:'choose',decisionId:target.dataset.decision,choiceId:target.dataset.choice}); return; }
  if (target.dataset.focus) {
    const picker=Boolean(target.closest('#mobile-focus-picker'));
    const saved=await dispatch({type:'set',key:'focus',value:target.dataset.focus});
    if(picker&&saved)closeFocusPicker({restoreFocus:true});
    return;
  }
  if (target.dataset.command) { await dispatch({type:'advance',...(target.dataset.command==='nextDecision'?{untilDecision:true}:{years:1})}); return; }
  if (target.dataset.goalStep) { await dispatch({type:'action',actionId:'goal_step',targetId:target.dataset.goalStep}); return; }
  if (target.dataset.goalCancel) { await dispatch({type:'cancelGoal',goalId:target.dataset.goalCancel}); return; }
  if (target.dataset.mapAge) { mapAge=Number(target.dataset.mapAge);journal='map';if(dialogKind!=='journal')openJournal('map');else render();return; }
  if (target.dataset.graphDelta) { const tl=activeLife().timeline,index=Math.max(0,tl.findIndex(p=>p.age===(graphAge??tl.at(-1)?.age))),next=Math.max(0,Math.min(tl.length-1,index+Number(target.dataset.graphDelta)));graphAge=tl[next]?.age;render();return; }
  if (target.dataset.record) { viewing=findLife(target.dataset.record);showStart=false;minimized=false;closeDialog();render();window.scrollTo({top:0,behavior:'instant'});return; }
  if (target.dataset.recordCard) { exportCard(findLife(target.dataset.recordCard)); return; }
  if (target.dataset.deleteLife) { requestDeletion([target.dataset.deleteLife]); return; }
  if (target.dataset.restoreLife) { await restoreRecord(target.dataset.restoreLife); return; }
  if (target.dataset.resume) { const life=findLife(target.dataset.resume);pendingResume=life?.lifeId;openDialog(dialogShell('보관한 삶을 이어할까요?',`<p>${escape(life?.name)}의 ${life?.age}세에서 이어합니다. 현재 삶이 진행 중이면 그 상태를 서재에 먼저 보관합니다.</p><div class="buttons"><button class="primary" data-ui="confirm-resume">이 삶 이어하기</button><button class="secondary" data-ui="records">서재로 돌아가기</button></div>`),'resume');pendingResume=life?.lifeId;return; }
  if (target.dataset.editNote) { const note=activeLife().notes.find(n=>n.id===target.dataset.editNote),form=document.querySelector('#note-form');if(note&&form){form.elements.text.value=note.text;form.elements.noteId.value=note.id;form.elements.text.focus();}return; }
  const action = target.dataset.ui;
  if (!action) return;
  if (['new-life','confirm-new','confirm-import','confirm-resume','confirm-delete','delete-selected','delete-all','play','mute'].includes(action) && busy) return;
  switch(action) {
    case 'records': showRecords({trash:false,resetSelection:true}); break;
    case 'trash': showRecords({trash:true,resetSelection:true}); break;
    case 'begin-life': if(!uiBlocked()&&session.current){birthCertificate=false;playing=true;pauseReason='';render();armTimer();window.scrollTo({top:0,behavior:'instant'});}break;
    case 'systems': openSystems('education');break;
    case 'finance': openSystems('finance');break;
    case 'family': openSystems('family');break;
    case 'focus-picker':
      if(focusPickerOpen)closeFocusPicker({restoreFocus:true});
      else if(!busy&&session.current?.age>=6){focusPickerOpen=true;render();armTimer();if(event.detail===0)(document.querySelector('#mobile-focus-picker [aria-pressed="true"]:not(:disabled)')??document.querySelector('#mobile-focus-picker button:not(:disabled)'))?.focus({preventScroll:true});}
      break;
    case 'note': openJournal('chronicle');document.getElementById('note-text')?.focus();break;
    case 'local-examples': openDialog(dialogShell('가상 로컬 예시','<p>이 카드는 화면 구성을 보여 주기 위한 가상 예시입니다. 공개 커뮤니티·추모·댓글 기능은 연결되지 않았습니다. 직접 완료한 삶은 이 브라우저의 추모관에 보관됩니다.</p><button class=secondary data-ui=records>내 기록 보기</button>'),'help');break;
    case 'music': if(!readOnly){const candidate=clone(session);candidate.preferences.music=!candidate.preferences.music;await commit(candidate);}break;
    case 'theme': if(!readOnly){const candidate=clone(session);candidate.preferences.theme=candidate.preferences.theme==='dark'?'light':'dark';await commit(candidate);}break;
    case 'toggle-auto': if(session.current)await dispatch(isMilestoneReflection(session.current)?reflectionCommand({auto:true}):{type:'set',key:'auto',value:!session.current.settings.auto});break;
    case 'toggle-reflection': if(session.current)await dispatch(isMilestoneReflection(session.current)?reflectionCommand({reflectionStops:false}):{type:'set',key:'reflectionStops',value:!session.current.settings.reflectionStops});break;
    case 'settings': openDialog(renderSettings(session,{busy,readOnly}),'settings'); break;
    case 'help': openDialog(renderHelp(),'help'); break;
    case 'close-dialog': closeDialog(); break;
    case 'new-life': beginNewLife(); break;
    case 'confirm-new': viewing=null;showStart=true;closeDialog();render();window.scrollTo({top:0,behavior:'instant'});break;
    case 'continue': birthCertificate=false;viewing=null;showStart=!session.current;closeDialog();render();armTimer();break;
    case 'minimize': minimized=!minimized;render();break;
    case 'more-history': historyLimit+=30;render();break;
    case 'cancel-note': {const form=document.querySelector('#note-form');form?.reset();drafts.delete('note-form');toast('메모 작성을 취소했습니다.');break;}
    case 'play': if(playing)stop({rerender:true});else if(!uiBlocked()&&session.current?.status==='alive'){playing=true;pauseReason='';render();armTimer();}break;
    case 'export': exportSave();break;
    case 'import': importPicking=true;suspendClock();fileInput.value='';fileInput.click();break;
    case 'skip-reflection': if(isMilestoneReflection(session.current))await dispatch({type:'reflect',decisionId:session.current.pending.id});break;
    case 'card': if(birthCertificate)await openBirthCard();else exportCard();break;
    case 'share-birth-card': await birthCardAction('share');break;
    case 'save-birth-card': await birthCardAction('save');break;
    case 'copy-birth-card': await birthCardAction('copy');break;
    case 'reload': await reloadSession();break;
    case 'dismiss-warning': saveWarning='';render();break;
    case 'mute': if(!readOnly){const candidate=clone(session);candidate.preferences.muted=!candidate.preferences.muted;await commit(candidate,{message:candidate.preferences.muted?'모든 소리를 음소거했습니다.':'음소거를 해제했습니다.'});}break;
    case 'delete-selected': requestDeletion([...selectedRecords]);break;
    case 'delete-all': requestDeletion(recordLives().map(life=>life.lifeId));break;
    case 'cancel-delete': pendingDeletion=[];showRecords({trash:false});break;
    case 'confirm-delete': {const ids=[...pendingDeletion],result=moveLivesToTrash(session,ids);if(!result.ok){toast(result.error,true);break;}const saved=await commit(result.session,{message:`${ids.length}개 삶을 휴지통으로 옮겼습니다. 복원할 수 있습니다.`,after:()=>{if(viewing&&ids.includes(viewing.lifeId))viewing=null;showStart=!session.current;selectedRecords.clear();pendingDeletion=[];drafts.clear();}});if(saved){dialogKind='records';showRecords({trash:true,resetSelection:true});}break;}
    case 'confirm-import': if(pendingImport){const candidate=pendingImport;await commit(candidate,{message:'기록을 보존하며 저장 파일을 합쳤습니다.',after:()=>{viewing=null;showStart=!candidate.current;drafts.clear();dialog.close();dialogKind='';pendingImport=null;}});}break;
    case 'confirm-resume': {const found=session.archived.find(s=>s.lifeId===pendingResume);if(found&&!readOnly){const candidate=clone(session);preserveCurrent(candidate);candidate.current=clone(found);candidate.archived=candidate.archived.filter(s=>s.lifeId!==found.lifeId);await commit(candidate,{message:'보관한 삶을 이어합니다.',after:()=>{viewing=null;showStart=false;drafts.clear();dialog.close();dialogKind='';pendingResume=null;}});}break;}
    default: break;
  }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (busy || birthReveal || readOnly || (viewing && !(form.id === 'note-form' && viewing.status === 'ended'))) return;
  const data = new FormData(form);
  if (form.id === 'birth-form') {
    try {
      const options = birthOptionsFromForm(data);
      const life=createLife(options),candidate=clone(session);preserveCurrent(candidate);candidate.current=life;syncEnded(candidate);
      const saved=await commit(candidate,{after:()=>{showStart=false;birthCertificate=true;birthReveal={sequence:createBirthSequence(life,{direct:!!options.countryId,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}),index:0};viewing=null;minimized=false;mapAge=null;graphAge=null;tab='education';journal='chronicle';playing=false;pauseReason='birth-certificate';nextFocusId='decision-title';for(const key of Object.keys(panels))panels[key]=false;drafts.clear();window.scrollTo({top:0,behavior:'instant'});}});
      if(saved)runBirthReveal();
    } catch(error) { toast(`시작할 수 없습니다: ${error.message}`,true); }
  } else if(form.id==='reflection-form') {
    if(isMilestoneReflection(session.current))await dispatch({type:'reflect',decisionId:session.current.pending.id,text:String(data.get('text')??'').trim()});
  } else if(form.dataset.actionForm) {
    const action=getAvailableActions(session.current).find(a=>a.id===form.dataset.actionForm);
    const selection=actionCommandFromForm(session.current,action,{value:data.get('value'),targetId:data.get('targetId')});
    if(!selection.ok){toast(selection.error,true);return;}
    await dispatch(selection.command);
  } else if(form.id==='note-form') {
    const text=String(data.get('text')??'').trim();if(!text){toast('남길 메모를 적어 주세요.');return;}
    await dispatch({type:'note',text,...(data.get('noteId')?{noteId:data.get('noteId')}: {})});
  } else if(form.id==='goal-form') {
    const text=String(data.get('text')??'').trim(),steps=[data.get('step1'),data.get('step2')].filter(Boolean);
    if(!text||!steps.length){toast('계획과 실행할 첫 행동을 직접 선택해 주세요.');return;}
    await dispatch({type:'goal',text,steps});
  }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if(target.dataset.recordSelect){if(target.checked)selectedRecords.add(target.dataset.recordSelect);else selectedRecords.delete(target.dataset.recordSelect);showRecords();return;}
  if(target.dataset.selectAllRecords!==undefined){selectedRecords=new Set(target.checked?recordLives().map(life=>life.lifeId):[]);showRecords();return;}
  if(target.closest('#birth-form')){refreshBirthForm({announceChange:true});captureDrafts();return;}
  if(target.id==='history-filter'){historyFilter=target.value;historyLimit=24;render();return;}
  if(target.dataset.setting){const key=target.dataset.setting,value=target.type==='checkbox'?target.checked:key==='speed'?Number(target.value):key==='targetMinutes'?(target.value?Number(target.value):null):key==='comparisonCountry'?(target.value||null):target.value;await dispatch({type:'set',key,value});return;}
  if(target.dataset.preference){
    if(busy||readOnly){render();return;}
    const key=target.dataset.preference,value=target.type==='checkbox'?target.checked:['volume','musicVolume'].includes(key)?Number(target.value):target.value,candidate=clone(session);candidate.preferences[key]=value;
    settingsFocusId=target.id;
    await commit(candidate);
  }
});
document.addEventListener('keydown', event => {
  if(event.key==='Escape'&&focusPickerOpen){event.preventDefault();closeFocusPicker({restoreFocus:true});return;}
  const pendingDialog=document.getElementById('decision-dialog');
  if(pendingDialog&&!dialog.open){if(event.key==='Escape'){event.preventDefault();minimized=true;render();return;}if(event.key==='Tab'){const nodes=[...pendingDialog.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled)')];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||!nodes.includes(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!nodes.includes(document.activeElement))){event.preventDefault();first?.focus();}}}

  const selected = event.target.closest('[role="tab"]');
  if (!selected || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const tabs = [...selected.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(selected);
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const nextId = tabs[nextIndex].id;
  event.preventDefault(); tabs[nextIndex].click(); document.getElementById(nextId)?.focus();
});
fileInput.addEventListener('change',()=>void readImport(fileInput.files?.[0]));
fileInput.addEventListener('cancel',()=>{importPicking=false;armTimer();});
dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)closeDialog();});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
window.addEventListener('storage',event=>{
  if(event.storageArea!==storage||(event.key!==SAVE_KEY&&event.key!==`${SAVE_KEY}.backup`&&event.key!==null))return;
  const latest=repository.load();
  // Delayed events from a completed competing write may arrive after our own commit.
  // Ignore only a byte-equivalent validated latest session, never a different revision's data.
  if(latest.ok&&latest.session.revision===session.revision&&JSON.stringify(latest.session)===JSON.stringify(session))return;
  stop({reason:'conflict'});readOnly=true;saveError='다른 탭에서 저장이 바뀌었습니다. 이 탭은 멈췄으며 변경을 덮어쓰지 않습니다. 최신 저장을 다시 불러와 주세요.';render();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop({rerender:true,reason:'hidden'});syncAudio();});
document.addEventListener('pointerdown',unlockAudio,{capture:true});
document.addEventListener('keydown',unlockAudio,{capture:true});
document.addEventListener('toggle',event=>{if(event.target instanceof HTMLDetailsElement&&event.target.isConnected&&event.target.dataset.panel)panels[event.target.dataset.panel]=event.target.open;if(event.target.id==='life-more')moreOpen=event.target.open;},true);
let focusClockQueued=false;
function reconcileFocusedInput() {
  if(focusClockQueued)return;
  focusClockQueued=true;
  queueMicrotask(()=>{focusClockQueued=false;armTimer();});
}
document.addEventListener('focusin',event=>{const identity=focusIdentity(event.target);if(identity)lastMainFocus=identity;reconcileFocusedInput();});
document.addEventListener('focusout',reconcileFocusedInput);
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
render({capture:false});
syncAudio();

setInterval(()=>{if(!document.hidden)updateFlowClock();},250);
