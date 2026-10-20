import test from 'node:test';import assert from 'node:assert/strict';
import {viewModel,renderMonitor,refreshMonitor} from './research-monitor.mjs';
const ASSETS=['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR'];
const quotes=ASSETS.map(asset=>({ticker:'KX'+asset+'15M-26OCT200445-45',status:'UNAVAILABLE',reason:'STALE_PROVIDER_UPDATE',observedAt:'2026-10-20T08:38:07.777Z',providerUpdatedAt:'2026-10-20T08:30:01.612694Z',closeTime:'2026-10-20T08:45:00Z',yesBid:null,yesAsk:null,noBid:null,noAsk:null}));
const feed={schema:'PAYNE_DISPLAY_MARKET_FEED_V1',source:'PAYNE_AUTHENTICATED_KALSHI_GET_ONLY',providerWrites:0,providerGets:9,quotes};
test('nine assets, both sides, stale prices unknown',()=>{const vm=viewModel(feed,{now:Date.parse('2026-10-20T08:38:09Z')});assert.equal(vm.assets.length,9);assert.equal(vm.coverage.totalObservations,18);assert.equal(vm.coverage.complete,0);assert.equal(vm.providerWrites,0);for(const a of vm.assets){assert.equal(a.rows.length,2);for(const row of a.rows){assert.equal(row.bid,null);assert.equal(row.ask,null);assert.equal(row.pWin,null);assert.equal(row.expectedNetValue,null);assert.ok(row.missing.length>0);}}});
test('monitor escapes ticker text in rendering',()=>{const vm=viewModel(feed);const html=renderMonitor(vm);assert.ok(html.includes('PAYNE Probability Shadow'));assert.ok(html.includes('KXBTC15M'));assert.ok(html.includes('Missing inputs'));});
test('refresh uses only existing feed path',async()=>{let count=0;const vm=await refreshMonitor({getJson:async p=>{assert.equal(p,'/display-market-feed');count++;return feed;}});assert.equal(count,1);assert.equal(vm.assets.length,9);});
test('unsupported source rejected',()=>assert.throws(()=>viewModel({...feed,source:'OTHER'}),/UNVERIFIED/));
