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
    if(!seriesId||!Number.isSafeInteger(attemptNo)||attemptNo<1||!specimenId||!clientOrderId||!ticker||!['YES','NO'].includes(side)||!windowClose){
      return Response.json({granted:false,reason:'INCOMPLETE_EXECUTION_IDENTITY'},{status:400});
    }
    const key='attempt:'+attemptNo;
    const outcome=await this.state.storage.transaction(async tx=>{
      const prior=await tx.get(key);
      if(prior) return {granted:false,reason:'ATTEMPT_ALREADY_CLAIMED',priorState:'RECONCILIATION_REQUIRED'};
      await tx.put(key,{seriesId,attemptNo,specimenId,clientOrderId,ticker,side,windowClose,claimState:'POTENTIALLY_SUBMITTED',claimedAt:new Date().toISOString()});
      return {granted:true,reason:'ATOMIC_CLAIM_PERSISTED'};
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
