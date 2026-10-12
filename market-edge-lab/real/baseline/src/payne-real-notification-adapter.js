// Read-only PAYNE REAL ledger -> existing AUTO Web Push sender.
// Runs in the EXISTING baseline Worker. No trading writes, new subscription, or VAPID secrets.
// First good observation establishes a timestamp baseline and sends NOTHING historical.
export const PAYNE_PUSH_NAMESPACE='notification:payne-real:v1:';
const BASELINE=PAYNE_PUSH_NAMESPACE+'baseline';
const SENT=PAYNE_PUSH_NAMESPACE+'sent:';
const ALLOWED=Object.freeze({
  FIRE_SPECIMEN_LATCHED:'FISH',
  ENTRY_NO_FILL:'ORDER NOT FILLED',
  ENTRY_RECONCILED_ORDER_ZERO_FILL:'ORDER NOT FILLED',
  ENTRY_PROVIDER_REJECTED_OR_UNKNOWN:'PROVIDER ORDER REJECTED',
  POSITION_OWNERSHIP_ESTABLISHED:'POSITION FILLED',
  ENTRY_RECONCILED_OWNED:'POSITION FILLED',
  PAYNE_PAPER_BRAIN_EXIT_CLOSED:'POSITION CLOSED',
  ENTRY_PROVIDER_RESULT:'PROVIDER ORDER ACCEPTED'
});
export function payneRealNotification(row){
  if(!row||typeof row!=='object'||!ALLOWED[row.type]||!row.seriesId)return null;
  // The event must contain an authoritative identity and timestamp.
  const authority=row.attemptId||row.positionId||row.entryOrderId||row.providerOrderId||row.specimenId;
  const timestamp=Date.parse(row.at||row.observedAt||'');
  if(!authority||!Number.isFinite(timestamp))return null;
  if(row.type==='ENTRY_PROVIDER_RESULT'&&!(row.providerOrderId||row.result?.orderId))return null;
  if(row.type==='ENTRY_PROVIDER_REJECTED_OR_UNKNOWN'&&!(Number.isInteger(row.httpStatus)&&row.httpStatus>=400))return null;
  if(['POSITION_OWNERSHIP_ESTABLISHED','ENTRY_RECONCILED_OWNED'].includes(row.type)&&
     (!(row.entryOrderId||row.providerOrderId||row.position?.entryOrderId)||!(Number(row.filledCount??row.position?.filledCount)>0)))return null;
  if(row.type==='PAYNE_PAPER_BRAIN_EXIT_CLOSED'&&!['CLOSED','SETTLED','FLAT'].includes(String(row.status||row.positionStatus||'').toUpperCase()))return null;
  const id=['payne-real',row.seriesId,row.type,authority,row.at||row.observedAt].join(':');
  const score=Number(row.score);
  const body=[row.asset||row.ticker||'',row.direction||row.outcomeSide||'',row.score==null||!Number.isFinite(score)?'':'Score '+score.toFixed(2)].filter(Boolean).join(' · ');
  return {id,time:timestamp,kind:ALLOWED[row.type],payload:{title:'NFE-OS · PAYNE REAL · '+ALLOWED[row.type],body,url:'/',tag:id}};
}
export function validPayneLedger(doc){
  return doc?.ok===true&&doc?.complete===true&&doc?.schema==='PAYNE_REAL_LEDGER_EXPORT_V1'&&doc?.readOnly===true&&
    doc.providerWrites===0&&doc.ordersSubmittedByThisRead===0&&doc.capitalMovedUsd===0&&
    Number.isInteger(doc.count)&&doc.count===doc.rows?.length&&doc.rows.length<200;
}
export async function dispatchPayneUsingExistingPush({kv,readLedger,send,now=()=>Date.now()}){
  if(!kv||typeof readLedger!=='function'||typeof send!=='function')return {ok:false,reason:'MISSING_READ_ONLY_DEPENDENCY'};
  const doc=await readLedger();
  if(!validPayneLedger(doc))return {ok:false,reason:'INVALID_OR_TRUNCATED_LEDGER'};
  const existing=await kv.get(BASELINE);
  if(!existing){
    // Timestamp-only cutoff suppresses all historical events, even if older ledger rows
    // fell outside this bounded read. Never send anything on first initialization.
    const cutoff=now();
    await kv.put(BASELINE,JSON.stringify({atMs:cutoff,source:'PAYNE_REAL',initialized:true}));
    return {ok:true,baselineEstablished:true,sent:0};
  }
  let state;try{state=JSON.parse(existing);}catch{return {ok:false,reason:'INVALID_BASELINE'};}
  if(!Number.isFinite(state?.atMs)||state.source!=='PAYNE_REAL')return {ok:false,reason:'INVALID_BASELINE'};
  let sent=0,duplicates=0;
  for(const row of doc.rows){
    const alert=payneRealNotification(row);
    if(!alert||alert.time<=state.atMs)continue;
    const key=SENT+encodeURIComponent(alert.id);
    if(await kv.get(key)){duplicates++;continue;}
    // The existing sender has its own deduplication, keyed by PAYNE-prefixed eventId.
    const response=await send(alert.id,alert.payload);
    if(response?.delivered||response?.duplicateSuppressed){
      await kv.put(key,JSON.stringify({atMs:now(),source:'PAYNE_REAL'}));
      sent+=response.delivered?1:0;
    }
    // A failed/unknown delivery is not marked as delivered.
  }
  return {ok:true,sent,duplicates};
}
