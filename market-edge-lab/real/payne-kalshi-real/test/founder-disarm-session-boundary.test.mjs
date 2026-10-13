import test from 'node:test';
import assert from 'node:assert/strict';
import {updateFounderControl,defaultControlState,defaultRealSeriesState,loadRealSeriesState} from '../src/index.js';
const CONTROL='payne-kalshi:control:v1',SERIES='payne-kalshi:real-series:v1';
function setup({started=1,target=5,fireLatch=null,positions=[],unresolvedEntry=false,currentAttempt=null}={}){
 const control={...defaultControlState(),armed:true,attempts:started,attemptTarget:target};
 const series={...defaultRealSeriesState(),seriesId:'old-session-'+started,status:'ARMED_FISHING',
   configFrozen:true,frozenAt:new Date().toISOString(),attemptsStarted:started,attemptTarget:target,
   position:positions[0]||null,positions,unresolvedEntry,fireLatch,currentAttempt};
 const data=new Map([[CONTROL,JSON.stringify(control)],[SERIES,JSON.stringify(series)]]);
 const putKeys=[];
 const env={PAYNE_KALSHI_STATE:{
  get:async k=>data.get(k)||null,
  put:async(k,v)=>{data.set(k,String(v));putKeys.push(k)},
  list:async()=>({keys:[],list_complete:true})
 }};
 return {env,data,putKeys,series,read:k=>JSON.parse(data.get(k))};
}
for(const started of [1,4]){
 test('Founder DISARM at '+started+'/5 closes history and subsequent ARM starts 0/5',async()=>{
  const f=setup({started});
  const disarmed=await updateFounderControl(f.env,'DISARM');
  assert.equal(disarmed.armed,false);assert.equal(disarmed.attempts,0);
  const closed=await loadRealSeriesState(f.env);
  assert.equal(closed.status,'TERMINAL_FOUNDER_DISARMED');
  assert.equal(closed.attemptsStarted,started);
  assert.ok(closed.completedAt);
  assert.equal(f.read('payne-kalshi:run:'+f.series.seriesId+':founder-disarm-snapshot').attemptsStarted,started);
  assert.ok([...f.data.keys()].some(x=>x.startsWith('payne-kalshi:real-ledger:')));
  const armed=await updateFounderControl(f.env,'ARM');
  assert.equal(armed.armed,true);assert.equal(armed.attempts,0);
  const newSeries=await loadRealSeriesState(f.env);
  assert.notEqual(newSeries.seriesId,f.series.seriesId);
  assert.equal(newSeries.attemptsStarted,0);assert.equal(newSeries.attemptTarget,5);
  assert.equal(newSeries.fireLatch,null);assert.equal(newSeries.currentAttempt,null);
  assert.equal(newSeries.completedAt,null);
  assert.ok(f.data.has('payne-kalshi:run:'+f.series.seriesId+':founder-disarm-snapshot'));
 });
}
test('invalidated old FIRE and expired ticker do not carry to rearmed session',async()=>{
 const latch={state:'INVALIDATED_BEFORE_POST',specimenId:'old-fire',ticker:'OLD_EXPIRED_CONTRACT',marketCloseTime:'2026-01-01T00:00:00Z'};
 const f=setup({started:1,fireLatch:latch});
 await updateFounderControl(f.env,'DISARM');
 assert.equal((await loadRealSeriesState(f.env)).fireLatch.specimenId,'old-fire');
 await updateFounderControl(f.env,'ARM');
 const fresh=await loadRealSeriesState(f.env);
 assert.equal(fresh.fireLatch,null);assert.equal(fresh.seriesId!=='old-session-1',true);
});
test('next ARM uses currently selected attempt target',async()=>{
 const f=setup({started:4,target:5});
 await updateFounderControl(f.env,'DISARM');
 await updateFounderControl(f.env,'SET_ATTEMPT_TARGET',1);
 await updateFounderControl(f.env,'ARM');
 const fresh=await loadRealSeriesState(f.env);
 assert.equal(fresh.attemptTarget,1);assert.equal(fresh.attemptsStarted,0);
});
test('worker restart while armed reads same series without resetting counter',async()=>{
 const f=setup({started:4});
 const before=await loadRealSeriesState(f.env);
 const after=await loadRealSeriesState(f.env);
 assert.equal(before.seriesId,after.seriesId);assert.equal(after.attemptsStarted,4);
 assert.equal(f.putKeys.length,0);
});
test('provider exposure preserved on DISARM and prevents rearm',async()=>{
 const position={positionId:'P',owner:'PAYNE_REAL',status:'OPEN',exchangeIndex:2,entryOrderId:'O'};
 const f=setup({positions:[position]});
 await updateFounderControl(f.env,'DISARM');
 assert.equal((await loadRealSeriesState(f.env)).position.entryOrderId,'O');
 await assert.rejects(()=>updateFounderControl(f.env,'ARM'),/POSITION/);
 assert.equal(f.read(CONTROL).armed,false);
});
test('unresolved entry survives disarm; rearm cannot bypass exposure',async()=>{
 const f=setup({unresolvedEntry:true,currentAttempt:{attemptId:'UNRESOLVED',status:'SUBMITTING',providerOrderId:'ORDER'}});
 await updateFounderControl(f.env,'DISARM');
 const closed=await loadRealSeriesState(f.env);
 assert.equal(closed.unresolvedEntry,true);assert.equal(closed.currentAttempt.providerOrderId,'ORDER');
 await assert.rejects(()=>updateFounderControl(f.env,'ARM'),/RECONCILIATION_REQUIRED/);
 assert.equal(f.read(CONTROL).armed,false);
});
test('disarm is idempotent when already disarmed; no extra session record',async()=>{
 const f=setup();
 await updateFounderControl(f.env,'DISARM');
 const n=[...f.data.keys()].filter(k=>k.startsWith('payne-kalshi:real-ledger:')).length;
 await updateFounderControl(f.env,'DISARM');
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('payne-kalshi:real-ledger:')).length,n);
});
