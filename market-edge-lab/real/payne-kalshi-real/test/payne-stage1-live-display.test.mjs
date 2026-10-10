import test from 'node:test';
import assert from 'node:assert/strict';
import {cockpitHtml} from '../src/cockpit-html.js';
import {liveOrderWatchProjection} from '../src/payne-live-order-watch.js';

test('Stage 1 renders exclusively dynamic observed ticker data, not seeded price history',()=>{
 const html=cockpitHtml();
 const scripts=html.split('<script>').slice(1).map(x=>x.split('</script>')[0]);
 assert.ok(scripts.length>0,'cockpit contains executable inline script');
 for(const script of scripts)assert.doesNotThrow(()=>new Function(script),'inline script parses');

 assert.match(html,/function takeFeedObservation\(/);
 assert.match(html,/function observeMarketFeed\(/);
 assert.match(html,/takeFeedObservation\(m.ticker,m.selectedAsk,m.providerReadAt\)/);
 assert.match(html,/miniFeed\(m.ticker\)/);
 assert.match(html,/miniFeed\(r.ticker\)/);
 assert.match(html,/TREND UNAVAILABLE/);
 assert.match(html,/OBSERVED /);
 assert.match(html,/delta>0/);
 assert.match(html,/delta<0/);
 assert.doesNotMatch(html,/takeFeedObservation\(['"](?:NEAR|BTC|ETH|SOL)['"]/);
});

test('three independently owned positions project into active Live Order Watch',()=>{
 const positions=['X1','X2','X3'].map((ticker,i)=>({owner:'PAYNE_KALSHI_REAL',attemptId:'P-'+i,marketTicker:ticker,status:'OPEN',reconciliationState:'OPEN'}));
 const output=liveOrderWatchProjection({positions},[],[]);
 assert.equal(output.active.length,3);
 assert.deepEqual(output.active.map(p=>p.ticker),['X1','X2','X3']);
});

test('provider reconciled CLOSED/FLAT leaves active while UNKNOWN remains',()=>{
 const positions=[
 {owner:'PAYNE_KALSHI_REAL',attemptId:'closed',marketTicker:'DYNAMIC-1',status:'CLOSED',reconciliationState:'FLAT'},
 {owner:'PAYNE_KALSHI_REAL',attemptId:'unknown',marketTicker:'DYNAMIC-2',status:'UNKNOWN',reconciliationState:'UNKNOWN'}
 ];
 const output=liveOrderWatchProjection({positions},[],[]);
 assert.deepEqual(output.active.map(p=>p.attemptId),['unknown']);
 assert.deepEqual(output.closed.map(p=>p.attemptId),['closed']);
});
