// Expose only target selection already accepted and validated by the executor.
export function actionTargets(state, actionId) {
  if (actionId !== 'business_succession') return [];
  return state.family.children.filter(child=>child.alive&&child.age>=18&&!child.business)
    .map(child=>({value:child.id,label:`${child.name} · ${child.age}세`}));
}

export function actionCommandFromForm(state, action, values) {
  if (!action) return {ok:false,error:'현재 선택할 수 있는 행동을 다시 확인해 주세요.'};
  const command={type:'action',actionId:action.id};
  if (action.options?.length) {
    const option=action.options.find(item=>String(item.value)===String(values.value));
    if (!option) return {ok:false,error:'세부 선택을 다시 확인해 주세요.'};
    command.value=option.value;
  }
  if (action.id==='business_succession') {
    const target=actionTargets(state,action.id).find(item=>item.value===values.targetId);
    if (!target) return {ok:false,error:'사업을 넘겨받을 자녀를 다시 확인해 주세요.'};
    command.targetId=target.value;
  } else if (action.targetId) command.targetId=action.targetId;
  return {ok:true,command};
}
