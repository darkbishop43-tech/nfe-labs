import {
 inspectPayneCoordinatorSeries,inspectPayneCoordinatorExit,resolvePayneExitRecovery
} from './payne-execution-coordinator.js';
import {verifyProviderTerminalExit} from './payne-provider-recovery-v1.js';
import {paynePositionRecords} from './payne-live-order-watch.js';

// This is a separate, conservative recovery pass. Never sends orders or changes armed state.
// Durable Object claim transition precedes replayable KV projections; these are NOT one transaction.
export async function recoverPayneProviderConfirmedExits(env,{
 loadControl,loadSeries,saveSeries,recordRecoveryLedger,
 inspectSeries=inspectPayneCoordinatorSeries,inspectExit=inspectPayneCoordinatorExit,
 verifyProvider=verifyProviderTerminalExit,resolveExit=resolvePayneExitRecovery
}={}){
 const fail=reason=>({ok:false,classification:'UNKNOWN',reason,providerWrites:0,orders:0});
 if(![loadControl,loadSeries,saveSeries,recordRecoveryLedger].every(f=>typeof f==='function'))
  return fail('RECOVERY_ADAPTER_INCOMPLETE');
 const control=await loadControl(env);
 // Prevent live control/entry races while applying legacy KV projection.
 if(control?.armed!==false)return fail('RECOVERY_PROJECTION_REQUIRES_DISARMED');
 const series=await loadSeries(env);
 if(!series?.seriesId)return {ok:true,classification:'CLEAN',reason:'NO_SERIES',providerWrites:0,orders:0};
 const listing=await inspectSeries(env,series.seriesId);
 if(listing?.ok!==true||listing?.complete!==true||!Array.isArray(listing.claims))
  return fail('COORDINATOR_INSPECTION_UNKNOWN');
 const exits=listing.claims.filter(c=>c?.kind==='EXIT'&&
  ['POTENTIALLY_SUBMITTED','OPEN','UNKNOWN','CLOSED','NO_PROVIDER_EXECUTION'].includes(c.state));
 for(const summary of exits.slice(0,1)){
  const inspect=await inspectExit(env,series.seriesId,summary.clientOrderId);
  const claim=inspect?.claim;
  if(inspect?.ok!==true||inspect.status!=='FOUND'||!claim||
    claim.seriesId!==series.seriesId||claim.clientOrderId!==summary.clientOrderId||
    claim.attemptNo!==summary.attemptNo)
   return fail('EXACT_EXIT_CLAIM_UNKNOWN');
  // The worker claims an EXIT before its client ID can be saved to KV.
  // Recover that exact pre-persist crash window by reconstructing only the
  // established deterministic PAYNE exit client ID, never an unrelated claim.
  const exitSuffix=String(claim.clientOrderId||'').match(/-exit([1-9]\\d*)$/);
  const expectedExitId=exitSuffix
   ?('payne-real-'+String(series.seriesId).replace(/[^0-9A-Za-z]/g,'').slice(-12)+
     '-'+String(claim.attemptNo)+'-exit'+exitSuffix[1]).slice(0,64):null;
  if(!expectedExitId||expectedExitId!==claim.clientOrderId)
   return fail('EXIT_CLIENT_ID_NOT_PAYNE_DETERMINISTIC_IDENTITY');
  const matches=paynePositionRecords(series).filter(p=>p.seriesId===series.seriesId&&
   p.attemptId===claim.specimenId&&p.attemptNo===claim.attemptNo&&
   p.marketTicker===claim.ticker&&p.outcomeSide===claim.side&&
   (!p.exitClientOrderId||p.exitClientOrderId===claim.clientOrderId||expectedExitId===claim.clientOrderId)&&p.owner==='PAYNE_KALSHI_REAL');
  if(matches.length!==1)return fail('RETAINED_POSITION_IDENTITY_UNKNOWN');
  const evidence=await verifyProvider(env,{claim,position:{...matches[0],exitClientOrderId:claim.clientOrderId}});
  if(evidence?.ok!==true||evidence?.complete!==true)return fail(evidence?.reason||'PROVIDER_EXPOSURE_UNKNOWN');
  const identity={seriesId:claim.seriesId,attemptNo:claim.attemptNo,
   specimenId:claim.specimenId,clientOrderId:claim.clientOrderId,
   ticker:claim.ticker,side:claim.side};
  const proof={resolution:evidence.resolution,providerOrderId:evidence.providerOrderId,
   evidenceId:evidence.evidenceId,providerTerminalProven:true,
   providerExposureFlatProven:true,providerFillsVerified:true};
  const committed=await resolveExit(env,identity,proof);
  if(committed?.granted!==true)return fail('EXACT_COORDINATOR_TERMINAL_COMMIT_REJECTED');
  const freshControl=await loadControl(env),fresh=await loadSeries(env);
  if(freshControl?.armed!==false||fresh?.seriesId!==series.seriesId)
   return fail('RECOVERY_PROJECTION_CONTROL_OR_SERIES_CHANGED');
  const freshMatches=paynePositionRecords(fresh).filter(p=>p.seriesId===claim.seriesId&&
   p.attemptId===claim.specimenId&&p.attemptNo===claim.attemptNo&&
   p.marketTicker===claim.ticker&&p.outcomeSide===claim.side&&
   (!p.exitClientOrderId||p.exitClientOrderId===claim.clientOrderId||expectedExitId===claim.clientOrderId)&&p.owner==='PAYNE_KALSHI_REAL');
  if(freshMatches.length!==1)return fail('RECOVERY_PROJECTION_POSITION_CHANGED');
  const p=freshMatches[0],at=new Date().toISOString();
  if(p.status!=='CLOSED'||p.reconciliationState!=='FLAT'){
   const updated={...p,status:'CLOSED',reconciliationState:'FLAT',
    reconciliationReason:'PROVIDER_CONFIRMED_TERMINAL_EXIT',
    exitOrderId:evidence.providerOrderId,exitFillCount:evidence.executedFills,
    providerClosureEvidenceId:evidence.evidenceId,closedAt:p.closedAt||at};
   const next={...fresh,
    positions:paynePositionRecords(fresh).map(row=>row.attemptId===updated.attemptId?updated:row),
    position:fresh.position?.attemptId===updated.attemptId?updated:fresh.position};
   await saveSeries(env,next);
  }
  await recordRecoveryLedger(env,{seriesId:claim.seriesId,attemptNo:claim.attemptNo,
   clientOrderId:claim.clientOrderId,providerOrderId:evidence.providerOrderId,
   ticker:claim.ticker,side:claim.side,evidenceId:evidence.evidenceId,
   resolution:evidence.resolution,executedFills:evidence.executedFills});
  const projected=await resolveExit(env,identity,proof,{markProjected:true});
  if(projected?.granted!==true)return fail('RECOVERY_PROJECTION_ACK_PENDING');
  return {ok:true,classification:'PROVIDER_TERMINAL_RECONCILED',seriesId:claim.seriesId,
   clientOrderId:claim.clientOrderId,evidenceId:evidence.evidenceId,
   providerWrites:0,orders:0};
 }
 return {ok:true,classification:'CLEAN',reason:'NO_MATCHED_EXIT_RECOVERY_PENDING',providerWrites:0,orders:0};
}
