import { clamp, random } from './shared.mjs';
/** Independent game-design data. Country names are geographic labels; every number is synthetic. */
export const WORLD_DATA_META = Object.freeze({ source: 'rule', synthetic: true, version: 2, numericBasis: '자체 설계값 — 실제 국가 통계·원작 확률이 아님', territoryScope: 'ISO 3166-1 국가·지역 코드 249개. 국가 지위에 대한 판정이 아님', unmodeledBirthTerritories: ['AQ','BV','HM','UM','TF','GS'], birthScopeNote: '상주 가구 모형이 없는 6개 지역은 자동 출생 추첨에서 제외. 실제 인구 0이라는 통계 판정이 아니며 지역 목록과 명시적 선택은 보존.' });

const GROUPS = {
  africa: 'DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW EH SH YT RE IO TF',
  asia: 'AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG LA LB MO MY MV MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE UZ VN YE',
  europe: 'AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB AX',
  northAmerica: 'AI AG AW BS BB BZ BM BQ CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VG VI',
  southAmerica: 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE GS',
  oceania: 'AS AU CX CC CK FJ PF GU HM KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV UM VU WF AQ BV'
};
const profiles = {
  africa: { label: '지역 설계 A', income: 10000, education: 58, health: 57, cost: 0.7 },
  asia: { label: '지역 설계 B', income: 17000, education: 69, health: 69, cost: 0.9 },
  europe: { label: '지역 설계 C', income: 26000, education: 80, health: 79, cost: 1.2 },
  northAmerica: { label: '지역 설계 D', income: 22000, education: 74, health: 73, cost: 1.1 },
  southAmerica: { label: '지역 설계 E', income: 15000, education: 66, health: 68, cost: 0.85 },
  oceania: { label: '지역 설계 F', income: 19000, education: 71, health: 72, cost: 1 }
};
const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['ko'], { type: 'region' }) : null;
const knownNames = { KR: '대한민국', US: '미국', GB: '영국', CN: '중국', JP: '일본', CD: '콩고민주공화국', NG: '나이지리아', AT: '오스트리아', TW: '대만', ZA: '남아프리카공화국', EH: '서사하라' };
export const COUNTRIES = Object.freeze(Object.entries(GROUPS).flatMap(([region, codes]) => codes.split(' ').map(id => {
  const n = id.charCodeAt(0) * 31 + id.charCodeAt(1), p = profiles[region], variation = 0.8 + (n % 9) * 0.05;
  return Object.freeze({ id, name: knownNames[id] || names?.of(id) || id, region, birthWeight: 1 + n % 11, populationWeight: 1 + (n * 7) % 17, income: Math.round(p.income * variation / 100) * 100, education: Math.min(95, p.education + n % 13 - 6), health: Math.min(95, p.health + n % 11 - 5), cost: Math.round(p.cost * variation * 100) / 100, synthetic: true, designProfile: p.label });
})).sort((a, b) => a.name.localeCompare(b.name, 'ko')));
export function getCountry(id) { return COUNTRIES.find(country => country.id === id) || COUNTRIES.find(country => country.id === 'KR'); }

// Public facts and the game's invented consequences remain separate data.
export const HISTORICAL_REFERENCES = Object.freeze([
  {id:'smallpox-1980',year:1980,title:'천연두 근절 선언',summary:'WHO는 1980년 천연두의 세계적 근절을 선언했습니다.',url:'https://www.who.int/health-topics/smallpox'},
  {id:'web-1993',year:1993,title:'웹 소프트웨어 공개',summary:'1993년 4월 30일 CERN은 월드 와이드 웹 소프트웨어를 공공 영역에 공개했습니다.',url:'https://home.cern/science/computing/the-birth-of-the-web/'},
  {id:'crisis-2008',year:2008,title:'금융 위기 심화',summary:'2008년 금융 위기가 심화됐고 9월 리먼브러더스가 파산했습니다.',url:'https://www.federalreservehistory.org/essays/great-recession-and-its-aftermath'},
  {id:'pandemic-2020',year:2020,title:'코로나19 팬데믹 평가',summary:'2020년 3월 11일 WHO는 코로나19를 팬데믹으로 평가했습니다.',url:'https://www.who.int/news/item/29-06-2020-covidtimeline'}
].map(entry=>Object.freeze({...entry,source:'public_reference',verifiedAt:'2026-10-14'})));
export const HISTORICAL_GAME_EFFECTS = Object.freeze({
  'smallpox-1980':Object.freeze({until:1989,health:2,description:'1980~1989년 합성 건강 환경 +2'}),
  'web-1993':Object.freeze({until:2002,education:3,description:'1993~2002년 합성 교육 접근성 +3'}),
  'crisis-2008':Object.freeze({until:2010,incomeMultiplier:.93,jobDemand:-.12,description:'2008~2010년 합성 소득 ×0.93·고용 여건 −12%p'}),
  'pandemic-2020':Object.freeze({until:2022,health:-2,jobDemand:-.06,costMultiplier:1.03,description:'2020~2022년 합성 건강 환경 −2·고용 여건 −6%p·생활비 ×1.03'})
});
export function getHistoricalContext(year) {
  return HISTORICAL_REFERENCES.filter(reference=>year>=reference.year&&year<=HISTORICAL_GAME_EFFECTS[reference.id].until).map(reference=>({reference,effect:{...HISTORICAL_GAME_EFFECTS[reference.id],source:'rule',synthetic:true}}));
}

/** Calendar-sensitive fictional environment; not measured history, a forecast, or official national data. */
export function getEnvironment(countryId,{year=2026,mode='present',city='urban',household='middle'}={}) {
  const c=getCountry(countryId), n=c.id.charCodeAt(0)*31+c.id.charCodeAt(1), calendar=clamp(year,1900,2310);
  const historicalProgress=clamp((calendar-1900)/126,0,1), futureProgress=clamp((calendar-2026)/100,0,1.8);
  const infrastructure=clamp(30+historicalProgress*48+futureProgress*9+(c.education-65)*.3,15,96);
  const opportunity=0.5+historicalProgress*.5+futureProgress*.18;
  const cycle=Math.sin((calendar+n%19)/6)*.055+Math.cos((calendar+n%31)/13)*.025;
  const climatePressure=clamp(.015+futureProgress*(.1+(n%5)*.015)+(city==='rural'?.025:0),0,.38);
  const access=(household==='high'?6:household==='low'?-6:0)+(city==='urban'?3:-3);
  const historicalContext=getHistoricalContext(calendar),effects=historicalContext.map(item=>item.effect);
  const health=clamp(c.health-18*(1-historicalProgress)+futureProgress*5+access-climatePressure*12+effects.reduce((sum,e)=>sum+(e.health||0),0),15,96);
  const education=clamp(c.education-22*(1-historicalProgress)+futureProgress*8+access+effects.reduce((sum,e)=>sum+(e.education||0),0),10,98);
  const incomeMultiplier=effects.reduce((product,e)=>product*(e.incomeMultiplier||1),1),costMultiplier=effects.reduce((product,e)=>product*(e.costMultiplier||1),1),jobDemandChange=effects.reduce((sum,e)=>sum+(e.jobDemand||0),0);
  const era=calendar<2026?'과거 배경 합성 모형':calendar===2026?'현재 배경 합성 모형':'미래 가정 모형';
  return {countryId:c.id,year:calendar,mode,era,source:'rule',synthetic:true,referenceYear:null,income:Math.round(c.income*opportunity*(1+cycle)*incomeMultiplier/100)*100,cost:Math.round(c.cost*(.78+historicalProgress*.22+futureProgress*.09)*(1+cycle*.6)*costMultiplier*100)/100,education:Math.round(education*10)/10,health:Math.round(health*10)/10,infrastructure:Math.round(infrastructure),jobDemand:Math.round(clamp(1+cycle*2.2-futureProgress*.015+jobDemandChange,.6,1.3)*1000)/1000,climatePressure:Math.round(climatePressure*1000)/1000,historicalContext,designNotes:'시대별 발전·경기 순환·기후 부담·가계 접근성은 자체 설계이며 실제 통계나 예측이 아닙니다. 역사 사실은 출처로 확인하며 효과 수치·기간·전 세계 적용은 독립 합성 규칙입니다.'};
}

/** Synthetic population stock and birth flow share a declared model instead of unrelated weights. */
export function getBirthDistribution({year=2026,mode='present',weighting='birth'}={}) {
  const progress=clamp((year-1900)/126,0,1.8);
  const entries=COUNTRIES.map(c=>{
    const n=c.id.charCodeAt(0)*31+c.id.charCodeAt(1), population=c.populationWeight*(.55+progress*(.25+(n%7)*.07));
    const designedBirthRate=Math.max(.6,3.6-progress*(.7+(n%7)*.12)+(n%5)*.11);
    const eligible=!WORLD_DATA_META.unmodeledBirthTerritories.includes(c.id),weight=eligible?(weighting==='population'?population:population*designedBirthRate):0;
    return {id:c.id,weight,share:0,populationModel:population,birthRateModel:designedBirthRate,eligible,exclusionReason:eligible?null:'상주 가구 모형 미제공',modelVersion:2,year,mode,weighting,source:'rule',synthetic:true};
  });
  const total=entries.reduce((sum,c)=>sum+c.weight,0);
  return entries.map(c=>({...c,share:c.weight/total}));
}
export function drawBirthCountry(draft,options={}) {
  const entries=getBirthDistribution(options),total=entries.reduce((sum,c)=>sum+c.weight,0);let draw=random(draft)*total;
  for(const c of entries){draw-=c.weight;if(draw<0)return getCountry(c.id);}
  return getCountry(entries.at(-1).id);
}

const job = (id, label, category, degree, minKnowledge, salary, minAge = 18) => Object.freeze({ id, label, name: label, category, degree, minKnowledge, salary, minAge });
export const JOBS = Object.freeze([
  job('domestic','가사도우미','general','primary',0,11000),
  job('labor','현장 노동자','general','none',0,12000), job('farmer','농업 종사자','general','none',0,13000), job('fisher','어업 종사자','general','none',0,14500), job('retail','판매 직원','general','secondary',15,15000), job('care','돌봄 종사자','general','secondary',20,16000), job('craft','기능공','trade','vocational',25,22000), job('electrician','전기 기술자','trade','vocational',35,26000),
  job('teacher','교사','education','bachelor',55,29000), job('nurse','간호 전문직','health','bachelor',55,30000), job('engineer','공학 기술자','science','bachelor',60,36000), job('doctor','의료 전문직','health','doctorate',75,62000,25), job('researcher','연구원','science','master',68,40000,22), job('professor','대학교수','education','doctorate',78,52000,28), job('lawyer','법률 전문직','law','master',70,46000,24), job('journalist','기자','media','bachelor',50,27000), job('software','소프트웨어 개발자','science','bachelor',55,38000),
  job('artist','공연·창작 활동가','arts','highschool',30,24000), job('athlete','전문 선수','sports','highschool',20,32000,18), job('military','직업군인','military','highschool',25,26000,18), job('officer','장교','military','bachelor',55,38000,22), job('clergy','종교 공동체 활동가','community','highschool',40,19000,21), job('entrepreneur','자영업 운영자','business','none',20,23000,18)
]);
export const INVESTMENTS = Object.freeze([
  ['deposit','예금',0.005,0.018,0], ['bond','채권',0.04,0.035,0.005], ['mixed','주식·채권 혼합',0.12,0.055,0.008], ['domestic','국내 지수',0.22,0.065,0.01], ['global','해외 지수',0.2,0.06,0.012], ['property','부동산 펀드',0.15,0.05,0.015], ['stocks','직접 주식 전략',0.34,0.075,0.02]
].map(([id,label,risk,returns,fee]) => Object.freeze({id,label,name:label,risk,return:returns,fee,synthetic:true})));
export const HOBBIES = Object.freeze([
  ['reading','독서'],['music','음악'],['dance','춤'],['painting','그림'],['sports','운동'],['gardening','정원 가꾸기'],['craft','만들기'],['cooking','요리'],['coding','코딩'],['photography','사진'],['writing','글쓰기'],['volunteer','봉사']
].map(([id,label]) => Object.freeze({id,label,name:label})));
const degree = (id,label,level,years,cost,minKnowledge,field='general',extra={}) => Object.freeze({id,label,name:label,level,degree:level,years,cost,minKnowledge,field,...extra});
export const DEGREES = Object.freeze([
  degree('equivalency','고교 학력 시험','highschool',1,600,30), degree('vocational','직업 교육','vocational',2,1500,25,'technical'), degree('university','주간 대학','bachelor',4,4000,50), degree('remote','원격 대학','bachelor',5,2200,38), degree('night','야간 대학','bachelor',5,2500,42), degree('masters','대학원 석사','master',2,4500,65), degree('doctorate','박사 연구 과정','doctorate',4,5000,78), degree('abroadBachelor','해외 학사 과정','bachelor',4,7000,62,'general',{abroad:true}), degree('abroadMasters','해외 석사 과정','master',2,8000,72,'general',{abroad:true})
]);
