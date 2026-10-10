import test from 'node:test';
import assert from 'node:assert/strict';
import {paynePositionRecords,payneCapacityEvidence,liveOrderWatchProjection} from '../src/payne-live-order-watch.js';
const p=(n,status='OPEN')=>({owner:'PAYNE_KALSHI_REAL',attemptId:'PAYNE-'+n,asset:'BTC',direction:'UP',marketTicker:'KXBTC-'+n,outcomeSide:'YES',status,entryOrderId:'ORDER-'+n,entryAverageFillPrice:.42,filledCount:1,reconciliationState:status==='CLOSED'?'FLAT':'OPEN',entryTime:'2026-10-10T02:00:00Z'});
test('legacy position is retained as independently identifiable PAYNE record',()=>{
 const records=paynePositionRecords({position:p(1),positions:[p(2),p(3)]});
 assert.equal(records.length,3);assert.equal(new Set(records.map(x=>x.attemptId)).size,3);
});
test('three occupied positions block capacity; each closed reconciled record frees a slot',()=>{
 const positions=[p(1),p(2),p(3)];
 assert.deepEqual(payneCapacityEvidence({positions},3),{occupied:3,capacity:3,available:false,reason:'CAPACITY_FULL'});
 positions[1]={...positions[1],status:'CLOSED',reconciliationState:'FLAT'};
 assert.equal(payneCapacityEvidence({positions},3).available,true);
 assert.equal(payneCapacityEvidence({positions,unresolvedEntry:true},3).available,false);
});
test('unresolved, active and recently closed watch rows stay separate without fabricated values',()=>{
 const positions=[p(1),p(2),p(3,'CLOSED')];
 const watch=liveOrderWatchProjection({positions,currentAttempt:{attemptId:'INTENT-UNKNOWN',owner:'PAYNE_KALSHI_REAL',status:'WRITE_ERROR_UNKNOWN',marketTicker:'KXETH',outcomeSide:'NO'}});
 assert.equal(watch.active.length,3);
 assert.equal(watch.closed.length,1);
 assert.equal(watch.active.find(x=>x.attemptId==='PAYNE-1').orderId,'ORDER-1');
 assert.equal(watch.active.find(x=>x.attemptId==='INTENT-UNKNOWN').currentBid,null);
 assert.equal(watch.providerWrites,0);
 assert.equal(watch.source,'PERSISTED_PAYNE_EVIDENCE_ONLY');
});
test('duplicate same attempt ID does not create phantom position',()=>{
 const original=p(1);
 const records=paynePositionRecords({position:original,positions:[original]});
 assert.equal(records.length,1);
});
