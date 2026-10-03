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
  runPayneRealExecutionCycle,
  interpretPayneOrderResponse,
  runReadOnlyScan,
} from '../src/index.js';
import { kalshiPayneOrderPost, payneOrderWriteProof } from '../src/kalshi-real-write.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;

class MemoryKV {
  constructor(){this.store=new Map([['payne-kalshi:control:v1',JSON.stringify(defaultControlState())]]);}
  async get(key){return this.store.has(key)?this.store.get(key):null;}
  async put(key,value){this.store.set(key,String(value));}
  async delete(key){this.store.delete(key);}
  async list({prefix=''}={}){return {keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};}
}

function jsonResponse(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}

function baselineShadow({score=.716,move=.003,edge=.054,close='2026-10-02T06:15:00Z'}={}){
  return {
    ok:true,mode:'REAL_KALSHI_SHADOW',status:'LIVE_KALSHI_SHADOW',startedAt:'2026-10-02T06:00:00Z',lastRunAt:'2026-10-02T06:04:30Z',
    priceSources:{BTC:'COINBASE'},
    opportunities:[
      {marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move,fair:.554,edge,score,openTime:'2026-10-02T06:00:00Z',closeTime:close,durationMs:Date.parse(close)-Date.parse('2026-10-02T06:00:00Z'),horizon:'15m'},
      {marketTicker:'KXBTC15M-REALTEST',outcomeSide:'NO',direction:'DOWN',asset:'BTC',move,fair:.446,edge:-Math.abs(edge),score:.284,openTime:'2026-10-02T06:00:00Z',closeTime:close,durationMs:Date.parse(close)-Date.parse('2026-10-02T06:00:00Z'),horizon:'15m'},
    ],
  };
}

function baselineService(shadow=baselineShadow(),autoPositions=[]){
  return {async fetch(request){
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
  return {PAYNE_KALSHI_STATE:new MemoryKV(),BASELINE_REAL_READ:baselineService(shadow,autoPositions),...(await credentials())};
}

function providerMarket({status='open',close='2026-10-02T06:15:00Z',exchangeIndex=3,yesBid=.48,yesAsk=.50}={}){
  return {
    ticker:'KXBTC15M-REALTEST',series_ticker:'KXBTC15M',exchange_index:exchangeIndex,title:'BTC up in next 15 minutes?',status,
    open_time:'2026-10-02T06:00:00Z',close_time:close,
    yes_bid_dollars:String(yesBid),yes_ask_dollars:String(yesAsk),
    no_bid_dollars:String(1-yesAsk),no_ask_dollars:String(1-yesBid),
  };
}

function installProvider({index3=9.80,index2=6.33,position='ABSENT',exactSequence=[],settled=false}={}){
  const original=globalThis.fetch,calls=[]; let exactNo=0;
  globalThis.fetch=async (url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body||null});
    const u=String(url);
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[{exchange_index:0,balance:0},{exchange_index:2,balance:index2},{exchange_index:3,balance:index3}]});
    if(u.includes('series_ticker=KXBTC15M')) return jsonResponse({markets:[providerMarket()]});
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    if(u.includes('/portfolio/positions?')){
      if(position==='HTTP_FAIL') return jsonResponse({error:'x'},500);
      if(position==='OPEN') return jsonResponse({market_positions:[{ticker:'KXBTC15M-REALTEST',position_fp:'1'}],cursor:''});
      if(position==='FLAT') return jsonResponse({market_positions:[{ticker:'KXBTC15M-REALTEST',position_fp:'0'}],cursor:''});
      return jsonResponse({market_positions:[],cursor:''});
    }
    if(u.includes('/portfolio/settlements?')) return jsonResponse({settlements:settled?[{ticker:'KXBTC15M-REALTEST',market_result:'yes',settled_time:'2026-10-02T06:16:00Z'}]:[]});
    if(u.includes('/markets/KXBTC15M-REALTEST')){
      const x=exactSequence.length?exactSequence[Math.min(exactNo++,exactSequence.length-1)]:{status:200,market:providerMarket({yesBid:.49,yesAsk:.50})};
      return jsonResponse(x.market||{},x.status??200);
    }
    throw new Error('unexpected provider URL '+u);
  };
  return {calls,restore:()=>{globalThis.fetch=original;}};
}

function postFixture(resultBody,status=200){
  const calls=[];
  const fn=async (env,kind,payload,scope)=>{
    calls.push({kind,payload:structuredClone(payload),scope:structuredClone(scope)});
    return {response:jsonResponse(resultBody,status),proof:payneOrderWriteProof(kind,payload,scope)};
  };
  return {calls,fn};
}

async function arm(e){
  const c=await updateFounderControl(e,'ARM');
  assert.equal(c.armed,true);
  return c;
}

test('authenticated Payne write transport is fixed to one order POST and zero-money intercepts ENTRY',async()=>{
  const e=await env();
  const payload={ticker:'KXBTC15M-REALTEST',client_order_id:'payne-real-test-1-entry',side:'bid',count:'1.00',price:'0.5000',time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,cancel_order_on_pause:true,reduce_only:false};
  let intercepted=null;
  const out=await kalshiPayneOrderPost(e,'ENTRY',payload,{owner:'PAYNE_KALSHI_REAL',exchangeIndex:3,authorized:true,armed:true,attemptTarget:1,attemptsBefore:0,maxEntryDebitUsd:1},{fetchImpl:async(url,options)=>{intercepted={url,options};return jsonResponse({order_id:'O1',client_order_id:payload.client_order_id,fill_count:0,remaining_count:1});}});
  assert.equal(intercepted.url,'https://external-api.kalshi.com/trade-api/v2/portfolio/events/orders');
  assert.equal(intercepted.options.method,'POST');
  assert.equal(JSON.parse(intercepted.options.body).time_in_force,'immediate_or_cancel');
  assert.equal(out.proof.exchangeIndex,3);
});

test('authenticated Payne write transport permits only PAYNE-owned reduce-only EXIT',async()=>{
  const e=await env();
  const payload={ticker:'KXBTC15M-REALTEST',client_order_id:'payne-real-test-1-exit',side:'ask',count:'1.00',price:'0.4900',time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,cancel_order_on_pause:true,reduce_only:true};
  let count=0;
  await kalshiPayneOrderPost(e,'EXIT',payload,{owner:'PAYNE_KALSHI_REAL',exchangeIndex:3,authorized:true,ownedByPayne:true,ownedTicker:'KXBTC15M-REALTEST'},{fetchImpl:async()=>{count++;return jsonResponse({order_id:'X1',client_order_id:payload.client_order_id,fill_count:1,remaining_count:0});}});
  assert.equal(count,1);
  await assert.rejects(kalshiPayneOrderPost(e,'EXIT',{...payload,reduce_only:false},{owner:'PAYNE_KALSHI_REAL',exchangeIndex:3,authorized:true,ownedByPayne:true,ownedTicker:'KXBTC15M-REALTEST'},{fetchImpl:async()=>jsonResponse({})}),/PAYNE_EXIT_REDUCE_ONLY_REQUIRED/);
});

test('DISARMED makes provider POST impossible',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'O',fill_count:0,remaining_count:1});
  try{
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.status,'READY_DISARMED');
    assert.equal(post.calls.length,0);
  }finally{io.restore();}
});

test('ARMED qualifying opportunity constructs exactly one Index 3 $1 IOC ENTRY and NO_FILL completes 1/1',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ENTRY-1',client_order_id:'payne-real-fixture-1-entry',fill_count:0,remaining_count:1,average_fill_price:null,average_fee_paid:0});
  try{
    await arm(e);
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls.length,1);
    assert.equal(post.calls[0].kind,'ENTRY');
    assert.equal(post.calls[0].scope.exchangeIndex,3);
    assert.equal(post.calls[0].scope.maxEntryDebitUsd,1);
    assert.equal(post.calls[0].payload.time_in_force,'immediate_or_cancel');
    assert.equal(post.calls[0].payload.post_only,false);
    assert.equal(out.attemptsStarted,1);
    assert.equal(out.status,'COMPLETE_NO_FILL');
    assert.ok(Number(out.currentAttempt.estimatedEntryDebitUsd)<=1);
    const c=await loadControl(e);
    assert.equal(c.armed,false);
    assert.equal(c.attempts,1);
  }finally{io.restore();}
});

test('1/1 and Worker restart cannot produce a second entry',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ENTRY-1',fill_count:0,remaining_count:1});
  try{
    await arm(e);
    await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    const afterFirst=post.calls.length;
    await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:06:00Z')});
    assert.equal(afterFirst,1);
    assert.equal(post.calls.length,1);
    await assert.rejects(updateFounderControl(e,'ARM'),/PAYNE_REAL_1X1_ALREADY_CONSUMED/);
  }finally{io.restore();}
});

test('FILLED establishes durable PAYNE ownership and disarms new entry authority',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ENTRY-FILL',client_order_id:'CID',fill_count:1,remaining_count:0,average_fill_price:.50,average_fee_paid:.02});
  try{
    await arm(e);
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.position.owner,'PAYNE_KALSHI_REAL');
    assert.equal(out.position.exchangeIndex,3);
    assert.equal(out.position.entryOrderId,'ENTRY-FILL');
    assert.equal(out.position.filledCount,1);
    assert.equal(out.attemptsStarted,1);
    assert.equal((await loadControl(e)).armed,false);
    const ledger=await listRealLedger(e,100);
    assert.ok(ledger.some(x=>x.type==='POSITION_OWNERSHIP_ESTABLISHED'));
  }finally{io.restore();}
});

test('FILLED + DISARM still manages and constructs MAX_HOLD reduce-only EXIT',async()=>{
  const e=await env(),io=installProvider({position:'OPEN'}),post=postFixture({order_id:'EXIT-1',client_order_id:'XCID',fill_count:1,remaining_count:0,average_fill_price:.60,average_fee_paid:.02});
  try{
    await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'SERIES-M',attemptsStarted:1,status:'ATTEMPT_LIMIT_REACHED_MANAGING_POSITION',position:{schema:'PAYNE_REAL_POSITION_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'SERIES-M',attemptId:'SERIES-M-1',status:'OPEN',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',exchangeIndex:3,entryOrderId:'ENTRY-1',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.50,entryAverageFeePaid:.01,entryTime:'2026-10-02T05:59:00Z',exitFilledTotal:0}});
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls.length,1);
    assert.equal(post.calls[0].kind,'EXIT');
    assert.equal(post.calls[0].payload.reduce_only,true);
    assert.equal(post.calls[0].scope.ownedByPayne,true);
    assert.equal(out.position.exitReason,'MAX_HOLD_EXIT');
  }finally{io.restore();}
});

test('score <= .20 produces governed SCORE_EXIT while wrong ownership produces no exit',async()=>{
  const shadow=baselineShadow({score:.19,move:.003,edge:.02});
  const e=await env({shadow}),io=installProvider({position:'OPEN'}),post=postFixture({order_id:'EXIT-S',fill_count:1,remaining_count:0,average_fill_price:.55,average_fee_paid:.01});
  try{
    await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'SCORE',attemptsStarted:1,position:{owner:'PAYNE_KALSHI_REAL',seriesId:'SCORE',attemptId:'SCORE-1',status:'OPEN',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',exchangeIndex:3,entryOrderId:'E',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.5,entryTime:'2026-10-02T06:04:30Z',exitFilledTotal:0}});
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls[0].payload.reduce_only,true);
    assert.equal(out.position.exitReason,'SCORE_EXIT');

    const e2=await env({shadow});
    await saveRealSeriesState(e2,{...defaultRealSeriesState(),seriesId:'WRONG',attemptsStarted:1,position:{owner:'AUTO_BASELINE_REAL',status:'OPEN',marketTicker:'KXBTC15M-REALTEST',exchangeIndex:3,entryOrderId:'A',entryClientOrderId:'A',filledCount:1}});
    const out2=await runPayneRealExecutionCycle(e2,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out2.status,'HOLD_WRONG_OR_UNKNOWN_OWNERSHIP');
    assert.equal(post.calls.length,1);
  }finally{io.restore();}
});

test('Index 2 can never fund PAYNE and insufficient Index 3 blocks entry',async()=>{
  const e=await env(),io=installProvider({index2:99,index3:0}),post=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
  try{
    await arm(e);
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.status,'HOLD_INDEX3_FUNDING_INSUFFICIENT');
    assert.equal(post.calls.length,0);
  }finally{io.restore();}
});

test('unknown provider reconciliation and AUTO exact-ticker ownership both block new entry',async()=>{
  const e=await env(),io=installProvider({position:'HTTP_FAIL'}),post=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
  try{
    await arm(e);
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.status,'HOLD_PROVIDER_POSITION_UNKNOWN');
    assert.equal(post.calls.length,0);
  }finally{io.restore();}

  const e2=await env({autoPositions:[{status:'OPEN',marketTicker:'KXBTC15M-REALTEST'}]}),io2=installProvider(),post2=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
  try{
    await arm(e2);
    const out2=await runPayneRealExecutionCycle(e2,{postImpl:post2.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out2.status,'HOLD_AUTO_TICKER_CONFLICT');
    assert.equal(post2.calls.length,0);
  }finally{io2.restore();}
});

test('Fresh LOCK invalidation, pre-submit invalidation, and window mismatch all block POST',async()=>{
  for(const [name,providerOptions,shadow,expected] of [
    ['fresh',{exactSequence:[{status:500,market:{error:'x'}}]},baselineShadow(),'HOLD_PREFIRE_EVIDENCE_INCOMPLETE'],
    ['presubmit',{exactSequence:[{status:200,market:providerMarket()},{status:500,market:{error:'x'}}]},baselineShadow(),'HOLD_PREFIRE_EVIDENCE_INCOMPLETE'],
    ['window',{},baselineShadow({close:'2026-10-02T06:30:00Z'}),'HOLD_WINDOW_MISMATCH'],
  ]){
    const e=await env({shadow}),io=installProvider(providerOptions),post=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
    try{
      await arm(e);
      const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
      assert.equal(out.status,expected,name);
      assert.equal(post.calls.length,0,name);
    }finally{io.restore();}
  }
});

test('order result interpretation is authoritative for FILLED, NO_FILL, PARTIAL, UNKNOWN',()=>{
  assert.equal(interpretPayneOrderResponse({order_id:'1',fill_count:1,remaining_count:0}).state,'FILLED');
  assert.equal(interpretPayneOrderResponse({order_id:'2',fill_count:0,remaining_count:1}).state,'NO_FILL');
  assert.equal(interpretPayneOrderResponse({order_id:'3',fill_count:1,remaining_count:1}).state,'PARTIAL');
  assert.equal(interpretPayneOrderResponse({fill_count:1,remaining_count:0}).state,'UNKNOWN');
});

test('restart with OPEN PAYNE position resumes management while zero-money history remains intact',async()=>{
  const e=await env(),observer=installProvider();
  try{
    await runReadOnlyScan(e,'SCHEDULED_CRON',Date.parse('2026-10-02T06:05:00Z'));
  }finally{observer.restore();}
  const before=[...e.PAYNE_KALSHI_STATE.store.keys()].filter(k=>k.startsWith('payne-kalshi:scan-history:')).length;

  await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'RESTART',attemptsStarted:1,position:{owner:'PAYNE_KALSHI_REAL',seriesId:'RESTART',attemptId:'RESTART-1',status:'OPEN',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',exchangeIndex:3,entryOrderId:'E',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.5,entryTime:'2026-10-02T05:59:00Z',exitFilledTotal:0}});
  const io=installProvider({position:'OPEN'}),post=postFixture({order_id:'X',fill_count:0,remaining_count:1});
  try{
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls.length,1);
    assert.equal(post.calls[0].kind,'EXIT');
    assert.ok(['EXIT_RETRY_REQUIRED','EXIT_RECONCILIATION_REQUIRED'].includes(out.status));
    const after=[...e.PAYNE_KALSHI_STATE.store.keys()].filter(k=>k.startsWith('payne-kalshi:scan-history:')).length;
    assert.equal(after,before);
  }finally{io.restore();}
});
