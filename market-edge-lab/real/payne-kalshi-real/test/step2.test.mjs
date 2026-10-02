import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  PAYNE_CONFIG,
  defaultControlState,
  initializeDisarmed,
  evaluateStep2ZeroMoneyCandidate,
  payneStage,
  realEligibility,
  estimateKalshiFeeSafeSize,
  kalshiV2EntryPayload,
  kalshiV2ExitPayload,
  payneClientOrderId,
  index3FundingEvidence,
  interpretEntryFixture,
  ownershipFixture,
  classifyProviderPositionFixture,
  settlementFallbackFixture,
  managementDecision,
  persistRun,
  persistAttempt,
  persistPosition,
  recordManagementObservation,
  recordReconciliationEvidence,
  listEvents,
  loadControl,
} from '../src/index.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryKV {
  constructor(store = new Map()) { this.store = store; this.reads=[]; this.writes=[]; }
  async get(key) { this.reads.push(key); return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.writes.push(key); this.store.set(key, value); }
  async list({prefix=''}={}) { return {keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))}; }
}

const makeEnv = (store = new Map()) => ({ PAYNE_KALSHI_STATE:new MemoryKV(store) });
const futureClose = (minutes=15)=>new Date(Date.now()+minutes*60_000).toISOString();
const candidate = (overrides={}) => ({
  marketTicker:'KXTEST-1',
  asset:'BTC',
  direction:'UP',
  outcomeSide:'YES',
  score:.72,
  edge:.04,
  move:.003,
  executionEligible:true,
  closeTime:futureClose(),
  observedPrice:.61,
  ...overrides,
});
const quote = (ticker='KXTEST-1') => ({
  ok:true,
  marketTicker:ticker,
  yesAsk:.60,
  yesBid:.59,
  noAsk:.41,
  noBid:.40,
});
const index3Balance = (balance=10) => ({
  balance_breakdown:[
    {exchange_index:0,balance:0},
    {exchange_index:2,balance:11.41},
    {exchange_index:3,balance},
  ]
});

test('01 qualifying .70 candidate reaches PULL_TRIGGER', ()=>{
  assert.equal(payneStage(candidate(),.70).stage,'PULL_TRIGGER');
});

test('02 non-PULL candidate cannot reach FIRE path', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e); let gets=0;
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate({score:.69}),{
    providerGet:async()=>{gets++; return quote();},
    balanceBody:index3Balance(),
  });
  assert.equal(gets,0);
  assert.equal(out.stopReason,'NON_PULL_CANDIDATE');
  assert.equal(out.orders,0);
});

test('03 asset eligibility is preserved', ()=>{
  const r=realEligibility(candidate({asset:'ADA'}));
  assert.equal(r.assetAllowed,false);
});

test('04 6.5-minute time gate is preserved', ()=>{
  const r=realEligibility(candidate({closeTime:futureClose(6)}));
  assert.equal(r.timeSafe,false);
});

test('05 exact ticker is preserved through fresh LOCK', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e); const seen=[];
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>{seen.push(t); return quote(t);},
    balanceBody:index3Balance(),
  });
  assert.equal(out.lock.market.marketTicker,'KXTEST-1');
  assert.equal(seen[0],'KXTEST-1');
});

test('06 same ticker and side are preserved through pre-submit reread', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e); const seen=[];
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate({outcomeSide:'YES'}),{
    providerGet:async t=>{seen.push(t); return quote(t);},
    balanceBody:index3Balance(),
  });
  assert.deepEqual(seen,['KXTEST-1','KXTEST-1']);
  assert.equal(out.entryPayload.ticker,'KXTEST-1');
  assert.equal(out.entryPayload.side,'bid');
});

test('07 fee-safe sizing stays within cap', ()=>{
  const s=estimateKalshiFeeSafeSize(.60,1);
  assert.equal(s.ok,true);
  assert.ok(s.totalDebitUsd<=1);
  assert.equal(s.executionAllowed,false);
});

test('08 IOC entry payload semantics match frozen REAL shell', ()=>{
  const s=estimateKalshiFeeSafeSize(.60,1);
  const p=kalshiV2EntryPayload(candidate({yes:.60}),s,'cid');
  assert.equal(p.time_in_force,'immediate_or_cancel');
  assert.equal(p.post_only,false);
  assert.equal(p.reduce_only,false);
  assert.equal(p.cancel_order_on_pause,true);
});

test('09 no retry chase or resting-order path exists in Step2 result', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e);
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>quote(t),
    balanceBody:index3Balance(),
  });
  assert.equal(out.entryPayload.time_in_force,'immediate_or_cancel');
  assert.equal('retry' in out,false);
  assert.equal('priceChase' in out,false);
});

test('10 Index 3 is selected only from provider evidence', ()=>{
  assert.equal(index3FundingEvidence({balance_breakdown:[{exchange_index:2,balance:10}]}).available,false);
  assert.equal(index3FundingEvidence(index3Balance(10)).available,true);
  assert.equal(index3FundingEvidence(index3Balance(10)).index,3);
});

test('11 funding gate remains fail-closed despite sufficient Index 3 evidence', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e);
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>quote(t),
    balanceBody:index3Balance(10),
  });
  assert.equal(out.index3.sufficient,true);
  assert.equal(out.funding.failClosed,true);
  assert.equal(out.funding.authorityDisabled,true);
});

test('12 provider POST remains impossible at integrated boundary', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e);
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>quote(t),
    balanceBody:index3Balance(10),
  });
  assert.equal(out.stopReason,'STEP1_PROVIDER_POST_HARD_DISABLED');
  assert.equal(out.providerWrites,0);
  assert.equal(out.orders,0);
});

test('13 NO_FILL remains an attempt result', ()=>{
  const x=interpretEntryFixture({order_id:'o1',client_order_id:'c1',fill_count:0,remaining_count:1});
  assert.equal(x.result,'NO_FILL');
  assert.equal(x.fillCount,0);
});

test('14 FILLED fixture establishes ownership', ()=>{
  const fill=interpretEntryFixture({order_id:'o1',client_order_id:'c1',fill_count:1,remaining_count:0});
  const own=ownershipFixture({ticker:'KXTEST-1',outcomeSide:'YES',fill,positionFp:'1.00'});
  assert.equal(own.owned,true);
  assert.equal(own.status,'OPEN');
});

test('15 position_fp is preserved in ownership fixture', ()=>{
  const fill={result:'FILLED',fillCount:2,orderId:'o1'};
  const own=ownershipFixture({ticker:'KXTEST-1',outcomeSide:'YES',fill,positionFp:'2.00'});
  assert.equal(own.position_fp,'2.00');
});

test('16 OPEN FLAT UNKNOWN reconciliation remains deterministic', ()=>{
  assert.equal(classifyProviderPositionFixture(false,{},'KXTEST-1').classification,'UNKNOWN');
  assert.equal(classifyProviderPositionFixture(true,{market_positions:[{ticker:'KXTEST-1',position_fp:'1.0'}]},'KXTEST-1',{paginationComplete:true}).classification,'OPEN');
  assert.equal(classifyProviderPositionFixture(true,{market_positions:[{ticker:'KXTEST-1',position_fp:'0'}]},'KXTEST-1',{paginationComplete:true}).classification,'FLAT');
});

test('17 incomplete or missing provider context yields UNKNOWN', ()=>{
  const r=classifyProviderPositionFixture(true,{market_positions:[]},'KXTEST-1',{paginationComplete:false});
  assert.equal(r.classification,'UNKNOWN');
  assert.equal(r.reason,'TICKER_NOT_FOUND_CONTEXT_UNPROVEN');
});

test('18 pagination completeness is explicit evidence', ()=>{
  const r=classifyProviderPositionFixture(true,{market_positions:[{ticker:'KXTEST-1',position_fp:'1'}]},'KXTEST-1',{paginationComplete:true});
  assert.equal(r.paginationComplete,true);
});

test('19 exact settlement can certify FLAT only after complete omission context', ()=>{
  const rec=classifyProviderPositionFixture(true,{market_positions:[]},'KXTEST-1',{paginationComplete:true});
  const out=settlementFallbackFixture(rec,[{ticker:'KXTEST-1',settled_time:'2026-10-02T00:00:00Z',market_result:'yes'}],'KXTEST-1');
  assert.equal(out.classification,'FLAT');
  assert.equal(out.reason,'EXACT_TICKER_SETTLEMENT_CONFIRMED');
});

test('20 .20 SCORE_EXIT remains exact', ()=>{
  assert.deepEqual(managementDecision({score:.20,heldMs:1000,owned:true}),{action:'EXIT',reason:'SCORE_EXIT'});
});

test('21 five-minute MAX_HOLD_EXIT remains exact', ()=>{
  assert.deepEqual(managementDecision({score:.60,heldMs:300000,owned:true}),{action:'EXIT',reason:'MAX_HOLD_EXIT'});
});

test('22 exit payload is reduce-only and same ticker', ()=>{
  const p=kalshiV2ExitPayload({marketTicker:'KXTEST-1',outcomeSide:'YES',filledCount:1},.50,'exit1');
  assert.equal(p.ticker,'KXTEST-1');
  assert.equal(p.reduce_only,true);
  assert.equal(p.time_in_force,'immediate_or_cancel');
});

test('23 durable run attempt position and lifecycle evidence persists', async ()=>{
  const store=new Map(), e=makeEnv(store); await initializeDisarmed(e);
  await persistRun(e,{runId:'r2',status:'ZERO_MONEY_STEP2'});
  await persistAttempt(e,{runId:'r2',attemptId:'a2',attemptNo:1,result:'NO_FILL'});
  await persistPosition(e,{positionId:'p2',status:'FIXTURE_ONLY',position_fp:'1'});
  await recordManagementObservation(e,{positionId:'p2',score:.4,heldMs:100});
  await recordReconciliationEvidence(e,{positionId:'p2',state:'OPEN',position_fp:'1'});
  const events=await listEvents(e);
  assert.ok(events.length>=6);
});

test('24 restart reload preserves isolated evidence and disarmed control', async ()=>{
  const store=new Map(), e1=makeEnv(store); await initializeDisarmed(e1);
  await persistAttempt(e1,{runId:'r3',attemptId:'a3',attemptNo:1,result:'NO_FILL'});
  const e2=makeEnv(store);
  const state=await loadControl(e2);
  const events=await listEvents(e2);
  assert.equal(state.armed,false);
  assert.ok(events.some(x=>x.type==='ATTEMPT_PERSISTED'));
});

test('25 Baseline and Payne Paper state reads writes remain zero', async ()=>{
  const store=new Map(), e=makeEnv(store); await initializeDisarmed(e);
  await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>quote(t),
    balanceBody:index3Balance(),
  });
  for (const key of [...e.PAYNE_KALSHI_STATE.reads,...e.PAYNE_KALSHI_STATE.writes]) {
    assert.notEqual(key,'baseline-real-execution-test-v1');
    assert.notEqual(key,'state:payne_method');
    assert.notEqual(key,'control:paper_threshold:payne_method');
    assert.ok(key.startsWith('payne-kalshi:'));
  }
});

test('26 integrated Step2 proof reports zero provider writes and zero orders', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e);
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>quote(t),
    balanceBody:index3Balance(),
  });
  assert.equal(out.providerWrites,0);
  assert.equal(out.orders,0);
  assert.equal(PAYNE_CONFIG.providerWritesEnabled,false);
  assert.equal(PAYNE_CONFIG.realExecutionEnabled,false);
});

test('27 integrated Step2 proof reports zero capital movement and stays disarmed', async ()=>{
  const e=makeEnv(); await initializeDisarmed(e);
  const out=await evaluateStep2ZeroMoneyCandidate(e,candidate(),{
    providerGet:async t=>quote(t),
    balanceBody:index3Balance(),
    seriesId:'step2-isolated',
    attemptNo:1,
  });
  const state=await loadControl(e);
  assert.equal(out.capitalMovedUsd,0);
  assert.equal(state.armed,false);
  assert.equal(state.fundingAuthority,'DISABLED');
  assert.ok(payneClientOrderId('step2-isolated',1,'entry').startsWith('payne-real-'));
});
