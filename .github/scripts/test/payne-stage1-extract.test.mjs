import test from 'node:test';import assert from 'node:assert/strict';import {collect,redactSecrets} from '../payne-stage1-extract.mjs';
function fixture({duplicate=false,missing=false}={}){
 const seen=[];
 const get=async path=>{
  seen.push(path);
  if(path==='/real-state')return {ok:true,series:{seriesId:'s1'}};
  if(path.startsWith('/real-ledger?')){
   const k=decodeURIComponent(new URL('http://x'+path).searchParams.get('afterKey'));
   if(k==='payne-kalshi:real-ledger:')return {ok:true,complete:true,hasMore:true,nextKey:'payne-kalshi:real-ledger:a',scannedKeys:2,rows:[{sourceLedgerKey:'payne-kalshi:real-ledger:a',seriesId:'s1',type:'ENTRY'}]};
   return {ok:true,complete:true,hasMore:false,nextKey:'payne-kalshi:real-ledger:b',scannedKeys:2,rows:[{sourceLedgerKey:duplicate?'payne-kalshi:real-ledger:a':'payne-kalshi:real-ledger:b',seriesId:'s2',type:'EXIT'}]};
  }
  if(path.includes('page=0'))return {ok:true,rowCount:2,hasMore:true,rows:[{seriesId:'s1',attemptId:'a1',providerEvidenceComplete:true,entryPrice:0.6,exitPrice:0.7,entryFeesUsd:0.01,exitFeesUsd:0.01,realizedPnlUsd:0.08}]};
  return {ok:true,rowCount:2,hasMore:false,rows:[{seriesId:'s2',attemptId:'a2',providerEvidenceComplete:false,missingProviderFields:missing?[]:['ENTRY_ORDER_NOT_FOUND']}]};
 };return {get,seen};
}
test('complete ledger and history pagination retains both pages',async()=>{const f=fixture();const x=await collect({get:f.get});assert.equal(x.coverage.globalLedgerKeys,2);assert.equal(x.coverage.globalCycleCount,2);assert.equal(x.coverage.verifiedCycles,1);assert.equal(x.coverage.unresolvedCycles,1);assert.equal(f.seen.filter(x=>x.includes('afterKey=')).length,2)});
test('exact series selection filters only after global extraction',async()=>{const f=fixture();const x=await collect({get:f.get,seriesId:'s1',mode:'series'});assert.equal(x.cycles.length,1);assert.equal(x.ledger.length,1)});
test('current series discovery from existing real-state',async()=>{const f=fixture();const x=await collect({get:f.get,mode:'current'});assert.equal(x.seriesSelected,'s1')});
test('duplicate ledger key fails closed',async()=>{await assert.rejects(collect({get:fixture({duplicate:true}).get}),/DUPLICATE_LEDGER_KEY/)});
test('unknown economics stay null and documented',async()=>{const f=fixture();const x=await collect({get:f.get});assert.equal(x.coverage.missingEvidence[0].reasons[0],'ENTRY_ORDER_NOT_FOUND');assert.equal(x.cycles[1].realizedPnlUsd,undefined)});
test('only GET paths used and provider raw data not claimed',async()=>{const f=fixture();const x=await collect({get:f.get});assert.ok(f.seen.every(p=>p.startsWith('/')));assert.match(x.coverage.providerRawOrdersAndFills,/NOT_EXPOSED/)});

test('secrets are redacted recursively while order IDs are preserved',()=>{const v=redactSecrets({entryOrderId:'order-1',nested:{authorization:'Bearer abc',KALSHI_PRIVATE_KEY:'abc'},items:[{access_token:'abc',fillId:'fill-1'}]});assert.equal(v.entryOrderId,'order-1');assert.equal(v.nested.authorization,'[REDACTED]');assert.equal(v.nested.KALSHI_PRIVATE_KEY,'[REDACTED]');assert.equal(v.items[0].access_token,'[REDACTED]');assert.equal(v.items[0].fillId,'fill-1')});
