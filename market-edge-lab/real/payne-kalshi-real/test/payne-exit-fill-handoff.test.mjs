import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const pending=p=>p.some(x=>x.status==='RECONCILIATION_UNKNOWN'||(x.status==='EXIT_RECONCILIATION_REQUIRED'&&x.exitFillAwaitingProviderReconciliation!==true));
test('FILLED is pending provider-flat verification, not instantly disarmed',()=>{
 assert.match(src,/position\.exitFillAwaitingProviderReconciliation=true/);
 assert.match(src,/p\.exitFillAwaitingProviderReconciliation!==true/);
 assert.equal(pending([{status:'EXIT_RECONCILIATION_REQUIRED',exitFillAwaitingProviderReconciliation:true}]),false);
});
test('NO_FILL and PARTIAL retry states do not disarm',()=>{
 assert.equal(pending([{status:'EXIT_RETRY'}]),false);
});
test('actual unknown provider reconciliation still fail closes',()=>{
 assert.equal(pending([{status:'RECONCILIATION_UNKNOWN'}]),true);
 assert.equal(pending([{status:'EXIT_RECONCILIATION_REQUIRED'}]),true);
});
test('provider OPEN after exit still triggers reconciliation safety',()=>{
 assert.match(src,/if\(position\.status==='EXIT_RECONCILIATION_REQUIRED'\)\{/);
 assert.match(src,/await settleSeriesControl\(env,series,1,\{failClosed:true\}\);/);
});
test('confirmed flat settlement preserves continuing armed series',()=>{
 assert.match(src,/if\(rec\.classification==='FLAT'\)/);
 assert.match(src,/series\.status=\(await loadControl\(env\)\)\.armed\?'ARMED_FISHING'/);
 assert.match(src,/await settleSeriesControl\(env,series,0\)/);
});
test('no duplicate exit after filled pending reconciliation',()=>{
 const guard=src.indexOf("if(position.status==='EXIT_RECONCILIATION_REQUIRED')");
 const quote=src.indexOf('const quote=await exactMarketRead',guard);
 assert.ok(guard>=0&&quote>guard);
 assert.ok(src.slice(guard,quote).includes('return saveRealSeriesState'));
});
