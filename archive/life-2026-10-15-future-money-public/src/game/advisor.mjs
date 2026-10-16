import { createRequest, cancelRequest, receiveResponse, createUnavailableAdapter } from '../ai-boundary.mjs';

export const ADVISOR_STATUS = Object.freeze({source:'rule',connected:false,realAI:false,label:'AI 미연결 · 직접 계획',description:'목표를 적고 지원 행동을 직접 골라 계획할 수 있습니다. 자연어를 해석하는 모델은 연결하지 않았습니다.'});

// A provider may suggest supported actions; it never receives execution authority.
// The default adapter performs no network calls and does not pretend to interpret text.
export function createAdvisor({adapter=createUnavailableAdapter()}={}) {
  const requests=new Map();
  return Object.freeze({
    status:ADVISOR_STATUS,
    cancel(requestId) { const entry=requests.get(requestId);if(!entry)return false;entry.request=cancelRequest(entry.request);return true; },
    async propose(state,text,{requestId,supportedActionIds=[],getCurrentState=()=>state}={}) {
      if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('INVALID_GOAL_TEXT');
      if(requests.has(requestId))throw new Error('DUPLICATE_ADVICE_REQUEST');
      const request=createRequest({requestId,lifeId:state.lifeId,baseStateVersion:state.version});
      const entry={request};requests.set(requestId,entry);
      let response;
      try {response=await adapter.propose(request,{text:text.trim(),supportedActionIds:[...supportedActionIds]});}
      catch {response={requestId,lifeId:state.lifeId,status:'providerError',provenance:'rules',proposals:[]};}
      const current=getCurrentState();
      const result=receiveResponse(entry.request,response,{lifeId:current.lifeId,stateVersion:current.version,supportedActionIds});
      entry.request=result.request;
      return result;
    }
  });
}
