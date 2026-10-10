import test from 'node:test';
import assert from 'node:assert/strict';
import {PayneExecutionCoordinator,claimPayneExecution} from '../src/payne-execution-coordinator.js';

function syntheticDurableObject(){
  const saved=new Map();
  // Transaction callbacks in this fixture are serialized just as DO storage transactions are.
  let tail=Promise.resolve();
  const state={storage:{transaction(fn){
    const result=tail.then(()=>fn({get:async key=>saved.get(key),put:async(key,value)=>{saved.set(key,structuredClone(value));},delete:async key=>{saved.delete(key);},list:async({prefix='' }={})=>new Map([...saved.entries()].filter(([k])=>k.startsWith(prefix)))}));
    tail=result.then(()=>{},()=>{});
    return result;
  }}};
  return {instance:new PayneExecutionCoordinator(state),saved};
}
const identity={seriesId:'PAYNE-TEST-SERIES',attemptNo:1,specimenId:'FIRE-1',clientOrderId:'payne-real-test-1-entry',ticker:'KXBTC15M-TEST',side:'YES',windowClose:'2026-10-10T04:15:00Z',maxPositions:3};
test('exactly one of simultaneous claims owns one PAYNE provider attempt',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const request=()=>new Request('https://payne-coordinator.internal/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(identity)});
 const results=await Promise.all(Array.from({length:8},async()=> (await instance.fetch(request())).json()));
 assert.equal(results.filter(x=>x.granted).length,1);
 assert.equal(results.filter(x=>!x.granted).length,7);
 assert.equal(saved.size,1);
 assert.equal(saved.get('attempt:1').clientOrderId,identity.clientOrderId);
});
test('restart and UNKNOWN retain the durable claim, without expiry or second order',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const response=await instance.fetch(new Request('https://payne-coordinator.internal/claim',{method:'POST',body:JSON.stringify(identity)}));
 assert.equal((await response.json()).granted,true);
 const restarted=new PayneExecutionCoordinator({storage:{transaction:async fn=>fn({get:async k=>saved.get(k),put:async(k,v)=>saved.set(k,v)})}});
 const duplicate=await restarted.fetch(new Request('https://payne-coordinator.internal/claim',{method:'POST',body:JSON.stringify({...identity,specimenId:'FIRE-RETRY'})}));
 assert.equal((await duplicate.json()).granted,false);
 assert.equal(saved.get('attempt:1').claimState,'POTENTIALLY_SUBMITTED');
});
test('claim owner identity is bound to series and attempt, not just ticker',async()=>{
 const {instance}=syntheticDurableObject();
 const binding={idFromName:n=>n,get:()=>({fetch:(_url,opts)=>instance.fetch(new Request('https://payne-coordinator.internal/claim',opts))})};
 assert.equal((await claimPayneExecution({PAYNE_EXECUTION_COORDINATOR:binding},identity)).granted,true);
 assert.equal((await claimPayneExecution({PAYNE_EXECUTION_COORDINATOR:binding},identity)).granted,false);
 assert.equal((await claimPayneExecution({},identity)).granted,false);
});

test('proven local no-POST release permits subsequent intent; uncertain claim never releases',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const call=async body=>(await instance.fetch(new Request('https://payne-coordinator.internal/claim',{method:'POST',body:JSON.stringify(body)}))).json();
 assert.equal((await call(identity)).granted,true);
 assert.equal((await call({...identity,action:'RELEASE_PROVEN_NO_POST',provenNoProviderPost:false})).granted,false);
 assert.equal(saved.size,1);
 assert.equal((await call({...identity,action:'RELEASE_PROVEN_NO_POST',provenNoProviderPost:true})).granted,true);
 assert.equal(saved.size,0);
 assert.equal((await call({...identity,specimenId:'NEXT-LEGITIMATE-INTENT'})).granted,true);
 assert.equal((await call(identity)).granted,false);
});

test('atomic coordinator reserves three Founder-authorized positions and rejects fourth',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const call=async x=>(await instance.fetch(new Request('https://payne-coordinator.internal/claim',{
   method:'POST',body:JSON.stringify(x)}))).json();
 const ids=[1,2,3,4].map(attemptNo=>({...identity,attemptNo,
   specimenId:'FIRE-'+attemptNo,clientOrderId:'ENTRY-'+attemptNo,ticker:'KXBTC-'+attemptNo}));
 const results=await Promise.all(ids.map(call));
 assert.equal(results.filter(x=>x.granted).length,3);
 assert.equal(results.filter(x=>x.reason==='CAPACITY_FULL').length,1);
 for(const x of ids.slice(0,3))assert.equal(saved.get('attempt:'+x.attemptNo).claimState,'POTENTIALLY_SUBMITTED');
 assert.equal((await call({...ids[0],action:'RESOLVE_ENTRY',resolution:'OPEN'})).granted,true);
 assert.equal((await call({...ids[1],action:'RESOLVE_ENTRY',resolution:'OPEN'})).granted,true);
 assert.equal((await call({...ids[2],action:'RESOLVE_ENTRY',resolution:'NO_FILL'})).granted,true);
 const next=await call(ids[3]);
 assert.equal(next.granted,true,'authoritative NO_FILL releases only its capacity reservation');
 assert.equal((await call({...ids[0],action:'RESOLVE_ENTRY',resolution:'CLOSED'})).granted,false);
 assert.equal((await call({...ids[0],action:'RESOLVE_ENTRY',resolution:'CLOSED',providerFlatProven:true})).granted,true);
 assert.equal(saved.get('attempt:1').claimState,'CLOSED');
});
test('UNKNOWN retains capacity and cannot be relabeled NO_FILL without reconciliation',async()=>{
 const {instance}=syntheticDurableObject();
 const call=async x=>(await instance.fetch(new Request('https://payne-coordinator.internal/claim',{method:'POST',body:JSON.stringify(x)}))).json();
 assert.equal((await call(identity)).granted,true);
 assert.equal((await call({...identity,action:'RESOLVE_ENTRY',resolution:'UNKNOWN'})).granted,true);
 assert.equal((await call({...identity,action:'RESOLVE_ENTRY',resolution:'NO_FILL'})).granted,false);
 assert.equal((await call(identity)).granted,false);
});

test('each PAYNE EXIT client order has exactly one owner across concurrent invocations and restart',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const exit={...identity,action:'CLAIM_EXIT',specimenId:'PAYNE-ATTEMPT-1',clientOrderId:'EXIT-CLIENT-1',windowClose:null};
 const request=()=>new Request('https://payne-coordinator.internal/exit',{method:'POST',body:JSON.stringify(exit)});
 const all=await Promise.all(Array.from({length:8},async()=> (await instance.fetch(request())).json()));
 assert.equal(all.filter(x=>x.granted).length,1);
 assert.equal(all.filter(x=>!x.granted).length,7);
 assert.equal(saved.get('exit:EXIT-CLIENT-1').claimState,'POTENTIALLY_SUBMITTED');
 const restarted=new PayneExecutionCoordinator({storage:{transaction:async fn=>fn({
   get:async k=>saved.get(k),put:async(k,v)=>saved.set(k,v),delete:async k=>saved.delete(k),
   list:async({prefix='' }={})=>new Map([...saved.entries()].filter(([k])=>k.startsWith(prefix)))
 })}});
 const again=await restarted.fetch(request());
 assert.equal((await again.json()).granted,false,'an uncertain exit cannot retry after restart');
});

test('provider-proven no-execution without prior claim becomes immutable terminal tombstone',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const call=async x=>(await instance.fetch(new Request('https://payne-coordinator.internal/claim',{method:'POST',body:JSON.stringify(x)}))).json();
 const resolution={...identity,action:'RESOLVE_ENTRY',resolution:'NO_PROVIDER_EXECUTION',
   providerNoExecutionProven:true,authoritativeReconciliationProven:true};
 assert.equal((await call(resolution)).reason,'NO_PRIOR_CLAIM_TERMINALLY_RECONCILED');
 assert.equal(saved.get('attempt:1').claimState,'NO_PROVIDER_EXECUTION');
 assert.equal((await call(identity)).granted,false,'resolved key must not permit duplicate execution');
 assert.equal((await call(resolution)).reason,'ALREADY_RESOLVED');
});
test('provider no-execution may not bypass any outstanding or mismatched coordinator claim',async()=>{
 const {instance,saved}=syntheticDurableObject();
 const call=async x=>(await instance.fetch(new Request('https://payne-coordinator.internal/claim',{method:'POST',body:JSON.stringify(x)}))).json();
 const resolution={...identity,action:'RESOLVE_ENTRY',resolution:'NO_PROVIDER_EXECUTION',
   providerNoExecutionProven:true,authoritativeReconciliationProven:true};
 const other={...identity,attemptNo:2,specimenId:'FIRE-2',clientOrderId:'SECOND'};
 assert.equal((await call(other)).granted,true);
 assert.equal((await call(resolution)).reason,'OTHER_OUTSTANDING_COORDINATOR_CLAIM');
 assert.equal(saved.get('attempt:1'),undefined);
 assert.equal((await call(identity)).granted,true);
 assert.equal((await call({...resolution,specimenId:'WRONG'})).reason,'CLAIM_IDENTITY_MISMATCH');
 assert.equal(saved.get('attempt:1').claimState,'POTENTIALLY_SUBMITTED');
});
