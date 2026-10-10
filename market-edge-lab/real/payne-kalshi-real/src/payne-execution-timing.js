// Read-only diagnostic events. No credentials, payloads, authorization, or writes.
export const payneTimingIdentity=(series,latch)=>Object.freeze({
 seriesId:String(series?.seriesId||'').slice(0,90),
 attemptNo:Number(series?.attemptsStarted||0)+1,
 ticker:String(latch?.ticker||'').slice(0,100),
 side:String(latch?.outcomeSide||'').slice(0,8),
 windowClose:String(latch?.marketCloseTime||'').slice(0,48)
});
export function payneTimingEvent(stage,identity,startMs,nowMs=Date.now(),outcome='OBSERVED'){
 const safeStage=String(stage||'').replace(/[^A-Z0-9_]/gi,'').slice(0,70);
 return {schema:'PAYNE_EXECUTION_TIMING_V1',stage:safeStage,
  correlation:identity,elapsedMs:Math.max(0,nowMs-startMs),
  at:new Date(nowMs).toISOString(),outcome:String(outcome||'').slice(0,95)};
}
export function logPayneTiming(stage,identity,startMs,nowMs=Date.now(),outcome='OBSERVED'){
 const record=payneTimingEvent(stage,identity,startMs,nowMs,outcome);
 console.log('PAYNE_TIMING '+JSON.stringify(record));
 return record;
}

export function paynePriorityBeforeScan(control,series){
  const unresolved=series?.unresolvedEntry===true;
  const management=Boolean(series?.position &&
    ['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN']
      .includes(String(series.position.status||'')));
  const durableLatch=Boolean(control?.armed && series?.fireLatch?.state==='LATCHED');
  return unresolved||management||durableLatch;
}
