import { log, random } from './shared.mjs';
import { sceneHash, yearScene } from './year-scenes.mjs';
import { parentReunionRecall } from './relationship-memory.mjs';

// Relative months since this age's birthday, not fabricated calendar dates.
// A plan stores opportunities only. People, prose and effects are chosen when due.
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=v=>typeof v==='string'&&v.length>0&&v.length<=10000;
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const eventId=(s,age,kind)=>`${s.lifeId}:year:${age}:${kind}`;
function schedule(s,age=s.age) {
  const n=sceneHash(`${s.seed}:${age}:year-flow-v1`);
  return [...([1,2,4].includes(age)?[{kind:'milestone',month:2}]:[]),
    {kind:'activity',month:4+n%2},{kind:'followup',month:9+(n>>>4)%2}].map(e=>({id:eventId(s,age,e.kind),...e,status:'pending',historyIds:[],reason:null,randomSeed:null}));
}
export function beginYearFlow(s,annual=false) {
  const initialAge=s.flags.yearFlow?.initialAge??s.age;
  s.flags.yearFlow={version:1,initialAge,age:s.age,month:0,grantFocus:annual,events:schedule(s)};
}
export function nextYearMoment(s) {
  if(!s||s.status!=='alive')return null;
  const flow=s.flags?.yearFlow;
  const e=(flow?.events??schedule(s)).find(e=>e.status==='pending');
  return e?{id:e.id,kind:e.kind,month:e.month,months:e.month-(flow?.month??0)}:
    {id:eventId(s,s.age,'birthday'),kind:'birthday',month:12,months:12-(flow?.month??0)};
}
export function cancelYearFlow(s) {
  for(const e of s.flags.yearFlow?.events??[])if(e.status==='pending'){e.status='cancelled';e.reason='life-ended';}
}
export function reserveYearRandom(s) {
  const e=s.flags.yearFlow?.events.find(e=>e.kind==='milestone');
  if(s.age===4&&e&&!s.seen.includes('first-friend')) {
    // The old first-friend draw preceded annual mortality. Reserve that one
    // word at the same boundary, without creating a person or applying +5.
    e.randomSeed=s.rng;random(s);
  }
}
function snapshot(s) {
  return {...s.stats,work:s.flags.skills?.work??0,...Object.fromEntries(s.hobbies.map(h=>[`hobby:${h.id}`,h.level])),
    ...Object.fromEntries(s.family.children.map(p=>[`child:${p.id}`,p.closeness??50]))};
}
function metadata(e,scene,effects) {
  return {version:1,eventId:e.id,kind:e.kind,episode:scene.key,stage:scene.stage,contextKey:scene.contextKey,
    targets:scene.targets,causeId:scene.causeId,choiceHistoryId:scene.choiceHistoryId,effects,source:'rule',synthetic:true};
}
export function runYearMoment(s,{advanceFocus,advanceMilestones}) {
  if(!s.flags.yearFlow)beginYearFlow(s);
  const flow=s.flags.yearFlow,e=flow.events.find(e=>e.status==='pending');
  if(!e)return false;
  flow.month=e.month;
  const start=s.history.length,before=snapshot(s);
  if(e.kind==='milestone') {
    advanceMilestones(s,{randomSeed:e.randomSeed});
    if(s.history.length===start){e.status='cancelled';e.reason='already-applied';return true;}
    for(const entry of s.history.slice(start))entry.lifeFacts.yearEvent=metadata(e,{key:entry.lifeFacts.milestone??'first-friend',stage:'milestone',contextKey:'milestone',targets:entry.lifeFacts.personId?{personId:entry.lifeFacts.personId}:{},causeId:null,choiceHistoryId:null},[]);
  } else {
    const source=e.kind==='followup'?s.history.find(h=>h.id===flow.events.find(p=>p.kind==='activity').historyIds[0]):null;
    const scene=yearScene(s,source);
    if(!scene||(e.kind==='followup'&&!source)){e.status='cancelled';e.reason='context-changed';return true;}
    if(e.kind==='activity'&&flow.grantFocus)advanceFocus(s);
    const after=snapshot(s),effects=Object.keys(after).filter(k=>after[k]!==before[k]).map(k=>({field:k,delta:Math.round((after[k]-(before[k]??0))*100)/100}));
    const recall=e.kind==='activity'&&s.age>=18?parentReunionRecall(s):null;
    const entry=log(s,'daily',scene.title+(e.kind==='followup'?' · 이어진 이야기':''),scene.text+(recall?` ${recall.text}`:''));
    entry.lifeFacts={yearEvent:metadata(e,scene,effects),...(recall?{relationshipRecall:recall.reference}:{}),source:'rule',synthetic:true};
  }
  // Capture milestone deltas too. Every numeric effect and its completion marker
  // become one engine transaction and one storage commit, never a display timer.
  if(e.kind==='milestone') {
    const after=snapshot(s);
    s.history[start].lifeFacts.yearEvent.effects=Object.keys(after).filter(k=>after[k]!==before[k]).map(k=>({field:k,delta:after[k]-(before[k]??0)}));
  }
  e.historyIds=s.history.slice(start).map(h=>h.id);e.status='done';
  return true;
}

export function hasYearFlow(s) {
  return s?.flags?.yearFlow!==undefined||(s?.history??[]).some(h=>h?.moment!==undefined||h?.lifeFacts?.yearEvent!==undefined)||(s?.receipts??[]).some(r=>r?.type==='tick');
}
// This is also used before backup recovery: broken timing must not be silently
// replaced by an older save that would execute already-applied effects again.
export function validYearFlow(s) {
  if(!hasYearFlow(s))return true;
  const f=s?.flags?.yearFlow;
  if(!exact(f,['version','initialAge','age','month','grantFocus','events'])||f.version!==1||f.age!==s.age||!int(f.initialAge,0,f.age)
    ||!int(f.month,0,11)||f.grantFocus!==(f.age>f.initialAge)||!Array.isArray(f.events))return false;
  const plan=schedule(s),history=s.history??[],counts=new Map(),byId=new Map(),followed=new Set();
  const prefix=`${s.lifeId}:log:`,local=id=>typeof id==='string'&&id.startsWith(prefix)&&/^(0|[1-9]\d*)$/.test(id.slice(prefix.length));
  for(const [i,h] of history.entries()){counts.set(h.id,(counts.get(h.id)??0)+1);byId.set(h.id,{h,i});}
  let last=-1,started=false;
  for(const [i,h] of history.entries()) {
    if(h.moment!==undefined) {
      if(!exact(h.moment,['version','month'])||h.moment.version!==1||!int(h.moment.month,0,11)||h.age<f.initialAge)return false;
      const time=h.age*12+h.moment.month;
      if(time<last||time>s.age*12+f.month)return false;
      last=time;started=true;
    } else if(started)return false;
    const m=h.lifeFacts?.yearEvent;
    if(m===undefined)continue;
    const planned=schedule(s,h.age).find(e=>e.kind===m.kind);
    if(!exact(m,['version','eventId','kind','episode','stage','contextKey','targets','causeId','choiceHistoryId','effects','source','synthetic'])||m.version!==1
      ||!planned||m.eventId!==planned.id||h.moment?.month!==planned.month||h.category!=='daily'||counts.get(h.id)!==1||!local(h.id)
      ||!text(m.episode)||!text(m.contextKey)||!plain(m.targets)||!Object.values(m.targets).every(text)
      ||m.source!=='rule'||m.synthetic!==true||!Array.isArray(m.effects)||!m.effects.every(x=>exact(x,['field','delta'])&&text(x.field)&&Number.isFinite(x.delta)&&Math.abs(x.delta)<=100)
      ||m.stage!==({activity:'start',followup:'follow',milestone:'milestone'})[m.kind])return false;
    if(m.choiceHistoryId!==null){const c=byId.get(m.choiceHistoryId);if(!c||c.i>=i||counts.get(c.h.id)!==1||!['childhood-first-steps','adult-transition'].includes(c.h.structure))return false;}
    if(m.stage==='follow') {
      const source=byId.get(m.causeId),p=source?.h.lifeFacts?.yearEvent;
      if(!source||source.i>=i||counts.get(source.h.id)!==1||followed.has(m.causeId)||p?.stage!=='start'||p.kind!=='activity'
        ||source.h.age!==h.age||source.h.year!==h.year||source.h.moment.month>=h.moment.month
        ||p.episode!==m.episode||p.contextKey!==m.contextKey||JSON.stringify(p.targets)!==JSON.stringify(m.targets)||p.choiceHistoryId!==m.choiceHistoryId||m.effects.length)return false;
      followed.add(m.causeId);
    } else if(m.causeId!==null)return false;
  }
  if(f.events.length!==plan.length)return false;
  for(const [i,e] of f.events.entries()) {
    if(!exact(e,['id','kind','month','status','historyIds','reason','randomSeed'])||e.id!==plan[i].id||e.kind!==plan[i].kind||e.month!==plan[i].month||!Array.isArray(e.historyIds))return false;
    if(s.age===4&&e.kind==='milestone'&&f.grantFocus){if(!int(e.randomSeed,0,4294967295))return false;}
    else if(e.randomSeed!==null)return false;
    const rows=history.filter(h=>h.lifeFacts?.yearEvent?.eventId===e.id);
    if(e.status==='pending'){if(s.status!=='alive'||e.month<=f.month||e.reason!==null||e.historyIds.length||rows.length)return false;}
    else if(e.status==='done'){
      if(e.month>f.month||e.reason!==null||!rows.length||rows.length!==e.historyIds.length||rows.some((h,n)=>h.id!==e.historyIds[n]||h.age!==s.age))return false;
    }else if(e.status==='cancelled'){
      if(e.historyIds.length||rows.length)return false;
      if(e.reason==='life-ended'){if(s.status!=='ended'||e.month<=f.month)return false;}
      else if(e.month>f.month||!((e.kind==='milestone'&&e.reason==='already-applied')||(e.kind==='followup'&&e.reason==='context-changed')))return false;
    }else return false;
  }
  // Exactly one record per firing, including past years, without regenerating or
  // validating past people against their present-day deaths/relationships.
  const ids=history.flatMap(h=>h.lifeFacts?.yearEvent?[h.lifeFacts.yearEvent.eventId]:[]);
  return new Set(ids).size===ids.length;
}
