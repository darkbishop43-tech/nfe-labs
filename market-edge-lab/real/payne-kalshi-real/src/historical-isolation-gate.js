// Historical UNKNOWN isolation is permitted only after independent, complete,
// fresh provider evidence. This module performs no writes or state changes.
export function historicalIsolationEligibility({series,exposure,nowMs=Date.now(),maxAgeMs=30_000}={}) {
  const deny=reason=>({eligible:false,reason});
  if(!series || series.unresolvedEntry!==true || !series.seriesId ||
     !series.currentAttempt?.attemptId || !series.currentAttempt?.clientOrderId) {
    return deny('HISTORICAL_IDENTITY_INCOMPLETE');
  }
  if(series.position || series.fireLatch?.state==='LATCHED') return deny('PERSISTED_MANAGEMENT_OR_LATCH');
  if(!exposure || exposure.readOnly!==true || exposure.classification!=='CLEAR' ||
     exposure.ordersPaginationComplete!==true || exposure.positionsPaginationComplete!==true) {
    return deny('CURRENT_EXPOSURE_NOT_PROVEN_CLEAR');
  }
  const observed=Date.parse(exposure.asOf||'');
  if(!Number.isFinite(observed) || !Number.isFinite(nowMs) || nowMs<observed ||
     nowMs-observed>maxAgeMs) return deny('EXPOSURE_EVIDENCE_NOT_FRESH');
  if(exposure.outstandingPayneManagement!==false ||
     exposure.historicalUnresolvedEntry!==true ||
     exposure.historicalSeriesId!==series.seriesId ||
     exposure.activeOrderCount!==0 || exposure.ambiguousOrderCount!==0 ||
     exposure.openPositionCount!==0 || exposure.ambiguousPositionCount!==0) {
    return deny('EXPOSURE_OR_SERIES_MISMATCH');
  }
  return {eligible:true,reason:'FRESH_COMPLETE_CURRENT_EXPOSURE_CLEAR_HISTORICAL_UNKNOWN_PRESERVED',
    historicalSeriesId:series.seriesId,historicalAttemptId:series.currentAttempt.attemptId,
    historicalResult:'UNKNOWN',currentExposure:'CLEAR',asOf:exposure.asOf};
}
