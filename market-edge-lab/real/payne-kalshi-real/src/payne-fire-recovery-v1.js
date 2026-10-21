import {resolvePayneFireRecovery} from './payne-execution-coordinator.js';
import {verifyProviderTerminalEntry} from './payne-provider-recovery-v1.js';
import {paynePositionRecords} from './payne-live-order-watch.js';

// One exact persisted FIRE specimen per tick. Never substitute coordinator EXIT or other positions.
export async function recoverProviderConfirmedFireLatch(env,{
 loadControl,loadSeries,saveSeries,recordRecoveryLedger,
 verifyProvider=verifyProviderTerminalEntry,resolveFire=resolvePayneFireRecovery
}={}){
 const fail=reason=>({ok:false,classification:'UNKNOWN',reason,providerWrites:0,orders:0});
 if(![loadControl,loadSeries,saveSeries,recordRecoveryLedger].every(f=>typeof f==='function'))
  return fail('FIRE_RECOVERY_ADAPTER_INCOMPLETE');
 const control=await loadControl(env);
 if(control?.armed!==false)return fail('FIRE_RECOVERY_REQUIRES_DISARMED');
 const series=await loadSeries(env),latch=series?.fireLatch,attempt=series?.currentAttempt;
 if(latch?.state!=='LATCHED')return {ok:true,classification:'CLEAN',providerWrites:0,orders:0};
 const attemptNo=Number(latch.attemptNo);
 if(!series?.seriesId||!Number.isSafeInteger(attemptNo)||attemptNo<1||
   attempt?.attemptId!==series.seriesId+'-intent-'+attemptNo)
  return fail('FIRE_ATTEMPT_IDENTITY_UNKNOWN');
 const proof=await verifyProvider(env,{attempt,latch});
 if(proof?.ok!==true||proof?.complete!==true)return fail(proof?.reason||'FIRE_PROVIDER_EXPOSURE_UNKNOWN');
 const identity={seriesId:series.seriesId,attemptNo,specimenId:latch.specimenId,
  clientOrderId:attempt.clientOrderId,ticker:latch.ticker,side:attempt.outcomeSide,
  windowClose:latch.marketCloseTime};
 const payload={resolution:proof.resolution,evidenceId:proof.evidenceId,
  providerOrderId:proof.providerOrderId,providerTerminalProven:true,
  providerExposureFlatProven:true,providerFillsVerified:true,
  directWriterVerified:attempt.executionHandoff==='DIRECT_KALSHI_WRITER_V1'};
 const committed=await resolveFire(env,identity,payload);
 if(committed?.granted!==true)return fail('FIRE_COORDINATOR_RECEIPT_REJECTED');
 const freshControl=await loadControl(env),fresh=await loadSeries(env);
 const freshLatch=fresh?.fireLatch,freshAttempt=fresh?.currentAttempt;
 if(freshControl?.armed!==false||fresh?.seriesId!==series.seriesId||
    freshLatch?.state!=='LATCHED'||freshLatch?.specimenId!==latch.specimenId||
    freshLatch?.attemptNo!==latch.attemptNo||
    freshAttempt?.attemptId!==attempt.attemptId||
    freshAttempt?.clientOrderId!==attempt.clientOrderId||
    freshAttempt?.providerOrderId!==attempt.providerOrderId)
  return fail('FIRE_KV_PROJECTION_IDENTITY_CHANGED');
 const matching=paynePositionRecords(fresh).filter(p=>p.attemptId===attempt.attemptId);
 if(matching.length>1||(proof.executedFills===0&&matching.length>0))
  return fail('FIRE_POSITION_IDENTITY_CONFLICT');
 if(matching.length===1&&(matching[0].seriesId!==fresh.seriesId||
    matching[0].entryOrderId!==proof.providerOrderId||
    matching[0].marketTicker!==proof.ticker||
    matching[0].outcomeSide!==proof.side))
  return fail('FIRE_OWNED_POSITION_MISMATCH');
 const at=new Date().toISOString();
 const updated=matching.length===1?{...matching[0],status:'CLOSED',reconciliationState:'FLAT',
   reconciliationReason:'PROVIDER_CONFIRMED_TERMINAL_FIRE',providerClosureEvidenceId:proof.evidenceId,
   closedAt:matching[0].closedAt||at}:null;
 const next={...fresh,unresolvedEntry:false,
  fireLatch:{...freshLatch,state:'PROVIDER_TERMINAL_RECONCILED',reconciliationEvidenceId:proof.evidenceId},
  currentAttempt:{...freshAttempt,reconciliationResult:proof.resolution==='CLOSED'?'SETTLED_FLAT':'NO_PROVIDER_EXECUTION',
    reconciliationReason:'PROVIDER_CONFIRMED_TERMINAL_FIRE',reconciledAt:freshAttempt.reconciledAt||at}};
 if(updated){
  next.positions=paynePositionRecords(fresh).map(p=>p.attemptId===updated.attemptId?updated:p);
  if(fresh.position?.attemptId===updated.attemptId)next.position=updated;
 }
 await saveSeries(env,next);
 await recordRecoveryLedger(env,{seriesId:identity.seriesId,attemptNo,
  clientOrderId:identity.clientOrderId,providerOrderId:proof.providerOrderId,
  ticker:identity.ticker,side:identity.side,evidenceId:proof.evidenceId,
  resolution:proof.resolution,executedFills:proof.executedFills,fireSpecimenId:identity.specimenId});
 const confirmed=await resolveFire(env,identity,payload,{markProjected:true});
 if(confirmed?.granted!==true)return fail('FIRE_PROJECTION_ACK_PENDING');
 return {ok:true,classification:'PROVIDER_TERMINAL_FIRE_RECONCILED',
  seriesId:identity.seriesId,specimenId:identity.specimenId,providerWrites:0,orders:0};
}
