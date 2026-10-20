import test from 'node:test';import assert from 'node:assert/strict';import {collectReadOnly} from './read-only-observation-collector.mjs';
test('authenticated GET only; missing historical probability inputs stay unknown',async()=>{
const calls=[];const get=async path=>{calls.push(path);if(path.includes('orderbook'))return {orderbook:{yes:[[0.3,5]],no:[[0.4,3]]}};if(path.includes('series_ticker'))return {markets:[{ticker:'KXBTC15M-EXAMPLE'}]};return {market:{ticker:'KXBTC15M-EXAMPLE',yes_ask_dollars:'0.6',no_ask_dollars:'0.7',volume_fp:'33',expiration_time:'2026-10-20T12:15:00Z'}};};
const result=await collectReadOnly({get,seriesTickers:['KXBTC15M'],now:()=> '2026-10-20T12:00:00Z'});
assert.equal(result.records.length,2);assert.equal(result.coverage.complete,0);assert.equal(result.providerWrites,0);
assert.equal(result.records[0].bookTopAsk,0.6);assert.equal(result.records[0].topDepth,3);
assert.equal(result.records[0].probability.pWin,null);
assert.ok(calls.every(x=>x.startsWith('/trade-api/v2/')));
});
test('unavailable GET returns UNKNOWN and never fabricates probability',async()=>{
const x=await collectReadOnly({get:async()=>{throw Error('403')},seriesTickers:['KXBTC15M']});
assert.equal(x.records[0].status,'UNKNOWN');assert.equal(x.coverage.complete,0);
});
test('invalid ticker rejects before network',async()=>{
await assert.rejects(()=>collectReadOnly({get:async()=>{throw Error('called')},seriesTickers:['../orders']}),/INVALID_SERIES_TICKER/);
});
