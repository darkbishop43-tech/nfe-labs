import {evaluatePayneClosureMaintenance} from './payne-closure-maintenance-offline.mjs';
import {writeFile,mkdir} from 'node:fs/promises';

export async function verifyPayneMaintenanceChain({control,series,providerResponse,sourceBlob,expectedBlob}){
 const rejected=reason=>({allowed:false,reason});
 if(!providerResponse?.ok||!providerResponse?.complete||!providerResponse.positionIdentity)
   return rejected('PROTECTED_PROVIDER_EVIDENCE_NOT_COMPLETE');
 const p=series?.position, id=providerResponse.positionIdentity;
 if(!p || id.seriesId!==series.seriesId || id.attemptId!==p.attemptId ||
    id.providerOrderId!==p.entryOrderId || id.clientOrderId!==p.entryClientOrderId ||
    id.ticker!==p.marketTicker || id.side!==p.outcomeSide)
   return rejected('POSITION_IDENTITY_MISMATCH');
 const outcome=evaluatePayneClosureMaintenance({control,series,provider:providerResponse.provider,sourceBlob,expectedBlob});
 if(!outcome.allowed)return outcome;
 return {allowed:true,reason:outcome.reason,sourceBlob,
   seriesId:series.seriesId,attemptId:p.attemptId,entryOrderId:p.entryOrderId,
   clientOrderId:p.entryClientOrderId,ticker:p.marketTicker,side:p.outcomeSide};
}

// Fallback: existing production endpoints only. No new Worker, no Kalshi keys in GitHub.
// Does not require /internal/deployment-position-evidence (undeployed).
// A missing authenticated provider-evidence endpoint is not proof of flat exposure.
// Deployment must not manufacture a provider response from coordinator state.
export async function getLiveMaintenanceDecision({fetchImpl=fetch,env=process.env,workerUrl='https://market-edge-payne-kalshi-real.darkbishop43.workers.dev'}={}){
 const cf=env.CLOUDFLARE_API_TOKEN,account=env.CLOUDFLARE_ACCOUNT_ID;
 const secret=env.PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN;
 const blob=env.PAYNE_APPROVED_CLOSURE_BLOB;
 if(!cf||!account||blob!=='76c6ff7a2f7f6967def859012b2fcf3b66f7b2f9')
   throw Error('MAINTENANCE_AUTHORITY_OR_SOURCE_MISSING');
 const kvroot='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/storage/kv/namespaces/03352b0ccb034f1bb8206f663a04b125/values/';
 const kv=async key=>{
   const response=await fetchImpl(kvroot+encodeURIComponent(key),{method:'GET',headers:{Authorization:'Bearer '+cf}});
   if(!response.ok)throw Error('KV_READ_INCOMPLETE');
   return response.json();
 };
 const [control,series]=await Promise.all([kv('payne-kalshi:control:v1'),kv('payne-kalshi:real-series:v1')]);
 if(control?.openPositions===0)return {allowed:false,reason:'NORMAL_ZERO_POSITION_GATE',normalGate:true};
 if(!secret||secret.length<32)throw Error('PROTECTED_READ_AUTHORIZATION_MISSING');
 const response=await fetchImpl(workerUrl+'/internal/closure-maintenance-evidence',{
   method:'GET',headers:{'x-payne-diagnostic-token':secret},redirect:'error'});
 let providerResponse;
 if(response.ok){
   providerResponse=await response.json();
 }else if(response.status===404){
   // Endpoint absent on current production. Use existing authenticated routes only.
   throw Error('AUTHENTICATED_CLOSURE_EVIDENCE_ENDPOINT_NOT_DEPLOYED');
 }else{
   throw Error('PROTECTED_PROVIDER_EVIDENCE_FAILED_HTTP_'+response.status);
 }
 const decision=await verifyPayneMaintenanceChain({control,series,providerResponse,sourceBlob:blob,expectedBlob:blob});
 if(!decision.allowed){
   if(decision.reason==='POSITION_IDENTITY_STATUS'){
     const actual=series?.position?.status;
     const safeStatus=typeof actual==='string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(actual)
       ? actual : (actual===undefined?'MISSING':'INVALID_OR_UNSAFE');
     console.error('POSITION_STATUS_DIAGNOSTIC actual='+safeStatus+
       ' expected=OPEN|RECONCILIATION_UNKNOWN|PROVIDER_VERIFIED_CLOSED');
   }
   throw Error('MAINTENANCE_DENIED_'+decision.reason);
 }
 return decision;
}

if(process.argv[1]?.endsWith('/payne-maintenance-decision.mjs')){
 try{
   const decision=await getLiveMaintenanceDecision();
   await mkdir('/tmp/payne-kv-gate',{recursive:true});
   await writeFile('/tmp/payne-kv-gate/maintenance-proof.json',JSON.stringify(decision),{mode:0o600});
   console.log(decision.normalGate?'NORMAL_GATE_ZERO_POSITIONS':'PAYNE_AUTHENTICATED_MAINTENANCE_EVIDENCE=PASS');
 }catch(error){console.error('BLOCKED:',error.message);process.exitCode=1;}
}
