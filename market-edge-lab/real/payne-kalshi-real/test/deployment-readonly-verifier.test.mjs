import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExistingPayneEvidence} from '../../../../.github/scripts/payne-empty-series-readonly-verifier.mjs';
const series={schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'bd881b11-b130-491f-a75f-a98425b92fd9',positions:[],position:null,currentAttempt:null,attemptsStarted:0,executionIntentsStarted:0,unresolvedEntry:false};
const control={armed:false,openPositions:0};
const env={CLOUDFLARE_ACCOUNT_ID:'test',CLOUDFLARE_API_TOKEN:'test',PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN:'z'.repeat(40)};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
function mock({c=control,s=series,ordersDiagnostic=404,closureDiagnostic=400,kvFail=false}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method});
  if(url.includes('/storage/kv/')){
   if(kvFail)return response({},503);
   if(url.endsWith(encodeURIComponent('payne-kalshi:control:v1')))return response(c);
   if(url.endsWith(encodeURIComponent('payne-kalshi:real-series:v1')))return response(s);
   throw Error('unexpected KV key');
  }
  if(url.includes('/internal/atomic-claim-diagnostic'))return response({ok:false,status:'NOT_CURRENT_SPECIMEN'},ordersDiagnostic);
  if(url.includes('/internal/closure-maintenance-evidence'))return response({ok:false},closureDiagnostic);
  throw Error('unexpected URL');
 };
 return {fetchImpl,calls};
}
test('authenticated current KV read and existing diagnostics report precise incomplete coverage',async()=>{
 const m=mock();
 const r=await verifyExistingPayneEvidence({fetchImpl:m.fetchImpl,env});
 assert.equal(r.allowed,false);
 assert.equal(r.seriesId,series.seriesId);
 assert.equal(r.positionRecordCount,0);
 assert.deepEqual(m.calls.map(x=>x.method),['GET','GET','GET','GET']);
 for(const x of ['SERIES_WIDE_DURABLE_CLAIM_ENUMERATION_UNAVAILABLE',
 'ZERO_POSITION_AUTHENTICATED_KALSHI_ORDER_COVERAGE_UNAVAILABLE',
 'ZERO_POSITION_AUTHENTICATED_KALSHI_POSITION_COVERAGE_UNAVAILABLE',
 'PROVIDER_RECONCILIATION_COVERAGE_UNAVAILABLE'])assert.ok(r.missingCoverage.includes(x));
 assert.equal(r.providerOrdersComplete,false);
 assert.equal(r.coordinatorClaimsComplete,false);
});
test('even synthetic 200 diagnostics cannot masquerade as full pagination and claims',async()=>{
 const m=mock({ordersDiagnostic:200,closureDiagnostic:200});
 const r=await verifyExistingPayneEvidence({fetchImpl:m.fetchImpl,env});
 assert.equal(r.allowed,false);
 assert.equal(r.providerOrdersComplete,false);
 assert.equal(r.coordinatorClaimsComplete,false);
});
test('missing or failed KV rejects without provider authority',async()=>{
 const r=await verifyExistingPayneEvidence({fetchImpl:mock({kvFail:true}).fetchImpl,env});
 assert.equal(r.allowed,false);
 assert.ok(r.missingCoverage.includes('AUTHENTICATED_CONTROL_OR_SERIES_READ_INCOMPLETE'));
});
test('armed and nonempty series add explicit safety failures',async()=>{
 const r=await verifyExistingPayneEvidence({fetchImpl:mock({c:{armed:true,openPositions:1},s:{...series,positions:[{status:'OPEN'}]}}).fetchImpl,env});
 assert.equal(r.allowed,false);
 assert.ok(r.missingCoverage.includes('FOUNDER_NOT_VERIFIED_DISARMED_FLAT'));
 assert.ok(r.missingCoverage.includes('POSITION_COLLECTION_NOT_EMPTY'));
});
test('missing credentials fail closed',async()=>{
 const r=await verifyExistingPayneEvidence({env:{}});
 assert.equal(r.allowed,false);
 assert.ok(r.missingCoverage.includes('CLOUDFLARE_KV_READ_CREDENTIALS_UNAVAILABLE'));
});
