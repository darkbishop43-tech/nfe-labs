import test from 'node:test';
import assert from 'node:assert/strict';
import {PayneExecutionCoordinator,inspectPayneCoordinatorClaim} from '../src/payne-execution-coordinator.js';
import worker from '../src/index.js';

const seriesId='test-series';
const specimenId='test-series:fire:1:TEST:2026-10-12T03:01:43.169Z';
const identity={seriesId,attemptNo:1,specimenId,clientOrderId:'test-order',ticker:'TEST',side:'NO',windowClose:'2026-10-12T03:15:00Z'};
const token='A'.repeat(48);
function fixture(initial) {
  const records=new Map(initial?[['attempt:1',structuredClone(initial)]]:[]);
  const counts={put:0,delete:0,transaction:0,writer:0};
  const storage={
    get:async k=>records.get(k),
    transaction:async cb=>{
      counts.transaction++;
      return cb({get:async k=>records.get(k),
        put:async(k,v)=>{counts.put++;records.set(k,v)},
        delete:async k=>{counts.delete++;records.delete(k)},
        list:async()=>new Map(records)});
    }
  };
  const coordinator=new PayneExecutionCoordinator({storage});
  const env={
    PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN:token,
    PAYNE_EXECUTION_COORDINATOR:{
      idFromName:x=>x,get:()=>({fetch:(url,init)=>coordinator.fetch(new Request(url,init))})
    },
    PAYNE_KALSHI_STATE:{
      get:async key=>key==='payne-kalshi:real-series:v1'?JSON.stringify({
        schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',
        seriesId,fireLatch:{specimenId,marketCloseTime:identity.windowClose},
        currentAttempt:{providerAttemptNoCandidate:1,fireSpecimenId:specimenId,
          clientOrderId:identity.clientOrderId,marketTicker:identity.ticker,
          outcomeSide:identity.side,marketCloseTime:identity.windowClose}
      }):null,
      put:async()=>{throw new Error('OFFLINE_DIAGNOSTIC_KV_WRITE_FORBIDDEN');}
    }
  };
  const route=(header=token)=>worker.fetch(new Request(
    'https://payne.test/internal/atomic-claim-diagnostic?seriesId=test-series&attemptNo=1',
    {headers:header?{'x-payne-diagnostic-token':header}:{}}),env);
  return {records,counts,coordinator,env,route};
}

test('A matching claim returns exact stored identity and timestamps without writes',async()=>{
  const record={...identity,claimState:'POTENTIALLY_SUBMITTED',claimedAt:'2026-10-12T03:01:43.170Z'};
  const f=fixture(record),response=await f.route(),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.status,'FOUND');
  assert.deepEqual(body.claim,record);assert.deepEqual(body.mismatchedFields,[]);
  assert.deepEqual(f.counts,{put:0,delete:0,transaction:0,writer:0});
});
test('B missing claim is distinguishable from errors',async()=>{
  const f=fixture(),response=await f.route(),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.status,'NOT_FOUND');
  assert.equal(body.exists,false);assert.equal(body.claim,null);
});
test('C mismatches name only the differing fields',async()=>{
  const f=fixture({...identity,ticker:'WRONG',side:'YES'});
  const body=await (await f.route()).json();
  assert.deepEqual(body.mismatchedFields,['ticker','side']);
});
test('D read does not enter transaction or change storage',async()=>{
  const original={...identity,claimState:'UNKNOWN'};
  const f=fixture(original);await f.route();await f.route();
  assert.deepEqual(f.records.get('attempt:1'),original);
  assert.equal(f.counts.put,0);assert.equal(f.counts.delete,0);assert.equal(f.counts.transaction,0);
});
test('E coordinator CLAIM retains exclusive behavior',async()=>{
  const f=fixture();
  const claim=()=>f.coordinator.fetch(new Request('https://coordinator.test/claim',
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...identity,maxPositions:3})}));
  assert.equal((await (await claim()).json()).granted,true);
  assert.equal((await (await claim()).json()).reason,'ATTEMPT_ALREADY_CLAIMED');
});
test('F coordinator RESOLVE_ENTRY retains identity and proof requirements',async()=>{
  const f=fixture({...identity,claimState:'POTENTIALLY_SUBMITTED'});
  const resolve=body=>f.coordinator.fetch(new Request('https://coordinator.test/resolve',
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'RESOLVE_ENTRY',resolution:'NO_PROVIDER_EXECUTION',...body})}));
  assert.equal((await (await resolve({...identity,ticker:'WRONG'})).json()).reason,'CLAIM_DIFFERENT_IDENTITY');
  assert.equal((await (await resolve(identity)).json()).reason,'PROVIDER_NO_EXECUTION_EVIDENCE_REQUIRED');
  assert.equal(f.records.get('attempt:1').claimState,'POTENTIALLY_SUBMITTED');
});
test('G diagnostic does not invoke provider writer',async()=>{
  const f=fixture(identity);
  const body=await (await f.route()).json();
  assert.equal(body.providerWrites,0);assert.equal(f.counts.writer,0);
});
test('H unauthorized callers cannot inspect records',async()=>{
  const f=fixture(identity);
  for(const header of [null,'bad','B'.repeat(48)]){
    const response=await f.route(header);
    assert.equal(response.status,403);
    assert.equal((await response.json()).status,'UNAUTHORIZED');
  }
  assert.equal(f.counts.transaction,0);
});
test('storage read failure returns ERROR, never NOT_FOUND',async()=>{
  const f=fixture(identity);
  f.coordinator.state.storage.get=async()=>{throw Error('simulated')};
  const response=await f.route(),body=await response.json();
  assert.equal(response.status,500);assert.equal(body.status,'ERROR');
});
