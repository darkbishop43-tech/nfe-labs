import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {runPayneRealExecutionCycle,defaultControlState,defaultRealSeriesState,fireSpecimenFingerprint,effectiveLockThreshold} from '../src/index.js';
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
   list:async({prefix})=>({keys:[...state.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})
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
