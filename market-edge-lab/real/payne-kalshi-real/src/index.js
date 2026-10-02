import { kalshiReadOnlyProof, kalshiGetOnly } from './kalshi-get-only.js';

const SERVICE_ID = 'market-edge-payne-kalshi-real';
const STATE_BINDING = 'PAYNE_KALSHI_STATE';
const CONTROL_KEY = 'payne-kalshi:control:v1';
const CURRENT_KEY = 'payne-kalshi:current:v1';
const EVENT_PREFIX = 'payne-kalshi:event:';
const RUN_PREFIX = 'payne-kalshi:run:';
const ATTEMPT_PREFIX = 'payne-kalshi:attempt:';
const POSITION_PREFIX = 'payne-kalshi:position:';
const FORBIDDEN_KEYS = new Set([
  'baseline-real-execution-test-v1',
  'state:payne_method',
  'control:paper_threshold:payne_method',
]);

export const PAYNE_CONFIG = Object.freeze({
  radarScore: 0.50,
  lockScore: 0.65,
  defaultThreshold: 0.70,
  minAbsMove: 0.002,
  exitScore: 0.20,
  maxHoldMs: 5 * 60 * 1000,
  executableAssets: Object.freeze(['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR']),
  providerWritesEnabled: false,
  realExecutionEnabled: false,
  fundingAuthorityEnabled: false,
});

export function defaultControlState() {
  return {
    service: SERVICE_ID,
    armed: false,
    attempts: 0,
    openPositions: 0,
    activeThreshold: PAYNE_CONFIG.defaultThreshold,
    providerWriteAuthority: 'DISABLED',
    realExecution: 'DISABLED',
    fundingAuthority: 'DISABLED',
    requiredExchangeIndex: null,
    index3: 'UNKNOWN_UNPROVEN_DISABLED_UNFUNDED',
  };
}

export function payneStage(candidate, activeThreshold = PAYNE_CONFIG.defaultThreshold) {
  const score = Number(candidate?.score);
  const edge = Number(candidate?.edge);
  const move = Number(candidate?.move);
  const radar = Number.isFinite(score) && score >= PAYNE_CONFIG.radarScore;
  const lockIn = radar && score >= PAYNE_CONFIG.lockScore && Number.isFinite(edge) && edge > 0;
  const pullTrigger = lockIn && score >= Number(activeThreshold) && Number.isFinite(move) && Math.abs(move) >= PAYNE_CONFIG.minAbsMove;
  return { radar, lockIn, pullTrigger, stage: pullTrigger ? 'PULL_TRIGGER' : lockIn ? 'LOCK_IN' : radar ? 'RADAR' : 'NO_ACTION' };
}

function binding(env) {
  const kv = env?.[STATE_BINDING];
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') throw new Error('PAYNE_KALSHI_STATE_UNBOUND');
  return kv;
}

function assertIsolatedKey(key) {
  if (FORBIDDEN_KEYS.has(key) || key.startsWith('baseline-real-') || key.startsWith('state:payne_') || key.startsWith('control:paper_threshold:payne_')) {
    throw new Error('FORBIDDEN_CROSS_SYSTEM_STATE_KEY');
  }
}

async function kvGetJson(env, key) {
  assertIsolatedKey(key);
  const raw = await binding(env).get(key);
  if (raw == null) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function kvPutJson(env, key, value) {
  assertIsolatedKey(key);
  await binding(env).put(key, JSON.stringify(value));
}

export async function loadControl(env) {
  const saved = await kvGetJson(env, CONTROL_KEY);
  return saved ?? defaultControlState();
}

export async function initializeDisarmed(env) {
  const existing = await kvGetJson(env, CONTROL_KEY);
  if (existing) return existing;
  const state = defaultControlState();
  await kvPutJson(env, CONTROL_KEY, state);
  await appendEvent(env, 'CONTROL_INITIALIZED', { armed:false, attempts:0, openPositions:0 });
  return state;
}

export async function appendEvent(env, type, payload = {}) {
  const at = new Date().toISOString();
  const id = crypto.randomUUID();
  const event = { eventId:id, at, service:SERVICE_ID, type, ...payload };
  await kvPutJson(env, `${EVENT_PREFIX}${at}:${id}`, event);
  return event;
}

export async function persistRun(env, run) {
  const key = `${RUN_PREFIX}${run.runId}`;
  await kvPutJson(env, key, run);
  await appendEvent(env, 'RUN_PERSISTED', { runId:run.runId });
}

export async function persistAttempt(env, attempt) {
  const key = `${ATTEMPT_PREFIX}${attempt.runId}:${attempt.attemptNo}`;
  await kvPutJson(env, key, attempt);
  await appendEvent(env, 'ATTEMPT_PERSISTED', { runId:attempt.runId, attemptId:attempt.attemptId, attemptNo:attempt.attemptNo, result:attempt.result ?? 'ZERO_MONEY' });
}

export async function persistPosition(env, position) {
  const key = `${POSITION_PREFIX}${position.positionId}`;
  await kvPutJson(env, key, position);
  await appendEvent(env, 'POSITION_PERSISTED', { positionId:position.positionId, status:position.status });
}

export async function listEvents(env) {
  const kv = binding(env);
  if (typeof kv.list !== 'function') throw new Error('PAYNE_KALSHI_STATE_LIST_UNAVAILABLE');
  const listed = await kv.list({ prefix: EVENT_PREFIX });
  const out = [];
  for (const row of listed?.keys ?? []) {
    const value = await kvGetJson(env, row.name);
    if (value) out.push(value);
  }
  return out.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
}

export function kalshiCandidateTimeSafe(candidate, nowMs = Date.now()) {
  const closeMs = Date.parse(candidate?.closeTime ?? '');
  return Number.isFinite(closeMs) && closeMs - nowMs > 6.5 * 60 * 1000;
}

export function realEligibility(candidate, nowMs = Date.now()) {
  return {
    assetAllowed: PAYNE_CONFIG.executableAssets.includes(candidate?.asset),
    executionEligible: candidate?.executionEligible === true,
    timeSafe: kalshiCandidateTimeSafe(candidate, nowMs),
    tickerPresent: Boolean(candidate?.marketTicker),
  };
}

export function fundingGate(control) {
  const authorityDisabled = PAYNE_CONFIG.fundingAuthorityEnabled !== true || control?.fundingAuthority !== 'ENABLED';
  const indexUnproven = control?.requiredExchangeIndex == null;
  return { ok: !authorityDisabled && !indexUnproven, authorityDisabled, indexUnproven, failClosed: authorityDisabled || indexUnproven };
}

export function kalshiGeneralTakerFeeUsd(price, count, multiplier = 1) {
  const p=Number(price), n=Number(count), m=Number(multiplier);
  if (!Number.isFinite(p) || p<=0 || p>=1 || !Number.isFinite(n) || n<=0 || !Number.isFinite(m) || m<0) return null;
  const raw=m*0.07*n*p*(1-p);
  return Math.ceil((raw-1e-12)*100)/100;
}

export function estimateKalshiFeeSafeSize(price, maxStakeUsd) {
  const p=Number(price), cap=Number(maxStakeUsd);
  if (!Number.isFinite(p) || p<=0 || p>=1 || !Number.isFinite(cap) || cap<=0) {
    return {ok:false,reason:'INVALID_PRICE_OR_CAP',count:0,executionAllowed:false};
  }
  for (let count=Math.floor(cap/p); count>=1; count--) {
    const premium=Number((count*p).toFixed(4));
    const fee=kalshiGeneralTakerFeeUsd(p,count,1);
    const total=Number((premium+fee).toFixed(4));
    if (fee!==null && total<=cap) {
      return {
        ok:true,
        reason:'GENERAL_TAKER_FEE_VERIFIED_AND_WITHIN_CAP',
        scheduleEffective:'2026-07-07',
        feeFormula:'ceil_to_cent(1 * 0.07 * C * P * (1-P))',
        multiplier:1,
        count,
        premiumUsd:premium,
        feeUsd:fee,
        totalDebitUsd:total,
        maxStakeUsd:cap,
        executionAllowed:false,
        note:'Sizing is fee-safe; execution remains separately hard-disabled.',
      };
    }
  }
  return {ok:false,reason:'NO_CONTRACT_FITS_PREMIUM_PLUS_FEE_CAP',count:0,premiumUsd:0,feeUsd:0,totalDebitUsd:0,maxStakeUsd:cap,executionAllowed:false};
}

export function kalshiV2BookSide(outcomeSide) {
  return String(outcomeSide||'').toUpperCase()==='YES' ? 'bid' :
    String(outcomeSide||'').toUpperCase()==='NO' ? 'ask' : null;
}

export function kalshiV2EntryPayload(candidate, sizing, clientOrderId) {
  const side=kalshiV2BookSide(candidate?.outcomeSide);
  if (!side) return null;
  const yesLegPrice=side==='bid' ? Number(candidate?.yes) : Number(1-Number(candidate?.yes));
  if (!Number.isFinite(yesLegPrice) || yesLegPrice<=0 || yesLegPrice>=1) return null;
  return {
    ticker:String(candidate.marketTicker),
    client_order_id:String(clientOrderId),
    side,
    count:Number(sizing.count).toFixed(2),
    price:yesLegPrice.toFixed(4),
    time_in_force:'immediate_or_cancel',
    self_trade_prevention_type:'taker_at_cross',
    post_only:false,
    cancel_order_on_pause:true,
    reduce_only:false,
  };
}

export function kalshiV2ExitPayload(state, currentBid, clientOrderId) {
  const entrySide=kalshiV2BookSide(state?.outcomeSide);
  if (!entrySide) return null;
  const side=entrySide==='bid' ? 'ask' : 'bid';
  const outcomeBid=Number(currentBid);
  const yesLegPrice=String(state?.outcomeSide).toUpperCase()==='YES' ? outcomeBid : 1-outcomeBid;
  if (!Number.isFinite(yesLegPrice) || yesLegPrice<=0 || yesLegPrice>=1) return null;
  return {
    ticker:String(state.marketTicker),
    client_order_id:String(clientOrderId),
    side,
    count:Number(state.remainingExitCount||state.filledCount||state.entryCount||0).toFixed(2),
    price:yesLegPrice.toFixed(4),
    time_in_force:'immediate_or_cancel',
    self_trade_prevention_type:'taker_at_cross',
    post_only:false,
    cancel_order_on_pause:true,
    reduce_only:true,
  };
}

export function payneClientOrderId(seriesId, attemptNo, phase) {
  const seed=String(seriesId||'step2').replace(/[^0-9A-Za-z]/g,'').slice(-12);
  return ('payne-real-'+seed+'-'+String(attemptNo)+'-'+String(phase||'entry')).slice(0,64);
}

export function index3FundingEvidence(balanceBody, minRequiredUsd = 1) {
  const rows=Array.isArray(balanceBody?.balance_breakdown) ? balanceBody.balance_breakdown : null;
  if (!rows) return {index:3,available:false,balanceUsd:null,sufficient:false,evidence:'UNKNOWN_PROVIDER_EVIDENCE_INSUFFICIENT'};
  const row=rows.find(x=>Number(x?.exchange_index)===3);
  if (!row) return {index:3,available:false,balanceUsd:null,sufficient:false,evidence:'READ_PROVEN_UNAVAILABLE'};
  const balance=Number(row?.balance);
  return {
    index:3,
    available:true,
    balanceUsd:Number.isFinite(balance)?balance:null,
    sufficient:Number.isFinite(balance) && balance>=Number(minRequiredUsd),
    evidence:'READ_PROVEN_AVAILABLE',
  };
}

export function interpretEntryFixture(providerOrder) {
  const fillCount=Number(providerOrder?.fill_count??providerOrder?.filled_count??0);
  const remainingCount=Number(providerOrder?.remaining_count??0);
  return {
    result:fillCount>0?'FILLED':'NO_FILL',
    fillCount:Number.isFinite(fillCount)?fillCount:0,
    remainingCount:Number.isFinite(remainingCount)?remainingCount:0,
    orderId:providerOrder?.order_id||null,
    clientOrderId:providerOrder?.client_order_id||null,
    averageFillPrice:providerOrder?.average_fill_price??null,
    averageFeePaid:providerOrder?.average_fee_paid??null,
  };
}

export function ownershipFixture({ ticker, outcomeSide, fill, positionFp }) {
  if (!fill || fill.result!=='FILLED' || !(Number(fill.fillCount)>0)) {
    return {owned:false,status:'NO_POSITION',position_fp:null};
  }
  return {
    owned:true,
    status:'OPEN',
    marketTicker:String(ticker),
    outcomeSide:String(outcomeSide||'').toUpperCase(),
    filledCount:Number(fill.fillCount),
    entryOrderId:fill.orderId||null,
    position_fp:positionFp??null,
  };
}

export function classifyProviderPositionFixture(httpOk, body, ticker, meta = {}) {
  const base={
    providerReadAt:meta.providerReadAt||new Date().toISOString(),
    providerHttpStatus:meta.providerHttpStatus??null,
    recognizedSchema:null,
    matchedTicker:null,
    rawQuantityFieldUsed:null,
    normalizedQuantity:null,
    subaccount:0,
    exchangeScope:'ALL',
    accountContextKnown:true,
    paginationComplete:meta.paginationComplete===true,
  };
  if (!httpOk) return {classification:'UNKNOWN',reason:'HTTP_FAILURE',...base};
  if (!body || typeof body!=='object') return {classification:'UNKNOWN',reason:'MALFORMED_JSON_OR_BODY',...base};
  let rows=null, schema=null;
  if (Array.isArray(body.market_positions)) { rows=body.market_positions; schema='market_positions'; }
  else if (Array.isArray(body.positions)) { rows=body.positions; schema='positions'; }
  else return {classification:'UNKNOWN',reason:'UNKNOWN_SCHEMA',...base};
  base.recognizedSchema=schema;
  const matches=rows.filter(x=>String(x?.ticker||x?.market_ticker||'')===String(ticker||''));
  if (matches.length!==1) return {classification:'UNKNOWN',reason:matches.length>1?'TICKER_AMBIGUOUS':'TICKER_NOT_FOUND_CONTEXT_UNPROVEN',...base};
  const exact=matches[0];
  base.matchedTicker=String(exact?.ticker||exact?.market_ticker||'');
  let raw, field;
  if (exact?.position_fp!==undefined && exact?.position_fp!==null && exact?.position_fp!=='') { raw=exact.position_fp; field='position_fp'; }
  else if (exact?.position!==undefined && exact?.position!==null && exact?.position!=='') { raw=exact.position; field='position'; }
  else if (exact?.quantity!==undefined && exact?.quantity!==null && exact?.quantity!=='') { raw=exact.quantity; field='quantity'; }
  else return {classification:'UNKNOWN',reason:'QUANTITY_MISSING',...base};
  base.rawQuantityFieldUsed=field;
  if (typeof raw==='string' && raw.trim()!==raw) return {classification:'UNKNOWN',reason:'QUANTITY_MALFORMED_WHITESPACE',...base};
  if (typeof raw==='string' && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return {classification:'UNKNOWN',reason:'QUANTITY_INVALID',...base};
  const qty=Number(raw);
  if (!Number.isFinite(qty)) return {classification:'UNKNOWN',reason:'QUANTITY_INVALID',...base};
  base.normalizedQuantity=qty;
  if (Math.abs(qty)<=1e-9) return {classification:'FLAT',reason:'MATCHED_TICKER_VALID_ZERO_QUANTITY',...base};
  return {classification:'OPEN',reason:'MATCHED_TICKER_VALID_NONZERO_QUANTITY',...base};
}

export function settlementFallbackFixture(reconciliation, settlements, ticker) {
  if (reconciliation?.classification!=='UNKNOWN' || reconciliation?.reason!=='TICKER_NOT_FOUND_CONTEXT_UNPROVEN' || reconciliation?.paginationComplete!==true) return reconciliation;
  const rows=Array.isArray(settlements)?settlements:[];
  const exact=rows.find(x=>String(x?.ticker||'')===String(ticker||''))||null;
  if (!exact) return reconciliation;
  return {
    ...reconciliation,
    classification:'FLAT',
    reason:'EXACT_TICKER_SETTLEMENT_CONFIRMED',
    matchedTicker:String(ticker),
    normalizedQuantity:0,
    settlementConfirmed:true,
    settledTime:exact?.settled_time||null,
    marketResult:exact?.market_result||null,
  };
}

export async function freshKalshiExecutionQuote(env, candidate, providerGet) {
  if (typeof providerGet !== 'function') throw new Error('PROVIDER_GET_ADAPTER_REQUIRED');
  const quote = await providerGet(candidate.marketTicker);
  if (!quote?.ok) return { ok:false, reason:quote?.reason ?? 'KALSHI_QUOTE_READ_FAILED' };
  if (quote.marketTicker && quote.marketTicker !== candidate.marketTicker) return { ok:false, reason:'EXACT_TICKER_MISMATCH' };
  return { ok:true, market:quote };
}

function hardStopBeforeProviderPost(context) {
  if (PAYNE_CONFIG.providerWritesEnabled !== true || PAYNE_CONFIG.realExecutionEnabled !== true) {
    return { ok:false, stopped:true, reason:'STEP1_PROVIDER_POST_HARD_DISABLED', context };
  }
  throw new Error('STEP1_INVARIANT_BROKEN_PROVIDER_WRITE_ENABLED');
}

export async function evaluateZeroMoneyCandidate(env, candidate, { providerGet, nowMs = Date.now(), activeThreshold } = {}) {
  const control = await loadControl(env);
  const threshold = Number.isFinite(Number(activeThreshold)) ? Number(activeThreshold) : Number(control.activeThreshold ?? PAYNE_CONFIG.defaultThreshold);
  const gate = payneStage(candidate, threshold);
  const eligibility = realEligibility(candidate, nowMs);
  const decisionEvent = await appendEvent(env, 'CANDIDATE_DECISION', {
    ticker:candidate?.marketTicker ?? null,
    asset:candidate?.asset ?? null,
    direction:candidate?.direction ?? null,
    payneScore:Number(candidate?.score), payneEdge:Number(candidate?.edge), payneMove:Number(candidate?.move),
    payneStage:gate.stage, payneThreshold:threshold,
    observedPrice:candidate?.observedPrice ?? null,
    eligibility,
  });
  if (!gate.pullTrigger) return { ok:true, fired:false, gate, eligibility, decisionEvent, stopReason:'NON_PULL_CANDIDATE' };
  if (!eligibility.assetAllowed || !eligibility.executionEligible || !eligibility.timeSafe || !eligibility.tickerPresent) {
    return { ok:true, fired:false, gate, eligibility, decisionEvent, stopReason:'REAL_ELIGIBILITY_GATE' };
  }
  const lock = await freshKalshiExecutionQuote(env, candidate, providerGet);
  await appendEvent(env, 'FRESH_LOCK_READ', { ticker:candidate.marketTicker, ok:lock.ok, quote:lock.ok ? lock.market : null, reason:lock.reason ?? null });
  if (!lock.ok) return { ok:true, fired:false, gate, eligibility, lock, stopReason:'FRESH_LOCK_FAILED' };
  const preSubmit = await freshKalshiExecutionQuote(env, candidate, providerGet);
  await appendEvent(env, 'PRE_SUBMIT_READ', { ticker:candidate.marketTicker, ok:preSubmit.ok, quote:preSubmit.ok ? preSubmit.market : null, reason:preSubmit.reason ?? null });
  if (!preSubmit.ok) return { ok:true, fired:false, gate, eligibility, lock, preSubmit, stopReason:'PRE_SUBMIT_FAILED' };
  const funding = fundingGate(control);
  await appendEvent(env, 'FUNDING_GATE', { ticker:candidate.marketTicker, ...funding });
  const stop = hardStopBeforeProviderPost({ ticker:candidate.marketTicker, stage:gate.stage, funding });
  await appendEvent(env, 'PROVIDER_POST_BLOCKED', { ticker:candidate.marketTicker, reason:stop.reason, funding });
  return { ok:true, fired:false, gate, eligibility, lock, preSubmit, funding, stopReason:stop.reason };
}

export async function evaluateStep2ZeroMoneyCandidate(env, candidate, {
  providerGet,
  balanceBody,
  nowMs = Date.now(),
  activeThreshold,
  maxStakeUsd = 1,
  seriesId = 'step2',
  attemptNo = 1,
} = {}) {
  const control=await loadControl(env);
  const threshold=Number.isFinite(Number(activeThreshold))?Number(activeThreshold):Number(control.activeThreshold??PAYNE_CONFIG.defaultThreshold);
  const gate=payneStage(candidate,threshold);
  const eligibility=realEligibility(candidate,nowMs);
  await appendEvent(env,'STEP2_CANDIDATE_DECISION',{
    ticker:candidate?.marketTicker??null,
    asset:candidate?.asset??null,
    direction:candidate?.direction??null,
    outcomeSide:candidate?.outcomeSide??null,
    payneScore:Number(candidate?.score),
    payneEdge:Number(candidate?.edge),
    payneMove:Number(candidate?.move),
    payneStage:gate.stage,
    payneThreshold:threshold,
    eligibility,
  });
  if (!gate.pullTrigger) return {ok:true,fired:false,gate,eligibility,providerWrites:0,orders:0,capitalMovedUsd:0,stopReason:'NON_PULL_CANDIDATE'};
  if (!eligibility.assetAllowed || !eligibility.executionEligible || !eligibility.timeSafe || !eligibility.tickerPresent) {
    return {ok:true,fired:false,gate,eligibility,providerWrites:0,orders:0,capitalMovedUsd:0,stopReason:'REAL_ELIGIBILITY_GATE'};
  }

  const lock=await freshKalshiExecutionQuote(env,candidate,providerGet);
  await appendEvent(env,'STEP2_FRESH_LOCK_READ',{ticker:candidate.marketTicker,outcomeSide:candidate?.outcomeSide??null,ok:lock.ok,reason:lock.reason??null});
  if (!lock.ok) return {ok:true,fired:false,gate,eligibility,lock,providerWrites:0,orders:0,capitalMovedUsd:0,stopReason:'FRESH_LOCK_FAILED'};

  const preSubmit=await freshKalshiExecutionQuote(env,candidate,providerGet);
  await appendEvent(env,'STEP2_PRE_SUBMIT_READ',{ticker:candidate.marketTicker,outcomeSide:candidate?.outcomeSide??null,ok:preSubmit.ok,reason:preSubmit.reason??null});
  if (!preSubmit.ok) return {ok:true,fired:false,gate,eligibility,lock,preSubmit,providerWrites:0,orders:0,capitalMovedUsd:0,stopReason:'PRE_SUBMIT_FAILED'};

  const outcome=String(candidate?.outcomeSide||'').toUpperCase();
  const selectedAsk=outcome==='YES'?Number(preSubmit.market?.yesAsk):outcome==='NO'?Number(preSubmit.market?.noAsk):NaN;
  const executionCandidate={...candidate,yes:selectedAsk};
  const sizing=estimateKalshiFeeSafeSize(selectedAsk,maxStakeUsd);
  if (!sizing.ok) return {ok:true,fired:false,gate,eligibility,lock,preSubmit,sizing,providerWrites:0,orders:0,capitalMovedUsd:0,stopReason:'FEE_SAFE_SIZING_FAILED'};

  const clientOrderId=payneClientOrderId(seriesId,attemptNo,'entry');
  const entryPayload=kalshiV2EntryPayload(executionCandidate,sizing,clientOrderId);
  if (!entryPayload) return {ok:true,fired:false,gate,eligibility,lock,preSubmit,sizing,providerWrites:0,orders:0,capitalMovedUsd:0,stopReason:'ENTRY_PAYLOAD_INVALID'};

  const index3=index3FundingEvidence(balanceBody,sizing.totalDebitUsd);
  const funding=fundingGate({
    ...control,
    requiredExchangeIndex:index3.available?3:null,
  });
  await appendEvent(env,'STEP2_ZERO_MONEY_PLAN',{
    ticker:candidate.marketTicker,
    outcomeSide:outcome,
    clientOrderId,
    sizing,
    entryPayload,
    index3,
    funding,
  });

  const stop=hardStopBeforeProviderPost({
    ticker:candidate.marketTicker,
    stage:gate.stage,
    sizing,
    clientOrderId,
    entryPayload,
    index3,
    funding,
  });
  await appendEvent(env,'PROVIDER_POST_BLOCKED',{ticker:candidate.marketTicker,reason:stop.reason,funding,index3});
  return {
    ok:true,
    fired:false,
    gate,
    eligibility,
    lock,
    preSubmit,
    sizing,
    clientOrderId,
    entryPayload,
    index3,
    funding,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
    stopReason:stop.reason,
  };
}

export function reconcileFixture({ providerContextComplete, ownedPosition, settlementEvidence }) {
  if (!providerContextComplete) return 'UNKNOWN';
  if (ownedPosition) return 'OPEN';
  if (settlementEvidence === true) return 'FLAT';
  return 'FLAT';
}

export function managementDecision({ score, heldMs, owned = true }) {
  if (!owned) return { action:'HOLD', reason:'NO_AUTHENTICATED_OWNERSHIP' };
  if (Number(score) <= PAYNE_CONFIG.exitScore) return { action:'EXIT', reason:'SCORE_EXIT' };
  if (Number(heldMs) >= PAYNE_CONFIG.maxHoldMs) return { action:'EXIT', reason:'MAX_HOLD_EXIT' };
  return { action:'HOLD', reason:'MANAGE' };
}

export async function recordManagementObservation(env, observation) {
  return appendEvent(env, 'MANAGEMENT_OBSERVATION', observation);
}

export async function recordReconciliationEvidence(env, evidence) {
  return appendEvent(env, 'RECONCILIATION_EVIDENCE', evidence);
}


export const COCKPIT_REFRESH_MS = 60_000;

function normalizeProviderProbability(value) {
  if (value === null || value === undefined || value === '') return null;
  const n=Number(value);
  if (!Number.isFinite(n)) return null;
  if (n>=0 && n<=1) return n;
  if (n>=0 && n<=100) return n/100;
  return null;
}

function marketAsset(market) {
  const text=[
    market?.ticker,
    market?.series_ticker,
    market?.seriesTicker,
    market?.title,
    market?.subtitle,
  ].filter(Boolean).join(' ').toUpperCase();
  const aliases={
    BTC:['BTC','BITCOIN'],
    ETH:['ETH','ETHEREUM'],
    SOL:['SOL','SOLANA'],
    XRP:['XRP','RIPPLE'],
    HYPE:['HYPE','HYPERLIQUID'],
    ZEC:['ZEC','ZCASH'],
    DOGE:['DOGE','DOGECOIN'],
    BNB:['BNB'],
    NEAR:['NEAR'],
  };
  for (const asset of PAYNE_CONFIG.executableAssets) {
    if ((aliases[asset]||[asset]).some(alias=>new RegExp('(^|[^A-Z])'+alias+'([^A-Z]|$)').test(text))) return asset;
    if (String(market?.series_ticker||market?.seriesTicker||'').toUpperCase().includes(asset+'15M')) return asset;
  }
  return null;
}

function marketLooks15m(market) {
  const series=String(market?.series_ticker||market?.seriesTicker||'').toUpperCase();
  const ticker=String(market?.ticker||'').toUpperCase();
  if (series.includes('15M') || ticker.includes('15M')) return true;
  const open=Date.parse(market?.open_time||market?.openTime||'');
  const close=Date.parse(market?.close_time||market?.closeTime||'');
  if (!Number.isFinite(open) || !Number.isFinite(close)) return false;
  const duration=close-open;
  return duration>=10*60_000 && duration<=20*60_000;
}

export function providerMarketSnapshot(market, nowMs = Date.now()) {
  const ticker=String(market?.ticker||market?.market_ticker||'').trim();
  const closeTime=market?.close_time||market?.closeTime||null;
  const closeMs=Date.parse(closeTime||'');
  const yesAsk=normalizeProviderProbability(market?.yes_ask_dollars??market?.yes_ask);
  const yesBid=normalizeProviderProbability(market?.yes_bid_dollars??market?.yes_bid);
  const noAsk=normalizeProviderProbability(market?.no_ask_dollars??market?.no_ask);
  const noBid=normalizeProviderProbability(market?.no_bid_dollars??market?.no_bid);
  return {
    source:'LIVE_PROVIDER_DATA',
    asset:marketAsset(market),
    direction:null,
    outcomeSide:null,
    ticker,
    seriesTicker:market?.series_ticker||market?.seriesTicker||null,
    title:market?.title||market?.subtitle||ticker||'UNKNOWN',
    subtitle:market?.subtitle||null,
    status:market?.status||null,
    yesAsk,
    yesBid,
    noAsk,
    noBid,
    closeTime,
    timeRemainingMs:Number.isFinite(closeMs)?Math.max(0,closeMs-nowMs):null,
    executionEligible:market?.status ? ['open','active'].includes(String(market.status).toLowerCase()) : null,
  };
}

export function livePayneFeatureState(candidate) {
  const move=Number(candidate?.move);
  const fair=Number(candidate?.fair);
  const edge=Number(candidate?.edge);
  const score=Number(candidate?.score);
  const authoritative=[
    Number.isFinite(move),
    Number.isFinite(fair),
    Number.isFinite(edge),
    Number.isFinite(score),
  ].every(Boolean);
  if (!authoritative) {
    return {
      source:'DERIVED_PAYNE_DATA',
      available:false,
      move:null,
      fair:null,
      edge:null,
      score:null,
      state:'UNKNOWN / UNAVAILABLE',
      reason:'AUTHORITATIVE_LIVE_PAYNE_FEATURE_SOURCE_NOT_WIRED',
    };
  }
  const gate=payneStage({move,fair,edge,score},PAYNE_CONFIG.defaultThreshold);
  return {source:'DERIVED_PAYNE_DATA',available:true,move,fair,edge,score,state:gate.stage,reason:null};
}

async function safeProviderJson(response) {
  try { return await response.json(); } catch { return {}; }
}

export async function discoverCockpitMarkets(env, { nowMs=Date.now(), maxPages=5 } = {}) {
  const byAsset=new Map();
  let cursor='';
  let providerGets=0;
  let lastStatus=null;
  for (let page=0; page<maxPages; page++) {
    const path='/trade-api/v2/markets?status=open&limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
    providerGets++;
    const response=await kalshiGetOnly(env,path);
    lastStatus=response.status;
    if (!response.ok) return {ok:false,providerGets,httpStatus:response.status,markets:[],error:'MARKET_DISCOVERY_HTTP_'+response.status};
    const body=await safeProviderJson(response);
    const rows=Array.isArray(body?.markets)?body.markets:[];
    for (const raw of rows) {
      const asset=marketAsset(raw);
      if (!asset || !marketLooks15m(raw)) continue;
      const snap=providerMarketSnapshot(raw,nowMs);
      if (!snap.ticker || !(snap.timeRemainingMs>0)) continue;
      const prior=byAsset.get(asset);
      if (!prior || Number(snap.timeRemainingMs)<Number(prior.timeRemainingMs)) byAsset.set(asset,snap);
    }
    cursor=String(body?.cursor||'');
    if (!cursor || byAsset.size>=PAYNE_CONFIG.executableAssets.length) break;
  }
  const markets=[...byAsset.values()].sort((a,b)=>Number(a.timeRemainingMs??Infinity)-Number(b.timeRemainingMs??Infinity));
  return {ok:true,providerGets,httpStatus:lastStatus,markets,cursorRemaining:Boolean(cursor)};
}

function providerIndex3Evidence(balanceBody) {
  const rows=Array.isArray(balanceBody?.balance_breakdown)?balanceBody.balance_breakdown:null;
  if (!rows) return {status:'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT',balance:null};
  const row=rows.find(x=>Number(x?.exchange_index)===3);
  if (!row) return {status:'READ-PROVEN UNAVAILABLE',balance:null};
  const balance=Number(row?.balance);
  return {status:'READ-PROVEN AVAILABLE',balance:Number.isFinite(balance)?balance:null};
}

async function exactMarketRead(env, ticker) {
  const path='/trade-api/v2/markets/'+encodeURIComponent(ticker);
  const response=await kalshiGetOnly(env,path);
  const body=await safeProviderJson(response);
  const market=body?.market||body;
  return {
    ok:response.ok,
    httpStatus:response.status,
    path,
    readAt:new Date().toISOString(),
    market:response.ok?providerMarketSnapshot(market):null,
  };
}

export async function buildCockpitData(env, nowMs=Date.now()) {
  let providerGets=0;
  const control=await loadControl(env);
  let balance={ok:false,httpStatus:null,body:{}};
  try {
    const response=await kalshiGetOnly(env,'/trade-api/v2/portfolio/balance');
    providerGets++;
    balance={ok:response.ok,httpStatus:response.status,body:await safeProviderJson(response)};
  } catch (error) {
    return {
      ok:false,
      service:SERVICE_ID,
      mode:'ZERO-MONEY / GET-ONLY',
      updatedAt:new Date().toISOString(),
      providerGets,
      providerWrites:0,
      orders:0,
      capitalMovedUsd:0,
      error:'AUTHENTICATED_BALANCE_GET_FAILED',
      errorClass:error?.name||'Error',
      safety:step1Status(),
    };
  }

  let discovery;
  try {
    discovery=await discoverCockpitMarkets(env,{nowMs});
    providerGets+=Number(discovery.providerGets||0);
  } catch (error) {
    discovery={ok:false,providerGets:0,httpStatus:null,markets:[],error:'MARKET_DISCOVERY_FAILED',errorClass:error?.name||'Error'};
  }

  const selected=discovery.markets?.[0]||null;
  let freshLock=null, preSubmit=null;
  if (selected?.ticker) {
    try {
      freshLock=await exactMarketRead(env,selected.ticker); providerGets++;
      preSubmit=await exactMarketRead(env,selected.ticker); providerGets++;
    } catch (error) {
      freshLock=freshLock||{ok:false,httpStatus:null,path:null,readAt:new Date().toISOString(),market:null,errorClass:error?.name||'Error'};
      preSubmit=preSubmit||{ok:false,httpStatus:null,path:null,readAt:new Date().toISOString(),market:null,errorClass:error?.name||'Error'};
    }
  }

  const index3=providerIndex3Evidence(balance.body);
  const payne=livePayneFeatureState(selected);
  const tickerConsistent=Boolean(
    selected?.ticker &&
    freshLock?.market?.ticker===selected.ticker &&
    preSubmit?.market?.ticker===selected.ticker
  );
  const timeSafe=selected?.closeTime ? kalshiCandidateTimeSafe({closeTime:selected.closeTime},nowMs) : null;

  return {
    ok:Boolean(balance.ok && discovery.ok),
    service:SERVICE_ID,
    mode:'ZERO-MONEY / GET-ONLY',
    updatedAt:new Date().toISOString(),
    refreshIntervalMs:COCKPIT_REFRESH_MS,
    providerGets,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
    authentication:balance.ok?'PROVEN':'NOT_PROVEN',
    balanceHttpStatus:balance.httpStatus,
    index3,
    control:{
      armed:Boolean(control?.armed),
      attempts:Number(control?.attempts||0),
      openPositions:Number(control?.openPositions||0),
      threshold:Number(control?.activeThreshold??PAYNE_CONFIG.defaultThreshold),
      realExecution:control?.realExecution||'DISABLED',
      fundingAuthority:control?.fundingAuthority||'DISABLED',
      providerWriteAuthority:control?.providerWriteAuthority||'DISABLED',
    },
    markets:discovery.markets||[],
    selected,
    payne,
    pipeline:{
      radar:payne.available ? (payne.score>=PAYNE_CONFIG.radarScore?'PASS':'FAIL') : 'UNKNOWN / UNAVAILABLE',
      lockIn:payne.available ? (payne.score>=PAYNE_CONFIG.lockScore && payne.edge>0?'PASS':'FAIL') : 'UNKNOWN / UNAVAILABLE',
      pullTrigger:payne.available ? (payneStage(payne,PAYNE_CONFIG.defaultThreshold).pullTrigger?'PASS':'FAIL') : 'UNKNOWN / UNAVAILABLE',
      realEligibility:selected ? {
        assetAllowed:PAYNE_CONFIG.executableAssets.includes(selected.asset),
        executionEligible:selected.executionEligible,
        tickerPresent:Boolean(selected.ticker),
      } : null,
      timeGate6_5m:timeSafe===null?'UNKNOWN':timeSafe?'PASS':'FAIL',
      freshLock:freshLock?.ok?'PROVEN':selected?'NOT_PROVEN':'NOT_AVAILABLE',
      preSubmit:preSubmit?.ok?'PROVEN':selected?'NOT_PROVEN':'NOT_AVAILABLE',
      tickerConsistent:selected?tickerConsistent:null,
      feeSafeSizing:'NOT_RUN_NO_AUTHORITATIVE_PAYNE_QUALIFICATION',
      iocPayload:'NOT_RUN_NO_AUTHORITATIVE_PAYNE_QUALIFICATION',
      fundingGate:{
        index3:index3.status,
        fundingAuthority:'DISABLED',
        result:'FAIL_CLOSED',
      },
      providerPost:'HARD DISABLED',
    },
    observations:{
      initial:selected,
      freshLock,
      preSubmit,
    },
    zeroMoneyPreview:null,
    discovery:{
      ok:discovery.ok,
      httpStatus:discovery.httpStatus,
      error:discovery.error||null,
      cursorRemaining:Boolean(discovery.cursorRemaining),
    },
    safety:{
      payneArmed:false,
      realExecution:'DISABLED',
      fundingAuthority:'DISABLED',
      providerWrites:0,
      orders:0,
      capitalMovedUsd:0,
      getOnly:'ACTIVE',
      providerPost:'HARD DISABLED',
      secondIoc:'HOLD',
    },
  };
}

export function cockpitHtml() {
  return \`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NFE-OS PAYNE-KALSHI REAL</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#071018;color:#e8f3ff;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1180px;margin:auto;padding:16px}.top{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.tag,.card{border:1px solid #29445b;background:#0c1823;border-radius:12px}.tag{padding:8px 12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px}.card{padding:14px}.good{color:#75e8a7}.warn{color:#ffd36b}.bad{color:#ff8888}.muted{color:#91a8bb}.big{font-size:19px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px;border-bottom:1px solid #203546;text-align:left;vertical-align:top}button{background:#14283a;color:#dff2ff;border:1px solid #36566f;border-radius:9px;padding:9px 12px;font-weight:700}code{font-size:12px}.pipeline{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:7px}.step{padding:9px;border:1px solid #29445b;border-radius:9px;background:#08131d}.value{font-weight:800}.scroll{overflow:auto}.danger{border-color:#784747}.source{font-size:11px;letter-spacing:.05em;color:#85a9c4}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:760px){.two{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<div class="top"><div><div class="source">NFE-OS · LIVE READ-ONLY</div><div class="big">PAYNE-KALSHI REAL COCKPIT</div></div><button id="refresh">REFRESH READS</button></div>
<div id="status" class="tag warn">Loading authenticated GET-only evidence…</div>
<div class="grid" id="safety"></div>
<div class="card"><div class="big">CURRENT KALSHI 15-MINUTE UNIVERSE</div><div class="muted">LIVE PROVIDER DATA — no fixture prices</div><div class="scroll"><table><thead><tr><th>Asset</th><th>Ticker</th><th>Contract</th><th>YES bid/ask</th><th>NO bid/ask</th><th>Close</th><th>Remaining</th><th>Payne state</th></tr></thead><tbody id="markets"></tbody></table></div></div>
<div class="two">
<div class="card"><div class="big">SELECTED LIVE CONTRACT</div><div id="selected"></div></div>
<div class="card"><div class="big">PAYNE FEATURE EVIDENCE</div><div id="features"></div></div>
</div>
<div class="card"><div class="big">READ-ONLY PIPELINE</div><div class="pipeline" id="pipeline"></div></div>
<div class="two">
<div class="card"><div class="big">FRESH LOCK / PRE-SUBMIT</div><div id="reads"></div></div>
<div class="card danger"><div class="big">ZERO-MONEY FIRE BOUNDARY</div><div id="fire"></div></div>
</div>
<div class="card"><span class="source">Refresh interval: 60 seconds · authenticated GETs only · no scheduler execution authority</span></div>
</div>
<script>
const q=s=>document.querySelector(s);
const fmtP=v=>Number.isFinite(Number(v))?(Number(v)*100).toFixed(1)+'¢':'—';
const fmtT=ms=>Number.isFinite(Number(ms))?Math.max(0,Math.floor(ms/60000))+'m '+Math.floor((ms%60000)/1000)+'s':'—';
const val=v=>v===null||v===undefined?'UNKNOWN / UNAVAILABLE':String(v);
const cls=v=>String(v).includes('PROVEN')||v===true||v==='PASS'?'good':String(v).includes('DISABLED')||String(v).includes('HARD')||String(v).includes('UNKNOWN')||v===false?'warn':'';
function card(k,v){return '<div class="card"><div class="source">'+k+'</div><div class="value '+cls(v)+'">'+val(v)+'</div></div>'}
function step(k,v){return '<div class="step"><div class="source">'+k+'</div><div class="value '+cls(v)+'">'+val(v)+'</div></div>'}
async function load(){
  q('#status').textContent='Refreshing authenticated provider reads…';
  try{
    const r=await fetch('/cockpit-data',{cache:'no-store'});
    const d=await r.json();
    q('#status').innerHTML='<b>'+(d.ok?'LIVE READS GREEN':'READS PARTIAL')+'</b> · Last updated '+val(d.updatedAt)+' · provider GETs this refresh '+val(d.providerGets);
    q('#safety').innerHTML=
      card('AUTHENTICATION',d.authentication)+card('GET-ONLY',d.safety?.getOnly)+
      card('PAYNE ARMED',d.safety?.payneArmed)+card('REAL EXECUTION',d.safety?.realExecution)+
      card('FUNDING AUTHORITY',d.safety?.fundingAuthority)+card('INDEX 3',d.index3?.status+(d.index3?.balance!==null?' ·   return {
    service:SERVICE_ID,
    mode:'ZERO-MONEY / GET-ONLY',
    stateBinding:STATE_BINDING,
    defaultState:defaultControlState(),
    providerWrites:0,
    providerWriteAuthority:'DISABLED',
    realExecution:'DISABLED',
    fundingAuthority:'DISABLED',
    index3:'UNKNOWN',
    secondIoc:'HOLD_UNCHANGED',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return Response.json({ ok:false, reason:'GET_ONLY' }, { status:405 });
    if (url.pathname === '/status') return Response.json(step1Status());
    if (url.pathname === '/cockpit-data') return Response.json(await buildCockpitData(env), { headers:{'cache-control':'no-store'} });
    if (url.pathname === '/proof') {
      const provider = await kalshiReadOnlyProof(env);
      return Response.json({
        ...step1Status(),
        serviceLive:true,
        kv:{ binding:STATE_BINDING, connected:Boolean(env?.[STATE_BINDING]) },
        kalshi:provider,
      });
    }
    if (url.pathname === '/' || url.pathname === '/cockpit') {
      return new Response(cockpitHtml(), { headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'} });
    }
    return Response.json({ ok:false, error:'NOT_FOUND' }, { status:404 });
  },
  async scheduled(controller, env) {
    await initializeDisarmed(env);
  },
};
+Number(d.index3.balance).toFixed(2):''))+
      card('PROVIDER WRITES',d.providerWrites)+card('ORDERS',d.orders)+
      card('CAPITAL MOVED','  return {
    service:SERVICE_ID,
    mode:'ZERO-MONEY / GET-ONLY',
    stateBinding:STATE_BINDING,
    defaultState:defaultControlState(),
    providerWrites:0,
    providerWriteAuthority:'DISABLED',
    realExecution:'DISABLED',
    fundingAuthority:'DISABLED',
    index3:'UNKNOWN',
    secondIoc:'HOLD_UNCHANGED',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return Response.json({ ok:false, reason:'GET_ONLY' }, { status:405 });
    if (url.pathname === '/status') return Response.json(step1Status());
    if (url.pathname === '/proof') {
      const provider = await kalshiReadOnlyProof(env);
      return Response.json({
        ...step1Status(),
        serviceLive:true,
        kv:{ binding:STATE_BINDING, connected:Boolean(env?.[STATE_BINDING]) },
        kalshi:provider,
      });
    }
    return Response.json({ ok:true, service:SERVICE_ID, mode:'ZERO-MONEY / GET-ONLY', armed:false, attempts:0, openPositions:0, threshold:PAYNE_CONFIG.defaultThreshold, providerWrites:0, providerWriteAuthority:'DISABLED', realExecution:'DISABLED', fundingAuthority:'DISABLED' });
  },
  async scheduled(controller, env) {
    await initializeDisarmed(env);
  },
};
+Number(d.capitalMovedUsd||0).toFixed(2))+card('PROVIDER POST',d.safety?.providerPost)+card('SECOND IOC',d.safety?.secondIoc);
    const rows=(d.markets||[]).map(m=>'<tr><td>'+val(m.asset)+'</td><td><code>'+val(m.ticker)+'</code></td><td>'+val(m.title)+'</td><td>'+fmtP(m.yesBid)+' / '+fmtP(m.yesAsk)+'</td><td>'+fmtP(m.noBid)+' / '+fmtP(m.noAsk)+'</td><td>'+val(m.closeTime)+'</td><td>'+fmtT(m.timeRemainingMs)+'</td><td>UNKNOWN / UNAVAILABLE</td></tr>').join('');
    q('#markets').innerHTML=rows||'<tr><td colspan="8">NO CURRENT 15-MINUTE PROVIDER CONTRACTS FOUND IN BOUNDED READ</td></tr>';
    const m=d.selected;
    q('#selected').innerHTML=m?'<p><b>'+val(m.asset)+'</b> · <code>'+val(m.ticker)+'</code></p><p>'+val(m.title)+'</p><p>YES bid/ask: <b>'+fmtP(m.yesBid)+' / '+fmtP(m.yesAsk)+'</b><br>NO bid/ask: <b>'+fmtP(m.noBid)+' / '+fmtP(m.noAsk)+'</b><br>Close: '+val(m.closeTime)+'<br>Remaining: '+fmtT(m.timeRemainingMs)+'</p>':'<p>UNKNOWN / NOT AVAILABLE</p>';
    const p=d.payne||{};
    q('#features').innerHTML='<p class="source">DERIVED PAYNE DATA</p><p>MOVE: <b>'+val(p.move)+'</b><br>FAIR: <b>'+val(p.fair)+'</b><br>EDGE: <b>'+val(p.edge)+'</b><br>SCORE: <b>'+val(p.score)+'</b><br>PAYNE STATE: <b>'+val(p.state)+'</b></p><p class="muted">'+val(p.reason)+'</p>';
    const x=d.pipeline||{};
    q('#pipeline').innerHTML=step('RADAR',x.radar)+step('LOCK IN',x.lockIn)+step('PULL TRIGGER',x.pullTrigger)+step('REAL ELIGIBILITY',x.realEligibility?.executionEligible)+step('6.5-MIN TIME GATE',x.timeGate6_5m)+step('FRESH EXACT-TICKER LOCK',x.freshLock)+step('PRE-SUBMIT READ',x.preSubmit)+step('TICKER CONSISTENCY',x.tickerConsistent)+step('FEE-SAFE SIZING',x.feeSafeSizing)+step('IOC PAYLOAD',x.iocPayload)+step('INDEX-3 FUNDING GATE',x.fundingGate?.result)+step('PROVIDER POST',x.providerPost);
    const a=d.observations||{};
    q('#reads').innerHTML='<p>INITIAL: <code>'+val(a.initial?.ticker)+'</code></p><p>FRESH LOCK: <b class="'+cls(a.freshLock?.ok?'PROVEN':'NOT_PROVEN')+'">'+(a.freshLock?.ok?'PROVEN':'NOT_PROVEN')+'</b><br>Read: '+val(a.freshLock?.readAt)+'<br>HTTP: '+val(a.freshLock?.httpStatus)+'<br>Ticker: <code>'+val(a.freshLock?.market?.ticker)+'</code></p><p>PRE-SUBMIT: <b class="'+cls(a.preSubmit?.ok?'PROVEN':'NOT_PROVEN')+'">'+(a.preSubmit?.ok?'PROVEN':'NOT_PROVEN')+'</b><br>Read: '+val(a.preSubmit?.readAt)+'<br>HTTP: '+val(a.preSubmit?.httpStatus)+'<br>Ticker: <code>'+val(a.preSubmit?.market?.ticker)+'</code></p>';
    q('#fire').innerHTML='<p>PREVIEW: <b>'+val(d.zeroMoneyPreview)+'</b></p><p>PAYNE qualification is not fabricated when live move/fair/edge/score are unavailable.</p><p class="bad"><b>PROVIDER POST: HARD DISABLED</b></p><p>providerWrites = 0 · orders = 0 · capital moved = $0</p>';
  }catch(e){q('#status').textContent='Cockpit read failed: '+e.name;}
}
q('#refresh').addEventListener('click',load);
load();
setInterval(load,60000);
</script>
</body></html>\`;
}

export function step1Status() {
  return {
    service:SERVICE_ID,
    mode:'ZERO-MONEY / GET-ONLY',
    stateBinding:STATE_BINDING,
    defaultState:defaultControlState(),
    providerWrites:0,
    providerWriteAuthority:'DISABLED',
    realExecution:'DISABLED',
    fundingAuthority:'DISABLED',
    index3:'UNKNOWN',
    secondIoc:'HOLD_UNCHANGED',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return Response.json({ ok:false, reason:'GET_ONLY' }, { status:405 });
    if (url.pathname === '/status') return Response.json(step1Status());
    if (url.pathname === '/proof') {
      const provider = await kalshiReadOnlyProof(env);
      return Response.json({
        ...step1Status(),
        serviceLive:true,
        kv:{ binding:STATE_BINDING, connected:Boolean(env?.[STATE_BINDING]) },
        kalshi:provider,
      });
    }
    return Response.json({ ok:true, service:SERVICE_ID, mode:'ZERO-MONEY / GET-ONLY', armed:false, attempts:0, openPositions:0, threshold:PAYNE_CONFIG.defaultThreshold, providerWrites:0, providerWriteAuthority:'DISABLED', realExecution:'DISABLED', fundingAuthority:'DISABLED' });
  },
  async scheduled(controller, env) {
    await initializeDisarmed(env);
  },
};
