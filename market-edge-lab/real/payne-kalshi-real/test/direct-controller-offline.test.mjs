import test from 'node:test';
import assert from 'node:assert/strict';
import {runPayneRealExecutionCycle,defaultControlState,defaultRealSeriesState} from '../src/index.js';

function fixture(series,control=defaultControlState()){
 const values=new Map([
  ['payne-kalshi:control:v1',JSON.stringify(control)],
  ['payne-kalshi:real-series:v1',JSON.stringify(series)]
 ]);
 let writerCalls=0;
 const env={PAYNE_KALSHI_STATE:{
  get:async key=>values.get(key)??null,
  put:async(key,value)=>{values.set(key,String(value))},
  list:async()=>({keys:[],list_complete:true})
 }};
 return {env,values,get writerCalls(){return writerCalls},
  postImpl:async()=>{writerCalls++;throw Error('OFFLINE_WRITER_MUST_NOT_BE_CALLED')}};
}
test('ACTUAL CONTROLLER: historical unresolved entry never replays on restart',async()=>{
 const zec={...defaultRealSeriesState(),seriesId:'test-legacy-zec',unresolvedEntry:true,
  status:'ATOMIC_RECONCILIATION_REQUIRED',
  currentAttempt:{attemptId:'legacy-intent-1',marketTicker:'KXZEC15M-26OCT112315-15',
   clientOrderId:'legacy-client',outcomeSide:'NO',status:'EXECUTION_INTENT',
   writerInvoked:false,providerPostStarted:false}};
 const f=fixture(zec);
 await runPayneRealExecutionCycle(f.env,{postImpl:f.postImpl});
 assert.equal(f.writerCalls,0);
 const after=JSON.parse(f.values.get('payne-kalshi:real-series:v1'));
 assert.equal(after.currentAttempt.clientOrderId,'legacy-client');
 assert.equal(after.currentAttempt.marketTicker,'KXZEC15M-26OCT112315-15');
});
test('ACTUAL CONTROLLER: disarmed entry cannot invoke provider writer',async()=>{
 const f=fixture({...defaultRealSeriesState(),seriesId:'test-disarmed'});
 await runPayneRealExecutionCycle(f.env,{postImpl:f.postImpl});
 assert.equal(f.writerCalls,0);
});
