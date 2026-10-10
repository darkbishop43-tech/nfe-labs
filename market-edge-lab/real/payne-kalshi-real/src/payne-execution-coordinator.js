// PAYNE-only atomic claim; Durable Object storage serializes by (seriesId, attemptNo).
// A granted claim is never expired or automatically released. A crash or uncertain
// provider response therefore cannot authorize a duplicate POST.
export class PayneExecutionCoordinator {
  constructor(state) { this.state=state; }
  async fetch(request) {
    if(request.method!=='POST') return new Response('METHOD_NOT_ALLOWED',{status:405});
    let input;
    try {input=await request.json();}catch{return Response.json({granted:false,reason:'INVALID_CLAIM'},{status:400});}
    const {seriesId,attemptNo,specimenId,clientOrderId,ticker,side,windowClose}=input||{};
    const action=input?.action||'CLAIM';
    const exitAction=['CLAIM_EXIT','RELEASE_EXIT_PROVEN_NO_POST'].includes(action);
    if(!seriesId||!Number.isSafeInteger(attemptNo)||attemptNo<1||!specimenId||!clientOrderId||!ticker||!['YES','NO'].includes(side)||(!exitAction&&!windowClose)){
      return Response.json({granted:false,reason:'INCOMPLETE_EXECUTION_IDENTITY'},{status:400});
    }
    const key=exitAction?'exit:'+clientOrderId:'attempt:'+attemptNo;
    if(!['CLAIM','RELEASE_PROVEN_NO_POST','RESOLVE_ENTRY','CLAIM_EXIT','RELEASE_EXIT_PROVEN_NO_POST'].includes(action))
      return Response.json({granted:false,reason:'INVALID_ACTION'},{status:400});
    const outcome=await this.state.storage.transaction(async tx=>{
      const prior=await tx.get(key);
      if(action==='CLAIM_EXIT'){
        if(prior)return {granted:false,reason:'EXIT_ORDER_ALREADY_CLAIMED'};
        await tx.put(key,{seriesId,attemptNo,specimenId,clientOrderId,ticker,side,
          claimState:'POTENTIALLY_SUBMITTED',claimedAt:new Date().toISOString()});
        return {granted:true,reason:'EXCLUSIVE_EXIT_CLAIM_PERSISTED'};
      }
      if(action==='RELEASE_EXIT_PROVEN_NO_POST'){
        if(!prior||prior.seriesId!==seriesId||prior.specimenId!==specimenId||
           prior.clientOrderId!==clientOrderId||prior.ticker!==ticker||prior.side!==side)
          return {granted:false,reason:'EXIT_CLAIM_IDENTITY_MISMATCH'};
        if(input.provenNoProviderPost!==true)
          return {granted:false,reason:'EXIT_NO_POST_PROOF_REQUIRED'};
        await tx.delete(key);
        return {granted:true,reason:'EXIT_NO_POST_CLAIM_RELEASED'};
      }
      if(action==='RELEASE_PROVEN_NO_POST'){
        if(!prior||prior.specimenId!==specimenId||prior.clientOrderId!==clientOrderId)
          return {granted:false,reason:'CLAIM_NOT_OWNED'};
        if(input.provenNoProviderPost!==true)return {granted:false,reason:'NO_POST_PROOF_REQUIRED'};
        await tx.delete(key);
        return {granted:true,reason:'PROVEN_NO_POST_RELEASED'};
      }
      if(action==='RESOLVE_ENTRY'){
        const resolution=String(input.resolution||'');
        // Exact-provider no-execution reconciliation may encounter a historical
        // attempt that never acquired any coordinator claim. Atomically prove no
        // other unsettled claim exists before writing its immutable terminal tombstone.
        // A present but mismatched claim is NEVER repaired by this path.
        if(!prior && resolution==='NO_PROVIDER_EXECUTION' &&
           input.providerNoExecutionProven===true &&
           input.authoritativeReconciliationProven===true){
          const claims=await tx.list({prefix:'attempt:'});
          const outstanding=[...claims.values()].some(row=>row&&
            ['POTENTIALLY_SUBMITTED','OPEN','UNKNOWN'].includes(row.claimState));
          if(outstanding)return {granted:false,reason:'OTHER_OUTSTANDING_COORDINATOR_CLAIM'};
          await tx.put(key,{seriesId,attemptNo,specimenId,clientOrderId,ticker,side,windowClose,
            claimState:'NO_PROVIDER_EXECUTION',resolvedAt:new Date().toISOString(),
            resolutionAuthority:'PROVIDER_CONFIRMED_NO_EXECUTION_NO_PRIOR_CLAIM'});
          return {granted:true,reason:'NO_PRIOR_CLAIM_TERMINALLY_RECONCILED'};
        }
        if(!prior||prior.seriesId!==seriesId||prior.specimenId!==specimenId||prior.clientOrderId!==clientOrderId||
           prior.ticker!==ticker||prior.side!==side||prior.windowClose!==windowClose)
          return {granted:false,reason:prior?'CLAIM_IDENTITY_MISMATCH':'CLAIM_NOT_FOUND'};
        if(!['OPEN','NO_FILL','CLOSED','UNKNOWN','NO_PROVIDER_EXECUTION'].includes(resolution))
          return {granted:false,reason:'INVALID_RESOLUTION'};
        if(resolution==='CLOSED'&&input.providerFlatProven!==true)
          return {granted:false,reason:'PROVIDER_FLAT_EVIDENCE_REQUIRED'};
        if(resolution==='NO_PROVIDER_EXECUTION'&&input.providerNoExecutionProven!==true)
          return {granted:false,reason:'PROVIDER_NO_EXECUTION_EVIDENCE_REQUIRED'};
        if(prior.claimState==='CLOSED'||prior.claimState==='NO_FILL'||prior.claimState==='NO_PROVIDER_EXECUTION')
          return {granted:prior.claimState===resolution,reason:prior.claimState===resolution?'ALREADY_RESOLVED':'TERMINAL_CLAIM_IMMUTABLE'};
        if(prior.claimState==='UNKNOWN'&&
           ['NO_FILL','NO_PROVIDER_EXECUTION','CLOSED'].includes(resolution) &&
           input.authoritativeReconciliationProven!==true)
          return {granted:false,reason:'UNKNOWN_NEEDS_AUTHORITATIVE_RECONCILIATION'};
        await tx.put(key,{...prior,claimState:resolution,resolvedAt:new Date().toISOString()});
        return {granted:true,reason:'ENTRY_RESOLUTION_PERSISTED'};
      }
      if(prior) return {granted:false,reason:'ATTEMPT_ALREADY_CLAIMED',priorState:'RECONCILIATION_REQUIRED'};
      const maxPositions=Number(input.maxPositions);
      if(!Number.isSafeInteger(maxPositions)||maxPositions<1)
        return {granted:false,reason:'FOUNDER_CAPACITY_REQUIRED'};
      // A Durable Object transaction serializes capacity reservation and the
      // exclusive attempt claim. No KV read-then-write can overbook this gate.
      const all=await tx.list({prefix:'attempt:'});
      const occupied=[...all.values()].filter(row=>
        row&&['POTENTIALLY_SUBMITTED','OPEN','UNKNOWN'].includes(row.claimState)
      ).length;
      if(occupied>=maxPositions)return {granted:false,reason:'CAPACITY_FULL',occupied,maxPositions};
      await tx.put(key,{seriesId,attemptNo,specimenId,clientOrderId,ticker,side,windowClose,
        claimState:'POTENTIALLY_SUBMITTED',claimedAt:new Date().toISOString()});
      return {granted:true,reason:'ATOMIC_CLAIM_PERSISTED',occupiedBefore:occupied};
    });
    return Response.json(outcome);
  }
}

export async function claimPayneExecution(env,identity){
  const binding=env?.PAYNE_EXECUTION_COORDINATOR;
  if(!binding?.idFromName||!binding?.get) return {granted:false,reason:'ATOMIC_COORDINATOR_UNBOUND'};
  try{
    const id=binding.idFromName(identity.seriesId);
    const response=await binding.get(id).fetch('https://payne-coordinator.internal/claim',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(identity)
    });
    if(!response.ok)return {granted:false,reason:'ATOMIC_COORDINATOR_REJECTED'};
    const result=await response.json();
    return result?.granted===true?{granted:true,reason:'ATOMIC_CLAIM_PERSISTED'}:{granted:false,reason:String(result?.reason||'ATOMIC_CLAIM_REJECTED')};
  }catch{return {granted:false,reason:'ATOMIC_COORDINATOR_UNAVAILABLE'};}
}

export async function resolvePayneExecutionClaim(env,identity,resolution,{providerFlatProven=false,providerNoExecutionProven=false,authoritativeReconciliationProven=false}={}){
  const binding=env?.PAYNE_EXECUTION_COORDINATOR;
  if(!binding?.idFromName||!binding?.get)return {granted:false,reason:'ATOMIC_COORDINATOR_UNBOUND'};
  try{
    const response=await binding.get(binding.idFromName(identity.seriesId)).fetch('https://payne-coordinator.internal/resolve',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,action:'RESOLVE_ENTRY',resolution,providerFlatProven,providerNoExecutionProven,authoritativeReconciliationProven})
    });
    if(!response.ok)return {granted:false,reason:'RESOLUTION_COORDINATOR_REJECTED'};
    const body=await response.json();
    return body?.granted===true?{granted:true,reason:String(body.reason||'RESOLVED')}:
      {granted:false,reason:String(body?.reason||'RESOLUTION_DENIED')};
  }catch{return {granted:false,reason:'RESOLUTION_COORDINATOR_UNAVAILABLE'};}
}

export async function releaseProvenNoPost(env,identity){
  const binding=env?.PAYNE_EXECUTION_COORDINATOR;
  if(!binding?.idFromName||!binding?.get)return {granted:false,reason:'COORDINATOR_UNBOUND'};
  try{
    const result=await binding.get(binding.idFromName(identity.seriesId)).fetch('https://payne-coordinator.internal/release',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,action:'RELEASE_PROVEN_NO_POST',provenNoProviderPost:true})
    });
    return result.ok?result.json():{granted:false,reason:'RELEASE_REJECTED'};
  }catch{return {granted:false,reason:'RELEASE_FAILED'};}
}

export async function claimPayneExit(env,identity,{provenNoProviderPost=false,release=false}={}){
  const binding=env?.PAYNE_EXECUTION_COORDINATOR;
  if(!binding?.idFromName||!binding?.get)return {granted:false,reason:'ATOMIC_COORDINATOR_UNBOUND'};
  try{
    const r=await binding.get(binding.idFromName(identity.seriesId)).fetch('https://payne-coordinator.internal/exit',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,action:release?'RELEASE_EXIT_PROVEN_NO_POST':'CLAIM_EXIT',provenNoProviderPost})
    });
    if(!r.ok)return {granted:false,reason:'EXIT_COORDINATOR_REJECTED'};
    const body=await r.json();
    return body?.granted===true?{granted:true,reason:body.reason||'EXIT_CLAIM_OK'}:
      {granted:false,reason:body?.reason||'EXIT_CLAIM_DENIED'};
  }catch{return {granted:false,reason:'EXIT_COORDINATOR_UNAVAILABLE'};}
}
