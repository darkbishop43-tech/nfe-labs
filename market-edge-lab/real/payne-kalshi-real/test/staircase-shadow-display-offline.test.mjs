import test from 'node:test';import assert from 'node:assert/strict';import {cockpitHtml} from '../src/cockpit-html.js';import {readFile} from 'node:fs/promises';
const html=cockpitHtml();const src=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
test('phone-friendly staircase scorecard shows required evidence labels',()=>{
 for(const key of ['DYNAMIC STAIRCASE','verified exit bid','Observed high:','Current bid:','Protected level:','Market phase:','Original PAYNE:','Shadow:','Last:']) assert.ok(html.includes(key),key);
});
test('the cockpit polls the separate existing-worker read observation route',()=>{
 assert.ok(html.includes("fetch('/shadow-staircase/observe'"));
 assert.ok(html.includes('setInterval(update,10000)'));
 assert.ok(src.includes("if (url.pathname === '/shadow-staircase/observe')"));
 const route=src.slice(src.indexOf("if (url.pathname === '/shadow-staircase/observe')"),src.indexOf("if (url.pathname === '/real-state')"));
 assert.ok(route.includes('exactMarketRead(env,p.marketTicker,p.asset)'));
 assert.doesNotMatch(route,/kalshiPayneOrderPost|saveRealSeriesState|settleSeriesControl|updateFounderControl/);
});
test('unknown data and proposed protection remain evidence-gated',()=>{
 assert.ok(html.includes('Protected level: NOT ESTABLISHED'));
 assert.ok(html.includes("AWAITING OBSERVATIONS"));
 assert.ok(src.includes("evidenceSource:verifiedBid!==null?'KALSHI_AUTHENTICATED_MARKET_GET'"));
 assert.ok(src.includes("marketPhase:'UNKNOWN'"));
});
