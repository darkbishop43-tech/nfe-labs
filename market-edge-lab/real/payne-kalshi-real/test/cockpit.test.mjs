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
  runReadOnlyScan,
  loadControl,
  normalizeBaselineEconomicEntryPrice,
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
  return {
    PAYNE_KALSHI_STATE:new MemoryKV(),
    BASELINE_REAL_READ:baselineService(body,status),
    KALSHI_EXECUTION_KEY_ID:'TEST_KEY_ID_SENTINEL',
    KALSHI_EXECUTION_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
  };
}

function providerMarket(asset,ticker,series,yesBid='0.47',yesAsk='0.49'){
  return {
    ticker,
    series_ticker:series,
    exchange_index:3,
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

function installKalshiFetch(){
  const original=globalThis.fetch;
  const urls=[];
  globalThis.fetch=async (url,options={})=>{
    urls.push(String(url));
    const u=String(url);
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[
      {exchange_index:0,balance:0},
      {exchange_index:2,balance:11.41},
      {exchange_index:3,balance:7.25},
    ]});
    if(u.includes('series_ticker=KXBTC15M')) return jsonResponse({markets:[providerMarket('BTC','KXBTC15M-TEST','KXBTC15M')]});
    if(u.includes('series_ticker=KXETH15M')) return jsonResponse({markets:[providerMarket('ETH','KXETH15M-TEST','KXETH15M','0.45','0.47')]});
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    if(u.includes('/markets/KXBTC15M-TEST')) return jsonResponse({market:{...providerMarket('BTC','KXBTC15M-TEST','KXBTC15M','0.48','0.50'),status:'settled',result:'yes',settlement_value_dollars:'1.0000',settlement_ts:'2026-10-02T06:15:10Z'}});
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

test('authoritative Payne feature read uses exact GET-only Baseline service binding',async()=>{
  const env=await authEnv();
  const out=await readAuthoritativePayneFeatures(env,Date.parse('2026-10-02T06:05:00Z'));
  assert.equal(out.ok,true);
  assert.equal(out.fresh,true);
  assert.equal(out.transport,'SERVICE_BINDING');
  assert.equal(out.binding,'BASELINE_REAL_READ');
  assert.equal(out.endpoint,'/shadow-state');
  assert.equal(out.httpStatus,200);
  assert.equal(out.opportunities[0].move,.003);
  assert.equal(out.opportunities[0].fair,.554);
  assert.equal(out.opportunities[0].edge,.054);
  assert.equal(out.opportunities[0].score,.716);
});

test('missing Baseline service binding fails closed without fabricating Payne fields',async()=>{
  const env=await authEnv();
  delete env.BASELINE_REAL_READ;
  const out=await readAuthoritativePayneFeatures(env,Date.parse('2026-10-02T06:05:00Z'));
  assert.equal(out.ok,false);
  assert.equal(out.fresh,false);
  assert.equal(out.error,'BASELINE_REAL_SERVICE_BINDING_UNBOUND');
  assert.deepEqual(out.opportunities,[]);
});

test('Payne decision evidence explains advancement and rejection truthfully',()=>{
  assert.deepEqual(payneDecisionEvidence({score:.49,edge:.2,move:.01},.70),{
    radar:'RADAR_REJECT',lock:'LOCK_NOT_REACHED',pull:'PULL_NOT_REACHED',decision:'RADAR_REJECT_SCORE_BELOW_0_50'
  });
  assert.equal(payneDecisionEvidence({score:.60,edge:.1,move:.01},.70).decision,'LOCK_REJECT_SCORE_BELOW_0_65');
  assert.equal(payneDecisionEvidence({score:.68,edge:.1,move:.01},.70).decision,'PULL_REJECTED_SCORE_BELOW_THRESHOLD');
  assert.equal(payneDecisionEvidence({score:.72,edge:.1,move:.001},.70).decision,'PULL_REJECTED_MOVE_BELOW_0_002');
  assert.equal(payneDecisionEvidence({score:.72,edge:.1,move:.003},.70).decision,'PULL_QUALIFIED');
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
    assert.equal(out.index3.status,'READ-PROVEN AVAILABLE');
    assert.equal(out.selected.ticker,'KXBTC15M-TEST');
    assert.equal(out.selected.direction,'UP');
    assert.equal(out.payne.source,'BASELINE_REAL_SERVICE_BINDING_READ_ONLY');
    assert.equal(out.payne.move,.003);
    assert.equal(out.payne.fair,.554);
    assert.equal(out.payne.edge,.054);
    assert.equal(out.payne.score,.716);
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
    assert.equal(out.zeroMoneyPreview.timeInForce,'immediate_or_cancel');
    assert.equal(out.zeroMoneyPreview.providerPost,'STEP1_PROVIDER_POST_HARD_DISABLED');
    assert.equal(io.urls.filter(x=>x.includes('/markets/KXBTC15M-TEST')).length,2);
  } finally { io.restore(); }
});

test('stale Baseline feature observation stays UNKNOWN and cannot produce FIRE plan',async()=>{
  const stale=baselineShadow({
    lastRunAt:'2026-10-02T05:00:00Z',
    opportunities:[{marketTicker:'KXBTC15M-TEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move:.01,fair:.9,edge:.4,score:1,openTime:'2026-10-02T06:00:00Z',closeTime:'2026-10-02T06:15:00Z'}],
  });
  const env=await authEnv(stale);
  const io=installKalshiFetch();
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.payne.available,false);
    assert.equal(out.payne.state,'UNKNOWN');
    assert.equal(out.pipeline.pullTrigger,'UNKNOWN');
    assert.equal(out.pipeline.finalDecision,'FEATURES_UNAVAILABLE');
    assert.equal(out.zeroMoneyPreview.status,'NOT_REACHED');
    assert.equal(out.providerWrites,0);
  } finally { io.restore(); }
});

test('window mismatch is recorded truthfully and blocks zero-money FIRE preview',async()=>{
  const mismatch=baselineShadow({
    opportunities:[
      {marketTicker:'KXBTC15M-TEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move:.003,fair:.554,edge:.054,score:.716,openTime:'2026-10-02T06:00:00Z',closeTime:'2026-10-02T06:30:00Z',durationMs:1800000,horizon:'30m'},
    ],
  });
  const env=await authEnv(mismatch);
  const io=installKalshiFetch();
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.clocks.consistency.windowConsistency,false);
    assert.equal(out.clocks.consistency.diagnostic,'WINDOW_MISMATCH');
    assert.equal(out.pipeline.finalDecision,'WINDOW_MISMATCH');
    assert.equal(out.zeroMoneyPreview.status,'BLOCKED');
    assert.equal(out.zeroMoneyPreview.reason,'WINDOW_MISMATCH');
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
  } finally { io.restore(); }
});

test('Founder real controls default disarmed and ARM is bounded to .70 / $1 / 1 attempt / Index 3',async()=>{
  const env=await authEnv();
  let c=await loadControl(env);
  assert.equal(c.armed,false);
  assert.equal(c.attemptTarget,1);
  assert.equal(c.maxEntryDebitUsd,1);
  assert.equal(c.activeThreshold,.70);
  assert.equal(c.requiredExchangeIndex,3);
  assert.equal(c.providerWriteAuthority,'BUILT_INACTIVE_DISARMED');

  c=await updateFounderControl(env,'ARM');
  assert.equal(c.armed,true);
  assert.equal(c.providerWriteAuthority,'ENABLED_GOVERNED_PAYNE_ONLY');
  assert.equal(c.providerPostAuthority,'ENABLED_GOVERNED_PAYNE_ONLY');
  assert.equal(c.realExecution,'ENABLED_GOVERNED_PAYNE_ONLY');
  assert.equal(c.fundingAuthority,'INDEX3_ONLY');
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD',.75),/PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED/);

  c=await updateFounderControl(env,'DISARM');
  assert.equal(c.armed,false);
  assert.equal(c.providerWriteAuthority,'BUILT_INACTIVE_DISARMED');
  c=await updateFounderControl(env,'SET_THRESHOLD',.75);
  assert.equal(c.activeThreshold,.75);
  await assert.rejects(updateFounderControl(env,'ARM'),/PAYNE_REAL_ARM_THRESHOLD_MUST_BE_0_70/);
  c=await updateFounderControl(env,'SET_THRESHOLD',.70);
  await assert.rejects(updateFounderControl(env,'SET_THRESHOLD',.65),/PAYNE_CONTROL_THRESHOLD_NOT_ALLOWED/);
});

test('each scheduled scan updates current observation while history remains bounded-cadence',async()=>{
  const env=await authEnv();
  const io=installKalshiFetch();
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
  assert.match(html,/BASELINE WINDOW/);
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
  assert.match(html,/ENTRY SENT/);
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
