import test from 'node:test';
import assert from 'node:assert/strict';
import {PayneExecutionCoordinator} from '../src/payne-execution-coordinator.js';

const seriesId='recovery-series';
const identity={seriesId,attemptNo:1,specimenId:'specimen-a',clientOrderId:'exit-a',ticker:'KXNEAR15M-SAMPLE',side:'NO'};
const verified={...identity,action:'RESOLVE_EXIT_PROVEN_TERMINAL',resolution:'CLOSED',
 providerOrderId:'provider-order-a',evidenceId:'provider-proof-a',
 providerTerminalProven:true,providerExposureFlatProven:true,providerFillsVerified:true};
function setup(state='POTENTIALLY_SUBMITTED'){
 const rows=new Map([['exit:exit-a',{...identity,claimState:state}]]);
 let writes=0;
 const storage={transaction:async fn=>fn({
  get:async k=>rows.get(k),put:async(k,v)=>{writes++;rows.set(k,v)},
  delete:async k=>{writes++;rows.delete(k)},
  list:async()=>new Map(rows)})};
 const coordinator=new PayneExecutionCoordinator({storage});
 const send=async (input)=>{const r=await coordinator.fetch(new Request('https://payne.test/claim',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)
 }));return r.json()};
 return {rows,send,writes:()=>writes};
}
test('1 verified terminal exit becomes CLOSED',async()=>{
 const f=setup();assert.equal((await f.send(verified)).granted,true);
 assert.equal(f.rows.get('exit:exit-a').claimState,'CLOSED');
});
test('2 identical replay is idempotent',async()=>{
 const f=setup();await f.send(verified);assert.equal((await f.send(verified)).granted,true);
 assert.equal(f.writes(),1);
});
test('3 cross-series identity does not alter claim',async()=>{
 const f=setup();assert.equal((await f.send({...verified,seriesId:'other'})).granted,false);assert.equal(f.writes(),0);
});
test('4 wrong attempt does not alter claim',async()=>{
 const f=setup();assert.equal((await f.send({...verified,attemptNo:2})).granted,false);assert.equal(f.writes(),0);
});
test('5 wrong ticker does not alter claim',async()=>{
 const f=setup();assert.equal((await f.send({...verified,ticker:'KXZEC15M-SAMPLE'})).granted,false);assert.equal(f.writes(),0);
});
test('6 missing terminal proof leaves unknown unchanged',async()=>{
 const f=setup('UNKNOWN');assert.equal((await f.send({...verified,providerTerminalProven:false})).granted,false);assert.equal(f.rows.get('exit:exit-a').claimState,'UNKNOWN');
});
test('7 missing flat evidence never closes',async()=>{
 const f=setup();assert.equal((await f.send({...verified,providerExposureFlatProven:false})).granted,false);assert.equal(f.writes(),0);
});
test('8 no-fill alone never closes',async()=>{
 const f=setup();assert.equal((await f.send({...verified,resolution:'NO_FILL'})).granted,false);assert.equal(f.writes(),0);
});
test('9 terminal identity immutable when evidence differs',async()=>{
 const f=setup();await f.send(verified);assert.equal((await f.send({...verified,providerOrderId:'other'})).granted,false);assert.equal(f.writes(),1);
});
test('10 restart-style instance replay does not duplicate write',async()=>{
 const f=setup();await f.send(verified);assert.equal((await f.send(verified)).granted,true);assert.equal(f.writes(),1);
});
