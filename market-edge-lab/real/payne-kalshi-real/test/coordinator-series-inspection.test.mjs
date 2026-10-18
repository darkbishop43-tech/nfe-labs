import test from 'node:test';
import assert from 'node:assert/strict';
import {PayneExecutionCoordinator} from '../src/payne-execution-coordinator.js';
const seriesId='bd881b11-b130-491f-a75f-a98425b92fd9';
function entry(no,state='CLOSED'){return ['attempt:'+no,{seriesId,attemptNo:no,claimState:state,clientOrderId:'a'+no}]}
function exit(id,state='CLOSED'){return ['exit:'+id,{seriesId,attemptNo:1,clientOrderId:id,claimState:state}]}
function make(records=[],{fail=false,malformed=false}={}){
 let writes=0, reads=0;
 const storage={transaction:async fn=>fn({
   list:async options=>{
     reads++;if(fail)throw Error('failed');if(malformed)return null;
     const all=[...records].sort((a,b)=>a[0].localeCompare(b[0]));
     const after=options.startAfter;
     return new Map(all.filter(([key])=>!after||key>after).slice(0,options.limit));
   },get:async()=>{throw Error('not used')},
   put:async()=>{writes++;throw Error('READ_ONLY_VIOLATION')},
   delete:async()=>{writes++;throw Error('READ_ONLY_VIOLATION')}
 })};
 const coordinator=new PayneExecutionCoordinator({storage});
 const inspect=()=>coordinator.fetch(new Request('https://payne-coordinator.internal/internal/inspect-series?seriesId='+seriesId,{method:'GET'}));
 return {inspect,metrics:()=>({writes,reads})};
}
async function check(records,expected,opts){
 const m=make(records,opts),response=await m.inspect(),body=await response.json();
 assert.equal(body.status,expected);assert.equal(m.metrics().writes,0);
 return {m,body};
}
test('zero claims clear and complete',async()=>{
 const {m,body}=await check([],'CLEAR');assert.equal(body.complete,true);assert.equal(body.claimCount,0);
 const again=await m.inspect();assert.deepEqual(await again.json(),body);
});
test('resolved entry and exit claims clear',async()=>{
 const {body}=await check([entry(1,'CLOSED'),entry(2,'NO_FILL'),entry(3,'NO_PROVIDER_EXECUTION'),exit('x','CLOSED')],'CLEAR');
 assert.equal(body.claimCount,4);assert.equal(body.unknownRecords,0);
});
test('active entry blocked',async()=>{const {body}=await check([entry(1,'POTENTIALLY_SUBMITTED')],'BLOCKED');assert.equal(body.activeClaims,1)});
test('active exit blocked',async()=>{const {body}=await check([exit('x','POTENTIALLY_SUBMITTED')],'BLOCKED');assert.equal(body.activeClaims,1)});
test('unknown status fails closed',async()=>{
 const {body}=await check([entry(1,'SOMETHING_NEW')],'UNKNOWN');assert.equal(body.complete,false);
});
test('missing series identity fails closed',async()=>{
 const m=make([['attempt:1',{attemptNo:1,claimState:'CLOSED'}]]);
 const r=await m.inspect();assert.equal((await r.json()).status,'UNKNOWN');
});
test('multiple entry and exit claims all read',async()=>{
 const {body}=await check([entry(1),entry(2),exit('a'),exit('b')],'CLEAR');assert.equal(body.claimCount,4);
});
test('unknown storage key fails closed',async()=>{
 const {body}=await check([['future:1',{seriesId,claimState:'CLOSED'}]],'UNKNOWN');assert.equal(body.complete,false);
});
test('pagination across 1000 keys is complete',async()=>{
 const claims=Array.from({length:1001},(_,i)=>entry(i+1));
 const {body}=await check(claims,'CLEAR');
 assert.equal(body.totalRecords,1001);assert.equal(body.pages,2);
});
test('incomplete enumeration response fails closed',async()=>{
 const {body}=await check([],'UNKNOWN',{malformed:true});assert.equal(body.complete,false);
});
test('storage exception fails closed',async()=>{
 const {body}=await check([],'UNKNOWN',{fail:true});assert.equal(body.reason,'STORAGE_ENUMERATION_FAILED');
});
test('wrong series identity rejected',async()=>{
 const {body}=await check([['attempt:1',{...entry(1)[1],seriesId:'wrong'}]],'UNKNOWN');assert.equal(body.complete,false);
});
test('malformed key identity rejected',async()=>{
 const {body}=await check([['attempt:0',{seriesId,attemptNo:0,claimState:'CLOSED'}]],'UNKNOWN');assert.equal(body.complete,false);
});
test('no mutation with repeated reads',async()=>{
 const m=make([entry(1)]);await m.inspect();await m.inspect();assert.equal(m.metrics().writes,0);
});
