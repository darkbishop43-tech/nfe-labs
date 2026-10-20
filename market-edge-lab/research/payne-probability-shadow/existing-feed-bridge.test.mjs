import test from 'node:test';import assert from 'node:assert/strict';
import {fromVerifiedDisplayFeed,fetchExistingReadOnlyFeed} from './existing-feed-bridge.mjs';
const valid={schema:'PAYNE_DISPLAY_MARKET_FEED_V1',source:'PAYNE_AUTHENTICATED_KALSHI_GET_ONLY',providerWrites:0,
quotes:[{ticker:'KXBTC15M-EXAMPLE',closeTime:'2026-10-20T12:15:00Z',status:'LIVE',
observedAt:'2026-10-20T12:01:00Z',providerUpdatedAt:'2026-10-20T12:00:58Z',
yesBid:0.41,yesAsk:0.44,noBid:0.56,noAsk:0.59}]};
test('existing read response yields both sides but no fabricated probability',()=>{
 const out=fromVerifiedDisplayFeed(valid);assert.equal(out.records.length,2);
 assert.equal(out.records[0].ask,0.44);assert.equal(out.records[1].bid,0.56);
 assert.equal(out.records[0].depth,null);assert.equal(out.records[0].probability.pWin,null);
 assert.equal(out.coverage.complete,0);assert.equal(out.providerWrites,0);
});
test('invalid feed schema and provider write reports rejected',()=>{
 assert.throws(()=>fromVerifiedDisplayFeed({}),/UNVERIFIED/);
 assert.throws(()=>fromVerifiedDisplayFeed({...valid,providerWrites:1}),/UNVERIFIED/);
});
test('stale quotes fail closed',()=>{
 const out=fromVerifiedDisplayFeed({...valid,quotes:[{...valid.quotes[0],status:'STALE'}]});
 assert.equal(out.records[0].ask,null);assert.equal(out.records[0].probability.pWin,null);
});
test('exact existing route only with injected read callback',async()=>{
 let count=0;const out=await fetchExistingReadOnlyFeed({getJson:async path=>{assert.equal(path,'/display-market-feed');count++;return valid;}});
 assert.equal(count,1);assert.equal(out.coverage.complete,0);
});
