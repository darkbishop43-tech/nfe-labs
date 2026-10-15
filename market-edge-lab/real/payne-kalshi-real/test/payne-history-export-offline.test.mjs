import test from 'node:test';
import assert from 'node:assert/strict';
import {payneHistoryAll,payneHistoryPage,payneExecutionCsv,PAYNE_EXECUTION_EXPORT_FIELDS} from '../src/payne-real-history-view.js';
function fakeKV(){
 const d=new Map([
 ['payne-kalshi:attempt:old:1',{seriesId:'old',attemptId:'old-1',attemptNo:1,createdAt:'2026-10-13T06:02:21Z',marketTicker:'KXNEAR15M-26OCT130215-15',outcomeSide:'NO',providerOrderId:'01a133da-f108-7df4-9287-3f45cfa348ed',clientOrderId:'payne-real-8bd998c37fa1-2-entry'}],
 ['payne-kalshi:attempt:new:1',{seriesId:'new',attemptId:'new-1',attemptNo:1,createdAt:'2026-10-14T06:02:21Z',marketTicker:'KXSOL15M-26OCT140615-15',outcomeSide:'YES',status:'NO_FILL'}],
 ['payne-kalshi:real-ledger:old:1',{seriesId:'old',attemptId:'old-1',at:'2026-10-13T06:03:00Z',type:'ENTRY_RECONCILED_OWNED'}],
 ['payne-kalshi:real-ledger:new:1',{seriesId:'new',attemptId:'new-1',at:'2026-10-14T06:03:00Z',type:'ENTRY_NO_FILL'}],
 ]);
 return {async list({prefix,cursor}){const names=[...d.keys()].filter(x=>x.startsWith(prefix)).sort();const start=cursor?Number(cursor):0;const slice=names.slice(start,start+1);return {keys:slice.map(name=>({name})),list_complete:start+1>=names.length,cursor:String(start+1)}},async get(k){return d.get(k)??null}};
}
test('all retained series, exact historical identity, no synthetic provider P/L',async()=>{
 const h=await payneHistoryAll(fakeKV());
 assert.equal(h.rows.length,2);
 assert.equal(h.complete,true);
 assert.equal(h.rows[0].providerOrderId,'01a133da-f108-7df4-9287-3f45cfa348ed');
 assert.equal(h.rows[0].realizedPnlUsd,null);
 assert.equal(h.rows[1].terminalStatus,'NO_FILL');
});
test('pagination reaches older and newer records',async()=>{
 const h=await payneHistoryAll(fakeKV());
 const p0=payneHistoryPage(h,0,1),p1=payneHistoryPage(h,1,1);
 assert.equal(p0.rows.length,1);assert.equal(p0.hasMore,true);assert.equal(p1.hasMore,false);
 assert.notEqual(p0.rows[0].attemptId,p1.rows[0].attemptId);
});
test('execution CSV and JSON share count and identity without observer data',async()=>{
 const h=await payneHistoryAll(fakeKV());const csv=payneExecutionCsv(h.rows);
 assert.equal(csv.trim().split('\n').length,h.rows.length+1);
 assert.ok(PAYNE_EXECUTION_EXPORT_FIELDS.includes('providerOrderId'));
 assert.match(csv,/01a133da-f108-7df4-9287-3f45cfa348ed/);
});
test('bounded date range filters persisted attempt times',async()=>{
 const h=await payneHistoryAll(fakeKV(),{range:'custom',fromMs:Date.parse('2026-10-14'),toMs:Date.parse('2026-10-15')});
 assert.equal(h.rows.length,1);assert.equal(h.rows[0].seriesId,'new');
});
test('missing ledger data is not silently reported complete',async()=>{
 const kv=fakeKV();kv.get=async k=>k.startsWith('payne-kalshi:real-ledger')?null:({seriesId:'x',attemptId:'x'});
 await assert.rejects(()=>payneHistoryAll(kv),/HISTORY_RECORD_UNREADABLE/);
});
