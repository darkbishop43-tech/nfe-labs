import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalIsolationEligibility as gate} from '../src/historical-isolation-gate.js';
const now=Date.parse('2026-10-08T04:00:00Z');
const series={unresolvedEntry:true,seriesId:'historical-series',currentAttempt:{attemptId:'attempt-2',clientOrderId:'payne-real-historical-entry'},position:null,fireLatch:null};
const exposure={readOnly:true,classification:'CLEAR',ordersPaginationComplete:true,positionsPaginationComplete:true,
  asOf:new Date(now-1000).toISOString(),outstandingPayneManagement:false,historicalUnresolvedEntry:true,
  historicalSeriesId:'historical-series',activeOrderCount:0,ambiguousOrderCount:0,
  openPositionCount:0,ambiguousPositionCount:0};
test('fresh complete CLEAR evidence allows eligibility without changing historical UNKNOWN',()=>{
  const before=JSON.stringify(series),r=gate({series,exposure,nowMs:now});
  assert.equal(r.eligible,true);assert.equal(r.historicalResult,'UNKNOWN');assert.equal(JSON.stringify(series),before);
});
for(const [name,change] of [
 ['open order',{activeOrderCount:1}],['ambiguous order',{ambiguousOrderCount:1}],
 ['open position',{openPositionCount:1}],['ambiguous position',{ambiguousPositionCount:1}],
 ['pending',{classification:'PENDING'}],['unknown',{classification:'UNKNOWN'}],
 ['incomplete orders',{ordersPaginationComplete:false}],['incomplete positions',{positionsPaginationComplete:false}],
 ['management',{outstandingPayneManagement:true}],['different series',{historicalSeriesId:'other'}],
 ['missing observation',{asOf:null}],['stale observation',{asOf:new Date(now-60000).toISOString()}],
 ['future observation',{asOf:new Date(now+1000).toISOString()}],
]) test('fails closed: '+name,()=>assert.equal(gate({series,exposure:{...exposure,...change},nowMs:now}).eligible,false));
test('fails closed on unresolved ownership',()=>assert.equal(gate({series:{...series,position:{status:'OPEN'}},exposure,nowMs:now}).eligible,false));
test('fails closed on missing client identity',()=>assert.equal(gate({series:{...series,currentAttempt:{attemptId:'attempt-2'}},exposure,nowMs:now}).eligible,false));
test('fails closed on active fire latch',()=>assert.equal(gate({series:{...series,fireLatch:{state:'LATCHED'}},exposure,nowMs:now}).eligible,false));
