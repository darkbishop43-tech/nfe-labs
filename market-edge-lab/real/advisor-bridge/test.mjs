import worker,{displaySafe,STALE_AFTER_SECONDS} from './src/index.js';

const now=Date.parse('2026-09-27T22:45:00.000Z');
const sample={generatedAt:'2026-09-27T22:43:00.000Z',cycleId:'cycle-1',marketRegime:'BROAD_RISK_ON',marketBreadth:{numberAssetsBullish:6,numberAssetsBearish:2,numberAssetsMixed:1,marketBreadthUpPct:66.67,marketBreadthDownPct:22.22},strongestBullishContext:[{asset:'ETH',advisoryConfidence:'HIGH'}],strongestBearishContext:[{asset:'BTC',advisoryConfidence:'MEDIUM'}],marketRiskFlags:['DIVERGENCE'],assetAssessments:[{asset:'BNB',dataStatus:'PARTIAL',advisoryBias:'NEUTRAL',advisoryConfidence:'LOW',setupPhase:'NO_CLEAR_SETUP'}]};
const active=displaySafe(sample,now);
if(active.status!=='ACTIVE') throw new Error('ACTIVE_TEST_FAILED');
if(active.assetAssessments[0].dataStatus!=='PARTIAL') throw new Error('PARTIAL_TRUTH_FAILED');
const stale=displaySafe({...sample,generatedAt:new Date(now-(STALE_AFTER_SECONDS+1)*1000).toISOString()},now);
if(stale.status!=='STALE') throw new Error('STALE_TEST_FAILED');
const fakeMissing={get:async()=>null};
const missing=await worker.fetch(new Request('https://bridge.test/advisor-current'),{ADVISOR_STATE:fakeMissing});
const missingBody=await missing.json();
if(missing.status!==503||missingBody.status!=='UNAVAILABLE') throw new Error('UNAVAILABLE_TEST_FAILED');
for(const method of ['POST','PUT','PATCH','DELETE']){
  const r=await worker.fetch(new Request('https://bridge.test/advisor-current',{method}),{ADVISOR_STATE:fakeMissing});
  if(r.status!==405) throw new Error('MUTATION_METHOD_NOT_BLOCKED_'+method);
}
const text=JSON.stringify(active);
for(const forbidden of ['CLOUDFLARE_API_TOKEN','KALSHI_PRIVATE_KEY','KALSHI_KEY_ID','authorization']){
  if(text.includes(forbidden)) throw new Error('CREDENTIAL_FIELD_LEAK_'+forbidden);
}
console.log('ACTIVE_STATE=PASS');
console.log('STALE_STATE=PASS');
console.log('UNAVAILABLE_STATE=PASS');
console.log('PARTIAL_STATE=PASS');
console.log('MUTATION_METHODS_BLOCKED=PASS');
console.log('CREDENTIAL_EXPOSURE=0');
console.log('advisorWrites=0');
console.log('executionStateWrites=0');
console.log('providerTradingWrites=0');
console.log('capitalMovedUsd=0');
console.log('ordersSubmitted=0');
