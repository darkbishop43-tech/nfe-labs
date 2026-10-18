import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const fnText=source.match(/async function reconcileDisarmedSupersededSeries\([\s\S]*?\n}\n\n\/\/ Attempt N\+1/);
assert.ok(fnText,'existing lifecycle function found');
const lifecycle=fnText[0].replace(/\n\n\/\/ Attempt N\+1$/,'');
function rig(changes={},controlChanges={}) {
  let writes=0, ledger=0;
  const original={seriesId:'test-series',status:'ARMED_FISHING',attemptsStarted:0,attemptTarget:1,threshold:.55,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2,configFrozen:true,accountingSemantics:'CURRENT',executionIntentsStarted:0,unresolvedEntry:false,currentAttempt:null,fireLatch:null,position:null,positions:[],completedAt:null};
  const series={...original,...changes};
  const control={armed:false,activeThreshold:.65,attemptTarget:5,maxEntryDebitUsd:1,requiredExchangeIndex:2,openPositions:0,...controlChanges};
  const makers={
    seriesTerminal:(s)=>Boolean(s.completedAt)||s.attemptsStarted>=s.attemptTarget,
    frozenSeriesConfig:(s)=>({ok:s.configFrozen===true,threshold:s.threshold,attemptTarget:s.attemptTarget,maxEntryDebitUsd:s.maxEntryDebitUsd}),
    seriesInterlock:(s)=>s.unresolvedEntry?{clear:false,reason:'UNRESOLVED_ENTRY'}:{clear:true,reason:'CLEAN'},
    PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS:'CURRENT',
    LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS:'LEGACY',
    frozenSeriesMatchesControl:(s,c)=>s.threshold===c.activeThreshold&&s.attemptTarget===c.attemptTarget&&s.maxEntryDebitUsd===c.maxEntryDebitUsd,
    appendRealLedger:async()=>{ledger++},
    saveRealSeriesState:async(_env,s)=>{writes++;return s},
  };
  const f=new Function(...Object.keys(makers), lifecycle+';return reconcileDisarmedSupersededSeries')(...Object.values(makers));
  return {f,series,control,counts:()=>({writes,ledger})};
}
test('zero-attempt disarmed mismatch supersedes without changing historical config',async()=>{
  const r=rig();const v=await r.f({},r.series,r.control,Date.UTC(2026,9,18));
  assert.equal(v.terminalized,true);assert.equal(v.series.status,'TERMINAL_DISARMED_CONFIG_SUPERSEDED');
  assert.equal(v.series.threshold,.55);assert.equal(v.series.attemptTarget,1);
  assert.equal(r.control.activeThreshold,.65);assert.equal(r.control.attemptTarget,5);
  assert.equal(r.counts().writes,1);assert.equal(r.counts().ledger,1);
  const again=await r.f({},v.series,r.control);assert.equal(again.terminalized,false);assert.equal(r.counts().writes,1);
});
for (const [name,change,ctl] of [
  ['armed',{}, {armed:true}],
  ['position',{position:{status:'OPEN'}},{}],
  ['positions',{positions:[{status:'OPEN'}]},{}],
  ['unresolved',{unresolvedEntry:true},{}],
  ['fire latch',{fireLatch:{state:'LATCHED'}},{}],
  ['unknown provider',{currentAttempt:{status:'UNKNOWN'}},{}],
  ['execution intent',{executionIntentsStarted:1},{}],
  ['open count',{}, {openPositions:1}],
  ['legacy accounting',{accountingSemantics:'LEGACY'},{}],
  ['invalid frozen',{configFrozen:false},{}],
]) test('zero attempt rejects '+name,async()=>{
  const r=rig(change,ctl);const v=await r.f({},r.series,r.control);
  assert.equal(v.terminalized,false);assert.deepEqual(r.counts(),{writes:0,ledger:0});
});
test('matching config not terminalized',async()=>{
  const r=rig({threshold:.65,attemptTarget:5});const v=await r.f({},r.series,r.control);
  assert.equal(v.terminalized,false);assert.deepEqual(r.counts(),{writes:0,ledger:0});
});
