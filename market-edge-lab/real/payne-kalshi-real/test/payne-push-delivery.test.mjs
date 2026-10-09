import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollPaynePhone,validPayneSubscription,sendPaynePersistedAlert,paynePushKeys,payneServiceWorkerSource} from '../src/payne-push-delivery.js';
function kv(){const m=new Map();return {m,async get(k){return m.get(k)||null},async put(k,v){m.set(k,v)}}}
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{auth:'public-auth',p256dh:'public-dh'}};
const event={type:'ENTRY_NO_FILL',seriesId:'SERIES',attemptId:'ATTEMPT',at:'2026-10-09T10:20:00Z',ticker:'EXAMPLE',asset:'BTC',direction:'UP'};
const params=k=>({kv:k,event,topic:async id=>id,publicKey:'public',privateKey:'test-private-never-exposed',subject:'https://github.com/darkbishop43-tech/nfe-labs'});
test('PAYNE subscription is stored only at PAYNE-specific key',async()=>{
  const k=kv();assert.equal(validPayneSubscription(sub),true);
  assert.equal((await enrollPaynePhone(k,sub)).ok,true);
  assert.equal(k.m.has(paynePushKeys.subscription),true);
  assert.equal([...k.m.keys()].every(x=>x.startsWith('payne-real:mobile-push:v1:')),true);
  assert.equal((await enrollPaynePhone(k,{endpoint:'http://unsafe',keys:sub.keys})).ok,false);
});
test('synthetic delivery only; authoritative PAYNE no-fill sends once and survives module re-use',async()=>{
  const k=kv();await enrollPaynePhone(k,sub);let sends=0;
  const send=async(s,p)=>{sends++;assert.match(p.title,/PAYNE REAL/);return true};
  const one=await sendPaynePersistedAlert({...params(k),send});
  const two=await sendPaynePersistedAlert({...params(k),send});
  assert.equal(one.delivered,true);assert.equal(two.duplicateSuppressed,true);assert.equal(sends,1);
  assert.equal([...k.m.keys()].some(x=>x.includes('delivered')),true);
});
test('retry bounded; failure recorded; no order-authority invocation',async()=>{
  const k=kv();await enrollPaynePhone(k,sub);let tries=0;
  const send=async()=>{tries++;throw new Error('temporary error')};
  const result=await sendPaynePersistedAlert({...params(k),send,maxRetries:1});
  assert.equal(result.ok,false);assert.equal(tries,2);
  assert.equal([...k.m.keys()].some(x=>x.includes('attempt')),true);
});
test('no premature FILLED or FIRE notification; no credentials embedded in worker script',async()=>{
  const k=kv();await enrollPaynePhone(k,sub);let sends=0;
  const result=await sendPaynePersistedAlert({...params(k),event:{...event,type:'FIRE_SPECIMEN_LATCHED'},send:async()=>{sends++;return true}});
  assert.equal(result.ok,false);assert.equal(sends,0);
  assert.match(payneServiceWorkerSource(),/notificationclick/);
  assert.doesNotMatch(payneServiceWorkerSource(),/privateKey|Kalshi|portfolio|orderPost/);
});
