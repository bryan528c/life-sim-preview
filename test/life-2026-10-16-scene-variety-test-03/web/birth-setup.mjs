import {random} from '../src/game/shared.mjs';

export const PAST_YEARS=Object.freeze({min:1950,max:2025,default:1950});
const DEFAULT_YEARS=Object.freeze({past:1950,present:2026,future:2026});
const fields=new Set(['mode','weighting','targetMinutes','comparisonCountry','name','gender','demographicBasis','countryId','household','city','seed']);
function numericSeed(){const values=new Uint32Array(1);return globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(values)[0]:Date.now()>>>0;}
function pastYear(value){
  const year=Number(value);
  if(!/^\d{4}$/.test(String(value))||!Number.isInteger(year)||year<PAST_YEARS.min||year>PAST_YEARS.max)throw new Error(`과거 출생 연도는 ${PAST_YEARS.min}~${PAST_YEARS.max}년 중에서 선택해 주세요.`);
  return year;
}

/** Converts the submitted UI only; it never reads or alters an existing life. */
export function birthOptionsFromForm(data,{seedSource=numericSeed}={}){
  const options={reflectionStops:data.has('reflectionStops')};
  for(const [key,value] of data){
    if(!fields.has(key)||value===''||(value==='random'&&key!=='mode'))continue;
    options[key]=['seed','targetMinutes'].includes(key)?Number(value):value;
  }
  if(options.seed!==undefined&&(!Number.isInteger(options.seed)||options.seed<0||options.seed>4294967295))throw new Error('시드는 0~4294967295 사이의 정수여야 합니다.');
  // Hidden past-year choices must never leak into present/future/random starts.
  if(options.mode==='past'){
    const value=data.get('birthYear')??String(PAST_YEARS.default);
    if(value==='random'){
      options.seed??=seedSource();
      const draw={rng:(options.seed^0xA17E2026)>>>0};
      options.birthYear=PAST_YEARS.min+Math.floor(random(draw)*(PAST_YEARS.max-PAST_YEARS.min+1));
    }else options.birthYear=pastYear(value);
  }
  return options;
}

/** Labels describe the existing independent model, not original-game forecasts. */
export function birthSetupContext({mode='present',birthYear=String(PAST_YEARS.default),weighting='birth',basis='reference-2023'}={}){
  const year=mode==='random'?null:mode==='past'?(birthYear==='random'?null:pastYear(birthYear)):DEFAULT_YEARS[mode];
  const reference=basis==='reference-2023'&&mode==='present';
  const yearLabel=year===null?'태어날 해':`${year}년`;
  const eraHint=mode==='past'?`${year===null?'1950~2025년 중 한 해를 뽑아':`${year}년에 태어나`} 그때부터 삶을 이어갑니다. 생활과 사건의 효과는 합성 게임 규칙입니다.`:
    mode==='future'?'2026년에 태어나 그 이후의 삶을 살아갑니다. 환경은 연도에 따라 변하는 합성 게임 규칙이며 실제 미래 전망 자료는 아닙니다.':
    mode==='random'?'과거·현재·미래 중 하나를 뽑습니다. 과거는 1950년, 현재와 미래는 2026년에 태어나며 합성 게임 분포를 사용합니다.':
    '2026년에 태어나 삶을 시작합니다. 출생 추첨에는 2023 공개 참고 자료 또는 합성 게임 분포를 고를 수 있습니다. 현재 모드도 연도에 따라 합성 환경이 변합니다.';
  const labels=mode==='present'?['지금 태어나는 아기','지금 사는 인구']:
    mode==='past'?['그해 태어나는 아기','그해 살던 인구']:
    mode==='future'?['2026년에 태어나는 아기','2026년의 인구']:['태어날 해의 아기','태어날 해의 인구'];
  return {mode,year,yearLabel,weighting,reference,eraHint,labels,
    distributionTitle:`${yearLabel} ${weighting==='population'?'인구':'출생'} 비중으로 나라를 뽑는다면`,
    weightingHint:`${yearLabel}의 ${weighting==='population'?'인구':'출생'} 비중으로 나라를 고릅니다. 어느 쪽이든 삶은 0세에서 시작합니다.`};
}
