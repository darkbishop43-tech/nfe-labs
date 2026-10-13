import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchPayneUsingExistingPush,payneRealNotification,validPayneLedger,PAYNE_PUSH_NAMESPACE} from '../src/payne-real-notification-adapter.js';
const p='payne-kalshi:real-ledger:';
function kv(){const m=new Map();return {m,get:async k=>m.get(k)||null,put:async(k,v)=>m.set(k,v)}}
const at=(n)=>new Date(Date.parse('2026-10-12T22:00:00Z')+n*1000).toISOString();
const row=(n,type='ENTRY_NO_FILL',extra={})=>({type,seriesId:'S',attemptId:'ATT'+n,at:at(n),sourceLedgerKey:p+at(n)+':'+String(n).padStart(4,'0'),ticker:'KXBTC15M-OFFLINE',...extra});
const fakeRead=(rows,opts={})=>async({afterKey,limit})=>{
 let eligible=rows.filter(x=>x.sourceLedgerKey>afterKey).sort((a,b)=>a.sourceLedgerKey.localeCompare(b.sourceLedgerKey));
 const selected=eligible.slice(0,limit);
 return {ok:true,schema:'PAYNE_REAL_LEDGER_EXPORT_V1',readOnly:true,complete:true,providerWrites:0,
 ordersSubmittedByThisRead:0,capitalMovedUsd:0,count:selected.length,rows:selected,afterKey,
 nextKey:selected.at(-1)?.sourceLedgerKey||afterKey,hasMore:eligible.length>selected.length,...opts};
};
const clock=Date.parse('2026-10-12T22:00:10Z');
test('provider evidence never converts FIRE or POST_STARTED to accepted or filled',()=>{
 assert.match(payneRealNotification(row(11,'FIRE_SPECIMEN_LATCHED')).payload.title,/FISH/);
 assert.equal(payneRealNotification(row(11,'ENTRY_PROVIDER_POST_STARTED')),null);
 assert.equal(payneRealNotification(row(11,'ENTRY_PROVIDER_RESULT')),null);
 assert.equal(payneRealNotification(row(11,'POSITION_OWNERSHIP_ESTABLISHED',{entryOrderId:'O'})),null);
 assert.match(payneRealNotification(row(11,'POSITION_OWNERSHIP_ESTABLISHED',{entryOrderId:'O',filledCount:1})).payload.title,/FILLED/);
});
test('first invocation establishes historical cutoff without calling ledger or sender',async()=>{
 const store=kv();let reads=0,sends=0;
 const r=await dispatchPayneUsingExistingPush({kv:store,now:()=>clock,readLedger:async()=>{reads++},send:async()=>{sends++}});
 assert.equal(r.baselineEstablished,true);assert.equal(reads,0);assert.equal(sends,0);
 assert.ok([...store.m.keys()].every(x=>x.startsWith(PAYNE_PUSH_NAMESPACE)));
});
test('event overflow is drained from exact persisted watermark without dropping rows',async()=>{
 const store=kv();let delivered=[];
 const rows=Array.from({length:450},(_,i)=>row(i+11));
 const options={kv:store,now:()=>clock,readLedger:fakeRead(rows),send:async(id)=>{delivered.push(id);return {delivered:true}}};
 await dispatchPayneUsingExistingPush(options);
 const a=await dispatchPayneUsingExistingPush(options),b=await dispatchPayneUsingExistingPush(options),c=await dispatchPayneUsingExistingPush(options);
 assert.deepEqual([a.sent,b.sent,c.sent],[200,200,50]);
 assert.deepEqual([a.hasMore,b.hasMore,c.hasMore],[true,true,false]);
 assert.equal(delivered.length,450);
 assert.equal((await dispatchPayneUsingExistingPush(options)).sent,0);
});
test('incomplete, out-of-order and truncated pages fail closed without advancing watermark',async()=>{
 const store=kv();const options={kv:store,now:()=>clock,send:async()=>{throw Error('NO_SEND')}};
 await dispatchPayneUsingExistingPush({...options,readLedger:fakeRead([])});
 const start=store.m.get(PAYNE_PUSH_NAMESPACE+'source-watermark');
 for(const altered of [{complete:false},{hasMore:false,nextKey:'invalid'},{count:9}]){
  const outcome=await dispatchPayneUsingExistingPush({...options,readLedger:fakeRead([row(11)],altered)});
  assert.equal(outcome.ok,false);assert.equal(store.m.get(PAYNE_PUSH_NAMESPACE+'source-watermark'),start);
 }
});
test('unconfirmed delivery leaves failed source key unacknowledged for next poll',async()=>{
 const store=kv();await dispatchPayneUsingExistingPush({kv:store,now:()=>clock,readLedger:fakeRead([]),send:async()=>{}});
 const rows=[row(11),row(12)],attempts=[];
 const run=()=>dispatchPayneUsingExistingPush({kv:store,now:()=>clock,readLedger:fakeRead(rows),
 send:async(id)=>{attempts.push(id);return {delivered:attempts.length!==2}}});
 const a=await run();assert.equal(a.ok,false);assert.equal(a.processed,1);
 const b=await run();assert.equal(b.sent,1);assert.equal(attempts.length,3);
});
test('PAYNE namespace and event identity are independent of AUTO',async()=>{
 const store=kv();await dispatchPayneUsingExistingPush({kv:store,now:()=>clock,readLedger:fakeRead([]),send:async()=>{}});
 const a=await dispatchPayneUsingExistingPush({kv:store,now:()=>clock,readLedger:fakeRead([row(11)]),send:async(id)=>{assert.match(id,/^payne-real:/);return {delivered:true}}});
 assert.equal(a.sent,1);assert.ok([...store.m.keys()].every(k=>k.startsWith(PAYNE_PUSH_NAMESPACE)));
});
test('validates exact continuation metadata and rejects noncontiguous keys',async()=>{
 const rows=[row(11),row(12)],k=p+at(10)+':~';
 const read=fakeRead(rows);const doc=await read({afterKey:k,limit:200});
 assert.equal(validPayneLedger(doc,k),true);
 assert.equal(validPayneLedger({...doc,rows:[rows[1],rows[0]]},k),false);
 assert.equal(validPayneLedger({...doc,afterKey:'bad'},k),false);
});
