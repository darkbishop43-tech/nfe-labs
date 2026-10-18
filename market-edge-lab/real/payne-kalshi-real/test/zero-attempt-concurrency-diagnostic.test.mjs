import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const match=source.match(/async function reconcileDisarmedSupersededSeries\([\s\S]*?\n}\n\n\/\/ Attempt N\+1/);
assert.ok(match);
const fn=match[0].replace(/\n\n\/\/ Attempt N\+1$/,'');
function fixture(){
  const stored={seriesId:'race-series',status:'ARMED_FISHING',attemptsStarted:0,attemptTarget:1,threshold:.55,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2,configFrozen:true,accountingSemantics:'CURRENT',executionIntentsStarted:0,unresolvedEntry:false,currentAttempt:null,fireLatch:null,position:null,positions:[],completedAt:null};
  const control={armed:false,activeThreshold:.65,attemptTarget:5,maxEntryDebitUsd:1,requiredExchangeIndex:2,openPositions:0};
  const audit={writes:0,ledger:0,terminalWrites:0};
  let queue=[];let barrier=true;
  const helpers={
    seriesTerminal:s=>Boolean(s.completedAt)||s.attemptsStarted>=s.attemptTarget,
    frozenSeriesConfig:s=>({ok:s.configFrozen===true,threshold:s.threshold,attemptTarget:s.attemptTarget,maxEntryDebitUsd:s.maxEntryDebitUsd}),
    seriesInterlock:s=>s.unresolvedEntry?{clear:false,reason:'UNRESOLVED_ENTRY'}:{clear:true,reason:'CLEAN'},
    PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS:'CURRENT',LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS:'LEGACY',
    frozenSeriesMatchesControl:(s,c)=>s.threshold===c.activeThreshold&&s.attemptTarget===c.attemptTarget,
    appendRealLedger:async()=>{audit.ledger++;if(barrier)await new Promise(resolve=>queue.push(resolve));},
    saveRealSeriesState:async(_env,s)=>{audit.writes++;if(s.status==='TERMINAL_DISARMED_CONFIG_SUPERSEDED')audit.terminalWrites++;Object.assign(stored,s);return s}
  };
  const f=new Function(...Object.keys(helpers),fn+';return reconcileDisarmedSupersededSeries')(...Object.values(helpers));
  return {f,stored,control,audit,release:()=>{barrier=false;queue.splice(0).forEach(x=>x())},pending:()=>queue.length};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function staged(r,n){const running=Array.from({length:n},()=>r.f({},structuredClone(r.stored),structuredClone(r.control)));await flush();assert.equal(r.pending(),n);return running;}
test('two concurrent callers: current path can create two terminal ledger events',async()=>{const r=fixture();const calls=await staged(r,2);r.release();const outcomes=await Promise.all(calls);assert.equal(outcomes.filter(x=>x.terminalized).length,2);assert.equal(r.audit.terminalWrites,2);assert.equal(r.audit.ledger,2)});
for(const [name,mutate] of [
  ['concurrent Founder ARM',r=>{r.control.armed=true}],
  ['concurrent execution intent',r=>{r.stored.executionIntentsStarted=1;r.stored.currentAttempt={status:'SUBMITTING'}}],
  ['concurrent series mutation',r=>{r.stored.unresolvedEntry=true;r.stored.fireLatch={state:'LATCHED'}}]
]) test(name+': stale snapshot can overwrite changed state',async()=>{const r=fixture();const calls=await staged(r,1);mutate(r);r.release();const [out]=await Promise.all(calls);assert.equal(out.terminalized,true);assert.equal(r.stored.status,'TERMINAL_DISARMED_CONFIG_SUPERSEDED');assert.equal(r.stored.unresolvedEntry,false);assert.equal(r.stored.fireLatch,null)});
