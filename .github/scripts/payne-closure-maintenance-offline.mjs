// OFFLINE-ONLY proposed maintenance predicate. No production integration.
// Provider evidence MUST originate from existing authenticated Kalshi reads
// in a future reviewed workflow; caller-supplied fixture JSON is NOT authority.
export function evaluatePayneClosureMaintenance({control,series,provider,sourceBlob,expectedBlob}={}) {
  const block=(reason)=>({allowed:false,reason});
  if (!control || !series || !provider) return block('MISSING_EVIDENCE');
  if (sourceBlob!==expectedBlob || !sourceBlob) return block('UNRELATED_SOURCE');
  if (control.armed!==false) return block('FOUNDER_ARMED');
  if (control.openPositions!==1) return block('CONTROL_POSITION_COUNT_NOT_ONE');
  if (series.schema!=='PAYNE_REAL_SERIES_V1'||series.owner!=='PAYNE_KALSHI_REAL') return block('SERIES_IDENTITY');
  if (series.unresolvedEntry!==false) return block('UNRESOLVED_ENTRY');
  const p=series.position;
  if (!p || p.owner!=='PAYNE_KALSHI_REAL'||p.status!=='OPEN'||p.exchangeIndex!==2) return block('POSITION_IDENTITY');
  if (!p.seriesId||p.seriesId!==series.seriesId||!p.attemptId||!Number.isInteger(p.attemptNo)||!p.entryOrderId||!p.entryClientOrderId||!p.marketTicker||!['YES','NO'].includes(p.outcomeSide)) return block('POSITION_IDENTITY');
  const a=series.currentAttempt;
  if (!a || a.executionHandoff!=='DIRECT_KALSHI_WRITER_V1'||
      a.attemptId!==p.attemptId||a.attemptNo!==p.attemptNo||
      a.providerOrderId!==p.entryOrderId||
      (a.clientOrderId||a.entryClientOrderId)!==p.entryClientOrderId) return block('ENTRY_CLAIM_NOT_MATCHED');
  const records=Array.isArray(series.positions)?series.positions:[];
  const active=records.filter(x=>x && x.status!=='CLOSED' && x.reconciliationState!=='FLAT');
  if (active.length!==1 || active[0].attemptId!==p.attemptId ||
      active[0].entryOrderId!==p.entryOrderId) return block('OTHER_UNRESOLVED_POSITION');
  if (provider.authenticated!==true||provider.complete!==true||
      provider.ticker!==p.marketTicker||provider.side!==p.outcomeSide||
      provider.entryOrderId!==p.entryOrderId||provider.entryClientOrderId!==p.entryClientOrderId) return block('PROVIDER_IDENTITY_OR_AUTHENTICITY');
  if (provider.positionReadOk!==true||provider.positionQuantity!==0) return block('PROVIDER_POSITION_NOT_PROVEN_FLAT');
  if (provider.ordersReadOk!==true||provider.ordersComplete!==true||
      !Array.isArray(provider.orders)) return block('PROVIDER_ORDER_READ_UNKNOWN');
  if (provider.orders.some(o=>!o||!o.ticker||!o.status ||
      (o.ticker===p.marketTicker && !['executed','canceled','cancelled','expired','rejected'].includes(o.status.toLowerCase())))) return block('OPEN_OR_UNKNOWN_ORDER');
  if (provider.otherUnresolvedExposure!==false) return block('OTHER_PROVIDER_EXPOSURE_UNKNOWN');
  return {allowed:true,reason:'EXACT_PROVIDER_FLAT_MAINTENANCE_ONLY'};
}
