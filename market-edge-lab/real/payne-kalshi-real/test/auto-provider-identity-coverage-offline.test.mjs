import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const payne=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const auto=await readFile(new URL('../../baseline/src/index.js',import.meta.url),'utf8');
test('AUTO execution-test generated ID prefix exists, but prefix alone is not proof',()=>{assert.match(auto,/nfe-test-/);assert.match(auto,/executionTestClientOrderId/);});
test('current PAYNE FIRE guard fails closed if AUTO service is unavailable',()=>{
 assert.match(payne,/const auto=await baselineAutoTickerConflict\(env,candidate\.ticker\)/);
 assert.match(payne,/if\(!auto\.ok \|\| auto\.conflict!==false\)/);
 assert.match(payne,/HOLD_AUTO_OWNERSHIP_UNKNOWN/);
});
test('existing position GET handles pagination but aggregates all account owners',()=>{
 const a=payne.slice(payne.indexOf('async function providerTickerPositionEvidence'),payne.indexOf('async function providerTickerPositionEvidence')+2600);
 assert.match(a,/while\(cursor\)/);
 assert.match(a,/market_positions/);
 assert.match(a,/MATCHED_TICKER_NONZERO/);
 assert.doesNotMatch(a,/client_order_id|fill_id/);
});
test('single-page historical identity read does not establish full orders and fills coverage',()=>{
 const x=payne.slice(payne.indexOf('async function reconcileUnresolvedEntryFromProvider'),payne.indexOf('async function reconcileUnresolvedEntryFromProvider')+3400);
 assert.match(x,/portfolio\/orders/);
 assert.match(x,/portfolio\/fills/);
 assert.match(x,/historical\/fills/);
 assert.match(x,/\?limit=200&subaccount=0&ticker=/);
 assert.doesNotMatch(x,/while\s*\(\s*cursor\s*\)/);
});
test('AUTO execution-test state read does not prove old AUTO legacy identities or partial fills',()=>{
 const a=payne.slice(payne.indexOf('async function baselineAutoTickerConflict'),payne.indexOf('function payneRealScope'));
 assert.match(a,/execution-test-state/);
 assert.doesNotMatch(a,/fill_id|client_order_id|order_id|historical_orders/);
});
