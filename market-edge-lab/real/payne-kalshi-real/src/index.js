import { kalshiReadOnlyProof, kalshiGetOnly } from './kalshi-get-only.js';
import { cockpitHtml } from './cockpit-html.js';

const SERVICE_ID = 'market-edge-payne-kalshi-real';
const STATE_BINDING = 'PAYNE_KALSHI_STATE';
const CONTROL_KEY = 'payne-kalshi:control:v1';
const CURRENT_KEY = 'payne-kalshi:current:v1';
const EVENT_PREFIX = 'payne-kalshi:event:';
const RUN_PREFIX = 'payne-kalshi:run:';
const ATTEMPT_PREFIX = 'payne-kalshi:attempt:';
const POSITION_PREFIX = 'payne-kalshi:position:';
const SCAN_HISTORY_PREFIX = 'payne-kalshi:scan-history:';
const SCAN_PERSIST_INTERVAL_MS = 60 * 1000;
const SCAN_HISTORY_INTERVAL_MS = 15 * 60 * 1000;
const CONTROL_THRESHOLD_OPTIONS = Object.freeze([0.70,0.75,0.80,0.85]);
const CONTROL_STAKE_OPTIONS = Object.freeze([1,2,5,10]);
const CONTROL_ATTEMPT_OPTIONS = Object.freeze([1,5,10,30]);
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
    maxPositions: 3,
    attemptTarget: 10,
    maxEntryDebitUsd: 1,
    activeThreshold: PAYNE_CONFIG.defaultThreshold,
    scanEnabled: true,
    scanCadenceMs: 60_000,
    providerWriteAuthority: 'DISABLED',
    providerPostAuthority: 'HELD',
    realExecution: 'DISABLED',
    fundingAuthority: 'DISABLED',
    requiredExchangeIndex: null,
    index3: 'UNKNOWN_UNPROVEN_DISABLED_UNFUNDED',
  };
}

function normalizeControlState(saved) {
  const base=defaultControlState();
  const src=saved&&typeof saved==='object'?saved:{};
  return {
    ...base,
    service:SERVICE_ID,
    armed:src.armed===true,
    attempts:Number.isFinite(Number(src.attempts))?Number(src.attempts):0,
    openPositions:Number.isFinite(Number(src.openPositions))?Number(src.openPositions):0,
    maxPositions:3,
    attemptTarget:CONTROL_ATTEMPT_OPTIONS.includes(Number(src.attemptTarget))?Number(src.attemptTarget):base.attemptTarget,
    maxEntryDebitUsd:CONTROL_STAKE_OPTIONS.includes(Number(src.maxEntryDebitUsd))?Number(src.maxEntryDebitUsd):base.maxEntryDebitUsd,
    activeThreshold:CONTROL_THRESHOLD_OPTIONS.includes(Number(src.activeThreshold))?Number(src.activeThreshold):base.activeThreshold,
    scanEnabled:src.scanEnabled!==false,
    scanCadenceMs:60_000,
    providerWriteAuthority:'DISABLED',
    providerPostAuthority:'HELD',
    realExecution:'DISABLED',
    fundingAuthority:'DISABLED',
    requiredExchangeIndex:null,
    index3:src.index3||base.index3,
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
  return normalizeControlState(saved);
}

export async function initializeDisarmed(env) {
  const existing = await kvGetJson(env, CONTROL_KEY);
  if (existing) return normalizeControlState(existing);
  const state = defaultControlState();
  await kvPutJson(env, CONTROL_KEY, state);
  await appendEvent(env, 'CONTROL_INITIALIZED', { armed:false, attempts:0, openPositions:0 });
  return state;
}

export async function updateFounderControl(env, action, rawValue = null) {
  const before=await loadControl(env);
  const next={...before};
  const name=String(action||'').toUpperCase();
  if (name==='ARM') next.armed=true;
  else if (name==='DISARM') next.armed=false;
  else if (name==='SET_THRESHOLD') {
    const value=Number(rawValue);
    if (!CONTROL_THRESHOLD_OPTIONS.includes(value)) throw new Error('PAYNE_CONTROL_THRESHOLD_NOT_ALLOWED');
    next.activeThreshold=value;
  } else if (name==='SET_STAKE') {
    const value=Number(rawValue);
    if (!CONTROL_STAKE_OPTIONS.includes(value)) throw new Error('PAYNE_CONTROL_STAKE_NOT_ALLOWED');
    next.maxEntryDebitUsd=value;
  } else if (name==='SET_ATTEMPT_TARGET') {
    const value=Number(rawValue);
    if (!CONTROL_ATTEMPT_OPTIONS.includes(value)) throw new Error('PAYNE_CONTROL_ATTEMPT_TARGET_NOT_ALLOWED');
    next.attemptTarget=value;
  } else if (name==='SET_SCAN_ENABLED') {
    next.scanEnabled=rawValue===true || String(rawValue).toLowerCase()==='true';
  } else {
    throw new Error('PAYNE_CONTROL_ACTION_NOT_ALLOWED');
  }
  next.providerWriteAuthority='DISABLED';
  next.providerPostAuthority='HELD';
  next.realExecution='DISABLED';
  next.fundingAuthority='DISABLED';
  next.requiredExchangeIndex=null;
  await kvPutJson(env,CONTROL_KEY,next);
  await appendEvent(env,'FOUNDER_CONTROL_CHANGED',{
    action:name,
    armed:next.armed,
    activeThreshold:next.activeThreshold,
    maxEntryDebitUsd:next.maxEntryDebitUsd,
    attemptTarget:next.attemptTarget,
    scanEnabled:next.scanEnabled,
    providerWriteAuthority:'DISABLED',
    providerPostAuthority:'HELD',
    realExecution:'DISABLED',
    fundingAuthority:'DISABLED',
  });
  return next;
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
const BASELINE_SERVICE_BINDING = 'BASELINE_REAL_READ';
const BASELINE_SHADOW_STATE_PATH = '/shadow-state';
const BASELINE_FEATURE_MAX_AGE_MS = 120_000;
const KALSHI_15M_SERIES = Object.freeze([
  {asset:'BTC', seriesTicker:'KXBTC15M'},
  {asset:'ETH', seriesTicker:'KXETH15M'},
  {asset:'SOL', seriesTicker:'KXSOL15M'},
  {asset:'XRP', seriesTicker:'KXXRP15M'},
  {asset:'HYPE', seriesTicker:'KXHYPE15M'},
  {asset:'ZEC', seriesTicker:'KXZEC15M'},
  {asset:'DOGE', seriesTicker:'KXDOGE15M'},
  {asset:'BNB', seriesTicker:'KXBNB15M'},
  {asset:'NEAR', seriesTicker:'KXNEAR15M'},
]);

function normalizeProviderProbability(value) {
  if (value === null || value === undefined || value === '') return null;
  const n=Number(value);
  if (!Number.isFinite(n)) return null;
  if (n>=0 && n<=1) return n;
  if (n>=0 && n<=100) return n/100;
  return null;
}

function marketAsset(market, assetHint = null) {
  if (PAYNE_CONFIG.executableAssets.includes(assetHint)) return assetHint;
  const text=[market?.ticker,market?.series_ticker,market?.seriesTicker,market?.title,market?.subtitle]
    .filter(Boolean).join(' ').toUpperCase();
  const aliases={
    BTC:['BTC','BITCOIN'],ETH:['ETH','ETHEREUM'],SOL:['SOL','SOLANA'],
    XRP:['XRP','RIPPLE'],HYPE:['HYPE','HYPERLIQUID'],ZEC:['ZEC','ZCASH'],
    DOGE:['DOGE','DOGECOIN'],BNB:['BNB'],NEAR:['NEAR'],
  };
  for (const asset of PAYNE_CONFIG.executableAssets) {
    if ((aliases[asset]||[asset]).some(alias=>new RegExp('(^|[^A-Z])'+alias+'([^A-Z]|$)').test(text))) return asset;
  }
  return null;
}

export function providerMarketSnapshot(market, nowMs = Date.now(), assetHint = null, providerReadAt = null) {
  const ticker=String(market?.ticker||market?.market_ticker||'').trim();
  const closeTime=market?.close_time||market?.closeTime||null;
  const closeMs=Date.parse(closeTime||'');
  const openMs=Date.parse(market?.open_time||market?.openTime||'');
  const durationMs=Number.isFinite(openMs)&&Number.isFinite(closeMs)?closeMs-openMs:null;
  const readAt=providerReadAt||new Date(nowMs).toISOString();
  return {
    source:'LIVE_PROVIDER_DATA',
    asset:marketAsset(market,assetHint),
    direction:null,
    outcomeSide:null,
    ticker,
    seriesTicker:market?.series_ticker||market?.seriesTicker||null,
    title:market?.title||market?.subtitle||ticker||'UNKNOWN',
    subtitle:market?.subtitle||null,
    status:market?.status||null,
    yesAsk:normalizeProviderProbability(market?.yes_ask_dollars??market?.yes_ask),
    yesBid:normalizeProviderProbability(market?.yes_bid_dollars??market?.yes_bid),
    noAsk:normalizeProviderProbability(market?.no_ask_dollars??market?.no_ask),
    noBid:normalizeProviderProbability(market?.no_bid_dollars??market?.no_bid),
    closeTime,
    openTime:market?.open_time||market?.openTime||null,
    durationMs,
    timeRemainingMs:Number.isFinite(closeMs)?Math.max(0,closeMs-nowMs):null,
    providerReadAt:readAt,
    executionEligible:market?.status ? ['open','active'].includes(String(market.status).toLowerCase()) : null,
  };
}

async function safeProviderJson(response) {
  try { return await response.json(); } catch { return {}; }
}

export async function discoverCockpitMarkets(env, { nowMs=Date.now() } = {}) {
  const results=await Promise.all(KALSHI_15M_SERIES.map(async spec=>{
    const path='/trade-api/v2/markets?series_ticker='+encodeURIComponent(spec.seriesTicker)+'&status=open&limit=20';
    try {
      const response=await kalshiGetOnly(env,path);
      const readAt=new Date().toISOString();
      const body=await safeProviderJson(response);
      const rows=Array.isArray(body?.markets)?body.markets:[];
      if (!response.ok) {
        return {asset:spec.asset,seriesTicker:spec.seriesTicker,path,httpStatus:response.status,ok:false,markets:[],error:'MARKETS_READ_FAILED_'+response.status};
      }
      const markets=rows.map(raw=>providerMarketSnapshot(raw,nowMs,spec.asset,readAt))
        .filter(m=>{
          const closeMs=Date.parse(m.closeTime||'');
          const freshnessMs=Number.isFinite(closeMs)?closeMs-nowMs:NaN;
          return Boolean(
            m.ticker &&
            m.asset===spec.asset &&
            ['open','active'].includes(String(m.status||'').toLowerCase()) &&
            Number.isFinite(freshnessMs) &&
            freshnessMs>0 &&
            freshnessMs<=20*60_000
          );
        })
        .sort((a,b)=>Number(a.timeRemainingMs??Infinity)-Number(b.timeRemainingMs??Infinity));
      return {asset:spec.asset,seriesTicker:spec.seriesTicker,path,httpStatus:response.status,ok:true,markets,error:null};
    } catch (error) {
      return {asset:spec.asset,seriesTicker:spec.seriesTicker,path,httpStatus:null,ok:false,markets:[],error:String(error?.name||'READ_FAILED')};
    }
  }));
  const markets=results.flatMap(x=>x.markets.slice(0,1));
  return {
    ok:results.some(x=>x.ok),
    providerGets:results.length,
    markets,
    assets:results.map(x=>({
      asset:x.asset,
      seriesTicker:x.seriesTicker,
      ok:x.ok,
      httpStatus:x.httpStatus,
      currentContractCount:x.markets.length,
      error:x.error,
    })),
    source:'BASELINE_SERIES_SCOPED_KALSHI_DISCOVERY',
  };
}

function providerIndex3Evidence(balanceBody) {
  const rows=Array.isArray(balanceBody?.balance_breakdown)?balanceBody.balance_breakdown:null;
  if (!rows) return {status:'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT',balance:null};
  const row=rows.find(x=>Number(x?.exchange_index)===3);
  if (!row) return {status:'READ-PROVEN UNAVAILABLE',balance:null};
  const balance=Number(row?.balance);
  return {status:'READ-PROVEN AVAILABLE',balance:Number.isFinite(balance)?balance:null};
}

async function exactMarketRead(env, ticker, assetHint = null) {
  const path='/trade-api/v2/markets/'+encodeURIComponent(ticker);
  const response=await kalshiGetOnly(env,path);
  const readAt=new Date().toISOString();
  const body=await safeProviderJson(response);
  const market=body?.market||body;
  return {
    ok:response.ok,
    httpStatus:response.status,
    path,
    readAt,
    market:response.ok?providerMarketSnapshot(market,Date.now(),assetHint,readAt):null,
  };
}

async function baselineReadOnlyPath(env, path) {
  const service=env?.[BASELINE_SERVICE_BINDING];
  if (!service || typeof service.fetch!=='function') {
    return {ok:false,status:null,body:{},error:'BASELINE_REAL_SERVICE_BINDING_UNBOUND'};
  }
  if (!['/shadow-state','/execution-test-state'].includes(String(path||''))) {
    return {ok:false,status:null,body:{},error:'BASELINE_READ_PATH_NOT_ALLOWED'};
  }
  try {
    const request=new Request('https://market-edge-baseline-real.internal'+path,{
      method:'GET',
      headers:{accept:'application/json','cache-control':'no-cache'},
    });
    const response=await service.fetch(request);
    const body=await safeProviderJson(response);
    return {ok:response.ok,status:response.status,body,error:response.ok?null:'BASELINE_READ_FAILED_'+response.status};
  } catch (error) {
    return {ok:false,status:null,body:{},error:String(error?.name||'BASELINE_SERVICE_READ_FAILED')};
  }
}

async function baselineShadowRead(env) {
  return baselineReadOnlyPath(env,BASELINE_SHADOW_STATE_PATH);
}

export async function readAuthoritativePayneFeatures(env, nowMs = Date.now()) {
  const read=await baselineShadowRead(env);
  const body=read.body||{};
  const lastRunAt=body?.lastRunAt||body?.lastSuccessfulObservationAt||null;
  const observedMs=Date.parse(lastRunAt||'');
  const ageMs=Number.isFinite(observedMs)?Math.max(0,nowMs-observedMs):null;
  const fresh=Boolean(
    read.ok &&
    body?.mode==='REAL_KALSHI_SHADOW' &&
    ageMs!==null &&
    ageMs<=BASELINE_FEATURE_MAX_AGE_MS
  );
  return {
    ok:read.ok,
    source:'BASELINE_REAL_SERVICE_BINDING_READ_ONLY',
    transport:'SERVICE_BINDING',
    binding:BASELINE_SERVICE_BINDING,
    endpoint:BASELINE_SHADOW_STATE_PATH,
    httpStatus:read.status,
    lastRunAt,
    ageMs,
    fresh,
    status:body?.status||null,
    startedAt:body?.startedAt||null,
    priceSources:body?.priceSources||{},
    opportunities:Array.isArray(body?.opportunities)?body.opportunities:[],
    error:fresh?null:(read.error||(read.ok?'BASELINE_SHADOW_NOT_FRESH':'BASELINE_SHADOW_READ_FAILED')),
  };
}

export function payneDecisionEvidence(candidate, activeThreshold = PAYNE_CONFIG.defaultThreshold) {
  const score=Number(candidate?.score), edge=Number(candidate?.edge), move=Number(candidate?.move);
  if (![score,edge,move].every(Number.isFinite)) {
    return {radar:'UNKNOWN',lock:'UNKNOWN',pull:'UNKNOWN',decision:'FEATURES_UNAVAILABLE'};
  }
  const radar=score>=PAYNE_CONFIG.radarScore;
  if (!radar) return {radar:'RADAR_REJECT',lock:'LOCK_NOT_REACHED',pull:'PULL_NOT_REACHED',decision:'RADAR_REJECT_SCORE_BELOW_0_50'};
  const scoreLock=score>=PAYNE_CONFIG.lockScore;
  const edgeLock=edge>0;
  if (!scoreLock) return {radar:'RADAR_PASS',lock:'LOCK_REJECT',pull:'PULL_NOT_REACHED',decision:'LOCK_REJECT_SCORE_BELOW_0_65'};
  if (!edgeLock) return {radar:'RADAR_PASS',lock:'LOCK_REJECT',pull:'PULL_NOT_REACHED',decision:'LOCK_REJECT_EDGE_NOT_POSITIVE'};
  const threshold=Number(activeThreshold);
  if (score<threshold) return {radar:'RADAR_PASS',lock:'LOCK_PASS',pull:'PULL_REJECTED',decision:'PULL_REJECTED_SCORE_BELOW_THRESHOLD'};
  if (Math.abs(move)<PAYNE_CONFIG.minAbsMove) return {radar:'RADAR_PASS',lock:'LOCK_PASS',pull:'PULL_REJECTED',decision:'PULL_REJECTED_MOVE_BELOW_0_002'};
  return {radar:'RADAR_PASS',lock:'LOCK_PASS',pull:'PULL_QUALIFIED',decision:'PULL_QUALIFIED'};
}

function featureForCandidate(featureState, ticker, outcomeSide, asset, activeThreshold) {
  if (!featureState?.fresh) {
    return {
      source:featureState?.source||'BASELINE_REAL_SERVICE_BINDING_READ_ONLY',
      available:false,
      move:null,fair:null,edge:null,score:null,
      state:'UNKNOWN',
      reason:featureState?.error||'AUTHORITATIVE_LIVE_PAYNE_FEATURE_SOURCE_NOT_AVAILABLE',
      sourceLastRunAt:featureState?.lastRunAt||null,
      sourceAgeMs:featureState?.ageMs??null,
      underlyingPriceSource:featureState?.priceSources?.[asset]||null,
      baselineOpenTime:null,baselineCloseTime:null,baselineDurationMs:null,baselineHorizon:null,
    };
  }
  const row=(featureState.opportunities||[]).find(o=>
    String(o?.marketTicker||o?.slug||'')===String(ticker||'') &&
    String(o?.outcomeSide||'').toUpperCase()===String(outcomeSide||'').toUpperCase()
  );
  const has=(key)=>row?.[key]!==null && row?.[key]!==undefined && Number.isFinite(Number(row[key]));
  if (!row || !['move','fair','edge','score'].every(has)) {
    return {
      source:featureState?.source||'BASELINE_REAL_SERVICE_BINDING_READ_ONLY',
      available:false,
      move:null,fair:null,edge:null,score:null,
      state:'UNKNOWN',
      reason:'EXACT_TICKER_SIDE_FEATURE_NOT_PRESENT_IN_BASELINE_SHADOW',
      sourceLastRunAt:featureState.lastRunAt,
      sourceAgeMs:featureState.ageMs,
      underlyingPriceSource:featureState?.priceSources?.[asset]||null,
      baselineOpenTime:null,baselineCloseTime:null,baselineDurationMs:null,baselineHorizon:null,
    };
  }
  const move=Number(row.move), fair=Number(row.fair), edge=Number(row.edge), score=Number(row.score);
  const gate=payneStage({move,fair,edge,score},activeThreshold);
  return {
    source:featureState?.source||'BASELINE_REAL_SERVICE_BINDING_READ_ONLY',
    available:true,
    move,fair,edge,score,
    state:gate.pullTrigger?'PULL_TRIGGER':gate.lockIn?'LOCK_IN':gate.radar?'RADAR':'NOT_QUALIFIED',
    reason:null,
    direction:row?.direction||null,
    outcomeSide:row?.outcomeSide||outcomeSide||null,
    sourceLastRunAt:featureState.lastRunAt,
    sourceAgeMs:featureState.ageMs,
    underlyingPriceSource:featureState?.priceSources?.[asset]||null,
    baselineOpenTime:row?.openTime||null,
    baselineCloseTime:row?.closeTime||row?.expectedExpirationTime||row?.expirationTime||null,
    baselineDurationMs:Number.isFinite(Number(row?.durationMs))?Number(row.durationMs):null,
    baselineHorizon:row?.horizon||null,
  };
}

function buildCandidateViews(markets, featureState, activeThreshold) {
  const out=[];
  for (const market of markets||[]) {
    for (const side of ['YES','NO']) {
      const feature=featureForCandidate(featureState,market.ticker,side,market.asset,activeThreshold);
      const decision=payneDecisionEvidence(feature,activeThreshold);
      out.push({
        ...market,
        outcomeSide:side,
        direction:side==='YES'?'UP':'DOWN',
        selectedBid:side==='YES'?market.yesBid:market.noBid,
        selectedAsk:side==='YES'?market.yesAsk:market.noAsk,
        payne:feature,
        decision,
      });
    }
  }
  return out.sort((a,b)=>{
    const av=a.payne?.available?1:0, bv=b.payne?.available?1:0;
    if (av!==bv) return bv-av;
    const as=Number(a.payne?.score), bs=Number(b.payne?.score);
    if (Number.isFinite(as)&&Number.isFinite(bs)&&as!==bs) return bs-as;
    return Number(a.timeRemainingMs??Infinity)-Number(b.timeRemainingMs??Infinity);
  });
}

async function readBaselineActualComparison(env, selected) {
  const read=await baselineReadOnlyPath(env,'/execution-test-state');
  const body=read.body||{};
  if (!read.ok) {
    return {
      source:'BASELINE_REAL_EXECUTION_TEST_READ_ONLY',
      lane:'EXECUTION_TEST_NOT_PRODUCTION_BASELINE',
      available:false,
      reason:read.error||'BASELINE_EXECUTION_TEST_READ_FAILED',
      sawMatchingContract:'UNKNOWN',
      sameTicker:'UNKNOWN',
      sameDirection:'UNKNOWN',
      attempted:'UNKNOWN',
      filled:'UNKNOWN',
      fireTime:null,
      fillTime:null,
      entryPrice:null,
      score:null,
    };
  }
  const state=body?.state||{};
  const ticker=String(selected?.ticker||'');
  const side=String(selected?.outcomeSide||'').toUpperCase();
  const attempts=Array.isArray(state?.attempts)?state.attempts:[];
  const positions=Array.isArray(state?.positions)?state.positions:[];
  const attempt=attempts.find(a=>String(a?.ticker||'')===ticker && String(a?.side||'').toUpperCase()===side)||null;
  const position=positions.find(p=>String(p?.ticker||'')===ticker && String(p?.side||'').toUpperCase()===side)||null;
  const filled=Boolean(position && Number(position?.filledCount||0)>0);
  return {
    source:'BASELINE_REAL_EXECUTION_TEST_READ_ONLY',
    lane:String(body?.mode||'EXECUTION_TEST_NOT_PRODUCTION_BASELINE'),
    available:true,
    sourceHttpStatus:read.status,
    seriesId:state?.seriesId||null,
    sawMatchingContract:Boolean(attempt||position),
    sameTicker:attempt||position?true:false,
    sameDirection:attempt||position?true:false,
    attempted:Boolean(attempt),
    attemptStatus:attempt?.status||null,
    filled,
    fireTime:null,
    fireTimeReason:'NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE',
    fillTime:position?.filledAt||null,
    entryPrice:position?.entryAverageFillPrice??null,
    score:attempt?.liveScore??attempt?.observedScore??position?.entryScore??null,
    orderId:position?.entryOrderId||attempt?.orderId||null,
    filledCount:position?.filledCount??attempt?.fillCount??0,
    finalResult:position?.status||null,
    exitReason:position?.exitReason||null,
    closedAt:position?.closedAt||null,
  };
}

function paynePaperComparisonUnavailable() {
  return {
    source:'PAYNE_PAPER',
    available:false,
    reason:'READ_ONLY_AUTHORITATIVE_EVENT_SOURCE_NOT_EXPOSED_TO_PAYNE_KALSHI_REAL',
    sawMatchingContract:'UNKNOWN',
    sameTicker:'UNKNOWN',
    sameDirection:'UNKNOWN',
    observedAt:null,
    fireTime:null,
    entryPrice:null,
    score:null,
    finalResult:null,
  };
}

function buildResearchComparison(selected, payne, zeroMoneyPreview, baselineActual, clocks) {
  const wouldFire=zeroMoneyPreview?.status==='FIRE_READY';
  return {
    schema:'PAYNE_CROSS_SYSTEM_COMPARISON_V1',
    payne:{
      sawContract:Boolean(selected?.ticker),
      ticker:selected?.ticker||null,
      asset:selected?.asset||null,
      direction:selected?.direction||null,
      outcomeSide:selected?.outcomeSide||null,
      score:payne?.score??null,
      state:payne?.state||'UNKNOWN',
      observedAt:clocks?.payne?.observationAt||null,
      wouldFire,
      wouldFireAt:wouldFire?(clocks?.consistency?.preSubmitAt||clocks?.payne?.observationAt||null):null,
      entryPrice:wouldFire?zeroMoneyPreview?.preSubmitPrice??null:null,
      windowClose:clocks?.kalshi?.currentWindowClose||null,
      timeRemainingMs:clocks?.kalshi?.remainingMs??null,
    },
    baselineReal:baselineActual,
    paynePaper:paynePaperComparisonUnavailable(),
  };
}

function decisionEventClass(decision, isSelected, finalDecision) {
  if (isSelected && finalDecision==='PULL_QUALIFIED_ZERO_MONEY_FIRE_READY') return 'WOULD_FIRE';
  if (isSelected && ['FRESH_LOCK_INVALIDATED','PRE_SUBMIT_INVALIDATED','WINDOW_MISMATCH','TIME_GATE_REJECT'].includes(finalDecision)) return 'REJECT';
  if (decision?.pull==='PULL_QUALIFIED') return 'PULL';
  if (decision?.lock==='LOCK_PASS') return 'LOCK';
  if (decision?.radar==='RADAR_PASS') return 'RADAR';
  return 'REJECT';
}

function incrementResearchCounters(previous, snapshot) {
  const prev=previous?.researchCounters||{};
  const decisions=Array.isArray(snapshot?.decisions)?snapshot.decisions:[];
  const finalDecision=snapshot?.pipeline?.finalDecision||null;
  const next={
    observationsCollected:Number(prev.observationsCollected||0)+1,
    contractsExamined:Number(prev.contractsExamined||0)+decisions.length,
    radarCount:Number(prev.radarCount||0)+decisions.filter(x=>x?.decision?.radar==='RADAR_PASS').length,
    lockCount:Number(prev.lockCount||0)+decisions.filter(x=>x?.decision?.lock==='LOCK_PASS').length,
    pullCount:Number(prev.pullCount||0)+decisions.filter(x=>x?.decision?.pull==='PULL_QUALIFIED').length,
    wouldFireCount:Number(prev.wouldFireCount||0)+(snapshot?.zeroMoneyPreview?.status==='FIRE_READY'?1:0),
    rejectCount:Number(prev.rejectCount||0)+decisions.filter(x=>decisionEventClass(x?.decision,false,null)==='REJECT').length,
    freshLockInvalidations:Number(prev.freshLockInvalidations||0)+(finalDecision==='FRESH_LOCK_INVALIDATED'?1:0),
    preSubmitInvalidations:Number(prev.preSubmitInvalidations||0)+(finalDecision==='PRE_SUBMIT_INVALIDATED'?1:0),
    windowMismatches:Number(prev.windowMismatches||0)+(finalDecision==='WINDOW_MISMATCH'?1:0),
    baselineActualMatches:Number(prev.baselineActualMatches||0)+(snapshot?.comparison?.baselineReal?.sawMatchingContract===true?1:0),
    baselineActualFills:Number(prev.baselineActualFills||0)+(snapshot?.comparison?.baselineReal?.filled===true?1:0),
    paynePaperMatches:Number(prev.paynePaperMatches||0)+(snapshot?.comparison?.paynePaper?.sawMatchingContract===true?1:0),
    unknownPaperComparisons:Number(prev.unknownPaperComparisons||0)+(snapshot?.comparison?.paynePaper?.available===false?1:0),
  };
  return next;
}

function universalClockEvidence(selected, payne, freshLock, preSubmit, observedAtMs) {
  const observationAt=new Date(observedAtMs).toISOString();
  const kalshiOpenMs=Date.parse(selected?.openTime||'');
  const kalshiCloseMs=Date.parse(selected?.closeTime||'');
  const baselineOpenMs=Date.parse(payne?.baselineOpenTime||'');
  const baselineCloseMs=Date.parse(payne?.baselineCloseTime||'');
  const baselineObservationMs=Date.parse(payne?.sourceLastRunAt||'');
  const hasKalshiWindow=Number.isFinite(kalshiOpenMs)&&Number.isFinite(kalshiCloseMs);
  const hasBaselineWindow=Number.isFinite(baselineOpenMs)&&Number.isFinite(baselineCloseMs);
  const closeConsistent=hasKalshiWindow&&hasBaselineWindow?kalshiCloseMs===baselineCloseMs:null;
  const openConsistent=hasKalshiWindow&&hasBaselineWindow?kalshiOpenMs===baselineOpenMs:null;
  const windowConsistency=closeConsistent===null||openConsistent===null?'UNKNOWN':(closeConsistent&&openConsistent);
  const elapsedMs=hasKalshiWindow?Math.max(0,observedAtMs-kalshiOpenMs):null;
  const durationMs=hasKalshiWindow?Math.max(0,kalshiCloseMs-kalshiOpenMs):null;
  const remainingMs=hasKalshiWindow?Math.max(0,kalshiCloseMs-observedAtMs):null;
  const lifecycleFraction=durationMs>0?Math.min(1,Math.max(0,elapsedMs/durationMs)):null;
  const observationDeltaMs=Number.isFinite(baselineObservationMs)?observedAtMs-baselineObservationMs:null;
  return {
    standard:'NFE_OS_UNIVERSAL_MARKET_CLOCK_V1',
    providerWindowIdentity:selected?.ticker||null,
    kalshiTicker:selected?.ticker||null,
    kalshiWindowOpen:selected?.openTime||null,
    kalshiWindowClose:selected?.closeTime||null,
    baselineWindowOpen:payne?.baselineOpenTime||null,
    baselineWindowClose:payne?.baselineCloseTime||null,
    payneAssociatedWindowClose:selected?.closeTime||null,
    windowConsistency,
    diagnostic:windowConsistency===false?'WINDOW_MISMATCH':windowConsistency==='UNKNOWN'?'WINDOW_CONSISTENCY_UNKNOWN':'WINDOW_CONSISTENT',
    observationAt,
    observationAgeMs:0,
    baselineObservationAt:payne?.sourceLastRunAt||null,
    baselineToPayneObservationDeltaMs:observationDeltaMs,
    kalshiWindowElapsedMs:elapsedMs,
    kalshiWindowRemainingMs:remainingMs,
    kalshiWindowDurationMs:durationMs,
    kalshiLifecycleFraction:lifecycleFraction,
    freshLockAt:freshLock?.readAt||null,
    preSubmitAt:preSubmit?.readAt||null,
  };
}

function zeroMoneyPreviewFor(selected, preSubmit, index3, control, nowMs) {
  if (!selected?.payne?.available) return {status:'NOT_REACHED',reason:'AUTHORITATIVE_PAYNE_FEATURES_UNAVAILABLE'};
  const selectedCloseMs=Date.parse(selected?.closeTime||'');
  const baselineCloseMs=Date.parse(selected?.payne?.baselineCloseTime||'');
  const selectedOpenMs=Date.parse(selected?.openTime||'');
  const baselineOpenMs=Date.parse(selected?.payne?.baselineOpenTime||'');
  if (Number.isFinite(selectedCloseMs) && Number.isFinite(baselineCloseMs) && selectedCloseMs!==baselineCloseMs) {
    return {status:'BLOCKED',reason:'WINDOW_MISMATCH',windowConsistency:false};
  }
  if (Number.isFinite(selectedOpenMs) && Number.isFinite(baselineOpenMs) && selectedOpenMs!==baselineOpenMs) {
    return {status:'BLOCKED',reason:'WINDOW_MISMATCH',windowConsistency:false};
  }
  const gate=payneStage(selected.payne,control.activeThreshold);
  if (!gate.pullTrigger) return {status:'NOT_REACHED',reason:'PAYNE_NOT_PULL_TRIGGER',gate};
  const eligibility=realEligibility({
    asset:selected.asset,
    executionEligible:selected.executionEligible,
    closeTime:selected.closeTime,
    marketTicker:selected.ticker,
  },nowMs);
  if (!eligibility.assetAllowed || !eligibility.executionEligible || !eligibility.timeSafe || !eligibility.tickerPresent) {
    return {status:'BLOCKED',reason:'REAL_ELIGIBILITY_GATE',gate,eligibility};
  }
  if (!preSubmit?.ok || preSubmit?.market?.ticker!==selected.ticker) {
    return {status:'BLOCKED',reason:'PRE_SUBMIT_NOT_PROVEN',gate,eligibility};
  }
  const ask=selected.outcomeSide==='YES'?Number(preSubmit.market.yesAsk):Number(preSubmit.market.noAsk);
  const sizing=estimateKalshiFeeSafeSize(ask,control.maxEntryDebitUsd);
  if (!sizing.ok) return {status:'BLOCKED',reason:'FEE_SAFE_SIZING_FAILED',gate,eligibility,sizing};
  const clientOrderId=payneClientOrderId('cockpit-zero-money',1,'entry');
  const payload=kalshiV2EntryPayload({
    marketTicker:selected.ticker,
    outcomeSide:selected.outcomeSide,
    yes:ask,
  },sizing,clientOrderId);
  if (!payload) return {status:'BLOCKED',reason:'IOC_PAYLOAD_INVALID',gate,eligibility,sizing};
  const funding=fundingGate({...control,requiredExchangeIndex:index3?.status==='READ-PROVEN AVAILABLE'?3:null});
  const stop=hardStopBeforeProviderPost({
    ticker:selected.ticker,
    stage:gate.stage,
    sizing,
    clientOrderId,
    entryPayload:payload,
    index3,
    funding,
  });
  return {
    status:'FIRE_READY',
    authority:'PROVIDER_POST_HELD',
    gate,
    eligibility,
    ticker:selected.ticker,
    asset:selected.asset,
    outcomeSide:selected.outcomeSide,
    direction:selected.direction,
    score:selected.payne.score,
    initialPrice:selected.selectedAsk,
    freshLockPrice:selected.outcomeSide==='YES'?preSubmit?.market?.yesAsk:preSubmit?.market?.noAsk,
    preSubmitPrice:ask,
    maxEntryDebitUsd:control.maxEntryDebitUsd,
    count:sizing.count,
    premiumUsd:sizing.premiumUsd,
    estimatedFeeUsd:sizing.feeUsd,
    estimatedDebitUsd:sizing.totalDebitUsd,
    timeInForce:payload.time_in_force,
    postOnly:payload.post_only,
    reduceOnly:payload.reduce_only,
    clientOrderId,
    fundingEvidence:index3,
    fundingGate:funding.failClosed?'AUTHORITY_HELD':'PASS',
    providerPost:stop.reason,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
  };
}

async function listPositionSnapshots(env) {
  const kv=binding(env);
  if (typeof kv.list!=='function') return [];
  const listed=await kv.list({prefix:POSITION_PREFIX});
  const rows=[];
  for (const item of listed?.keys||[]) {
    const value=await kvGetJson(env,item.name);
    if (value) rows.push(value);
  }
  return rows.sort((a,b)=>Date.parse(b?.updatedAt||b?.openedAt||b?.createdAt||0)-Date.parse(a?.updatedAt||a?.openedAt||a?.createdAt||0));
}

function managementView(control, positions) {
  const current=(positions||[]).find(p=>['OPEN','EXIT_RETRY'].includes(String(p?.status||'').toUpperCase()))||null;
  return {
    rules:{scoreExit:PAYNE_CONFIG.exitScore,maxHoldMs:PAYNE_CONFIG.maxHoldMs,maxPositions:control.maxPositions,exitReduceOnly:true},
    activePositions:Number(control.openPositions||0),
    position:current?{
      status:current.status||null,
      ownershipState:current.owned===true?'OWNED':current.owned===false?'NOT_OWNED':'UNKNOWN',
      position_fp:current.position_fp??null,
      entryTime:current.openedAt||current.entryTime||null,
      currentScore:current.currentScore??null,
      currentMarketPrice:current.currentMarketPrice??null,
      exitReason:current.exitReason??null,
      reconciliationState:current.reconciliationState||current.reconciliationClassification||'UNKNOWN',
      marketTicker:current.marketTicker||null,
      asset:current.asset||null,
      direction:current.direction||null,
      outcomeSide:current.outcomeSide||null,
      reduceOnlyExit:true,
    }:{
      status:'NO_OWNED_POSITION',
      ownershipState:'NONE',
      position_fp:null,
      entryTime:null,
      currentScore:null,
      currentMarketPrice:null,
      exitReason:null,
      reconciliationState:'FLAT / NO LOCAL OWNED POSITION',
      marketTicker:null,
      asset:null,
      direction:null,
      outcomeSide:null,
      reduceOnlyExit:true,
    },
  };
}

function compactObservation(data, source, atMs) {
  return {
    schema:'PAYNE_KALSHI_PRELIVE_OBSERVATION_V2',
    at:new Date(atMs).toISOString(),
    source,
    authentication:data.authentication,
    selected:data.selected?{
      asset:data.selected.asset,
      ticker:data.selected.ticker,
      direction:data.selected.direction,
      outcomeSide:data.selected.outcomeSide,
      selectedBid:data.selected.selectedBid,
      selectedAsk:data.selected.selectedAsk,
      openTime:data.selected.openTime||null,
      closeTime:data.selected.closeTime,
      payne:data.payne,
      decision:data.selected.decision||null,
      initialPrice:data.selected.selectedAsk??null,
      freshLockPrice:data.selected.outcomeSide==='YES'?data.observations?.freshLock?.market?.yesAsk??null:data.observations?.freshLock?.market?.noAsk??null,
      preSubmitPrice:data.selected.outcomeSide==='YES'?data.observations?.preSubmit?.market?.yesAsk??null:data.observations?.preSubmit?.market?.noAsk??null,
      freshLockAt:data.observations?.freshLock?.readAt||null,
      preSubmitAt:data.observations?.preSubmit?.readAt||null,
      clock:data.clocks?.consistency||null,
    }:null,
    decisions:(data.candidates||[]).map(c=>({
      asset:c.asset,ticker:c.ticker,direction:c.direction,outcomeSide:c.outcomeSide,
      contractOpenTime:c.openTime||null,contractCloseTime:c.closeTime||null,
      liveBid:c.selectedBid??null,liveAsk:c.selectedAsk??null,livePrice:c.selectedAsk??null,
      move:c.payne?.move??null,fair:c.payne?.fair??null,edge:c.payne?.edge??null,score:c.payne?.score??null,
      state:c.payne?.state||'UNKNOWN',decision:c.decision||null,
    })),
    pipeline:data.pipeline,
    clocks:data.clocks,
    comparison:data.comparison||null,
    zeroMoneyPreview:data.zeroMoneyPreview,
    assets:data.discovery?.assets||[],
    providerGets:data.providerGets,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
    control:{
      armed:data.control?.armed===true,
      activeThreshold:data.control?.threshold,
      maxEntryDebitUsd:data.control?.maxEntryDebitUsd,
      attemptTarget:data.control?.attemptTarget,
      scanEnabled:data.control?.scanEnabled,
    },
    safety:data.safety,
  };
}

export async function runReadOnlyScan(env, source='SCHEDULED_CRON', nowMs=Date.now()) {
  const control=await loadControl(env);
  if (!control.scanEnabled && source==='SCHEDULED_CRON') {
    return {ok:true,skipped:true,reason:'AUTO_SCAN_PAUSED',providerWrites:0,orders:0,capitalMovedUsd:0};
  }
  const data=await buildCockpitData(env,nowMs);
  const snapshot=compactObservation(data,source,nowMs);
  const previous=await kvGetJson(env,CURRENT_KEY);
  snapshot.researchCounters=incrementResearchCounters(previous,snapshot);
  const previousAt=Date.parse(previous?.at||'');
  const previousHistoryAt=Date.parse(previous?.lastHistoryAt||'');
  const prevKey=[previous?.selected?.ticker,previous?.selected?.outcomeSide,previous?.selected?.payne?.state].join('|');
  const nextKey=[snapshot?.selected?.ticker,snapshot?.selected?.outcomeSide,snapshot?.selected?.payne?.state].join('|');
  const transition=Boolean(previous && prevKey!==nextKey);
  const previewReady=snapshot?.zeroMoneyPreview?.status==='FIRE_READY';
  const persistLatest=true;
  const persistHistory=!previous || !Number.isFinite(previousHistoryAt) || nowMs-previousHistoryAt>=SCAN_HISTORY_INTERVAL_MS || transition || previewReady;
  if (persistHistory) snapshot.lastHistoryAt=snapshot.at;
  else snapshot.lastHistoryAt=previous?.lastHistoryAt||null;
  if (persistLatest) await kvPutJson(env,CURRENT_KEY,snapshot);
  if (persistHistory) {
    const historyKey=SCAN_HISTORY_PREFIX+snapshot.at+':'+crypto.randomUUID();
    await kvPutJson(env,historyKey,snapshot);
  }
  if (transition) {
    await appendEvent(env,'PAYNE_STATE_TRANSITION',{
      from:prevKey||null,
      to:nextKey||null,
      ticker:snapshot?.selected?.ticker||null,
      asset:snapshot?.selected?.asset||null,
      direction:snapshot?.selected?.direction||null,
      score:snapshot?.selected?.payne?.score??null,
    });
  }
  if (previewReady) {
    await appendEvent(env,'ZERO_MONEY_FIRE_PLAN_RECORDED',{
      ticker:snapshot.zeroMoneyPreview.ticker,
      asset:snapshot.zeroMoneyPreview.asset,
      direction:snapshot.zeroMoneyPreview.direction,
      score:snapshot.zeroMoneyPreview.score,
      count:snapshot.zeroMoneyPreview.count,
      estimatedDebitUsd:snapshot.zeroMoneyPreview.estimatedDebitUsd,
      providerPost:snapshot.zeroMoneyPreview.providerPost,
    });
  }
  const previousDecisionMap=new Map((previous?.decisions||[]).map(x=>[[x?.ticker,x?.outcomeSide].join('|'),x]));
  for (const d of snapshot.decisions||[]) {
    const key=[d?.ticker,d?.outcomeSide].join('|');
    const prior=previousDecisionMap.get(key);
    const isSelected=Boolean(snapshot?.selected?.ticker===d?.ticker && snapshot?.selected?.outcomeSide===d?.outcomeSide);
    const eventClass=decisionEventClass(d?.decision,isSelected,snapshot?.pipeline?.finalDecision);
    const signature=[eventClass,d?.decision?.decision,isSelected?snapshot?.pipeline?.finalDecision:null].join('|');
    const priorClass=prior?decisionEventClass(prior?.decision,Boolean(previous?.selected?.ticker===prior?.ticker&&previous?.selected?.outcomeSide===prior?.outcomeSide),previous?.pipeline?.finalDecision):null;
    const priorSignature=prior?[priorClass,prior?.decision?.decision,(previous?.selected?.ticker===prior?.ticker&&previous?.selected?.outcomeSide===prior?.outcomeSide)?previous?.pipeline?.finalDecision:null].join('|'):null;
    if (!prior || signature!==priorSignature) {
      await appendEvent(env,'OBSERVATION_DECISION_EVENT',{
        eventClass,
        ticker:d?.ticker||null,
        asset:d?.asset||null,
        direction:d?.direction||null,
        outcomeSide:d?.outcomeSide||null,
        score:d?.score??null,
        edge:d?.edge??null,
        move:d?.move??null,
        reason:isSelected?snapshot?.pipeline?.finalDecision||d?.decision?.decision:d?.decision?.decision||null,
        payneObservationAt:snapshot?.at||null,
        kalshiWindowClose:d?.contractCloseTime||null,
        timeRemainingMs:isSelected?snapshot?.clocks?.kalshi?.remainingMs??null:null,
        freshLockAt:isSelected?snapshot?.clocks?.consistency?.freshLockAt||null:null,
        preSubmitAt:isSelected?snapshot?.clocks?.consistency?.preSubmitAt||null:null,
        comparison:isSelected?snapshot?.comparison||null:null,
        providerWrites:0,
        orders:0,
        capitalMovedUsd:0,
      });
    }
  }
  return {
    ok:data.ok,
    skipped:false,
    persistedLatest:persistLatest,
    persistedHistory:persistHistory,
    transition,
    firePlanRecorded:previewReady,
    snapshot,
    providerGets:data.providerGets,
    baselineReads:data.baselineReads,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
  };
}


const EXPORT_ROW_FIELDS = Object.freeze([
  'observationAt','scanSource','asset','direction','outcomeSide','ticker','contractOpenTime','contractCloseTime',
  'liveBid','liveAsk','livePrice','move','fair','edge','score','payneState','radarResult','lockResult','pullResult',
  'decision','initialPrice','freshLockPrice','preSubmitPrice','timeGate','tickerConsistency','sideConsistency',
  'zeroMoneyFireStatus','zeroMoneyOrderCount','estimatedSizingUsd','providerGets','providerWrites','orders','capitalMovedUsd',
  'kalshiWindowStart','kalshiWindowClose','kalshiRemainingMs','kalshiNextResetAt',
  'baselineObservationAt','baselineWindowStart','baselineWindowClose','baselineRemainingMs','baselineNextResetAt',
  'payneObservationAt','payneObservationAgeMs','kalshiWindowElapsedMs','kalshiLifecycleFraction',
  'freshLockAt','preSubmitAt','windowConsistency','windowDiagnostic','baselineToPayneObservationDeltaMs',
  'baselineActualLane','baselineActualMatch','baselineAttempted','baselineFilled','baselineFillTime','baselineEntryPrice','baselineScore',
  'paynePaperComparisonStatus'
]);

function exportRangeBounds(range, url, nowMs=Date.now()) {
  const name=String(range||'current').toLowerCase();
  const now=new Date(nowMs);
  if (name==='current') return {range:name,fromMs:null,toMs:null};
  if (name==='daily') return {range:name,fromMs:Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),toMs:nowMs};
  if (name==='weekly') return {range:name,fromMs:nowMs-(7*24*60*60*1000),toMs:nowMs};
  if (name==='monthly') return {range:name,fromMs:Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1),toMs:nowMs};
  if (name==='custom') {
    const fromMs=Date.parse(url.searchParams.get('from')||'');
    const toRaw=url.searchParams.get('to');
    const toMs=toRaw?Date.parse(toRaw):nowMs;
    if (!Number.isFinite(fromMs)||!Number.isFinite(toMs)||fromMs>toMs) throw new Error('INVALID_CUSTOM_EXPORT_RANGE');
    return {range:name,fromMs,toMs};
  }
  throw new Error('EXPORT_RANGE_NOT_ALLOWED');
}

async function listResearchEvents(env, bounds=null, limit=500) {
  const kv=binding(env);
  if (typeof kv.list!=='function') throw new Error('PAYNE_KALSHI_STATE_LIST_UNAVAILABLE');
  const out=[];
  let cursor=undefined,complete=false;
  while(!complete && out.length<limit){
    const page=await kv.list({prefix:EVENT_PREFIX,limit:1000,...(cursor?{cursor}:{})});
    for(const item of page?.keys||[]){
      const value=await kvGetJson(env,item.name);
      if(!value) continue;
      const atMs=Date.parse(value?.at||'');
      const inRange=!bounds || bounds.range==='current' || (
        Number.isFinite(atMs) &&
        (bounds.fromMs===null||atMs>=bounds.fromMs) &&
        (bounds.toMs===null||atMs<=bounds.toMs)
      );
      if(inRange && ['OBSERVATION_DECISION_EVENT','ZERO_MONEY_FIRE_PLAN_RECORDED','PAYNE_STATE_TRANSITION'].includes(String(value?.type||''))) out.push(value);
      if(out.length>=limit) break;
    }
    complete=page?.list_complete===true || !page?.cursor;
    cursor=page?.cursor;
  }
  return out.sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0));
}

async function listExportSnapshots(env, bounds) {
  const current=await kvGetJson(env,CURRENT_KEY);
  if (bounds.range==='current') return current?[current]:[];
  const kv=binding(env);
  if (typeof kv.list!=='function') throw new Error('PAYNE_KALSHI_STATE_LIST_UNAVAILABLE');
  const snapshots=[];
  let cursor=undefined;
  let complete=false;
  while (!complete && snapshots.length<5000) {
    const page=await kv.list({prefix:SCAN_HISTORY_PREFIX,limit:1000,...(cursor?{cursor}:{})});
    for (const item of page?.keys||[]) {
      const value=await kvGetJson(env,item.name);
      const atMs=Date.parse(value?.at||'');
      if (value && Number.isFinite(atMs) && atMs>=bounds.fromMs && atMs<=bounds.toMs) snapshots.push(value);
      if (snapshots.length>=5000) break;
    }
    complete=page?.list_complete===true || !page?.cursor;
    cursor=page?.cursor;
  }
  if (current) {
    const atMs=Date.parse(current.at||'');
    if (Number.isFinite(atMs) && atMs>=bounds.fromMs && atMs<=bounds.toMs && !snapshots.some(x=>x?.at===current.at)) snapshots.push(current);
  }
  return snapshots.sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0));
}

function exportRowsFromSnapshots(snapshots) {
  const rows=[];
  for (const snapshot of snapshots||[]) {
    const decisions=Array.isArray(snapshot?.decisions)&&snapshot.decisions.length?snapshot.decisions:[snapshot?.selected||{}];
    for (const d of decisions) {
      const isSelected=Boolean(snapshot?.selected && d?.ticker===snapshot.selected.ticker && d?.outcomeSide===snapshot.selected.outcomeSide);
      const decision=d?.decision||{};
      rows.push({
        observationAt:snapshot?.at||null,
        scanSource:snapshot?.source||null,
        asset:d?.asset||null,
        direction:d?.direction||null,
        outcomeSide:d?.outcomeSide||null,
        ticker:d?.ticker||null,
        contractOpenTime:d?.contractOpenTime||snapshot?.selected?.openTime||null,
        contractCloseTime:d?.contractCloseTime||snapshot?.selected?.closeTime||null,
        liveBid:d?.liveBid??(isSelected?snapshot?.selected?.selectedBid:null)??null,
        liveAsk:d?.liveAsk??(isSelected?snapshot?.selected?.selectedAsk:null)??null,
        livePrice:d?.livePrice??d?.liveAsk??(isSelected?snapshot?.selected?.selectedAsk:null)??null,
        move:d?.move??(isSelected?snapshot?.selected?.payne?.move:null)??null,
        fair:d?.fair??(isSelected?snapshot?.selected?.payne?.fair:null)??null,
        edge:d?.edge??(isSelected?snapshot?.selected?.payne?.edge:null)??null,
        score:d?.score??(isSelected?snapshot?.selected?.payne?.score:null)??null,
        payneState:d?.state||snapshot?.selected?.payne?.state||'UNKNOWN',
        radarResult:decision?.radar||null,
        lockResult:decision?.lock||null,
        pullResult:decision?.pull||null,
        decision:decision?.decision||snapshot?.pipeline?.finalDecision||null,
        initialPrice:isSelected?snapshot?.selected?.initialPrice??snapshot?.selected?.selectedAsk??null:null,
        freshLockPrice:isSelected?snapshot?.selected?.freshLockPrice??snapshot?.zeroMoneyPreview?.freshLockPrice??null:null,
        preSubmitPrice:isSelected?snapshot?.selected?.preSubmitPrice??snapshot?.zeroMoneyPreview?.preSubmitPrice??null:null,
        timeGate:isSelected?snapshot?.pipeline?.timeGate6_5m||null:null,
        tickerConsistency:isSelected?snapshot?.pipeline?.tickerConsistent??null:null,
        sideConsistency:isSelected?snapshot?.pipeline?.sideConsistent??null:null,
        zeroMoneyFireStatus:isSelected?snapshot?.zeroMoneyPreview?.status||null:null,
        zeroMoneyOrderCount:isSelected?snapshot?.zeroMoneyPreview?.count??null:null,
        estimatedSizingUsd:isSelected?snapshot?.zeroMoneyPreview?.estimatedDebitUsd??null:null,
        providerGets:snapshot?.providerGets??null,
        providerWrites:0,
        orders:0,
        capitalMovedUsd:0,
        kalshiWindowStart:snapshot?.clocks?.kalshi?.currentWindowStart||null,
        kalshiWindowClose:snapshot?.clocks?.kalshi?.currentWindowClose||null,
        kalshiRemainingMs:snapshot?.clocks?.kalshi?.remainingMs??null,
        kalshiNextResetAt:snapshot?.clocks?.kalshi?.nextResetAt||null,
        baselineObservationAt:snapshot?.clocks?.baseline?.observationAt||null,
        baselineWindowStart:snapshot?.clocks?.baseline?.currentWindowStart||null,
        baselineWindowClose:snapshot?.clocks?.baseline?.currentWindowClose||null,
        baselineRemainingMs:snapshot?.clocks?.baseline?.remainingMs??null,
        baselineNextResetAt:snapshot?.clocks?.baseline?.nextResetAt||null,
        payneObservationAt:snapshot?.clocks?.payne?.observationAt||snapshot?.at||null,
        payneObservationAgeMs:snapshot?.clocks?.payne?.observationAgeMs??0,
        kalshiWindowElapsedMs:snapshot?.clocks?.consistency?.kalshiWindowElapsedMs??null,
        kalshiLifecycleFraction:snapshot?.clocks?.consistency?.kalshiLifecycleFraction??null,
        freshLockAt:isSelected?snapshot?.clocks?.consistency?.freshLockAt||snapshot?.selected?.freshLockAt||null:null,
        preSubmitAt:isSelected?snapshot?.clocks?.consistency?.preSubmitAt||snapshot?.selected?.preSubmitAt||null:null,
        windowConsistency:snapshot?.clocks?.consistency?.windowConsistency??null,
        windowDiagnostic:snapshot?.clocks?.consistency?.diagnostic||null,
        baselineToPayneObservationDeltaMs:snapshot?.clocks?.consistency?.baselineToPayneObservationDeltaMs??null,
        baselineActualLane:snapshot?.comparison?.baselineReal?.lane||null,
        baselineActualMatch:snapshot?.comparison?.baselineReal?.sawMatchingContract??'UNKNOWN',
        baselineAttempted:snapshot?.comparison?.baselineReal?.attempted??'UNKNOWN',
        baselineFilled:snapshot?.comparison?.baselineReal?.filled??'UNKNOWN',
        baselineFillTime:snapshot?.comparison?.baselineReal?.fillTime||null,
        baselineEntryPrice:snapshot?.comparison?.baselineReal?.entryPrice??null,
        baselineScore:snapshot?.comparison?.baselineReal?.score??null,
        paynePaperComparisonStatus:snapshot?.comparison?.paynePaper?.reason||null,
      });
    }
  }
  return rows;
}

function csvCell(value) {
  if (value===null||value===undefined) return '';
  const text=typeof value==='object'?JSON.stringify(value):String(value);
  return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}

function exportCsv(rows) {
  return [EXPORT_ROW_FIELDS.join(','),...rows.map(row=>EXPORT_ROW_FIELDS.map(k=>csvCell(row[k])).join(','))].join('\n');
}

async function buildExportResponse(env, url, nowMs=Date.now()) {
  const bounds=exportRangeBounds(url.searchParams.get('range')||'current',url,nowMs);
  const format=String(url.searchParams.get('format')||'json').toLowerCase();
  if (!['json','csv'].includes(format)) throw new Error('EXPORT_FORMAT_NOT_ALLOWED');
  const snapshots=await listExportSnapshots(env,bounds);
  const rows=exportRowsFromSnapshots(snapshots);
  const events=format==='json'?await listResearchEvents(env,bounds,1000):[];
  const stamp=new Date(nowMs).toISOString().replace(/[:.]/g,'-');
  const filename='payne-kalshi-'+bounds.range+'-'+stamp+'.'+format;
  const common={'cache-control':'no-store','content-disposition':'attachment; filename="'+filename+'"'};
  if (format==='csv') return new Response(exportCsv(rows),{headers:{...common,'content-type':'text/csv; charset=utf-8'}});
  return new Response(JSON.stringify({
    schema:'PAYNE_KALSHI_EXPORT_V1',
    exportedAt:new Date(nowMs).toISOString(),
    range:bounds.range,
    from:bounds.fromMs===null?null:new Date(bounds.fromMs).toISOString(),
    to:bounds.toMs===null?null:new Date(bounds.toMs).toISOString(),
    observationCount:snapshots.length,
    rowCount:rows.length,
    eventCount:events.length,
    providerWrites:0,orders:0,capitalMovedUsd:0,
    fields:EXPORT_ROW_FIELDS,
    rows,
    events,
  },null,2),{headers:{...common,'content-type':'application/json; charset=utf-8'}});
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
      ok:false,service:SERVICE_ID,mode:'PRELIVE_REAL_COCKPIT / ZERO-MONEY',
      updatedAt:new Date().toISOString(),refreshIntervalMs:COCKPIT_REFRESH_MS,
      providerGets,baselineReads:0,providerWrites:0,orders:0,capitalMovedUsd:0,
      authentication:'NOT_PROVEN',
      error:'AUTHENTICATED_BALANCE_GET_FAILED',errorClass:error?.name||'Error',
      control:{...control,threshold:control.activeThreshold},
      safety:{payneArmed:control.armed,realExecution:'DISABLED',fundingAuthority:'DISABLED',providerWrites:0,orders:0,capitalMovedUsd:0,getOnly:'ACTIVE',providerPost:'HELD / HARD DISABLED',secondIoc:'HOLD'},
    };
  }

  const [discovery,featureState,positions,latestPersistent]=await Promise.all([
    discoverCockpitMarkets(env,{nowMs}),
    readAuthoritativePayneFeatures(env,nowMs),
    listPositionSnapshots(env),
    kvGetJson(env,CURRENT_KEY),
  ]);
  providerGets+=Number(discovery.providerGets||0);
  const candidates=buildCandidateViews(discovery.markets||[],featureState,control.activeThreshold);
  const selected=candidates[0]||null;

  let freshLock=null, preSubmit=null;
  if (selected?.ticker) {
    try {
      freshLock=await exactMarketRead(env,selected.ticker,selected.asset); providerGets++;
      preSubmit=await exactMarketRead(env,selected.ticker,selected.asset); providerGets++;
    } catch (error) {
      const fail={ok:false,httpStatus:null,path:null,readAt:new Date().toISOString(),market:null,errorClass:error?.name||'Error'};
      freshLock=freshLock||fail;
      preSubmit=preSubmit||fail;
    }
  }

  const index3=providerIndex3Evidence(balance.body);
  const baselineActual=selected?await readBaselineActualComparison(env,selected):{
    source:'BASELINE_REAL_EXECUTION_TEST_READ_ONLY',lane:'EXECUTION_TEST_NOT_PRODUCTION_BASELINE',
    available:false,reason:'NO_SELECTED_CONTRACT',sawMatchingContract:'UNKNOWN',sameTicker:'UNKNOWN',sameDirection:'UNKNOWN',
    attempted:'UNKNOWN',filled:'UNKNOWN',fireTime:null,fillTime:null,entryPrice:null,score:null
  };
  const payne=selected?.payne||{
    source:featureState?.source||'BASELINE_REAL_SERVICE_BINDING_READ_ONLY',
    available:false,
    move:null,fair:null,edge:null,score:null,
    state:'UNKNOWN',
    reason:featureState?.error||'NO_SELECTED_LIVE_CONTRACT',
    sourceLastRunAt:featureState?.lastRunAt||null,
    sourceAgeMs:featureState?.ageMs??null,
    underlyingPriceSource:null,
  };
  const tickerConsistent=Boolean(selected?.ticker && freshLock?.market?.ticker===selected.ticker && preSubmit?.market?.ticker===selected.ticker);
  const sideConsistent=Boolean(selected?.outcomeSide==='YES'||selected?.outcomeSide==='NO');
  const timeSafe=selected?.closeTime ? kalshiCandidateTimeSafe({closeTime:selected.closeTime},nowMs) : null;
  const gate=payne.available?payneStage(payne,control.activeThreshold):null;
  const zeroMoneyPreview=zeroMoneyPreviewFor(selected,preSubmit,index3,control,nowMs);
  const kalshiCloseMs=Date.parse(selected?.closeTime||'');
  const baselineCloseMs=Date.parse(payne?.baselineCloseTime||'');
  const clocks={
    kalshi:{
      source:'LIVE_PROVIDER_CONTRACT',
      currentWindowStart:selected?.openTime||null,
      currentWindowClose:selected?.closeTime||null,
      remainingMs:Number.isFinite(kalshiCloseMs)?Math.max(0,kalshiCloseMs-nowMs):null,
      nextResetAt:selected?.closeTime||null,
      nextWindowStart:'UNKNOWN_UNTIL_PROVIDER_EXPOSES_NEXT_CONTRACT',
    },
    baseline:{
      source:payne?.source||featureState?.source||'UNKNOWN',
      observationAt:payne?.sourceLastRunAt||featureState?.lastRunAt||null,
      observationAgeMs:payne?.sourceAgeMs??featureState?.ageMs??null,
      currentWindowStart:payne?.baselineOpenTime||null,
      currentWindowClose:payne?.baselineCloseTime||null,
      remainingMs:Number.isFinite(baselineCloseMs)?Math.max(0,baselineCloseMs-nowMs):null,
      nextResetAt:payne?.baselineCloseTime||null,
      nextObservationAt:null,
      nextObservationReason:'NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE',
    },
    payne:{
      source:'PAYNE_OBSERVATION',
      observationAt:new Date(nowMs).toISOString(),
      observationAgeMs:0,
      associatedKalshiTicker:selected?.ticker||null,
      associatedKalshiWindowOpen:selected?.openTime||null,
      associatedKalshiWindowClose:selected?.closeTime||null,
    },
    consistency:universalClockEvidence(selected,payne,freshLock,preSubmit,nowMs),
  };
  const comparison=buildResearchComparison(selected,payne,zeroMoneyPreview,baselineActual,clocks);
  const qualificationDecision=selected?.decision||payneDecisionEvidence(payne,control.activeThreshold);
  const finalDecision=!selected?'NO_CURRENT_CONTRACT':
    !payne.available?'FEATURES_UNAVAILABLE':
    clocks.consistency.windowConsistency===false?'WINDOW_MISMATCH':
    qualificationDecision.pull!=='PULL_QUALIFIED'?qualificationDecision.decision:
    timeSafe!==true?'TIME_GATE_REJECT':
    freshLock?.ok!==true?'FRESH_LOCK_INVALIDATED':
    preSubmit?.ok!==true?'PRE_SUBMIT_INVALIDATED':
    tickerConsistent!==true?'FRESH_LOCK_TICKER_MISMATCH':
    zeroMoneyPreview?.status==='FIRE_READY'?'PULL_QUALIFIED_ZERO_MONEY_FIRE_READY':
    zeroMoneyPreview?.reason||'ZERO_MONEY_FIRE_NOT_REACHED';

  return {
    ok:Boolean(balance.ok && discovery.ok),
    service:SERVICE_ID,
    mode:'PRELIVE_REAL_COCKPIT / ZERO-MONEY',
    updatedAt:new Date().toISOString(),
    refreshIntervalMs:COCKPIT_REFRESH_MS,
    automaticScan:{enabled:control.scanEnabled,cadenceMs:60_000,cron:'* * * * *',authority:'READ_ONLY'},
    persistence:{
      binding:STATE_BINDING,
      latestObservationAt:latestPersistent?.at||null,
      historyCadenceMs:SCAN_HISTORY_INTERVAL_MS,
      latestCadenceMs:SCAN_PERSIST_INTERVAL_MS,
      latestUpdatedEveryScan:true,
      latestScanSource:latestPersistent?.source||null,
      transitionLogging:'ENABLED',
      firePlanLogging:'ENABLED',
    },
    providerGets,
    baselineReads:selected?2:1,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
    authentication:balance.ok?'PROVEN':'NOT_PROVEN',
    balanceHttpStatus:balance.httpStatus,
    index3,
    control:{
      armed:Boolean(control.armed),
      attempts:Number(control.attempts||0),
      attemptTarget:control.attemptTarget,
      openPositions:Number(control.openPositions||0),
      maxPositions:control.maxPositions,
      maxEntryDebitUsd:control.maxEntryDebitUsd,
      threshold:control.activeThreshold,
      thresholdOptions:CONTROL_THRESHOLD_OPTIONS,
      stakeOptions:CONTROL_STAKE_OPTIONS,
      attemptOptions:CONTROL_ATTEMPT_OPTIONS,
      scanEnabled:control.scanEnabled,
      realExecution:'DISABLED',
      fundingAuthority:'DISABLED',
      providerWriteAuthority:'DISABLED',
      providerPostAuthority:'HELD',
    },
    markets:discovery.markets||[],
    candidates,
    selected,
    payne,
    featureProvenance:{
      source:featureState.source,
      transport:featureState.transport||null,
      binding:featureState.binding||null,
      endpoint:featureState.endpoint,
      httpStatus:featureState.httpStatus,
      status:featureState.status,
      lastRunAt:featureState.lastRunAt,
      ageMs:featureState.ageMs,
      fresh:featureState.fresh,
      error:featureState.error,
    },
    pipeline:{
      radar:gate ? (gate.radar?'PASS':'FAIL') : 'UNKNOWN',
      lockIn:gate ? (gate.lockIn?'PASS':'FAIL') : 'UNKNOWN',
      pullTrigger:gate ? (gate.pullTrigger?'PASS':'FAIL') : 'UNKNOWN',
      qualificationDecision,
      finalDecision,
      fireState:zeroMoneyPreview?.status==='FIRE_READY'?'FIRE READY / PROVIDER POST HELD':'NOT READY',
      realEligibility:selected ? {
        assetAllowed:PAYNE_CONFIG.executableAssets.includes(selected.asset),
        executionEligible:selected.executionEligible,
        tickerPresent:Boolean(selected.ticker),
      } : null,
      timeGate6_5m:timeSafe===null?'UNKNOWN':timeSafe?'PASS':'FAIL',
      freshLock:freshLock?.ok?'PROVEN':selected?'NOT_PROVEN':'NOT_AVAILABLE',
      preSubmit:preSubmit?.ok?'PROVEN':selected?'NOT_PROVEN':'NOT_AVAILABLE',
      tickerConsistent:selected?tickerConsistent:null,
      sideConsistent:selected?sideConsistent:null,
      feeSafeSizing:zeroMoneyPreview?.sizing?.ok===false?'FAIL':zeroMoneyPreview?.status==='FIRE_READY'?'PASS':'NOT_REACHED',
      iocPayload:zeroMoneyPreview?.status==='FIRE_READY'?'PASS':'NOT_REACHED',
      fundingGate:{
        index3:index3.status,
        fundingAuthority:'DISABLED',
        result:zeroMoneyPreview?.fundingGate||'AUTHORITY_HELD',
      },
      providerPost:'HELD / HARD DISABLED',
    },
    observations:{initial:selected,freshLock,preSubmit},
    clocks,
    comparison,
    researchCounters:latestPersistent?.researchCounters||{
      observationsCollected:0,contractsExamined:0,radarCount:0,lockCount:0,pullCount:0,wouldFireCount:0,rejectCount:0,
      freshLockInvalidations:0,preSubmitInvalidations:0,windowMismatches:0,baselineActualMatches:0,baselineActualFills:0,
      paynePaperMatches:0,unknownPaperComparisons:0,
    },
    zeroMoneyPreview,
    management:managementView(control,positions),
    discovery:{
      ok:discovery.ok,
      source:discovery.source,
      assets:discovery.assets,
      currentContractCount:(discovery.markets||[]).length,
    },
    safety:{
      payneArmed:Boolean(control.armed),
      realExecution:'DISABLED',
      fundingAuthority:'DISABLED',
      providerWrites:0,orders:0,capitalMovedUsd:0,getOnly:'ACTIVE',
      providerPost:'HELD / HARD DISABLED',secondIoc:'HOLD',
    },
  };
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

    if (request.method === 'POST' && url.pathname === '/control') {
      let body={}; try { body=await request.json(); } catch {}
      try {
        const control=await updateFounderControl(env,body?.action,body?.value);
        return Response.json({
          ok:true,
          control:{
            armed:control.armed,
            threshold:control.activeThreshold,
            maxEntryDebitUsd:control.maxEntryDebitUsd,
            attemptTarget:control.attemptTarget,
            scanEnabled:control.scanEnabled,
            providerWriteAuthority:'DISABLED',
            providerPostAuthority:'HELD',
            realExecution:'DISABLED',
            fundingAuthority:'DISABLED',
          },
          providerWrites:0,
          orders:0,
          capitalMovedUsd:0,
        });
      } catch (error) {
        return Response.json({ok:false,error:String(error?.message||'CONTROL_REJECTED'),providerWrites:0,orders:0,capitalMovedUsd:0},{status:400});
      }
    }

    if (request.method === 'POST' && url.pathname === '/scan-now') {
      const result=await runReadOnlyScan(env,'FOUNDER_MANUAL_SCAN');
      return Response.json(result,{headers:{'cache-control':'no-store'}});
    }

    if (request.method !== 'GET') return Response.json({ ok:false, reason:'GET_ONLY_PROVIDER_AUTHORITY / CONTROL_POSTS_LOCAL_ONLY' }, { status:405 });

    if (url.pathname === '/status') return Response.json(step1Status());
    if (url.pathname === '/control') {
      const control=await loadControl(env);
      return Response.json({
        ok:true,
        control:{
          armed:control.armed,
          attempts:control.attempts,
          attemptTarget:control.attemptTarget,
          openPositions:control.openPositions,
          maxPositions:control.maxPositions,
          maxEntryDebitUsd:control.maxEntryDebitUsd,
          activeThreshold:control.activeThreshold,
          scanEnabled:control.scanEnabled,
          providerWriteAuthority:'DISABLED',
          providerPostAuthority:'HELD',
          realExecution:'DISABLED',
          fundingAuthority:'DISABLED',
        },
        providerWrites:0,
        orders:0,
        capitalMovedUsd:0,
      });
    }
    if (url.pathname === '/cockpit-data') return Response.json(await buildCockpitData(env), { headers:{'cache-control':'no-store'} });
    if (url.pathname === '/export') {
      try { return await buildExportResponse(env,url); }
      catch (error) { return Response.json({ok:false,error:String(error?.message||'EXPORT_FAILED'),providerWrites:0,orders:0,capitalMovedUsd:0},{status:400,headers:{'cache-control':'no-store'}}); }
    }
    if (url.pathname === '/evidence/latest') return Response.json((await kvGetJson(env,CURRENT_KEY))||{ok:false,state:'NO_PERSISTED_OBSERVATION_YET'});
    if (url.pathname === '/evidence/events') {
      const requested=Number(url.searchParams.get('limit')||200);
      const limit=Math.max(1,Math.min(1000,Number.isFinite(requested)?Math.trunc(requested):200));
      const events=await listResearchEvents(env,null,limit);
      return Response.json({ok:true,schema:'PAYNE_RESEARCH_EVENT_LEDGER_V1',count:events.length,events,providerWrites:0,orders:0,capitalMovedUsd:0},{headers:{'cache-control':'no-store'}});
    }
    if (url.pathname === '/proof') {
      const provider = await kalshiReadOnlyProof(env);
      return Response.json({
        ...step1Status(),
        serviceLive:true,
        kv:{ binding:STATE_BINDING, connected:Boolean(env?.[STATE_BINDING]) },
        kalshi:provider,
      });
    }
    if (url.pathname === '/' || url.pathname === '/cockpit') return new Response(cockpitHtml(), { headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'} });
    return Response.json({ ok:false, error:'NOT_FOUND' }, { status:404 });
  },

  async scheduled(controller, env) {
    await initializeDisarmed(env);
    const control=await loadControl(env);
    if (control.scanEnabled) {
      try { await runReadOnlyScan(env,'SCHEDULED_CRON'); } catch {}
    }
  },
};
