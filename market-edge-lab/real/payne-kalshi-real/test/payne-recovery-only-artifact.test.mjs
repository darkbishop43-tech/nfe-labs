import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import recoveryOnly from '../src/payne-recovery-only-worker.js';

const root=path.resolve(import.meta.dirname,'../src');
const source=fs.readFileSync(path.join(root,'payne-recovery-only-worker.js'),'utf8');
const config=fs.readFileSync(path.resolve(root,'../wrangler.recovery-only.toml'),'utf8');
const imports=/from ['"]\.\/([^'"]+)['"]/g;
function closure(file,seen=new Set()){
 if(seen.has(file))return seen;
 seen.add(file);
 const contents=fs.readFileSync(path.join(root,file),'utf8');
 for(const m of contents.matchAll(imports))closure(m[1],seen);
 return seen;
}
const graph=closure('payne-recovery-only-worker.js');
test('recovery-only artifact import graph excludes trading order writer and execution controller',()=>{
 assert.equal(graph.has('index.js'),false);
 assert.equal(graph.has('kalshi-real-write.js'),false);
 assert.equal(graph.has('payne-paper-brain.js'),false);
 assert.equal(graph.has('cockpit-html.js'),false);
});
test('same Worker and existing coordinator/KV bindings without new secrets',()=>{
 assert.match(config,/name = "market-edge-payne-kalshi-real"/);
 assert.match(config,/main = "src\/payne-recovery-only-worker.js"/);
 assert.match(config,/class_name = "PayneExecutionCoordinator"/);
 assert.match(config,/03352b0ccb034f1bb8206f663a04b125/);
 assert.doesNotMatch(config,/\[vars\]|KALSHI_EXECUTION_PRIVATE_KEY|PAYNE_REAL_DEFAULT_ARMED/);
});
test('recovery-only status is explicitly non-executing',async()=>{
 const r=await recoveryOnly.fetch(new Request('https://payne.test/recovery-only/status'),{});
 const j=await r.json();
 assert.equal(j.tradingSubmissionReachable,false);
 assert.equal(j.controlWritesReachable,false);
});
test('POST requests including control and order are rejected',async()=>{
 for(const route of ['/control','/order','/real-fire','/recovery-only/status']){
  const response=await recoveryOnly.fetch(new Request('https://payne.test'+route,{method:'POST'}),{});
  assert.equal(response.status,405);
 }
});
test('unrecognized GET trading routes cannot start execution',async()=>{
 for(const route of ['/fire','/real-execution','/control','/arm']){
  const response=await recoveryOnly.fetch(new Request('https://payne.test'+route),{});
  assert.equal(response.status,404);
 }
});
test('recovery-only source contains no control writer or trading cycle reference',()=>{
 assert.doesNotMatch(source,/kalshiPayneOrderPost|runPayneRealExecutionCycle|runReadOnlyScan|updateFounderControl|claimPayneExecution/);
 assert.match(source,/recoverPayneProviderConfirmedExits/);
 assert.match(source,/recoverProviderConfirmedFireLatch/);
});
test('recovery-only cron performs no orders for empty KV',async()=>{
 let writes=0;
 const env={PAYNE_KALSHI_STATE:{get:async()=>null,put:async()=>{writes++;throw Error('WRITES_FORBIDDEN')}}};
 await recoveryOnly.scheduled({},env);
 assert.equal(writes,0);
});
