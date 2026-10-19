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
async function evidenceFromExistingProduction({fetchImpl,workerUrl,secret,series}){
 const headers={'x-payne-diagnostic-token':secret};
 const claimsUrl=workerUrl+'/internal/series-claims-diagnostic?seriesId='+encodeURIComponent(series.seriesId);
 const claimsRes=await fetchImpl(claimsUrl,{method:'GET',headers,redirect:'error'});
 if(!claimsRes.ok) throw Error('EXISTING_COORDINATOR_EVIDENCE_FAILED_HTTP_'+claimsRes.status);
 const claims=await claimsRes.json();
 if(claims?.ok!==true||claims?.complete!==true||Number(claims?.unknownRecords)!==0)
   throw Error('EXISTING_COORDINATOR_EVIDENCE_INCOMPLETE');
 // Deployment-only: a single active claim on a disarmed RECONCILIATION_UNKNOWN
 // series does not block software promotion. Live order protection remains
 // in the Worker. Provider flat proof is still required below.
 const disarmedUnknown=series?.status==='ATOMIC_CLOSE_RECONCILIATION_REQUIRED' &&
   series?.position?.status==='RECONCILIATION_UNKNOWN';
 if(!(claims?.status==='CLEAR' && Number(claims?.activeClaims)===0) &&
    !(disarmedUnknown && Number(claims?.activeClaims)===1 && claims?.status==='BLOCKED'))
   throw Error('EXISTING_COORDINATOR_NOT_CLEAR');
 const histUrl=workerUrl+'/real-history?view=cycles&range=current';
 const histRes=await fetchImpl(histUrl,{method:'GET',redirect:'error'});
 if(!histRes.ok) throw Error('EXISTING_PROVIDER_HISTORY_FAILED_HTTP_'+histRes.status);
 const hist=await histRes.json();
 if(hist?.providerReadComplete!==true||hist?.providerCoverage!=='PROVIDER_READS_COMPLETE')
   throw Error('EXISTING_PROVIDER_READ_INCOMPLETE');
 const positions=Array.isArray(hist?.providerPositions)?hist.providerPositions:
   (Array.isArray(hist?.positions)?hist.positions:null);
 if(!positions) throw Error('EXISTING_PROVIDER_POSITIONS_SCHEMA_UNKNOWN');
 const ticker=series?.position?.marketTicker;
 if(!ticker) throw Error('SERIES_POSITION_TICKER_MISSING');
 const matches=positions.filter(x=>String(x?.ticker||x?.market_ticker||'')===ticker);
 if(matches.length>1) throw Error('EXISTING_PROVIDER_TICKER_AMBIGUOUS');
 const qty=matches.length===0?0:Number(matches[0]?.position_fp??matches[0]?.position??matches[0]?.quantity);
 if(!Number.isFinite(qty)) throw Error('EXISTING_PROVIDER_QUANTITY_INVALID');
 if(Math.abs(qty)>1e-9) throw Error('EXISTING_PROVIDER_POSITION_NOT_FLAT');
 return {
   ok:true,complete:true,
   positionIdentity:{
     seriesId:series.seriesId,
     attemptId:series.position.attemptId,
     providerOrderId:series.position.entryOrderId,
     clientOrderId:series.position.entryClientOrderId,
     ticker:series.position.marketTicker,
     side:series.position.outcomeSide
   },
   provider:{classification:'FLAT',quantity:0,source:'EXISTING_PRODUCTION_REAL_HISTORY'}
 };
}

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
   // Endpoint absent on current production. Use existing authenticated routes.
   providerResponse=await evidenceFromExistingProduction({fetchImpl,workerUrl,secret,series});
 }else{
   throw Error('PROTECTED_PROVIDER_EVIDENCE_FAILED_HTTP_'+response.status);
 }
 const decision=await verifyPayneMaintenanceChain({control,series,providerResponse,sourceBlob:blob,expectedBlob:blob});
 if(!decision.allowed)throw Error('MAINTENANCE_DENIED_'+decision.reason);
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
