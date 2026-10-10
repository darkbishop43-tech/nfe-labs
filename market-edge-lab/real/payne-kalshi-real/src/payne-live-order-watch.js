// PAYNE-only persisted evidence projection. Never infer a fill from a FIRE or intent.
const ACTIVE=new Set(['LOCKED','SUBMITTING','OPEN','MANAGING','EXITING','UNKNOWN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN']);
export function paynePositionRecords(series){
  const records=Array.isArray(series?.positions)?series.positions.filter(Boolean):[];
  const legacy=series?.position;
  if(legacy && !records.some(p=>p.attemptId&&p.attemptId===legacy.attemptId))records.unshift(legacy);
  return records.filter(p=>p?.owner==='PAYNE_KALSHI_REAL');
}
export function payneCapacityEvidence(series,authorizedCapacity){
  const records=paynePositionRecords(series);
  const occupied=records.filter(p=>p.status!=='CLOSED' || p.reconciliationState!=='FLAT');
  const unresolved=Boolean(series?.unresolvedEntry);
  const cap=Number(authorizedCapacity);
  return {occupied:occupied.length,capacity:Number.isSafeInteger(cap)&&cap>0?cap:null,
    available:!unresolved&&Number.isSafeInteger(cap)&&cap>0&&occupied.length<cap,
    reason:unresolved?'UNRESOLVED_ENTRY':!Number.isSafeInteger(cap)||cap<1?'CAPACITY_UNAUTHORIZED':
      occupied.length>=cap?'CAPACITY_FULL':'AVAILABLE'};
}
export function liveOrderWatchProjection(series,attempts=[],ledger=[],limit=12){
  const rows=new Map();
  const put=(id,patch)=>{
    if(!id)return;
    const previous=rows.get(id)||{attemptId:id};
    rows.set(id,{...previous,...patch});
  };
  for(const p of paynePositionRecords(series)){
    put(p.attemptId||p.entryClientOrderId,{
      owner:p.owner,asset:p.asset||null,direction:p.direction||null,ticker:p.marketTicker||null,
      side:p.outcomeSide||null,state:p.status||'UNKNOWN',entryPrice:p.entryAverageFillPrice??null,
      quantity:p.filledCount??null,cost:p.entryCostUsd??null,
      currentBid:p.currentBid??null,currentAsk:p.currentAsk??null,
      currentValue:p.currentValueUsd??null,unrealizedPnl:p.unrealizedPnlUsd??null,
      realizedPnl:p.realizedPnlUsd??null,openedAt:p.entryTime||null,
      closeTime:p.closeTime||null,exitReason:p.exitReason||null,exitResult:p.exitResult||null,
      orderId:p.entryOrderId||null,reconciliation:p.reconciliationState||'UNKNOWN',
      closedAt:p.closedAt||null
    });
  }
  const allAttempts=[...attempts,series?.currentAttempt].filter(Boolean);
  for(const a of allAttempts){
    if(a.owner && a.owner!=='PAYNE_KALSHI_REAL')continue;
    const id=a.attemptId||a.clientOrderId;if(!id)continue;
    if(rows.has(id))continue;
    const raw=String(a.status||'UNKNOWN').toUpperCase();
    const state=raw.includes('NO_PROVIDER_EXECUTION')||raw.includes('PROVIDER_RECONCILED_NO_EXECUTION')?'NO_PROVIDER_EXECUTION':
      raw.includes('NO_FILL')?'NO_FILL':raw.includes('FILL')?'OPEN':
      raw.includes('UNKNOWN')?'UNKNOWN':raw.includes('SUBMIT')?'SUBMITTING':
      raw.includes('INVALIDATED')?'CLOSED':'LOCKED';
    put(id,{owner:'PAYNE_KALSHI_REAL',asset:a.asset||null,ticker:a.marketTicker||null,
      direction:a.direction||null,side:a.outcomeSide||null,state,
      entryPrice:a.preSubmitPrice??null,quantity:a.count??null,cost:a.estimatedEntryDebitUsd??null,
      currentBid:null,currentAsk:null,currentValue:null,unrealizedPnl:null,realizedPnl:null,
      openedAt:a.observedAt||null,closeTime:a.closeTime||null,
      exitReason:null,exitResult:a.terminalClassification||null,
      orderId:a.providerOrderId||null,reconciliation:a.providerResponseState||'UNKNOWN',
      closedAt:a.reconciledAt||null});
  }
  const ordered=[...rows.values()].sort((a,b)=>String(b.closedAt||b.openedAt||'').localeCompare(String(a.closedAt||a.openedAt||'')));
  const active=ordered.filter(r=>ACTIVE.has(r.state) ||
    (r.state==='NO_PROVIDER_EXECUTION'&&series?.unresolvedEntry===true) ||
    (r.reconciliation==='UNKNOWN'&&!['NO_FILL','NO_PROVIDER_EXECUTION'].includes(r.state)));
  const closed=ordered.filter(r=>!active.includes(r)).slice(0,Math.max(0,limit));
  return {schema:'PAYNE_LIVE_ORDER_WATCH_V1',source:'PERSISTED_PAYNE_EVIDENCE_ONLY',
    active,closed,providerGets:0,providerWrites:0,ordersSubmitted:0};
}

export function upsertPaynePosition(series,position){
  if(!position?.attemptId || position?.owner!=='PAYNE_KALSHI_REAL')return {...series};
  const rows=paynePositionRecords(series);
  const index=rows.findIndex(p=>p.attemptId===position.attemptId);
  if(index>=0)rows[index]=position;else rows.push(position);
  return {...series,positions:rows,position};
}
export function unresolvedPaynePositions(series){
  return paynePositionRecords(series).filter(p=>p.status!=='CLOSED'||p.reconciliationState!=='FLAT');
}
