import test from 'node:test';
import assert from 'node:assert/strict';
import { cockpitHtml } from '../src/cockpit-html.js';
test('one isolated PAYNE chart panel preserves existing cockpit controls',()=>{
 const html=cockpitHtml();
 assert.equal((html.match(/id="payneChartPanel"/g)||[]).length,1);
 assert.ok(html.indexOf('id="payneChartPanel"')<html.indexOf('id="topExecutionPipelineCard"'));
 for(const id of ['arm','disarm','liveOrderWatch','payneChartCanvas','pcFrame','pcType','payneChartEmaInputs']){
  assert.ok(html.includes('id="'+id+'"'),id+' missing');
 }
 for(const asset of ['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR'])assert.ok(html.includes("'"+asset+"'"));
 assert.ok(html.includes("setInterval(refreshMarketDisplay,10000)"));
 assert.ok(html.includes("window.payneChartAcceptFeed?.(feed)"));
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,2);
 for(const match of scripts)new Function(match[1]);
});
test('chart contains no trading control endpoint or provider POST',()=>{
 const html=cockpitHtml();
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 const chart=scripts.at(-1)[1];
 assert.ok(!chart.includes('/control'));
 assert.ok(!chart.includes("fetch("));
 assert.ok(!chart.includes("localStorage"));
 assert.ok(chart.includes("feed.source!=='PAYNE_AUTHENTICATED_KALSHI_GET_ONLY'"));
 assert.ok(chart.includes("q.ticker+'|'+q.outcomeSide"));
});
