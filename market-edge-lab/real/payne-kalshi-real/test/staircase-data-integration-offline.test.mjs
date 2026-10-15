import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cockpitHtml} from '../src/cockpit-html.js';
import {firstPullbackShadow} from '../src/first-pullback-shadow.js';
const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const html=cockpitHtml();
const route=source.slice(source.indexOf("if (url.pathname === '/shadow-staircase/observe')"),source.indexOf("if (url.pathname === '/real-state')"));
test('observer stays separate from trading manager and changes no trade controls',()=>{
 assert.ok(route.includes("exactMarketRead(env,p.marketTicker,p.asset)"));
 assert.ok(route.includes("appendRealLedger(env,'SHADOW_STAIRCASE_OBSERVATION'"));
 assert.doesNotMatch(route,/kalshiPayneOrderPost|saveRealSeriesState|settleSeriesControl|control\.armed\s*=|position\.status\s*=/);
});
test('observed provider bid is verified exact ticker and side, with timestamp',()=>{
 assert.ok(route.includes('observed.market?.ticker===p.marketTicker'));
 assert.ok(route.includes("p.outcomeSide==='YES'?market.yesBid:market.noBid"));
 assert.ok(route.includes('observationAt:observed.readAt'));
 assert.ok(route.includes('readMs<closeMs'));
});
test('missing entry and protected level do not invent prices or stop formula',()=>{
 assert.ok(route.includes('protectedLevelStatus:\'NOT_ESTABLISHED\''));
 assert.ok(route.includes('originalPayneDecision:originalDecision'));
 assert.ok(route.includes("typeof p.entryScore==='number'?p.entryScore:null"));
 assert.ok(route.includes("marketPhase:'UNKNOWN'"));
});
test('ledger is historical source and missing complete scan blocks lifetime high',()=>{
 assert.ok(route.includes("listRealLedgerWithEvidence(env,1000)"));
 assert.ok(route.includes("prior.omittedOlderKeys===0"));
 assert.ok(route.includes("'/shadow-staircase/history'"));
 assert.ok(route.includes('complete:rows.omittedOlderKeys===0'));
});
test('cockpit shows live values and records observations through existing handler',()=>{
 assert.ok(html.includes('/shadow-staircase/top3-v2'));
 assert.ok(html.includes('setInterval(poll,10000)'));
 for(const word of ['DIRECT KALSHI','High ','Read age','INSUFFICIENT OBSERVATIONS'])assert.ok(html.includes(word),word);
});
test('shadow evaluator fails closed when independent directional evidence missing',()=>{
 const x=firstPullbackShadow({marketPresent:true,featureAvailable:false,featureFresh:false});
 assert.equal(x.shadowManagement,'UNKNOWN');
 assert.equal(x.doesNotAuthorizeExecution,true);
});
