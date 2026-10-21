// Recovery-only entrypoint. There is deliberately no import of index.js, scanner,
// Founder control writer, provider order writer, or real execution controller.
import {PayneExecutionCoordinator} from './payne-execution-coordinator.js';
import {recoverPayneProviderConfirmedExits} from './payne-recovery-orchestrator.js';
import {recoverProviderConfirmedFireLatch} from './payne-fire-recovery-v1.js';
export {PayneExecutionCoordinator};
const KEY='payne-kalshi:real-series:v1';
const CONTROL='payne-kalshi:control:v1';
const PREFIX='payne-kalshi:real-ledger:recovery-v1:';
const store=env=>env?.PAYNE_KALSHI_STATE;
const read=async(env,key)=>{const raw=await store(env)?.get(key);return raw?JSON.parse(raw):null;};
const loadControl=env=>read(env,CONTROL);
const loadSeries=env=>read(env,KEY);
const saveSeries=async(env,next)=>{if(next?.schema!=='PAYNE_REAL_SERIES_V1'||next?.owner!=='PAYNE_KALSHI_REAL')throw Error('RECOVERY_SERIES_SCHEMA_INVALID');await store(env).put(KEY,JSON.stringify(next));};
async function recordRecoveryLedger(env,e){
 const fields=[e.seriesId,e.attemptNo,e.clientOrderId,e.providerOrderId,e.evidenceId].join('|');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fields)));
 const id=[...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
 const key=PREFIX+id,existing=await read(env,key);
 if(existing){
  if(existing.evidenceId!==e.evidenceId||existing.clientOrderId!==e.clientOrderId||
    existing.providerOrderId!==e.providerOrderId)throw Error('RECOVERY_LEDGER_CONFLICT');
  return existing;
 }
 const row={schema:'PAYNE_REAL_LEDGER_V1',type:'PROVIDER_CONFIRMED_RECOVERY_V1',
  owner:'PAYNE_KALSHI_REAL',recordId:id,at:new Date().toISOString(),...e};
 await store(env).put(key,JSON.stringify(row));return row;
}
const adapters={loadControl,loadSeries,saveSeries,recordRecoveryLedger};
async function recover(env){
 // No order POST path exists in the recovered artifact. A failed recovery is
 // returned as UNKNOWN, not interpreted as proof of flat exposure.
 const first=await recoverPayneProviderConfirmedExits(env,adapters);
 const second=await recoverProviderConfirmedFireLatch(env,adapters);
 return {ok:first.ok===true&&second.ok===true,
  exit:{classification:first.classification,reason:first.reason??null},
  fire:{classification:second.classification,reason:second.reason??null},
  providerWrites:0,orders:0};
}
export default {
 async fetch(request,env){
  if(request.method!=='GET')return Response.json({ok:false,reason:'RECOVERY_READ_ONLY_HTTP'},{status:405});
  const path=new URL(request.url).pathname;
  if(path==='/recovery-only/status')return Response.json({ok:true,profile:'PAYNE_RECOVERY_ONLY_V1',
   tradingSubmissionReachable:false,controlWritesReachable:false,readOnlyHttp:true,providerWrites:0});
  if(path==='/real-state'){
   return Response.json({ok:true,profile:'PAYNE_RECOVERY_ONLY_V1',
    control:await loadControl(env),series:await loadSeries(env),providerWrites:0});
  }
  return Response.json({ok:false,profile:'PAYNE_RECOVERY_ONLY_V1',reason:'RECOVERY_ROUTE_NOT_AVAILABLE'},
    {status:404});
 },
 async scheduled(_event,env){
  try{const result=await recover(env);console.log('PAYNE_RECOVERY_ONLY_OUTCOME',
   JSON.stringify(result));}catch(e){console.warn('PAYNE_RECOVERY_ONLY_UNKNOWN',String(e?.message||e));}
 }
};
