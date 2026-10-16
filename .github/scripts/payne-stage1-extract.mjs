// Offline-only PAYNE read-only extractor. Uses existing public Worker GET routes.
// No credentials, no POST, no production mutation.
import {mkdir,writeFile} from 'node:fs/promises';
const BASE='https://market-edge-payne-kalshi-real.darkbishop43.workers.dev';
const PREFIX='payne-kalshi:real-ledger:';
export async function collect({get,seriesId='',mode='all'}){
 const ledger=[],history=[],seenKeys=new Set(),seenRows=new Set();
 const getJson=async(path)=>{const data=await get(path);if(!data||data.ok!==true)throw Error('READ_UNAVAILABLE_'+path.split('?')[0]);return data;};
 const ctl=await getJson('/real-state');
 const selected=mode==='current'?String(ctl.series?.seriesId||''):seriesId;
 if(mode==='current'&&!selected)throw Error('CURRENT_SERIES_ID_UNAVAILABLE');
 let cursor=PREFIX; const cursors=new Set(), pages=[];
 for(;;){
  if(cursors.has(cursor))throw Error('LEDGER_CURSOR_REPEAT');cursors.add(cursor);
  const d=await getJson('/real-ledger?limit=200&afterKey='+encodeURIComponent(cursor));
  if(d.complete!==true||!Array.isArray(d.rows)||typeof d.hasMore!=='boolean')throw Error('LEDGER_PAGINATION_UNVERIFIED');
  pages.push({returned:d.rows.length,scannedKeys:d.scannedKeys,hasMore:d.hasMore});
  for(const row of d.rows){const key=row.sourceLedgerKey;if(!key)throw Error('LEDGER_SOURCE_KEY_MISSING');if(seenKeys.has(key))throw Error('DUPLICATE_LEDGER_KEY');seenKeys.add(key);if(!selected||row.seriesId===selected)ledger.push(row);}
  if(!d.hasMore)break;
  if(!d.nextKey||d.nextKey===cursor)throw Error('LEDGER_CURSOR_STALLED');
  cursor=d.nextKey;
 }
 let p=0,expected=null;
 for(;;){
  const d=await getJson('/real-history?view=cycles&range=all&page='+p+'&limit=100');
  if(!Array.isArray(d.rows)||typeof d.hasMore!=='boolean'||!Number.isInteger(d.rowCount))throw Error('HISTORY_PAGINATION_UNVERIFIED');
  if(expected===null)expected=d.rowCount;else if(expected!==d.rowCount)throw Error('HISTORY_CHANGED_DURING_EXTRACTION');
  for(const row of d.rows){const key=String(row.seriesId||'')+'|'+String(row.attemptId||'');if(seenRows.has(key))throw Error('DUPLICATE_HISTORY_ATTEMPT');seenRows.add(key);if(!selected||row.seriesId===selected)history.push(row);}
  if(!d.hasMore)break;
  if(!d.rows.length)throw Error('HISTORY_STALLED');
  p++;
 }
 if(seenRows.size!==expected)throw Error('HISTORY_ROWCOUNT_MISMATCH');
 const matching=history.filter(x=>x.providerEvidenceComplete===true);
 const unknown=history.filter(x=>x.providerEvidenceComplete!==true);
 return {schema:'PAYNE_STAGE1_RESEARCH_EXTRACTION_V1',generatedAt:new Date().toISOString(),source:'EXISTING_PAYNE_READ_ONLY_GET',seriesSelected:selected||null,ledger,cycles:history,
  coverage:{ledgerPages:pages,globalLedgerKeys:seenKeys.size,selectedLedgerRows:ledger.length,globalCycleCount:seenRows.size,selectedCycles:history.length,verifiedCycles:matching.length,unresolvedCycles:unknown.length,missingEvidence:unknown.map(r=>({seriesId:r.seriesId,attemptId:r.attemptId,reasons:r.missingProviderFields||[],coverage:r.coverage})),providerRawOrdersAndFills:'NOT_EXPOSED_BY_EXISTING_GET_ROUTE',providerReadCoverage:'PER_PAGE_IN_CYCLE_ROWS_NOT_EXHAUSTIVE_SNAPSHOT'}}; 
}
export async function main(){
 const mode=process.env.PAYNE_MODE||'all',seriesId=process.env.PAYNE_SERIES_ID||'';
 if(!['all','current','series'].includes(mode))throw Error('INVALID_MODE');
 if(mode==='series'&&!/^[a-zA-Z0-9-]{8,100}$/.test(seriesId))throw Error('INVALID_SERIES_ID');
 const out=await collect({mode,seriesId,get:async path=>{
   const u=new URL(path,BASE);if(u.origin!==new URL(BASE).origin)throw Error('UNAPPROVED_ORIGIN');
   const r=await fetch(u,{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(90000)});
   if(!r.ok)throw Error('GET_FAILED_'+r.status);
   return r.json();
 }});
 await mkdir('payne-stage1-output',{recursive:true});
 await writeFile('payne-stage1-output/reconstruction.json',JSON.stringify(out,null,2));
 console.log(JSON.stringify({schema:out.schema,coverage:out.coverage,seriesSelected:out.seriesSelected}));
}
if(process.argv[1]?.endsWith('payne-stage1-extract.mjs'))main().catch(e=>{console.error('READ_ONLY_EXTRACTION_INCOMPLETE',String(e.message));process.exitCode=1});
