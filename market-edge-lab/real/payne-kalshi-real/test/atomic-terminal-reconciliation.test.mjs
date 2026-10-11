import test from 'node:test';
import assert from 'node:assert/strict';
import { PayneExecutionCoordinator } from '../src/payne-execution-coordinator.js';
function rig(){
 const state=new Map();
 const storage={transaction:async(fn)=>fn({
   get:async k=>state.get(k),
   put:async(k,v)=>state.set(k,structuredClone(v)),
   delete:async k=>state.delete(k),
   list:async({prefix})=>new Map([...state].filter(([k])=>k.startsWith(prefix)))
 })};
 const coordinator=new PayneExecutionCoordinator({storage});
 const send=async body=>{
  const res=await coordinator.fetch(new Request('https://coordinator.local/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
  return res.json();
 };
 return {state,send};
}
const historical={seriesId:'367facf0-a0ab-4361-99b6-0dbe4c786660',attemptNo:1,
 specimenId:'ORIGINAL_HYPE_FIRE',clientOrderId:'payne-real-0dbe4c786660-1-entry',
 ticker:'KXHYPE15M-26OCT100315-15',side:'YES',windowClose:'2026-10-10T07:15:00Z',maxPositions:3};
const near={...historical,specimenId:'367facf0-a0ab-4361-99b6-0dbe4c786660:fire:1:KXNEAR15M-26OCT110600-00:2026-10-11T09:50:02.674Z',
 ticker:'KXNEAR15M-26OCT110600-00',side:'NO',windowClose:'2026-10-11T10:00:00Z'};
const terminal=(identity,resolution)=>({...identity,action:'RESOLVE_ENTRY',resolution,
 providerNoExecutionProven:true,authoritativeReconciliationProven:true});
test('historical terminal claim is preserved for provider-proven distinct NEAR no-post intent',async()=>{
 const {state,send}=rig();
 assert.equal((await send(historical)).granted,true);
 assert.equal((await send(terminal(historical,'NO_PROVIDER_EXECUTION'))).granted,true);
 const saved=structuredClone(state.get('attempt:1'));
 const result=await send(terminal(near,'NO_PROVIDER_EXECUTION'));
 assert.deepEqual(result,{granted:true,reason:'DISTINCT_TERMINAL_HISTORICAL_CLAIM_PRESERVED'});
 assert.deepEqual(state.get('attempt:1'),saved);
 assert.equal((await send(terminal(near,'NO_PROVIDER_EXECUTION'))).granted,true);
 assert.equal((await send(near)).granted,false);
});
test('unknown or potentially submitted claim is not bypassed',async()=>{
 for(const stateName of ['UNKNOWN','OPEN','POTENTIALLY_SUBMITTED']){
  const r=rig();await r.send(historical);
  if(stateName!=='POTENTIALLY_SUBMITTED')await r.send({...historical,action:'RESOLVE_ENTRY',resolution:stateName});
  assert.equal((await r.send(terminal(near,'NO_PROVIDER_EXECUTION'))).granted,false);
 }
});
test('reject missing claim and missing evidence',async()=>{
 const r=rig();
 assert.equal((await r.send(terminal(near,'NO_PROVIDER_EXECUTION'))).reason,'CLAIM_NOT_FOUND');
 await r.send(historical);await r.send(terminal(historical,'NO_FILL'));
 assert.equal((await r.send({...terminal(near,'NO_PROVIDER_EXECUTION'),providerNoExecutionProven:false})).granted,false);
 assert.equal((await r.send(terminal(near,'NO_FILL'))).granted,false);
});
test('other uncertain claim blocks resolution even if collided slot is terminal',async()=>{
 const r=rig();await r.send(historical);await r.send(terminal(historical,'CLOSED'));
 const other={...historical,attemptNo:2,specimenId:'OTHER',clientOrderId:'OTHER'};
 assert.equal((await r.send(other)).granted,true);
 assert.equal((await r.send(terminal(near,'NO_PROVIDER_EXECUTION'))).granted,false);
});
test('capacity three remains available until three unresolved claims',async()=>{
 const r=rig();
 for(let i=1;i<=3;i++){
  const x={...historical,attemptNo:i,specimenId:'FIRE'+i,clientOrderId:'ORDER'+i};
  assert.equal((await r.send(x)).granted,true);
 }
 const fourth={...historical,attemptNo:4,specimenId:'FIRE4',clientOrderId:'ORDER4'};
 assert.equal((await r.send(fourth)).reason,'CAPACITY_FULL');
 assert.equal((await r.send(terminal(near,'NO_PROVIDER_EXECUTION'))).granted,false);
});
