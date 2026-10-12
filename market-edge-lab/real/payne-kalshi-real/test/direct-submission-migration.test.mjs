import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const writer=fs.readFileSync(new URL('../src/kalshi-real-write.js',import.meta.url),'utf8');
const coordinator=fs.readFileSync(new URL('../src/payne-execution-coordinator.js',import.meta.url),'utf8');
const cycle=source.slice(source.indexOf('export async function runPayneRealExecutionCycle('));
const entry=cycle.slice(cycle.indexOf('// AUTO-style direct submission:'),cycle.indexOf("const result=interpretPayneOrderResponse(body);"));

test('direct entry persistence precedes existing writer',()=>{
  assert.ok(entry.indexOf("status:'SUBMITTING'")<entry.indexOf("postImpl(env,'ENTRY'"));
  assert.ok(entry.indexOf('await saveRealSeriesState(env,series)')<entry.indexOf("postImpl(env,'ENTRY'"));
  assert.doesNotMatch(entry,/claimPayneExecution\(/);
  assert.match(writer,/kalshiExecutionOrderPost\(env,payload/);
});
test('same ticker checks and capacity remain before entry latch',()=>{
  assert.ok(cycle.indexOf('baselineAutoTickerConflict(env,candidate.ticker)')<cycle.indexOf("status:'SUBMITTING'"));
  assert.ok(cycle.indexOf('providerTickerPositionEvidence(env,candidate.ticker)')<cycle.indexOf("status:'SUBMITTING'"));
  assert.ok(cycle.indexOf('seriesInterlock(series,control.maxPositions)')<cycle.indexOf("status:'SUBMITTING'"));
});
test('direct attempts bypass legacy atomic resolution, historical attempts retain it',()=>{
  assert.match(source,/executionHandoff==='DIRECT_KALSHI_WRITER_V1'/);
  assert.match(source,/resolvePayneExecutionClaim\(env,identity,resolution,/);
  assert.match(coordinator,/CLAIM_IDENTITY_MISMATCH/);
});
test('historical coordinator records are never deleted by entry migration',()=>{
  const direct=entry.slice(0,entry.indexOf("postImpl(env,'ENTRY'"));
  assert.doesNotMatch(direct,/RELEASE_PROVEN_NO_POST|RESOLVE_ENTRY|storage\.delete|delete\(/);
});
test('no second strategy decision after final provider read',()=>{
 const before=cycle.slice(cycle.indexOf('const preSubmitStartMs'),cycle.indexOf('const ask=candidate.outcomeSide'));
 assert.match(before,/score:latch\.observedScore/);
 assert.doesNotMatch(before,/FINAL_FEATURE_REQUALIFICATION_FAILED|forceRefresh/);
});
test('full, partial and zero provider results remain distinguished by fill count',()=>{
 assert.match(source,/interpretPayneOrderResponse\(body\)/);
 assert.match(source,/if\(result\.state==='NO_FILL'\)/);
 assert.match(source,/filledCount:Number\(result\.fillCount\)/);
});
test('provider ambiguity persists UNKNOWN and does not auto-replay within cycle',()=>{
 assert.match(source,/status:'WRITE_ERROR_UNKNOWN'/);
 assert.match(source,/status:'ENTRY_RECONCILIATION_REQUIRED'/);
 assert.match(source,/if\(series\?\.unresolvedEntry===true\)/);
});
test('legacy current ZEC incident is never direct migrated in-place',()=>{
 assert.doesNotMatch(source,/KXZEC15M-26OCT112315-15/);
 assert.match(source,/executionHandoff:'DIRECT_KALSHI_WRITER_V1'/);
});
test('shared IOC order payload unchanged',()=>{
 assert.match(source,/time_in_force:'immediate_or_cancel'/);
 assert.match(source,/post_only:false/);
 assert.match(source,/reduce_only:false/);
});
test.todo('concurrent two-instance submission must be proven exclusive: KV latch is not CAS');
test.todo('cross-agent in-flight same-ticker ownership must be proven exclusive');
test.todo('controlled mock full/partial/NO_FILL/rejection/UNKNOWN lifecycle integration execution');
