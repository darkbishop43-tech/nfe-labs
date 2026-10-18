import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {runReadOnlyScan,runPayneRealExecutionCycle,defaultControlState,defaultRealSeriesState,fireSpecimenFingerprint,effectiveLockThreshold,buildPayneAuditView,payneStage,payneFeatureBoundaryEvidence} from '../src/index.js';
import {paperFeatureMath} from '../src/payne-paper-brain.js';
import {kalshiPayneOrderPost} from '../src/kalshi-real-write.js';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key=privateKey.export({type:'pkcs8',format:'pem'});
const ticker='KXBTC15M-OFFLINE-TEST';
function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}})}
function createFixture(kind='FILLED',opts={}){
 const now=Date.now(),open=new Date(now-3*60_000).toISOString(),close=new Date(now+12*60_000).toISOString();
 const id='isolated-'+Math.random().toString(36).slice(2);
 const control={...defaultControlState(),armed:true,activeThreshold:.65,attemptTarget:5,maxEntryDebitUsd:1,maxPositions:3};
 const series={...defaultRealSeriesState(),seriesId:id,status:'ARMED_FISHING',
  configFrozen:true,frozenAt:new Date(now).toISOString(),threshold:.65,effectiveLockThreshold:effectiveLockThreshold(.65),
  attemptTarget:5,maxEntryDebitUsd:1,requiredExchangeIndex:2};
 const latch={state:'LATCHED',seriesId:id,attemptNo:1,ticker,asset:'BTC',outcomeSide:'YES',
  direction:'UP',marketOpenTime:open,marketCloseTime:close,marketExchangeIndex:2,
  threshold:.65,effectiveLockThreshold:effectiveLockThreshold(.65),observedScore:.78,
  observedMove:.01,observedEdge:.07,observedFair:.84,fireObservedAt:new Date(now).toISOString()};
 latch.specimenId=id+':fire:1:'+ticker+':'+latch.fireObservedAt;
 latch.identityFingerprint=fireSpecimenFingerprint(latch);// no fire latch seeded: actual scanner must persist it
 const feature={move:0.004,marketTicker:ticker,outcomeSide:'YES',direction:'UP',openTime:open,closeTime:close,asset:'BTC',underlyingSpot:50000,previousUnderlyingSpot:49800,underlyingPriceSource:'OFFLINE_MOCK',observedAsk:0.72};

 const value={...feature,...paperFeatureMath({marketPrice:0.72,move:feature.move,outcomeSide:'YES'})};
 const epochMs=Math.floor(now/300000)*300000;
 const featureState={ok:true,fresh:true,source:'PAYNE_PAPER_BRAIN_ON_KALSHI_REALITY',lastRunAt:new Date(now).toISOString(),calculationAt:new Date(now).toISOString(),ageMs:0,epochMs,opportunities:[value],priceSources:{BTC:'OFFLINE_MOCK'},prices:{BTC:50000}};
 const shadow={epochMs,opportunities:[value],featureState,prices:{BTC:50000}};
 const state=new Map([['payne-kalshi:control:v1',JSON.stringify(control)],['payne-kalshi:real-series:v1',JSON.stringify(series)],['payne-kalshi:feature-shadow:v2-paper-brain',JSON.stringify(shadow)]]);
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
  if(String(url).includes('/markets?'))return json({markets:[{ticker,open_time:open,close_time:close,exchange_index:2,status:'open',yes_ask_dollars:'0.72',yes_bid_dollars:'0.71',no_ask_dollars:'0.29',no_bid_dollars:'0.28'}]});
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
 const scan=async()=>{globalThis.fetch=provider;try{return await runReadOnlyScan(env,'SCHEDULED_CRON',now)}finally{globalThis.fetch=prior}};
 const execute=async()=>{
  globalThis.fetch=provider;
  try{
   return await runPayneRealExecutionCycle(env,{postImpl:(e,k,p,scope)=>kalshiPayneOrderPost(e,k,p,scope,{fetchImpl:provider})});
  }finally{globalThis.fetch=prior}
 };
 return {scan,execute,env,state,requests,latch,get posts(){return posts},get attempt(){return JSON.parse(state.get('payne-kalshi:real-series:v1')).currentAttempt},get series(){return JSON.parse(state.get('payne-kalshi:real-series:v1'))}};
}

test('ACTUAL SCANNER TO FIRE: scanner creates latch, governed controller sends exactly one mock post',{concurrency:false},async()=>{
 const f=createFixture('FILLED');
 assert.equal(f.series.fireLatch?.state,undefined,'no fire latch is pre-seeded');
 const scan=await f.scan();
 const afterScan=f.series;
 const snapshot=JSON.parse(f.state.get('payne-kalshi:current:v1'));
 const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const scanSource=source.slice(source.indexOf('export async function runReadOnlyScan('),source.indexOf('export async function runReadOnlyScan(')+7000);
 const lockEvidence=snapshot.fireFeatureEvidence;
 assert.equal(lockEvidence?.available,true,'authoritative fresh LOCK feature is available');
 assert.equal(lockEvidence?.lock,'PASS','fresh LOCK passed');
 assert.equal(lockEvidence?.pull,'PASS','same feature passed Founder PULL');
 assert.equal(lockEvidence?.windowMatch,true,'same exact contract window');
 assert.equal(snapshot.selected?.decision?.pull,'PULL_QUALIFIED');
 const approvalDecisions=Number(lockEvidence.available===true && lockEvidence.lock==='PASS' && lockEvidence.pull==='PASS' && lockEvidence.windowMatch===true);
 const independentVotesAfterPull=Number(/synchronizeFireFeatureEpoch\\(|readAuthoritativePayneFeatures\\(|payneStage\\(/.test(
   scanSource.slice(scanSource.indexOf('if(previewReady && control.armed===true)'),scanSource.indexOf('const persistLatest=true'))
 ));
 assert.equal(approvalDecisions,1,'one authoritative LOCK/PULL approval recorded');
 assert.equal(independentVotesAfterPull,0,'no independent strategy vote between approved PULL and latch');
 const latchRows=[...f.state.entries()].filter(([k])=>k.startsWith('payne-kalshi:real-ledger:')).map(([,v])=>JSON.parse(v)).filter(x=>x.type==='FIRE_SPECIMEN_LATCHED');
 assert.equal(latchRows.length,1,'scanner must create one durable latch ledger event');
 assert.deepEqual(latchRows[0].fireFeatureEvidence,lockEvidence,'durable specimen uses same approved feature without another vote');
 assert.equal(afterScan.fireLatch?.state,'LATCHED','scanner persisted actual fire latch');
 assert.equal(f.posts,0,'scanner must not submit orders');
 await f.execute();
 assert.equal(f.posts,1,'exactly one mock provider post');
 await f.execute();
 assert.equal(f.posts,1,'duplicate retry must not submit');
 assert.equal(f.attempt?.fireSpecimenId,afterScan.fireLatch.specimenId);
 console.log('ACTUAL_SCANNER_TO_FIRE_PASS',JSON.stringify({
   scannerCreatedLatch:latchRows.length,
   mockProviderPosts:f.posts,
   duplicatePosts:0,
   realProviderWrites:0,
   authoritativeApprovalDecisions:approvalDecisions,
   additionalIndependentVotesAfterPull:independentVotesAfterPull,
   screeningAndDisplayEvaluations:'NOT_COUNTED_AS_APPROVALS'
 }));
});
