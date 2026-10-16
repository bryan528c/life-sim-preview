import {GEOGRAPHY_META,COUNTRY_MAP_POINTS,LAND_DOT_PATH} from './geography/map-data.mjs';
import {COUNTRIES} from '../src/game/world.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const countryName=id=>COUNTRIES.find(country=>country.id===id)?.name??'미기록 출생국';
export function birthMapLocation(state){
 const countryId=state.birthCountryId,point=Object.hasOwn(COUNTRY_MAP_POINTS,countryId)?COUNTRY_MAP_POINTS[countryId]:null;
 const {extent}=GEOGRAPHY_META;
 const status=!point?'unavailable':point.latitude<extent.south||point.latitude>extent.north||point.longitude<extent.west||point.longitude>extent.east?'outside-extent':'located';
 return {countryId,source:GEOGRAPHY_META.id,status,point:point?{...point}:null,marker:status==='located'?{x:extent.paddingX+(point.longitude-extent.west)*extent.scale,y:extent.paddingY+(extent.north-point.latitude)*extent.scale}:null,exactBirthCoordinates:false};
}
export function renderBirthMap(state){
 const location=birthMapLocation(state),name=countryName(location.countryId),marker=location.marker;
 const caption=marker?`${name}의 세계 지도상 위치`:location.status==='outside-extent'?`${name}은 이 지도의 표시 범위 밖입니다.`:`${name}의 위치 자료가 없어 표시하지 않았습니다.`;
 const precision=marker?`${state.mode==='present'?'':'현재 지리 기준 · '}국가 대표 위치입니다. 정확한 출생 좌표는 기록되지 않았습니다.`:'다른 지역의 위치로 대신 표시하지 않습니다.';
 return `<figure class="certificate-map" data-geographic-map="${GEOGRAPHY_META.id}" data-country-id="${escape(location.countryId)}" data-map-status="${location.status}"><svg id="certificate-world" class="birth-world-map" viewBox="0 0 624 264" width="624" height="264" role="img" aria-labelledby="birth-map-title birth-map-description"><title id="birth-map-title">${escape(caption)}</title><desc id="birth-map-description">${escape(precision)} 현대 지리 자료에 기반한 점묘 세계 지도입니다. 국경이나 도시 위치는 표시하지 않습니다.</desc><path class="birth-land-dots" d="${LAND_DOT_PATH}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>${marker?`<circle class="birth-country-marker" cx="${marker.x.toFixed(3)}" cy="${marker.y.toFixed(3)}" r="14" fill="none" stroke="currentColor" stroke-width="2.2"/>`:''}</svg><figcaption>${escape(caption)}</figcaption><details class="map-data-source"><summary>위치·자료 안내</summary><p class="map-precision">${escape(precision)}</p><p>Natural Earth v5.1.2의 해안선과 국가·지역 대표 표시점을 사용합니다. 지도 표기 위치는 해당 지역의 모든 섬을 나타내지 않습니다. 스발바르·얀마옌의 점은 원 자료의 스발바르 표기 위치입니다. 작은 섬은 이 축척의 지도에 보이지 않을 수 있습니다. 과거·미래의 국경이나 이 인물의 도시·건물 좌표를 뜻하지 않습니다.</p><p>Made with Natural Earth · public domain</p><a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">원 자료와 이용 조건</a> · <a href="./web/geography/LICENSE-Natural-Earth.txt" target="_blank" rel="noreferrer">보존한 라이선스 원문</a></details></figure>`;
}
