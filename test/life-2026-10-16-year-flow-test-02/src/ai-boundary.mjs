// Request transport boundary, not an AI planner or execution authority.
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const SOURCES = ['authored', 'rules', 'model', 'mock'];
function fail(code) { throw new Error(code); }
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID'); }
function version(value) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_VERSION'); }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('UNKNOWN_FIELD');
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function validateRequest(request) {
  fields(request, ['requestId', 'lifeId', 'baseStateVersion', 'status']);
  id(request.requestId); id(request.lifeId); version(request.baseStateVersion);
  if (!['pending', 'cancelled', 'completed', 'needsRevalidation', 'failed'].includes(request.status)) fail('INVALID_REQUEST_STATUS');
}

export function createRequest(input) {
  fields(input, ['requestId', 'lifeId', 'baseStateVersion']);
  const request = { ...input, status: 'pending' }; validateRequest(request);
  return freeze(request);
}

export function cancelRequest(request) {
  validateRequest(request);
  if (['completed', 'failed'].includes(request.status)) fail('REQUEST_ALREADY_FINISHED');
  return freeze({ ...request, status: 'cancelled' });
}

export function receiveResponse(request, response, context) {
  validateRequest(request);
  fields(context, ['lifeId', 'stateVersion', 'supportedActionIds']); id(context.lifeId); version(context.stateVersion);
  if (!Array.isArray(context.supportedActionIds)) fail('INVALID_SUPPORTED_ACTIONS');
  context.supportedActionIds.forEach(id);
  const result = (status, reason, updatedRequest = request, proposals = [], provenance = null) => freeze({
    status, reason, request: { ...updatedRequest }, proposals, provenance,
    executed: false, realConnectionVerified: false,
  });
  if (request.status === 'cancelled') return result('ignored', 'cancelled');
  if (request.status !== 'pending') return result('ignored', 'requestAlreadySettled');
  if (context.lifeId !== request.lifeId) return result('ignored', 'lifeChanged');
  fields(response, ['requestId', 'lifeId', 'status', 'provenance', 'proposals']);
  id(response.requestId); id(response.lifeId);
  if (response.requestId !== request.requestId || response.lifeId !== request.lifeId) return result('ignored', 'responseIdentityMismatch');
  if (!SOURCES.includes(response.provenance)) fail('INVALID_PROVENANCE');
  if (!['ok', 'unavailable', 'budgetExceeded', 'providerError'].includes(response.status)) fail('INVALID_RESPONSE_STATUS');
  if (!Array.isArray(response.proposals) || response.proposals.length > 12) fail('INVALID_PROPOSALS');
  if (response.status !== 'ok') {
    if (response.proposals.length) fail('ERROR_WITH_PROPOSALS');
    return result('fallback', response.status, { ...request, status: 'failed' }, [], response.provenance);
  }
  const proposalIds = new Set();
  for (const proposal of response.proposals) {
    fields(proposal, ['proposalId', 'actionIds']); id(proposal.proposalId);
    if (proposalIds.has(proposal.proposalId)) fail('DUPLICATE_PROPOSAL'); proposalIds.add(proposal.proposalId);
    if (!Array.isArray(proposal.actionIds) || !proposal.actionIds.length || proposal.actionIds.length > 20) fail('INVALID_ACTIONS');
    proposal.actionIds.forEach(id);
    if (proposal.actionIds.some(actionId => !context.supportedActionIds.includes(actionId))) {
      return result('unsupported', 'unsupportedAction', { ...request, status: 'failed' }, [], response.provenance);
    }
  }
  if (context.stateVersion !== request.baseStateVersion) {
    return result('needsRevalidation', 'stateChanged', { ...request, status: 'needsRevalidation' }, [], response.provenance);
  }
  // In this contract, the ordered action IDs are the entire proposed plan.
  // Keep the first identical plan; ordering and repeated steps remain meaningful.
  const planKeys = new Set();
  const distinct = response.proposals.filter(proposal => {
    const key = JSON.stringify(proposal.actionIds);
    if (planKeys.has(key)) return false;
    planKeys.add(key); return true;
  });
  return result('accepted', distinct.length === response.proposals.length ? 'proposalOnly' : 'duplicatePlansRemoved',
    { ...request, status: 'completed' }, structuredClone(distinct), response.provenance);
}

export function createUnavailableAdapter() {
  return Object.freeze({
    id: 'unavailable-provider', liveConnectionImplemented: false,
    async propose(request) {
      validateRequest(request);
      return freeze({ requestId: request.requestId, lifeId: request.lifeId, status: 'unavailable', provenance: 'rules', proposals: [] });
    },
  });
}
