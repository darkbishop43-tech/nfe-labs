import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const writer=fs.readFileSync(new URL('../src/kalshi-real-write.js',import.meta.url),'utf8');
const coord=fs.readFileSync(new URL('../src/payne-execution-coordinator.js',import.meta.url),'utf8');
const watch=fs.readFileSync(new URL('../src/payne-live-order-watch.js',import.meta.url),'utf8');
const start=src.indexOf('export async function runPayneRealExecutionCycle(');
const end=src.indexOf('\nexport default {',start);
const cycle=src.slice(start,end>start?end:undefined);
const between=(a,b)=>cycle.slice(cycle.indexOf(a),cycle.indexOf(b));
test('original PAYNE Paper decision remains source for FIRE',()=>{
 assert.match(src,/function fireSpecimenFromSnapshot\(/);
 assert.match(src,/preview\?\.status!=='FIRE_READY'/);
 assert.match(src,/observedScore:selected\?\.payne\?\.score\?\?preview\?\.score/);
 assert.match(src,/function payneDecisionEvidence\(/);
 assert.match(src,/const d=paperDecision\(/);
});
test('durable FIRE identity and threshold frozen unchanged',()=>{
 assert.match(cycle,/fireSpecimenFingerprint\(latch\)/);
 assert.match(cycle,/latch\.identityFingerprint!==expectedFingerprint/);
 assert.match(cycle,/Number\(latch\.threshold\)!==cfg\.threshold/);
 assert.match(cycle,/Number\(latch\.effectiveLockThreshold\)!==cfg\.effectiveLockThreshold/);
});
test('no second independent feature refresh after pre-submit',()=>{
 const segment=between("const preSubmitStartMs","const ask=candidate.outcomeSide");
 assert.doesNotMatch(segment,/forceRefresh|readAuthoritativePayneFeatures|payneStage\(|FINAL_FEATURE_REQUALIFICATION_FAILED/);
 assert.match(segment,/score:latch\.observedScore/);
 assert.match(segment,/move:latch\.observedMove/);
 assert.match(segment,/edge:latch\.observedEdge/);
 assert.match(segment,/fair:latch\.observedFair/);
});
test('exact market and clock checks remain before handoff',()=>{
 assert.match(cycle,/kalshiCandidateTimeSafe/);
 assert.match(cycle,/freshLock\?\.market\?\.ticker!==candidate\.ticker/);
 assert.match(cycle,/preSubmit\?\.market\?\.ticker!==candidate\.ticker/);
 assert.match(cycle,/preSubmit\?\.market\?\.closeTime/);
});
test('price and quantity derived from final provider book and approved debit',()=>{
 const portion=between('const ask=candidate.outcomeSide','const providerAttemptNoCandidate=');
 assert.match(portion,/preSubmit\.market\.yesAsk/);
 assert.match(portion,/estimateKalshiFeeSafeSize\(ask,cfg\.maxEntryDebitUsd\)/);
 assert.match(portion,/Number\(sizing\.totalDebitUsd\)>cfg\.maxEntryDebitUsd/);
});
test('index-2 funding required before intent',()=>{
 assert.match(cycle,/index2FundingEvidence\(balanceBody,sizing\.totalDebitUsd\)/);
 assert.ok(cycle.indexOf('index2FundingEvidence')<cycle.indexOf("status:'EXECUTION_INTENT'"));
});
test('PAYNE-authorized exact side and ticker persisted in attempt',()=>{
 assert.match(cycle,/marketTicker:candidate\.ticker,outcomeSide:candidate\.outcomeSide/);
 assert.match(cycle,/score:finalFeature\.score/);
 assert.match(cycle,/finalFeatureRequalification:'ORIGINAL_FIRE_PRESERVED'/);
});
test('atomic claim precedes provider writer and protects duplicate',()=>{
 assert.ok(cycle.indexOf('claimPayneExecution(env,entryClaimIdentity)')<cycle.indexOf("postImpl(env,'ENTRY'"));
 assert.match(cycle,/if\(ownership\.granted!==true\)/);
 assert.match(coord,/if\(prior\) return \{granted:false,reason:'ATTEMPT_ALREADY_CLAIMED'/);
});
test('provider writer shared mechanical primitive and IOC is preserved',()=>{
 assert.match(writer,/kalshiExecutionOrderPost\(env,payload/);
 assert.match(writer,/PAYNE_ENTRY_ARM_REQUIRED/);
 assert.match(writer,/PAYNE_ENTRY_EXCEEDS_SERIES_STAKE_CAP/);
 assert.match(writer,/PAYNE_WRITE_INDEX2_REQUIRED/);
 assert.match(src,/time_in_force:'immediate_or_cancel'/);
});
test('live result and no-provider results retain distinct accounting',()=>{
 assert.match(cycle,/INVALIDATED_BEFORE_POST/);
 assert.match(cycle,/providerPostStarted/);
 assert.match(src,/PROVIDER_RECONCILED_NO_EXECUTION/);
 assert.match(src,/NO_FILL/);
 assert.match(src,/FILLED/);
});
test('multi-position capacity and read-only watch retained',()=>{
 assert.match(coord,/occupied>=maxPositions/);
 assert.match(watch,/occupied\.length<cap/);
 assert.match(watch,/providerWrites:0,ordersSubmitted:0/);
});
test('no strategy constants added to durable handoff',()=>{
 const section=between('const preSubmitStartMs','const ask=candidate.outcomeSide');
 assert.doesNotMatch(section,/\b(?:0\.65|0\.80|0\.50)\b/);
});
