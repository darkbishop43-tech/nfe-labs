import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchPayneUsingExistingPush,payneRealNotification,validPayneLedger,PAYNE_PUSH_NAMESPACE} from '../src/payne-real-notification-adapter.js';
function memory(){const m=new Map();return {m,get:async k=>m.get(k),put:async(k,v)=>m.set(k,v)}}
const at='2026-10-12T22:00:00Z';
const row=(type,more={})=>({type,seriesId:'SERIES',attemptId:'ATT',at,ticker:'KXBTC15M-TEST',...more});
const doc=(rows)=>({ok:true,schema:'PAYNE_REAL_LEDGER_EXPORT_V1',readOnly:true,providerWrites:0,ordersSubmittedByThisRead:0,capitalMovedUsd:0,count:rows.length,rows});
test('read-only ledger evidence must be complete and cannot claim provider writes',()=>{
 assert.equal(validPayneLedger(doc([])),true);
 assert.equal(validPayneLedger({...doc([]),providerWrites:1}),false);
 assert.equal(validPayneLedger({...doc([]),count:1}),false);
 assert.equal(validPayneLedger(doc(Array(200).fill(row('FIRE_SPECIMEN_LATCHED')))),false);
});
test('PAYNE fish is not fill, provider POST started is not accepted, fills require positive count',()=>{
 const fish=payneRealNotification(row('FIRE_SPECIMEN_LATCHED'));
 assert.match(fish.payload.title,/PAYNE REAL · FISH/);
 assert.equal(payneRealNotification(row('ENTRY_PROVIDER_POST_STARTED')),null);
 assert.equal(payneRealNotification(row('ENTRY_PROVIDER_RESULT')),null);
 assert.equal(payneRealNotification(row('ENTRY_PROVIDER_REJECTED_OR_UNKNOWN')),null);
 assert.equal(payneRealNotification(row('POSITION_OWNERSHIP_ESTABLISHED',{entryOrderId:'K-1'})),null);
 assert.match(payneRealNotification(row('POSITION_OWNERSHIP_ESTABLISHED',{entryOrderId:'K-1',filledCount:1})).payload.title,/POSITION FILLED/);
 assert.match(payneRealNotification(row('ENTRY_PROVIDER_REJECTED_OR_UNKNOWN',{httpStatus:403})).payload.title,/REJECTED/);
});
test('first run suppresses old events; later PAYNE events reuse existing sender; persisted separate dedupe',async()=>{
 const kv=memory();let now=Date.parse('2026-10-12T22:00:10Z'),sends=[];
 let evidence=doc([row('FIRE_SPECIMEN_LATCHED')]);
 const run=()=>dispatchPayneUsingExistingPush({kv,readLedger:async()=>evidence,send:async(id,payload)=>{sends.push([id,payload]);return {delivered:true}},now:()=>now});
 assert.deepEqual(await run(),{ok:true,baselineEstablished:true,sent:0});
 assert.equal(sends.length,0);
 now+=1000;
 evidence=doc([row('FIRE_SPECIMEN_LATCHED'),row('POSITION_OWNERSHIP_ESTABLISHED',{entryOrderId:'K-2',filledCount:2,at:'2026-10-12T22:00:11Z'})]);
 assert.equal((await run()).sent,1);
 assert.equal((await run()).sent,0);
 assert.equal(sends.length,1);
 assert.match(sends[0][0],/^payne-real:/);
 assert.ok([...kv.m.keys()].every(k=>k.startsWith(PAYNE_PUSH_NAMESPACE)));
});
test('failed push not marked delivered; never sends old backlog; AUTO namespace isolated',async()=>{
 const kv=memory(),time=Date.parse('2026-10-12T22:20:00Z');
 let evidence=doc([row('FIRE_SPECIMEN_LATCHED',{at:'2026-10-12T22:10:00Z'})]),count=0;
 const run=()=>dispatchPayneUsingExistingPush({kv,readLedger:async()=>evidence,send:async()=>{count++;return {delivered:false}},now:()=>time});
 await run();
 evidence=doc([...evidence.rows,row('ENTRY_NO_FILL',{at:'2026-10-12T22:20:01Z'})]);
 assert.equal((await run()).sent,0);
 assert.equal((await run()).sent,0);
 assert.equal(count,2);
 assert.equal([...kv.m.keys()].some(k=>k.startsWith('notification:delivery:v1:')),false);
});
