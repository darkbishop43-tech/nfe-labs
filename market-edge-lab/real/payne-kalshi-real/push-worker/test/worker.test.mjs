import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLedger,buildAlerts,PaynePushState} from '../src/index.js';
const fixture={ok:true,schema:'PAYNE_REAL_LEDGER_EXPORT_V1',readOnly:true,providerWrites:0,ordersSubmittedByThisRead:0,capitalMovedUsd:0,rows:[
{type:'ENTRY_PROVIDER_POST_STARTED',seriesId:'S',attemptId:'A',at:'2026-10-09T10:00:00Z'},
{type:'ENTRY_NO_FILL',seriesId:'S',attemptId:'A',at:'2026-10-09T10:01:00Z'},
{type:'ENTRY_WRITE_ERROR_UNKNOWN',seriesId:'S',attemptId:'A',at:'2026-10-09T10:02:00Z'},
{type:'POSITION_OWNERSHIP_ESTABLISHED',seriesId:'S',attemptId:'A',entryOrderId:'ORDER',at:'2026-10-09T10:03:00Z'},
{type:'PAYNE_PAPER_BRAIN_EXIT_CLOSED',seriesId:'S',attemptId:'A',status:'CLOSED',at:'2026-10-09T10:04:00Z'},
{type:'PROVIDER_RECONCILED_FLAT',seriesId:'S',attemptId:'A',reconciliationState:'FLAT',at:'2026-10-09T10:05:00Z'},
{type:'FIRE_SPECIMEN_LATCHED',seriesId:'S',attemptId:'A',at:'2026-10-09T10:06:00Z'}
]};
test('strict read-only evidence schema; reject missing safety proof',()=>{
 assert.equal(validateLedger(fixture),true);
 for(const patch of [{readOnly:false},{providerWrites:1},{ordersSubmittedByThisRead:1},{capitalMovedUsd:1},{rows:null}]){
   assert.equal(validateLedger({...fixture,...patch}),false);
 }
});
test('only evidence-confirmed PAYNE notifications; never FIRE preview',()=>{
 const categories=buildAlerts(fixture).map(x=>x.category);
 for(const c of ['ORDER_SUBMITTED','NO_FILL','CHECK_KALSHI','FILLED','CLOSED','RECONCILED'])assert.ok(categories.includes(c));
 assert.equal(categories.length,6);
});
class MemoryStorage{
 constructor(){this.map=new Map()}
 async get(k){return this.map.get(k)}
 async put(k,v){this.map.set(k,v)}
 async transaction(f){return f(this)}
}
test('isolated enrollment and dedupe state persist through object reconstruction',async()=>{
 const store=new MemoryStorage(),env={};
 let obj=new PaynePushState({storage:store},env);
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{p256dh:'abc',auth:'def'}};
 const req=new Request('https://internal/enroll',{method:'POST',body:JSON.stringify(sub)});
 assert.equal((await (await obj.fetch(req)).json()).ok,true);
 assert.equal((await (await new PaynePushState({storage:store},env).fetch(new Request('https://internal/status'))).json()).enrolled,true);
 assert.equal([...store.map.keys()].includes('subscription'),true);
});

test('synthetic push accepted once, restart suppresses duplicate, zero trading writes',async()=>{
 const store=new MemoryStorage();let sends=0;
 const env={NFE_PUSH_VAPID_PUBLIC_KEY:'test-public',NFE_PUSH_VAPID_PRIVATE_KEY:'test-private',PAYNE_COCKPIT_URL:'https://market-edge-payne-kalshi-real.darkbishop43.workers.dev/',__testSender:async(sub,payload)=>{sends++;assert.match(payload.title,/PAYNE REAL/);return true}};
 const make=()=>new PaynePushState({storage:store},env);
 await make().fetch(new Request('https://internal/enroll',{method:'POST',body:JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'abc',auth:'def'}})}));
 await makeBaseline(store,Date.parse('2026-10-09T09:00:00Z'));
 const alert=buildAlerts(fixture)[0];
 const req=()=>new Request('https://internal/dispatch',{method:'POST',body:JSON.stringify([alert])});
 const first=await (await make().fetch(req())).json();
 const second=await (await make().fetch(req())).json();
 assert.equal(first.pushServiceAccepted,1);
 assert.equal(second.duplicateSuppressed,1);
 assert.equal(sends,1);
 assert.ok([...store.map.keys()].some(k=>k.startsWith('event:')));
});
test('synthetic push failure is quarantined, not counted as delivered or blindly retried',async()=>{
 const store=new MemoryStorage();let sends=0;
 const env={NFE_PUSH_VAPID_PUBLIC_KEY:'test-public',NFE_PUSH_VAPID_PRIVATE_KEY:'test-private',__testSender:async()=>{sends++;throw Error('synthetic timeout')}};
 const obj=new PaynePushState({storage:store},env);
 await obj.fetch(new Request('https://internal/enroll',{method:'POST',body:JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'abc',auth:'def'}})}));
 await makeBaseline(store,Date.parse('2026-10-09T09:00:00Z'));
 const alert=buildAlerts(fixture)[0];
 const req=()=>new Request('https://internal/dispatch',{method:'POST',body:JSON.stringify([alert])});
 assert.equal((await (await obj.fetch(req())).json()).failed,1);
 assert.equal((await (await obj.fetch(req())).json()).duplicateSuppressed,1);
 assert.equal(sends,1);
 assert.ok([...store.map.values()].some(v=>v?.state==='DELIVERY_UNKNOWN_NO_AUTO_RETRY'));
});

async function makeBaseline(store,ms,ids=[],count=0){
 const obj=new PaynePushState({storage:store},{});
 return (await obj.fetch(new Request('https://internal/baseline',{method:'POST',body:JSON.stringify({
   authoritative:true,ids,count,observedAtMs:ms
 })}))).json();
}
test('historical events suppressed on first baseline, persisted across restart',async()=>{
 const store=new MemoryStorage(),existing=buildAlerts(fixture);
 const out=await makeBaseline(store,Date.parse('2026-10-09T11:00:00Z'),existing.map(x=>x.id),fixture.rows.length);
 assert.equal(out.initialized,true);assert.equal(out.alertsSent,0);
 const restarted=new PaynePushState({storage:store},{
  NFE_PUSH_VAPID_PUBLIC_KEY:'test',NFE_PUSH_VAPID_PRIVATE_KEY:'test',
  __testSender:async()=>{throw Error('historical alert dispatched')}
 });
 await restarted.fetch(new Request('https://internal/enroll',{method:'POST',body:JSON.stringify({
   endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'abc',auth:'def'}
 })}));
 const report=await (await restarted.fetch(new Request('https://internal/dispatch',{
  method:'POST',body:JSON.stringify(existing)
 }))).json();
 assert.equal(report.pushServiceAccepted,0);
});
test('initial baseline refuses incomplete evidence, duplicate initialization stays unchanged',async()=>{
 const store=new MemoryStorage();
 const obj=new PaynePushState({storage:store},{});
 const request=(count,authoritative=true)=>new Request('https://internal/baseline',{
  method:'POST',body:JSON.stringify({count,authoritative,ids:[],observedAtMs:123456789})
 });
 assert.equal((await (await obj.fetch(request(200))).json()).ok,false);
 assert.equal((await (await obj.fetch(request(1,false))).json()).ok,false);
 assert.equal(await store.get('baseline'),undefined);
 assert.equal((await (await obj.fetch(request(0))).json()).initialized,true);
 assert.equal((await (await obj.fetch(request(0))).json()).initialized,false);
 assert.equal((await store.get('baseline')).atMs,123456789);
});

test('concurrent first-run baselines choose one persisted watermark, without sending',async()=>{
 const store=new MemoryStorage();
 const request=ms=>new Request('https://internal/baseline',{
  method:'POST',body:JSON.stringify({authoritative:true,count:0,ids:[],observedAtMs:ms})
 });
 const results=await Promise.all([
  new PaynePushState({storage:store},{}).fetch(request(111111111)),
  new PaynePushState({storage:store},{}).fetch(request(222222222))
 ]);
 const outcomes=await Promise.all(results.map(x=>x.json()));
 assert.equal(outcomes.filter(x=>x.initialized).length,1);
 assert.ok([111111111,222222222].includes((await store.get('baseline')).atMs));
 assert.equal([...store.map.keys()].filter(k=>k.startsWith('event:')).length,0);
});
