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
// Continuation mode always starts strictly after the persisted source KV key.
// Unlike a "latest 200" snapshot, this never jumps over an unseen page.
const WATERMARK=PAYNE_PUSH_NAMESPACE+'source-watermark';
const LEDGER_KEY_PREFIX='payne-kalshi:real-ledger:';
export function validPayneLedger(doc,requestedKey){
  if(!(doc?.ok===true&&doc?.complete===true&&
    doc?.schema==='PAYNE_REAL_LEDGER_EXPORT_V1'&&doc?.readOnly===true&&
    doc.providerWrites===0&&doc.ordersSubmittedByThisRead===0&&doc.capitalMovedUsd===0&&
    Number.isInteger(doc.count)&&doc.count===doc.rows?.length&&doc.rows.length<=200&&
    doc.afterKey===requestedKey&&typeof doc.nextKey==='string'&&
    typeof doc.hasMore==='boolean'))return false;
  if(doc.rows.length===0)return doc.nextKey===requestedKey&&!doc.hasMore;
  let prior=requestedKey;
  for(const row of doc.rows){
    const key=row?.sourceLedgerKey;
    if(typeof key!=='string'||!key.startsWith(LEDGER_KEY_PREFIX)||key<=prior)return false;
    prior=key;
  }
  return prior===doc.nextKey;
}
export async function dispatchPayneUsingExistingPush({kv,readLedger,send,now=()=>Date.now()}){
  if(!kv||typeof readLedger!=='function'||typeof send!=='function')
    return {ok:false,reason:'MISSING_READ_ONLY_DEPENDENCY'};
  const existing=await kv.get(BASELINE);
  if(!existing){
    // No historical flood: a timestamp-key cutoff covers *all* old KV pages,
    // including events outside a bounded 200-row window.
    const cutoff=now();
    const startKey=LEDGER_KEY_PREFIX+new Date(cutoff).toISOString()+':~';
    await kv.put(BASELINE,JSON.stringify({atMs:cutoff,source:'PAYNE_REAL',initialized:true}));
    await kv.put(WATERMARK,startKey);
    return {ok:true,baselineEstablished:true,sent:0};
  }
  let state;try{state=JSON.parse(existing);}catch{return {ok:false,reason:'INVALID_BASELINE'};}
  if(!Number.isFinite(state?.atMs)||state.source!=='PAYNE_REAL')
    return {ok:false,reason:'INVALID_BASELINE'};
  let watermark=await kv.get(WATERMARK);
  if(typeof watermark!=='string'||!watermark.startsWith(LEDGER_KEY_PREFIX))
    return {ok:false,reason:'SOURCE_WATERMARK_NOT_ESTABLISHED'};
  const doc=await readLedger({afterKey:watermark,limit:200});
  if(!validPayneLedger(doc,watermark))
    return {ok:false,reason:'INCOMPLETE_OR_DISCONTINUOUS_LEDGER',sent:0};
  let sent=0,duplicates=0,processed=0;
  for(const row of doc.rows){
    const key=row.sourceLedgerKey;
    const alert=payneRealNotification(row);
    if(alert&&alert.time>state.atMs){
      const dedupeKey=SENT+encodeURIComponent(alert.id);
      if(await kv.get(dedupeKey))duplicates++;
      else{
        const response=await send(alert.id,alert.payload);
        if(!(response?.delivered===true||response?.duplicateSuppressed===true))
          return {ok:false,reason:'DELIVERY_UNCONFIRMED',sent,processed,
            hasMore:true,watermarkUnchangedForFailedEvent:true};
        await kv.put(dedupeKey,JSON.stringify({atMs:now(),source:'PAYNE_REAL'}));
        if(response.delivered)sent++;
      }
    }
    // Advance only after the preceding event was handled, or safely ignored.
    // Future polls resume from this exact source key, never from the newest row.
    await kv.put(WATERMARK,key);
    watermark=key;processed++;
  }
  return {ok:true,sent,duplicates,processed,hasMore:doc.hasMore};
}
