import test from 'node:test';
import assert from 'node:assert/strict';
import {PayneExecutionCoordinator} from '../src/payne-execution-coordinator.js';
import {recoverProviderConfirmedFireLatch} from '../src/payne-fire-recovery-v1.js';
import {verifyProviderTerminalEntry} from '../src/payne-provider-recovery-v1.js';

const seriesId='fire-series';
const latch={state:'LATCHED',specimenId:'fire-3',attemptNo:3,ticker:'KXNEAR15M-TEST',marketCloseTime:'2026-10-21T04:30:00Z'};
const attempt={attemptId:seriesId+'-intent-3',fireSpecimenId:latch.specimenId,
 clientOrderId:'entry-3',providerOrderId:'entry-order-3',marketTicker:latch.ticker,
 outcomeSide:'NO',marketCloseTime:latch.marketCloseTime,executionHandoff:'DIRECT_KALSHI_WRITER_V1'};
const identity={seriesId,attemptNo:3,specimenId:latch.specimenId,clientOrderId:attempt.clientOrderId,
 ticker:latch.ticker,side:'NO',windowClose:latch.marketCloseTime};
const proof={resolution:'NO_PROVIDER_EXECUTION',providerOrderId:attempt.providerOrderId,
 evidenceId:'fire-proof-3',providerTerminalProven:true,providerExposureFlatProven:true,
 providerFillsVerified:true,directWriterVerified:true};
function coordinatorFixture(){
 const rows=new Map(),counts={puts:0};
 const storage={
  get:async k=>rows.get(k),
  transaction:async fn=>fn({
   get:async k=>rows.get(k),put:async(k,v)=>{counts.puts++;rows.set(k,v)},
   delete:async k=>{counts.puts++;rows.delete(k)},
   list:async opts=>new Map([...rows].filter(([k])=>!opts?.startAfter||k>opts.startAfter))
  })
 };
 const doo=new PayneExecutionCoordinator({storage});
 const send=async(action,vars={})=>{
  const r=await doo.fetch(new Request('https://coordinator/recovery',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({...identity,...proof,action,...vars})}));
  return r.json();
 };
 return {rows,counts,send,doo};
}
function provider({missing=false,open=false,position=0,incomplete=false}={}){
 return async (_env,path)=>{
  const response=(name,values)=>new Response(JSON.stringify({[name]:values,cursor:incomplete?null:''}),{status:200});
  if(path.includes('portfolio/orders'))return response('orders',missing?[]:[{
   order_id:attempt.providerOrderId,client_order_id:attempt.clientOrderId,ticker:latch.ticker,
   side:'no',action:'buy',status:open?'resting':'canceled',fill_count:0
  }]);
  if(path.includes('historical/orders'))return response('orders',[]);
  if(path.includes('portfolio/fills')||path.includes('historical/fills'))return response('fills',[]);
  if(path.includes('portfolio/positions'))return response('market_positions',[{ticker:latch.ticker,position}]);
  if(path.includes('portfolio/settlements'))return response('settlements',[]);
  throw new Error('UNKNOWN_GET');
 };
}
function orchestratorFixture({crashOnce=false,wrongAttempt=false}={}){
 let stored={seriesId,fireLatch:{...latch},currentAttempt:{...attempt,attemptId:seriesId+'-intent-2',clientOrderId:'entry-2',providerOrderId:'other-order-2'},
  position:{owner:'PAYNE_KALSHI_REAL',seriesId,attemptId:'old-ZEC',marketTicker:'KXZEC15M-TEST',
   status:'RECONCILIATION_UNKNOWN',exchangeIndex:2},
  positions:[{owner:'PAYNE_KALSHI_REAL',seriesId,attemptId:'old-ZEC',marketTicker:'KXZEC15M-TEST',
   status:'RECONCILIATION_UNKNOWN',exchangeIndex:2}]};
 let commits=0,records=0,crashed=false;
 const deps={
  loadControl:async()=>({armed:false}),
  loadSeries:async()=>structuredClone(stored),
  loadHistoricalAttempt:async()=>wrongAttempt?{...attempt,providerOrderId:'wrong-provider-id',attemptId:'wrong-intent-3'}:{...attempt},
  saveSeries:async(_env,s)=>{if(crashOnce&&!crashed){crashed=true;throw Error('INTERRUPTED');}stored=structuredClone(s);},
  recordRecoveryLedger:async()=>{records++},
  verifyProvider:async()=>({ok:true,complete:true,resolution:'NO_PROVIDER_EXECUTION',
   evidenceId:proof.evidenceId,providerOrderId:proof.providerOrderId,executedFills:0}),
  resolveFire:async(_env,_id,_p,opts={})=>{if(!opts.markProjected)commits++;return {granted:true}}
 };
 return {deps,stats:()=>({stored,commits,records})};
}
test('1 exact terminal zero-filled entry plus flat exposure is proven',async()=>{
 const result=await verifyProviderTerminalEntry({}, {attempt,latch,get:provider()});
 assert.equal(result.ok,true);assert.equal(result.resolution,'NO_PROVIDER_EXECUTION');
});
test('2 missing order remains unknown, never treated as flat',async()=>{
 const result=await verifyProviderTerminalEntry({}, {attempt,latch,get:provider({missing:true})});
 assert.equal(result.status,'UNKNOWN');
});
test('3 active order remains unknown',async()=>{
 const result=await verifyProviderTerminalEntry({}, {attempt,latch,get:provider({open:true})});
 assert.equal(result.status,'UNKNOWN');
});
test('4 nonzero provider exposure protects latch',async()=>{
 const result=await verifyProviderTerminalEntry({}, {attempt,latch,get:provider({position:1})});
 assert.equal(result.status,'UNKNOWN');
});
test('5 incomplete provider pagination protects latch',async()=>{
 const result=await verifyProviderTerminalEntry({}, {attempt,latch,get:provider({incomplete:true})});
 assert.equal(result.status,'UNKNOWN');
});
test('6 fire receipt commits only once under exact identical replay',async()=>{
 const f=coordinatorFixture();
 assert.equal((await f.send('COMMIT_FIRE_RECOVERY')).granted,true);
 assert.equal((await f.send('COMMIT_FIRE_RECOVERY')).granted,true);
 assert.equal(f.counts.puts,1);
});
test('7 conflicting attempt identity cannot replace fire receipt',async()=>{
 const f=coordinatorFixture();await f.send('COMMIT_FIRE_RECOVERY');
 assert.equal((await f.send('COMMIT_FIRE_RECOVERY',{ticker:'KXZEC15M-TEST'})).granted,false);
 assert.equal(f.counts.puts,1);
});
test('8 missing coordinator claim requires exact direct-writer evidence',async()=>{
 const f=coordinatorFixture();
 assert.equal((await f.send('COMMIT_FIRE_RECOVERY',{directWriterVerified:false})).granted,false);
 assert.equal(f.counts.puts,0);
});
test('9 interruption between DO and KV recovers without clearing unrelated ZEC',async()=>{
 const f=orchestratorFixture({crashOnce:true});
 await assert.rejects(recoverProviderConfirmedFireLatch({},f.deps),/INTERRUPTED/);
 const result=await recoverProviderConfirmedFireLatch({},f.deps);
 assert.equal(result.ok,true);assert.equal(f.stats().stored.fireLatch.state,'PROVIDER_TERMINAL_RECONCILED');
 assert.equal(f.stats().stored.positions[0].status,'RECONCILIATION_UNKNOWN');
 assert.equal(f.stats().stored.currentAttempt.attemptId,seriesId+'-intent-2');
 assert.equal(f.stats().stored.currentAttempt.providerOrderId,'other-order-2');
});
test('10 wrong intent identity prevents coordinator and KV mutations',async()=>{
 const f=orchestratorFixture({wrongAttempt:true});
 const result=await recoverProviderConfirmedFireLatch({},f.deps);
 assert.equal(result.ok,false);assert.equal(f.stats().commits,0);
 assert.equal(f.stats().stored.fireLatch.state,'LATCHED');
});

test('11 historical intent-3 resolved while current intent-2 remains untouched',async()=>{
 const f=orchestratorFixture();const r=await recoverProviderConfirmedFireLatch({},f.deps);
 assert.equal(r.ok,true);assert.equal(f.stats().stored.fireLatch.state,'PROVIDER_TERMINAL_RECONCILED');
 assert.equal(f.stats().stored.currentAttempt.attemptId,seriesId+'-intent-2');
 assert.equal(f.stats().stored.currentAttempt.providerOrderId,'other-order-2');
 assert.equal(f.stats().stored.position.status,'RECONCILIATION_UNKNOWN');
});
test('12 unknown provider result leaves historical latch unchanged',async()=>{
 const f=orchestratorFixture();f.deps.verifyProvider=async()=>({ok:false,complete:false,reason:'PROVIDER_UNKNOWN'});
 const r=await recoverProviderConfirmedFireLatch({},f.deps);
 assert.equal(r.ok,false);assert.equal(f.stats().stored.fireLatch.state,'LATCHED');
 assert.equal(f.stats().commits,0);
});
test('13 repeated recovery does not create new ledger event',async()=>{
 const f=orchestratorFixture();assert.equal((await recoverProviderConfirmedFireLatch({},f.deps)).ok,true);
 assert.equal((await recoverProviderConfirmedFireLatch({},f.deps)).classification,'CLEAN');
 assert.equal(f.stats().records,1);
});
test('14 different archived contract is rejected before provider read',async()=>{
 const f=orchestratorFixture();f.deps.loadHistoricalAttempt=async()=>({...attempt,marketTicker:'WRONG'});
 const r=await recoverProviderConfirmedFireLatch({},f.deps);
 assert.equal(r.reason,'HISTORICAL_FIRE_ATTEMPT_IDENTITY_UNKNOWN');assert.equal(f.stats().commits,0);
});
