import {COUNTRIES,getBirthDistribution} from '../src/game/world.mjs';
import {referenceDistribution,getReferenceDemographic} from '../src/game/demographics.mjs';
import {getCountryReference,COUNTRY_REFERENCE_META} from '../src/game/public-country-data.mjs';
import {getBirthIdentity,getPersonBirthContext} from '../src/game/identity.mjs';
import {portraitDataURL} from './pixel-scenes.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=id=>COUNTRIES.find(c=>c.id===id)?.name??'미기록';
const number=(n,digits=1)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:digits}).format(n);
const distribution=s=>s.flags.demographicBasis==='reference-2023'?referenceDistribution(COUNTRIES,s.weighting):getBirthDistribution({year:s.birthYear,mode:s.mode,weighting:s.weighting});

export function birthReferenceFacts(s){
 const recorded=s.flags.countryReferenceSnapshot===COUNTRY_REFERENCE_META.id;
 const ref=recorded?getCountryReference(s.birthCountryId,s.mode,s.birthYear):null;
 const unavailable=!recorded?'자료 미기록':s.mode!=='present'||s.birthYear!==2026?'이 시대 자료 없음':'자료 없음';
 const value=(key,format)=>ref?.indicators[key]?.value!=null?format(ref.indicators[key].value):unavailable;
 const years=x=>number(x)+'세';
 const expectancy=s.gender==='female'?value('lifeExpectancyFemale',years):s.gender==='male'?value('lifeExpectancyMale',years):ref?'여 '+value('lifeExpectancyFemale',years)+' · 남 '+value('lifeExpectancyMale',years):unavailable;
 return {expectancy,mortality:value('underFiveMortality',x=>number(x/10)+'%'),gdp:value('gdpPerCapitaPpp',x=>number(x,0)+' 국제달러'),recorded};
}

export function birthShareModel(s){
 const row=distribution(s).find(r=>(r.countryId??r.id)===s.birthCountryId);
 const reference=s.flags.demographicBasis==='reference-2023';
 const data=reference?getReferenceDemographic(s.birthCountryId):null;
 return {share:row?.share??null,percent:row?number(row.share*100,2)+'%':'자료 없음',annualBirths:reference&&s.weighting==='birth'?data?.estimatedBirths??null:null,oneIn:row?.share>0?Math.round(1/row.share):null,reference,basis:reference?'WDI 2023 참고 분포 · 215개 국가·지역':'합성 게임 분포 · 실제 출생 통계 아님',weighting:s.weighting};
}

export function renderBirthShare(s){
 const m=birthShareModel(s),country=esc(name(s.birthCountryId));
 const sentence=m.share==null?country+'의 분포 자료가 없습니다.':m.reference&&m.weighting==='birth'?'2023 공개 자료의 출생 추정치 중 <strong>'+m.percent+'</strong>가 '+country+'에 해당합니다. 연간 약 '+number(m.annualBirths/10000,1)+'만 명, 지원 자료 안에서 '+number(m.oneIn,0)+'명 중 1명꼴입니다.':country+'의 '+(m.weighting==='population'?'인구':'출생')+' 추첨 비중은 <strong>'+m.percent+'</strong>입니다.';
 return '<div class="certificate-share"><p>'+sentence+'</p><small>'+esc(m.basis)+'</small></div>';
}

// This sequence presents the already-created life. No RNG, save or game clock.
export function createBirthSequence(s,{direct=false,reducedMotion=false}={}){
 const rows=distribution(s),final=rows.find(r=>(r.countryId??r.id)===s.birthCountryId);
 const frame=(r,duration,last=false)=>({countryId:r?.countryId??r?.id??s.birthCountryId,country:name(r?.countryId??r?.id??s.birthCountryId),percent:r?number(r.share*100,2)+'%':null,duration,last});
 if(direct||reducedMotion)return {direct,frames:[frame(final,reducedMotion?250:850,true)]};
 const lastIndex=Math.max(0,rows.findIndex(r=>(r.countryId??r.id)===s.birthCountryId));
 const delays=[70,90,110,140,180,220,280,360];
 const frames=rows.length?delays.map((duration,i)=>frame(rows[(lastIndex+17*(i+1))%rows.length],duration)):[];
 frames.push(frame(final,850,true));return {direct,frames};
}

export function renderBirthSelection(sequence,index=0){
 const f=sequence.frames[index];
 return '<section class="birth-selection" data-stage="birth-selection" data-final="'+f.last+'" data-country-id="'+esc(f.countryId)+'"><p>'+(sequence.direct?'선택한 출생지':f.last?'새로운 삶이 시작됩니다':'출생지를 정하는 중')+'</p><h1>'+esc(f.country)+'</h1><small>'+(sequence.direct?'직접 선택':f.percent?'자료분포 비중 '+f.percent:'자료분포 미기록')+'</small></section>';
}

// Authored sine curves, independent of the reference game's decorative SVG.
export function birthOrnamentPaths(){
 return Array.from({length:24},(_,i)=>Array.from({length:101},(_,j)=>{
  const y=j*12,x=18+i*30+58*Math.sin(y/66+i*.14)+34*Math.sin(y/188+i*.41);
  return [Number(x.toFixed(2)),y];
 }));
}
export function renderBirthOrnament(){
 return '<svg class="birth-ornament" viewBox="0 0 720 1200" preserveAspectRatio="none" aria-hidden="true" focusable="false">'+birthOrnamentPaths().map(points=>'<path d="'+points.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join('')+'"/>').join('')+'</svg>';
}

export function birthCardText(s){
 const identity=getBirthIdentity(s),facts=birthReferenceFacts(s),share=birthShareModel(s);
 return [name(s.birthCountryId)+'에서 시작한 삶',s.name,s.birthYear+'년'+(identity?.birthMonth?' '+identity.birthMonth+'월':''),identity?.cityLabel??(s.city==='urban'?'도시':'농촌'),'출생 자료분포 비중 '+share.percent,'공개 참고 기대수명 '+facts.expectancy,'가상 인생 · 독립 규칙 · '+share.basis].join('\n');
}

export function wrapCardTextLines(value,measure,maxWidth,maxLines){
 const lines=[];let line='';
 for(const ch of String(value)){
  if(line&&measure(line+ch)>maxWidth){lines.push(line);line='';}
  line+=ch;
 }
 if(line)lines.push(line);
 if(lines.length<=maxLines)return lines;
 const visible=lines.slice(0,maxLines);let last=visible.at(-1);
 while(last&&measure(last+'…')>maxWidth)last=last.slice(0,-1);
 visible[visible.length-1]=last+'…';return visible;
}
export async function createBirthCardCanvas(s,document){
 await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=1120;
 const c=canvas.getContext('2d'),identity=getBirthIdentity(s),facts=birthReferenceFacts(s),share=birthShareModel(s);
 c.fillStyle='#eaf0ee';c.fillRect(0,0,900,1120);
 c.strokeStyle='#0f6e681a';c.lineWidth=1.7;
 for(const points of birthOrnamentPaths()){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x*1.25,y*.93):c.moveTo(x*1.25,y*.93));c.stroke();}
 const text=(value,x,y,width,size=30,color='#14262d',weight=400,maxLines=3)=>{
  c.fillStyle=color;c.font=weight+' '+size+'px "IBM Plex Sans KR",sans-serif';
  const lines=wrapCardTextLines(value,line=>c.measureText(line).width,width,maxLines);
  lines.forEach((line,i)=>c.fillText(line,x,y+i*size*1.45));
  return y+Math.max(0,lines.length-1)*size*1.45;
 };
 c.fillStyle='#971b40';c.fillRect(0,0,900,90);
 text('환생게임 · 로컬 기록',52,58,660,32,'#fff',700,1);text(s.birthCountryId+' · '+s.birthYear,716,54,160,20,'#fff',400,1);
 text('출생 신고 · '+s.birthYear+'년'+(identity?.birthMonth?' '+identity.birthMonth+'월':''),52,140,796,23,'#0f6e68',700,1);
 // A long country fits one line; a permitted 40-character name uses at most
 // two 28px lines, ending above the fixed parental-information block.
 const fit=(value,maxWidth,start,min=18)=>{let size=start;do{c.font='700 '+size+'px "IBM Plex Sans KR",sans-serif';if(c.measureText(value).width<=maxWidth)return size;}while(--size>min);return size;};
 text(name(s.birthCountryId),50,245,800,fit(name(s.birthCountryId),800,86),'#14262d',700,1);
 text((identity?.cityLabel??(s.city==='urban'?'도시':'농촌'))+' · '+({low:'빠듯한',middle:'안정된',high:'여유 있는'})[s.household]+' 살림에서 태어났습니다.',52,305,795,25,'#526970',400,2);
 const portrait=new document.defaultView.Image();
 await new Promise((resolve,reject)=>{portrait.onload=resolve;portrait.onerror=()=>reject(Error('초상화를 불러오지 못했습니다.'));portrait.src=portraitDataURL(s);});
 c.imageSmoothingEnabled=false;c.drawImage(portrait,52,374,166,210);
 c.font='700 48px "IBM Plex Sans KR",sans-serif';
 text(s.name,249,425,594,c.measureText(s.name).width<=594?48:28,'#14262d',700,2);
 const parents=s.family.parents.map((p,i)=>{const b=getPersonBirthContext(s,p.id),role=b?.role==='mother'?'어머니':b?.role==='father'?'아버지':'부모 '+(i+1);return role+(b?.presentAtBirth===false?' 부재':' '+p.age+'세');}).join(' · ');
 text(parents,249,502,590,23,'#526970',400,2);
 text(Number.isInteger(identity?.siblings)?'위 형제자매 '+identity.siblings+'명':'형제자매 미기록',249,559,590,23,'#526970',400,1);
 const tiles=[[share.percent,'출생 자료분포 비중'],[facts.mortality,'5세 전 사망 비율'],[facts.expectancy,'출생 시 기대수명']];
 tiles.forEach(([value,label],i)=>{const x=52+i*270;c.fillStyle='#f8faf8';c.fillRect(x,635,250,174);c.strokeStyle='#c8d3d0';c.strokeRect(x,635,250,174);text(value,x+18,701,214,value.length>8?25:49,i===1?'#971b40':'#0f6e68',700,2);text(label,x+18,777,214,21,'#526970',400,1);});
 text('이 아이는 어떤 삶을 살아갈까요?',52,878,790,32,'#971b40',700,1);
 text(share.basis,52,948,790,22,'#526970',400,2);
 text('가상 인생 · 생활과 사건은 독립 규칙입니다.',52,1048,790,23,'#526970',400,1);
 return canvas;
}
