import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  defaultControlState,
  updateFounderControl,
  loadControl,
  defaultRealSeriesState,
  saveRealSeriesState,
  loadRealSeriesState,
  listRealLedger,
  buildHistoricalSeriesReport,
  runPayneRealExecutionCycle,
  interpretPayneOrderResponse,
  runReadOnlyScan,
  summarizeRealExecutionState,
  reconcileUnresolvedEntryFromProvider,
  frozenSeriesConfig,
  seriesInterlock,
  seriesTerminal,
  parseFounderThreshold,
  effectiveLockThreshold,
  payneStage,
  fireSpecimenFromSnapshot,
  fireSpecimenFingerprint,
  payneFeatureFailureReasons,
  payneFeatureBoundaryEvidence,
  payneBookEvidence,
} from '../src/index.js';
import { kalshiPayneOrderPost, payneOrderWriteProof } from '../src/kalshi-real-write.js';
import { assertKalshiMechanicalOrderPayload } from '../../shared/kalshi-execution-write.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;

class MemoryKV {
  constructor(){this.store=new Map([['payne-kalshi:control:v1',JSON.stringify(defaultControlState())]]);}
  async get(key){return this.store.has(key)?this.store.get(key):null;}
  async put(key,value){this.store.set(key,String(value));}
  async delete(key){this.store.delete(key);}
  async list({prefix=''}={}){return {keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};}
}

function jsonResponse(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}

function baselineShadow({score=.86,move=.005,edge=.09,close='2026-10-02T06:15:00Z'}={}){
  return {
    ok:true,mode:'REAL_KALSHI_SHADOW',status:'LIVE_KALSHI_SHADOW',startedAt:'2026-10-02T06:00:00Z',lastRunAt:'2026-10-02T06:04:30Z',
    priceSources:{BTC:'COINBASE'},
    opportunities:[
      {marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move,fair:.59,edge,score,openTime:'2026-10-02T06:00:00Z',closeTime:close,durationMs:Date.parse(close)-Date.parse('2026-10-02T06:00:00Z'),horizon:'15m'},
      {marketTicker:'KXBTC15M-REALTEST',outcomeSide:'NO',direction:'DOWN',asset:'BTC',move,fair:.41,edge:-Math.abs(edge),score:.14,openTime:'2026-10-02T06:00:00Z',closeTime:close,durationMs:Date.parse(close)-Date.parse('2026-10-02T06:00:00Z'),horizon:'15m'},
    ],
  };
}

const baselineMethods=[];
function moveForScore(score){
  return (Number(score)-0.5)/72;
}
async function seedPaynePriorSpot(e,shadow=baselineShadow()){
  const yes=(shadow?.opportunities||[]).find(x=>x?.asset==='BTC'&&x?.outcomeSide==='YES');
  const move=Number.isFinite(Number(yes?.score))?moveForScore(yes.score):Number(yes?.move||0);
  const prior=100/(1+move);
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:feature-shadow:v2-paper-brain',JSON.stringify({
    schema:'PAYNE_PAPER_BRAIN_KALSHI_FEATURE_STATE_V1',
    savedAt:'2026-10-02T06:04:00Z',
    prices:{BTC:prior},
    referencePrices:{BTC:prior},
    priceSources:{BTC:'COINBASE'}
  }));
  return prior;
}
function spotForScores(referenceScore,targetScore){
  const ref=100/(1+moveForScore(referenceScore));
  return ref*(1+moveForScore(targetScore));
}

function baselineService(shadow=baselineShadow(),autoPositions=[]){
  return {async fetch(request){
    baselineMethods.push(request.method||'GET');
    const url=new URL(request.url);
    if(url.pathname==='/shadow-state') return jsonResponse(shadow);
    if(url.pathname==='/execution-test-state') return jsonResponse({ok:true,readOnly:true,state:{status:'COMPLETE',positions:autoPositions,attempts:[]}});
    if(url.pathname==='/execution-test-nofill-forensic') return jsonResponse({ok:true,audited:[]});
    if(url.pathname==='/forensic-provider-history') return jsonResponse({ok:true,fills:[],settlements:[],positions:[]});
    return jsonResponse({ok:false,error:'NOT_FOUND'},404);
  }};
}

async function credentials(){
  const pair=await crypto.subtle.generateKey({name:'RSA-PSS',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  let binary=''; for(const b of der) binary+=String.fromCharCode(b);
  const base64=btoa(binary).match(/.{1,64}/g).join('\n');
  return {KALSHI_EXECUTION_KEY_ID:'TEST_KEY',KALSHI_EXECUTION_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`};
}

async function env({shadow=baselineShadow(),autoPositions=[]}={}){
  const e={PAYNE_KALSHI_STATE:new MemoryKV(),BASELINE_REAL_READ:baselineService(shadow,autoPositions),...(await credentials())};
  await seedPaynePriorSpot(e,shadow);
  return e;
}

function providerMarket({status='open',close='2026-10-02T06:15:00Z',exchangeIndex=2,yesBid=.48,yesAsk=.50}={}){
  return {
    ticker:'KXBTC15M-REALTEST',series_ticker:'KXBTC15M',exchange_index:exchangeIndex,title:'BTC up in next 15 minutes?',status,
    open_time:'2026-10-02T06:00:00Z',close_time:close,
    yes_bid_dollars:String(yesBid),yes_ask_dollars:String(yesAsk),
    no_bid_dollars:String(1-yesAsk),no_ask_dollars:String(1-yesBid),
  };
}

function installProvider({index3=0,index2=15.91,position='ABSENT',exactSequence=[],settled=false,marketIndex=2,spotSequence=[]}={}){
  const original=globalThis.fetch,calls=[]; let exactNo=0,spotNo=0,allowDiscovery=true;
  globalThis.fetch=async (url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body||null});
    const u=String(url);
    if(u.includes('api.exchange.coinbase.com/products/BTC-USD/ticker')){
      const price=spotSequence.length?spotSequence[Math.min(spotNo++,spotSequence.length-1)]:100;
      return jsonResponse({price:String(price)});
    }
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[{exchange_index:0,balance:0},{exchange_index:2,balance:index2},{exchange_index:3,balance:index3}]});
    if(u.includes('series_ticker=KXBTC15M')) {
      if(!allowDiscovery) throw new Error('SECOND_DISCOVERY_FORBIDDEN_AFTER_FIRE_LATCH');
      return jsonResponse({markets:[providerMarket({exchangeIndex:marketIndex})]});
    }
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    if(u.includes('/portfolio/orders?')) return jsonResponse({orders:[]});
    if(u.includes('/portfolio/fills?')) return jsonResponse({fills:[]});
    if(u.includes('/historical/fills?')) return jsonResponse({fills:[]});
    if(u.includes('/portfolio/positions?')){
      if(position==='HTTP_FAIL') return jsonResponse({error:'x'},500);
      if(position==='OPEN') return jsonResponse({market_positions:[{ticker:'KXBTC15M-REALTEST',position_fp:'1'}],cursor:''});
      if(position==='FLAT') return jsonResponse({market_positions:[{ticker:'KXBTC15M-REALTEST',position_fp:'0'}],cursor:''});
      return jsonResponse({market_positions:[],cursor:''});
    }
    if(u.includes('/portfolio/settlements?')) return jsonResponse({settlements:settled?[{ticker:'KXBTC15M-REALTEST',market_result:'yes',settled_time:'2026-10-02T06:16:00Z'}]:[]});
    if(u.includes('/markets/KXBTC15M-REALTEST')){
      const x=exactSequence.length?exactSequence[Math.min(exactNo++,exactSequence.length-1)]:{status:200,market:providerMarket({yesBid:.49,yesAsk:.50,exchangeIndex:marketIndex})};
      return jsonResponse(x.market||{},x.status??200);
    }
    throw new Error('unexpected provider URL '+u);
  };
  return {calls,forbidDiscovery:()=>{allowDiscovery=false;},restore:()=>{globalThis.fetch=original;}};
}

function postFixture(resultBody,status=200){
  const calls=[];
  const fn=async (env,kind,payload,scope)=>{
    calls.push({kind,payload:structuredClone(payload),scope:structuredClone(scope)});
    return {response:jsonResponse(resultBody,status),proof:payneOrderWriteProof(kind,payload,scope),writerInvoked:true,providerPostStarted:true};
  };
  return {calls,fn};
}

async function arm(e){
  const c=await updateFounderControl(e,'ARM');
  assert.equal(c.armed,true);
  return c;
}


// ---------- ZERO-MONEY GOVERNANCE PROOF helpers ----------
const T0=Date.parse('2026-10-02T06:05:00Z');
const FILL={order_id:'E-FILL',client_order_id:'CID',fill_count:1,remaining_count:0,average_fill_price:.50,average_fee_paid:.02};
const NOFILL={order_id:'E-NF',fill_count:0,remaining_count:1,average_fill_price:null,average_fee_paid:0};
const providerPosts=io=>io.calls.filter(c=>c.method==='POST').length;
const entries=post=>post.calls.filter(c=>c.kind==='ENTRY');
async function configure(e,{threshold,stake,target}){
  if(threshold!=null) await updateFounderControl(e,'SET_THRESHOLD',threshold);
  if(stake!=null) await updateFounderControl(e,'SET_STAKE',stake);
  if(target!=null) await updateFounderControl(e,'SET_ATTEMPT_TARGET',target);
}
const cycle=async(e,post,ms=T0)=>{
  await runReadOnlyScan(e,'ZERO_MONEY_GOVERNANCE_SCAN',ms);
  return runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:ms});
};
const cycleNoScan=(e,post,ms=T0)=>runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:ms});
const frozenSeries=async(e,over={})=>{
  const threshold=over.threshold??.80;
  return saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'GOV-S',status:'ARMED_FISHING',attemptsStarted:1,attemptTarget:5,threshold,effectiveLockThreshold:over.effectiveLockThreshold??effectiveLockThreshold(threshold),maxEntryDebitUsd:1,configFrozen:true,...over});
};
const armedControl=async(e)=>{ // put control in a legitimately armed, matching state without calling live ARM semantics twice
  const c=await loadControl(e); await e.PAYNE_KALSHI_STATE.put('payne-kalshi:control:v1',JSON.stringify({...c,armed:true,attemptTarget:5,attempts:1}));
};
const cleanPosition=(over={})=>({schema:'PAYNE_REAL_POSITION_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'GOV-S',attemptId:'GOV-S-1',attemptNo:1,status:'CLOSED',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',exchangeIndex:2,entryOrderId:'E',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.5,entryTime:'2026-10-02T06:04:00Z',reconciliationState:'FLAT',...over});

test('promoted Paper PULL validator accepts only source-proven .80',()=>{
  assert.deepEqual(parseFounderThreshold('.80'),{ok:true,value:.80});
  for(const raw of ['.50','.55','.64','.65','.70','.75','.85','1.00','.49','1.01','.555','abc','NaN','Infinity']){
    assert.equal(parseFounderThreshold(raw).ok,false,raw);
  }
});

test('promoted Paper LOCK is fixed at .65 independent of PULL input',async()=>{
  for(const input of [.50,.65,.80,1.00]) assert.equal(effectiveLockThreshold(input),.65);
  const e=await env(),io=installProvider();
  try{
    await configure(e,{threshold:.80,stake:1,target:1});
    await arm(e);
    const series=await loadRealSeriesState(e);
    assert.equal(series.threshold,.80);
    assert.equal(series.effectiveLockThreshold,.65);
    assert.equal(frozenSeriesConfig(series).effectiveLockThreshold,.65);
  }finally{io.restore();}
});

test('promoted Paper PULL semantics preserve radar lock edge move gates',()=>{
  assert.equal(payneStage({score:.50,edge:.05,move:.003},.80).stage,'RADAR');
  assert.equal(payneStage({score:.65,edge:.05,move:.003},.80).stage,'LOCK_IN');
  assert.equal(payneStage({score:.80,edge:.05,move:.003},.80).pullTrigger,true);
  assert.equal(payneStage({score:.79,edge:.05,move:.003},.80).pullTrigger,false);
  assert.equal(payneStage({score:.80,edge:.05,move:.001},.80).pullTrigger,false);
  assert.equal(payneStage({score:.80,edge:0,move:.003},.80).pullTrigger,false);
});

// ---------- FIRE→EXECUTION exact-specimen latch proof ----------
function mutableBaseline(initial){
  let current=initial;
  return {
    set(next){current=next;},
    binding:{async fetch(request){
      baselineMethods.push(request.method||'GET');
      const url=new URL(request.url);
      if(url.pathname==='/shadow-state') return jsonResponse(current);
      if(url.pathname==='/execution-test-state') return jsonResponse({ok:true,readOnly:true,state:{status:'COMPLETE',positions:[],attempts:[]}});
      if(url.pathname==='/execution-test-nofill-forensic') return jsonResponse({ok:true,audited:[]});
      if(url.pathname==='/forensic-provider-history') return jsonResponse({ok:true,fills:[],settlements:[],positions:[]});
      return jsonResponse({ok:false,error:'NOT_FOUND'},404);
    }},
  };
}

function sequentialBaseline(...snapshots){
  let i=0;
  return {async fetch(request){
    baselineMethods.push(request.method||'GET');
    const url=new URL(request.url);
    if(url.pathname==='/shadow-state'){
      const body=snapshots[Math.min(i,snapshots.length-1)]; i++;
      return jsonResponse(body);
    }
    if(url.pathname==='/execution-test-state') return jsonResponse({ok:true,readOnly:true,state:{status:'COMPLETE',positions:[],attempts:[]}});
    if(url.pathname==='/execution-test-nofill-forensic') return jsonResponse({ok:true,audited:[]});
    if(url.pathname==='/forensic-provider-history') return jsonResponse({ok:true,fills:[],settlements:[],positions:[]});
    return jsonResponse({ok:false,error:'NOT_FOUND'},404);
  }};
}

function shadowWithCompetingLeader({btcScore=.83,btcMove=.004,btcEdge=.08,zecScore=.95,zecMove=.006,zecEdge=.10}={}){
  const base=baselineShadow({score:btcScore,move:btcMove,edge:btcEdge});
  return {...base,opportunities:[
    ...base.opportunities,
    {marketTicker:'KXZEC15M-LEADER',outcomeSide:'YES',direction:'UP',asset:'ZEC',move:zecMove,fair:.61,edge:zecEdge,score:zecScore,openTime:'2026-10-02T06:00:00Z',closeTime:'2026-10-02T06:15:00Z',durationMs:900000,horizon:'15m'},
  ]};
}

test('FEATURE EPOCH 1: epoch A qualifies but fresher PAYNE spot epoch B invalidates before FIRE latch with no attempt consumed',async()=>{
  const e=await env();
  const io=installProvider({spotSequence:[100,spotForScores(.716,.50)]});
  try{
    await configure(e,{threshold:.80,stake:1,target:5}); await arm(e);
    await runReadOnlyScan(e,'FEATURE_EPOCH_TEST',T0);
    const out=await loadRealSeriesState(e);
    assert.equal(out.attemptsStarted,0);
    assert.equal(out.fireLatch,null);
    assert.equal(out.status,'ARMED_FISHING');
    assert.equal(out.fireRefreshEvidence.sourceLastRunAt,'2026-10-02T06:05:00.000Z');
    assert.ok(out.fireRefreshEvidence.failureReasons.includes('FIRE_SCORE_BELOW_THRESHOLD'));
    assert.ok(out.fireRefreshEvidence.failureReasons.includes('FIRE_SCORE_BELOW_EFFECTIVE_LOCK'));
    assert.ok(out.fireRefreshEvidence.failureReasons.includes('FIRE_EDGE_NOT_POSITIVE'));
    assert.ok(out.fireRefreshEvidence.failureReasons.includes('FIRE_MOVE_BELOW_MINIMUM'));
    const ledger=await listRealLedger(e);
    assert.equal(ledger.at(-1).type,'FIRE_INVALIDATED_FEATURE_REFRESH');
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

test('FEATURE EPOCH 2: fresher same-specimen PAYNE spot epoch that still qualifies becomes latched FIRE evidence',async()=>{
  const e=await env();
  const io=installProvider({spotSequence:[100,spotForScores(.716,.74)]});
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FEATURE_EPOCH_TEST',T0);
    const out=await loadRealSeriesState(e);
    assert.equal(out.fireLatch.state,'LATCHED');
    assert.equal(out.fireLatch.ticker,'KXBTC15M-REALTEST');
    assert.equal(out.fireLatch.fireFeatureEvidence.sourceLastRunAt,'2026-10-02T06:05:00.000Z');
    assert.ok(Math.abs(out.fireLatch.fireFeatureEvidence.score-.74)<1e-10);
    assert.deepEqual(out.fireLatch.fireFeatureEvidence.failureReasons,[]);
  }finally{io.restore();}
});

test('FEATURE EPOCH 3/9/10: valid direct FIRE refresh + valid final refresh reaches shared-writer boundary and persists full books',async()=>{
  const e=await env();
  const io=installProvider({spotSequence:[100,spotForScores(.716,.74),spotForScores(.716,.75)]});
  const zeroWriterCalls=[];
  const zeroWriter=async(env,kind,payload,scope)=>{
    zeroWriterCalls.push({kind,payload,scope});
    return kalshiPayneOrderPost(env,kind,payload,scope,{fetchImpl:async()=>jsonResponse(NOFILL)});
  };
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FEATURE_EPOCH_TEST',T0);
    const latched=await loadRealSeriesState(e);
    assert.equal(latched.fireLatch.state,'LATCHED');
    const out=await runPayneRealExecutionCycle(e,{postImpl:zeroWriter,nowMs:T0});
    assert.equal(zeroWriterCalls.length,1);
    assert.equal(out.fireLatch.finalFeature,'PASS');
    assert.ok(Math.abs(out.fireLatch.finalFeatureEvidence.score-.75)<1e-10);
    for(const key of ['fireBookEvidence','freshLockBookEvidence','preSubmitBookEvidence']){
      assert.ok(Number.isFinite(Number(out.fireLatch[key].bid)),key+' bid');
      assert.ok(Number.isFinite(Number(out.fireLatch[key].ask)),key+' ask');
      assert.ok(Number.isFinite(Number(out.fireLatch[key].spread)),key+' spread');
      assert.ok(out.fireLatch[key].providerTimestamp,key+' timestamp');
    }
    assert.equal(out.fireLatch.providerPost,'YES');
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

test('FEATURE EPOCH 4-8: exact final feature failure labels use existing PAYNE predicates only',()=>{
  const threshold=.80, lock=.65;
  assert.ok(payneFeatureFailureReasons({available:true,score:.79,edge:.05,move:.003},threshold,lock,'FINAL').includes('FINAL_SCORE_BELOW_THRESHOLD'));
  assert.ok(payneFeatureFailureReasons({available:true,score:.64,edge:.05,move:.003},threshold,lock,'FINAL').includes('FINAL_SCORE_BELOW_EFFECTIVE_LOCK'));
  assert.ok(payneFeatureFailureReasons({available:true,score:.82,edge:0,move:.003},threshold,lock,'FINAL').includes('FINAL_EDGE_NOT_POSITIVE'));
  assert.ok(payneFeatureFailureReasons({available:true,score:.82,edge:.05,move:.001},threshold,lock,'FINAL').includes('FINAL_MOVE_BELOW_MINIMUM'));
  assert.deepEqual(payneFeatureFailureReasons({available:false},threshold,lock,'FINAL'),['FINAL_FEATURE_NOT_AVAILABLE']);
});

test('FEATURE EPOCH 9: Fresh LOCK and pre-submit may pass while final direct feature requalification fails distinctly',async()=>{
  const e=await env();
  const io=installProvider({spotSequence:[100,spotForScores(.716,.74),spotForScores(.716,.69)]}),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FEATURE_EPOCH_TEST',T0);
    const out=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,0);
    assert.equal(out.fireLatch.freshLock,'PASS');
    assert.equal(out.fireLatch.preSubmit,'PASS');
    assert.equal(out.fireLatch.finalFeature,'FAIL');
    assert.equal(out.fireLatch.invalidationReason,'FINAL_FEATURE_REQUALIFICATION_FAILED');
    assert.ok(out.fireLatch.finalFeatureEvidence.failureReasons.includes('FINAL_SCORE_BELOW_THRESHOLD'));
    assert.equal(out.attemptsStarted,0);
  }finally{io.restore();}
});

test('FEATURE EPOCH 11: known PAYNE rejection states are explicit NOT_REACHED rather than fabricated UNKNOWN',()=>{
  const d=payneFeatureBoundaryEvidence({available:true,score:.49,edge:.05,move:.003},.80,.65,'FIRE');
  assert.equal(d.radar,'FAIL');
  assert.equal(d.lock,'NOT_REACHED');
  assert.equal(d.pull,'NOT_REACHED');
  const book=payneBookEvidence({yesBid:.909,yesAsk:.910,providerReadAt:'2026-10-04T22:02:19Z'},'YES',.910);
  assert.equal(book.bid,.909); assert.equal(book.ask,.91); assert.equal(book.spread,.001); assert.equal(book.selectedPrice,.91);
});

test('FIRE LATCH 1/6: FIRE-ready BTC remains execution specimen even after a different global feature leader appears; no second discovery occurs',async()=>{
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})});
  const mutable=mutableBaseline(baselineShadow({score:.86,move:.005,edge:.09}));
  e.BASELINE_REAL_READ=mutable.binding;
  const io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,stake:1,target:1}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0);
    const latched=await loadRealSeriesState(e);
    assert.equal(latched.fireLatch.state,'LATCHED');
    assert.equal(latched.fireLatch.ticker,'KXBTC15M-REALTEST');
    assert.equal(latched.fireLatch.outcomeSide,'YES');
    assert.equal(latched.fireLatch.threshold,.80);
    assert.equal(latched.fireLatch.effectiveLockThreshold,.65);
    assert.equal(latched.fireLatch.identityFingerprint,fireSpecimenFingerprint(latched.fireLatch));

    // Global evidence now has another higher-scoring leader. The execution engine must NOT rediscover/reselect it.
    mutable.set(shadowWithCompetingLeader({btcScore:.86,zecScore:.99}));
    io.forbidDiscovery();
    const out=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,1);
    assert.equal(entries(post)[0].payload.ticker,'KXBTC15M-REALTEST');
    assert.equal(out.currentAttempt.marketTicker,'KXBTC15M-REALTEST');
    assert.equal(out.currentAttempt.fireSpecimenId,latched.fireLatch.specimenId);
  }finally{io.restore();}
});

test('FIRE LATCH 2: same latched specimen passing fresh LOCK + pre-submit reaches provider POST path',async()=>{
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})}),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0);
    const before=await loadRealSeriesState(e); assert.equal(before.fireLatch.state,'LATCHED');
    const out=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,1);
    assert.equal(out.fireLatch.providerPost,'YES');
    assert.equal(out.fireLatch.providerOrderId,'E-NF');
    assert.equal(out.fireLatch.finalResult,'NO_FILL');
  }finally{io.restore();}
});

test('FIRE LATCH 3: same specimen fresh LOCK failure invalidates before POST without consuming a provider NO_FILL',async()=>{
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})});
  const io=installProvider({exactSequence:[
    {status:200,market:providerMarket()}, {status:200,market:providerMarket()}, // scan
    {status:200,market:providerMarket()},                                      // FIRE feature exact reread
    {status:500,market:{error:'fresh lock failed'}},                           // execution fresh lock
  ]});
  const post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0);
    const out=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,0);
    assert.equal(out.attemptsStarted,0);
    assert.equal(out.fireLatch.state,'INVALIDATED_BEFORE_POST');
    assert.equal(out.fireLatch.invalidationReason,'FRESH_LOCK_INVALIDATED');
    assert.equal(out.fireLatch.finalResult,'INVALIDATED_BEFORE_POST');
    const summary=summarizeRealExecutionState({control:await loadControl(e),series:out,ledger:await listRealLedger(e)});
    assert.equal(summary.noFill,0);
  }finally{io.restore();}
});

test('FIRE LATCH 4: time gate may kill the latched specimen before POST',async()=>{
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})}),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0); // 10m remains; latch valid
    const out=await cycleNoScan(e,post,T0+4*60*1000); // 6m remains; 6.5m gate must fail
    assert.equal(entries(post).length,0);
    assert.equal(out.fireLatch.state,'INVALIDATED_BEFORE_POST');
    assert.equal(out.fireLatch.invalidationReason,'TIME_GATE_FAILED');
  }finally{io.restore();}
});

test('FIRE LATCH 5: pre-submit exact-market failure invalidates same specimen before provider POST',async()=>{
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})});
  const io=installProvider({exactSequence:[
    {status:200,market:providerMarket()}, {status:200,market:providerMarket()}, // scan
    {status:200,market:providerMarket()},                                      // FIRE feature exact reread
    {status:200,market:providerMarket()},                                      // execution fresh lock
    {status:500,market:{error:'pre-submit failed'}},                           // execution pre-submit
  ]});
  const post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0);
    const out=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,0);
    assert.equal(out.fireLatch.state,'INVALIDATED_BEFORE_POST');
    assert.equal(out.fireLatch.invalidationReason,'PRE_SUBMIT_INVALIDATED');
  }finally{io.restore();}
});

test('FIRE LATCH 6/8: one latched specimen cannot be posted twice without a new FIRE latch',async()=>{
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})}),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:5}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0);
    const first=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,1);
    assert.equal(first.fireLatch.state,'PROVIDER_RESULT');
    const second=await cycleNoScan(e,post,T0);
    assert.equal(entries(post).length,1);
    assert.equal(second.status,'ARMED_FISHING');
  }finally{io.restore();}
});

test('FIRE LATCH 7: AUTO/Baseline state remains read-only and independent during latch handoff',async()=>{
  baselineMethods.length=0;
  const e=await env({shadow:baselineShadow({score:.86,move:.005,edge:.09})}),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,target:1}); await arm(e);
    await runReadOnlyScan(e,'FIRE_LATCH_TEST',T0);
    await cycleNoScan(e,post,T0);
    assert.equal(baselineMethods.every(m=>m==='GET'),true);
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

// ---------- 1,3 target 1 + attemptsStarted begins at 0 ----------
test('GOV 1/3/16: target 1 retains behaviour; ARM snapshots config with attemptsStarted=0',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await arm(e);
    const s0=await loadRealSeriesState(e);
    assert.equal(s0.attemptsStarted,0); assert.equal(s0.configFrozen,true);
    assert.deepEqual([s0.attemptTarget,s0.threshold,s0.maxEntryDebitUsd,s0.requiredExchangeIndex],[1,.80,1,2]);
    const out=await cycle(e,post);
    assert.equal(out.status,'COMPLETE_NO_FILL'); assert.equal(out.attemptsStarted,1);
    assert.equal(entries(post).length,1);
    assert.equal((await loadControl(e)).armed,false);
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

// ---------- 2,4,13,14,15 sequential progress, termination, target+1 impossible ----------
test('GOV 2/4/13/14/15: target 5 progresses sequentially on resolved NO_FILL, stops exactly at 5, attempt 6 impossible',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{target:5}); await arm(e);
    const seriesId=(await loadRealSeriesState(e)).seriesId;
    for(let n=1;n<=5;n++){
      const out=await cycle(e,post);
      assert.equal(out.attemptsStarted,n);
      assert.equal(entries(post).length,n);
      const sc=entries(post)[n-1].scope;
      assert.equal(sc.attemptsBefore,n-1); assert.equal(sc.attemptTarget,5);
      assert.equal(out.currentAttempt.attemptId,seriesId+'-intent-'+n);
      assert.equal(out.currentAttempt.providerAttemptNo,n);
      if(n<5){ assert.equal(out.status,'ARMED_FISHING'); assert.equal((await loadControl(e)).armed,true); } // armed ONCE, keeps fishing
      else { assert.equal(out.status,'COMPLETE_NO_FILL'); assert.equal((await loadControl(e)).armed,false); assert.equal(seriesTerminal(out),true); }
    }
    const ids=entries(post).map(c=>c.payload.client_order_id); assert.equal(new Set(ids).size,5); // unique client order ids
    // attempt 6: disarmed cycle
    await cycle(e,post); assert.equal(entries(post).length,5);
    // attempt 6: even if control is force-armed (restart / tamper), series refuses
    await armedControl(e);
    const out6=await cycle(e,post);
    assert.equal(out6.status,'COMPLETE_ENTRY_AUTHORITY'); assert.equal(entries(post).length,5);
    // write contract refuses target+1 independently of the engine
    const payload={ticker:'T',client_order_id:'c',side:'bid',count:'1',price:'0.5',time_in_force:'immediate_or_cancel',post_only:false,cancel_order_on_pause:true,reduce_only:false};
    const sc={owner:'PAYNE_KALSHI_REAL',exchangeIndex:2,authorized:true,armed:true,attemptTarget:5,attemptsBefore:5,maxEntryDebitUsd:1,seriesConfigFrozen:true,priorAttemptClean:true,entryDebitUsd:.5};
    assert.throws(()=>payneOrderWriteProof('ENTRY',payload,sc),/PAYNE_ENTRY_SERIES_ATTEMPT_NOT_AUTHORIZED/);
    assert.doesNotThrow(()=>payneOrderWriteProof('ENTRY',payload,{...sc,attemptsBefore:4}));
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

// ---------- 5 FILLED + CLOSED permits next ----------
test('GOV 5: resolved FILLED + provider-FLAT CLOSED permits the next attempt (attempt 2)',async()=>{
  const e=await env(),post=postFixture(FILL);
  let io=installProvider({position:'ABSENT'});
  try{
    await configure(e,{target:5}); await arm(e);
    const a1=await cycle(e,post);
    assert.equal(a1.status,'MANAGING_POSITION_SERIES_CONTINUES'); assert.equal(a1.position.status,'OPEN');
    assert.equal((await loadControl(e)).armed,true);
    // while OPEN the next attempt is blocked
    io.restore(); io=installProvider({position:'OPEN'});
    await cycle(e,post); assert.equal(entries(post).length,1);
    // provider proves FLAT -> position CLOSED -> series continues
    io.restore(); io=installProvider({position:'FLAT'});
    const closed=await cycle(e,post);
    assert.equal(closed.position.status,'CLOSED'); assert.equal(closed.status,'ARMED_FISHING');
    assert.equal(seriesInterlock(closed).clear,true);
    const a2=await cycle(e,post);
    assert.equal(a2.attemptsStarted,2); assert.equal(entries(post).length,2);
    assert.equal(entries(post)[1].scope.attemptsBefore,1);
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

// ---------- 6-10,12 interlocks ----------
test('GOV 6: unresolvedEntry blocks next attempt while provider evidence remains UNKNOWN',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await frozenSeries(e,{unresolvedEntry:true,status:'ENTRY_RECONCILIATION_REQUIRED',currentAttempt:{attemptId:'GOV-S-1',status:'UNKNOWN'}}); await armedControl(e);
    const out=await cycle(e,post);
    assert.equal(entries(post).length,0);
    assert.equal(out.status,'ENTRY_RECONCILIATION_REQUIRED');
    assert.equal(out.unresolvedEntry,true);
    assert.equal((await loadControl(e)).armed,true);
  }finally{io.restore();}
});

for(const status of ['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN']){
  test(`GOV 7-10: position ${status} blocks next ENTRY (engine, interlock, ARM)`,async()=>{
    const e=await env(),io=installProvider({position:'OPEN'}),post=postFixture({order_id:'X',fill_count:0,remaining_count:1});
    try{
      const s=await frozenSeries(e,{position:cleanPosition({status,reconciliationState:'OPEN'})}); await armedControl(e);
      assert.equal(seriesInterlock(s).clear,false);
      await cycle(e,post);
      assert.equal(entries(post).length,0);          // management may act on the owned position; NEVER a new ENTRY
      await assert.rejects(updateFounderControl(e,'ARM'),/PAYNE_REAL_OPEN_POSITION_EXISTS|PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED/);
      assert.equal(providerPosts(io),0);
    }finally{io.restore();}
  });
}

test('GOV 11: provider ownership ambiguity blocks next attempt',async()=>{
  const e=await env(),post=postFixture(NOFILL);
  let io=installProvider({position:'OPEN'});
  try{
    // (a) prior position with wrong/unknown ownership
    const s=await frozenSeries(e,{position:cleanPosition({owner:'SOMEONE_ELSE'})}); await armedControl(e);
    assert.equal(seriesInterlock(s).reason,'POSITION_OWNERSHIP_UNKNOWN');
    await cycle(e,post); assert.equal(entries(post).length,0);
    // (b) closed but not provider-proven flat
    const s2=await frozenSeries(e,{position:cleanPosition({reconciliationState:'UNKNOWN'})});
    assert.equal(seriesInterlock(s2).reason,'POSITION_NOT_PROVEN_FLAT');
    // (c) provider position read ambiguous at entry time
    io.restore(); io=installProvider({position:'HTTP_FAIL'});
    await frozenSeries(e,{position:cleanPosition()}); await armedControl(e);
    const out=await cycle(e,post);
    assert.equal(out.status,'HOLD_PROVIDER_POSITION_UNKNOWN'); assert.equal(entries(post).length,0);
  }finally{io.restore();}
});

test('GOV 12: management-required series state blocks next attempt',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    for(const st of ['EXIT_REQUIRED_WAITING_FOR_LIVE_BID','MANAGEMENT_RECONCILIATION_UNKNOWN','EXIT_RETRY_REQUIRED']){
      const s=await frozenSeries(e,{status:st,position:null}); await armedControl(e);
      assert.equal(seriesInterlock(s).reason,'MANAGEMENT_REQUIRED_STATE');
      const out=await cycle(e,post);
      assert.equal(out.status,'HOLD_PRIOR_ATTEMPT_NOT_CLEAN'); assert.equal(entries(post).length,0);
    }
  }finally{io.restore();}
});

test('GOV 10b: unknown provider result self-reconciles before any next attempt',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({}, 200); // unparseable/unknown result
  try{
    await configure(e,{target:5}); await arm(e);
    const first=await cycle(e,post);
    assert.equal(first.unresolvedEntry,true);
    assert.equal((await loadControl(e)).armed,true);
    assert.equal(entries(post).length,1);

    const reconciled=await cycle(e,post);
    assert.equal(entries(post).length,1); // reconciliation tick can never also FIRE attempt 2
    assert.equal(reconciled.unresolvedEntry,false);
    assert.equal(reconciled.status,'ARMED_FISHING');

    const second=await cycle(e,post);
    assert.equal(second.attemptsStarted,2);
    assert.equal(entries(post).length,2);
  }finally{io.restore();}
});

// ---------- 17,18,19 separate series carry separate frozen config ----------
test('GOV 17/18/19: different threshold / stake / attemptTarget freeze into separate series; no combination-specific code',async()=>{
  const e=await env({shadow:baselineShadow({score:.80})}),io=installProvider(),post=postFixture(NOFILL);
  try{
    await arm(e); await cycle(e,post);                                   // series A: .70 x1 @ $1 -> terminal
    const A=await loadRealSeriesState(e);
    await configure(e,{threshold:.80,stake:2,target:5}); await arm(e);   // series B
    const B=await loadRealSeriesState(e);
    assert.notEqual(B.seriesId,A.seriesId);
    assert.deepEqual([B.threshold,B.maxEntryDebitUsd,B.attemptTarget,B.attemptsStarted],[.75,2,5,0]);
    assert.deepEqual([A.threshold,A.maxEntryDebitUsd,A.attemptTarget],[.70,1,1]);
    await cycle(e,post);
    const sc=entries(post)[1].scope;
    assert.equal(sc.maxEntryDebitUsd,2); assert.equal(sc.attemptTarget,5);
    const p=entries(post)[1].payload; assert.ok(Number(sc.entryDebitUsd)<=2); assert.ok(Number(sc.entryDebitUsd)>1);
    // stake-cap enforced against the already-computed fee-safe debit, not complementary provider book price
    assert.throws(()=>payneOrderWriteProof('ENTRY',{...p},{...sc,maxEntryDebitUsd:1,seriesConfigFrozen:true,priorAttemptClean:true,entryDebitUsd:sc.entryDebitUsd}),/PAYNE_ENTRY_EXCEEDS_SERIES_STAKE_CAP/);
    // series C: .85 frozen -> shadow score .80 must NOT fire (threshold really comes from the frozen series)
    await frozenSeries(e,{seriesId:'C',attemptsStarted:0,attemptTarget:10,threshold:.80,maxEntryDebitUsd:1,position:null,status:'ARMED_WAITING'});
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:control:v1',JSON.stringify({...(await loadControl(e)),armed:true,activeThreshold:.80,maxEntryDebitUsd:1,attemptTarget:10}));
    const before=entries(post).length; const outC=await cycle(e,post);
    assert.equal(entries(post).length,before); assert.equal(outC.status,'ARMED_FISHING');
  }finally{io.restore();}
});

// ---------- 20 mid-run immutability ----------
test('GOV 20: mid-run control changes cannot mutate the active series snapshot',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{threshold:.80,stake:2,target:5}); await arm(e);
    const snap=structuredClone(await loadRealSeriesState(e));
    await assert.rejects(updateFounderControl(e,'SET_THRESHOLD',.80),/PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED/);
    await assert.rejects(updateFounderControl(e,'SET_STAKE',5),/PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED/);
    await assert.rejects(updateFounderControl(e,'SET_ATTEMPT_TARGET',30),/PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED/);
    // even a tampered control record cannot change the series; engine fails closed, no order
    const c=await loadControl(e);
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:control:v1',JSON.stringify({...c,activeThreshold:.80,maxEntryDebitUsd:5,attemptTarget:30}));
    const out=await cycle(e,post);
    assert.equal(out.status,'ARMED_CONFIGURATION_INVALID_FAIL_CLOSED'); assert.equal(entries(post).length,0);
    const after=await loadRealSeriesState(e);
    for(const k of ['threshold','maxEntryDebitUsd','attemptTarget','seriesId','configFrozen']) assert.equal(after[k],snap[k]);
    // Clean + disarmed + changed next-run config explicitly terminalizes the old frozen series before a new ARM.
    await frozenSeries(e,{seriesId:snap.seriesId,attemptsStarted:2,attemptTarget:5,threshold:.80,maxEntryDebitUsd:2,position:null,currentAttempt:{status:'NO_FILL'}});
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:control:v1',JSON.stringify({...c,armed:false,activeThreshold:.80,maxEntryDebitUsd:2,attemptTarget:5}));
    const reconciled=await cycle(e,post);
    assert.equal(reconciled.status,'TERMINAL_DISARMED_CONFIG_SUPERSEDED');
    assert.ok(reconciled.completedAt);
    assert.equal(entries(post).length,0);
    await updateFounderControl(e,'ARM');
    const fresh=await loadRealSeriesState(e);
    assert.notEqual(fresh.seriesId,snap.seriesId);
    assert.equal(fresh.attemptsStarted,0);
    assert.equal(fresh.threshold,.80);
    assert.equal(fresh.attemptTarget,5);

    // Same-config clean disarmed series remains resumable; count and identity are preserved.
    await updateFounderControl(e,'DISARM');
    await frozenSeries(e,{seriesId:'RESUME-SAME',attemptsStarted:2,attemptTarget:5,threshold:.80,maxEntryDebitUsd:2,position:null,currentAttempt:{status:'NO_FILL'}});
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:control:v1',JSON.stringify({...c,armed:false,activeThreshold:.80,maxEntryDebitUsd:2,attemptTarget:5}));
    await updateFounderControl(e,'ARM');
    const resumed=await loadRealSeriesState(e);
    assert.equal(resumed.attemptsStarted,2); assert.equal(resumed.seriesId,'RESUME-SAME');
  }finally{io.restore();}
});

// ---------- 21,22,23 existing checks preserved ----------

test('LEGACY QUARANTINE A/B/C: old 4/5 accounting is terminalized without rewriting history and next promoted .80 x5 $1 ARM creates a fresh repaired 0/5 series',async()=>{
  const LEGACY_ID='568186d7-57a8-42b0-80ed-db0429786fe2';
  const e=await env(),io=installProvider();
  try{
    await configure(e,{threshold:.80,stake:1,target:5});
    const legacy={
      schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',seriesId:LEGACY_ID,
      status:'SERIES_PAUSED_DISARMED',attemptsStarted:4,attemptTarget:5,
      threshold:.80,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2,
      configFrozen:true,frozenAt:'2026-10-05T00:00:00.000Z',unresolvedEntry:false,
      fireLatch:null,currentAttempt:{attemptId:LEGACY_ID+'-4',attemptNo:4,status:'NO_FILL'},position:null,completedAt:null,
    };
    // Directly seed pre-marker persisted state to represent the actual old-accounting compatibility case.
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:real-series:v1',JSON.stringify(legacy));
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:run:'+LEGACY_ID,JSON.stringify({
      runId:LEGACY_ID,threshold:.80,effectiveLockThreshold:.65,maxEntryDebitUsd:1,attemptTarget:5,requiredExchangeIndex:2,frozenAt:legacy.frozenAt
    }));
    for(let n=1;n<=4;n++){
      await e.PAYNE_KALSHI_STATE.put('payne-kalshi:attempt:'+LEGACY_ID+':attempt:'+n,JSON.stringify({
        schema:'PAYNE_REAL_ATTEMPT_V1',owner:'PAYNE_KALSHI_REAL',runId:LEGACY_ID,seriesId:LEGACY_ID,
        attemptId:LEGACY_ID+'-'+n,attemptNo:n,asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',
        score:.71,threshold:.80,status:'NO_FILL',result:'NO_FILL'
      }));
    }

    const loaded=await loadRealSeriesState(e);
    assert.equal(loaded.seriesId,LEGACY_ID);
    assert.equal(loaded.attemptsStarted,4);
    assert.equal(loaded.attemptTarget,5);
    assert.equal(loaded.accountingSemantics,'LEGACY_PRE_PROVIDER_BOUNDARY_V0');

    // Disarmed maintenance quarantines; no provider interaction is required.
    const quarantined=await runPayneRealExecutionCycle(e,{nowMs:T0});
    assert.equal(quarantined.seriesId,LEGACY_ID);
    assert.equal(quarantined.status,'TERMINAL_LEGACY_ACCOUNTING_QUARANTINED');
    assert.equal(quarantined.terminalReason,'LEGACY_PRE_PROVIDER_ACCOUNTING_NON_RESUMABLE');
    assert.equal(quarantined.legacyQuarantined,true);
    assert.equal(quarantined.attemptsStarted,4);
    assert.equal(quarantined.attemptTarget,5);
    assert.ok(quarantined.completedAt);

    const legacyObs=summarizeRealExecutionState({control:await loadControl(e),series:quarantined,ledger:await listRealLedger(e,1000)});
    assert.equal(legacyObs.attempted,4);                 // preserved OLD-semantic historical count
    assert.equal(legacyObs.executionIntents,4);         // old local/intention evidence remains visible
    assert.equal(legacyObs.providerOrderAttempts,null); // pre-repair provider-attempt count is not knowable
    assert.equal(legacyObs.providerOrderAttemptsKnown,false);

    const history=await buildHistoricalSeriesReport(e,LEGACY_ID);
    assert.equal(history.seriesId,LEGACY_ID);
    assert.equal(history.attemptTarget,5);
    assert.equal(history.attempted,4);
    assert.equal(history.attempts.length,4);
    assert.deepEqual(history.attempts.map(x=>x.attemptNo),[1,2,3,4]);
    assert.equal(history.legacyQuarantined,true);
    assert.equal(history.accountingSemantics,'LEGACY_PRE_PROVIDER_BOUNDARY_V0');

    // Founder ARM simulation is in-memory zero-money only: terminal legacy record cannot resume.
    const oldId=quarantined.seriesId;
    await updateFounderControl(e,'ARM');
    const fresh=await loadRealSeriesState(e);
    assert.notEqual(fresh.seriesId,oldId);
    assert.equal(fresh.accountingSemantics,'PROVIDER_POST_BOUNDARY_V1');
    assert.equal(fresh.legacyQuarantined,false);
    assert.equal(fresh.attemptsStarted,0);
    assert.equal(fresh.executionIntentsStarted,0);
    assert.equal(fresh.attemptTarget,5);
    assert.equal(fresh.threshold,.80);
    assert.equal(fresh.maxEntryDebitUsd,1);
    const obs=summarizeRealExecutionState({control:await loadControl(e),series:fresh,ledger:await listRealLedger(e,1000)});
    assert.equal(obs.executionIntents,0);
    assert.equal(obs.providerOrderAttempts,0);
    assert.equal(obs.providerOrderAttemptsKnown,true);
    assert.equal(obs.filled,0);
    assert.equal(obs.noFill,0);
    assert.equal(obs.noProviderExecution,0);
    assert.equal(obs.invalidatedBeforePost,0);
    assert.equal(obs.unknown,0);
    await updateFounderControl(e,'DISARM');
    assert.equal((await loadControl(e)).armed,false);
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

test('LEGACY QUARANTINE D: legitimate repaired-semantic unfinished series still resumes with same identity and provider-attempt count',async()=>{
  const e=await env(),io=installProvider();
  try{
    await configure(e,{threshold:.80,stake:1,target:5});
    const repaired=await saveRealSeriesState(e,{
      ...defaultRealSeriesState(),
      seriesId:'REPAIRED-RESUME',
      status:'SERIES_PAUSED_DISARMED',
      attemptsStarted:2,
      executionIntentsStarted:3,
      attemptTarget:5,
      threshold:.80,
      effectiveLockThreshold:.65,
      maxEntryDebitUsd:1,
      requiredExchangeIndex:2,
      configFrozen:true,
      frozenAt:'2026-10-05T01:00:00.000Z',
      unresolvedEntry:false,
      currentAttempt:{attemptId:'REPAIRED-RESUME-intent-3',intentNo:3,attemptNo:2,providerAttemptNo:2,status:'NO_FILL'},
      position:null,
      completedAt:null,
    });
    assert.equal(repaired.accountingSemantics,'PROVIDER_POST_BOUNDARY_V1');
    await updateFounderControl(e,'ARM');
    const resumed=await loadRealSeriesState(e);
    assert.equal(resumed.seriesId,'REPAIRED-RESUME');
    assert.equal(resumed.attemptsStarted,2);
    assert.equal(resumed.executionIntentsStarted,3);
    assert.equal(resumed.status,'ARMED_WAITING');
    await updateFounderControl(e,'DISARM');
    assert.equal((await loadControl(e)).armed,false);
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

test('ARM blocker regression: clean disarmed 1/5 @ .70 is superseded for Founder .60 x1 without provider writes',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await frozenSeries(e,{seriesId:'LIVE-STALE',status:'ARMED_FISHING',attemptsStarted:1,attemptTarget:5,threshold:.80,maxEntryDebitUsd:1,position:null,currentAttempt:{status:'NO_FILL'},unresolvedEntry:false});
    const c=await loadControl(e);
    await e.PAYNE_KALSHI_STATE.put('payne-kalshi:control:v1',JSON.stringify({...c,armed:false,activeThreshold:.80,maxEntryDebitUsd:1,attemptTarget:1,requiredExchangeIndex:2}));

    const before=await loadRealSeriesState(e);
    assert.equal(before.status,'ARMED_FISHING');
    assert.equal(before.attemptsStarted,1);
    assert.equal(before.attemptTarget,5);
    assert.equal(before.threshold,.80);

    const repaired=await cycle(e,post);
    assert.equal(repaired.status,'TERMINAL_DISARMED_CONFIG_SUPERSEDED');
    assert.equal(repaired.unresolvedEntry,false);
    assert.equal(repaired.position,null);
    assert.ok(repaired.completedAt);
    assert.equal(entries(post).length,0);
    assert.equal(providerPosts(io),0);

    const armed=await updateFounderControl(e,'ARM');
    assert.equal(armed.armed,true);
    const fresh=await loadRealSeriesState(e);
    assert.notEqual(fresh.seriesId,'LIVE-STALE');
    assert.equal(fresh.attemptsStarted,0);
    assert.equal(fresh.attemptTarget,1);
    assert.equal(fresh.threshold,.80);
    assert.equal(fresh.effectiveLockThreshold,.65);
    assert.equal(fresh.configFrozen,true);
    assert.equal(entries(post).length,0);
    assert.equal(providerPosts(io),0);
  }finally{io.restore();}
});

test('GOV 21: Index-2 funding check still operates on every latched attempt of a series',async()=>{
  const e=await env(),post=postFixture(NOFILL);
  let io=installProvider();
  try{
    await configure(e,{target:5}); await arm(e);
    await cycle(e,post); assert.equal(entries(post).length,1);
    // Attempt 2 becomes a governed FIRE specimen while funding is still good.
    await runReadOnlyScan(e,'FUNDING_ATTEMPT_2_LATCH',T0);
    assert.equal((await loadRealSeriesState(e)).fireLatch.state,'LATCHED');
    // Funding then deteriorates before execution. Same latched specimen must fail closed.
    io.restore(); io=installProvider({index2:0.10,index3:50});
    const out=await cycleNoScan(e,post);
    assert.equal(out.status,'HOLD_INDEX2_FUNDING_INSUFFICIENT');
    assert.equal(out.fireLatch.finalResult,'INVALIDATED_BEFORE_POST');
    assert.equal(entries(post).length,1);
  }finally{io.restore();}
});

test('GOV 22: shard-match (exchange index 2) check still operates; wrong shard never reaches ENTRY',async()=>{
  const e=await env(),io=installProvider({marketIndex:3}),post=postFixture(NOFILL);
  try{
    await configure(e,{target:5}); await arm(e);
    const out=await cycle(e,post);
    assert.equal(entries(post).length,0); assert.notEqual(out.attemptsStarted,1);
    assert.throws(()=>payneOrderWriteProof('ENTRY',{ticker:'T',client_order_id:'c',side:'bid',count:'1',price:'0.5',time_in_force:'immediate_or_cancel',post_only:false,cancel_order_on_pause:true,reduce_only:false},{owner:'PAYNE_KALSHI_REAL',exchangeIndex:3,authorized:true,armed:true,attemptTarget:5,attemptsBefore:0,maxEntryDebitUsd:1,seriesConfigFrozen:true,priorAttemptClean:true,entryDebitUsd:.5}),/PAYNE_WRITE_INDEX2_REQUIRED/);
  }finally{io.restore();}
});

test('GOV 23: IOC semantics unchanged on every attempt; write contract rejects non-IOC / post_only / non-frozen / unclean',async()=>{
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{target:5}); await arm(e);
    await cycle(e,post); await cycle(e,post);
    for(const c of entries(post)){ assert.equal(c.payload.time_in_force,'immediate_or_cancel'); assert.equal(c.payload.post_only,false); assert.equal(c.payload.reduce_only,false); assert.equal(c.payload.cancel_order_on_pause,true); }
    const base={ticker:'T',client_order_id:'c',side:'bid',count:'1',price:'0.5',time_in_force:'immediate_or_cancel',post_only:false,cancel_order_on_pause:true,reduce_only:false};
    const sc={owner:'PAYNE_KALSHI_REAL',exchangeIndex:2,authorized:true,armed:true,attemptTarget:5,attemptsBefore:0,maxEntryDebitUsd:1,seriesConfigFrozen:true,priorAttemptClean:true,entryDebitUsd:.5};
    assert.throws(()=>assertKalshiMechanicalOrderPayload({...base,time_in_force:'good_till_canceled'}),/KALSHI_ORDER_IOC_REQUIRED/);
    assert.throws(()=>assertKalshiMechanicalOrderPayload({...base,post_only:true}),/KALSHI_ORDER_POST_ONLY_FALSE_REQUIRED/);
    assert.throws(()=>payneOrderWriteProof('ENTRY',base,{...sc,seriesConfigFrozen:false}),/PAYNE_ENTRY_SERIES_CONFIG_NOT_FROZEN/);
    assert.throws(()=>payneOrderWriteProof('ENTRY',base,{...sc,priorAttemptClean:false}),/PAYNE_ENTRY_PRIOR_ATTEMPT_NOT_CLEAN/);
    assert.throws(()=>payneOrderWriteProof('ENTRY',base,{...sc,armed:false}),/PAYNE_ENTRY_ARM_REQUIRED/);
  }finally{io.restore();}
});

// ---------- 24,25,26 AUTO untouched / zero provider writes / zero capital ----------
test('GOV 24/25/26: AUTO is only read (GET), zero provider POSTs, zero capital moved across a full multi-attempt run',async()=>{
  baselineMethods.length=0;
  const e=await env(),io=installProvider(),post=postFixture(NOFILL);
  try{
    await configure(e,{target:5}); await arm(e);
    for(let i=0;i<6;i++) await cycle(e,post);
    assert.ok(baselineMethods.length>0); assert.ok(baselineMethods.every(m=>m==='GET'));
    assert.equal(providerPosts(io),0);                                   // no network POST ever reached the provider
    assert.equal(io.calls.filter(c=>/\/orders|\/portfolio\/(deposit|withdraw|transfer)/.test(c.url)).length,0);
    assert.equal(entries(post).length,5);                                // fixture intercepts the governed ENTRY path only
  }finally{io.restore();}
});

test('GOV: promoted Paper threshold is fixed while target and stake remain configurable',()=>{
  for(const [t,st] of [[1,1],[5,1],[10,2],[30,1],[7,3]]){
    assert.equal(frozenSeriesConfig({configFrozen:true,attemptTarget:t,threshold:.80,effectiveLockThreshold:.65,maxEntryDebitUsd:st,requiredExchangeIndex:2}).ok,true);
  }
  assert.equal(frozenSeriesConfig({configFrozen:true,attemptTarget:5,threshold:.70,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2}).ok,false);
  assert.equal(frozenSeriesConfig({configFrozen:false,attemptTarget:5,threshold:.80,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2}).ok,false);
  assert.equal(frozenSeriesConfig({configFrozen:true,attemptTarget:0,threshold:.80,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2}).ok,false);
  assert.equal(frozenSeriesConfig({configFrozen:true,attemptTarget:5,threshold:.80,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:3}).ok,false);
});
