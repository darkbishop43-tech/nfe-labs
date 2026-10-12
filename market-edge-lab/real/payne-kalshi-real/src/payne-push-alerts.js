// Pure, isolated PAYNE REAL notification classification. No transport, provider calls,
// orders, account reads, strategy changes, or execution authority.
const CATEGORY = Object.freeze({
  ENTRY_PROVIDER_POST_STARTED: null, // local POST boundary is not provider acceptance
  FIRE_SPECIMEN_LATCHED: 'FISH',
  ENTRY_PROVIDER_REJECTED_OR_UNKNOWN: 'REJECTED',
  ENTRY_NO_FILL: 'NO_FILL',
  ENTRY_RECONCILED_ORDER_ZERO_FILL: 'NO_FILL',
  ENTRY_RECONCILED_OWNED: 'FILLED',
  ENTRY_PROVIDER_RESULT: 'ACCEPTED',
  ENTRY_WRITE_ERROR_UNKNOWN: 'CHECK_KALSHI',
  ENTRY_RESULT_UNKNOWN: 'CHECK_KALSHI',
  ENTRY_RECONCILIATION_STILL_UNKNOWN: 'CHECK_KALSHI',
  MANAGEMENT_RECONCILIATION_UNKNOWN: 'CHECK_KALSHI',
  EXIT_PRE_SUBMIT_LATCHED: null, // preparation is NOT submission
  EXIT_PROVIDER_RESULT: 'EXIT_SUBMITTED',
  PAYNE_PAPER_BRAIN_EXIT_CLOSED: 'CLOSED',
  ENTRY_RECONCILED_SETTLED_FLAT: 'RECONCILED',
  PROVIDER_RECONCILED_FLAT: 'RECONCILED',
  POSITION_OWNERSHIP_ESTABLISHED: 'FILLED',
});
export function classifyPayneRealAlert(event) {
  if (!event || typeof event !== 'object') return null;
  const type=String(event.type||'');
  const category=CATEGORY[type];
  if (!category) return null;
  // Fail closed: a local plan, preview, or unconfirmed provider attempt
  // is insufficient proof of a filled or closed contract.
  if (category==='FILLED' && (!(event.entryOrderId || event.providerOrderId || event.position?.entryOrderId) || !(Number(event.filledCount ?? event.position?.filledCount ?? event.result?.fillCount)>0))) return null;
  if(category==='ACCEPTED' && !(event.providerOrderId || event.result?.orderId))return null;
  if(category==='REJECTED' && !(Number.isInteger(event.httpStatus) && event.httpStatus>=400))return null;
  if(category==='FISH' && !(event.specimenId || event.attemptId))return null;
  if ((category==='CLOSED'||category==='RECONCILED') &&
      !['CLOSED','FLAT','SETTLED'].includes(String(event.positionStatus||event.status||event.reconciliationState||'').toUpperCase())) return null;
  if (category==='EXIT_SUBMITTED' && !(event.result?.orderId || event.providerOrderId)) return null;
  const seriesId=String(event.seriesId||'');
  const authority=String(event.attemptId||event.positionId||event.entryOrderId||event.providerOrderId||event.specimenId||'');
  if (!seriesId || !authority) return null;
  return Object.freeze({
    id:['PAYNE_REAL',seriesId,type,authority,String(event.at||event.observedAt||'')].join(':'),
    category,
    title:'NFE-OS PAYNE REAL · '+category.replaceAll('_',' '),
    body:[event.asset||event.ticker?.match(/^KX([A-Z]+)/)?.[1],event.direction||event.outcomeSide,event.score==null?null:'Score '+event.score,event.ticker,event.httpStatus==null?null:'HTTP '+event.httpStatus].filter(Boolean).join(' · '),
    url:'/',
    source:'PAYNE_REAL_PERSISTED_LEDGER',
  });
}
export function dedupePayneAlert(alert,deliveredIds=new Set()) {
  return Boolean(alert && !deliveredIds.has(alert.id));
}
