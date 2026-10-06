import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  COCKPIT_REFRESH_MS,
  providerMarketSnapshot,
  discoverCockpitMarkets,
  readAuthoritativePayneFeatures,
  payneDecisionEvidence,
  buildCockpitData,
  defaultControlState,
  updateFounderControl,
  loadRealSeriesState,
  saveRealSeriesState,
  runReadOnlyScan,
  loadControl,
  normalizeBaselineEconomicEntryPrice,
  buildAccountFinancialSummary,
  parseFounderThreshold,
  effectiveLockThreshold,
  livePayneAuthorityEvidence,
} from '../src/index.js';
import payneWorker from '../src/index.js';
import { cockpitHtml } from '../src/cockpit-html.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryKV {
  constructor() { this.store=new Map([['payne-kalshi:control:v1',JSON.stringify(defaultControlState())]]); }
  async get(key){ return this.store.has(key)?this.store.get(key):null; }
  async put(key,value){ this.store.set(key,value); }
  async list({prefix=''}={}){ return {keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))}; }
}

function jsonResponse(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}

function baselineShadow(overrides={}){
  return {
    ok:true,
    mode:'REAL_KALSHI_SHADOW',
    status:'LIVE_KALSHI_SHADOW',
    startedAt:'2026-10-02T06:00:00Z',
    lastRunAt:'2026-10-02T06:04:30Z',
    priceSources:{BTC:'COINBASE',ETH:'COINBASE'},
    opportunities:[
      {marketTicker:'KXBTC15M-TEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move:.003,fair:.554,edge:.054,score:.716,openTime:'2026-10-02T06:00:00Z',closeTime:'2026-10-02T06:15:00Z',durationMs:900000,horizon:'15m'},
      {marketTicker:'KXBTC15M-TEST',outcomeSide:'NO',direction:'DOWN',asset:'BTC',move:.003,fair:.446,edge:-.054,score:.284,openTime:'2026-10-02T06:00:00Z',closeTime:'2026-10-02T06:15:00Z',durationMs:900000,horizon:'15m'},
      {marketTicker:'KXETH15M-TEST',outcomeSide:'YES',direction:'UP',asset:'ETH',move:.001,fair:.508,edge:.018,score:.572,openTime:'2026-10-02T06:00:00Z',closeTime:'2026-10-02T06:15:00Z',durationMs:900000,horizon:'15m'},
    ],
    ...overrides,
  };
}

async function seedPaynePriorSpot(env,body=baselineShadow()){
  const prices={};
  for(const row of body?.opportunities||[]){
    if(prices[row.asset]!==undefined) continue;
    const move=Number(row?.move);
    if(Number.isFinite(move) && 1+move>0) prices[row.asset]=100/(1+move);
  }
  await env.PAYNE_KALSHI_STATE.put('payne-kalshi:feature-shadow:v1',JSON.stringify({
    schema:'PAYNE_OWNED_KALSHI_FEATURE_STATE_V1',
    savedAt:'2026-10-02T06:04:00Z',
    prices,
    priceSources:Object.fromEntries(Object.keys(prices).map(a=>[a,'COINBASE']))
  }));
}

function baselineService(body=baselineShadow(),status=200){
  return {
    async fetch(request){
      assert.equal(request.method,'GET');
      const url=new URL(request.url);
      if(url.pathname==='/shadow-state') return jsonResponse(body,status);
      if(url.pathname==='/execution-test-state') return jsonResponse({
        ok:true,readOnly:true,mode:'EXECUTION_TEST_NOT_PRODUCTION_BASELINE',
        state:{
          status:'COMPLETE',seriesId:'BASELINE-SERIES-TEST',
          attempts:[{attemptNo:1,status:'FILLED',asset:'BTC',ticker:'KXBTC15M-TEST',side:'YES',observedScore:.71,liveScore:.72,liveAsk:.50,orderId:'ORDER-1',fillCount:1}],
          positions:[{id:'P1',attemptNo:1,status:'CLOSED',asset:'BTC',ticker:'KXBTC15M-TEST',side:'YES',direction:'UP',entryScore:.72,entryOrderId:'ORDER-1',filledCount:1,entryAverageFillPrice:.50,filledAt:1790921115000,exitReason:'MAX_HOLD_EXIT',closedAt:'2026-10-02T06:10:15Z'}],
        },
        safety:{maxEntryDebitUsd:1,maxConcurrent:3}
      });
      if(url.pathname==='/execution-test-nofill-forensic') return jsonResponse({ok:true,readOnly:true,state:'EXECUTION_TEST_NO_FILL_FORENSIC_V1',audited:[],safety:{providerWrites:0,stateMutation:false,ordersCreated:0,cancels:0,capitalMovedUsd:0}});
      if(url.pathname==='/forensic-provider-history') return jsonResponse({ok:true,readOnly:true,provider:'KALSHI',fills:[{orderId:'ORDER-1',ticker:'KXBTC15M-TEST',side:'yes',action:'buy',yesPrice:.50,createdAt:'2026-10-02T06:05:15Z'}],historicalFills:[],settlements:[],positions:[],safety:{providerTradingWrites:0,executionStateWrites:0,capitalMovedUsd:0,ordersSubmitted:0}});
      return jsonResponse({ok:false,error:'NOT_FOUND'},404);
    },
  };
}

async function authEnv(body=baselineShadow(),status=200){
  const pair=await crypto.subtle.generateKey(
    {name:'RSA-PSS',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']
  );
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  let binary=''; for(const b of der) binary+=String.fromCharCode(b);
  const base64=btoa(binary).match(/.{1,64}/g).join('\n');
  const out={
    PAYNE_KALSHI_STATE:new MemoryKV(),
    BASELINE_REAL_READ:baselineService(body,status),
    KALSHI_EXECUTION_KEY_ID:'TEST_KEY_ID_SENTINEL',
    KALSHI_EXECUTION_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
  };
  await seedPaynePriorSpot(out,body);
  return out;
}

function providerMarket(asset,ticker,series,yesBid='0.47',yesAsk='0.49',exchangeIndex=2){
  return {
    ticker,
    series_ticker:series,
    exchange_index:exchangeIndex,
    title:asset+' up in next 15 minutes?',
    status:'open',
    open_time:'2026-10-02T06:00:00Z',
    close_time:'2026-10-02T06:15:00Z',
    yes_bid_dollars:yesBid,
    yes_ask_dollars:yesAsk,
    no_bid_dollars:String((1-Number(yesAsk)).toFixed(2)),
    no_ask_dollars:String((1-Number(yesBid)).toFixed(2)),
  };
}

function installKalshiFetch({btcExchangeIndex=2,index2Balance=15.91,index3Balance=0,spotSequences={}}={}){
  const original=globalThis.fetch;
  const urls=[]; const spotNo={};
  globalThis.fetch=async (url,options={})=>{
    urls.push(String(url));
    const u=String(url);
    if(u.includes('api.exchange.coinbase.com/products/') && u.includes('/ticker')){
      const m=/products\/([^/]+)-USD\/ticker/.exec(u);
      const asset=m?.[1]||'BTC';
      const seq=Array.isArray(spotSequences?.[asset])?spotSequences[asset]:[100];
      const i=spotNo[asset]||0; spotNo[asset]=i+1;
      return jsonResponse({price:String(seq[Math.min(i,seq.length-1)])});
    }
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[
      {exchange_index:0,balance:0},
      {exchange_index:2,balance:index2Balance},
      {exchange_index:3,balance:index3Balance},
    ]});
    if(u.includes('series_ticker=KXBTC15M')) return jsonResponse({markets:[providerMarket('BTC','KXBTC15M-TEST','KXBTC15M','0.47','0.49',btcExchangeIndex)]});
    if(u.includes('series_ticker=KXETH15M')) return jsonResponse({markets:[providerMarket('ETH','KXETH15M-TEST','KXETH15M','0.45','0.47')]});
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    if(u.includes('/markets/KXBTC15M-TEST')) return jsonResponse({market:{...providerMarket('BTC','KXBTC15M-TEST','KXBTC15M','0.48','0.50',btcExchangeIndex),status:'settled',result:'yes',settlement_value_dollars:'1.0000',settlement_ts:'2026-10-02T06:15:10Z'}});
    throw new Error('unexpected URL '+u);
  };
  return {urls,restore:()=>{globalThis.fetch=original;}};
}

test('Baseline forensic price normalization preserves YES and complements NO',()=>{
  const yes=normalizeBaselineEconomicEntryPrice(.24,'YES');
  assert.equal(yes.rawYesLeg,.24);
  assert.equal(yes.economicOutcomePrice,.24);
  assert.equal(yes.semantics,'KALSHI_YES_LEG_EQUALS_OUTCOME_PRICE');

  const no=normalizeBaselineEconomicEntryPrice(.24,'NO');
  assert.equal(no.rawYesLeg,.24);
  assert.equal(no.economicOutcomePrice,.76);
  assert.equal(no.semantics,'OUTCOME_SIDE_PRICE_NORMALIZED_FROM_KALSHI_YES_LEG');

  const unknown=normalizeBaselineEconomicEntryPrice(null,'NO');
  assert.equal(unknown.economicOutcomePrice,null);
});

test('account financial summary separates provider account truth, PAYNE scope, missing fields, and stale state',()=>{
  const now=Date.parse('2026-10-02T06:05:00Z');
  const summary=buildAccountFinancialSummary({
    balanceBody:{balance_breakdown:[
      {exchange_index:0,balance:1.00},
      {exchange_index:2,balance:11.41},
      {exchange_index:3,balance:7.25},
    ]},
    series:{seriesId:'PAYNE-S1',attemptsStarted:1,position:{entryAverageFeePaid:.03,exitAverageFeePaid:.02}},
    ledger:[
      {owner:'PAYNE_KALSHI_REAL',seriesId:'PAYNE-S1',at:'2026-10-02T06:04:00Z',realizedPnlUsd:.40},
      {owner:'PAYNE_KALSHI_REAL',seriesId:'OLD',at:'2026-10-02T05:00:00Z',realizedPnlUsd:-.10},
      {owner:'AUTO',seriesId:'AUTO-S1',at:'2026-10-02T06:03:00Z',realizedPnlUsd:99},
      {owner:'FOUNDER_MANUAL',seriesId:'MANUAL-S1',at:'2026-10-02T06:02:00Z',realizedPnlUsd:99},
    ],
    providerSyncedAt:'2026-10-02T06:00:00Z',
    nowMs:now,
    staleAfterMs:120000,
  });
  assert.equal(summary.account.cashUsd,19.66);
  assert.match(summary.account.cashStatus,/SUM OF PROVIDER BALANCE_BREAKDOWN/);
  assert.equal(summary.account.openPositionValueUsd,null);
  assert.equal(summary.account.openPositionValueStatus,'NOT EXPOSED');
  assert.equal(summary.account.totalAccountValueStatus,'NOT EXPOSED');
  assert.equal(summary.account.realizedPnlStatus,'NOT EXPOSED');
  assert.equal(summary.account.unrealizedPnlStatus,'NOT EXPOSED');
  assert.equal(summary.payne.currentRunPnlUsd,.4);
  assert.equal(summary.payne.utcDayPnlUsd,.3);
  assert.equal(summary.payne.feesUsd,.05);
  assert.deepEqual(summary.payne.excludes,['AUTO','FOUNDER_MANUAL']);
  assert.equal(summary.providerFinancialStatus,'STALE');
  assert.match(summary.scopeNotice,/SEPARATE FROM FUNDING AUTHORITY \/ INDEX 2/);
});

test('provider snapshot preserves authentic live contract timing and price evidence',()=>{
  const now=Date.parse('2026-10-02T06:00:00Z');
  const snap=providerMarketSnapshot(providerMarket('BTC','KXBTC15M-TEST','KXBTC15M'),now,'BTC','2026-10-02T06:00:01Z');
  assert.equal(snap.asset,'BTC');
  assert.equal(snap.ticker,'KXBTC15M-TEST');
  assert.equal(snap.yesAsk,.49);
  assert.equal(snap.noBid,.51);
  assert.equal(snap.openTime,'2026-10-02T06:00:00Z');
  assert.equal(snap.closeTime,'2026-10-02T06:15:00Z');
  assert.equal(snap.timeRemainingMs,15*60_000);
  assert.equal(snap.source,'LIVE_PROVIDER_DATA');
});

test('series-scoped discovery preserves nine-asset authenticated GET architecture',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    const out=await discoverCockpitMarkets(env,{nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.ok,true);
    assert.equal(out.providerGets,9);
    assert.deepEqual(out.markets.map(x=>x.asset).sort(),['BTC','ETH']);
    assert.equal(io.urls.length,9);
    assert.equal(io.urls.every(u=>u.includes('series_ticker=')),true);
    assert.equal(io.urls.some(u=>u.includes('cursor=')),false);
  } finally { io.restore(); }
});

test('authoritative Payne feature read uses PAYNE-owned direct source and no Baseline shadow authority',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    const markets=await discoverCockpitMarkets(env,{nowMs:Date.parse('2026-10-02T06:05:00Z')});
    const out=await readAuthoritativePayneFeatures(env,markets.markets,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.fresh,true);
    assert.equal(out.source,'KALSHI_AUTHORITATIVE');
    assert.equal(out.transport,'PAYNE_KALSHI_READ');
    assert.equal(out.binding,'PAYNE_KALSHI_STATE');
    assert.equal(out.baselineStateRead,false);
    assert.ok(Math.abs(out.opportunities.find(x=>x.asset==='BTC'&&x.outcomeSide==='YES').move-.003)<1e-12);
    assert.ok(Math.abs(out.opportunities.find(x=>x.asset==='BTC'&&x.outcomeSide==='YES').edge-.054)<1e-12);
    assert.equal(out.opportunities.find(x=>x.asset==='BTC'&&x.outcomeSide==='YES').score,.716);
  } finally { io.restore(); }
});

test('missing Baseline service binding does not prevent PAYNE direct qualification inputs',async()=>{
  const env=await authEnv();
  delete env.BASELINE_REAL_READ;
  const io=installKalshiFetch();
  try{
    const markets=await discoverCockpitMarkets(env,{nowMs:Date.parse('2026-10-02T06:05:00Z')});
    const out=await readAuthoritativePayneFeatures(env,markets.markets,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.fresh,true);
    assert.equal(out.baselineStateRead,false);
    assert.ok(out.opportunities.length>0);
  } finally { io.restore(); }
});

test('Payne decision evidence explains advancement and rejection truthfully',()=>{
  assert.equal(payneDecisionEvidence({score:.49,edge:.2,move:.01},.70).decision,'RADAR_REJECT_SCORE_BELOW_0_50');
  assert.equal(payneDecisionEvidence({score:.60,edge:.1,move:.01},.70).decision,'LOCK_REJECT_SCORE_BELOW_EFFECTIVE_LOCK');
  assert.equal(payneDecisionEvidence({score:.55,edge:.1,move:.01},.55).decision,'PULL_QUALIFIED');
  assert.equal(payneDecisionEvidence({score:.68,edge:.1,move:.01},.70).decision,'PULL_REJECTED_SCORE_BELOW_THRESHOLD');
  assert.equal(payneDecisionEvidence({score:.72,edge:.1,move:.001},.70).decision,'PULL_REJECTED_MOVE_BELOW_0_002');
  assert.equal(payneDecisionEvidence({score:.72,edge:.1,move:.003},.70).decision,'PULL_QUALIFIED');
});

test('cockpit exposes Founder numeric threshold input and diagnostic lock observability',()=>{
  const html=cockpitHtml();
  assert.match(html,/id=\"threshold\" type=\"number\"/);
  assert.match(html,/min=\"0\.50\"/);
  assert.match(html,/max=\"1\.00\"/);
  assert.match(html,/step=\"0\.01\"/);
  assert.match(html,/DIAGNOSTIC LOWER-LOCK MODE/);
  assert.match(html,/ARM freezes the Founder-selected PAYNE threshold into the active series for that run/);
  assert.match(html,/PAYNE funding route remains Index 2/);
  assert.doesNotMatch(html,/Index 3/);
  assert.doesNotMatch(html,/configuration is exactly \.70 \/ \$1 \/ Index 3/);
  assert.doesNotMatch(html,/select id=\"threshold\"/);
  assert.equal(parseFounderThreshold('.50').value,.50);
  assert.equal(effectiveLockThreshold(.70),.65);
});

test('cockpit calculates authentic Payne fields, decisions, clocks, exact rereads, and zero-money FIRE plan',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.ok,true);
    assert.equal(out.authentication,'PROVEN');
    assert.equal(out.providerGets,12);
    assert.equal(out.baselineReads,2);
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
    assert.equal(out.index2.status,'READ-PROVEN AVAILABLE');
    assert.equal(out.financials.account.cashUsd,15.91);
    assert.match(out.financials.account.cashStatus,/SUM OF PROVIDER BALANCE_BREAKDOWN/);
    assert.equal(out.financials.account.totalAccountValueStatus,'NOT EXPOSED');
    assert.equal(out.financials.account.realizedPnlStatus,'NOT EXPOSED');
    assert.equal(out.financials.account.unrealizedPnlStatus,'NOT EXPOSED');
    assert.equal(out.financials.payne.currentRunPnlStatus,'UNKNOWN');
    assert.equal(out.financials.payne.utcDayPnlUsd,0);
    assert.deepEqual(out.financials.payne.excludes,['AUTO','FOUNDER_MANUAL']);
    assert.equal(out.financials.providerFinancialStatus,'FRESH');
    assert.equal(out.selected.ticker,'KXBTC15M-TEST');
    assert.equal(out.selected.direction,'UP');
    assert.equal(out.payne.source,'KALSHI_AUTHORITATIVE');
    assert.ok(Math.abs(out.payne.move-.003)<1e-12);
    assert.ok(Math.abs(out.payne.fair-.544)<1e-12);
    assert.ok(Math.abs(out.payne.edge-.054)<1e-12);
    assert.ok(Math.abs(out.payne.score-.716)<1e-12);
    assert.equal(out.payne.state,'PULL_TRIGGER');
    assert.equal(out.selected.decision.radar,'RADAR_PASS');
    assert.equal(out.selected.decision.lock,'LOCK_PASS');
    assert.equal(out.selected.decision.pull,'PULL_QUALIFIED');
    assert.equal(out.pipeline.finalDecision,'PULL_QUALIFIED_ZERO_MONEY_FIRE_READY');
    assert.equal(out.pipeline.timeGate6_5m,'PASS');
    assert.equal(out.pipeline.freshLock,'PROVEN');
    assert.equal(out.pipeline.preSubmit,'PROVEN');
    assert.equal(out.pipeline.tickerConsistent,true);
    assert.equal(out.pipeline.sideConsistent,true);
    assert.equal(out.clocks.kalshi.currentWindowStart,'2026-10-02T06:00:00Z');
    assert.equal(out.clocks.kalshi.currentWindowClose,'2026-10-02T06:15:00Z');
    assert.equal(out.clocks.kalshi.remainingMs,10*60_000);
    assert.equal(out.clocks.kalshi.nextResetAt,'2026-10-02T06:15:00Z');
    assert.equal(out.clocks.baseline.currentWindowStart,'2026-10-02T06:00:00Z');
    assert.equal(out.clocks.baseline.currentWindowClose,'2026-10-02T06:15:00Z');
    assert.equal(out.clocks.baseline.nextObservationAt,null);
    assert.equal(out.clocks.baseline.nextObservationReason,'NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE');
    assert.equal(out.clocks.payne.observationAt,'2026-10-02T06:05:00.000Z');
    assert.equal(out.clocks.payne.associatedKalshiTicker,'KXBTC15M-TEST');
    assert.equal(out.clocks.consistency.standard,'NFE_OS_UNIVERSAL_MARKET_CLOCK_V1');
    assert.equal(out.clocks.consistency.windowConsistency,true);
    assert.equal(out.clocks.consistency.diagnostic,'WINDOW_CONSISTENT');
    assert.equal(out.clocks.consistency.kalshiWindowElapsedMs,5*60_000);
    assert.equal(out.clocks.consistency.kalshiWindowRemainingMs,10*60_000);
    assert.equal(out.clocks.consistency.kalshiLifecycleFraction,1/3);
    assert.equal(out.clocks.consistency.baselineToPayneObservationDeltaMs,30_000);
    assert.equal(out.comparison.schema,'PAYNE_CROSS_SYSTEM_COMPARISON_V1');
    assert.equal(out.comparison.payne.wouldFire,true);
    assert.equal(out.comparison.baselineReal.lane,'EXECUTION_TEST_NOT_PRODUCTION_BASELINE');
    assert.equal(out.comparison.baselineReal.sawMatchingContract,true);
    assert.equal(out.comparison.baselineReal.attempted,true);
    assert.equal(out.comparison.baselineReal.filled,true);
    assert.equal(out.comparison.baselineReal.fillTime,1790921115000);
    assert.equal(out.comparison.baselineReal.entryPrice,.50);
    assert.equal(out.comparison.paynePaper.available,false);
    assert.equal(out.comparison.paynePaper.reason,'READ_ONLY_AUTHORITATIVE_EVENT_SOURCE_NOT_EXPOSED_TO_PAYNE_KALSHI_REAL');
    assert.equal(out.zeroMoneyPreview.status,'FIRE_READY');
    assert.equal(out.zeroMoneyPreview.authority,'ZERO_MONEY_PROVIDER_POST_HELD');
    assert.equal(out.zeroMoneyPreview.fundingGate,'ZERO_MONEY_AUTHORITY_HELD');
    assert.equal(out.zeroMoneyPreview.timeInForce,'immediate_or_cancel');
    assert.equal(out.zeroMoneyPreview.providerPost,'STEP1_PROVIDER_POST_HARD_DISABLED');
    assert.equal(out.realAuthority.providerWriteAuthorized,false);
    assert.equal(out.pipeline.fireState,'FIRE READY / REAL EXECUTION DISARMED');
    assert.equal(out.pipeline.providerPost,'DISARMED');
    assert.equal(out.pipeline.providerPostAuthority,'BUILT_INACTIVE_DISARMED');
    assert.equal(out.pipeline.fundingGate.result,'DISARMED');
    assert.equal(out.pipeline.fundingGate.zeroMoneyPreviewResult,'ZERO_MONEY_AUTHORITY_HELD');
    assert.equal(io.urls.filter(x=>x.includes('/markets/KXBTC15M-TEST')).length,2);
  } finally { io.restore(); }
});

test('armed FIRE-ready cockpit routes authority from live PAYNE control while zero-money preview remains hard-disabled',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch({btcExchangeIndex:2,index2Balance:15.91,index3Balance:0});
  try{
    const armed=await updateFounderControl(env,'ARM');
    assert.equal(armed.armed,true);
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.zeroMoneyPreview.status,'FIRE_READY');
    assert.equal(out.zeroMoneyPreview.authority,'ZERO_MONEY_PROVIDER_POST_HELD');
    assert.equal(out.zeroMoneyPreview.fundingGate,'ZERO_MONEY_AUTHORITY_HELD');
    assert.equal(out.zeroMoneyPreview.providerPost,'STEP1_PROVIDER_POST_HARD_DISABLED');
    assert.equal(out.realAuthority.providerWriteAuthorized,true);
    assert.equal(out.realAuthority.fundingAuthorized,true);
    assert.equal(out.pipeline.fireState,'FIRE READY / REAL EXECUTION AUTHORIZED');
    assert.equal(out.pipeline.fundingGate.result,'PASS');
    assert.equal(out.pipeline.providerPost,'PASS');
    assert.equal(out.pipeline.providerPostAuthority,'ENABLED_GOVERNED_PAYNE_ONLY');
    assert.equal(out.pipeline.zeroMoneyProviderPost,'STEP1_PROVIDER_POST_HARD_DISABLED');
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
  } finally { io.restore(); }
});

test('live authority evidence uses current governed PAYNE predicates, not legacy zero-money config flags',()=>{
  const control={armed:true,providerWriteAuthority:'ENABLED_GOVERNED_PAYNE_ONLY',providerPostAuthority:'ENABLED_GOVERNED_PAYNE_ONLY',realExecution:'ENABLED_GOVERNED_PAYNE_ONLY',fundingAuthority:'INDEX2_ONLY',requiredExchangeIndex:2};
  const proof=livePayneAuthorityEvidence(control,{status:'READ-PROVEN AVAILABLE',balance:19.07},{totalDebitUsd:1});
  assert.equal(proof.providerWriteAuthorized,true);
  assert.equal(proof.fundingAuthorized,true);
  assert.equal(proof.providerPost,'PASS');
  assert.equal(proof.fundingGate,'PASS');
});

test('zero-money preview permits matching Index 2, blocks mismatch, and reports Index 2 balance',async()=>{
  const mismatchEnv=await authEnv();
  const mismatchIo=installKalshiFetch({btcExchangeIndex:3,index2Balance:15.91,index3Balance:0});
  try{
    const out=await buildCockpitData(mismatchEnv,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.selected.exchangeIndex,3);
    assert.equal(out.index2.balance,15.91);
    assert.equal(out.zeroMoneyPreview.status,'BLOCKED');
    assert.equal(out.zeroMoneyPreview.reason,'HOLD_REQUIRED_EXCHANGE_INDEX_2');
    assert.equal(out.zeroMoneyPreview.shardEvidence.marketExchangeIndex,3);
    assert.equal(out.zeroMoneyPreview.shardEvidence.requiredFundingIndex,2);
    assert.equal(out.zeroMoneyPreview.shardEvidence.fundingBalanceUsd,15.91);
    assert.equal(out.zeroMoneyPreview.shardEvidence.match,false);
    assert.equal(out.pipeline.shardMatch,false);
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
  } finally { mismatchIo.restore(); }

  const matchEnv=await authEnv();
  const matchIo=installKalshiFetch({btcExchangeIndex:2,index2Balance:15.91,index3Balance:0});
  try{
    const out=await buildCockpitData(matchEnv,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.selected.exchangeIndex,2);
    assert.equal(out.zeroMoneyPreview.status,'FIRE_READY');
    assert.equal(out.zeroMoneyPreview.shardMatch,true);
    assert.equal(out.zeroMoneyPreview.requiredFundingIndex,2);
    assert.equal(out.zeroMoneyPreview.fundingBalanceUsd,15.91);
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
  } finally { matchIo.restore(); }
});

test('zero-money preview blocks when matching Index 2 funding is insufficient',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch({btcExchangeIndex:2,index2Balance:0.25,index3Balance:0});
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.selected.exchangeIndex,2);
    assert.equal(out.index2.balance,0.25);
    assert.equal(out.zeroMoneyPreview.status,'BLOCKED');
    assert.equal(out.zeroMoneyPreview.reason,'HOLD_INDEX2_FUNDING_INSUFFICIENT');
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
  } finally { io.restore(); }
});

test('stale Baseline shadow is ignored by PAYNE direct live qualification',async()=>{
  const stale=baselineShadow({
    lastRunAt:'2026-10-02T05:00:00Z',
    opportunities:[{marketTicker:'KXBTC15M-TEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move:0,fair:.5,edge:0,score:.5,openTime:'2026-10-02T05:45:00Z',closeTime:'2026-10-02T06:00:00Z'}],
  });
  const env=await authEnv(stale);
  // Seed direct source independently to the accepted .003 raw move.
  await env.PAYNE_KALSHI_STATE.put('payne-kalshi:feature-shadow:v1',JSON.stringify({
    prices:{BTC:100/1.003,ETH:100/1.001},referencePrices:{BTC:100/1.003,ETH:100/1.001},priceSources:{BTC:'COINBASE',ETH:'COINBASE'}
  }));
  const io=installKalshiFetch();
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.payne.available,true);
    assert.equal(out.featureProvenance.source,'KALSHI_AUTHORITATIVE');
    assert.equal(out.featureProvenance.baselineStateRead,false);
    assert.equal(out.pipeline.finalDecision,'PULL_QUALIFIED_ZERO_MONEY_FIRE_READY');
    assert.equal(out.zeroMoneyPreview.status,'FIRE_READY');
    assert.equal(out.providerWrites,0);
  } finally { io.restore(); }
});

test('mismatched Baseline shadow window is not live PAYNE qualification authority',async()=>{
  const mismatch=baselineShadow({
    opportunities:[{marketTicker:'OLD-TICKER',outcomeSide:'YES',direction:'UP',asset:'BTC',move:0,fair:.5,edge:0,score:.5,openTime:'2026-10-02T05:45:00Z',closeTime:'2026-10-02T06:00:00Z'}],
  });
  const env=await authEnv(mismatch);
  await env.PAYNE_KALSHI_STATE.put('payne-kalshi:feature-shadow:v1',JSON.stringify({
    prices:{BTC:100/1.003,ETH:100/1.001},referencePrices:{BTC:100/1.003,ETH:100/1.001},priceSources:{BTC:'COINBASE',ETH:'COINBASE'}
  }));
  const io=installKalshiFetch();
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.clocks.consistency.windowConsistency,true);
    assert.equal(out.clocks.consistency.diagnostic,'WINDOW_CONSISTENT');
    assert.equal(out.featureProvenance.baselineStateRead,false);
    assert.equal(out.pipeline.finalDecision,'PULL_QUALIFIED_ZERO_MONEY_FIRE_READY');
    assert.equal(out.zeroMoneyPreview.status,'FIRE_READY');
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
  } finally { io.restore(); }
});

test('Founder real controls default disarmed and ARM validates founder config against existing bounds, freezes it into the series, Index 2 required',async()=>{
  const env=await authEnv();
  let c=await loadControl(env);
  assert.equal(c.armed,false);
  assert.equal(c.attemptTarget,1);
  assert.equal(c.maxEntryDebitUsd,1);
  assert.equal(c.activeThreshold,.70);
  assert.equal(c.requiredExchangeIndex,2);
  assert.equal(c.providerWriteAuthority,'BUILT_INACTIVE_DISARMED');

  c=await updateFounderControl(env,'ARM');
  assert.equal(c.armed,true);
  assert.equal(c.providerWriteAuthority,'ENABLED_GOVERNED_PAYNE_ONLY');
  assert.equal(c.providerPostAuthority,'ENABLED_GOVERNED_PAYNE_ONLY');
  assert.equal(c.realExecution,'ENABLED_GOVERNED_PAYNE_ONLY');
  assert.equal(c.fundingAuthority,'INDEX2_ONLY');
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD',.75),/PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED/);

  c=await updateFounderControl(env,'DISARM');
  assert.equal(c.armed,false);
  assert.equal(c.providerWriteAuthority,'BUILT_INACTIVE_DISARMED');
  c=await updateFounderControl(env,'SET_THRESHOLD','.55');
  assert.equal(c.activeThreshold,.55);
  c=await updateFounderControl(env,'ARM');
  assert.equal(c.armed,true);
  const frozen=await loadRealSeriesState(env);
  assert.equal(frozen.threshold,.55);
  assert.equal(frozen.effectiveLockThreshold,.55);
  assert.equal(frozen.configFrozen,true);
  c=await updateFounderControl(env,'DISARM');
  c=await updateFounderControl(env,'SET_THRESHOLD','.70');
  assert.equal(c.activeThreshold,.70);
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD','.49'),/PAYNE_CONTROL_THRESHOLD_OUT_OF_RANGE/);
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD','1.01'),/PAYNE_CONTROL_THRESHOLD_OUT_OF_RANGE/);
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD','.555'),/PAYNE_CONTROL_THRESHOLD_INVALID_PRECISION/);
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD','abc'),/PAYNE_CONTROL_THRESHOLD_INVALID_PRECISION/);
});

test('scheduled disarmed maintenance terminalizes only a clean stale config-mismatched series without orders',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    await saveRealSeriesState(env,{
      seriesId:'LIVE-STALE-SCHEDULED',status:'ARMED_FISHING',attemptsStarted:1,attemptTarget:5,
      threshold:.70,effectiveLockThreshold:.65,maxEntryDebitUsd:1,requiredExchangeIndex:2,configFrozen:true,
      frozenAt:'2026-10-04T04:00:00.000Z',unresolvedEntry:false,currentAttempt:{status:'NO_FILL'},position:null,completedAt:null,
    });
    await updateFounderControl(env,'SET_THRESHOLD','.60');
    await updateFounderControl(env,'SET_ATTEMPT_TARGET',1);
    await payneWorker.scheduled({},env);
    const after=await loadRealSeriesState(env);
    assert.equal(after.status,'TERMINAL_DISARMED_CONFIG_SUPERSEDED');
    assert.ok(after.completedAt);
    assert.equal(after.unresolvedEntry,false);
    assert.equal(after.position,null);
    assert.equal(io.urls.some(u=>u.includes('/orders') && /POST/i.test(u)),false);
    const c=await loadControl(env);
    assert.equal(c.armed,false);
    assert.equal(c.activeThreshold,.60);
    assert.equal(c.attemptTarget,1);
  } finally { io.restore(); }
});

test('each scheduled scan updates current observation while history remains bounded-cadence',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch({spotSequences:{BTC:[100,100.3],ETH:[100,100.1]}});
  try{
    const first=await runReadOnlyScan(env,'SCHEDULED_CRON',Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(first.ok,true);
    assert.equal(first.persistedLatest,true);
    assert.equal(first.persistedHistory,true);
    assert.equal(first.snapshot.source,'SCHEDULED_CRON');
    assert.equal(first.snapshot.zeroMoneyPreview.status,'FIRE_READY');
    assert.equal(first.snapshot.providerWrites,0);
    const firstCurrent=JSON.parse(await env.PAYNE_KALSHI_STATE.get('payne-kalshi:current:v1'));
    assert.equal(firstCurrent.at,'2026-10-02T06:05:00.000Z');

    const second=await runReadOnlyScan(env,'SCHEDULED_CRON',Date.parse('2026-10-02T06:06:00Z'));
    assert.equal(second.persistedLatest,true);
    const secondCurrent=JSON.parse(await env.PAYNE_KALSHI_STATE.get('payne-kalshi:current:v1'));
    assert.equal(secondCurrent.at,'2026-10-02T06:06:00.000Z');
    assert.equal(secondCurrent.source,'SCHEDULED_CRON');
    assert.ok(Array.isArray(secondCurrent.decisions));
    assert.ok(secondCurrent.decisions.length>=2);
    assert.equal(secondCurrent.researchCounters.observationsCollected,2);
    assert.ok(secondCurrent.researchCounters.contractsExamined>=4);
    assert.ok(secondCurrent.researchCounters.wouldFireCount>=2);
    assert.ok(secondCurrent.researchCounters.baselineActualMatches>=2);
    assert.ok(secondCurrent.researchCounters.unknownPaperComparisons>=2);
    const events=[...env.PAYNE_KALSHI_STATE.store.entries()].filter(([k])=>k.startsWith('payne-kalshi:event:')).map(([,v])=>JSON.parse(v));
    assert.ok(events.some(e=>e.type==='OBSERVATION_DECISION_EVENT'&&e.eventClass==='WOULD_FIRE'));
    assert.ok(events.some(e=>e.type==='OBSERVATION_DECISION_EVENT'&&e.eventClass==='REJECT'));
  } finally { io.restore(); }
});

test('read-only export route returns current JSON and CSV evidence without authority changes',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    await runReadOnlyScan(env,'SCHEDULED_CRON',Date.parse('2026-10-02T06:05:00Z'));
    const json=await payneWorker.fetch(new Request('https://payne.test/export?range=current&format=json'),env);
    assert.equal(json.status,200);
    assert.match(json.headers.get('content-type'),/application\/json/);
    const body=await json.json();
    assert.equal(body.schema,'PAYNE_KALSHI_EXPORT_V1');
    assert.equal(body.providerWrites,0);
    assert.equal(body.orders,0);
    assert.equal(body.capitalMovedUsd,0);
    assert.ok(body.rows.length>=2);
    assert.equal(body.rows[0].providerWrites,0);
    assert.ok(Object.hasOwn(body.rows[0],'fair'));
    assert.ok(Object.hasOwn(body.rows[0],'contractCloseTime'));
    assert.ok(Object.hasOwn(body.rows[0],'windowConsistency'));
    assert.ok(Object.hasOwn(body.rows[0],'baselineToPayneObservationDeltaMs'));
    assert.equal(body.rows[0].windowConsistency,true);
    assert.ok(Object.hasOwn(body.rows[0],'baselineActualMatch'));
    assert.ok(Object.hasOwn(body.rows[0],'baselineFilled'));
    assert.ok(Object.hasOwn(body.rows[0],'paynePaperComparisonStatus'));
    assert.ok(Object.hasOwn(body.rows[0],'realSeriesId'));
    assert.ok(Object.hasOwn(body.rows[0],'realArmed'));
    assert.ok(Object.hasOwn(body.rows[0],'attemptsStarted'));
    assert.ok(Object.hasOwn(body.rows[0],'attemptTarget'));
    assert.ok(Object.hasOwn(body.rows[0],'attemptsRemaining'));
    assert.ok(Object.hasOwn(body.rows[0],'filledCount'));
    assert.ok(Object.hasOwn(body.rows[0],'noFillCount'));
    assert.ok(Object.hasOwn(body.rows[0],'unknownCount'));
    assert.ok(Object.hasOwn(body.rows[0],'lastAttemptResult'));
    assert.ok(Object.hasOwn(body.rows[0],'lastProviderOrderId'));
    assert.ok(Object.hasOwn(body.rows[0],'realSeriesStatus'));
    assert.ok(Object.hasOwn(body.rows[0],'lastRealLedgerEvent'));
    assert.equal(body.realExecution.schema,'PAYNE_REAL_OBSERVABILITY_V1');
    assert.ok(Number.isInteger(body.eventCount));
    assert.ok(Array.isArray(body.events));
    assert.ok(body.events.some(e=>e.type==='OBSERVATION_DECISION_EVENT'));

    const csv=await payneWorker.fetch(new Request('https://payne.test/export?range=current&format=csv'),env);
    assert.equal(csv.status,200);
    assert.match(csv.headers.get('content-type'),/text\/csv/);
    const text=await csv.text();
    assert.match(text,/observationAt,scanSource,asset,direction,outcomeSide,ticker/);
    assert.match(text,/realSeriesId,realArmed,attemptsStarted,attemptTarget,attemptsRemaining/);
    assert.match(text,/filledCount,noFillCount,unknownCount,lastAttemptResult,lastProviderOrderId,realSeriesStatus,lastRealLedgerEvent/);
    assert.match(text,/KXBTC15M-TEST/);
  } finally { io.restore(); }
});

test('fast UI-state route reads persisted state only and creates zero provider activity',async()=>{
  const env=await authEnv();
  const original=globalThis.fetch;
  let providerFetches=0;
  globalThis.fetch=async()=>{providerFetches++;throw new Error('provider fetch forbidden in ui-state test');};
  try{
    const response=await payneWorker.fetch(new Request('https://payne.test/ui-state'),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.schema,'PAYNE_FAST_UI_STATE_V1');
    assert.equal(body.uiPollAuthority,'PERSISTED_STATE_ONLY');
    assert.equal(body.providerGets,0);
    assert.equal(body.providerWrites,0);
    assert.equal(body.orders,0);
    assert.equal(body.capitalMovedUsd,0);
    assert.equal(body.realExecution.schema,'PAYNE_REAL_OBSERVABILITY_V1');
    assert.equal(providerFetches,0);
  } finally { globalThis.fetch=original; }
});

test('research event ledger route exposes durable observation decision events',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    await runReadOnlyScan(env,'SCHEDULED_CRON',Date.parse('2026-10-02T06:05:00Z'));
    const response=await payneWorker.fetch(new Request('https://payne.test/evidence/events?limit=100'),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.schema,'PAYNE_RESEARCH_EVENT_LEDGER_V1');
    assert.equal(body.providerWrites,0);
    assert.equal(body.orders,0);
    assert.equal(body.capitalMovedUsd,0);
    assert.ok(body.count>0);
    assert.ok(body.events.some(e=>e.type==='OBSERVATION_DECISION_EVENT'));
  } finally { io.restore(); }
});

test('would-fire forensic route reconstructs persisted FIRE_READY evidence read-only',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
  try{
    await updateFounderControl(env,'SET_THRESHOLD',.70);
    await runReadOnlyScan(env,'SCHEDULED_CRON',Date.parse('2026-10-02T06:05:00Z'));
    const response=await payneWorker.fetch(new Request('https://payne.test/forensic/would-fire?checkpoint=59&format=json'),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.schema,'PAYNE_WOULD_FIRE_FORENSIC_V1');
    assert.equal(body.safety.providerWrites,0);
    assert.equal(body.safety.orders,0);
    assert.equal(body.safety.capitalMovedUsd,0);
    assert.equal(body.safety.baselineWrites,0);
    assert.equal(body.summary.totalWouldFireAnalyzed,1);
    assert.equal(body.rows.length,1);
    assert.equal(body.rows[0].ticker,'KXBTC15M-TEST');
    assert.equal(body.rows[0].marketResult,'YES');
    assert.equal(body.rows[0].directionalClassification,'DIRECTIONALLY_CORRECT');
    assert.equal(body.rows[0].baselineFilled,true);
    assert.equal(body.rows[0].baselineEntryPrice,.50);
    assert.equal(body.rows[0].baselineEntryPriceRawYesLeg,.50);
    assert.equal(body.rows[0].baselineEntryPriceSemantics,'KALSHI_YES_LEG_EQUALS_OUTCOME_PRICE');
    assert.equal(body.rows[0].baselineFillTime,'2026-10-02T06:05:15.000Z');
    assert.equal(body.rows[0].payneTimingVsBaseline,'PAYNE_LATER_THAN_BASELINE_FILL');
    assert.equal(Number.isFinite(body.rows[0].payneToBaselineFillDeltaMs),true);
    assert.ok(body.rows[0].payneToBaselineFillDeltaMs<0);
    assert.equal(body.rows[0].baselineFireTime,null);
    assert.equal(body.rows[0].baselineFireTimeReason,'NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE');
    assert.equal(body.rows[0].netHypotheticalPnlUsd,null);
    assert.match(body.rows[0].pnlReason,/FROZEN_LIFECYCLE_EXIT_PRICE|EXIT_FEE/);

    const csv=await payneWorker.fetch(new Request('https://payne.test/forensic/would-fire?checkpoint=59&format=csv'),env);
    assert.equal(csv.status,200);
    const text=await csv.text();
    assert.match(text,/eventId,payneObservationAt,payneWouldFireAt/);
    assert.match(text,/KXBTC15M-TEST/);
  } finally { io.restore(); }
});

test('cockpit HTML exposes clocks, decision evidence, automatic refresh, and no order-submit control',()=>{
  const html=cockpitHtml();
  assert.equal(COCKPIT_REFRESH_MS,60_000);
  assert.match(html,/Market exchange index/);
  assert.match(html,/Funding index/);
  assert.match(html,/Funding balance/);
  assert.match(html,/Shard match/);
  assert.match(html,/ACCOUNT \/ P&L/);
  assert.match(html,/ACCOUNT CASH/);
  assert.match(html,/OPEN POSITION VALUE/);
  assert.match(html,/TOTAL ACCOUNT VALUE/);
  assert.match(html,/PROVIDER ACCOUNT REALIZED P\/L/);
  assert.match(html,/PROVIDER ACCOUNT UNREALIZED P\/L/);
  assert.match(html,/PAYNE CURRENT RUN P\/L/);
  assert.match(html,/UTC DAY P\/L/);
  assert.match(html,/PAYNE RUN FEES/);
  assert.match(html,/LAST PROVIDER FINANCIAL SYNC/);
  assert.match(html,/separate from FUNDING AUTHORITY \/ INDEX 2/i);
  assert.match(html,/excludes AUTO and FOUNDER MANUAL/i);
  assert.match(html,/FOUNDER CONTROLS/);
  assert.match(html,/DATA EXPORT/);
  assert.match(html,/CURRENT SNAPSHOT/);
  assert.match(html,/CUSTOM RANGE/);
  assert.match(html,/\/export\?/);
  assert.match(html,/CURRENT KALSHI 15-MINUTE UNIVERSE/);
  assert.match(html,/PAYNE FEATURE EVIDENCE/);
  assert.match(html,/NFE-OS MASTER CLOCKS/);
  assert.match(html,/masterKalshiRemaining/);
  assert.match(html,/masterBaselineRemaining/);
  assert.match(html,/masterPayneAge/);
  assert.match(html,/masterScan/);
  assert.match(html,/AUTO SCAN ACTIVE/);
  assert.match(html,/next cron time not fabricated/);
  assert.match(html,/CYCLE CLOCKS/);
  assert.match(html,/KALSHI WINDOW/);
  assert.match(html,/PAYNE FEATURE WINDOW/);
  assert.match(html,/PAYNE OBSERVATION/);
  assert.match(html,/WINDOW CONSISTENCY/);
  assert.match(html,/WINDOW POSITION/);
  assert.match(html,/setInterval\(tickAuthoritativeClocks,1000\)/);
  assert.match(html,/DECISION EVIDENCE/);
  assert.match(html,/Qualification reason/);
  assert.match(html,/Final scan decision/);
  assert.match(html,/NEXT RESET/);
  assert.match(html,/OBSERVED AT/);
  assert.match(html,/RESEARCH COMPARISON/);
  assert.match(html,/RESEARCH COUNTERS/);
  assert.match(html,/RESEARCH EVENT LEDGER/);
  assert.match(html,/\/evidence\/events\?limit=500/);
  assert.match(html,/BASELINE ACTUAL/);
  assert.match(html,/PAYNE PAPER/);
  assert.match(html,/BTC:'<svg/);
  assert.match(html,/ETH:'<svg/);
  assert.match(html,/SOL:'<svg/);
  assert.match(html,/XRP:'<svg/);
  assert.match(html,/HYPE:'<svg/);
  assert.match(html,/ZEC:'<svg/);
  assert.match(html,/DOGE:'<svg/);
  assert.match(html,/BNB:'<svg/);
  assert.match(html,/NEAR:'<svg/);
  assert.match(html,/featureAvailable=p\.available===true/);
  assert.match(html,/UNAVAILABLE/);
  assert.match(html,/v!==null&&v!==undefined/);
  assert.match(html,/CURRENT RUN/);
  assert.match(html,/LAST ATTEMPT/);
  assert.match(html,/ATTEMPTED \/ TARGET/);
  assert.match(html,/NO_PROVIDER_ATTEMPT/);
  assert.match(html,/PRE-SUBMIT LATCHED/);
  assert.match(html,/FILLED \/ MANAGING/);
  assert.match(html,/last\.holdReason/);
  assert.match(html,/state-hold/);
  assert.match(html,/FRESH LOCK/);
  assert.match(html,/ZERO-MONEY FIRE/);
  assert.match(html,/PROVIDER POST AUTHORITY/);
  assert.match(html,/button:hover:not\(:disabled\)/);
  assert.match(html,/button:active:not\(:disabled\)/);
  assert.match(html,/button\.active/);
  assert.match(html,/@keyframes stateFlash/);
  assert.match(html,/setTimeout\(\(\)=>el\.classList\.remove\('flash-once'\),1000\)/);
  assert.match(html,/@media\(min-width:1200px\)/);
  assert.match(html,/@media\(max-width:850px\)/);
  assert.match(html,/BASELINE AGE/);
  assert.match(html,/PAYNE AGE/);
  assert.match(html,/LAST UI UPDATE/);
  assert.match(html,/setInterval\(loadFastState,5000\)/);
  assert.match(html,/setInterval\(load,60000\)/);
  assert.doesNotMatch(html,/setInterval\(load,5000\)/);
  assert.doesNotMatch(html,/PLACE ORDER/i);
  assert.doesNotMatch(html,/SUBMIT ORDER/i);
});
