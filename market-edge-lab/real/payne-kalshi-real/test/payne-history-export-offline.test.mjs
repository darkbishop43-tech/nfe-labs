import test from 'node:test';
import assert from 'node:assert/strict';
import {payneHistoryAll,payneHistoryPage,payneHistoryCursor,payneLedgerEventsCursor,payneExecutionCsv,PAYNE_EXECUTION_EXPORT_FIELDS} from '../src/payne-real-history-view.js';
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

test('ledger event cursor retrieves all retained events with no duplicate and bounded reads',async()=>{
 const kv=fakeKV();let lists=0,gets=0;
 const bounded={async list(opts){lists++;return kv.list(opts)},async get(key,fmt){gets++;return kv.get(key,fmt)}};
 const all=[];let cursor=null;
 for(let i=0;i<8;i++){
  const page=await payneLedgerEventsCursor(bounded,{cursor,limit:1});
  assert.equal(page.rows.length,1);
  assert.equal(page.requestBudget.maxKvLists,1);
  all.push(page.rows[0].sourceLedgerKey);
  if(!page.hasMore){assert.equal(page.complete,true);break;}
  cursor=page.nextCursor;
 }
 assert.equal(lists,2);
 assert.equal(gets,2);
 assert.equal(new Set(all).size,2);
 assert.equal(all.length,2);
});
test('ledger cursor refuses incomplete pagination authority',async()=>{
 const kv={async list(){return {keys:[],list_complete:false,cursor:null}},async get(){return null}};
 await assert.rejects(()=>payneLedgerEventsCursor(kv),/HISTORY_LEDGER_CURSOR_INCOMPLETE/);
});

test('large history recovers all exact event identities within per-page request budgets',async()=>{
 const store=new Map();
 for(let i=0;i<205;i++)store.set('payne-kalshi:real-ledger:event:'+String(i).padStart(4,'0'),{recordId:'event-'+i,seriesId:'series-'+i%3,attemptId:'attempt-'+i,at:'2026-10-21T00:00:00Z',type:'ENTRY_PROVIDER_RESULT',owner:'PAYNE_KALSHI_REAL',providerOrderId:'order-'+i});
 let listCount=0,getCount=0;
 const kv={
   async list({prefix,limit,cursor}){listCount++;const names=[...store.keys()].filter(k=>k.startsWith(prefix)).sort();const start=cursor?Number(cursor):0;const items=names.slice(start,start+limit);return {keys:items.map(name=>({name})),list_complete:start+limit>=names.length,cursor:start+limit>=names.length?undefined:String(start+limit)}},
   async get(key){getCount++;return store.get(key)||null}
 };
 let cursor=null,pages=0;const collected=[];
 do{
   const beforeList=listCount,beforeGet=getCount;
   const page=await payneLedgerEventsCursor(kv,{cursor,limit:25});
   assert.equal(listCount-beforeList,1);
   assert.ok(getCount-beforeGet<=25);
   assert.ok(page.rows.length<=25);
   collected.push(...page.rows);
   pages++;
   cursor=page.nextCursor;
   if(!page.hasMore){assert.equal(page.complete,true);break;}
   assert.equal(page.complete,false);
 }while(pages<20);
 assert.equal(pages,9);
 assert.equal(collected.length,205);
 assert.equal(new Set(collected.map(x=>x.sourceLedgerKey)).size,205);
 assert.equal(new Set(collected.map(x=>x.providerOrderId)).size,205);
 assert.equal(listCount,9);assert.equal(getCount,205);
 assert.ok(collected.every(x=>x.owner==='PAYNE_KALSHI_REAL'));
});
test('exact identity required to join ledger event with execution, never ticker-only',async()=>{
 const kv=fakeKV(), events=[];let cursor=null;
 do{const p=await payneLedgerEventsCursor(kv,{cursor,limit:1});events.push(...p.rows);cursor=p.nextCursor;if(!p.hasMore)break}while(true);
 const h=await payneHistoryAll(fakeKV());
 const near=h.rows.find(x=>x.attemptId==='old-1');
 const match=events.filter(x=>x.seriesId===near.seriesId&&x.attemptId===near.attemptId);
 assert.equal(match.length,1);
 assert.equal(match[0].type,'ENTRY_RECONCILED_OWNED');
 assert.equal(events.filter(x=>x.attemptId==='new-1'&&x.seriesId===near.seriesId).length,0);
 assert.equal(near.realizedPnlUsd,null);
});

test('exact NEAR settled-flat attempt projects CLOSED, FLAT and preserves provider identity',async()=>{
 const {liveOrderWatchProjection,payneCapacityEvidence}=await import('../src/payne-live-order-watch.js');
 const order='01a15c5e-b4e8-7739-a8b6-af44870e873e';
 const attempt={owner:'PAYNE_KALSHI_REAL',attemptId:'near-1',seriesId:'5867063c-5a7a-4180-ab22-ea08ebab63a3',marketTicker:'KXNEAR15M-26OCT202300-00',
 status:'FILLED',providerOrderId:order,reconciledAt:'2026-10-21T00:00:00Z',reconciliationResult:'SETTLED_FLAT',reconciliationReason:'PROVIDER_RECONCILED_SETTLED_FLAT'};
 const closed={owner:'PAYNE_KALSHI_REAL',attemptId:'near-1',marketTicker:attempt.marketTicker,
 entryOrderId:order,status:'CLOSED',reconciliationState:'FLAT',entryAverageFeePaid:.02,realizedPnlUsd:null};
 const series={unresolvedEntry:false,positions:[closed],currentAttempt:attempt};
 const watch=liveOrderWatchProjection(series);
 assert.equal(watch.active.length,0);assert.equal(watch.closed.length,1);
 assert.equal(watch.closed[0].state,'CLOSED');
 assert.equal(watch.closed[0].reconciliation,'FLAT');
 assert.equal(watch.closed[0].orderId,order);
 assert.equal(payneCapacityEvidence(series,3).occupied,0);
 assert.equal(payneCapacityEvidence(series,3).available,true);
 assert.equal(watch.closed[0].realizedPnl,null);
 const second=liveOrderWatchProjection(series);
 assert.deepEqual(second,watch);
 assert.equal(series.positions.length,1);
 assert.equal(series.positions[0].entryAverageFeePaid,.02);
});
test('unknown NEAR exposure does not release capacity or invent closure',async()=>{
 const {liveOrderWatchProjection,payneCapacityEvidence}=await import('../src/payne-live-order-watch.js');
 const series={unresolvedEntry:true,positions:[{owner:'PAYNE_KALSHI_REAL',attemptId:'near-1',
 marketTicker:'KXNEAR15M-26OCT202300-00',status:'RECONCILIATION_UNKNOWN',reconciliationState:'UNKNOWN'}]};
 assert.equal(payneCapacityEvidence(series,3).occupied,1);
 assert.equal(payneCapacityEvidence(series,3).available,false);
 assert.equal(liveOrderWatchProjection(series).active.length,1);
});
