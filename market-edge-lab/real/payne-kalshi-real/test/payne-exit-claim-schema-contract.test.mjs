import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const coordinator=readFileSync(new URL('../src/payne-execution-coordinator.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('legacy coordinator EXIT claim omits kind but persists exact six-part identity',()=>{
 const claim=coordinator.match(/if\(action==='CLAIM_EXIT'\)\{[\s\S]*?await tx\.put\(key,\{([\s\S]*?)\}\);/);
 assert.ok(claim);
 for(const part of ['seriesId','attemptNo','specimenId','clientOrderId','ticker','side'])assert.match(claim[1],new RegExp('\\b'+part+'\\b'));
 assert.doesNotMatch(claim[1],/kind\s*:/);
});
test('provider endpoint accepts absent legacy kind but rejects non-EXIT explicit kind',()=>{
 const route=worker.slice(worker.indexOf("if(url.pathname==='/internal/exit-claim-provider-evidence')"),worker.indexOf("if (url.pathname === '/internal/atomic-claim-diagnostic')"));
 assert.match(route,/claim\.kind!==undefined&&claim\.kind!=='EXIT'/);
 assert.match(route,/claim\.seriesId!==seriesId/);
 assert.match(route,/claim\.clientOrderId!==clientOrderId/);
 assert.match(route,/p\?\.attemptId===claim\.specimenId/);
 assert.match(route,/p\?\.marketTicker===claim\.ticker/);
 assert.match(route,/p\?\.outcomeSide===claim\.side/);
 assert.match(route,/verifyProviderTerminalExit/);
 assert.doesNotMatch(route,/providerWrites:\s*[1-9]/);
});
