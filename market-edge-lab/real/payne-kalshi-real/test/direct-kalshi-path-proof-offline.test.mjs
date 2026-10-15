import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {cockpitHtml} from '../src/cockpit-html.js';
const index=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const features=await readFile(new URL('../src/payne-kalshi-features.js',import.meta.url),'utf8');
const ui=cockpitHtml();
const between=(a,b)=>index.slice(index.indexOf(a),index.indexOf(b,index.indexOf(a)));
test('PAYNE exact contract and discovery use direct authenticated Kalshi GET',()=>{
 assert.match(index,/kalshiGetOnly\(env,'\/trade-api\/v2\/markets\//);
 assert.match(index,/kalshiGetOnly\(env,path\)/);
 assert.match(index,/readAt:new Date\(\)\.toISOString\(\)/);
});
test('PAYNE feature processor consumes direct markets rather than Baseline',()=>{
 assert.match(features,/export async function buildPayneOwnedFeatureState\(/);
 assert.match(features,/sourceProvenMarkets\(markets\)/);
 assert.match(features,/baselineStateRead:false/);
 assert.doesNotMatch(features,/BASELINE_REAL_READ|baselineReadOnlyPath/);
 assert.match(index,/return buildPayneOwnedFeatureState\(env,markets,nowMs,options\)/);
});
test('real position management consumes direct quote and owned features',()=>{
 const path=between('async function managePayneRealPosition','async function baselineAutoTickerConflict');
 // Source order differs: instead use a bounded slice.
 const i=index.indexOf('async function managePayneRealPosition');
 const excerpt=index.slice(i,i+12000);
 assert.match(excerpt,/exactMarketRead\(env,position\.marketTicker,position\.asset\)/);
 assert.match(excerpt,/readAuthoritativePayneFeatures\(env,quote\?\.market/);
 assert.doesNotMatch(excerpt,/baselineReadOnlyPath\(/);
});
test('staircase observes direct market GET and displays observation time',()=>{
 const observer=between("if (url.pathname === '/shadow-staircase/observe')","if (url.pathname === '/real-state')");
 assert.match(observer,/exactMarketRead\(env,p\.marketTicker,p\.asset\)/);
 assert.match(observer,/observationAt:observed\.readAt/);
 assert.doesNotMatch(observer,/baselineReadOnlyPath|BASELINE_REAL_READ/);
 assert.match(ui,/\/shadow-staircase\/observe/);
 assert.match(ui,/setInterval\(update,10000\)/);
});
test('existing FIRE guard DOES require Baseline AUTO ownership read',()=>{
 assert.match(index,/const auto=await baselineAutoTickerConflict\(env,candidate\.ticker\)/);
 assert.match(index,/if\(!auto\.ok \|\| auto\.conflict!==false\)/);
 assert.match(index,/HOLD_AUTO_OWNERSHIP_UNKNOWN/);
 assert.match(index,/baselineReadOnlyPath\(env,'\/execution-test-state'\)/);
});
