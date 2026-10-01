import { kalshiReadOnlyProof } from './kalshi-get-only.js';

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
    index3:'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT',
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
