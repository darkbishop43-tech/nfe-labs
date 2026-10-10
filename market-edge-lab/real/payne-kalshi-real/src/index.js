import {PayneExecutionCoordinator,claimPayneExecution,releaseProvenNoPost} from './payne-execution-coordinator.js';
export {PayneExecutionCoordinator};
import { kalshiReadOnlyProof, kalshiGetOnly } from './kalshi-get-only.js';
import { kalshiPayneOrderPost, PAYNE_WRITE_CONTRACT } from './kalshi-real-write.js';
import { cockpitHtml } from './cockpit-html.js';
import {logPayneTiming,payneTimingIdentity,paynePriorityBeforeScan} from './payne-execution-timing.js';
import { buildPayneOwnedFeatureState, payneFeatureIdentity } from './payne-kalshi-features.js';
import {
  PAYNE_PAPER_RULES,
  PAYNE_PAPER_SOURCE,
  paperCandidateKey,
  paperCooldownActive,
  paperDecision,
  paperManagementDecision,
  paperRankCandidates,
} from './payne-paper-brain.js';

const SERVICE_ID = 'market-edge-payne-kalshi-real';
const STATE_BINDING = 'PAYNE_KALSHI_STATE';
const CONTROL_KEY = 'payne-kalshi:control:v1';
const CURRENT_KEY = 'payne-kalshi:current:v1';
const EVENT_PREFIX = 'payne-kalshi:event:';
const RUN_PREFIX = 'payne-kalshi:run:';
const ATTEMPT_PREFIX = 'payne-kalshi:attempt:';
const POSITION_PREFIX = 'payne-kalshi:position:';
const SCAN_HISTORY_PREFIX = 'payne-kalshi:scan-history:';
const REAL_SERIES_KEY = 'payne-kalshi:real-series:v1';
const REAL_LEDGER_PREFIX = 'payne-kalshi:real-ledger:';
const REAL_CONTROL_SCHEMA = 'PAYNE_REAL_CONTROL_V2_PAPER_BRAIN';
const REAL_OWNER = 'PAYNE_KALSHI_REAL';
const PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS = 'PROVIDER_POST_BOUNDARY_V1';
const LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS = 'LEGACY_PRE_PROVIDER_BOUNDARY_V0';
const SCAN_PERSIST_INTERVAL_MS = 60 * 1000;
const SCAN_HISTORY_INTERVAL_MS = 15 * 60 * 1000;
const FOUNDER_THRESHOLD_MIN = 0.50; // Existing Founder cockpit minimum; PAYNE Paper defaults remain unchanged.
const FOUNDER_THRESHOLD_MAX = 1.00; // Existing Founder cockpit maximum; not a forced trading threshold.
const FOUNDER_THRESHOLD_DECIMALS = 2;
const CONTROL_STAKE_OPTIONS = Object.freeze([1,2,5,10]);
const CONTROL_ATTEMPT_OPTIONS = Object.freeze([1,5,10,30]);
const FORBIDDEN_KEYS = new Set([
  'baseline-real-execution-test-v1',
  'state:payne_method',
  'control:paper_threshold:payne_method',
]);

export function parseFounderThreshold(rawValue) {
  const text=String(rawValue??'').trim();
  if(!/^(?:\d+|\d*\.\d{1,2})$/.test(text)) return {ok:false,error:'PAYNE_CONTROL_THRESHOLD_INVALID_PRECISION'};
  const value=Number(text);
  if(!Number.isFinite(value)) return {ok:false,error:'PAYNE_CONTROL_THRESHOLD_NOT_FINITE'};
  if(value<FOUNDER_THRESHOLD_MIN || value>FOUNDER_THRESHOLD_MAX) return {ok:false,error:'PAYNE_CONTROL_THRESHOLD_OUT_OF_RANGE'};
  return {ok:true,value:Number(value.toFixed(FOUNDER_THRESHOLD_DECIMALS))};
}

export function effectiveLockThreshold(activeThreshold) {
  // PAYNE Paper LOCK is fixed at .65. PULL threshold does not lower LOCK.
  return PAYNE_PAPER_RULES.lockScore;
}

export const PAYNE_CONFIG = Object.freeze({
  radarScore: PAYNE_PAPER_RULES.radarScore,
  lockScore: PAYNE_PAPER_RULES.lockScore,
  defaultThreshold: PAYNE_PAPER_RULES.pullScore,
  minAbsMove: PAYNE_PAPER_RULES.minAbsMove,
  maxHoldMs: PAYNE_PAPER_RULES.maxHoldMs,
  paperCooldownMs: PAYNE_PAPER_RULES.cooldownMs,
  paperSourceCadenceMs: PAYNE_PAPER_RULES.sourceCadenceMs,
  paperSourceAssets: PAYNE_PAPER_RULES.sourceAssets,
  // Real discovery remains broader than the Paper source. Only source-proven
  // Paper assets receive authoritative Paper-brain features.
  executableAssets: Object.freeze(['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR']),
  providerWritesEnabled: false,
  realExecutionEnabled: false,
  fundingAuthorityEnabled: false,
  realCapabilityBuilt: true,
  requiredExchangeIndex: 2,
});

export function defaultControlState() {
  return {
    service: SERVICE_ID,
    realControlSchema: REAL_CONTROL_SCHEMA,
    armed: false,
    attempts: 0,
    openPositions: 0,
    maxPositions: 3,
    attemptTarget: 1,
    maxEntryDebitUsd: 1,
    activeThreshold: PAYNE_CONFIG.defaultThreshold,
    scanEnabled: true,
    scanCadenceMs: 60_000,
    providerWriteAuthority: 'BUILT_INACTIVE_DISARMED',
    providerPostAuthority: 'BUILT_INACTIVE_DISARMED',
    realExecution: 'BUILT_INACTIVE_DISARMED',
    fundingAuthority: 'INDEX2_ONLY_INACTIVE_DISARMED',
    requiredExchangeIndex: 2,
    index2: 'READ_REQUIRED_BEFORE_ENTRY',
  };
}

function normalizeControlState(saved) {
  const base=defaultControlState();
  const src=saved&&typeof saved==='object'?saved:{};
  const migrated=src?.realControlSchema!==REAL_CONTROL_SCHEMA;
  const armed=!migrated && src.armed===true;
  return {
    ...base,
    service:SERVICE_ID,
    realControlSchema:REAL_CONTROL_SCHEMA,
    armed,
    attempts:!migrated&&Number.isFinite(Number(src.attempts))?Number(src.attempts):0,
    openPositions:!migrated&&Number.isFinite(Number(src.openPositions))?Number(src.openPositions):0,
    maxPositions:3,
    attemptTarget:!migrated&&CONTROL_ATTEMPT_OPTIONS.includes(Number(src.attemptTarget))?Number(src.attemptTarget):1,
    maxEntryDebitUsd:!migrated&&CONTROL_STAKE_OPTIONS.includes(Number(src.maxEntryDebitUsd))?Number(src.maxEntryDebitUsd):1,
    activeThreshold:!migrated&&parseFounderThreshold(src.activeThreshold).ok?parseFounderThreshold(src.activeThreshold).value:PAYNE_CONFIG.defaultThreshold,
    scanEnabled:src.scanEnabled!==false,
    scanCadenceMs:60_000,
    providerWriteAuthority:armed?'ENABLED_GOVERNED_PAYNE_ONLY':'BUILT_INACTIVE_DISARMED',
    providerPostAuthority:armed?'ENABLED_GOVERNED_PAYNE_ONLY':'BUILT_INACTIVE_DISARMED',
    realExecution:armed?'ENABLED_GOVERNED_PAYNE_ONLY':'BUILT_INACTIVE_DISARMED',
    fundingAuthority:armed?'INDEX2_ONLY':'INDEX2_ONLY_INACTIVE_DISARMED',
    requiredExchangeIndex:2,
    index2:src.index2||base.index2,
  };
}

export function payneStage(candidate, activeThreshold = PAYNE_CONFIG.defaultThreshold, frozenEffectiveLock = null) {
  const d=paperDecision({
    score:candidate?.score,
    edge:candidate?.edge,
    move:candidate?.move,
    threshold:activeThreshold,
  });
  return {
    radar:d.radar,
    lockIn:d.lock,
    pullTrigger:d.trigger,
    effectiveLock:PAYNE_PAPER_RULES.lockScore,
    diagnosticLowerLockMode:false,
    stage:d.trigger?'PULL_TRIGGER':d.lock?'LOCK_IN':d.radar?'RADAR':'NO_ACTION',
    paperLabel:d.label,
  };
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
  const state=normalizeControlState(existing);
  if (!existing || existing?.realControlSchema!==REAL_CONTROL_SCHEMA) {
    const disarmed={...state,armed:false,attempts:0,openPositions:0,attemptTarget:1,maxEntryDebitUsd:1,activeThreshold:PAYNE_CONFIG.defaultThreshold,providerWriteAuthority:'BUILT_INACTIVE_DISARMED',providerPostAuthority:'BUILT_INACTIVE_DISARMED',realExecution:'BUILT_INACTIVE_DISARMED',fundingAuthority:'INDEX2_ONLY_INACTIVE_DISARMED',requiredExchangeIndex:2};
    await kvPutJson(env, CONTROL_KEY, disarmed);
    await appendEvent(env, 'REAL_CONTROL_INITIALIZED_DISARMED', { armed:false, attempts:0, attemptTarget:1, maxEntryDebitUsd:1, activeThreshold:PAYNE_CONFIG.defaultThreshold, requiredExchangeIndex:2 });
    return disarmed;
  }
  return state;
}

export async function updateFounderControl(env, action, rawValue = null) {
  const before=await loadControl(env);
  const next={...before};
  const name=String(action||'').toUpperCase();

  if (before.armed && !['DISARM','SET_SCAN_ENABLED'].includes(name)) throw new Error('PAYNE_REAL_CONFIG_LOCKED_WHILE_ARMED');

  if (name==='ARM') {
    let series=await loadRealSeriesState(env);
    const cfgThreshold=Number(before.activeThreshold), cfgStake=Number(before.maxEntryDebitUsd), cfgTarget=Number(before.attemptTarget);
    if (!parseFounderThreshold(String(cfgThreshold)).ok) throw new Error('PAYNE_REAL_ARM_THRESHOLD_NOT_ALLOWED');
    if (!CONTROL_STAKE_OPTIONS.includes(cfgStake)) throw new Error('PAYNE_REAL_ARM_STAKE_NOT_ALLOWED');
    if (!CONTROL_ATTEMPT_OPTIONS.includes(cfgTarget)) throw new Error('PAYNE_REAL_ARM_ATTEMPT_TARGET_NOT_ALLOWED');
    if (Number(before.requiredExchangeIndex)!==2) throw new Error('PAYNE_REAL_ARM_INDEX2_REQUIRED');
    if (series?.unresolvedEntry===true) throw new Error('PAYNE_REAL_ENTRY_RECONCILIATION_REQUIRED');
    if (series?.position && SERIES_BLOCKING_POSITION_STATUSES.includes(String(series.position.status||''))) throw new Error('PAYNE_REAL_OPEN_POSITION_EXISTS');
    const superseded=await reconcileDisarmedSupersededSeries(env,series,before);
    series=superseded.series;
    const started=Number(series?.attemptsStarted||0);
    const priorTarget=Number(series?.attemptTarget||1);
    let armedSeries;
    if (!seriesTerminal(series) && started>0 && started<priorTarget) {
      // Only repaired provider-boundary accounting series may resume. Legacy unfinished series must quarantine first.
      if(series?.accountingSemantics!==PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS || series?.legacyQuarantined===true) {
        throw new Error('PAYNE_LEGACY_SERIES_NON_RESUMABLE');
      }
      // An unfinished governed repaired series: ARM resumes it with its FROZEN config. It never re-snapshots or resets the count.
      const frozen=frozenSeriesConfig(series);
      if (!frozen.ok) throw new Error('PAYNE_REAL_SERIES_IN_PROGRESS_NOT_FROZEN');
      if (frozen.attemptTarget!==cfgTarget || frozen.threshold!==cfgThreshold || frozen.effectiveLockThreshold!==effectiveLockThreshold(cfgThreshold) || frozen.maxEntryDebitUsd!==cfgStake) throw new Error('PAYNE_REAL_SERIES_IN_PROGRESS_CONFIG_MISMATCH');
      const gate=seriesInterlock(series);
      if (!gate.clear) throw new Error('PAYNE_REAL_SERIES_PRIOR_ATTEMPT_NOT_CLEAN_'+gate.reason);
      armedSeries={...series,status:'ARMED_WAITING',requiredExchangeIndex:2,completedAt:null};
      next.attempts=started; next.openPositions=0;
    } else {
      // New governed series: snapshot the validated founder config into the series.
      armedSeries={
        ...defaultRealSeriesState(),
        seriesId:(started===0&&series?.seriesId)?series.seriesId:crypto.randomUUID(),
        status:'ARMED_WAITING',attemptsStarted:0,
        attemptTarget:cfgTarget,threshold:cfgThreshold,effectiveLockThreshold:effectiveLockThreshold(cfgThreshold),maxEntryDebitUsd:cfgStake,requiredExchangeIndex:2,
        configFrozen:true,frozenAt:new Date().toISOString(),completedAt:null,
      };
      next.attempts=0; next.openPositions=0;
    }
    await saveRealSeriesState(env,armedSeries);
    await persistRun(env,{runId:armedSeries.seriesId,threshold:armedSeries.threshold,effectiveLockThreshold:armedSeries.effectiveLockThreshold,maxEntryDebitUsd:armedSeries.maxEntryDebitUsd,attemptTarget:armedSeries.attemptTarget,requiredExchangeIndex:2,accountingSemantics:armedSeries.accountingSemantics,frozenAt:armedSeries.frozenAt||null});
    next.armed=true;
  } else if (name==='DISARM') next.armed=false;
  else if (name==='SET_THRESHOLD') {
    const parsed=parseFounderThreshold(rawValue);
    if (!parsed.ok) throw new Error(parsed.error);
    next.activeThreshold=parsed.value;
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

  next.realControlSchema=REAL_CONTROL_SCHEMA;
  next.requiredExchangeIndex=2;
  next.providerWriteAuthority=next.armed?'ENABLED_GOVERNED_PAYNE_ONLY':'BUILT_INACTIVE_DISARMED';
  next.providerPostAuthority=next.armed?'ENABLED_GOVERNED_PAYNE_ONLY':'BUILT_INACTIVE_DISARMED';
  next.realExecution=next.armed?'ENABLED_GOVERNED_PAYNE_ONLY':'BUILT_INACTIVE_DISARMED';
  next.fundingAuthority=next.armed?'INDEX2_ONLY':'INDEX2_ONLY_INACTIVE_DISARMED';

  await kvPutJson(env,CONTROL_KEY,next);
  await appendEvent(env,'FOUNDER_CONTROL_CHANGED',{
    action:name,
    armed:next.armed,
    activeThreshold:next.activeThreshold,
    maxEntryDebitUsd:next.maxEntryDebitUsd,
    attemptTarget:next.attemptTarget,
    scanEnabled:next.scanEnabled,
    requiredExchangeIndex:2,
    providerWriteAuthority:next.providerWriteAuthority,
    providerPostAuthority:next.providerPostAuthority,
    realExecution:next.realExecution,
    fundingAuthority:next.fundingAuthority,
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
  const intentNo=Number.isFinite(Number(attempt?.intentNo))?Math.max(1,Math.trunc(Number(attempt.intentNo))):null;
  const attemptNo=Number.isFinite(Number(attempt?.attemptNo))?Math.max(1,Math.trunc(Number(attempt.attemptNo))):null;
  const identity=intentNo!==null?'intent:'+intentNo:'attempt:'+(attemptNo??'unknown');
  const key = `${ATTEMPT_PREFIX}${attempt.runId}:${identity}`;
  await kvPutJson(env, key, attempt);
  await appendEvent(env, 'ATTEMPT_PERSISTED', {
    runId:attempt.runId, attemptId:attempt.attemptId,
    intentNo, attemptNo, providerAttemptNo:attempt?.providerAttemptNo??attemptNo,
    result:attempt.result ?? 'ZERO_MONEY'
  });
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

export function index2FundingEvidence(balanceBody, minRequiredUsd = 1) {
  const rows=Array.isArray(balanceBody?.balance_breakdown) ? balanceBody.balance_breakdown : null;
  if (!rows) return {index:2,available:false,balanceUsd:null,sufficient:false,evidence:'UNKNOWN_PROVIDER_EVIDENCE_INSUFFICIENT'};
  const row=rows.find(x=>Number(x?.exchange_index)===2);
  if (!row) return {index:2,available:false,balanceUsd:null,sufficient:false,evidence:'READ_PROVEN_UNAVAILABLE'};
  const balance=Number(row?.balance);
  return {
    index:2,
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

  const index2=index2FundingEvidence(balanceBody,sizing.totalDebitUsd);
  const funding=fundingGate({
    ...control,
    requiredExchangeIndex:index2.available?2:null,
  });
  await appendEvent(env,'STEP2_ZERO_MONEY_PLAN',{
    ticker:candidate.marketTicker,
    outcomeSide:outcome,
    clientOrderId,
    sizing,
    entryPayload,
    index2,
    funding,
  });

  const stop=hardStopBeforeProviderPost({
    ticker:candidate.marketTicker,
    stage:gate.stage,
    sizing,
    clientOrderId,
    entryPayload,
    index2,
    funding,
  });
  await appendEvent(env,'PROVIDER_POST_BLOCKED',{ticker:candidate.marketTicker,reason:stop.reason,funding,index2});
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
    index2,
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

export function managementDecision({ heldMs, owned = true, marketPresent = true, decisionLabel = 'PULL TRIGGER' }) {
  return paperManagementDecision({heldMs,owned,marketPresent,decisionLabel});
}

export async function recordManagementObservation(env, observation) {
  return appendEvent(env, 'MANAGEMENT_OBSERVATION', observation);
}

export async function recordReconciliationEvidence(env, evidence) {
  return appendEvent(env, 'RECONCILIATION_EVIDENCE', evidence);
}


export const COCKPIT_REFRESH_MS = 60_000;
const BASELINE_SERVICE_BINDING = 'BASELINE_REAL_READ';
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
    exchangeIndex:Number.isInteger(Number(market?.exchange_index))?Number(market.exchange_index):null,
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
    result:market?.result??market?.market_result??null,
    settlementValue:normalizeProviderProbability(market?.settlement_value_dollars??market?.settlement_value),
    settlementTs:market?.settlement_ts||market?.settled_time||null,
    expirationValue:market?.expiration_value??null,
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

function providerIndex2Evidence(balanceBody) {
  const rows=Array.isArray(balanceBody?.balance_breakdown)?balanceBody.balance_breakdown:null;
  if (!rows) return {status:'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT',balance:null};
  const row=rows.find(x=>Number(x?.exchange_index)===2);
  if (!row) return {status:'READ-PROVEN UNAVAILABLE',balance:null};
  const balance=Number(row?.balance);
  return {status:'READ-PROVEN AVAILABLE',balance:Number.isFinite(balance)?balance:null};
}

function finiteFinancialNumber(v){
  if(v===null||v===undefined||v==='') return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function firstFinancialDollarField(body,fields){
  for(const field of fields){
    const value=finiteFinancialNumber(body?.[field]);
    if(value!==null) return {value,field};
  }
  return {value:null,field:null};
}
export function buildAccountFinancialSummary({
  balanceBody={},
  ledger=[],
  series={},
  providerSyncedAt=null,
  nowMs=Date.now(),
  staleAfterMs=120000,
}={}){
  const rows=Array.isArray(balanceBody?.balance_breakdown)?balanceBody.balance_breakdown:[];
  const breakdownValues=rows.map(x=>finiteFinancialNumber(x?.balance));
  const breakdownComplete=rows.length>0 && breakdownValues.every(v=>v!==null);
  const cashDirect=firstFinancialDollarField(balanceBody,['available_balance_dollars','cash_balance_dollars','balance_dollars']);
  const cashUsd=cashDirect.value!==null?cashDirect.value:(breakdownComplete?Number(breakdownValues.reduce((a,b)=>a+b,0).toFixed(4)):null);
  const cashSource=cashDirect.value!==null?'PROVIDER '+cashDirect.field.toUpperCase():(breakdownComplete?'NFE CALCULATED — SUM OF PROVIDER BALANCE_BREAKDOWN':'NOT EXPOSED');

  const positionValue=firstFinancialDollarField(balanceBody,['open_position_value_dollars','position_value_dollars','portfolio_value_dollars']);
  const totalValue=firstFinancialDollarField(balanceBody,['total_account_value_dollars','account_value_dollars','total_value_dollars']);
  const realized=firstFinancialDollarField(balanceBody,['realized_pnl_dollars','realized_profit_loss_dollars']);
  const unrealized=firstFinancialDollarField(balanceBody,['unrealized_pnl_dollars','unrealized_profit_loss_dollars']);

  const payneRows=(Array.isArray(ledger)?ledger:[]).filter(x=>x?.owner===REAL_OWNER);
  const currentSeriesId=series?.seriesId||null;
  const runRows=currentSeriesId?payneRows.filter(x=>String(x?.seriesId||'')===String(currentSeriesId)):[];
  const utcDay=new Date(nowMs).toISOString().slice(0,10);
  const dayRows=payneRows.filter(x=>String(x?.at||'').slice(0,10)===utcDay);
  const realizedSum=rows=>Number(rows.reduce((sum,row)=>{
    const value=finiteFinancialNumber(row?.realizedPnlUsd);
    return sum+(value===null?0:value);
  },0).toFixed(4));
  const runRealizedEvents=runRows.filter(x=>finiteFinancialNumber(x?.realizedPnlUsd)!==null);
  const dayRealizedEvents=dayRows.filter(x=>finiteFinancialNumber(x?.realizedPnlUsd)!==null);
  const runHasNoAttempt=Number(series?.attemptsStarted||0)===0;
  const runPnlUsd=runRealizedEvents.length?realizedSum(runRealizedEvents):(currentSeriesId&&runHasNoAttempt?0:null);
  const dayPnlUsd=dayRealizedEvents.length?realizedSum(dayRealizedEvents):0;

  const position=series?.position||null;
  const entryFee=finiteFinancialNumber(position?.entryAverageFeePaid);
  const exitFee=finiteFinancialNumber(position?.exitAverageFeePaid);
  const runFeesUsd=(entryFee!==null||exitFee!==null)?Number(((entryFee||0)+(exitFee||0)).toFixed(4)):(currentSeriesId&&runHasNoAttempt?0:null);

  const syncedMs=Date.parse(providerSyncedAt||'');
  const ageMs=Number.isFinite(syncedMs)?Math.max(0,nowMs-syncedMs):null;
  const stale=ageMs===null?true:ageMs>staleAfterMs;

  return {
    schema:'PAYNE_ACCOUNT_FINANCIALS_V1',
    scopeNotice:'ACCOUNT PROVIDER FINANCIALS ARE SEPARATE FROM FUNDING AUTHORITY / INDEX 2. PAYNE P/L NEVER INCLUDES AUTO OR FOUNDER MANUAL.',
    providerSource:'KALSHI AUTHENTICATED /portfolio/balance',
    providerSyncedAt:providerSyncedAt||null,
    providerFinancialAgeMs:ageMs,
    providerFinancialStatus:providerSyncedAt?(stale?'STALE':'FRESH'):'UNKNOWN',
    account:{
      cashUsd,
      cashStatus:cashUsd===null?'NOT EXPOSED':cashSource,
      openPositionValueUsd:positionValue.value,
      openPositionValueStatus:positionValue.value===null?'NOT EXPOSED':'PROVIDER '+positionValue.field.toUpperCase(),
      totalAccountValueUsd:totalValue.value,
      totalAccountValueStatus:totalValue.value===null?'NOT EXPOSED':'PROVIDER '+totalValue.field.toUpperCase(),
      realizedPnlUsd:realized.value,
      realizedPnlStatus:realized.value===null?'NOT EXPOSED':'PROVIDER '+realized.field.toUpperCase(),
      unrealizedPnlUsd:unrealized.value,
      unrealizedPnlStatus:unrealized.value===null?'NOT EXPOSED':'PROVIDER '+unrealized.field.toUpperCase(),
    },
    payne:{
      currentRunPnlUsd:runPnlUsd,
      currentRunPnlStatus:runPnlUsd===null?'UNKNOWN':'NFE CALCULATED — PAYNE REAL LEDGER REALIZED P/L ONLY',
      utcDayPnlUsd:dayPnlUsd,
      utcDayPnlStatus:'NFE CALCULATED — PAYNE REAL LEDGER REALIZED P/L ONLY',
      feesUsd:runFeesUsd,
      feesStatus:runFeesUsd===null?'UNKNOWN':'NFE CALCULATED — PAYNE CURRENT SERIES PROVIDER FEES ONLY',
      currentSeriesId,
      excludes:['AUTO','FOUNDER_MANUAL'],
    },
  };
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
  if (!['/shadow-state','/execution-test-state','/execution-test-nofill-forensic','/forensic-provider-history'].includes(String(path||''))) {
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

export async function readAuthoritativePayneFeatures(env, markets = [], nowMs = Date.now(), options = {}) {
  return buildPayneOwnedFeatureState(env,markets,nowMs,options);
}

export function payneDecisionEvidence(candidate, activeThreshold = PAYNE_CONFIG.defaultThreshold, frozenEffectiveLock = null) {
  const d=paperDecision({
    score:candidate?.score,
    edge:candidate?.edge,
    move:candidate?.move,
    threshold:activeThreshold,
  });
  if(d.label==='UNAVAILABLE') return {radar:'UNKNOWN',lock:'UNKNOWN',pull:'UNKNOWN',decision:'FEATURES_UNAVAILABLE',paperLabel:d.label,effectiveLock:PAYNE_PAPER_RULES.lockScore};
  return {
    radar:d.radar?'RADAR_PASS':'RADAR_REJECT',
    lock:d.lock?'LOCK_PASS':d.radar?'LOCK_REJECT':'LOCK_NOT_REACHED',
    pull:d.trigger?'PULL_QUALIFIED':d.lock?'PULL_REJECTED':'PULL_NOT_REACHED',
    decision:d.trigger?'PULL_QUALIFIED':d.lock?'PULL_REJECTED':d.radar?'LOCK_REJECT':'RADAR_REJECT',
    paperLabel:d.label,
    effectiveLock:PAYNE_PAPER_RULES.lockScore,
  };
}
function featureForCandidate(featureState, ticker, outcomeSide, asset, activeThreshold, market = null) {
  if (!featureState?.fresh) {
    return {
      source:featureState?.source||'KALSHI_AUTHORITATIVE',
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
  const identity=row&&market?payneFeatureIdentity(row,market,outcomeSide):null;
  const has=(key)=>row?.[key]!==null && row?.[key]!==undefined && Number.isFinite(Number(row[key]));
  if (!row || !['move','fair','edge','score'].every(has) || (identity&&identity.pass!==true)) {
    return {
      source:featureState?.source||'KALSHI_AUTHORITATIVE',
      available:false,
      move:null,fair:null,edge:null,score:null,
      state:'UNKNOWN',
      reason:!row?'EXACT_TICKER_SIDE_FEATURE_NOT_PRESENT_IN_PAYNE_SOURCE':
        !['move','fair','edge','score'].every(has)?'PAYNE_FEATURE_MATH_INPUT_UNAVAILABLE':
        !identity?.tickerMatch?'FEATURE_TICKER_MISMATCH':
        !identity?.sideMatch?'FEATURE_SIDE_MISMATCH':'FEATURE_WINDOW_MISMATCH',
      sourceLastRunAt:featureState.lastRunAt,
      sourceAgeMs:featureState.ageMs,
      underlyingPriceSource:featureState?.priceSources?.[asset]||null,
      baselineOpenTime:null,baselineCloseTime:null,baselineDurationMs:null,baselineHorizon:null,
      featureOpenTime:null,featureCloseTime:null,
      tickerConsistency:identity?.tickerMatch??false,
      sideConsistency:identity?.sideMatch??false,
      windowConsistency:identity?.windowMatch??false,
    };
  }
  const move=Number(row.move), directionalMove=Number(row.directionalMove), fair=Number(row.fair), edge=Number(row.edge), score=Number(row.score);
  const gate=payneStage({move,fair,edge,score},activeThreshold);
  return {
    source:featureState?.source||'KALSHI_AUTHORITATIVE',
    available:true,
    move,directionalMove:Number.isFinite(directionalMove)?directionalMove:null,fair,edge,score,
    state:gate.pullTrigger?'PULL_TRIGGER':gate.lockIn?'LOCK_IN':gate.radar?'RADAR':'NOT_QUALIFIED',
    reason:null,
    direction:row?.direction||null,
    outcomeSide:row?.outcomeSide||outcomeSide||null,
    sourceLastRunAt:featureState.lastRunAt,
    sourceAgeMs:featureState.ageMs,
    underlyingPriceSource:row?.underlyingPriceSource||featureState?.priceSources?.[asset]||null,
    providerTimestamp:row?.providerTimestamp||null,
    calculationAt:row?.calculationAt||featureState?.calculationAt||featureState?.lastRunAt||null,
    featureOpenTime:row?.openTime||null,
    featureCloseTime:row?.closeTime||null,
    featureDurationMs:Number.isFinite(Number(row?.durationMs))?Number(row.durationMs):null,
    featureHorizon:row?.horizon||null,
    tickerConsistency:true,
    sideConsistency:true,
    windowConsistency:true,
    // Backward-compatible internal aliases used by frozen clock/gate helpers.
    baselineOpenTime:row?.openTime||null,
    baselineCloseTime:row?.closeTime||null,
    baselineDurationMs:Number.isFinite(Number(row?.durationMs))?Number(row.durationMs):null,
    baselineHorizon:row?.horizon||null,
  };
}


export function payneFeatureFailureReasons(feature, threshold, frozenEffectiveLock=null, prefix='FINAL') {
  const p=String(prefix||'FINAL').toUpperCase();
  if(feature?.available!==true) return [p+'_FEATURE_NOT_AVAILABLE'];
  const reasons=[];
  const score=Number(feature?.score), edge=Number(feature?.edge), move=Number(feature?.move);
  const t=Number(threshold);
  const lock=frozenEffectiveLock!==null&&frozenEffectiveLock!==undefined&&Number.isFinite(Number(frozenEffectiveLock))
    ? Number(frozenEffectiveLock) : effectiveLockThreshold(t);
  if(!Number.isFinite(score)) reasons.push(p+'_FEATURE_NOT_AVAILABLE');
  else {
    if(score<PAYNE_CONFIG.radarScore) reasons.push(p+'_SCORE_BELOW_RADAR');
    if(score<lock) reasons.push(p+'_SCORE_BELOW_EFFECTIVE_LOCK');
    if(score<t) reasons.push(p+'_SCORE_BELOW_THRESHOLD');
  }
  if(!Number.isFinite(edge) || edge<=0) reasons.push(p+'_EDGE_NOT_POSITIVE');
  if(!Number.isFinite(move) || Math.abs(move)<PAYNE_CONFIG.minAbsMove) reasons.push(p+'_MOVE_BELOW_MINIMUM');
  return [...new Set(reasons)];
}

export function payneFeatureBoundaryEvidence(feature, threshold, frozenEffectiveLock=null, prefix='FINAL') {
  const gate=payneStage(feature,threshold,frozenEffectiveLock);
  const reasons=payneFeatureFailureReasons(feature,threshold,frozenEffectiveLock,prefix);
  return {
    sourceLastRunAt:feature?.sourceLastRunAt||null,
    featureAgeMs:feature?.sourceAgeMs??null,
    score:feature?.score??null,
    move:feature?.move??null,
    edge:feature?.edge??null,
    fair:feature?.fair??null,
    available:feature?.available===true,
    radar:gate.radar?'PASS':feature?.available===true?'FAIL':'NOT_AVAILABLE',
    lock:gate.radar?(gate.lockIn?'PASS':'FAIL'):'NOT_REACHED',
    pull:gate.lockIn?(gate.pullTrigger?'PASS':'FAIL'):'NOT_REACHED',
    failureReasons:reasons,
  };
}

export function payneBookEvidence(market, outcomeSide, selectedPrice=null, observedAt=null) {
  if(!market) return {bid:null,ask:null,spread:null,selectedPrice:selectedPrice??null,providerTimestamp:observedAt||null};
  const yes=String(outcomeSide||'').toUpperCase()==='YES';
  const bid=yes?Number(market.yesBid):Number(market.noBid);
  const ask=yes?Number(market.yesAsk):Number(market.noAsk);
  const cleanBid=Number.isFinite(bid)?bid:null, cleanAsk=Number.isFinite(ask)?ask:null;
  return {
    bid:cleanBid,
    ask:cleanAsk,
    spread:cleanBid!==null&&cleanAsk!==null?Number((cleanAsk-cleanBid).toFixed(6)):null,
    selectedPrice:selectedPrice!==null&&selectedPrice!==undefined?Number(selectedPrice):(cleanAsk!==null?cleanAsk:null),
    providerTimestamp:observedAt||market.providerReadAt||null,
  };
}

function paperCandidateAvailability(candidate,series,ledger,nowMs=Date.now()) {
  const candidateKey=paperCandidateKey(candidate);
  if(!candidateKey) return {available:false,candidateKey:null,reason:'PAPER_CANDIDATE_KEY_UNAVAILABLE'};
  const position=series?.position||null;
  const activeKey=position?.paperCandidateKey||paperCandidateKey({
    ticker:position?.marketTicker,
    outcomeSide:position?.outcomeSide,
    direction:position?.direction,
  });
  if(position&&SERIES_BLOCKING_POSITION_STATUSES.includes(String(position?.status||''))&&activeKey===candidateKey) {
    return {available:false,candidateKey,reason:'PAPER_DUPLICATE_ACTIVE'};
  }
  const exits=(Array.isArray(ledger)?ledger:[])
    .filter(row=>String(row?.type||'')==='PAYNE_PAPER_BRAIN_EXIT_CLOSED'&&String(row?.candidateKey||'')===candidateKey)
    .sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0));
  const last=exits.length?exits[exits.length-1]:null;
  if(last&&paperCooldownActive(last.at,nowMs)) return {available:false,candidateKey,lastExitAt:last.at,reason:'PAPER_COOLDOWN_ACTIVE'};
  return {available:true,candidateKey,lastExitAt:last?.at||null,reason:'PAPER_CANDIDATE_AVAILABLE'};
}

function buildCandidateViews(markets, featureState, activeThreshold, series=null, ledger=[], nowMs=Date.now()) {
  const out=[];
  for (const market of markets||[]) {
    for (const side of ['YES','NO']) {
      const feature=featureForCandidate(featureState,market.ticker,side,market.asset,activeThreshold,market);
      const decision=payneDecisionEvidence(feature,activeThreshold);
      const direction=side==='YES'?'UP':'DOWN';
      const base={
        ...market,
        outcomeSide:side,
        direction,
        selectedBid:side==='YES'?market.yesBid:market.noBid,
        selectedAsk:side==='YES'?market.yesAsk:market.noAsk,
        payne:feature,
        decision,
        paperCandidateKey:paperCandidateKey({ticker:market.ticker,outcomeSide:side,direction}),
      };
      const availability=paperCandidateAvailability(base,series,ledger,nowMs);
      out.push({
        ...base,
        paperCandidateAvailable:availability.available,
        paperCandidateReason:availability.reason,
        paperCooldownLastExitAt:availability.lastExitAt||null,
        paperReady:feature?.available===true && decision?.paperLabel==='PULL TRIGGER' && availability.available===true,
      });
    }
  }
  const available=out.filter(x=>x?.payne?.available===true);
  const unavailable=out.filter(x=>x?.payne?.available!==true);
  return [...paperRankCandidates(available),...unavailable];
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

export function livePayneAuthorityEvidence(control,index2,sizing=null) {
  const armed=control?.armed===true;
  const writeAuthority=control?.providerWriteAuthority==='ENABLED_GOVERNED_PAYNE_ONLY';
  const postAuthority=control?.providerPostAuthority==='ENABLED_GOVERNED_PAYNE_ONLY';
  const executionAuthority=control?.realExecution==='ENABLED_GOVERNED_PAYNE_ONLY';
  const fundingAuthority=control?.fundingAuthority==='INDEX2_ONLY';
  const indexAuthority=Number(control?.requiredExchangeIndex)===2;
  const index2Available=index2?.status==='READ-PROVEN AVAILABLE' && Number.isFinite(Number(index2?.balance));
  const debit=Number(sizing?.totalDebitUsd);
  const fundingSufficient=!Number.isFinite(debit) || (index2Available && Number(index2.balance)+1e-9>=debit);
  const providerWriteAuthorized=armed && writeAuthority && postAuthority && executionAuthority;
  const fundingAuthorized=fundingAuthority && indexAuthority && index2Available && fundingSufficient;
  return {
    providerWriteAuthorized,
    fundingAuthorized,
    providerPost:providerWriteAuthorized?'PASS':armed?'AUTHORITY_MISMATCH':'DISARMED',
    fundingGate:fundingAuthorized?'PASS':!armed?'DISARMED':!fundingAuthority?'FUNDING_AUTHORITY_MISMATCH':!indexAuthority?'INDEX2_AUTHORITY_MISMATCH':!index2Available?'INDEX2_NOT_READ_PROVEN':'INDEX2_FUNDING_INSUFFICIENT',
    armed,
    writeAuthority:control?.providerWriteAuthority||null,
    postAuthority:control?.providerPostAuthority||null,
    realExecution:control?.realExecution||null,
    fundingAuthority:control?.fundingAuthority||null,
    requiredExchangeIndex:Number(control?.requiredExchangeIndex),
    index2Status:index2?.status||null,
    index2Balance:index2?.balance??null,
  };
}

function zeroMoneyPreviewFor(selected, preSubmit, index2, control, nowMs) {
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
  const requiredFundingIndex=Number(control?.requiredExchangeIndex);
  const marketExchangeIndex=Number.isInteger(Number(selected?.exchangeIndex))?Number(selected.exchangeIndex):null;
  const shardMatch=Number.isInteger(requiredFundingIndex) && marketExchangeIndex===requiredFundingIndex;
  const shardEvidence={
    marketExchangeIndex,
    requiredFundingIndex:Number.isInteger(requiredFundingIndex)?requiredFundingIndex:null,
    fundingBalanceUsd:index2?.balance??null,
    match:shardMatch,
  };
  if (!shardMatch) {
    return {
      status:'BLOCKED',
      reason:'HOLD_REQUIRED_EXCHANGE_INDEX_'+String(Number.isInteger(requiredFundingIndex)?requiredFundingIndex:'UNKNOWN'),
      gate,
      shardEvidence,
      providerWrites:0,
      orders:0,
      capitalMovedUsd:0,
    };
  }
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
  if (!Number.isFinite(Number(index2?.balance)) || Number(index2.balance)+1e-9<Number(sizing.totalDebitUsd)) {
    return {
      status:'BLOCKED',
      reason:'HOLD_INDEX2_FUNDING_INSUFFICIENT',
      gate,eligibility,sizing,shardEvidence,
      providerWrites:0,orders:0,capitalMovedUsd:0,
    };
  }
  const clientOrderId=payneClientOrderId('cockpit-zero-money',1,'entry');
  const payload=kalshiV2EntryPayload({
    marketTicker:selected.ticker,
    outcomeSide:selected.outcomeSide,
    yes:ask,
  },sizing,clientOrderId);
  if (!payload) return {status:'BLOCKED',reason:'IOC_PAYLOAD_INVALID',gate,eligibility,sizing};
  const funding=fundingGate({...control,requiredExchangeIndex:index2?.status==='READ-PROVEN AVAILABLE'?2:null});
  const stop=hardStopBeforeProviderPost({
    ticker:selected.ticker,
    stage:gate.stage,
    sizing,
    clientOrderId,
    entryPayload:payload,
    index2,
    funding,
  });
  return {
    status:'FIRE_READY',
    authority:'ZERO_MONEY_PROVIDER_POST_HELD',
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
    shardEvidence,
    marketExchangeIndex,
    requiredFundingIndex,
    fundingBalanceUsd:index2?.balance??null,
    shardMatch,
    fundingEvidence:index2,
    fundingGate:funding.failClosed?'ZERO_MONEY_AUTHORITY_HELD':'PASS',
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

function managementView(control, positions, selected=null) {
  const current=(positions||[]).find(p=>['OPEN','EXIT_RETRY'].includes(String(p?.status||'').toUpperCase()))||null;
  const selectedMatches=Boolean(current && selected && String(current.marketTicker||'')===String(selected.ticker||'') && String(current.outcomeSide||'').toUpperCase()===String(selected.outcomeSide||'').toUpperCase());
  const currentBid=selectedMatches?Number(selected.selectedBid):Number(current?.currentBid);
  const currentAsk=selectedMatches?Number(selected.selectedAsk):Number(current?.currentAsk);
  const bid=Number.isFinite(currentBid)?currentBid:null, ask=Number.isFinite(currentAsk)?currentAsk:null;
  const count=Number(current?.filledCount||0), entry=Number(current?.entryAverageFillPrice);
  const mark=bid!==null&&ask!==null?(bid+ask)/2:(bid??ask);
  const positionValue=Number.isFinite(count)&&mark!==null?Number((count*mark).toFixed(4)):null;
  const unrealized=Number.isFinite(count)&&Number.isFinite(entry)&&mark!==null?Number((count*(mark-entry)).toFixed(4)):null;
  return {
    rules:{
      strategyAuthority:'PAYNE_PAPER',
      holdWhile:'PULL TRIGGER',
      decisionExit:'decision_exit',
      marketMissingExit:'market_missing',
      maxHoldReason:'max_hold',
      maxHoldMs:PAYNE_PAPER_RULES.maxHoldMs,
      cooldownMs:PAYNE_PAPER_RULES.cooldownMs,
      maxPositions:control.maxPositions,
      exitReduceOnly:true
    },
    activePositions:Number(control.openPositions||0),
    position:current?{
      status:current.status||null,
      ownershipState:current.owned===true?'OWNED':current.owned===false?'NOT_OWNED':'UNKNOWN',
      position_fp:current.position_fp??null,
      entryTime:current.openedAt||current.entryTime||null,
      currentPaperDecision:current.currentPaperDecision??null,
      currentScore:current.currentScore??null,
      currentMarketPrice:mark??current.currentMarketPrice??null,
      currentBid:bid,
      currentAsk:ask,
      currentSpread:bid!==null&&ask!==null?Number((ask-bid).toFixed(6)):null,
      currentPositionValueUsd:positionValue,
      unrealizedPnlUsd:unrealized,
      entryPrice:current.entryAverageFillPrice??null,
      positionAgeMs:Number.isFinite(Date.parse(current.entryTime||current.openedAt||''))?Math.max(0,Date.now()-Date.parse(current.entryTime||current.openedAt)):null,
      exitSubmittedPrice:current.exitSubmittedPrice??current.exitLimitPrice??null,
      exitFillPrice:current.exitAverageFillPrice??null,
      realizedPnlUsd:current.realizedPnlUsd??null,
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
      currentPaperDecision:null,
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
      providerReadAt:data.selected.providerReadAt||null,
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
      move:c.payne?.move??null,directionalMove:c.payne?.directionalMove??null,fair:c.payne?.fair??null,edge:c.payne?.edge??null,score:c.payne?.score??null,
      paperCandidateKey:c.paperCandidateKey||null,paperCandidateAvailable:c.paperCandidateAvailable??null,paperCandidateReason:c.paperCandidateReason||null,paperReady:c.paperReady??null,
      state:c.payne?.state||'UNKNOWN',decision:c.decision||null,
    })),
    pipeline:data.pipeline,
    observations:data.selected?{
      fireBook:payneBookEvidence(data.selected,data.selected.outcomeSide,data.selected.selectedAsk,data.selected.providerReadAt||data.updatedAt),
      freshLockBook:payneBookEvidence(data.observations?.freshLock?.market,data.selected.outcomeSide,
        data.selected.outcomeSide==='YES'?data.observations?.freshLock?.market?.yesAsk:data.observations?.freshLock?.market?.noAsk,
        data.observations?.freshLock?.readAt||null),
      preSubmitBook:payneBookEvidence(data.observations?.preSubmit?.market,data.selected.outcomeSide,
        data.selected.outcomeSide==='YES'?data.observations?.preSubmit?.market?.yesAsk:data.observations?.preSubmit?.market?.noAsk,
        data.observations?.preSubmit?.readAt||null),
    }:null,
    clocks:data.clocks,
    comparison:data.comparison||null,
    realExecution:data.realExecution||null,
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


export function fireSpecimenFingerprint(specimen={}) {
  return [
    specimen.seriesId||'',
    specimen.attemptNo??'',
    specimen.ticker||'',
    String(specimen.outcomeSide||'').toUpperCase(),
    specimen.marketOpenTime||'',
    specimen.marketCloseTime||'',
  ].join('|');
}

export function fireSpecimenFromSnapshot(series,snapshot) {
  const preview=snapshot?.zeroMoneyPreview||null;
  const selected=snapshot?.selected||null;
  if(preview?.status!=='FIRE_READY' || !selected?.ticker || preview?.ticker!==selected.ticker) return null;
  if(String(preview?.outcomeSide||'').toUpperCase()!==String(selected?.outcomeSide||'').toUpperCase()) return null;
  const cfg=frozenSeriesConfig(series);
  if(!cfg.ok || seriesTerminal(series) || series?.unresolvedEntry===true) return null;
  const attemptNo=Number(series?.attemptsStarted||0)+1;
  const fireObservedAt=snapshot?.at||new Date().toISOString();
  const specimen={
    schema:'PAYNE_FIRE_SPECIMEN_V1',
    state:'LATCHED',
    specimenId:[series.seriesId,'fire',attemptNo,selected.ticker,fireObservedAt].join(':'),
    seriesId:series.seriesId,
    attemptNo,
    ticker:selected.ticker,
    asset:selected.asset,
    outcomeSide:String(selected.outcomeSide||'').toUpperCase(),
    direction:selected.direction,
    observedScore:selected?.payne?.score??preview?.score??null,
    observedMove:selected?.payne?.move??null,
    observedEdge:selected?.payne?.edge??null,
    observedFair:selected?.payne?.fair??null,
    fireFeatureEvidence:snapshot?.fireFeatureEvidence||null,
    fireBookEvidence:snapshot?.observations?.fireBook||null,
    freshLockBookEvidence:snapshot?.observations?.freshLockBook||null,
    preSubmitBookEvidence:snapshot?.observations?.preSubmitBook||null,
    threshold:cfg.threshold,
    effectiveLockThreshold:cfg.effectiveLockThreshold,
    fireObservedAt,
    marketOpenTime:selected.openTime||null,
    marketCloseTime:selected.closeTime||null,
    marketWindowIdentity:selected.ticker,
    marketExchangeIndex:Number(preview?.marketExchangeIndex??preview?.shardEvidence?.marketExchangeIndex??2),
    identityMatch:'PENDING',
    freshLock:'PENDING',
    preSubmit:'PENDING',
    providerPost:'NO',
    providerOrderId:null,
    finalResult:null,
    invalidationReason:null,
  };
  return {...specimen,identityFingerprint:fireSpecimenFingerprint(specimen)};
}

async function latchFireReadySpecimen(env,series,snapshot,nowMs=Date.now()) {
  const existing=series?.fireLatch||null;
  if(existing?.state==='LATCHED' || existing?.state==='PROVIDER_POST_PENDING') return {series,latched:false,reason:'EXISTING_FIRE_LATCH_ACTIVE'};
  const gate=seriesInterlock(series);
  if(!gate.clear) return {series,latched:false,reason:'PRIOR_ATTEMPT_NOT_CLEAN_'+gate.reason};
  const specimen=fireSpecimenFromSnapshot(series,snapshot);
  if(!specimen) return {series,latched:false,reason:'FIRE_SPECIMEN_NOT_LATCHABLE'};
  const next={...series,fireLatch:specimen,status:'FIRE_SPECIMEN_LATCHED'};
  await appendRealLedger(env,'FIRE_SPECIMEN_LATCHED',{
    seriesId:specimen.seriesId,
    specimenId:specimen.specimenId,
    attemptNo:specimen.attemptNo,
    ticker:specimen.ticker,
    asset:specimen.asset,
    outcomeSide:specimen.outcomeSide,
    direction:specimen.direction,
    observedScore:specimen.observedScore,
    threshold:specimen.threshold,
    effectiveLockThreshold:specimen.effectiveLockThreshold,
    fireObservedAt:specimen.fireObservedAt,
    marketOpenTime:specimen.marketOpenTime,
    marketCloseTime:specimen.marketCloseTime,
    identityFingerprint:specimen.identityFingerprint,
    fireFeatureEvidence:specimen.fireFeatureEvidence,
    fireBookEvidence:specimen.fireBookEvidence,
    freshLockBookEvidence:specimen.freshLockBookEvidence,
    preSubmitBookEvidence:specimen.preSubmitBookEvidence,
    providerPost:false,
    providerWrites:0,
    capitalMovedUsd:0,
  });
  return {series:await saveRealSeriesState(env,next),latched:true,reason:'FIRE_SPECIMEN_LATCHED'};
}

async function invalidateFireSpecimen(env,series,reason,details={},nowMs=Date.now()) {
  const latch=series?.fireLatch||null;
  const invalidated={
    ...(latch||{}),
    state:'INVALIDATED_BEFORE_POST',
    invalidationReason:String(reason||'UNKNOWN_PRE_POST_INVALIDATION'),
    invalidatedAt:new Date(nowMs).toISOString(),
    identityMatch:details.identityMatch??latch?.identityMatch??'UNKNOWN',
    freshLock:details.freshLock??latch?.freshLock??'NOT_REACHED',
    preSubmit:details.preSubmit??latch?.preSubmit??'NOT_REACHED',
    finalFeature:details.finalFeature??latch?.finalFeature??'NOT_REACHED',
    finalFeatureEvidence:details.finalFeatureEvidence??latch?.finalFeatureEvidence??null,
    freshLockBookEvidence:details.freshLockBookEvidence??latch?.freshLockBookEvidence??null,
    preSubmitBookEvidence:details.preSubmitBookEvidence??latch?.preSubmitBookEvidence??null,
    providerPost:'NO',
    providerOrderId:null,
    finalResult:'INVALIDATED_BEFORE_POST',
  };
  await appendRealLedger(env,'FIRE_SPECIMEN_INVALIDATED_BEFORE_POST',{
    seriesId:series?.seriesId||null,
    specimenId:invalidated.specimenId||null,
    attemptNo:invalidated.attemptNo??null,
    ticker:invalidated.ticker||null,
    outcomeSide:invalidated.outcomeSide||null,
    reason:invalidated.invalidationReason,
    identityMatch:invalidated.identityMatch,
    freshLock:invalidated.freshLock,
    preSubmit:invalidated.preSubmit,
    finalFeature:invalidated.finalFeature,
    finalFeatureEvidence:invalidated.finalFeatureEvidence,
    freshLockBookEvidence:invalidated.freshLockBookEvidence,
    preSubmitBookEvidence:invalidated.preSubmitBookEvidence,
    providerPost:false,
    providerOrderId:null,
    providerWrites:0,
    capitalMovedUsd:0,
  });
  const holdStatus=String(reason||'PRE_POST_INVALIDATION').startsWith('HOLD_')?String(reason):'HOLD_'+String(reason||'PRE_POST_INVALIDATION');
  return saveRealSeriesState(env,{...series,fireLatch:invalidated,status:holdStatus});
}


async function synchronizeFireFeatureEpoch(env,series,snapshot,nowMs=Date.now()) {
  const cfg=frozenSeriesConfig(series);
  const selected=snapshot?.selected||null;
  if(!cfg.ok || !selected?.ticker) return {ok:false,reason:'FIRE_REFRESH_IDENTITY_UNAVAILABLE',series};
  const featureMarketRead=await exactMarketRead(env,selected.ticker,selected.asset);
  const exactMarket=featureMarketRead?.market||null;
  const exactIdentity=Boolean(
    featureMarketRead?.ok===true &&
    exactMarket?.ticker===selected.ticker &&
    String(exactMarket?.openTime||'')===String(selected?.openTime||'') &&
    String(exactMarket?.closeTime||'')===String(selected?.closeTime||'')
  );
  const state=exactIdentity
    ? await readAuthoritativePayneFeatures(env,[exactMarket],nowMs,{forceRefresh:true})
    : {fresh:false,source:'KALSHI_AUTHORITATIVE',lastRunAt:featureMarketRead?.readAt||new Date(nowMs).toISOString(),ageMs:0,error:'FIRE_EXACT_MARKET_IDENTITY_FAILED',opportunities:[]};
  const feature=featureForCandidate(state,selected.ticker,selected.outcomeSide,selected.asset,cfg.threshold,exactMarket);
  const evidence=payneFeatureBoundaryEvidence(feature,cfg.threshold,cfg.effectiveLockThreshold,'FIRE');
  const windowMatch=exactIdentity && String(feature?.baselineOpenTime||'')===String(selected?.openTime||'')
    && String(feature?.baselineCloseTime||'')===String(selected?.closeTime||'');
  const reasons=[...evidence.failureReasons];
  if(!windowMatch) reasons.push('FIRE_WINDOW_MISMATCH');
  const qualified=feature?.available===true && payneStage(feature,cfg.threshold,cfg.effectiveLockThreshold).pullTrigger===true && windowMatch;
  const fullEvidence={...evidence,failureReasons:[...new Set(reasons)],windowMatch,ticker:selected.ticker,outcomeSide:selected.outcomeSide,asset:selected.asset};
  if(!qualified){
    const next={...series,status:'ARMED_FISHING',fireRefreshEvidence:fullEvidence};
    await appendRealLedger(env,'FIRE_INVALIDATED_FEATURE_REFRESH',{
      seriesId:series.seriesId,attemptNo:Number(series.attemptsStarted||0)+1,
      ticker:selected.ticker,asset:selected.asset,outcomeSide:selected.outcomeSide,
      reason:'FIRE_INVALIDATED_FEATURE_REFRESH',fireFeatureEvidence:fullEvidence,
      providerPost:false,providerWrites:0,orders:0,capitalMovedUsd:0,
    });
    return {ok:false,reason:'FIRE_INVALIDATED_FEATURE_REFRESH',series:await saveRealSeriesState(env,next),feature,evidence:fullEvidence};
  }
  const synchronized={
    ...snapshot,
    selected:{...selected,payne:feature,decision:payneDecisionEvidence(feature,cfg.threshold)},
    fireFeatureEvidence:fullEvidence,
  };
  return {ok:true,series,feature,evidence:fullEvidence,snapshot:synchronized};
}

export async function runReadOnlyScan(env, source='SCHEDULED_CRON', nowMs=Date.now()) {
  const control=await loadControl(env);
  if (!control.scanEnabled && source==='SCHEDULED_CRON') {
    return {ok:true,skipped:true,reason:'AUTO_SCAN_PAUSED',providerWrites:0,orders:0,capitalMovedUsd:0};
  }
  const scanStartedMs=Date.now();
  const data=await buildCockpitData(env,nowMs);
  const snapshot=compactObservation(data,source,nowMs);
  logPayneTiming('SCAN_DATA_READY',{seriesId:'',attemptNo:0,ticker:snapshot?.selected?.ticker||'',side:snapshot?.selected?.outcomeSide||'',windowClose:snapshot?.selected?.closeTime||''},scanStartedMs);
  const previous=await kvGetJson(env,CURRENT_KEY);
  snapshot.researchCounters=incrementResearchCounters(previous,snapshot);
  const previousAt=Date.parse(previous?.at||'');
  const previousHistoryAt=Date.parse(previous?.lastHistoryAt||'');
  const prevKey=[previous?.selected?.ticker,previous?.selected?.outcomeSide,previous?.selected?.payne?.state].join('|');
  const nextKey=[snapshot?.selected?.ticker,snapshot?.selected?.outcomeSide,snapshot?.selected?.payne?.state].join('|');
  const transition=Boolean(previous && prevKey!==nextKey);
  const previewReady=snapshot?.zeroMoneyPreview?.status==='FIRE_READY';
  if(previewReady) logPayneTiming('PULL_QUALIFIED',{
    seriesId:'',attemptNo:0,ticker:snapshot?.selected?.ticker||'',
    side:snapshot?.selected?.outcomeSide||'',
    windowClose:snapshot?.selected?.closeTime||''
  },scanStartedMs,Date.now(),'QUALIFIED_SCAN_OBSERVATION');
  if(previewReady && control.armed===true){
    const series=await loadRealSeriesState(env);
    const prefireMarketPass=snapshot?.pipeline?.freshLock==='PROVEN'
      && snapshot?.pipeline?.preSubmit==='PROVEN'
      && snapshot?.pipeline?.tickerConsistent===true
      && snapshot?.pipeline?.sideConsistent===true
      && snapshot?.pipeline?.timeGate6_5m==='PASS';
    if(!seriesTerminal(series) && frozenSeriesMatchesControl(series,control) && prefireMarketPass){
      const synced=await synchronizeFireFeatureEpoch(env,series,snapshot,nowMs);
      if(synced.ok){
        const latched=await latchFireReadySpecimen(env,synced.series,synced.snapshot,nowMs);
        logPayneTiming('FIRE_LATCH_RESULT',payneTimingIdentity(latched?.series||synced.series,latched?.series?.fireLatch||synced.series?.fireLatch),scanStartedMs,Date.now(),latched?.reason||'LATCH_ATTEMPTED');
      }
    }
  }
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



function forensicNumber(v){
  if(v===null||v===undefined||v==='') return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function forensicTimeMs(v){
  if(v===null||v===undefined||v==='') return null;
  if(typeof v==='number'&&Number.isFinite(v)) return v>1e12?v:v*1000;
  if(typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v.trim())){
    const n=Number(v); if(Number.isFinite(n)) return n>1e12?n:n*1000;
  }
  const ms=Date.parse(String(v)); return Number.isFinite(ms)?ms:null;
}
function forensicIsoTime(v){
  const ms=forensicTimeMs(v); return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
export function normalizeBaselineEconomicEntryPrice(rawPrice,outcomeSide){
  const raw=forensicNumber(rawPrice);
  if(raw===null) return {rawYesLeg:null,economicOutcomePrice:null,semantics:'UNKNOWN'};
  const side=String(outcomeSide||'').toUpperCase();
  if(side==='NO') return {
    rawYesLeg:raw,
    economicOutcomePrice:Number((1-raw).toFixed(6)),
    semantics:'OUTCOME_SIDE_PRICE_NORMALIZED_FROM_KALSHI_YES_LEG'
  };
  if(side==='YES') return {
    rawYesLeg:raw,
    economicOutcomePrice:raw,
    semantics:'KALSHI_YES_LEG_EQUALS_OUTCOME_PRICE'
  };
  return {rawYesLeg:raw,economicOutcomePrice:null,semantics:'OUTCOME_SIDE_UNKNOWN'};
}
function forensicMedian(values){
  const a=values.map(forensicNumber).filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function forensicAverage(values){
  const a=values.map(forensicNumber).filter(Number.isFinite);
  return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
}
function normalizeMarketOutcome(market){
  const raw=String(market?.result??'').trim().toUpperCase();
  if(['YES','Y','TRUE'].includes(raw)) return 'YES';
  if(['NO','N','FALSE'].includes(raw)) return 'NO';
  const settlement=forensicNumber(market?.settlementValue);
  if(settlement===1)return 'YES';
  if(settlement===0)return 'NO';
  return null;
}
function forensicEventId(snapshot,index){
  const at=snapshot?.clocks?.consistency?.preSubmitAt||snapshot?.selected?.preSubmitAt||snapshot?.at||'UNKNOWN_TIME';
  return ['WF',String(index+1).padStart(4,'0'),at,snapshot?.selected?.ticker||'UNKNOWN',snapshot?.selected?.outcomeSide||'UNKNOWN'].join('|');
}
function forensicCandidateAt(snapshot,ticker,side){
  return (snapshot?.decisions||[]).find(x=>String(x?.ticker||'')===String(ticker||'')&&String(x?.outcomeSide||'').toUpperCase()===String(side||'').toUpperCase())||null;
}
function forensicBaselineClass(b){
  if(!b||b.available!==true) return 'PAYNE_FIRED_BASELINE_MATCH_UNKNOWN';
  if(b.filled===true) return 'PAYNE_FIRED_BASELINE_FILLED';
  if(b.attempted===true && String(b.attemptStatus||'').toUpperCase()==='NO_FILL') return 'PAYNE_FIRED_BASELINE_NO_FILL';
  if(b.attempted===true) return 'PAYNE_FIRED_BASELINE_ATTEMPTED_OTHER_STATE';
  if(b.sawMatchingContract===false) return 'PAYNE_FIRED_BASELINE_DID_NOT_ATTEMPT';
  return 'PAYNE_FIRED_BASELINE_MATCH_UNKNOWN';
}
function forensicBucketSummary(rows,keyFn){
  const out={};
  for(const row of rows){
    const key=String(keyFn(row)??'UNKNOWN');
    const x=out[key]||(out[key]={total:0,profitable:0,unprofitable:0,unresolved:0,notEnoughEvidence:0,directionallyCorrect:0,directionallyWrong:0,preFeePnlUsd:0,preFeePnlRows:0});
    x.total++;
    if(row.outcomeClassification==='PROFITABLE')x.profitable++;
    else if(row.outcomeClassification==='UNPROFITABLE')x.unprofitable++;
    else if(row.outcomeClassification==='UNRESOLVED')x.unresolved++;
    else x.notEnoughEvidence++;
    if(row.directionalClassification==='DIRECTIONALLY_CORRECT')x.directionallyCorrect++;
    if(row.directionalClassification==='DIRECTIONALLY_WRONG')x.directionallyWrong++;
    if(Number.isFinite(row.preFeeHypotheticalPnlUsd)){x.preFeePnlUsd+=row.preFeeHypotheticalPnlUsd;x.preFeePnlRows++;}
  }
  return out;
}
async function listAllForensicSnapshots(env){
  const kv=binding(env);
  if(typeof kv.list!=='function') throw new Error('PAYNE_KALSHI_STATE_LIST_UNAVAILABLE');
  const out=[],seen=new Set();
  let cursor=undefined,complete=false;
  while(!complete && out.length<5000){
    const page=await kv.list({prefix:SCAN_HISTORY_PREFIX,limit:1000,...(cursor?{cursor}:{})});
    for(const item of page?.keys||[]){
      const value=await kvGetJson(env,item.name);
      if(value?.at && !seen.has(value.at)){seen.add(value.at);out.push(value);}
    }
    complete=page?.list_complete===true||!page?.cursor;cursor=page?.cursor;
  }
  const current=await kvGetJson(env,CURRENT_KEY);
  if(current?.at&&!seen.has(current.at))out.push(current);
  return out.sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0));
}
async function readBaselineForensicSources(env){
  const [state,noFill,history]=await Promise.all([
    baselineReadOnlyPath(env,'/execution-test-state'),
    baselineReadOnlyPath(env,'/execution-test-nofill-forensic'),
    baselineReadOnlyPath(env,'/forensic-provider-history'),
  ]);
  return {state,noFill,history};
}
function baselineProviderEnrichment(persisted,providerHistory){
  const out={providerHistoryAvailable:providerHistory?.ok===true,entryFillMatched:false,providerFill:null,providerSettlement:null,realizedPnl:null,realizedPnlReason:'NOT_EXPOSED_AS_ATTRIBUTABLE_BASELINE_RESULT'};
  const orderId=String(persisted?.orderId||'');
  const ticker=String(persisted?.ticker||persisted?.marketTicker||'');
  const fills=[...(providerHistory?.body?.fills||[]),...(providerHistory?.body?.historicalFills||[])];
  const fill=orderId?fills.find(x=>String(x?.orderId||'')===orderId):null;
  if(fill){out.entryFillMatched=true;out.providerFill=fill;}
  const settlements=providerHistory?.body?.settlements||[];
  const settlement=ticker?settlements.find(x=>String(x?.ticker||'')===ticker):null;
  if(settlement)out.providerSettlement=settlement;
  return out;
}
function csvEscapeForensic(v){
  if(v===null||v===undefined)return '';
  const s=typeof v==='object'?JSON.stringify(v):String(v);
  return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function forensicRowsCsv(rows){
  const fields=['eventId','payneObservationAt','payneWouldFireAt','asset','direction','outcomeSide','ticker','marketOpen','marketClose','timeRemainingMs','windowPositionPct','move','fair','edge','score','initialObservedPrice','freshLockPrice','preSubmitPrice','hypotheticalEntryPrice','freshLockAt','preSubmitAt','windowConsistency','qualificationReason','marketResult','directionalClassification','outcomeClassification','hypotheticalExitReason','hypotheticalExitAt','hypotheticalExitPrice','count','grossHypotheticalPnlUsd','preFeeHypotheticalPnlUsd','netHypotheticalPnlUsd','pnlReason','baselineClass','baselineAttempted','baselineAttemptStatus','baselineFilled','baselineSideSame','baselineEntryPrice','baselineFillTime','baselineFireTime','baselineScore','baselineFinalState','baselineExitReason','payneToBaselineFillDeltaMs','payneTimingVsBaseline','entryPriceDelta'];
  return [fields.join(','),...rows.map(r=>fields.map(k=>csvEscapeForensic(r[k])).join(','))].join('\n');
}
async function buildWouldFireForensic(env,{checkpointLimit=59}={}){
  const snapshots=await listAllForensicSnapshots(env);
  const fireSnapshots=snapshots.filter(s=>s?.zeroMoneyPreview?.status==='FIRE_READY'&&s?.selected?.ticker);
  const authoritativeTotal=fireSnapshots.length;
  const analyzed=fireSnapshots.slice(0,Math.max(0,Math.min(checkpointLimit,authoritativeTotal)));
  const uniqueTickers=[...new Set(analyzed.map(s=>s.selected.ticker).filter(Boolean))];
  const marketPairs=await Promise.all(uniqueTickers.map(async ticker=>{
    try{return [ticker,await exactMarketRead(env,ticker)];}catch(error){return [ticker,{ok:false,error:String(error?.message||'MARKET_READ_FAILED'),market:null}];}
  }));
  const marketMap=new Map(marketPairs);
  const baselineSources=await readBaselineForensicSources(env);
  const providerHistory=baselineSources.history;
  const rows=[];
  for(let index=0;index<analyzed.length;index++){
    const s=analyzed[index],sel=s.selected||{},z=s.zeroMoneyPreview||{},clock=s.clocks?.consistency||{},b=s.comparison?.baselineReal||{};
    const entryAt=clock.preSubmitAt||sel.preSubmitAt||s.at||null;
    const entryMs=forensicTimeMs(entryAt);
    const deadlineMs=Number.isFinite(entryMs)?entryMs+PAYNE_CONFIG.maxHoldMs:null;
    const future=snapshots.filter(x=>{const ms=Date.parse(x?.at||'');return Number.isFinite(entryMs)&&Number.isFinite(ms)&&ms>entryMs&&ms<=entryMs+PAYNE_CONFIG.maxHoldMs+20_000;});
    let exitEvidence=null;
    for(const x of future){
      const cand=forensicCandidateAt(x,sel.ticker,sel.outcomeSide);
      if(!cand)continue;
      const ms=forensicTimeMs(x.at);
      const paperNow=paperDecision({
        score:forensicNumber(cand.score),
        edge:forensicNumber(cand.edge),
        move:forensicNumber(cand.move),
        threshold:PAYNE_PAPER_RULES.pullScore,
      });
      if(paperNow.label!=='PULL TRIGGER'){
        exitEvidence={reason:'decision_exit',at:x.at,price:forensicNumber(cand.liveBid),score:forensicNumber(cand.score),timingDeltaMs:Number.isFinite(ms)&&Number.isFinite(deadlineMs)?ms-deadlineMs:null};break;
      }
    }
    if(!exitEvidence&&Number.isFinite(deadlineMs)){
      const candidates=future.map(x=>({x,cand:forensicCandidateAt(x,sel.ticker,sel.outcomeSide),ms:forensicTimeMs(x?.at)})).filter(y=>y.cand&&Number.isFinite(y.ms)&&Math.abs(y.ms-deadlineMs)<=15_000).sort((a,b)=>Math.abs(a.ms-deadlineMs)-Math.abs(b.ms-deadlineMs));
      if(candidates.length)exitEvidence={reason:'max_hold',at:candidates[0].x.at,price:forensicNumber(candidates[0].cand.liveBid),score:forensicNumber(candidates[0].cand.score),timingDeltaMs:candidates[0].ms-deadlineMs};
    }
    const marketRead=marketMap.get(sel.ticker)||{},market=marketRead.market||{};
    const marketResult=normalizeMarketOutcome(market);
    const directionalClassification=!marketResult?'UNRESOLVED':String(sel.outcomeSide||'').toUpperCase()===marketResult?'DIRECTIONALLY_CORRECT':'DIRECTIONALLY_WRONG';
    const entryPrice=forensicNumber(z.preSubmitPrice??sel.preSubmitPrice);
    const exitPrice=forensicNumber(exitEvidence?.price);
    const count=forensicNumber(z.count);
    const gross=Number.isFinite(entryPrice)&&Number.isFinite(exitPrice)&&Number.isFinite(count)?Number(((exitPrice-entryPrice)*count).toFixed(6)):null;
    const outcomeClassification=Number.isFinite(gross)?(gross>0?'PROFITABLE':gross<0?'UNPROFITABLE':'UNPROFITABLE'):(!marketResult?'UNRESOLVED':'NOT_ENOUGH_AUTHORITATIVE_EVIDENCE');
    const baselineClass=forensicBaselineClass(b);
    const fillTimeRaw=b?.fillTime??null,fillTime=forensicIsoTime(fillTimeRaw),fillMs=forensicTimeMs(fillTimeRaw);
    const delta=Number.isFinite(entryMs)&&Number.isFinite(fillMs)?fillMs-entryMs:null;
    const timing=delta===null?'UNKNOWN':Math.abs(delta)<=1000?'SAME_SECOND':delta>0?'PAYNE_EARLIER_THAN_BASELINE_FILL':'PAYNE_LATER_THAN_BASELINE_FILL';
    const enrich=baselineProviderEnrichment({...b,ticker:sel.ticker},providerHistory);
    const baselineEntry=normalizeBaselineEconomicEntryPrice(b?.entryPrice,sel.outcomeSide);
    rows.push({
      eventId:forensicEventId(s,index),
      payneObservationAt:s.at||null,payneWouldFireAt:entryAt,
      asset:sel.asset||null,direction:sel.direction||null,outcomeSide:sel.outcomeSide||null,ticker:sel.ticker||null,
      marketOpen:sel.openTime||clock.kalshiWindowOpen||null,marketClose:sel.closeTime||clock.kalshiWindowClose||null,
      timeRemainingMs:clock.kalshiWindowRemainingMs??s.clocks?.kalshi?.remainingMs??null,
      windowPositionPct:forensicNumber(clock.kalshiLifecycleFraction)!==null?Number((Number(clock.kalshiLifecycleFraction)*100).toFixed(4)):null,
      move:sel.payne?.move??null,fair:sel.payne?.fair??null,edge:sel.payne?.edge??null,score:sel.payne?.score??null,
      initialObservedPrice:sel.initialPrice??null,freshLockPrice:sel.freshLockPrice??null,preSubmitPrice:sel.preSubmitPrice??null,hypotheticalEntryPrice:entryPrice,
      freshLockAt:clock.freshLockAt||sel.freshLockAt||null,preSubmitAt:clock.preSubmitAt||sel.preSubmitAt||null,
      windowConsistency:clock.windowConsistency??null,qualificationReason:s.pipeline?.finalDecision||sel.decision?.decision||null,
      marketProviderStatus:market?.status||null,marketResult,marketSettlementValue:market?.settlementValue??null,marketSettlementTs:market?.settlementTs||null,
      directionalClassification,outcomeClassification,
      hypotheticalExitReason:exitEvidence?.reason||null,hypotheticalExitAt:exitEvidence?.at||null,hypotheticalExitPrice:exitPrice,
      maxHoldDeadline:Number.isFinite(deadlineMs)?new Date(deadlineMs).toISOString():null,maxHoldQuoteDeltaMs:exitEvidence?.reason==='max_hold'?exitEvidence?.timingDeltaMs:null,
      count,grossHypotheticalPnlUsd:gross,preFeeHypotheticalPnlUsd:gross,
      entryFeeEstimateUsd:z.estimatedFeeUsd??null,entryFeeSource:z.estimatedFeeUsd!=null?'PAYNE_FEE_SAFE_SIZING_ESTIMATE':null,
      exitFeeUsd:null,netHypotheticalPnlUsd:null,
      pnlReason:Number.isFinite(gross)?'PRE_FEE_ONLY_EXIT_FEE_NOT_AUTHORITATIVELY_RECONSTRUCTED':'FROZEN_LIFECYCLE_EXIT_PRICE_NOT_AUTHORITATIVELY_RECONSTRUCTED',
      baselineClass,baselineMatchingContract:b?.sawMatchingContract??'UNKNOWN',baselineAttempted:b?.attempted??'UNKNOWN',baselineAttemptStatus:b?.attemptStatus||null,
      baselineFilled:b?.filled??'UNKNOWN',baselineSideSame:b?.sameDirection??'UNKNOWN',
      baselineEntryPrice:baselineEntry.economicOutcomePrice,baselineEntryPriceRawYesLeg:baselineEntry.rawYesLeg,baselineEntryPriceSemantics:baselineEntry.semantics,
      baselineFillTime:fillTime,baselineFillTimeRaw:fillTimeRaw,
      baselineFireTime:null,baselineFireTimeReason:'NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE',baselineScore:b?.score??null,
      baselineFinalState:b?.finalResult||null,baselineExitReason:b?.exitReason||null,baselineClosedAt:b?.closedAt||null,
      baselineRealizedPnlUsd:enrich.realizedPnl,baselineRealizedPnlReason:enrich.realizedPnlReason,
      payneToBaselineFillDeltaMs:delta,payneTimingVsBaseline:timing,
      entryPriceDelta:Number.isFinite(entryPrice)&&Number.isFinite(baselineEntry.economicOutcomePrice)?Number((baselineEntry.economicOutcomePrice-entryPrice).toFixed(6)):null,
    });
  }
  const baselineUnique=new Map();
  for(const s of snapshots){
    const b=s?.comparison?.baselineReal;
    if(b?.filled!==true)continue;
    const key=String(b.orderId||[s?.selected?.ticker,s?.selected?.outcomeSide,b.fillTime].join('|'));
    if(!baselineUnique.has(key)){
      const normalizedEntry=normalizeBaselineEconomicEntryPrice(b.entryPrice,s?.selected?.outcomeSide);
      baselineUnique.set(key,{ticker:s?.selected?.ticker||null,outcomeSide:s?.selected?.outcomeSide||null,fillTime:forensicIsoTime(b.fillTime),fillTimeRaw:b.fillTime??null,entryPrice:normalizedEntry.economicOutcomePrice,entryPriceRawYesLeg:normalizedEntry.rawYesLeg,entryPriceSemantics:normalizedEntry.semantics,orderId:b.orderId||null});
    }
  }
  const fireKeys=new Set(rows.map(r=>[r.ticker,r.outcomeSide,r.marketClose].join('|')));
  const reverseBaselineView=[...baselineUnique.values()].map(x=>{
    const matches=rows.filter(r=>r.ticker===x.ticker&&r.outcomeSide===x.outcomeSide);
    return {...x,classification:matches.length?'BASELINE_FILLED_PAYNE_FIRED':'BASELINE_FILLED_PAYNE_DID_NOT_FIRE'};
  });
  const sumClass=name=>rows.filter(r=>r.outcomeClassification===name).length;
  const baselineCount=name=>rows.filter(r=>r.baselineClass===name).length;
  const preFeeRows=rows.filter(r=>Number.isFinite(r.preFeeHypotheticalPnlUsd));
  const summary={
    checkpointRequested:checkpointLimit,authoritativeWouldFireTotal:authoritativeTotal,totalWouldFireAnalyzed:rows.length,
    profitable:sumClass('PROFITABLE'),unprofitable:sumClass('UNPROFITABLE'),unresolved:sumClass('UNRESOLVED'),notEnoughAuthoritativeEvidence:sumClass('NOT_ENOUGH_AUTHORITATIVE_EVIDENCE'),
    directionallyCorrect:rows.filter(r=>r.directionalClassification==='DIRECTIONALLY_CORRECT').length,
    directionallyWrong:rows.filter(r=>r.directionalClassification==='DIRECTIONALLY_WRONG').length,
    grossHypotheticalPnlUsd:preFeeRows.length?Number(preFeeRows.reduce((s,r)=>s+r.preFeeHypotheticalPnlUsd,0).toFixed(6)):null,
    netHypotheticalPnlUsd:null,netPnlReason:'EXIT_FEES_NOT_AUTHORITATIVELY_RECONSTRUCTED',
    preFeeHypotheticalPnlUsd:preFeeRows.length?Number(preFeeRows.reduce((s,r)=>s+r.preFeeHypotheticalPnlUsd,0).toFixed(6)):null,
    pnlCalculableRows:preFeeRows.length,
    averageHypotheticalEntry:forensicAverage(rows.map(r=>r.hypotheticalEntryPrice)),
    medianHypotheticalEntry:forensicMedian(rows.map(r=>r.hypotheticalEntryPrice)),
    averageScore:forensicAverage(rows.map(r=>r.score)),medianScore:forensicMedian(rows.map(r=>r.score)),
    averageTimeRemainingMs:forensicAverage(rows.map(r=>r.timeRemainingMs)),
    payneBaselineOverlapCount:rows.filter(r=>r.baselineMatchingContract===true).length,
    payneBaselineFillOverlapCount:baselineCount('PAYNE_FIRED_BASELINE_FILLED'),
    payneBaselineNoFillOverlapCount:baselineCount('PAYNE_FIRED_BASELINE_NO_FILL'),
    payneOnlyCount:baselineCount('PAYNE_FIRED_BASELINE_DID_NOT_ATTEMPT'),
    baselineFillOnlyCount:reverseBaselineView.filter(x=>x.classification==='BASELINE_FILLED_PAYNE_DID_NOT_FIRE').length,
    sameSideOverlapCount:rows.filter(r=>r.baselineSideSame===true&&r.baselineMatchingContract===true).length,
    oppositeSideOverlapCount:rows.filter(r=>r.baselineSideSame===false&&r.baselineMatchingContract===true).length,
  };
  const buckets={
    score:forensicBucketSummary(rows,r=>{const v=forensicNumber(r.score);return v===null?'UNKNOWN':v<.75?'.70-.74':v<.80?'.75-.79':v<.85?'.80-.84':'.85+';}),
    entryPrice:forensicBucketSummary(rows,r=>{const v=forensicNumber(r.hypotheticalEntryPrice);return v===null?'UNKNOWN':v<.50?'<.50':v<.70?'.50-.69':v<.85?'.70-.84':'.85+';}),
    timeRemaining:forensicBucketSummary(rows,r=>{const m=forensicNumber(r.timeRemainingMs);return m===null?'UNKNOWN':m<8*60_000?'6.5-8m':m<10*60_000?'8-10m':'10m+';}),
    asset:forensicBucketSummary(rows,r=>r.asset||'UNKNOWN'),
    direction:forensicBucketSummary(rows,r=>r.direction||'UNKNOWN'),
  };
  return {
    ok:true,schema:'PAYNE_WOULD_FIRE_FORENSIC_V1',generatedAt:new Date().toISOString(),
    checkpoint:{requestedWouldFireCount:checkpointLimit,analyzedCount:rows.length,authoritativeCurrentTotal:authoritativeTotal,advancedBeyondCheckpoint:authoritativeTotal>checkpointLimit},
    summary,buckets,reverseBaselineView,rows,
    baselineCurrentEvidence:{
      executionTestStateHttpStatus:baselineSources.state.status??null,
      noFillForensicHttpStatus:baselineSources.noFill.status??null,
      providerHistoryHttpStatus:baselineSources.history.status??null,
      note:'Persisted per-event comparison is primary attribution. Account-wide provider history is enrichment only and is not silently treated as Baseline attribution.'
    },
    limitations:[
      'Baseline FIRE/submission time is not exposed; fill time remains separately labeled.',
      'Net hypothetical P/L is UNKNOWN because attributable hypothetical exit fees are not reconstructed.',
      'Promoted PAYNE Paper lifecycle P/L is calculated only when an authoritative same-ticker/side exit quote is present at decision_exit or within 15 seconds of the 5-minute max_hold deadline.',
      'Settlement correctness is reported separately from financial profitability.',
      'Historical opposite-side Baseline attempts cannot be inferred when persisted comparison did not expose them.',
    ],
    safety:{providerWrites:0,orders:0,capitalMovedUsd:0,providerPost:'HELD / HARD DISABLED',realExecution:'DISABLED',fundingAuthority:'DISABLED',secondIoc:'HOLD',baselineWrites:0,baselineDeployments:0}
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
  'paynePaperComparisonStatus',
  'realStateAsOf','realSeriesId','realArmed','attemptsStarted','attemptTarget','attemptsRemaining',
  'filledCount','noFillCount','unknownCount','lastAttemptResult','lastProviderOrderId','realSeriesStatus','lastRealLedgerEvent'
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

function exportRowsFromSnapshots(snapshots, currentRealExecution=null) {
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
        realStateAsOf:snapshot?.realExecution?.asOf||currentRealExecution?.asOf||null,
        realSeriesId:snapshot?.realExecution?.seriesId??currentRealExecution?.seriesId??null,
        realArmed:snapshot?.realExecution?.armed??currentRealExecution?.armed??null,
        attemptsStarted:snapshot?.realExecution?.attempted??currentRealExecution?.attempted??null,
        attemptTarget:snapshot?.realExecution?.target??currentRealExecution?.target??null,
        attemptsRemaining:snapshot?.realExecution?.remaining??currentRealExecution?.remaining??null,
        filledCount:snapshot?.realExecution?.filled??currentRealExecution?.filled??null,
        noFillCount:snapshot?.realExecution?.noFill??currentRealExecution?.noFill??null,
        unknownCount:snapshot?.realExecution?.unknown??currentRealExecution?.unknown??null,
        lastAttemptResult:snapshot?.realExecution?.lastAttempt?.result??currentRealExecution?.lastAttempt?.result??null,
        lastProviderOrderId:snapshot?.realExecution?.lastAttempt?.providerOrderId??currentRealExecution?.lastAttempt?.providerOrderId??null,
        realSeriesStatus:snapshot?.realExecution?.status??currentRealExecution?.status??null,
        lastRealLedgerEvent:snapshot?.realExecution?.latestLedgerEvent?.type??currentRealExecution?.latestLedgerEvent?.type??null,
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
  const currentRealExecution=await buildRealExecutionObservability(env);
  const rows=exportRowsFromSnapshots(snapshots,currentRealExecution);
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
    realExecution:currentRealExecution,
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

  const providerFinancialSyncedAt=balance.ok?new Date(nowMs).toISOString():null;
  const discovery=await discoverCockpitMarkets(env,{nowMs});
  providerGets+=Number(discovery.providerGets||0);
  const [featureState,positions,latestPersistent,realExecution,realSeries,realLedger]=await Promise.all([
    readAuthoritativePayneFeatures(env,discovery.markets||[],nowMs),
    listPositionSnapshots(env),
    kvGetJson(env,CURRENT_KEY),
    buildRealExecutionObservability(env),
    loadRealSeriesState(env),
    listRealLedger(env,1000),
  ]);
  const candidates=buildCandidateViews(discovery.markets||[],featureState,control.activeThreshold,realSeries,realLedger,nowMs);
  const selected=candidates.find(x=>x.paperReady===true)||candidates[0]||null;

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

  const index2=providerIndex2Evidence(balance.body);
  const financials=buildAccountFinancialSummary({
    balanceBody:balance.body,
    ledger:realLedger,
    series:realSeries,
    providerSyncedAt:providerFinancialSyncedAt,
    nowMs,
  });
  const baselineActual=selected?await readBaselineActualComparison(env,selected):{
    source:'BASELINE_REAL_EXECUTION_TEST_READ_ONLY',lane:'EXECUTION_TEST_NOT_PRODUCTION_BASELINE',
    available:false,reason:'NO_SELECTED_CONTRACT',sawMatchingContract:'UNKNOWN',sameTicker:'UNKNOWN',sameDirection:'UNKNOWN',
    attempted:'UNKNOWN',filled:'UNKNOWN',fireTime:null,fillTime:null,entryPrice:null,score:null
  };
  const payne=selected?.payne||{
    source:featureState?.source||'KALSHI_AUTHORITATIVE',
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
  const zeroMoneyPreview=zeroMoneyPreviewFor(selected,preSubmit,index2,control,nowMs);
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

  const realAuthority=livePayneAuthorityEvidence(control,index2,zeroMoneyPreview?.estimatedDebitUsd==null?null:{totalDebitUsd:zeroMoneyPreview.estimatedDebitUsd});

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
    financials,
    index2,
    control:{
      armed:Boolean(control.armed),
      attempts:Number(control.attempts||0),
      attemptTarget:control.attemptTarget,
      openPositions:Number(control.openPositions||0),
      maxPositions:control.maxPositions,
      maxEntryDebitUsd:control.maxEntryDebitUsd,
      threshold:control.activeThreshold,
      effectiveLockThreshold:effectiveLockThreshold(control.activeThreshold),
      diagnosticLowerLockMode:false,
      thresholdInput:{min:FOUNDER_THRESHOLD_MIN,max:FOUNDER_THRESHOLD_MAX,decimals:FOUNDER_THRESHOLD_DECIMALS},
      stakeOptions:CONTROL_STAKE_OPTIONS,
      attemptOptions:CONTROL_ATTEMPT_OPTIONS,
      scanEnabled:control.scanEnabled,
      realExecution:control.realExecution,
      fundingAuthority:control.fundingAuthority,
      providerWriteAuthority:control.providerWriteAuthority,
      providerPostAuthority:control.providerPostAuthority,
      requiredExchangeIndex:2,
    },
    markets:discovery.markets||[],
    candidates,
    selected,
    payne,
    featureProvenance:{
      source:featureState.source,
      transport:featureState.transport||null,
      spotTransport:featureState.spotTransport||null,
      binding:featureState.binding||null,
      endpoint:featureState.endpoint,
      httpStatus:featureState.httpStatus,
      status:featureState.status,
      lastRunAt:featureState.lastRunAt,
      calculationAt:featureState.calculationAt||featureState.lastRunAt||null,
      ageMs:featureState.ageMs,
      fresh:featureState.fresh,
      baselineStateRead:featureState.baselineStateRead===true,
      strategyAuthority:featureState.strategyAuthority||'PAYNE_PAPER',
      paperSource:featureState.sourceProof||PAYNE_PAPER_SOURCE,
      paperSourceCadenceMs:featureState.sourceCadenceMs??PAYNE_PAPER_RULES.sourceCadenceMs,
      paperSourceAssets:featureState.sourceAssets||[...PAYNE_PAPER_RULES.sourceAssets],
      spotReadFailures:featureState.spotReadFailures||[],
      error:featureState.error,
    },
    realAuthority,
    pipeline:{
      radar:qualificationDecision.radar==='RADAR_PASS'?'PASS':qualificationDecision.radar==='RADAR_REJECT'?'REJECT':'UNKNOWN',
      lockIn:qualificationDecision.lock==='LOCK_PASS'?'PASS':qualificationDecision.lock==='LOCK_REJECT'?'REJECT':qualificationDecision.lock==='LOCK_NOT_REACHED'?'NOT_REACHED':'UNKNOWN',
      pullTrigger:qualificationDecision.pull==='PULL_QUALIFIED'?'QUALIFIED':qualificationDecision.pull==='PULL_REJECTED'?'REJECT':qualificationDecision.pull==='PULL_NOT_REACHED'?'NOT_REACHED':'UNKNOWN',
      qualificationDecision,
      finalDecision,
      fireState:zeroMoneyPreview?.status==='FIRE_READY'?(realAuthority.providerWriteAuthorized?'FIRE READY / REAL EXECUTION AUTHORIZED':'FIRE READY / REAL EXECUTION '+realAuthority.providerPost):'NOT READY',
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
      marketExchangeIndex:selected?.exchangeIndex??null,
      requiredFundingIndex:Number(control.requiredExchangeIndex),
      shardMatch:selected?Number(selected.exchangeIndex)===Number(control.requiredExchangeIndex):null,
      fundingBalanceUsd:index2?.balance??null,
      feeSafeSizing:zeroMoneyPreview?.sizing?.ok===false?'FAIL':zeroMoneyPreview?.status==='FIRE_READY'?'PASS':'NOT_REACHED',
      iocPayload:zeroMoneyPreview?.status==='FIRE_READY'?'PASS':'NOT_REACHED',
      fundingGate:{
        index2:index2.status,
        fundingAuthority:control.fundingAuthority,
        result:realAuthority.fundingGate,
        zeroMoneyPreviewResult:zeroMoneyPreview?.fundingGate||null,
      },
      providerPost:realAuthority.providerPost,
      providerPostAuthority:control.providerPostAuthority,
      zeroMoneyProviderPost:zeroMoneyPreview?.providerPost||null,
    },
    observations:{initial:selected,freshLock,preSubmit},
    clocks,
    comparison,
    realExecution,
    researchCounters:latestPersistent?.researchCounters||{
      observationsCollected:0,contractsExamined:0,radarCount:0,lockCount:0,pullCount:0,wouldFireCount:0,rejectCount:0,
      freshLockInvalidations:0,preSubmitInvalidations:0,windowMismatches:0,baselineActualMatches:0,baselineActualFills:0,
      paynePaperMatches:0,unknownPaperComparisons:0,
    },
    zeroMoneyPreview,
    management:managementView(control,positions,selected),
    discovery:{
      ok:discovery.ok,
      source:discovery.source,
      assets:discovery.assets,
      currentContractCount:(discovery.markets||[]).length,
    },
    safety:{
      payneArmed:Boolean(control.armed),
      realExecution:control.realExecution,
      fundingAuthority:control.fundingAuthority,
      providerWrites:0,orders:0,capitalMovedUsd:0,getOnly:'ACTIVE',
      providerPost:control.providerPostAuthority,zeroMoneyProviderPost:'HARD_DISABLED',secondIoc:'HOLD',
    },
  };
}


const SERIES_BLOCKING_POSITION_STATUSES = Object.freeze(['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN']);

// The ACTIVE series' own frozen config. The execution engine reads run config ONLY from here.
export function frozenSeriesConfig(series) {
  const attemptTarget=Number(series?.attemptTarget), threshold=Number(series?.threshold), effectiveLock=Number(series?.effectiveLockThreshold);
  const maxEntryDebitUsd=Number(series?.maxEntryDebitUsd), requiredExchangeIndex=Number(series?.requiredExchangeIndex);
  const parsed=parseFounderThreshold(String(threshold));
  const ok=series?.configFrozen===true
    && Number.isInteger(attemptTarget) && attemptTarget>=1
    && parsed.ok
    && Number.isFinite(effectiveLock) && effectiveLock===effectiveLockThreshold(threshold)
    && Number.isFinite(maxEntryDebitUsd) && maxEntryDebitUsd>0
    && requiredExchangeIndex===2;
  return {ok,attemptTarget,threshold,effectiveLockThreshold:effectiveLock,maxEntryDebitUsd,requiredExchangeIndex};
}

export function seriesTerminal(series) {
  return Boolean(series?.completedAt) || Number(series?.attemptsStarted||0)>=Number(series?.attemptTarget||1);
}

function frozenSeriesMatchesControl(series,control) {
  const frozen=frozenSeriesConfig(series);
  if(!frozen.ok) return false;
  const threshold=Number(control?.activeThreshold);
  return frozen.attemptTarget===Number(control?.attemptTarget)
    && frozen.threshold===threshold
    && frozen.effectiveLockThreshold===effectiveLockThreshold(threshold)
    && frozen.maxEntryDebitUsd===Number(control?.maxEntryDebitUsd)
    && frozen.requiredExchangeIndex===2
    && Number(control?.requiredExchangeIndex)===2;
}

async function reconcileDisarmedSupersededSeries(env,series,control,nowMs=Date.now()) {
  if(control?.armed===true || seriesTerminal(series)) return {series,terminalized:false,reason:'NOT_APPLICABLE'};
  const started=Number(series?.attemptsStarted||0), target=Number(series?.attemptTarget||1);
  if(!(started>0 && started<target)) return {series,terminalized:false,reason:'NOT_UNFINISHED'};
  const frozen=frozenSeriesConfig(series);
  if(!frozen.ok) return {series,terminalized:false,reason:'SERIES_NOT_FROZEN'};
  const gate=seriesInterlock(series);
  if(!gate.clear) return {series,terminalized:false,reason:'PRIOR_ATTEMPT_NOT_CLEAN_'+gate.reason};

  if(series?.accountingSemantics!==PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS){
    const completedAt=new Date(nowMs).toISOString();
    const next={
      ...series,
      status:'TERMINAL_LEGACY_ACCOUNTING_QUARANTINED',
      completedAt,
      terminalReason:'LEGACY_PRE_PROVIDER_ACCOUNTING_NON_RESUMABLE',
      accountingSemantics:LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS,
      legacyQuarantined:true,
    };
    await appendRealLedger(env,'SERIES_LEGACY_ACCOUNTING_QUARANTINED',{
      seriesId:series.seriesId,
      attemptsStarted:started,
      attemptTarget:target,
      threshold:frozen.threshold,
      maxEntryDebitUsd:frozen.maxEntryDebitUsd,
      accountingSemantics:LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS,
      historicalCountsPreserved:true,
      unresolvedEntry:false,
      ownedPosition:false,
      providerWrites:0,
      orders:0,
      capitalMovedUsd:0,
    });
    return {series:await saveRealSeriesState(env,next),terminalized:true,reason:'LEGACY_ACCOUNTING_QUARANTINED'};
  }

  if(frozenSeriesMatchesControl(series,control)) return {series,terminalized:false,reason:'CONFIG_MATCHES_RESUMABLE'};
  const completedAt=new Date(nowMs).toISOString();
  const next={...series,status:'TERMINAL_DISARMED_CONFIG_SUPERSEDED',completedAt,terminalReason:'FOUNDER_CONFIG_CHANGED_WHILE_DISARMED'};
  await appendRealLedger(env,'SERIES_TERMINAL_DISARMED_CONFIG_SUPERSEDED',{
    seriesId:series.seriesId,attemptsStarted:started,attemptTarget:target,
    frozenThreshold:frozen.threshold,nextThreshold:Number(control?.activeThreshold),
    frozenStake:frozen.maxEntryDebitUsd,nextStake:Number(control?.maxEntryDebitUsd),
    frozenAttemptTarget:frozen.attemptTarget,nextAttemptTarget:Number(control?.attemptTarget),
    unresolvedEntry:false,ownedPosition:false,providerWrites:0,capitalMovedUsd:0,
  });
  return {series:await saveRealSeriesState(env,next),terminalized:true,reason:'CLEAN_CONFIG_MISMATCH_SUPERSEDED'};
}

// Attempt N+1 may begin only if attempt N is authoritatively clean.
export function seriesInterlock(series) {
  const pos=series?.position||null;
  const posStatus=String(pos?.status||'');
  const attemptStatus=String(series?.currentAttempt?.status||'').toUpperCase();
  const seriesStatus=String(series?.status||'');
  if (series?.unresolvedEntry===true) return {clear:false,reason:'UNRESOLVED_ENTRY'};
  if (pos && (pos.owner!==REAL_OWNER || Number(pos.exchangeIndex)!==2)) return {clear:false,reason:'POSITION_OWNERSHIP_UNKNOWN'};
  if (pos && SERIES_BLOCKING_POSITION_STATUSES.includes(posStatus)) return {clear:false,reason:'POSITION_'+posStatus};
  if (pos && (posStatus!=='CLOSED' || String(pos.reconciliationState||'')!=='FLAT')) return {clear:false,reason:'POSITION_NOT_PROVEN_FLAT'};
  if (['SUBMITTING','WRITE_ERROR_UNKNOWN','PROVIDER_REJECTED_OR_UNKNOWN','UNKNOWN'].includes(attemptStatus)) return {clear:false,reason:'ATTEMPT_RESULT_UNKNOWN'};
  if (/^(ENTRY_SUBMITTING|ENTRY_RECONCILIATION_REQUIRED|ENTRY_AUTHORITY_REVOKED_AFTER_LATCH|MANAGEMENT_|EXIT_|HOLD_WRONG_OR_UNKNOWN_OWNERSHIP)/.test(seriesStatus)) return {clear:false,reason:'MANAGEMENT_REQUIRED_STATE'};
  return {clear:true,reason:'CLEAN'};
}

export function defaultRealSeriesState() {
  return {
    schema:'PAYNE_REAL_SERIES_V1',
    owner:REAL_OWNER,
    seriesId:null,
    status:'READY_DISARMED',
    accountingSemantics:PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS,
    legacyQuarantined:false,
    attemptsStarted:0,
    executionIntentsStarted:0,
    attemptTarget:1,
    threshold:PAYNE_CONFIG.defaultThreshold,
    effectiveLockThreshold:PAYNE_PAPER_RULES.lockScore,
    maxEntryDebitUsd:1,
    requiredExchangeIndex:2,
    configFrozen:false,
    frozenAt:null,
    unresolvedEntry:false,
    fireLatch:null,
    currentAttempt:null,
    position:null,
    completedAt:null,
    updatedAt:new Date().toISOString(),
  };
}

export async function loadRealSeriesState(env) {
  const saved=await kvGetJson(env,REAL_SERIES_KEY);
  const base=defaultRealSeriesState();
  if(!saved || saved?.schema!=='PAYNE_REAL_SERIES_V1' || saved?.owner!==REAL_OWNER) return base;
  return {
    ...base,
    ...saved,
    owner:REAL_OWNER,
    requiredExchangeIndex:2,
    accountingSemantics:saved?.accountingSemantics===PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS
      ?PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS
      :LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS,
    legacyQuarantined:saved?.legacyQuarantined===true,
    attemptsStarted:Number.isFinite(Number(saved?.attemptsStarted))?Math.max(0,Math.trunc(Number(saved.attemptsStarted))):0,
    executionIntentsStarted:Number.isFinite(Number(saved?.executionIntentsStarted))
      ?Math.max(0,Math.trunc(Number(saved.executionIntentsStarted)))
      :Math.max(0,Math.trunc(Number(saved?.attemptsStarted||0))),
  };
}

export async function saveRealSeriesState(env,state) {
  const next={...defaultRealSeriesState(),...state,owner:REAL_OWNER,requiredExchangeIndex:2,updatedAt:new Date().toISOString()};
  await kvPutJson(env,REAL_SERIES_KEY,next);
  return next;
}

export async function appendRealLedger(env,type,payload={}) {
  const at=new Date().toISOString(), id=crypto.randomUUID();
  const row={schema:'PAYNE_REAL_LEDGER_V1',recordId:id,at,owner:REAL_OWNER,type,...payload};
  await kvPutJson(env,REAL_LEDGER_PREFIX+at+':'+id,row);
  return row;
}

export async function listRealLedger(env,limit=200) {
  const kv=binding(env);
  if(typeof kv.list!=='function') return [];
  const page=await kv.list({prefix:REAL_LEDGER_PREFIX,limit:Math.max(1,Math.min(1000,Number(limit)||200))});
  const rows=[];
  for(const item of page?.keys||[]){const x=await kvGetJson(env,item.name);if(x)rows.push(x);}
  return rows.sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-Math.max(1,Math.min(1000,Number(limit)||200)));
}

export async function listRealAttemptsForSeries(env,seriesId) {
  const id=String(seriesId||'').trim();
  if(!id) return [];
  const kv=binding(env);
  if(typeof kv.list!=='function') return [];
  const page=await kv.list({prefix:ATTEMPT_PREFIX+id+':',limit:1000});
  const rows=[];
  for(const item of page?.keys||[]){const x=await kvGetJson(env,item.name);if(x)rows.push(x);}
  return rows.sort((a,b)=>{
    const ai=Number.isFinite(Number(a?.intentNo))?Number(a.intentNo):Number(a?.attemptNo||0);
    const bi=Number.isFinite(Number(b?.intentNo))?Number(b.intentNo):Number(b?.attemptNo||0);
    return ai-bi;
  });
}

function latestAttemptClassification(attempt,rows=[]) {
  const ordered=[...(Array.isArray(rows)?rows:[])].sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0));
  let classification=null, terminalReason=null;
  for(const row of ordered){
    const type=String(row?.type||'');
    if(type==='ENTRY_NO_FILL' || type==='ENTRY_RECONCILED_ORDER_ZERO_FILL'){
      classification='NO_FILL'; terminalReason=type;
    } else if(type==='ENTRY_LOCAL_PRE_PROVIDER_REJECTED' || type==='FIRE_SPECIMEN_INVALIDATED_BEFORE_POST'){
      classification='INVALIDATED_BEFORE_POST'; terminalReason=type;
    } else if(type==='ENTRY_RECONCILED_NO_EXECUTION'){
      classification='NO_PROVIDER_EXECUTION'; terminalReason=type;
    } else if(type==='ENTRY_RECONCILED_OWNED' || type==='ENTRY_RECONCILED_SETTLED_FLAT' || type==='POSITION_OWNERSHIP_ESTABLISHED'){
      classification='FILLED'; terminalReason=type;
    } else if(['ENTRY_RESULT_UNKNOWN','ENTRY_PROVIDER_REJECTED_OR_UNKNOWN','ENTRY_WRITE_ERROR_UNKNOWN','ENTRY_RECONCILIATION_STILL_UNKNOWN'].includes(type)){
      classification='UNKNOWN'; terminalReason=type;
    }
  }
  const state=String(attempt?.providerResult?.state||attempt?.status||attempt?.result||'').toUpperCase();
  if(classification===null){
    if(state==='FILLED'||state==='PARTIAL') classification='FILLED';
    else if(state==='NO_FILL') classification='NO_FILL';
    else if(state==='INVALIDATED_BEFORE_POST') classification='INVALIDATED_BEFORE_POST';
    else if(state==='NO_PROVIDER_EXECUTION'||state==='PROVIDER_RECONCILED_NO_EXECUTION') classification='NO_PROVIDER_EXECUTION';
    else if(state==='UNKNOWN'||state.includes('UNKNOWN')) classification='UNKNOWN';
  }
  return {classification:classification||'UNKNOWN',terminalReason};
}

function latestFiniteLedgerValue(rows,field){
  const ordered=[...(Array.isArray(rows)?rows:[])].sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0));
  for(let i=ordered.length-1;i>=0;i--){
    const n=Number(ordered[i]?.[field]);
    if(Number.isFinite(n)) return n;
  }
  return null;
}

function latestEventByType(rows,type){
  const filtered=(Array.isArray(rows)?rows:[]).filter(x=>String(x?.type||'')===String(type));
  return filtered.length?filtered.sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0))[filtered.length-1]:null;
}

export function summarizeHistoricalAttempt({attempt={},ledgerRows=[],position=null,seriesConfig=null}={}) {
  const attemptId=attempt?.attemptId||null;
  const rows=(Array.isArray(ledgerRows)?ledgerRows:[]).filter(x=>!attemptId || String(x?.attemptId||'')===String(attemptId));
  const classification=latestAttemptClassification(attempt,rows);
  const entryResult=attempt?.providerResult||{};
  const ownership=latestEventByType(rows,'POSITION_OWNERSHIP_ESTABLISHED')||latestEventByType(rows,'ENTRY_RECONCILED_OWNED');
  const exitResult=latestEventByType(rows,'EXIT_PROVIDER_RESULT');
  const reconciledFlat=latestEventByType(rows,'PROVIDER_RECONCILED_FLAT');
  const reconciledNoExecution=latestEventByType(rows,'ENTRY_RECONCILED_NO_EXECUTION');
  const settledFlat=latestEventByType(rows,'ENTRY_RECONCILED_SETTLED_FLAT');
  const preSubmit=latestEventByType(rows,'ENTRY_PRE_SUBMIT_LATCHED');
  const entryFee=Number.isFinite(Number(entryResult?.averageFeePaid))?Number(entryResult.averageFeePaid):
    Number.isFinite(Number(position?.entryAverageFeePaid))?Number(position.entryAverageFeePaid):null;
  const exitFee=Number.isFinite(Number(exitResult?.result?.averageFeePaid))?Number(exitResult.result.averageFeePaid):
    Number.isFinite(Number(position?.exitAverageFeePaid))?Number(position.exitAverageFeePaid):null;
  const netRealized=latestFiniteLedgerValue(rows,'realizedPnlUsd');
  const terminalNoEconomicExecution=['NO_FILL','NO_PROVIDER_EXECUTION','INVALIDATED_BEFORE_POST'].includes(classification.classification);
  const netPnlUsd=netRealized!==null?netRealized:(terminalNoEconomicExecution?0:null);
  const totalFees=(entryFee!==null||exitFee!==null)?Number(((entryFee||0)+(exitFee||0)).toFixed(4)):(terminalNoEconomicExecution?0:null);
  const grossRealizedPnlUsd=netPnlUsd!==null&&totalFees!==null?Number((netPnlUsd+totalFees).toFixed(4)):null;
  return {
    intentNo:Number.isFinite(Number(attempt?.intentNo))?Number(attempt.intentNo):null,
    attemptNo:Number.isFinite(Number(attempt?.attemptNo))?Number(attempt.attemptNo):null,
    providerAttemptNo:Number.isFinite(Number(attempt?.providerAttemptNo))?Number(attempt.providerAttemptNo):
      (Number.isFinite(Number(attempt?.attemptNo))?Number(attempt.attemptNo):null),
    attemptId,
    asset:attempt?.asset||preSubmit?.asset||position?.asset||null,
    ticker:attempt?.marketTicker||preSubmit?.marketTicker||preSubmit?.ticker||position?.marketTicker||null,
    direction:attempt?.direction||preSubmit?.direction||position?.direction||null,
    outcomeSide:attempt?.outcomeSide||preSubmit?.outcomeSide||position?.outcomeSide||null,
    score:attempt?.score??preSubmit?.score??position?.entryScore??null,
    threshold:seriesConfig?.threshold??attempt?.threshold??null,
    stakeUsd:seriesConfig?.maxEntryDebitUsd??attempt?.maxEntryDebitUsd??null,
    freshLockPrice:attempt?.freshLockPrice??preSubmit?.freshLockPrice??null,
    preSubmitPrice:attempt?.preSubmitPrice??preSubmit?.preSubmitPrice??null,
    payloadSide:attempt?.payload?.side??preSubmit?.payload?.side??null,
    payloadPrice:attempt?.payload?.price??preSubmit?.payload?.price??null,
    clientOrderId:attempt?.clientOrderId??preSubmit?.clientOrderId??entryResult?.clientOrderId??null,
    writerInvoked:attempt?.writerInvoked===true,
    providerPostStarted:attempt?.providerPostStarted===true,
    providerOrderId:entryResult?.orderId??ownership?.entryOrderId??position?.entryOrderId??null,
    providerResponseState:attempt?.providerResponseState??entryResult?.state??null,
    httpStatus:attempt?.providerHttpStatus??latestEventByType(rows,'ENTRY_PROVIDER_REJECTED_OR_UNKNOWN')?.httpStatus??null,
    fillCount:Number.isFinite(Number(entryResult?.fillCount))?Number(entryResult.fillCount):
      Number.isFinite(Number(ownership?.filledCount))?Number(ownership.filledCount):null,
    remainingCount:Number.isFinite(Number(entryResult?.remainingCount))?Number(entryResult.remainingCount):null,
    averageFillPrice:entryResult?.averageFillPrice??position?.entryAverageFillPrice??null,
    entryFeeUsd:entryFee,
    entryDebitUsd:attempt?.estimatedEntryDebitUsd??preSubmit?.estimatedEntryDebitUsd??null,
    exitPrice:exitResult?.result?.averageFillPrice??position?.exitAverageFillPrice??null,
    exitFeeUsd:exitFee,
    settlement:settledFlat||null,
    reconciliation:reconciledNoExecution?.reconciliation||reconciledFlat?.reason||settledFlat?.reason||classification.terminalReason||null,
    finalResult:classification.classification,
    grossRealizedPnlUsd,
    totalFeesUsd:totalFees,
    netRealizedPnlUsd:netPnlUsd,
  };
}

export async function buildHistoricalSeriesReport(env,seriesId) {
  const id=String(seriesId||'').trim();
  if(!id) throw new Error('PAYNE_HISTORY_SERIES_ID_REQUIRED');
  const [ledger,attempts,currentSeries,run]=await Promise.all([
    listRealLedger(env,1000),
    listRealAttemptsForSeries(env,id),
    loadRealSeriesState(env),
    kvGetJson(env,RUN_PREFIX+id),
  ]);
  const rows=ledger.filter(x=>String(x?.seriesId||'')===id);
  const seriesConfig=run||((String(currentSeries?.seriesId||'')===id)?currentSeries:null);
  const perAttempt=[];
  for(const attempt of attempts){
    const position=await kvGetJson(env,POSITION_PREFIX+String(attempt?.attemptId||''));
    perAttempt.push(summarizeHistoricalAttempt({attempt,ledgerRows:rows,position,seriesConfig}));
  }
  const filled=perAttempt.filter(x=>x.finalResult==='FILLED').length;
  const noFill=perAttempt.filter(x=>x.finalResult==='NO_FILL').length;
  const unknownUnresolved=perAttempt.filter(x=>x.finalResult==='UNKNOWN').length;
  const knownNet=perAttempt.filter(x=>x.netRealizedPnlUsd!==null);
  const knownFees=perAttempt.filter(x=>x.totalFeesUsd!==null);
  const netRealizedPnlUsd=knownNet.length?Number(knownNet.reduce((a,x)=>a+Number(x.netRealizedPnlUsd||0),0).toFixed(4)):0;
  const totalFeesUsd=knownFees.length?Number(knownFees.reduce((a,x)=>a+Number(x.totalFeesUsd||0),0).toFixed(4)):0;
  const grossRealizedPnlUsd=Number((netRealizedPnlUsd+totalFeesUsd).toFixed(4));
  return {
    ok:true,
    schema:'PAYNE_REAL_SERIES_HISTORY_V1',
    readOnly:true,
    seriesId:id,
    threshold:seriesConfig?.threshold??null,
    stakeUsd:seriesConfig?.maxEntryDebitUsd??null,
    attemptTarget:seriesConfig?.attemptTarget??null,
    accountingSemantics:seriesConfig?.accountingSemantics
      ?? ((String(currentSeries?.seriesId||'')===id)?currentSeries?.accountingSemantics:null),
    legacyQuarantined:(String(currentSeries?.seriesId||'')===id)?currentSeries?.legacyQuarantined===true:false,
    attemptsCompleted:perAttempt.filter(x=>x.finalResult!=='UNKNOWN').length,
    attempted:perAttempt.length,
    filled,
    noFill,
    unknownUnresolved,
    grossRealizedPnlUsd,
    entryFeesUsd:Number(perAttempt.reduce((a,x)=>a+Number(x.entryFeeUsd||0),0).toFixed(4)),
    exitFeesUsd:Number(perAttempt.reduce((a,x)=>a+Number(x.exitFeeUsd||0),0).toFixed(4)),
    totalFeesUsd,
    netRealizedPnlUsd,
    attempts:perAttempt,
    providerWrites:0,
    ordersSubmittedByThisRead:0,
    capitalMovedUsd:0,
  };
}


export function summarizeRealExecutionState({control={},series={},ledger=[],asOf=new Date().toISOString()}={}) {
  const seriesId=series?.seriesId||null;
  const allRows=Array.isArray(ledger)?[...ledger].sort((a,b)=>Date.parse(a?.at||0)-Date.parse(b?.at||0)):[];
  const rows=seriesId?allRows.filter(row=>String(row?.seriesId||'')===String(seriesId)):allRows.filter(row=>!row?.seriesId);
  const executionIntentIds=new Set();
  const providerAttemptIds=new Set();
  const latestByAttempt=new Map();
  for(const row of rows){
    const attemptId=row?.attemptId||null;
    if(!attemptId) continue;
    const type=String(row?.type||'');
    if(['ENTRY_PRE_SUBMIT_LATCHED','ENTRY_LOCAL_PRE_PROVIDER_REJECTED','FIRE_SPECIMEN_INVALIDATED_BEFORE_POST','ENTRY_RECONCILED_NO_EXECUTION','ENTRY_PROVIDER_POST_STARTED','ENTRY_NO_FILL','ENTRY_RESULT_UNKNOWN','ENTRY_PROVIDER_REJECTED_OR_UNKNOWN','ENTRY_WRITE_ERROR_UNKNOWN','POSITION_OWNERSHIP_ESTABLISHED','ENTRY_RECONCILED_OWNED','ENTRY_RECONCILED_SETTLED_FLAT'].includes(type)) executionIntentIds.add(attemptId);
    if(['ENTRY_PROVIDER_POST_STARTED','ENTRY_NO_FILL','ENTRY_RESULT_UNKNOWN','ENTRY_PROVIDER_REJECTED_OR_UNKNOWN','ENTRY_WRITE_ERROR_UNKNOWN','POSITION_OWNERSHIP_ESTABLISHED','ENTRY_RECONCILED_OWNED','ENTRY_RECONCILED_SETTLED_FLAT'].includes(type)) providerAttemptIds.add(attemptId);
    if(!latestByAttempt.has(attemptId)) latestByAttempt.set(attemptId,[]);
    latestByAttempt.get(attemptId).push(row);
  }
  const classifications=new Map();
  for(const [attemptId,attemptRows] of latestByAttempt.entries()) classifications.set(attemptId,latestAttemptClassification({},attemptRows).classification);
  const filledIds=new Set([...classifications.entries()].filter(([,v])=>v==='FILLED').map(([k])=>k));
  const noFillIds=new Set([...classifications.entries()].filter(([,v])=>v==='NO_FILL').map(([k])=>k));
  const prePostInvalidatedIds=new Set([...classifications.entries()].filter(([,v])=>v==='INVALIDATED_BEFORE_POST').map(([k])=>k));
  const noProviderExecutionIds=new Set([...classifications.entries()].filter(([,v])=>v==='NO_PROVIDER_EXECUTION').map(([k])=>k));
  const unknownIds=new Set([...classifications.entries()].filter(([,v])=>v==='UNKNOWN').map(([k])=>k));
  const legacyAccounting=series?.accountingSemantics!==PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS;
  const historicalAttempted=Math.max(
    Number.isFinite(Number(series?.attemptsStarted))?Math.max(0,Math.trunc(Number(series.attemptsStarted))):0,
    Number.isFinite(Number(control?.attempts))?Math.max(0,Math.trunc(Number(control.attempts))):0
  );
  const providerOrderAttempts=legacyAccounting
    ? null
    : Math.max(historicalAttempted,providerAttemptIds.size);
  // Backward-compatible attempted remains the preserved historical series count for legacy records;
  // providerOrderAttempts is the truthful authenticated-provider boundary count.
  const attempted=legacyAccounting?historicalAttempted:providerOrderAttempts;
  const executionIntents=Math.max(
    Number.isFinite(Number(series?.executionIntentsStarted))?Math.max(0,Math.trunc(Number(series.executionIntentsStarted))):0,
    executionIntentIds.size
  );
  const target=Number.isFinite(Number(series?.attemptTarget))?Math.max(1,Math.trunc(Number(series.attemptTarget))):
    Number.isFinite(Number(control?.attemptTarget))?Math.max(1,Math.trunc(Number(control.attemptTarget))):1;
  const remaining=Math.max(0,target-attempted);
  const position=series?.position||null;
  const positionStatus=String(position?.status||'');
  const managing=Boolean(position && ['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN'].includes(positionStatus));
  const rawSeriesStatus=String(series?.status||'UNKNOWN');
  const status=managing?'MANAGING':
    rawSeriesStatus==='COMPLETE_NO_FILL'?'COMPLETE_NO_FILL':
    rawSeriesStatus.startsWith('COMPLETE')?'COMPLETE':
    rawSeriesStatus.startsWith('HOLD_')||rawSeriesStatus.includes('BLOCK')?'BLOCKED':
    control?.armed===true && remaining>0?'FISHING':
    control?.armed===false && attempted===0?'DISARMED':
    rawSeriesStatus||'UNKNOWN';

  const latestLedgerEvent=rows.length?rows[rows.length-1]:null;
  const currentAttempt=series?.currentAttempt||null;
  const providerResult=currentAttempt?.providerResult||null;
  let lastAttemptResult=executionIntents>0?'EXECUTION_INTENT':'NO_PROVIDER_ATTEMPT';
  const state=String(providerResult?.state||currentAttempt?.status||'').toUpperCase();
  if(state==='FILLED'||state==='PARTIAL') lastAttemptResult='FILLED';
  else if(state==='NO_FILL') lastAttemptResult='NO_FILL';
  else if(state==='NO_PROVIDER_EXECUTION'||state==='PROVIDER_RECONCILED_NO_EXECUTION') lastAttemptResult='NO_PROVIDER_EXECUTION';
  else if(state==='INVALIDATED_BEFORE_POST') lastAttemptResult='INVALIDATED_BEFORE_POST';
  else if(state==='UNKNOWN'||rawSeriesStatus.includes('UNKNOWN')||series?.unresolvedEntry===true) lastAttemptResult='UNKNOWN';
  else if(filledIds.size>0) lastAttemptResult='FILLED';
  else if(noFillIds.size>0) lastAttemptResult='NO_FILL';
  else if(noProviderExecutionIds.size>0) lastAttemptResult='NO_PROVIDER_EXECUTION';
  else if(unknownIds.size>0) lastAttemptResult='UNKNOWN';

  const holdReason=series?.fireLatch?.invalidationReason
    || currentAttempt?.providerResult?.reason
    || (attempted===0 && rawSeriesStatus.startsWith('HOLD_')?rawSeriesStatus:null);
  if(latestLedgerEvent?.type==='ENTRY_RECONCILED_NO_EXECUTION') lastAttemptResult='NO_PROVIDER_EXECUTION';
  if(latestLedgerEvent?.type==='ENTRY_LOCAL_PRE_PROVIDER_REJECTED' || latestLedgerEvent?.type==='FIRE_SPECIMEN_INVALIDATED_BEFORE_POST') lastAttemptResult='INVALIDATED_BEFORE_POST';
  const lastAttempt={
    result:lastAttemptResult,
    holdReason,
    intentNo:currentAttempt?.intentNo??null,
    providerAttemptNo:currentAttempt?.providerAttemptNo??currentAttempt?.attemptNo??null,
    asset:currentAttempt?.asset||position?.asset||null,
    ticker:currentAttempt?.marketTicker||position?.marketTicker||null,
    side:currentAttempt?.outcomeSide||position?.outcomeSide||null,
    direction:currentAttempt?.direction||position?.direction||null,
    score:currentAttempt?.score??position?.entryScore??null,
    move:currentAttempt?.move??position?.entryMove??null,
    edge:currentAttempt?.edge??position?.entryEdge??null,
    submittedPrice:currentAttempt?.preSubmitPrice??null,
    freshLockPrice:currentAttempt?.freshLockPrice??null,
    preSubmitPrice:currentAttempt?.preSubmitPrice??null,
    writerInvoked:currentAttempt?.writerInvoked===true,
    providerPostStarted:currentAttempt?.providerPostStarted===true,
    providerHttpStatus:currentAttempt?.providerHttpStatus??null,
    providerResponseState:currentAttempt?.providerResponseState??providerResult?.state??null,
    providerOrderId:providerResult?.orderId||position?.entryOrderId||null,
    timestamp:currentAttempt?.preSubmitAt||currentAttempt?.observedAt||position?.entryTime||latestLedgerEvent?.at||null,
  };
  return {
    schema:'PAYNE_REAL_OBSERVABILITY_V1',
    asOf,
    seriesId:series?.seriesId||null,
    armed:control?.armed===true,
    executionIntents,
    providerOrderAttempts,
    providerOrderAttemptsKnown:!legacyAccounting,
    attempted,target,remaining,
    filled:filledIds.size,
    noFill:noFillIds.size,
    invalidatedBeforePost:prePostInvalidatedIds.size,
    noProviderExecution:noProviderExecutionIds.size,
    providerReconciledNoExecution:noProviderExecutionIds.size,
    unknown:unknownIds.size,
    status,
    rawSeriesStatus,
    unresolvedEntry:series?.unresolvedEntry===true,
    ownedPositions:managing?1:0,
    fireSpecimen:series?.fireLatch?{
      specimenId:series.fireLatch.specimenId||null,
      ticker:series.fireLatch.ticker||null,
      side:series.fireLatch.outcomeSide||null,
      score:series.fireLatch.observedScore??null,
      latchState:series.fireLatch.state||'NOT_LATCHED',
      executionTicker:series.currentAttempt?.marketTicker||series.fireLatch.ticker||null,
      executionSide:series.currentAttempt?.outcomeSide||series.fireLatch.outcomeSide||null,
      identityMatch:series.fireLatch.identityMatch||null,
      freshLock:series.fireLatch.freshLock||null,
      preSubmit:series.fireLatch.preSubmit||null,
      providerPost:series.fireLatch.providerPost||'NO',
      providerOrderId:series.fireLatch.providerOrderId||null,
      finalResult:series.fireLatch.finalResult||null,
      invalidationReason:series.fireLatch.invalidationReason||null,
      fireFeatureEvidence:series.fireLatch.fireFeatureEvidence||series.fireRefreshEvidence||null,
      finalFeatureEvidence:series.fireLatch.finalFeatureEvidence||null,
      fireBookEvidence:series.fireLatch.fireBookEvidence||null,
      freshLockBookEvidence:series.fireLatch.freshLockBookEvidence||null,
      preSubmitBookEvidence:series.fireLatch.preSubmitBookEvidence||null,
      providerSubmittedPrice:series.fireLatch.providerSubmittedPrice??null,
      providerStatus:series.fireLatch.providerStatus||null,
    }:series?.fireRefreshEvidence?{
      specimenId:null,ticker:null,side:null,score:null,latchState:'NOT_LATCHED',
      executionTicker:null,executionSide:null,identityMatch:null,freshLock:null,preSubmit:null,providerPost:'NO',
      providerOrderId:null,finalResult:'FIRE_INVALIDATED_FEATURE_REFRESH',
      invalidationReason:'FIRE_INVALIDATED_FEATURE_REFRESH',
      fireFeatureEvidence:series.fireRefreshEvidence,finalFeatureEvidence:null,
      fireBookEvidence:null,freshLockBookEvidence:null,preSubmitBookEvidence:null,
      providerSubmittedPrice:null,providerStatus:null,
    }:null,
    latestLedgerEvent:latestLedgerEvent?{
      type:latestLedgerEvent.type||null,
      at:latestLedgerEvent.at||null,
      attemptId:latestLedgerEvent.attemptId||null,
      ticker:latestLedgerEvent.ticker||null,
      result:latestLedgerEvent.result?.state||latestLedgerEvent.result||null,
      providerOrderId:latestLedgerEvent.result?.orderId||latestLedgerEvent.entryOrderId||latestLedgerEvent.providerOrderId||null,
    }:null,
    lastAttempt,
    safeguards:{
      owner:REAL_OWNER,
      threshold:Number(series?.threshold),
      effectiveLockThreshold:series?.configFrozen===true?Number(series?.effectiveLockThreshold):null,
      configFrozen:series?.configFrozen===true,
      attemptTarget:Number(series?.attemptTarget),
      maxEntryDebitUsd:Number(series?.maxEntryDebitUsd),
      requiredExchangeIndex:2,
      timeInForce:'immediate_or_cancel',
      strategyAuthority:'PAYNE_PAPER',
      holdWhile:'PULL TRIGGER',
      decisionExit:'decision_exit',
      marketMissingExit:'market_missing',
      maxHoldReason:'max_hold',
      maxHoldMs:PAYNE_PAPER_RULES.maxHoldMs,
      cooldownMs:PAYNE_PAPER_RULES.cooldownMs,
      reduceOnlyExit:true,
      autoTickerConflictGuard:true,
      restartSafeAttemptLockout:true,
    },
  };
}

export async function buildRealExecutionObservability(env) {
  const [control,series,ledger]=await Promise.all([
    loadControl(env),
    loadRealSeriesState(env),
    listRealLedger(env,1000),
  ]);
  return summarizeRealExecutionState({control,series,ledger,asOf:new Date().toISOString()});
}

async function buildFastUiState(env) {
  const [control,latestPersistent,realExecution]=await Promise.all([
    loadControl(env),
    kvGetJson(env,CURRENT_KEY),
    buildRealExecutionObservability(env),
  ]);
  return {
    ok:true,
    schema:'PAYNE_FAST_UI_STATE_V1',
    updatedAt:new Date().toISOString(),
    uiPollAuthority:'PERSISTED_STATE_ONLY',
    providerGets:0,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
    control:{
      armed:control.armed===true,
      attemptTarget:control.attemptTarget,
      maxEntryDebitUsd:control.maxEntryDebitUsd,
      threshold:control.activeThreshold,
      effectiveLockThreshold:effectiveLockThreshold(control.activeThreshold),
      requiredExchangeIndex:2,
      scanEnabled:control.scanEnabled,
    },
    baselineObservationAt:latestPersistent?.selected?.payne?.sourceLastRunAt||latestPersistent?.clocks?.baseline?.observationAt||null,
    payneObservationAt:latestPersistent?.at||latestPersistent?.clocks?.payne?.observationAt||null,
    decisions:latestPersistent?.decisions||[],
    selected:latestPersistent?.selected||null,
    pipeline:latestPersistent?.pipeline||null,
    realExecution,
  };
}

export function interpretPayneOrderResponse(body) {
  const orderId=body?.order_id||body?.order?.order_id||null;
  const clientOrderId=body?.client_order_id||body?.order?.client_order_id||null;
  const fillRaw=body?.fill_count??body?.filled_count??body?.order?.fill_count;
  const remainRaw=body?.remaining_count??body?.order?.remaining_count;
  const fillCount=Number(fillRaw), remainingCount=Number(remainRaw);
  const averageFillPrice=body?.average_fill_price??body?.order?.average_fill_price??null;
  const averageFeePaid=body?.average_fee_paid??body?.order?.average_fee_paid??null;
  if(!orderId || !Number.isFinite(fillCount) || fillCount<0 || !Number.isFinite(remainingCount) || remainingCount<0) {
    return {state:'UNKNOWN',orderId,clientOrderId,fillCount:Number.isFinite(fillCount)?fillCount:null,remainingCount:Number.isFinite(remainingCount)?remainingCount:null,averageFillPrice,averageFeePaid,reason:'AMBIGUOUS_PROVIDER_ORDER_RESPONSE'};
  }
  if(fillCount<=0) return {state:'NO_FILL',orderId,clientOrderId,fillCount:0,remainingCount,averageFillPrice,averageFeePaid,reason:'AUTHORITATIVE_ZERO_FILL'};
  if(remainingCount>0) return {state:'PARTIAL',orderId,clientOrderId,fillCount,remainingCount,averageFillPrice,averageFeePaid,reason:'AUTHORITATIVE_PARTIAL_FILL'};
  return {state:'FILLED',orderId,clientOrderId,fillCount,remainingCount:0,averageFillPrice,averageFeePaid,reason:'AUTHORITATIVE_FILL'};
}

async function providerTickerPositionEvidence(env,ticker) {
  const rows=[]; let cursor='', pages=0, lastStatus=null;
  try{
    do{
      const path='/trade-api/v2/portfolio/positions?limit=1000&subaccount=0'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
      const response=await kalshiGetOnly(env,path); lastStatus=response.status;
      if(!response.ok) return {ok:false,classification:'UNKNOWN',reason:'HTTP_'+response.status,httpStatus:response.status,paginationComplete:false,matched:null};
      const body=await response.json().catch(()=>null);
      if(!body || !Array.isArray(body.market_positions)) return {ok:false,classification:'UNKNOWN',reason:'UNKNOWN_SCHEMA',httpStatus:response.status,paginationComplete:false,matched:null};
      rows.push(...body.market_positions); cursor=typeof body.cursor==='string'?body.cursor:''; pages++;
      if(pages>=100 && cursor) return {ok:false,classification:'UNKNOWN',reason:'PAGINATION_SAFETY_LIMIT',httpStatus:response.status,paginationComplete:false,matched:null};
    }while(cursor);
    const matches=rows.filter(x=>String(x?.ticker||x?.market_ticker||'')===String(ticker||''));
    if(matches.length>1) return {ok:true,classification:'UNKNOWN',reason:'TICKER_AMBIGUOUS',httpStatus:lastStatus,paginationComplete:true,matched:null};
    if(matches.length===0) return {ok:true,classification:'ABSENT',reason:'NO_EXACT_TICKER_POSITION_OBSERVED',httpStatus:lastStatus,paginationComplete:true,matched:null};
    const exact=matches[0];
    const raw=exact?.position_fp??exact?.position??exact?.quantity;
    const qty=Number(raw);
    if(!Number.isFinite(qty)) return {ok:true,classification:'UNKNOWN',reason:'QUANTITY_INVALID',httpStatus:lastStatus,paginationComplete:true,matched:exact};
    return {ok:true,classification:Math.abs(qty)<=1e-9?'FLAT':'OPEN',reason:Math.abs(qty)<=1e-9?'MATCHED_TICKER_ZERO':'MATCHED_TICKER_NONZERO',httpStatus:lastStatus,paginationComplete:true,matched:exact,quantity:qty};
  }catch(error){
    return {ok:false,classification:'UNKNOWN',reason:String(error?.message||error),httpStatus:lastStatus,paginationComplete:false,matched:null};
  }
}

export async function reconcileUnresolvedEntryFromProvider(env,nowMs=Date.now()) {
  const series=await loadRealSeriesState(env);
  if(series?.unresolvedEntry!==true) return {
    ok:true,classification:'CLEAN',reason:'NO_UNRESOLVED_ENTRY',
    series,control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0,
  };
  let attempt=series?.currentAttempt||null;
  const ticker=String(attempt?.marketTicker||'').trim();
  const clientOrderId=String(attempt?.clientOrderId||attempt?.payload?.client_order_id||'').trim();
  if(!ticker || !attempt?.attemptId || !clientOrderId) {
    series.status='ENTRY_RECONCILIATION_REQUIRED';
    await appendRealLedger(env,'ENTRY_RECONCILIATION_STILL_UNKNOWN',{
      seriesId:series.seriesId,attemptId:attempt?.attemptId||null,ticker:ticker||null,
      reason:'PAYNE_UNRESOLVED_ENTRY_IDENTITY_INCOMPLETE',
    });
    await saveRealSeriesState(env,series);
    return {ok:false,classification:'UNKNOWN',reason:'PAYNE_UNRESOLVED_ENTRY_IDENTITY_INCOMPLETE',series,control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
  }

  const readJson=async path=>{
    try{
      const response=await kalshiGetOnly(env,path);
      const body=await response.json().catch(()=>null);
      return {ok:response.ok===true,httpStatus:response.status,body};
    }catch(error){
      return {ok:false,httpStatus:null,body:null,error:String(error?.message||error)};
    }
  };
  const q='?limit=200&subaccount=0&ticker='+encodeURIComponent(ticker);
  const [positionEvidence,ordersRead,fillsRead,historicalFillsRead,settlementsRead]=await Promise.all([
    providerTickerPositionEvidence(env,ticker),
    readJson('/trade-api/v2/portfolio/orders'+q),
    readJson('/trade-api/v2/portfolio/fills'+q),
    readJson('/trade-api/v2/historical/fills'+q),
    readJson('/trade-api/v2/portfolio/settlements'+q),
  ]);

  const providerReadsComplete=positionEvidence?.ok===true && ordersRead.ok && fillsRead.ok && historicalFillsRead.ok && settlementsRead.ok;
  if(!providerReadsComplete){
    series.status='ENTRY_RECONCILIATION_REQUIRED';
    await appendRealLedger(env,'ENTRY_RECONCILIATION_STILL_UNKNOWN',{
      seriesId:series.seriesId,attemptId:attempt.attemptId,ticker,clientOrderId,
      reason:'PROVIDER_RECONCILIATION_READ_INCOMPLETE',
      position:positionEvidence?.classification||'UNKNOWN',
      orderHttpStatus:ordersRead.httpStatus,fillHttpStatus:fillsRead.httpStatus,
      historicalFillHttpStatus:historicalFillsRead.httpStatus,settlementHttpStatus:settlementsRead.httpStatus,
    });
    await saveRealSeriesState(env,series);
    return {ok:false,classification:'UNKNOWN',reason:'PROVIDER_RECONCILIATION_READ_INCOMPLETE',series,control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
  }

  const orderRows=Array.isArray(ordersRead.body?.orders)?ordersRead.body.orders:
    (ordersRead.body?.order?[ordersRead.body.order]:[]);
  const exactOrders=orderRows.filter(x=>String(x?.client_order_id||x?.clientOrderId||'')===clientOrderId);
  const providerOrderIds=new Set(exactOrders.map(x=>String(x?.order_id||x?.orderId||'')).filter(Boolean));
  const allFillRows=[
    ...(Array.isArray(fillsRead.body?.fills)?fillsRead.body.fills:[]),
    ...(Array.isArray(historicalFillsRead.body?.fills)?historicalFillsRead.body.fills:[]),
  ];
  const exactFills=allFillRows.filter(x=>{
    if(String(x?.ticker||x?.market_ticker||'')!==ticker) return false;
    const fillClient=String(x?.client_order_id||x?.clientOrderId||'');
    const fillOrder=String(x?.order_id||x?.orderId||'');
    return (fillClient && fillClient===clientOrderId) || (fillOrder && providerOrderIds.has(fillOrder));
  });
  const exactSettlements=(Array.isArray(settlementsRead.body?.settlements)?settlementsRead.body.settlements:[])
    .filter(x=>String(x?.ticker||'')===ticker);

  const orderFillCount=exactOrders.reduce((sum,x)=>{
    const n=Number(x?.fill_count??x?.filled_count??x?.count_filled);
    return sum+(Number.isFinite(n)&&n>0?n:0);
  },0);
  const fillRowCount=exactFills.reduce((sum,x)=>{
    const n=Number(x?.count??x?.fill_count??x?.filled_count??x?.quantity);
    return sum+(Number.isFinite(n)&&n>0?n:0);
  },0);
  const ownedFillCount=Math.max(orderFillCount,fillRowCount);
  const orderId=String(exactOrders.find(x=>x?.order_id||x?.orderId)?.order_id||exactOrders.find(x=>x?.order_id||x?.orderId)?.orderId||exactFills.find(x=>x?.order_id||x?.orderId)?.order_id||exactFills.find(x=>x?.order_id||x?.orderId)?.orderId||'')||null;
  const exactIdentityEvidence=exactOrders.length>0 || exactFills.length>0;

  const promoteProviderAttemptIfNeeded=()=>{
    const alreadyCounted=attempt?.providerAttemptCounted===true
      || Number.isFinite(Number(attempt?.providerAttemptNo))
      || Number.isFinite(Number(attempt?.attemptNo));
    if(alreadyCounted){
      const n=Number(attempt?.providerAttemptNo??attempt?.attemptNo??series.attemptsStarted??0);
      return Number.isFinite(n)&&n>0?Math.trunc(n):Math.max(1,Number(series.attemptsStarted||1));
    }
    const n=Math.max(0,Math.trunc(Number(series.attemptsStarted||0)))+1;
    series.attemptsStarted=n;
    attempt={...attempt,attemptNo:n,providerAttemptNo:n,providerAttemptCounted:true,writerInvoked:attempt?.writerInvoked!==false,providerPostStarted:attempt?.providerPostStarted===true?true:null};
    series.currentAttempt=attempt;
    return n;
  };

  if(positionEvidence.classification==='OPEN'){
    if(!exactIdentityEvidence || !(ownedFillCount>0)){
      series.status='ENTRY_RECONCILIATION_REQUIRED';
      await appendRealLedger(env,'ENTRY_RECONCILIATION_STILL_UNKNOWN',{
        seriesId:series.seriesId,attemptId:attempt.attemptId,ticker,clientOrderId,
        reason:'OPEN_POSITION_WITHOUT_EXACT_PAYNE_ORDER_OR_FILL_IDENTITY',
        exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,
      });
      await saveRealSeriesState(env,series);
      return {ok:false,classification:'UNKNOWN',reason:'OPEN_POSITION_WITHOUT_EXACT_PAYNE_ORDER_OR_FILL_IDENTITY',series,control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
    }

    const attemptNo=promoteProviderAttemptIfNeeded();
    attempt={...attempt,attemptNo,providerAttemptNo:attemptNo,providerAttemptCounted:true,providerOrderId:orderId,providerResponseState:'FILLED'};
    series.currentAttempt=attempt;
    const exactOrder=exactOrders[0]||{};
    const position={
      schema:'PAYNE_REAL_POSITION_V1',owner:REAL_OWNER,seriesId:series.seriesId,attemptId:attempt.attemptId,
      attemptNo,status:'OPEN',
      asset:attempt.asset,marketTicker:ticker,outcomeSide:attempt.outcomeSide,direction:attempt.direction,
      paperCandidateKey:attempt.paperCandidateKey||paperCandidateKey({ticker,outcomeSide:attempt.outcomeSide,direction:attempt.direction}),
      exchangeIndex:2,entryOrderId:orderId,entryClientOrderId:clientOrderId,
      filledCount:ownedFillCount,remainingExitCount:ownedFillCount,
      entryAverageFillPrice:exactOrder?.average_fill_price??exactOrder?.avg_fill_price??null,
      entryAverageFeePaid:exactOrder?.average_fee_paid??exactOrder?.fee_paid??null,
      entryScore:attempt.score,entryMove:attempt.move,entryEdge:attempt.edge,
      entryTime:attempt.preSubmitAt||attempt.observedAt||new Date(nowMs).toISOString(),
      freshLockAt:attempt.freshLockAt||null,preSubmitAt:attempt.preSubmitAt||null,
      fillState:'RECONCILED_OWNED',exitFilledTotal:0,exitAttempt:0,
      reconciliationState:'OPEN',reconciliationReason:positionEvidence.reason,
      reconciledAt:new Date(nowMs).toISOString(),
    };
    const providerResult={state:'FILLED',reason:'PROVIDER_RECONCILED_OWNED',orderId,clientOrderId,fillCount:ownedFillCount,remainingCount:null,averageFillPrice:position.entryAverageFillPrice,averageFeePaid:position.entryAverageFeePaid};
    series.position=position;
    series.unresolvedEntry=false;
    series.currentAttempt={...attempt,status:'FILLED',providerResult,reconciledAt:position.reconciledAt,terminalClassification:'FILLED',reconciliationResult:'OWNED',reconciliationReason:'PROVIDER_RECONCILED_OWNED'};
    series.status=seriesTerminal(series)?'ATTEMPT_LIMIT_REACHED_MANAGING_POSITION':'MANAGING_POSITION_SERIES_CONTINUES';
    await persistAttempt(env,{runId:series.seriesId,result:'FILLED',...series.currentAttempt});
    await persistPosition(env,{positionId:attempt.attemptId,...position});
    await appendRealLedger(env,'ENTRY_RECONCILED_OWNED',{
      seriesId:series.seriesId,attemptId:attempt.attemptId,attemptNo:position.attemptNo,ticker,clientOrderId,
      entryOrderId:orderId,filledCount:ownedFillCount,providerPositionReason:positionEvidence.reason,
      exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,
    });
    await saveRealSeriesState(env,series);
    await settleSeriesControl(env,series,1);
    return {ok:true,classification:'OWNED',reason:'PROVIDER_RECONCILED_OWNED',ticker,clientOrderId,orderId,exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,exactSettlementCount:exactSettlements.length,providerPositionClassification:positionEvidence.classification,series:await loadRealSeriesState(env),control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
  }

  if(positionEvidence.classification==='UNKNOWN'){
    series.status='ENTRY_RECONCILIATION_REQUIRED';
    await appendRealLedger(env,'ENTRY_RECONCILIATION_STILL_UNKNOWN',{
      seriesId:series.seriesId,attemptId:attempt.attemptId,ticker,clientOrderId,
      reason:positionEvidence.reason||'PROVIDER_POSITION_UNKNOWN',
      exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,exactSettlementCount:exactSettlements.length,
    });
    await saveRealSeriesState(env,series);
    return {ok:false,classification:'UNKNOWN',reason:positionEvidence.reason||'PROVIDER_POSITION_UNKNOWN',series,control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
  }

  if(exactSettlements.length>0 && exactIdentityEvidence){
    const reconciledAt=new Date(nowMs).toISOString();
    const attemptNo=promoteProviderAttemptIfNeeded();
    attempt={...attempt,attemptNo,providerAttemptNo:attemptNo,providerAttemptCounted:true,providerOrderId:orderId,providerResponseState:'FILLED'};
    series.currentAttempt=attempt;
    const providerResult={state:'FILLED',reason:'PROVIDER_RECONCILED_SETTLED_FLAT',orderId,clientOrderId,fillCount:ownedFillCount||null,remainingCount:0};
    series.unresolvedEntry=false; series.position=null;
    series.currentAttempt={...attempt,status:'FILLED',providerResult,reconciledAt,terminalClassification:'FILLED',reconciliationResult:'SETTLED_FLAT',reconciliationReason:'PROVIDER_RECONCILED_SETTLED_FLAT'};
    if(seriesTerminal(series)){series.status='COMPLETE_FLAT';series.completedAt=reconciledAt;}
    else {series.status=(await loadControl(env)).armed?'ARMED_FISHING':'SERIES_PAUSED_DISARMED_CLEAN';}
    await persistAttempt(env,{runId:series.seriesId,result:'FILLED',...series.currentAttempt});
    await appendRealLedger(env,'ENTRY_RECONCILED_SETTLED_FLAT',{
      seriesId:series.seriesId,attemptId:attempt.attemptId,attemptNo,
      ticker,clientOrderId,entryOrderId:orderId,exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,exactSettlementCount:exactSettlements.length,
    });
    await appendRealLedger(env,'PAYNE_PAPER_BRAIN_EXIT_CLOSED',{
      seriesId:series.seriesId,
      attemptId:attempt.attemptId,
      ticker,
      outcomeSide:attempt.outcomeSide||null,
      direction:attempt.direction||null,
      candidateKey:attempt.paperCandidateKey||paperCandidateKey({ticker,outcomeSide:attempt.outcomeSide,direction:attempt.direction}),
      exitReason:'settled_flat',
    });
    await saveRealSeriesState(env,series);
    await settleSeriesControl(env,series,0);
    return {ok:true,classification:'FLAT',reason:'PROVIDER_RECONCILED_SETTLED_FLAT',ticker,clientOrderId,orderId,exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,exactSettlementCount:exactSettlements.length,providerPositionClassification:positionEvidence.classification,series:await loadRealSeriesState(env),control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
  }

  if((positionEvidence.classification==='ABSENT'||positionEvidence.classification==='FLAT') && exactOrders.length===0 && exactFills.length===0 && exactSettlements.length===0){
    const reconciledAt=new Date(nowMs).toISOString();
    const providerResult={state:'NO_PROVIDER_EXECUTION',reason:'PROVIDER_RECONCILED_NO_EXECUTION',clientOrderId,fillCount:0,remainingCount:0};
    series.unresolvedEntry=false; series.position=null;
    attempt={
      ...attempt,status:'NO_PROVIDER_EXECUTION',providerResult,reconciledAt,
      providerResponseState:'NO_PROVIDER_EXECUTION',providerOrderId:null,
      providerAttemptCounted:attempt?.providerAttemptCounted===true,
      terminalClassification:'NO_PROVIDER_EXECUTION',
      reconciliationResult:'NO_PROVIDER_EXECUTION',reconciliationReason:'PROVIDER_RECONCILED_NO_EXECUTION'
    };
    series.currentAttempt=attempt;
    if(seriesTerminal(series)){series.status='COMPLETE_ENTRY_AUTHORITY';series.completedAt=reconciledAt;}
    else {series.status=(await loadControl(env)).armed?'ARMED_FISHING':'SERIES_PAUSED_DISARMED_CLEAN';}
    await persistAttempt(env,{runId:series.seriesId,result:'NO_PROVIDER_EXECUTION',...attempt});
    await appendRealLedger(env,'ENTRY_RECONCILED_NO_EXECUTION',{
      seriesId:series.seriesId,attemptId:attempt.attemptId,intentNo:attempt.intentNo??null,attemptNo:attempt.attemptNo??null,
      asset:attempt.asset||null,ticker,outcomeSide:attempt.outcomeSide||null,direction:attempt.direction||null,clientOrderId,
      writerInvoked:attempt.writerInvoked===true,providerPostStarted:attempt.providerPostStarted===true?true:null,
      providerAttemptCounted:attempt.providerAttemptCounted===true,providerOrderId:null,
      providerPositionClassification:positionEvidence.classification,exactOrderCount:0,exactFillCount:0,exactSettlementCount:0,
      reconciliation:'PROVIDER_RECONCILED_NO_EXECUTION',terminalClassification:'NO_PROVIDER_EXECUTION',
    });
    await saveRealSeriesState(env,series);
    await settleSeriesControl(env,series,0);
    return {ok:true,classification:'FLAT',reason:'PROVIDER_RECONCILED_NO_EXECUTION',terminalClassification:'NO_PROVIDER_EXECUTION',ticker,clientOrderId,orderId:null,exactOrderCount:0,exactFillCount:0,exactSettlementCount:0,providerPositionClassification:positionEvidence.classification,series:await loadRealSeriesState(env),control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
  }

  if((positionEvidence.classification==='ABSENT'||positionEvidence.classification==='FLAT') && exactOrders.length>0){
    const zeroFillOrders=exactOrders.every(x=>{
      const n=Number(x?.fill_count??x?.filled_count??x?.count_filled??0);
      return Number.isFinite(n)&&n===0;
    });
    if(zeroFillOrders && exactFills.length===0 && exactSettlements.length===0){
      const reconciledAt=new Date(nowMs).toISOString();
      const attemptNo=promoteProviderAttemptIfNeeded();
      const providerResult={state:'NO_FILL',reason:'PROVIDER_ORDER_ZERO_FILL_RECONCILED',orderId,clientOrderId,fillCount:0,remainingCount:0};
      series.unresolvedEntry=false; series.position=null;
      attempt={
        ...attempt,attemptNo,providerAttemptNo:attemptNo,providerAttemptCounted:true,status:'NO_FILL',providerResult,reconciledAt,
        providerOrderId:orderId,providerResponseState:'NO_FILL',terminalClassification:'NO_FILL',
        reconciliationResult:'NO_FILL',reconciliationReason:'PROVIDER_ORDER_ZERO_FILL_RECONCILED'
      };
      series.currentAttempt=attempt;
      if(seriesTerminal(series)){series.status='COMPLETE_NO_FILL_RECONCILED';series.completedAt=reconciledAt;}
      else {series.status=(await loadControl(env)).armed?'ARMED_FISHING':'SERIES_PAUSED_DISARMED_CLEAN';}
      await persistAttempt(env,{runId:series.seriesId,result:'NO_FILL',...attempt});
      await appendRealLedger(env,'ENTRY_RECONCILED_ORDER_ZERO_FILL',{
        seriesId:series.seriesId,attemptId:attempt.attemptId,intentNo:attempt.intentNo??null,attemptNo,
        asset:attempt.asset||null,ticker,outcomeSide:attempt.outcomeSide||null,direction:attempt.direction||null,clientOrderId,
        providerOrderId:orderId,writerInvoked:attempt.writerInvoked!==false,providerPostStarted:attempt.providerPostStarted===true?true:null,
        providerAttemptCounted:true,providerPositionClassification:positionEvidence.classification,
        exactOrderCount:exactOrders.length,exactFillCount:0,exactSettlementCount:0,reconciliation:'PROVIDER_ORDER_ZERO_FILL_RECONCILED',
      });
      await saveRealSeriesState(env,series);
      await settleSeriesControl(env,series,0);
      return {ok:true,classification:'FLAT',reason:'PROVIDER_ORDER_ZERO_FILL_RECONCILED',terminalClassification:'NO_FILL',ticker,clientOrderId,orderId,exactOrderCount:exactOrders.length,exactFillCount:0,exactSettlementCount:0,providerPositionClassification:positionEvidence.classification,series:await loadRealSeriesState(env),control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
    }
  }

  series.status='ENTRY_RECONCILIATION_REQUIRED';
  await appendRealLedger(env,'ENTRY_RECONCILIATION_STILL_UNKNOWN',{
    seriesId:series.seriesId,attemptId:attempt.attemptId,ticker,clientOrderId,
    reason:'PROVIDER_EVIDENCE_NOT_TERMINAL',
    positionClassification:positionEvidence.classification,
    exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,exactSettlementCount:exactSettlements.length,
  });
  await saveRealSeriesState(env,series);
  return {ok:false,classification:'UNKNOWN',reason:'PROVIDER_EVIDENCE_NOT_TERMINAL',ticker,clientOrderId,orderId,exactOrderCount:exactOrders.length,exactFillCount:exactFills.length,exactSettlementCount:exactSettlements.length,providerPositionClassification:positionEvidence.classification,series,control:await loadControl(env),providerWrites:0,orders:0,capitalMovedUsd:0};
}
async function baselineAutoTickerConflict(env,ticker) {
  try{
    const read=await baselineReadOnlyPath(env,'/execution-test-state');
    if(!read?.ok) return {ok:false,conflict:null,reason:'BASELINE_EXECUTION_STATE_UNAVAILABLE'};
    const body=read.body||{};
    const positions=Array.isArray(body?.positions)?body.positions:Array.isArray(body?.state?.positions)?body.state.positions:[];
    const conflict=positions.some(p=>['OPEN','EXIT_RETRY','POSITION_OPEN_WAITING_FOR_EXIT','POSITION_OPEN_EXIT_RETRY_REQUIRED'].includes(String(p?.status||''))&&String(p?.marketTicker||p?.ticker||'')===String(ticker||''));
    return {ok:true,conflict,reason:conflict?'AUTO_EXACT_TICKER_POSITION_CONFLICT':'NO_AUTO_EXACT_TICKER_POSITION'};
  }catch(error){return {ok:false,conflict:null,reason:String(error?.message||error)};}
}

function payneRealScope(control,series,kind,position=null,entryContext={}) {
  return {
    owner:REAL_OWNER,
    exchangeIndex:2,
    authorized:kind==='ENTRY'?Boolean(control?.armed):Boolean(position?.owner===REAL_OWNER),
    armed:Boolean(control?.armed),
    attemptTarget:Number(series?.attemptTarget),
    attemptsBefore:Number.isFinite(Number(entryContext?.attemptsBefore))?Number(entryContext.attemptsBefore):Number(series?.attemptsStarted||0),
    maxEntryDebitUsd:Number(series?.maxEntryDebitUsd),
    seriesConfigFrozen:series?.configFrozen===true,
    priorAttemptClean:entryContext?.priorAttemptClean===true,
    entryDebitUsd:Number.isFinite(Number(entryContext?.entryDebitUsd))?Number(entryContext.entryDebitUsd):null,
    ownedByPayne:Boolean(position?.owner===REAL_OWNER),
    ownedTicker:position?.marketTicker||null,
  };
}

function realizedPnlFromPosition(position) {
  const qty=Number(position?.filledCount), entry=Number(position?.entryAverageFillPrice), exit=Number(position?.exitAverageFillPrice);
  const entryFee=Number(position?.entryAverageFeePaid||0),exitFee=Number(position?.exitAverageFeePaid||0);
  if(!Number.isFinite(qty)||!Number.isFinite(entry)||!Number.isFinite(exit)) return null;
  return Number((((exit-entry)*qty)-entryFee-exitFee).toFixed(4));
}

async function closeRealSeriesControl(env,attempts=1,openPositions=0) {
  const control=await loadControl(env);
  const next={...control,armed:false,attempts,openPositions,providerWriteAuthority:'BUILT_INACTIVE_DISARMED',providerPostAuthority:'BUILT_INACTIVE_DISARMED',realExecution:'BUILT_INACTIVE_DISARMED',fundingAuthority:'INDEX2_ONLY_INACTIVE_DISARMED',requiredExchangeIndex:2,realControlSchema:REAL_CONTROL_SCHEMA};
  await kvPutJson(env,CONTROL_KEY,next);
  return next;
}

function seriesDisarmsOnStep(series,failClosed){return failClosed===true||seriesTerminal(series);}

// Sequential-series control settle: fail-closed DISARM on any abnormal state or when the series is terminal;
// otherwise stay armed (counters only) so the next attempt may proceed once the prior attempt is clean.
async function settleSeriesControl(env,series,openPositions,{failClosed=false}={}) {
  const attempts=Number(series?.attemptsStarted||0);
  if(seriesDisarmsOnStep(series,failClosed)) return closeRealSeriesControl(env,attempts,openPositions);
  const control=await loadControl(env);
  const next={...control,attempts,openPositions,requiredExchangeIndex:2,realControlSchema:REAL_CONTROL_SCHEMA};
  await kvPutJson(env,CONTROL_KEY,next);
  return next;
}

async function reconcileOwnedPaynePosition(env,position) {
  if(!position || position.owner!==REAL_OWNER || Number(position.exchangeIndex)!==2 || !position.entryOrderId || !position.entryClientOrderId) {
    return {classification:'UNKNOWN',reason:'PAYNE_OWNERSHIP_IDENTITY_INCOMPLETE'};
  }
  const evidence=await providerTickerPositionEvidence(env,position.marketTicker);
  if(evidence.classification!=='ABSENT') return evidence;
  try{
    const path='/trade-api/v2/portfolio/settlements?limit=200&subaccount=0&ticker='+encodeURIComponent(position.marketTicker);
    const response=await kalshiGetOnly(env,path);
    if(!response.ok) return {classification:'UNKNOWN',reason:'SETTLEMENT_HTTP_'+response.status};
    const body=await response.json().catch(()=>null);
    const rows=Array.isArray(body?.settlements)?body.settlements:[];
    const exact=rows.find(x=>String(x?.ticker||'')===String(position.marketTicker));
    if(exact) return {classification:'FLAT',reason:'EXACT_TICKER_SETTLEMENT_CONFIRMED',settlement:exact};
  }catch{}
  return {classification:'UNKNOWN',reason:'TICKER_ABSENT_SETTLEMENT_NOT_PROVEN'};
}

async function managePayneRealPosition(env,control,series,postImpl=kalshiPayneOrderPost,nowMs=Date.now()) {
  const position=series?.position;
  if(!position) return series;
  if(position.owner!==REAL_OWNER || Number(position.exchangeIndex)!==2) {
    series.status='HOLD_WRONG_OR_UNKNOWN_OWNERSHIP';
    await appendRealLedger(env,'MANAGEMENT_BLOCKED',{seriesId:series.seriesId,attemptId:position.attemptId||null,ticker:position.marketTicker||null,reason:series.status});
    return saveRealSeriesState(env,series);
  }

  const rec=await reconcileOwnedPaynePosition(env,position);
  position.reconciliationState=rec.classification;
  position.reconciliationReason=rec.reason;
  position.reconciledAt=new Date(nowMs).toISOString();
  if(rec.classification==='FLAT'){
    position.status='CLOSED';
    position.closedAt=position.closedAt||new Date(nowMs).toISOString();
    if(seriesTerminal(series)){series.status='COMPLETE_FLAT';series.completedAt=series.completedAt||position.closedAt;}
    else {series.status=(await loadControl(env)).armed?'ARMED_FISHING':'SERIES_PAUSED_DISARMED_CLEAN';}
    await appendRealLedger(env,'PROVIDER_RECONCILED_FLAT',{seriesId:series.seriesId,attemptId:position.attemptId,ticker:position.marketTicker,reason:rec.reason,realizedPnlUsd:realizedPnlFromPosition(position)});
    await appendRealLedger(env,'PAYNE_PAPER_BRAIN_EXIT_CLOSED',{
      seriesId:series.seriesId,
      attemptId:position.attemptId,
      ticker:position.marketTicker,
      outcomeSide:position.outcomeSide,
      direction:position.direction,
      candidateKey:position.paperCandidateKey||paperCandidateKey(position),
      exitReason:position.exitReason||rec.reason,
    });
    await settleSeriesControl(env,series,0);
    return saveRealSeriesState(env,series);
  }
  if(rec.classification!=='OPEN'){
    position.status='RECONCILIATION_UNKNOWN';
    series.status='MANAGEMENT_RECONCILIATION_UNKNOWN';
    await appendRealLedger(env,'MANAGEMENT_RECONCILIATION_UNKNOWN',{seriesId:series.seriesId,attemptId:position.attemptId,ticker:position.marketTicker,reason:rec.reason});
    await settleSeriesControl(env,series,1,{failClosed:true});
    return saveRealSeriesState(env,series);
  }

  const quote=await exactMarketRead(env,position.marketTicker,position.asset);
  const featureState=await readAuthoritativePayneFeatures(env,quote?.market?[quote.market]:[],nowMs,{forceRefresh:true});
  const feature=featureForCandidate(featureState,position.marketTicker,position.outcomeSide,position.asset,Number(series.threshold),quote?.market||null);
  const bid=position.outcomeSide==='YES'?Number(quote?.market?.yesBid):Number(quote?.market?.noBid);
  const ageMs=nowMs-Date.parse(position.entryTime||position.filledAt||'');
  const currentPaperDecision=feature?.available
    ? paperDecision({score:feature.score,edge:feature.edge,move:feature.move,threshold:Number(series.threshold)})
    : {label:'MISSING'};
  const decision=managementDecision({
    heldMs:ageMs,
    owned:true,
    marketPresent:quote?.ok===true,
    decisionLabel:currentPaperDecision.label,
  });
  position.currentPaperDecision=currentPaperDecision.label;
  position.currentScore=feature?.available?feature.score:null;
  position.currentMarketPrice=Number.isFinite(bid)?bid:null;
  position.holdDurationMs=Number.isFinite(ageMs)?ageMs:null;
  if(decision.action!=='EXIT'){
    position.status='OPEN';
    series.status=seriesTerminal(series)?'ATTEMPT_LIMIT_REACHED_MANAGING_POSITION':'MANAGING_POSITION_SERIES_CONTINUES';
    await settleSeriesControl(env,series,1);
    return saveRealSeriesState(env,series);
  }
  if(!quote?.ok || !(bid>0&&bid<1)){
    position.status='EXIT_RETRY';
    position.exitReason=decision.reason;
    series.status='EXIT_REQUIRED_WAITING_FOR_LIVE_BID';
    await settleSeriesControl(env,series,1);
    return saveRealSeriesState(env,series);
  }

  const remaining=Math.max(0,Number(position.filledCount||0)-Number(position.exitFilledTotal||0));
  if(!(remaining>0)){
    position.status='EXIT_RECONCILIATION_REQUIRED';
    series.status='EXIT_RECONCILIATION_REQUIRED';
    await settleSeriesControl(env,series,1,{failClosed:true});
    return saveRealSeriesState(env,series);
  }
  position.remainingExitCount=remaining;
  position.exitAttempt=Number(position.exitAttempt||0)+1;
  const exitClientOrderId=payneClientOrderId(series.seriesId,Number(position.attemptNo||1),'exit'+position.exitAttempt);
  const payload=kalshiV2ExitPayload(position,bid,exitClientOrderId);
  if(!payload || payload.reduce_only!==true){
    position.status='EXIT_RETRY';series.status='EXIT_REQUEST_BUILD_FAILED';await settleSeriesControl(env,series,1,{failClosed:true});return saveRealSeriesState(env,series);
  }
  await appendRealLedger(env,'EXIT_PRE_SUBMIT_LATCHED',{seriesId:series.seriesId,attemptId:position.attemptId,ticker:position.marketTicker,reason:decision.reason,clientOrderId:exitClientOrderId,payload:{...payload},exchangeIndex:2});
  let response,proof;
  try{
    const out=await postImpl(env,'EXIT',payload,payneRealScope(control,series,'EXIT',position));
    response=out.response; proof=out.proof;
  }catch(error){
    position.status='EXIT_RETRY';position.exitWriteError=String(error?.message||error);series.status='EXIT_WRITE_ERROR_RETRY_PENDING';
    await appendRealLedger(env,'EXIT_WRITE_ERROR',{seriesId:series.seriesId,attemptId:position.attemptId,ticker:position.marketTicker,error:position.exitWriteError});
    await settleSeriesControl(env,series,1,{failClosed:true});
    return saveRealSeriesState(env,series);
  }
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    position.status='EXIT_RETRY';position.exitProviderStatus=response.status;series.status='EXIT_PROVIDER_REJECTED_RETRY_PENDING';
    await appendRealLedger(env,'EXIT_PROVIDER_REJECTED',{seriesId:series.seriesId,attemptId:position.attemptId,ticker:position.marketTicker,httpStatus:response.status,proof});
    await settleSeriesControl(env,series,1,{failClosed:true});
    return saveRealSeriesState(env,series);
  }
  const result=interpretPayneOrderResponse(body);
  position.exitOrderId=result.orderId;
  position.exitClientOrderId=result.clientOrderId||exitClientOrderId;
  position.exitReason=decision.reason;
  position.exitAverageFillPrice=result.averageFillPrice;
  position.exitAverageFeePaid=result.averageFeePaid;
  position.exitFilledTotal=Number((Number(position.exitFilledTotal||0)+Number(result.fillCount||0)).toFixed(4));
  position.exitTime=new Date(nowMs).toISOString();
  if(result.state==='UNKNOWN'){
    position.status='EXIT_RECONCILIATION_REQUIRED';series.status='EXIT_RECONCILIATION_REQUIRED';
  }else if(result.state==='NO_FILL' || result.state==='PARTIAL'){
    position.status='EXIT_RETRY';series.status='EXIT_RETRY_REQUIRED';
  }else{
    position.status='EXIT_RECONCILIATION_REQUIRED';series.status='EXIT_RECONCILIATION_REQUIRED';
  }
  await appendRealLedger(env,'EXIT_PROVIDER_RESULT',{seriesId:series.seriesId,attemptId:position.attemptId,ticker:position.marketTicker,result,proof,exitReason:decision.reason,realizedPnlUsd:realizedPnlFromPosition(position)});
  await settleSeriesControl(env,series,1,{failClosed:result.state==='UNKNOWN'});
  return saveRealSeriesState(env,series);
}

export async function runPayneRealExecutionCycle(env,{postImpl=kalshiPayneOrderPost,nowMs=Date.now()}={}) {
  const executionStartMs=Date.now();
  let control=await loadControl(env);
  let series=await loadRealSeriesState(env);
  const trace=()=>payneTimingIdentity(series,series?.fireLatch);
  logPayneTiming('EXECUTION_CYCLE_START',trace(),executionStartMs);

  if(series?.unresolvedEntry===true){
    const reconciliation=await reconcileUnresolvedEntryFromProvider(env,nowMs);
    series=reconciliation?.series||await loadRealSeriesState(env);
    if(series?.position && ['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN'].includes(String(series.position.status||''))) {
      return saveRealSeriesState(env,series);
    }
    return saveRealSeriesState(env,series);
  }

  if(series?.position && ['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN'].includes(String(series.position.status||''))) {
    return managePayneRealPosition(env,control,series,postImpl,nowMs);
  }

  const started=Number(series.attemptsStarted||0);
  if(!control.armed){
    const superseded=await reconcileDisarmedSupersededSeries(env,series,control,nowMs);
    if(superseded.terminalized) return superseded.series;
    series=superseded.series;
    series.status=seriesTerminal(series)?(series.status||'COMPLETE_ENTRY_AUTHORITY'):started>=1?'SERIES_PAUSED_DISARMED':'READY_DISARMED';
    return saveRealSeriesState(env,series);
  }
  // Run config is consumed ONLY from the series' frozen snapshot.
  const cfg=frozenSeriesConfig(series);
  if(!cfg.ok){
    series.status='ARMED_SERIES_CONFIG_NOT_FROZEN_FAIL_CLOSED';
    await closeRealSeriesControl(env,started,series.position?1:0);
    return saveRealSeriesState(env,series);
  }
  if(Number(control.activeThreshold)!==cfg.threshold || Number(control.maxEntryDebitUsd)!==cfg.maxEntryDebitUsd || Number(control.attemptTarget)!==cfg.attemptTarget || Number(control.requiredExchangeIndex)!==2){
    series.status='ARMED_CONFIGURATION_INVALID_FAIL_CLOSED';
    await closeRealSeriesControl(env,started,series.position?1:0);
    return saveRealSeriesState(env,series);
  }
  if(series.unresolvedEntry===true){
    series.status='ENTRY_RECONCILIATION_REQUIRED';
    await closeRealSeriesControl(env,started,series.position?1:0);
    return saveRealSeriesState(env,series);
  }
  if(started>=cfg.attemptTarget){
    series.status='COMPLETE_ENTRY_AUTHORITY';
    await closeRealSeriesControl(env,started,series.position?1:0);
    return saveRealSeriesState(env,series);
  }
  const interlock=seriesInterlock(series);
  if(!interlock.clear){
    series.status='HOLD_PRIOR_ATTEMPT_NOT_CLEAN';
    return saveRealSeriesState(env,series);
  }

  const latch=series?.fireLatch||null;
  if(latch?.state!=='LATCHED'){
    series.status='ARMED_FISHING'; return saveRealSeriesState(env,series);
  }
  const candidate={
    ticker:latch.ticker,
    asset:latch.asset,
    outcomeSide:String(latch.outcomeSide||'').toUpperCase(),
    direction:latch.direction,
    openTime:latch.marketOpenTime||null,
    closeTime:latch.marketCloseTime||null,
    exchangeIndex:Number(latch.marketExchangeIndex),
  };
  const expectedFingerprint=fireSpecimenFingerprint(latch);
  if(latch.seriesId!==series.seriesId || Number(latch.attemptNo)!==started+1 || latch.identityFingerprint!==expectedFingerprint || Number(latch.threshold)!==cfg.threshold || Number(latch.effectiveLockThreshold)!==cfg.effectiveLockThreshold){
    return invalidateFireSpecimen(env,series,'FIRE_SPECIMEN_IDENTITY_MISMATCH',{identityMatch:'FAIL'},nowMs);
  }
  series.fireLatch={...latch,identityMatch:'PASS'};
  if(!candidate.ticker || !candidate.asset || !['YES','NO'].includes(candidate.outcomeSide)){
    return invalidateFireSpecimen(env,series,'FIRE_SPECIMEN_IDENTITY_INCOMPLETE',{identityMatch:'FAIL'},nowMs);
  }
  if(Number(candidate.exchangeIndex)!==2){
    return invalidateFireSpecimen(env,series,'HOLD_REQUIRED_EXCHANGE_INDEX_2',{identityMatch:'PASS'},nowMs);
  }
  if(kalshiCandidateTimeSafe({closeTime:candidate.closeTime},nowMs)!==true){
    return invalidateFireSpecimen(env,series,'TIME_GATE_FAILED',{identityMatch:'PASS'},nowMs);
  }

  const paperAvailability=paperCandidateAvailability(candidate,series,await listRealLedger(env,1000),nowMs);
  if(paperAvailability.available!==true){
    return invalidateFireSpecimen(env,series,paperAvailability.reason,{identityMatch:'PASS'},nowMs);
  }

  const auto=await baselineAutoTickerConflict(env,candidate.ticker);
  if(!auto.ok || auto.conflict!==false){
    return invalidateFireSpecimen(env,series,auto.conflict?'HOLD_AUTO_TICKER_CONFLICT':'HOLD_AUTO_OWNERSHIP_UNKNOWN',{identityMatch:'PASS'},nowMs);
  }
  const providerConflict=await providerTickerPositionEvidence(env,candidate.ticker);
  if(!providerConflict.ok || ['OPEN','UNKNOWN'].includes(providerConflict.classification)){
    return invalidateFireSpecimen(env,series,providerConflict.classification==='OPEN'?'HOLD_PROVIDER_TICKER_POSITION_CONFLICT':'HOLD_PROVIDER_POSITION_UNKNOWN',{identityMatch:'PASS'},nowMs);
  }

  const freshLockStartMs=Date.now();
  const freshLock=await exactMarketRead(env,candidate.ticker,candidate.asset);
  logPayneTiming('FRESH_LOCK_READ',trace(),freshLockStartMs,Date.now(),freshLock?.ok?'READ_OK':'READ_FAILED');
  if(!freshLock?.ok || freshLock?.market?.ticker!==candidate.ticker || String(freshLock?.market?.closeTime||'')!==String(candidate.closeTime||'')){
    return invalidateFireSpecimen(env,series,'FRESH_LOCK_INVALIDATED',{identityMatch:'PASS',freshLock:'FAIL'},nowMs);
  }
  const freshLockBookEvidence=payneBookEvidence(freshLock.market,candidate.outcomeSide,
    candidate.outcomeSide==='YES'?freshLock.market.yesAsk:freshLock.market.noAsk,freshLock.readAt);
  series.fireLatch={...series.fireLatch,freshLock:'PASS',freshLockAt:freshLock.readAt,freshLockBookEvidence};

  const preSubmitStartMs=Date.now();
  const preSubmit=await exactMarketRead(env,candidate.ticker,candidate.asset);
  logPayneTiming('PRE_SUBMIT_READ',trace(),preSubmitStartMs,Date.now(),preSubmit?.ok?'READ_OK':'READ_FAILED');
  if(!preSubmit?.ok || preSubmit?.market?.ticker!==candidate.ticker || String(preSubmit?.market?.closeTime||'')!==String(candidate.closeTime||'')){
    return invalidateFireSpecimen(env,series,'PRE_SUBMIT_INVALIDATED',{identityMatch:'PASS',freshLock:'PASS',preSubmit:'FAIL'},nowMs);
  }
  const preSubmitBookEvidence=payneBookEvidence(preSubmit.market,candidate.outcomeSide,
    candidate.outcomeSide==='YES'?preSubmit.market.yesAsk:preSubmit.market.noAsk,preSubmit.readAt);
  series.fireLatch={...series.fireLatch,preSubmit:'PASS',preSubmitAt:preSubmit.readAt,preSubmitBookEvidence};

  const finalRefreshStartMs=Date.now();
  const features=await readAuthoritativePayneFeatures(env,preSubmit?.market?[preSubmit.market]:[],nowMs,{forceRefresh:true});
  logPayneTiming('FINAL_FEATURE_REFRESH',trace(),finalRefreshStartMs,Date.now(),features?.fresh?'SOURCE_FRESH':'SOURCE_UNAVAILABLE');
  const finalFeature=featureForCandidate(features,candidate.ticker,candidate.outcomeSide,candidate.asset,cfg.threshold,preSubmit?.market||null);
  const finalGate=payneStage(finalFeature,cfg.threshold,cfg.effectiveLockThreshold);
  const finalFeatureEvidence=payneFeatureBoundaryEvidence(finalFeature,cfg.threshold,cfg.effectiveLockThreshold,'FINAL');
  logPayneTiming('FINAL_FEATURE_GATE',trace(),executionStartMs,Date.now(),!finalFeature.available?'FEATURE_UNAVAILABLE':finalGate.pullTrigger?'PASS':'PULL_REJECTED');
  if(!finalFeature.available || !finalGate.pullTrigger){
    return invalidateFireSpecimen(env,series,'FINAL_FEATURE_REQUALIFICATION_FAILED',{
      identityMatch:'PASS',freshLock:'PASS',preSubmit:'PASS',finalFeature:'FAIL',
      finalFeatureEvidence,freshLockBookEvidence,preSubmitBookEvidence
    },nowMs);
  }
  series.fireLatch={...series.fireLatch,finalFeature:'PASS',finalFeatureEvidence};

  const ask=candidate.outcomeSide==='YES'?Number(preSubmit.market.yesAsk):Number(preSubmit.market.noAsk);
  const sizing=estimateKalshiFeeSafeSize(ask,cfg.maxEntryDebitUsd);
  if(!sizing.ok || Number(sizing.totalDebitUsd)>cfg.maxEntryDebitUsd || Number(sizing.count)<1){
    return invalidateFireSpecimen(env,series,'HOLD_STAKE_CAP_SIZING_FAILED',{identityMatch:'PASS',freshLock:'PASS',preSubmit:'PASS'},nowMs);
  }
  const balanceResponse=await kalshiGetOnly(env,'/trade-api/v2/portfolio/balance');
  const balanceBody=await balanceResponse.json().catch(()=>({}));
  const index2=index2FundingEvidence(balanceBody,sizing.totalDebitUsd);
  if(!balanceResponse.ok || !index2.available || !index2.sufficient){
    return invalidateFireSpecimen(env,series,'HOLD_INDEX2_FUNDING_INSUFFICIENT',{identityMatch:'PASS',freshLock:'PASS',preSubmit:'PASS'},nowMs);
  }

  const providerAttemptNoCandidate=started+1;
  const intentNo=Number(series.executionIntentsStarted||0)+1;
  const seriesId=series.seriesId||crypto.randomUUID();
  const attemptId=seriesId+'-intent-'+intentNo;
  const clientOrderId=payneClientOrderId(seriesId,providerAttemptNoCandidate,'entry');
  const payload=kalshiV2EntryPayload({marketTicker:candidate.ticker,outcomeSide:candidate.outcomeSide,yes:ask},sizing,clientOrderId);
  if(!payload) return invalidateFireSpecimen(env,series,'HOLD_ENTRY_PAYLOAD_INVALID',{identityMatch:'PASS',freshLock:'PASS',preSubmit:'PASS'},nowMs);

  let attempt={
    schema:'PAYNE_REAL_ATTEMPT_V1',owner:REAL_OWNER,seriesId,attemptId,intentNo,
    attemptNo:null,providerAttemptNo:null,providerAttemptNoCandidate,providerAttemptCounted:false,
    status:'EXECUTION_INTENT',writerInvoked:false,providerPostStarted:false,providerHttpStatus:null,providerOrderId:null,providerResponseState:null,
    fireSpecimenId:series.fireLatch?.specimenId||null,
    fireIdentityFingerprint:series.fireLatch?.identityFingerprint||null,
    asset:candidate.asset,marketTicker:candidate.ticker,outcomeSide:candidate.outcomeSide,direction:candidate.direction,
    paperCandidateKey:paperCandidateKey(candidate),
    exchangeIndex:2,score:finalFeature.score,move:finalFeature.move,directionalMove:finalFeature.directionalMove??null,edge:finalFeature.edge,threshold:cfg.threshold,
    observedAt:series.fireLatch?.fireObservedAt||new Date(nowMs).toISOString(),freshLockAt:freshLock.readAt,preSubmitAt:preSubmit.readAt,
    freshLockResult:'PASS',freshLockPrice:candidate.outcomeSide==='YES'?freshLock.market.yesAsk:freshLock.market.noAsk,
    preSubmitResult:'PASS',preSubmitPrice:ask,
    finalFeatureRequalification:'PASS',
    feeSafeSizingResult:'PASS',
    fundingResult:'PASS',
    fireBookEvidence:series.fireLatch?.fireBookEvidence||null,
    freshLockBookEvidence,
    preSubmitBookEvidence,
    fireFeatureEvidence:series.fireLatch?.fireFeatureEvidence||null,
    finalFeatureEvidence,
    maxEntryDebitUsd:cfg.maxEntryDebitUsd,count:sizing.count,estimatedEntryFeeUsd:sizing.feeUsd,
    estimatedEntryPremiumUsd:sizing.premiumUsd,estimatedEntryDebitUsd:sizing.totalDebitUsd,
    intendedLimitPrice:ask,clientOrderId,payload:{...payload},
  };
  series={
    ...series,seriesId,status:'LOCAL_EXECUTION_INTENT',
    executionIntentsStarted:intentNo,
    attemptsStarted:started,
    unresolvedEntry:true,currentAttempt:attempt,
    fireLatch:{...series.fireLatch,state:'PRE_PROVIDER_VALIDATION',identityMatch:'PASS',freshLock:'PASS',preSubmit:'PASS',providerPost:'NOT_STARTED',providerOrderId:null,finalResult:null}
  };
  await persistAttempt(env,{runId:seriesId,result:'EXECUTION_INTENT',...attempt});
  await appendRealLedger(env,'ENTRY_PRE_SUBMIT_LATCHED',{
    ...attempt,providerWritePlanned:true,writerInvoked:false,providerPostStarted:false,
    providerAttemptCounted:false,providerAttemptsBefore:started
  });
  await saveRealSeriesState(env,series);

  control=await loadControl(env);
  if(!control.armed || Number(control.attemptTarget)!==cfg.attemptTarget || Number(control.maxEntryDebitUsd)!==cfg.maxEntryDebitUsd || Number(control.activeThreshold)!==cfg.threshold || Number(control.requiredExchangeIndex)!==2){
    const reconciledAt=new Date(nowMs).toISOString();
    series.status='ENTRY_AUTHORITY_REVOKED_AFTER_LATCH';
    series.unresolvedEntry=false;
    series.fireLatch={...series.fireLatch,state:'INVALIDATED_BEFORE_POST',providerPost:'NO',providerOrderId:null,finalResult:'INVALIDATED_BEFORE_POST',invalidationReason:'ENTRY_AUTHORITY_REVOKED_AFTER_LATCH'};
    attempt={...attempt,status:'INVALIDATED_BEFORE_POST',providerResponseState:'NO_PROVIDER_EXECUTION',terminalClassification:'INVALIDATED_BEFORE_POST',providerResult:{state:'INVALIDATED_BEFORE_POST',reason:'ENTRY_AUTHORITY_REVOKED_AFTER_LATCH',clientOrderId},reconciledAt};
    series.currentAttempt=attempt;
    await persistAttempt(env,{runId:seriesId,result:'INVALIDATED_BEFORE_POST',...attempt});
    await appendRealLedger(env,'FIRE_SPECIMEN_INVALIDATED_BEFORE_POST',{
      seriesId,attemptId,intentNo,attemptNo:null,specimenId:series.fireLatch?.specimenId||null,ticker:candidate.ticker,
      reason:'ENTRY_AUTHORITY_REVOKED_AFTER_LATCH',writerInvoked:false,providerPostStarted:false,providerAttemptCounted:false,providerOrderId:null
    });
    await closeRealSeriesControl(env,started,0);
    return saveRealSeriesState(env,series);
  }

  // Atomic cross-instance claim belongs to the persisted attempt number, not
  // merely the specimen. Never retry an ambiguous/previously claimed POST.
  const ownership=await claimPayneExecution(env,{
    seriesId,attemptNo:providerAttemptNoCandidate,
    specimenId:series.fireLatch?.specimenId,
    clientOrderId,ticker:candidate.ticker,side:candidate.outcomeSide,
    windowClose:candidate.closeTime
  });
  if(ownership.granted!==true){
    logPayneTiming('ATOMIC_CLAIM_REJECTED',trace(),executionStartMs,Date.now(),ownership.reason);
    // Do not save a stale local copy over an execution owned by another instance.
    // No provider POST is possible from this invocation.
    return loadRealSeriesState(env);
  }
  logPayneTiming('ATOMIC_CLAIM_GRANTED',trace(),executionStartMs,Date.now(),'EXCLUSIVE');
  logPayneTiming('PROVIDER_WRITE_ELIGIBLE',trace(),executionStartMs,Date.now(),'PRE_PROVIDER_GATES_PASSED');
  let response,proof,writerInvoked=false,providerPostStarted=false;
  try{
    const out=await postImpl(env,'ENTRY',payload,payneRealScope(control,series,'ENTRY',null,{attemptsBefore:started,priorAttemptClean:interlock.clear,entryDebitUsd:sizing.totalDebitUsd}));
    response=out?.response; proof=out?.proof;
    writerInvoked=out?.writerInvoked===true;
    providerPostStarted=out?.providerPostStarted===true;
  }catch(error){
    writerInvoked=error?.payneWriterInvoked===true;
    providerPostStarted=error?.payneProviderPostStarted===true;
    if(!providerPostStarted){
      const reconciledAt=new Date(nowMs).toISOString();
      const providerResult={state:'INVALIDATED_BEFORE_POST',reason:'LOCAL_PRE_PROVIDER_REJECTED',clientOrderId,error:String(error?.message||error)};
      series.unresolvedEntry=false;
      series.position=null;
      series.fireLatch={...series.fireLatch,state:'INVALIDATED_BEFORE_POST',providerPost:'NO',providerOrderId:null,finalResult:'INVALIDATED_BEFORE_POST',invalidationReason:'LOCAL_PRE_PROVIDER_REJECTED',invalidatedAt:reconciledAt};
      attempt={...attempt,status:'INVALIDATED_BEFORE_POST',writerInvoked,providerPostStarted:false,providerResponseState:'NO_PROVIDER_EXECUTION',terminalClassification:'LOCAL_PRE_PROVIDER_REJECTED',providerResult,reconciledAt};
      series.currentAttempt=attempt;
      series.status='ARMED_FISHING';
      await persistAttempt(env,{runId:seriesId,result:'INVALIDATED_BEFORE_POST',...attempt});
      await appendRealLedger(env,'ENTRY_LOCAL_PRE_PROVIDER_REJECTED',{
        seriesId,attemptId,intentNo,attemptNo:null,specimenId:series.fireLatch?.specimenId||null,ticker:candidate.ticker,clientOrderId,
        error:String(error?.message||error),writerInvoked,providerPostStarted:false,providerAttemptCounted:false,finalResult:'INVALIDATED_BEFORE_POST'
      });
      const released=await releaseProvenNoPost(env,{
        seriesId,attemptNo:providerAttemptNoCandidate,specimenId:series.fireLatch?.specimenId,
        clientOrderId,ticker:candidate.ticker,side:candidate.outcomeSide,windowClose:candidate.closeTime
      });
      if(!released.granted){
        series.unresolvedEntry=true;
        series.status='ATOMIC_OWNERSHIP_RECONCILIATION_REQUIRED';
        await saveRealSeriesState(env,series);
        return series;
      }
      await settleSeriesControl(env,series,0);
      return saveRealSeriesState(env,series);
    }

    const attemptNo=providerAttemptNoCandidate;
    attempt={...attempt,attemptNo,providerAttemptNo:attemptNo,providerAttemptCounted:true,status:'WRITE_ERROR_UNKNOWN',writerInvoked:true,providerPostStarted:true,providerResponseState:'UNKNOWN',error:String(error?.message||error)};
    series.attemptsStarted=attemptNo;
    series.status='ENTRY_RECONCILIATION_REQUIRED';
    series.unresolvedEntry=true;
    series.fireLatch={...series.fireLatch,state:'PROVIDER_POST_UNKNOWN',providerPost:'UNKNOWN',providerOrderId:null,finalResult:'UNKNOWN'};
    series.currentAttempt=attempt;
    await persistAttempt(env,{runId:seriesId,result:'UNKNOWN',...attempt});
    await appendRealLedger(env,'ENTRY_PROVIDER_POST_STARTED',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,clientOrderId,writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true});
    await appendRealLedger(env,'ENTRY_WRITE_ERROR_UNKNOWN',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,clientOrderId,error:String(error?.message||error),writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true});
    await settleSeriesControl(env,series,0);
    return saveRealSeriesState(env,series);
  }

  if(!writerInvoked || !providerPostStarted || !response){
    const reconciledAt=new Date(nowMs).toISOString();
    const providerResult={state:'INVALIDATED_BEFORE_POST',reason:'PROVIDER_POST_BOUNDARY_NOT_PROVEN',clientOrderId};
    series.unresolvedEntry=false;
    series.position=null;
    series.fireLatch={...series.fireLatch,state:'INVALIDATED_BEFORE_POST',providerPost:'NO',providerOrderId:null,finalResult:'INVALIDATED_BEFORE_POST',invalidationReason:'PROVIDER_POST_BOUNDARY_NOT_PROVEN',invalidatedAt:reconciledAt};
    attempt={...attempt,status:'INVALIDATED_BEFORE_POST',writerInvoked,providerPostStarted:false,providerResponseState:'NO_PROVIDER_EXECUTION',terminalClassification:'PROVIDER_POST_BOUNDARY_NOT_PROVEN',providerResult,reconciledAt};
    series.currentAttempt=attempt;
    series.status='ARMED_FISHING';
    await persistAttempt(env,{runId:seriesId,result:'INVALIDATED_BEFORE_POST',...attempt});
    await appendRealLedger(env,'ENTRY_LOCAL_PRE_PROVIDER_REJECTED',{
      seriesId,attemptId,intentNo,attemptNo:null,ticker:candidate.ticker,clientOrderId,
      error:'PROVIDER_POST_BOUNDARY_NOT_PROVEN',writerInvoked,providerPostStarted:false,providerAttemptCounted:false,finalResult:'INVALIDATED_BEFORE_POST'
    });
    const released=await releaseProvenNoPost(env,{
      seriesId,attemptNo:providerAttemptNoCandidate,specimenId:series.fireLatch?.specimenId,
      clientOrderId,ticker:candidate.ticker,side:candidate.outcomeSide,windowClose:candidate.closeTime
    });
    if(!released.granted){
      series.unresolvedEntry=true;series.status='ATOMIC_OWNERSHIP_RECONCILIATION_REQUIRED';
      return saveRealSeriesState(env,series);
    }
    await settleSeriesControl(env,series,0);
    return saveRealSeriesState(env,series);
  }

  const attemptNo=providerAttemptNoCandidate;
  attempt={...attempt,attemptNo,providerAttemptNo:attemptNo,providerAttemptCounted:true,status:'PROVIDER_POST_STARTED',writerInvoked:true,providerPostStarted:true,providerResponseState:'AWAITING_RESPONSE'};
  series.attemptsStarted=attemptNo;
  series.unresolvedEntry=true;
  series.currentAttempt=attempt;
  series.fireLatch={...series.fireLatch,state:'PROVIDER_POST_STARTED',providerPost:'YES',providerOrderId:null,finalResult:null};
  await persistAttempt(env,{runId:seriesId,result:'PROVIDER_POST_STARTED',...attempt});
  await appendRealLedger(env,'ENTRY_PROVIDER_POST_STARTED',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,clientOrderId,writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true,proof});
  await saveRealSeriesState(env,series);

  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    series.status='ENTRY_RECONCILIATION_REQUIRED';
    series.unresolvedEntry=true;
    series.fireLatch={...series.fireLatch,state:'PROVIDER_POST_CREATED',providerPost:'YES',providerOrderId:null,finalResult:'REJECTED_OR_UNKNOWN'};
    attempt={...attempt,status:'PROVIDER_REJECTED_OR_UNKNOWN',providerHttpStatus:response.status,providerResponseState:'HTTP_REJECTED_OR_UNKNOWN',terminalClassification:'PROVIDER_REJECTED_OR_UNKNOWN'};
    series.currentAttempt=attempt;
    await persistAttempt(env,{runId:seriesId,result:'PROVIDER_REJECTED_OR_UNKNOWN',...attempt});
    await appendRealLedger(env,'ENTRY_PROVIDER_REJECTED_OR_UNKNOWN',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,httpStatus:response.status,writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true,proof});
    await settleSeriesControl(env,series,0);
    return saveRealSeriesState(env,series);
  }

  const result=interpretPayneOrderResponse(body);
  series.fireLatch={...series.fireLatch,state:'PROVIDER_RESULT',providerPost:'YES',providerOrderId:result.orderId||null,providerSubmittedPrice:attempt.preSubmitPrice??null,providerStatus:result.state,finalResult:result.state};
  attempt={...attempt,status:result.state,providerHttpStatus:response.status,providerOrderId:result.orderId||null,providerResponseState:result.state,providerResult:result,providerProof:proof};
  series.currentAttempt=attempt;

  if(result.state==='NO_FILL'){
    series.unresolvedEntry=false;
    attempt={...attempt,terminalClassification:'NO_FILL'};
    series.currentAttempt=attempt;
    if(seriesTerminal(series)){series.status='COMPLETE_NO_FILL';series.completedAt=new Date().toISOString();}
    else {series.status='ARMED_FISHING';}
    await persistAttempt(env,{runId:seriesId,result:'NO_FILL',...attempt});
    await appendRealLedger(env,'ENTRY_NO_FILL',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,result,writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true,proof});
    await settleSeriesControl(env,series,0);
    return saveRealSeriesState(env,series);
  }

  if(result.state==='UNKNOWN'){
    series.status='ENTRY_RECONCILIATION_REQUIRED';series.unresolvedEntry=true;
    attempt={...attempt,terminalClassification:'UNKNOWN'};
    series.currentAttempt=attempt;
    await persistAttempt(env,{runId:seriesId,result:'UNKNOWN',...attempt});
    await appendRealLedger(env,'ENTRY_RESULT_UNKNOWN',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,result,writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true,proof});
    await settleSeriesControl(env,series,0);
    return saveRealSeriesState(env,series);
  }

  const position={
    schema:'PAYNE_REAL_POSITION_V1',owner:REAL_OWNER,seriesId,attemptId,attemptNo,status:'OPEN',
    asset:candidate.asset,marketTicker:candidate.ticker,outcomeSide:candidate.outcomeSide,direction:candidate.direction,
    paperCandidateKey:paperCandidateKey(candidate),
    exchangeIndex:2,entryOrderId:result.orderId,entryClientOrderId:result.clientOrderId||clientOrderId,
    filledCount:Number(result.fillCount),remainingExitCount:Number(result.fillCount),entryAverageFillPrice:result.averageFillPrice,
    entryAverageFeePaid:result.averageFeePaid,entryScore:finalFeature.score,entryMove:finalFeature.move,entryEdge:finalFeature.edge,
    entryTime:new Date(nowMs).toISOString(),freshLockAt:freshLock.readAt,preSubmitAt:preSubmit.readAt,
    fillState:result.state,exitFilledTotal:0,exitAttempt:0,reconciliationState:'OPEN_PENDING_PROVIDER_RECONCILIATION',
  };
  attempt={...attempt,terminalClassification:'FILLED'};
  series.currentAttempt=attempt;
  series.position=position;series.unresolvedEntry=false;series.status=seriesTerminal(series)?'ATTEMPT_LIMIT_REACHED_MANAGING_POSITION':'MANAGING_POSITION_SERIES_CONTINUES';
  await persistAttempt(env,{runId:seriesId,result:result.state,...attempt});
  await persistPosition(env,{positionId:attemptId,...position});
  await appendRealLedger(env,'POSITION_OWNERSHIP_ESTABLISHED',{seriesId,attemptId,intentNo,attemptNo,ticker:candidate.ticker,entryOrderId:position.entryOrderId,clientOrderId:position.entryClientOrderId,exchangeIndex:2,filledCount:position.filledCount,fillState:result.state,writerInvoked:true,providerPostStarted:true,providerAttemptCounted:true});
  await settleSeriesControl(env,series,1);
  return saveRealSeriesState(env,series);
}

export function step1Status() {
  return {
    service:SERVICE_ID,
    mode:'PAYNE_REAL_CAPABILITY_BUILT / DEPLOY_DISARMED',
    stateBinding:STATE_BINDING,
    defaultState:defaultControlState(),
    realCapabilityBuilt:true,
    writeContract:PAYNE_WRITE_CONTRACT,
    providerWrites:0,
    providerWriteAuthority:'BUILT_INACTIVE_DISARMED',
    realExecution:'BUILT_INACTIVE_DISARMED',
    fundingAuthority:'INDEX2_ONLY_INACTIVE_DISARMED',
    requiredExchangeIndex:2,
    index2:'READ_REQUIRED_BEFORE_ENTRY',
    secondIoc:'HOLD_UNCHANGED',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/control') {
      let body={}; try { body=await request.json(); } catch {}
      try {
        if(String(body?.action||'').toUpperCase()==='RECONCILE_UNRESOLVED_ENTRY'){
          const reconciliation=await reconcileUnresolvedEntryFromProvider(env);
          return Response.json(reconciliation,{headers:{'cache-control':'no-store'}});
        }
        const control=await updateFounderControl(env,body?.action,body?.value);
        return Response.json({
          ok:true,
          control:{
            armed:control.armed,
            threshold:control.activeThreshold,
            maxEntryDebitUsd:control.maxEntryDebitUsd,
            attemptTarget:control.attemptTarget,
            scanEnabled:control.scanEnabled,
            providerWriteAuthority:control.providerWriteAuthority,
            providerPostAuthority:control.providerPostAuthority,
            realExecution:control.realExecution,
            fundingAuthority:control.fundingAuthority,
            requiredExchangeIndex:2,
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
          providerWriteAuthority:control.providerWriteAuthority,
          providerPostAuthority:control.providerPostAuthority,
          realExecution:control.realExecution,
          fundingAuthority:control.fundingAuthority,
          requiredExchangeIndex:2,
        },
        providerWrites:0,
        orders:0,
        capitalMovedUsd:0,
      });
    }
    if (url.pathname === '/ui-state') {
      return Response.json(await buildFastUiState(env),{headers:{'cache-control':'no-store'}});
    }
    if (url.pathname === '/real-state') {
      const control=await loadControl(env);
      const series=await loadRealSeriesState(env);
      return Response.json({ok:true,schema:'PAYNE_REAL_STATE_V1',control,series,writeContract:PAYNE_WRITE_CONTRACT,providerWrites:0,ordersSubmittedByThisRead:0,capitalMovedUsd:0},{headers:{'cache-control':'no-store'}});
    }
    if (url.pathname === '/real-ledger') {
      const requested=Number(url.searchParams.get('limit')||200);
      const seriesId=String(url.searchParams.get('seriesId')||'').trim();
      let rows=await listRealLedger(env,requested);
      if(seriesId) rows=rows.filter(x=>String(x?.seriesId||'')===seriesId);
      return Response.json({ok:true,schema:'PAYNE_REAL_LEDGER_EXPORT_V1',readOnly:true,seriesId:seriesId||null,count:rows.length,rows,providerWrites:0,ordersSubmittedByThisRead:0,capitalMovedUsd:0},{headers:{'cache-control':'no-store'}});
    }
    if (url.pathname === '/real-history') {
      try{
        const report=await buildHistoricalSeriesReport(env,url.searchParams.get('seriesId'));
        return Response.json(report,{headers:{'cache-control':'no-store'}});
      }catch(error){
        return Response.json({ok:false,error:String(error?.message||'PAYNE_HISTORY_FAILED'),providerWrites:0,ordersSubmittedByThisRead:0,capitalMovedUsd:0},{status:400,headers:{'cache-control':'no-store'}});
      }
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
    if (url.pathname === '/forensic/would-fire') {
      try{
        const requested=Number(url.searchParams.get('checkpoint')||59);
        const checkpointLimit=Math.max(1,Math.min(500,Number.isFinite(requested)?Math.trunc(requested):59));
        const data=await buildWouldFireForensic(env,{checkpointLimit});
        const format=String(url.searchParams.get('format')||'json').toLowerCase();
        if(format==='csv') return new Response(forensicRowsCsv(data.rows),{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'no-store','content-disposition':'attachment; filename="payne-would-fire-forensic.csv"'}});
        if(format!=='json') return Response.json({ok:false,error:'FORENSIC_FORMAT_NOT_ALLOWED',providerWrites:0,orders:0,capitalMovedUsd:0},{status:400});
        return Response.json(data,{headers:{'cache-control':'no-store'}});
      }catch(error){
        return Response.json({ok:false,schema:'PAYNE_WOULD_FIRE_FORENSIC_V1',error:String(error?.message||'FORENSIC_FAILED'),providerWrites:0,orders:0,capitalMovedUsd:0},{status:500,headers:{'cache-control':'no-store'}});
      }
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
    const schedulerStartedMs=Date.now();
    await initializeDisarmed(env);
    const control=await loadControl(env);
    // Pending management, reconciliation, and already-durable FIRE latches
    // must not wait for another full scan.
    // New entry authority still waits for the scan to finish persisting a FIRE latch.
    const initialSeries=await loadRealSeriesState(env);
    // A previously persisted FIRE latch is already complete; fresh provider
    // checks still run before the submission boundary.
    const urgent=paynePriorityBeforeScan(control,initialSeries);
    if(urgent){
      const urgentStartMs=Date.now();
      try{
        await runPayneRealExecutionCycle(env);
        logPayneTiming('URGENT_MANAGEMENT_BEFORE_SCAN',payneTimingIdentity(initialSeries,initialSeries?.fireLatch),urgentStartMs,Date.now(),'SUCCESS');
      }catch(error){
        logPayneTiming('URGENT_MANAGEMENT_ERROR',payneTimingIdentity(initialSeries,initialSeries?.fireLatch),urgentStartMs,Date.now(),String(error?.name||'EXECUTION_ERROR'));
        return;
      }
    }
    if (control.scanEnabled) {
      const scanStartMs=Date.now();
      logPayneTiming('SCAN_START',{seriesId:'',ticker:'',side:'',windowClose:''},schedulerStartedMs);
      try {
        await runReadOnlyScan(env,'SCHEDULED_CRON');
        logPayneTiming('SCAN_END',{seriesId:'',ticker:'',side:'',windowClose:''},scanStartMs,Date.now(),'SUCCESS');
      } catch(error) {
        logPayneTiming('SCAN_ERROR',{seriesId:'',ticker:'',side:'',windowClose:''},scanStartMs,Date.now(),String(error?.name||'SCAN_ERROR'));
      }
    }
    const cycleStartMs=Date.now();
    try {
      const series=await loadRealSeriesState(env);
      const identity=payneTimingIdentity(series,series?.fireLatch);
      logPayneTiming('CYCLE_AFTER_SCAN',identity,schedulerStartedMs);
      const managementPending=Boolean(series?.position && ['OPEN','EXIT_RETRY','EXIT_RECONCILIATION_REQUIRED','RECONCILIATION_UNKNOWN'].includes(String(series.position.status||'')));
      const entryReconciliationPending=series?.unresolvedEntry===true;
      // Avoid a second management cycle in one scheduled invocation.
      // Newly latched entries are processed only AFTER the scan has completed.
      if (!urgent && (control.armed || managementPending || entryReconciliationPending)) await runPayneRealExecutionCycle(env);
      else await reconcileDisarmedSupersededSeries(env,series,control);
      logPayneTiming('EXECUTION_CYCLE_END',identity,cycleStartMs,Date.now(),'SUCCESS');
    } catch(error) {
      logPayneTiming('EXECUTION_CYCLE_ERROR',{seriesId:'',ticker:'',side:'',windowClose:''},cycleStartMs,Date.now(),String(error?.name||'EXECUTION_ERROR'));
    }
  },
};
