import test from 'node:test';
import assert from 'node:assert/strict';
import {PayneExecutionCoordinator,claimPayneExecution} from '../src/payne-execution-coordinator.js';

function syntheticDurableObject(){
  const saved=new Map();
  // Transaction callbacks in this fixture are serialized just as DO storage transactions are.
  let tail=Promise.resolve();
  const state={storage:{transaction(fn){
    const result=tail.then(()=>fn({get:async key=>saved.get(key),put:async(key,value)=>{saved.set(key,structuredClone(value));},delete:async key=>{saved.delete(key);}}));
    tail=result.then(()=>{},()=>{});
    return result;
  }}};
  return {instance:new PayneExecutionCoordinator(state),saved};
}
const identity={seriesId:'PAYNE-TEST-SERIES',attemptNo:1,specimenId:'FIRE-1',clientOrderId:'payne-real-test-1-entry',ticker:'KXBTC15M-TEST',side:'YES',windowClose:'2026-10-10T04:15:00Z'};
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
