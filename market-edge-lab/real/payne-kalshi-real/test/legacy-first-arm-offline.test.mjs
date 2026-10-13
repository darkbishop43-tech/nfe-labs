import test from 'node:test';
import assert from 'node:assert/strict';
import {updateFounderControl,defaultControlState,defaultRealSeriesState,loadRealSeriesState} from '../src/index.js';
const C='payne-kalshi:control:v1',S='payne-kalshi:real-series:v1';
function fixture({unresolved=false,position=null,attemptStatus='NO_PROVIDER_EXECUTION'}={}){
 const control={...defaultControlState(),armed:false,attempts:1,attemptTarget:5,activeThreshold:0.6,maxEntryDebitUsd:1,requiredExchangeIndex:2,scanEnabled:true};
 const fireLatch={state:'INVALIDATED_BEFORE_POST',specimenId:'legacy-fire-attempt-2',ticker:'KXNEAR15M-26OCT121745-45',invalidationReason:'TIME_GATE_FAILED'};
 const series={...defaultRealSeriesState(),seriesId:'9ca4de81-02db-4e4b-94dd-35ef58acf9f5',
  status:'SERIES_PAUSED_DISARMED',attemptsStarted:1,attemptTarget:5,
  threshold:0.6,maxEntryDebitUsd:1,effectiveLockThreshold:0.6,requiredExchangeIndex:2,
  accountingSemantics:'PROVIDER_ATTEMPT_ACCOUNTING_V1',configFrozen:true,
  fireLatch,currentAttempt:{attemptId:'legacy-intent-1',status:attemptStatus,providerOrderId:null},
  unresolvedEntry:unresolved,position,positions:position?[position]:[]};
 const map=new Map([[C,JSON.stringify(control)],[S,JSON.stringify(series)],
  ['payne-kalshi:real-ledger:2026-10-12T21:36:15.512Z:historic',JSON.stringify({type:'HISTORICAL_FIRE',specimenId:fireLatch.specimenId})]]);
 const env={PAYNE_KALSHI_STATE:{get:async k=>map.get(k)||null,put:async(k,v)=>map.set(k,String(v)),list:async()=>({keys:[],list_complete:true})}};
 return {env,map,series,control};
}
test('legacy pre-repair DISARM -> offline ARM starts completely new 0/5',async()=>{
 const f=fixture();
 const res=await updateFounderControl(f.env,'ARM');
 const now=await loadRealSeriesState(f.env);
 assert.equal(res.armed,true);assert.equal(res.attempts,0);assert.equal(res.attemptTarget,5);
 assert.notEqual(now.seriesId,f.series.seriesId);
 assert.equal(now.attemptsStarted,0);assert.equal(now.attemptTarget,5);
 assert.equal(now.fireLatch,null);assert.equal(now.currentAttempt,null);
 assert.equal(now.status,'ARMED_WAITING');
 assert.ok([...f.map.keys()].some(k=>k.startsWith('payne-kalshi:real-ledger:2026-10-12')));
});
test('legacy previous series remains durable in historical run records after first ARM',async()=>{
 const f=fixture();
 await updateFounderControl(f.env,'ARM');
 const keys=[...f.map.keys()].filter(k=>k.startsWith('payne-kalshi:run:')&&k.includes(f.series.seriesId));
 assert.ok(keys.length>0,'old series lacks durable history snapshot when ARM overwrites real-series');
});
test('failed legacy archive persistence prevents ARM and leaves original series intact',async()=>{
 const f=fixture();
 const save=f.env.PAYNE_KALSHI_STATE.put;
 f.env.PAYNE_KALSHI_STATE.put=async(k,v)=>{
  if(k.includes(':founder-disarm-snapshot'))throw Error('SIMULATED_KV_WRITE_FAILURE');
  return save(k,v);
 };
 await assert.rejects(()=>updateFounderControl(f.env,'ARM'),/PAYNE_LEGACY_SESSION_ARCHIVE_NOT_VERIFIED/);
 assert.equal((await loadRealSeriesState(f.env)).seriesId,f.series.seriesId);
 assert.equal(JSON.parse(f.map.get(C)).armed,false);
});
test('repeated attempts after an archived disarm do not duplicate archived snapshot',async()=>{
 const f=fixture();
 await updateFounderControl(f.env,'ARM');
 const oldKey='payne-kalshi:run:'+f.series.seriesId+':founder-disarm-snapshot';
 const first=f.map.get(oldKey);
 assert.ok(first);
 assert.equal([...f.map.keys()].filter(k=>k===oldKey).length,1);
 assert.equal(f.map.get(oldKey),first);
});
test('persisted unresolved entry still blocks first ARM',async()=>{
 const f=fixture({unresolved:true});
 await assert.rejects(()=>updateFounderControl(f.env,'ARM'),/ENTRY_RECONCILIATION_REQUIRED/);
 assert.equal((await loadRealSeriesState(f.env)).seriesId,f.series.seriesId);
});
test('persisted open position still blocks first ARM',async()=>{
 const position={positionId:'historical-position',owner:'PAYNE_KALSHI_REAL',status:'OPEN',exchangeIndex:2,entryOrderId:'provider-order'};
 const f=fixture({position});
 await assert.rejects(()=>updateFounderControl(f.env,'ARM'),/OPEN_POSITION|POSITION_REQUIRES_RECONCILIATION/);
 assert.equal((await loadRealSeriesState(f.env)).position.entryOrderId,'provider-order');
});
test('uncertain provider order still blocks first ARM',async()=>{
 const f=fixture({attemptStatus:'WRITE_ERROR_UNKNOWN'});
 await assert.rejects(()=>updateFounderControl(f.env,'ARM'),/PRIOR_PROVIDER_ORDER_REQUIRES_RECONCILIATION/);
});
