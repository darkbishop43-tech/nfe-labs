// PAYNE Real read-only history projection. No trading writes or new storage.
const PREFIX={attempt:'payne-kalshi:attempt:',ledger:'payne-kalshi:real-ledger:',position:'payne-kalshi:position:'};
const fields=['seriesId','attemptId','attemptNo','at','asset','ticker','side','entryScore','entryPrice','executionStage','terminalStatus','managementStatus','exitResult','reconciliationStatus','clientOrderId','providerOrderId','fillId','entryTime','exitTime','exitPrice','quantity','fees','realizedPnlUsd','evidenceSource'];
async function keys(kv,prefix){
 if(typeof kv?.list!=='function') throw Error('HISTORY_KV_LIST_MISSING');
 const out=[],seen=new Set();let cursor;
 while(true){
  const page=await kv.list({prefix,limit:1000,...(cursor?{cursor}:{})});
  if(!Array.isArray(page?.keys)||typeof page?.list_complete!=='boolean')throw Error('HISTORY_KV_PAGE_INVALID');
  out.push(...page.keys.map(k=>k.name).filter(k=>k.startsWith(prefix)));
  if(page.list_complete)break;
  if(!page.cursor||seen.has(page.cursor))throw Error('HISTORY_CURSOR_INCOMPLETE');
  cursor=page.cursor;seen.add(cursor);
 }
 return out.sort();
}
async function read(kv,key){
 const v=await kv.get(key,'json');if(v===null||v===undefined)throw Error('HISTORY_RECORD_UNREADABLE');return v;
}
const val=(...xs)=>xs.find(x=>x!==null&&x!==undefined&&x!=='')??null;
const numeric=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
const stamp=x=>{const v=Date.parse(String(x||''));return Number.isFinite(v)?v:null;};
const filterTime=(row,bounds)=>{
 const t=stamp(row.at);
 return bounds.range==='current'||(t!==null&&(bounds.fromMs===null||t>=bounds.fromMs)&&(bounds.toMs===null||t<=bounds.toMs));
};
function project(attempt,events,position){
 const id=val(attempt.attemptId,position?.attemptId);
 const logs=events.filter(e=>e.attemptId===id&&e.seriesId===attempt.seriesId);
 const by=(...types)=>[...logs].reverse().find(e=>types.includes(e.type));
 const provider=by('EXIT_PROVIDER_RESULT','ENTRY_PROVIDER_RESULT');
 const exit=by('EXIT_PROVIDER_RESULT','PROVIDER_RECONCILED_FLAT');
 const fill=by('ENTRY_FILLED','ENTRY_PROVIDER_RESULT','ENTRY_RECONCILED_OWNED');
 const reconciliation=by('PROVIDER_RECONCILED_FLAT','ENTRY_RECONCILED_NO_EXECUTION','ENTRY_RECONCILED_SETTLED_FLAT','ENTRY_RECONCILED_OWNED');
 const noFill=by('ENTRY_NO_FILL','ENTRY_RECONCILED_ORDER_ZERO_FILL');
 const state=val(attempt.terminalClassification,attempt.status,position?.status,'UNKNOWN');
 const terminal=noFill?'NO_FILL':val(position?.status==='CLOSED'?'CLOSED':null,state,'UNKNOWN');
 const stages=logs.filter(e=>/RADAR|LOCK|PULL|FIRE|INTENT|SUBMIT|POST|FILL|HOLD|MANAGE|EXIT|RECONCIL|SETTLE/.test(e.type||'')).map(e=>({stage:e.type,at:e.at||null,evidenceSource:'PAYNE_PERSISTED_LEDGER'}));
 for(const [stage,at] of [['FIRE',attempt.fireAt],['EXECUTION_INTENT',attempt.createdAt],['PROVIDER_SUBMISSION',attempt.providerSubmitStartedAt]]){
  if(at&&!stages.some(e=>e.stage===stage))stages.push({stage,at,evidenceSource:'PAYNE_PERSISTED_ATTEMPT'});
 }
 return {
 seriesId:attempt.seriesId||null,attemptId:id,attemptNo:numeric(val(attempt.attemptNo,attempt.intentNo)),at:val(attempt.createdAt,attempt.at,attempt.fireAt),
 asset:val(attempt.asset,position?.asset),ticker:val(attempt.marketTicker,position?.marketTicker),side:val(attempt.outcomeSide,position?.outcomeSide),
 entryScore:numeric(val(attempt.score,attempt.entryScore)),entryPrice:numeric(val(position?.entryAverageFillPrice,attempt.providerResult?.averageFillPrice)),
 executionStage:val(attempt.executionStage,attempt.executionHandoff),terminalStatus:terminal,managementStatus:val(position?.status),exitResult:val(exit?.result?.state,position?.exitReason),
 reconciliationStatus:val(position?.reconciliationState,reconciliation?.type,attempt.reconciliationReason),clientOrderId:val(attempt.clientOrderId,position?.entryClientOrderId),
 providerOrderId:val(attempt.providerOrderId,position?.entryOrderId),exitProviderOrderId:val(position?.exitOrderId),exitClientOrderId:val(position?.exitClientOrderId),fillId:val(attempt.fillId,position?.entryFillId,fill?.fillId),
 entryTime:val(position?.entryTime,attempt.filledAt),exitTime:val(position?.exitTime),exitPrice:numeric(val(position?.exitAverageFillPrice)),
 quantity:numeric(val(position?.filledCount,attempt.providerResult?.fillCount)),fees:numeric(val(position?.entryAverageFeePaid)),
 // No unverified local value is promoted to provider-verified P/L.
 realizedPnlUsd:null,evidenceSource:'PAYNE_PERSISTED_ATTEMPT_AND_LEDGER',stages,
 providerEvidenceComplete:false,coverage:'PERSISTED_ONLY_PROVIDER_UNVERIFIED'
 };
}
export async function payneHistoryAll(kv,bounds={range:'current',fromMs:null,toMs:null}){
 const [attemptKeys,ledgerKeys]=await Promise.all([keys(kv,PREFIX.attempt),keys(kv,PREFIX.ledger)]);
 const attempts=await Promise.all(attemptKeys.map(k=>read(kv,k)));
 const ledger=await Promise.all(ledgerKeys.map(k=>read(kv,k)));
 const positions=new Map();
 const unique=[...new Set(attempts.map(x=>x.attemptId).filter(Boolean))];
 await Promise.all(unique.map(async id=>{const v=await kv.get(PREFIX.position+id,'json');if(v)positions.set(id,v);}));
 const rows=attempts.map(a=>project(a,ledger,positions.get(a.attemptId))).filter(r=>filterTime(r,bounds));
 rows.sort((a,b)=>(stamp(a.at)??0)-(stamp(b.at)??0)||String(a.attemptId).localeCompare(String(b.attemptId)));
 return {rows,attemptCount:attempts.length,ledgerEventCount:ledger.length,complete:true,coverage:'ALL_RETAINED_KV_ATTEMPTS_WITH_AVAILABLE_LEDGER_EVENTS'};
}
export function payneHistoryPage(history,page=0,limit=30){
 const n=Math.max(0,Math.trunc(Number(page)||0)),size=Math.max(1,Math.min(100,Math.trunc(Number(limit)||30)));
 const start=n*size;
 return {...history,rows:history.rows.slice(start,start+size),page:n,pageSize:size,rowCount:history.rows.length,hasMore:start+size<history.rows.length};
}
export function payneExecutionCsv(rows){
 const cell=v=>'"'+String(v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):v).replace(/"/g,'""')+'"';
 return [fields.join(','),...rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\n');
}
export const PAYNE_EXECUTION_EXPORT_FIELDS=fields;

/**
 * Bounded read of PAYNE attempt records. Cursor is the opaque Cloudflare KV
 * cursor; callers must pass it back unchanged. Missing ledger events are
 * expressly NOT represented as authoritative absence of fills or exits.
 * Every invocation performs at most one KV list and 2*limit KV gets.
 */
export async function payneHistoryCursor(kv,{cursor=null,limit=20,bounds={range:'current',fromMs:null,toMs:null}}={}){
  if(typeof kv?.list!=='function'||typeof kv?.get!=='function')throw Error('HISTORY_KV_UNAVAILABLE');
  const size=Math.max(1,Math.min(30,Math.trunc(Number(limit)||20)));
  const page=await kv.list({prefix:PREFIX.attempt,limit:size,...(cursor?{cursor}:{})});
  if(!Array.isArray(page?.keys)||typeof page.list_complete!=='boolean')throw Error('HISTORY_KV_PAGE_INVALID');
  if(!page.list_complete&&(!page.cursor||page.cursor===cursor))throw Error('HISTORY_CURSOR_INCOMPLETE');
  const rows=[];
  // Sequential bounded reads avoid unbounded Promise.all fanout.
  for(const entry of page.keys){
    if(typeof entry?.name!=='string'||!entry.name.startsWith(PREFIX.attempt))continue;
    const attempt=await read(kv,entry.name);
    if(!attempt?.attemptId||!attempt?.seriesId)continue;
    const position=await kv.get(PREFIX.position+attempt.attemptId,'json');
    const row=project(attempt,[],position);
    if(filterTime(row,bounds))rows.push({...row,coverage:'PERSISTED_ATTEMPT_POSITION_ONLY_LEDGER_NOT_SCANNED',providerEvidenceComplete:false});
  }
  return {rows,attemptCount:rows.length,ledgerEventCount:null,
    complete:false,historyScanComplete:page.list_complete===true,
    evidenceComplete:false,coverage:'PARTIAL_LEDGER_EVENTS_NOT_SCANNED',
    nextCursor:page.list_complete?null:page.cursor,hasMore:!page.list_complete,
    requestBudget:{maxKvLists:1,maxKvGets:size*2}};
}

/** Independent bounded cursor over every retained PAYNE ledger event. */
export async function payneLedgerEventsCursor(kv,{cursor=null,limit=30}={}){
 if(typeof kv?.list!=='function'||typeof kv?.get!=='function')throw Error('HISTORY_KV_UNAVAILABLE');
 const size=Math.max(1,Math.min(30,Math.trunc(Number(limit)||30)));
 const page=await kv.list({prefix:PREFIX.ledger,limit:size,...(cursor?{cursor}:{})});
 if(!Array.isArray(page?.keys)||typeof page.list_complete!=='boolean')throw Error('HISTORY_LEDGER_PAGE_INVALID');
 if(!page.list_complete&&(!page.cursor||page.cursor===cursor))throw Error('HISTORY_LEDGER_CURSOR_INCOMPLETE');
 const rows=[];
 for(const item of page.keys){
  if(!item?.name?.startsWith(PREFIX.ledger))throw Error('HISTORY_LEDGER_KEY_INVALID');
  const event=await read(kv,item.name);
  rows.push({...event,sourceLedgerKey:item.name});
 }
 return {rows,complete:page.list_complete===true,nextCursor:page.list_complete?null:page.cursor,
  hasMore:!page.list_complete,coverage:page.list_complete?'LEDGER_CURSOR_END':'LEDGER_CURSOR_PARTIAL',
  requestBudget:{maxKvLists:1,maxKvGets:size}};
}
