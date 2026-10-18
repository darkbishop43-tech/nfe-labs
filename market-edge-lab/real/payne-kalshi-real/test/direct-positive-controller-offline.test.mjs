import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {runPayneRealExecutionCycle,defaultControlState,defaultRealSeriesState,fireSpecimenFingerprint,effectiveLockThreshold,buildPayneAuditView,payneStage,payneFeatureBoundaryEvidence} from '../src/index.js';
import {kalshiPayneOrderPost} from '../src/kalshi-real-write.js';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key=privateKey.export({type:'pkcs8',format:'pem'});
const ticker='KXBTC15M-OFFLINE-TEST';
function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}})}
function createFixture(kind='FILLED',opts={}){
 const now=Date.now(),open=new Date(now-3*60_000).toISOString(),close=new Date(now+12*60_000).toISOString();
 const id='isolated-'+Math.random().toString(36).slice(2);
 const control={...defaultControlState(),armed:true,activeThreshold:.60,attemptTarget:5,maxEntryDebitUsd:1,maxPositions:3};
 const series={...defaultRealSeriesState(),seriesId:id,status:'ARMED_FISHING',
  configFrozen:true,frozenAt:new Date(now).toISOString(),threshold:.60,effectiveLockThreshold:effectiveLockThreshold(.60),
  attemptTarget:5,maxEntryDebitUsd:1,requiredExchangeIndex:2};
 const latch={state:'LATCHED',seriesId:id,attemptNo:1,ticker,asset:'BTC',outcomeSide:'YES',
  direction:'UP',marketOpenTime:open,marketCloseTime:close,marketExchangeIndex:2,
  threshold:.60,effectiveLockThreshold:effectiveLockThreshold(.60),observedScore:.78,
  observedMove:.01,observedEdge:.07,observedFair:.84,fireObservedAt:new Date(now).toISOString()};
 latch.specimenId=id+':fire:1:'+ticker+':'+latch.fireObservedAt;
 latch.identityFingerprint=fireSpecimenFingerprint(latch);series.fireLatch=latch;
 const state=new Map([['payne-kalshi:control:v1',JSON.stringify(control)],['payne-kalshi:real-series:v1',JSON.stringify(series)]]);
 const requests=[];let posts=0;
 const provider=async(url,init={})=>{
  requests.push({url:String(url),method:init.method||'GET',body:init.body||null});
  assert.match(String(url),/^https:\/\/external-api\.kalshi\.com\//);
  if(init.method==='POST'){
    posts++;
    const p=JSON.parse(init.body);
    if(kind==='REJECT')return json({error:{code:'reject'}},409);
    if(kind==='AUDIT403')return json({error:{code:'TEST_ORDER_REJECTED',message:'Offline simulated rejection'}},403);
    if(kind==='AMBIGUOUS')return json({unexpected:true});
    const count=Number(p.count);
    const fill=kind==='ZERO'?0:kind==='PARTIAL'?Math.min(1,count/2):count;
    return json({order_id:'offline-order',client_order_id:p.client_order_id,fill_count:fill,remaining_count:kind==='PARTIAL'?count-fill:0,average_fill_price:p.price,average_fee_paid:'0.00'});
  }
  if(String(url).includes('/portfolio/positions'))return json({market_positions:[],cursor:''});
  if(String(url).includes('/portfolio/balance'))return json({balance_breakdown:[{exchange_index:2,balance:100}]});
  if(String(url).includes('/portfolio/orders'))return json({orders:[]});
  if(String(url).includes('/portfolio/fills'))return json({fills:[]});
  if(String(url).includes('/historical/fills'))return json({fills:[]});
  if(String(url).includes('/portfolio/settlements'))return json({settlements:[]});
  if(String(url).includes('/markets/'))return json({market:{ticker,open_time:open,close_time:close,exchange_index:2,status:'open',
    yes_ask_dollars:'0.72',yes_bid_dollars:'0.71',no_ask_dollars:'0.29',no_bid_dollars:'0.28'}});
  throw Error('UNMOCKED_PROVIDER_PATH '+url);
 };
 const prior=globalThis.fetch;
 const env={KALSHI_EXECUTION_KEY_ID:'offline-only',KALSHI_EXECUTION_PRIVATE_KEY:key,
  BASELINE_REAL_READ:{fetch:async()=>json({positions:opts.conflict?[{marketTicker:ticker,status:'OPEN'}]:[]})},
  PAYNE_KALSHI_STATE:{
   get:async k=>state.get(k)||null,
   put:async(k,v)=>{state.set(k,String(v))},
   list:async({prefix})=>({keys:[...state.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})
  }};
 const execute=async()=>{
  globalThis.fetch=provider;
  try{
   return await runPayneRealExecutionCycle(env,{postImpl:(e,k,p,scope)=>kalshiPayneOrderPost(e,k,p,scope,{fetchImpl:provider})});
  }finally{globalThis.fetch=prior}
 };
 return {execute,env,state,requests,latch,get posts(){return posts},get attempt(){return JSON.parse(state.get('payne-kalshi:real-series:v1')).currentAttempt},get series(){return JSON.parse(state.get('payne-kalshi:real-series:v1'))}};
}
for(const [kind,expected] of [['FILLED','FILLED'],['PARTIAL','PARTIAL'],['ZERO','NO_FILL'],['REJECT','PROVIDER_REJECTED_OR_UNKNOWN'],['AMBIGUOUS','UNKNOWN']]){
 test('ACTUAL FIRE controller + shared IOC writer: '+kind,{concurrency:false},async()=>{
  const f=createFixture(kind);
  await f.execute();
  assert.equal(f.posts,1,'must invoke exactly one mocked provider POST');
  const req=f.requests.find(r=>r.method==='POST');
  assert.equal(JSON.parse(req.body).ticker,ticker);
  assert.equal(JSON.parse(req.body).time_in_force,'immediate_or_cancel');
  assert.equal(f.attempt.executionHandoff,'DIRECT_KALSHI_WRITER_V1');
  assert.equal(f.attempt.status,expected);
  assert.equal(f.attempt.fireSpecimenId,f.latch.specimenId);
  const events=[...f.state.entries()].filter(([k])=>k.startsWith('payne-kalshi:real-ledger:')).map(([,v])=>JSON.parse(v).type);
  assert.ok(events.includes('ENTRY_DIRECT_SUBMITTING'));
  if(kind==='FILLED'||kind==='PARTIAL')assert.ok(f.series.position?.entryOrderId);
  if(kind==='ZERO')assert.ok(events.includes('ENTRY_NO_FILL'));
  if(kind==='AMBIGUOUS'||kind==='REJECT')assert.equal(f.series.unresolvedEntry,true);
 });
}
test('ACTUAL FIRE controller: AUTO same-ticker OPEN blocks provider entry',{concurrency:false},async()=>{
 const f=createFixture('FILLED',{conflict:true});
 await f.execute();
 assert.equal(f.posts,0);
});
test('ACTUAL FIRE controller: replay after resolved full-fill does not resubmit',{concurrency:false},async()=>{
 const f=createFixture();
 await f.execute();
 await f.execute();
 assert.equal(f.posts,1);
});
test('ACTUAL FIRE controller: ambiguous result does not replay',{concurrency:false},async()=>{
 const f=createFixture('AMBIGUOUS');
 await f.execute();
 await f.execute();
 assert.equal(f.posts,1);
});
test('ACTUAL FIRE controller: concurrent calls expose real invocation count',{concurrency:false},async()=>{
 const f=createFixture();
 await Promise.allSettled([f.execute(),f.execute()]);
 assert.equal(f.posts,1,'CONCURRENT_DUPLICATE_PROVIDER_POST');
});

test('OFFLINE END-TO-END: 403 provider handler -> persisted attempt -> existing ledger -> audit read -> panel contract',{concurrency:false},async()=>{
 const f=createFixture('AUDIT403');
 const before=[...f.state.keys()];
 await f.execute();
 assert.equal(f.posts,1);
 const attempt=f.attempt;
 assert.equal(attempt.providerHttpStatus,403);
 assert.equal(attempt.providerErrorCode,'TEST_ORDER_REJECTED');
 assert.equal(attempt.providerErrorMessage,'Offline simulated rejection');
 assert.equal(attempt.providerErrorEvidence,'SANITIZED_ERROR');
 assert.equal(attempt.terminalClassification,'PROVIDER_REJECTED_OR_UNKNOWN');
 assert.equal(attempt.marketTicker,ticker);
 assert.ok(attempt.attemptId);
 assert.ok(Date.parse(attempt.providerResponseAt)>0);
 const ledger=[...f.state.entries()].filter(([k])=>k.startsWith('payne-kalshi:real-ledger:')).map(([,v])=>JSON.parse(v));
 const entry=ledger.find(x=>x.type==='ENTRY_PROVIDER_REJECTED_OR_UNKNOWN');
 assert.ok(entry);
 assert.equal(entry.httpStatus,403);
 assert.equal(entry.providerErrorCode,attempt.providerErrorCode);
 assert.equal(entry.providerErrorMessage,attempt.providerErrorMessage);
 assert.equal(entry.attemptId,attempt.attemptId);
 assert.equal(entry.ticker,ticker);
 assert.ok(Date.parse(entry.at)>0);
 assert.equal(entry.providerResponseAt,attempt.providerResponseAt);
 const view=await buildPayneAuditView(f.env,f.series.seriesId);
 assert.equal(view.count,1);
 const card=view.attempts[0];
 assert.equal(card.attemptId,attempt.attemptId);
 assert.equal(card.ticker,ticker);
 assert.equal(card.httpStatus,403);
 assert.equal(card.providerErrorCode,'TEST_ORDER_REJECTED');
 assert.equal(card.providerErrorMessage,'Offline simulated rejection');
 assert.equal(card.terminalClassification,'PROVIDER_REJECTED_OR_UNKNOWN');
 assert.equal(card.providerOrderId,null);
 assert.equal(card.stage,'HTTP_RESPONSE_RECEIVED');
 assert.equal(view.providerWrites,0);
 assert.ok(!JSON.stringify(view).includes('PRIVATE KEY'));
 const {cockpitHtml}=await import('../src/cockpit-html.js');
 const html=cockpitHtml();
 assert.ok(html.includes('PAYNE EXECUTION AUDIT'));
 assert.ok(html.includes('payneAuditCards'));
 assert.ok(html.includes('providerErrorMessage'));
 assert.ok(html.includes('NOT RECORDED'));
 assert.equal(before.filter(k=>k.startsWith('payne-kalshi:real-ledger:')).length,0);
 console.log('OFFLINE_AUDIT_CHAIN_PASS',JSON.stringify({attemptId:card.attemptId,ticker:card.ticker,httpStatus:card.httpStatus,errorCode:card.providerErrorCode,errorMessage:card.providerErrorMessage,terminalClassification:card.terminalClassification}));
});

test('FOUR-STAGE MOCKED FIRE: one qualified fresh feature, durable seeded specimen, one governed mock post',{concurrency:false},async()=>{
 const f=createFixture('FILLED');
 const X=0.73, founderPull=0.60;
 const feature={available:true,score:X,edge:(X-0.50)/4,move:0.004,fair:0.80};
 let strategyVotes=0;
 const gate=payneStage(feature,founderPull);strategyVotes++;
 const lockEvidence=payneFeatureBoundaryEvidence(feature,founderPull,null,'LOCK');
 assert.equal(gate.radar,true);
 assert.equal(lockEvidence.lock,'PASS');
 assert.equal(lockEvidence.pull,'PASS');
 assert.equal(strategyVotes,1,'one authoritative combined LOCK/PULL decision');
 assert.equal(f.series.fireLatch.state,'LATCHED','durable specimen is seeded for actual FIRE controller');
 assert.equal(f.series.fireLatch.identityFingerprint,fireSpecimenFingerprint(f.series.fireLatch));
 await f.execute();
 assert.equal(f.posts,1,'one offline mock provider POST');
 assert.equal(f.attempt.executionHandoff,'DIRECT_KALSHI_WRITER_V1');
 await f.execute();
 assert.equal(f.posts,1,'duplicate replay must not post');
 assert.equal(strategyVotes,1,'no second vote in controlled test');
 const events=[...f.state.entries()].filter(([k])=>k.startsWith('payne-kalshi:real-ledger:')).map(([,v])=>JSON.parse(v));
 assert.equal(events.filter(x=>x.type==='ENTRY_PROVIDER_POST_STARTED').length,1);
 console.log('FOUR_STAGE_MOCK_CONTROLLER_PASS',JSON.stringify({
   strategyVotes,seededDurableLatchCount:1,mockedProviderPosts:f.posts,duplicatePosts:0,
   realProviderWrites:0,source:'OFFLINE_SYNTHETIC_LATCH_NOT_FULL_SCAN_LATCH_INTEGRATION'
 }));
});
