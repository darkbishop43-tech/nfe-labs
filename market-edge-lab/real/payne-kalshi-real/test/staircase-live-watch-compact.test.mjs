import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {cockpitHtml} from '../src/cockpit-html.js';
const src=await readFile(new URL('../src/index.js',import.meta.url),'utf8'),html=cockpitHtml();
const route=src.slice(src.indexOf("if (url.pathname === '/shadow-staircase/observe')"),src.indexOf("if (url.pathname === '/shadow-staircase/history')"));
test('watched contract comes from existing PAYNE selection, reverified by exact authenticated GET',()=>{
 assert.match(route,/kvGetJson\(env,CURRENT_KEY\)/);
 assert.match(route,/exactMarketRead\(env,ticker,watch.asset\|\|null\)/);
 assert.match(route,/observed.market\?\.ticker===ticker/);
 assert.match(route,/atMs<closeMs/);
 assert.match(route,/KALSHI_AUTHENTICATED_MARKET_GET/);
});
test('watch-only observations append to existing ledger without position or control writes',()=>{
 assert.match(route,/appendRealLedger\(env,'SHADOW_STAIRCASE_OBSERVATION'/);
 assert.match(route,/watching:true/);
 assert.doesNotMatch(route,/kalshiPayneOrderPost|saveRealSeriesState|settleSeriesControl|updateFounderControl/);
});
test('compact graph remains above exports and supports watching without owned position',()=>{
 assert.match(html,/height:158px/);
 assert.ok(html.indexOf('id="payneStaircaseShadow"')<html.indexOf('DATA EXPORT'));
 assert.match(html,/!live.ownedPosition&&!live.watching/);
 assert.match(html,/setInterval\(update,10000\)/);
});
