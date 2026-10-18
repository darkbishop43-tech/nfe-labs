// PAYNE deployment-only exposure evidence verifier.
// READS ONLY. Do not turn absence of a current attempt into series-wide claim proof.
import {mkdir,writeFile} from 'node:fs/promises';
const KV_NAMESPACE='03352b0ccb034f1bb8206f663a04b125';
const KV_KEYS={control:'payne-kalshi:control:v1',series:'payne-kalshi:real-series:v1'};
const DENIAL_SCHEMA='PAYNE_EMPTY_SERIES_DEPLOYMENT_EVIDENCE_V1';
const WORKER='https://market-edge-payne-kalshi-real.darkbishop43.workers.dev';
const deny=(seriesId,missing,details={})=>({
  schema:DENIAL_SCHEMA,allowed:false,source:'AUTHENTICATED_READ_ONLY',
  observedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),
  seriesId:seriesId||null,controlArmed:null,
  providerOrdersComplete:false,providerPositionsComplete:false,
  coordinatorClaimsComplete:false,reconciliationComplete:false,
  providerOpenOrders:null,providerOpenPositions:null,
  coordinatorActiveClaims:null,unknownProviderObligations:null,
  missingCoverage:[...new Set(missing)],...details
});
async function jsonGet(fetchImpl,url,headers){
 const r=await fetchImpl(url,{method:'GET',headers,redirect:'error'});
 if(!r?.ok)throw Error('AUTHENTICATED_READ_HTTP_'+(r?.status??'UNKNOWN'));
 const data=await r.json();
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('RESPONSE_SCHEMA_MISSING');
 return data;
}
export async function verifyExistingPayneEvidence({fetchImpl=fetch,env=process.env}={}){
 const missing=[];
 const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
 if(!account||!token)return deny(null,['CLOUDFLARE_KV_READ_CREDENTIALS_UNAVAILABLE']);
 const root='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+
   '/storage/kv/namespaces/'+KV_NAMESPACE+'/values/';
 const auth={'Authorization':'Bearer '+token};
 let control,series;
 try{
   control=await jsonGet(fetchImpl,root+encodeURIComponent(KV_KEYS.control),auth);
   series=await jsonGet(fetchImpl,root+encodeURIComponent(KV_KEYS.series),auth);
 }catch{return deny(null,['AUTHENTICATED_CONTROL_OR_SERIES_READ_INCOMPLETE']);}
 const identity=typeof series.seriesId==='string'?series.seriesId:null;
 if(!identity||series.schema!=='PAYNE_REAL_SERIES_V1'||series.owner!=='PAYNE_KALSHI_REAL')
   missing.push('SERIES_IDENTITY_INVALID');
 if(control.armed!==false||control.openPositions!==0)missing.push('FOUNDER_NOT_VERIFIED_DISARMED_FLAT');
 if(!Array.isArray(series.positions))missing.push('POSITION_COLLECTION_NOT_VERIFIED');
 else if(series.positions.length)missing.push('POSITION_COLLECTION_NOT_EMPTY');
 if(series.attemptsStarted!==0||series.executionIntentsStarted!==0)
   missing.push('ZERO_ATTEMPT_OR_INTENT_NOT_VERIFIED');
 if(series.currentAttempt!==null||series.position!==null||series.unresolvedEntry!==false)
   missing.push('CURRENT_ATTEMPT_OR_EXPOSURE_NOT_VERIFIED');
 // Existing coordinator endpoint /internal/atomic-claim-diagnostic requires a
 // matching currentAttempt, and only inspects ONE attempt. For zero attempts it
 // cannot establish series-wide claim coverage, regardless of HTTP result.
 missing.push('SERIES_WIDE_DURABLE_CLAIM_ENUMERATION_UNAVAILABLE');
 // Existing protected closure evidence endpoint requires one persisted OPEN
 // position. It cannot prove empty-series full-provider order/position coverage.
 missing.push('ZERO_POSITION_AUTHENTICATED_KALSHI_ORDER_COVERAGE_UNAVAILABLE');
 missing.push('ZERO_POSITION_AUTHENTICATED_KALSHI_POSITION_COVERAGE_UNAVAILABLE');
 missing.push('PROVIDER_RECONCILIATION_COVERAGE_UNAVAILABLE');
 const diag=env.PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN;
 let diagnostic='NO_DIAGNOSTIC_TOKEN';
 if(diag && diag.length>=32 && identity){
   // Both calls are read-only. A status code cannot establish complete coverage.
   try {
     const r=await fetchImpl(WORKER+'/internal/atomic-claim-diagnostic?seriesId='+encodeURIComponent(identity)+'&attemptNo=1',{
       method:'GET',headers:{'x-payne-diagnostic-token':diag},redirect:'error'});
     diagnostic='ATTEMPT_SCOPED_HTTP_'+r.status;
   }catch{diagnostic='ATTEMPT_SCOPED_READ_UNAVAILABLE';}
   try{
     const r=await fetchImpl(WORKER+'/internal/closure-maintenance-evidence',{
       method:'GET',headers:{'x-payne-diagnostic-token':diag},redirect:'error'});
     diagnostic+=';CLOSURE_SCOPED_HTTP_'+r.status;
   }catch{diagnostic+=';CLOSURE_SCOPED_READ_UNAVAILABLE';}
 }
 return deny(identity,missing,{controlArmed:control.armed,positionRecordCount:Array.isArray(series.positions)?series.positions.length:null,
   attemptsStarted:series.attemptsStarted,executionIntentsStarted:series.executionIntentsStarted,
   diagnosticCoverage:diagnostic});
}
export async function writePayneEvidence({result,output='/tmp/payne-kv-gate/empty-series-evidence.json'}){
 await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 return result;
}
if(process.argv[1]?.endsWith('payne-empty-series-readonly-verifier.mjs')){
 const result=await verifyExistingPayneEvidence();
 await writePayneEvidence({result});
 console.log(JSON.stringify({allowed:result.allowed,seriesId:result.seriesId,
   missingCoverage:result.missingCoverage,observedAt:result.observedAt}));
 // Exit successfully after producing denial proof; the safety gate then rejects it.
 // Never set PAYNE_EMPTY_SERIES_EVIDENCE_AUTHORITY from this incomplete verifier.
}
