import test from 'node:test';
import assert from 'node:assert/strict';
import {payneClosureEvidence} from '../src/payne-closure-evidence.js';
import {evaluatePayneClosureMaintenance} from '../../../../.github/scripts/payne-closure-maintenance-offline.mjs';
const p={seriesId:'s',owner:'PAYNE_KALSHI_REAL',status:'RECONCILIATION_UNKNOWN',reconciliationState:'FLAT',exchangeIndex:2,attemptNo:2,attemptId:'s-intent-2',entryOrderId:'order',entryClientOrderId:'client',marketTicker:'KXNEAR-TEST',outcomeSide:'NO'};
const control={armed:false,openPositions:1};
const series={schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',unresolvedEntry:false,seriesId:'s',position:p,positions:[p],currentAttempt:{executionHandoff:'DIRECT_KALSHI_WRITER_V1',attemptId:'s-intent-2',attemptNo:2,providerOrderId:'order',clientOrderId:'client'}};
function getMock({bad=false,exposure=false,incomplete=false,missingHistoricalOrder=false}={}){
 const paths=[];
 const get=async (env,path)=>{
   paths.push(path);
   if(incomplete && path.includes('/historical/fills')) return new Response('upstream unavailable',{status:503});
   if(path.includes('/positions')) return Response.json({market_positions:[{ticker:'KXNEAR-TEST',position_fp:exposure?'1':'0'}],cursor:''});
   if(path.includes('/historical/orders'))return Response.json({orders:missingHistoricalOrder?[]:[{order_id:'order',client_order_id:bad?'incorrect':'client',ticker:'KXNEAR-TEST',side:'no'}],cursor:''});
   if(path.includes('/orders'))return Response.json({orders:[],cursor:''});
   if(path.includes('/historical/fills')){
     if(!path.includes('cursor=next'))return Response.json({fills:[],cursor:'next'});
     return Response.json({fills:[{order_id:'order',ticker:'KXNEAR-TEST',side:'no'}],cursor:''});
   }
   if(path.includes('/portfolio/fills'))return Response.json({fills:[],cursor:''});
   throw Error('UNEXPECTED_GET_'+path);
 };
 return {get,paths};
}
test('matching historical fill with second page verifies exact identity and flat',{concurrency:false},async()=>{
 const x=getMock();const r=await payneClosureEvidence({},control,series,{get:x.get});
 assert.equal(r.ok,true);assert.equal(r.complete,true);assert.equal(r.provider.positionQuantity,0);
 assert.ok(x.paths.some(v=>v.includes('/historical/fills')&&v.includes('cursor=next')));
 assert.equal(r.providerWrites,0);
 const d=evaluatePayneClosureMaintenance({control,series,provider:r.provider,sourceBlob:'pin',expectedBlob:'pin'});
 assert.equal(d.allowed,true);
});
test('historical order contradictory client identity is rejected',{concurrency:false},async()=>{
 const x=getMock({bad:true});const r=await payneClosureEvidence({},control,series,{get:x.get});
 assert.equal(r.ok,false);assert.equal(r.reason,'PROVIDER_ENTRY_ORDER_IDENTITY_NOT_VERIFIED');
});
test('provider nonzero exposure blocks before entry identity',{concurrency:false},async()=>{
 const x=getMock({exposure:true});const r=await payneClosureEvidence({},control,series,{get:x.get});
 assert.equal(r.ok,false);assert.equal(r.reason,'OTHER_OR_UNKNOWN_PROVIDER_EXPOSURE');
});
test('historical provider read HTTP error fails closed',{concurrency:false},async()=>{
 const x=getMock({incomplete:true});const r=await payneClosureEvidence({},control,series,{get:x.get});
 assert.equal(r.ok,false);assert.equal(r.reason,'PROVIDER_EVIDENCE_INCOMPLETE');
});

test('historical fill without client ID and without historical order cannot prove client identity',{concurrency:false},async()=>{
 const x=getMock({missingHistoricalOrder:true});const r=await payneClosureEvidence({},control,series,{get:x.get});
 assert.equal(r.ok,false);assert.equal(r.reason,'PROVIDER_ENTRY_ORDER_IDENTITY_NOT_VERIFIED');
});
