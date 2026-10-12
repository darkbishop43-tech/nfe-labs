import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeKalshiError,auditStage} from '../src/payne-execution-audit.js';
import {buildPayneAuditView,defaultRealSeriesState} from '../src/index.js';
import {cockpitHtml} from '../src/cockpit-html.js';

test('403 with safe error code and message',()=>{
 const r=sanitizeKalshiError({error:{code:'permission_denied',message:'Order not permitted'}});
 assert.deepEqual(r,{errorCode:'permission_denied',errorMessage:'Order not permitted',errorEvidence:'SANITIZED_ERROR'});
});
test('403 without message does not invent details',()=>{
 assert.deepEqual(sanitizeKalshiError({error:{}}),{errorCode:null,errorMessage:null,errorEvidence:'MESSAGE_NOT_RECORDED'});
});
test('unreadable response distinguished',()=>{
 assert.equal(sanitizeKalshiError({},false).errorEvidence,'UNREADABLE_RESPONSE');
});
test('dangerous credential-like strings are not persisted',()=>{
 for(const message of ['Bearer private-token','KALSHI-ACCESS-SIGNATURE xyz','-----BEGIN PRIVATE KEY-----','API key invalid\\nsecret']){
   assert.equal(sanitizeKalshiError({error:{message}}).errorMessage,null);
 }
 assert.equal(sanitizeKalshiError({error:{code:'Bearer token',message:'Ordinary message'}}).errorCode,null);
});
test('201 accepted and filled are separately classified',()=>{
 assert.equal(auditStage({providerHttpStatus:201,providerOrderId:'order',providerResult:{fillCount:0}}),'PROVIDER_ORDER_ACCEPTED');
 assert.equal(auditStage({providerHttpStatus:201,providerOrderId:'order',providerResult:{fillCount:2}}),'ORDER_FILLED');
});
test('transport boundary without HTTP remains unknown',()=>{
 assert.equal(auditStage({providerPostStarted:true,providerHttpStatus:null,providerOrderId:null}),'PROVIDER_OUTCOME_UNKNOWN');
 assert.equal(auditStage({providerPostStarted:false,providerHttpStatus:null}),'LOCAL_ATTEMPT_ONLY');
});
test('existing attempts used, no new persistence or provider requests',async()=>{
 const seriesId='test-series';
 const series={...defaultRealSeriesState(),seriesId};
 const historical={runId:seriesId,attemptId:'attempt-1',intentNo:1,marketTicker:'TEST-1',outcomeSide:'NO',
  writerInvoked:true,providerPostStarted:true,providerHttpStatus:403,providerOrderId:null,
  terminalClassification:'NO_PROVIDER_EXECUTION'};
 const data=new Map([
  ['payne-kalshi:real-series:v1',JSON.stringify(series)],
  ['payne-kalshi:attempt:'+seriesId+':intent:1',JSON.stringify(historical)]
 ]);
 const calls={get:0,list:0,put:0};
 const env={PAYNE_KALSHI_STATE:{
  get:async key=>{calls.get++;return data.get(key)??null},
  list:async()=>{calls.list++;return {keys:[{name:'payne-kalshi:attempt:'+seriesId+':intent:1'}]}},
  put:async()=>{calls.put++}
 }};
 const out=await buildPayneAuditView(env,seriesId);
 assert.equal(out.attempts.length,1);
 assert.equal(out.attempts[0].httpStatus,403);
 assert.equal(out.attempts[0].providerErrorMessage,null);
 assert.equal(out.attempts[0].stage,'HTTP_RESPONSE_RECEIVED');
 assert.equal(calls.put,0);
});
test('new mobile card panel added without removing existing cockpit anchors',()=>{
 const html=cockpitHtml();
 assert.match(html,/PAYNE EXECUTION AUDIT/);
 assert.match(html,/payneAuditCards/);
 assert.match(html,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,270px\),1fr\)\)/);
 for(const x of ['id=\\"arm\\"','id=\\"disarm\\"']) {
  // Search the rendered string rather than literal source escaping
  assert.ok(html.includes(x.replaceAll('\\\\','\\')) || html.includes(x.replaceAll('\\','')));
 }
 assert.match(html,/LIVE ORDER WATCH/);
});
