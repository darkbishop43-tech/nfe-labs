export const EXPERIMENT_MODE = "ZERO_MONEY_ONLY";
export const CONTROL_EXIT_SCORE = 0.20;
export const CONTROL_MAX_HOLD_MS = 5 * 60 * 1000;
export const EXPERIMENT_ARCHIVE_PREFIX = "auto-exp-v1:lifecycle:";

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function economicsFromObservation(state, observation) {
  const entryPrice = finite(state.entryPrice);
  const bid = finite(observation.bid);
  const ask = finite(observation.ask);
  const quantity = finite(state.quantity);
  const currentMark = bid ?? ask;
  const unrealized = entryPrice != null && currentMark != null && quantity != null
    ? (currentMark - entryPrice) * quantity
    : null;

  const priorMfe = finite(state.mfe);
  const priorMae = finite(state.mae);
  let mfe = priorMfe;
  let mae = priorMae;
  let mfeAt = state.mfeAt ?? null;
  let maeAt = state.maeAt ?? null;

  if (unrealized != null) {
    if (mfe == null || unrealized > mfe) {
      mfe = unrealized;
      mfeAt = observation.at;
    }
    if (mae == null || unrealized < mae) {
      mae = unrealized;
      maeAt = observation.at;
    }
  }

  return { currentBid: bid, currentAsk: ask, unrealizedPnl: unrealized, mfe, mae, mfeAt, maeAt };
}

export function initialDynamicManagementState(identity = {}) {
  return {
    experimentAuthority: "ZERO",
    providerWrites: 0,
    orders: 0,
    capitalMovedUsd: 0,
    state: "OWNED",
    seriesId: identity.seriesId ?? null,
    attemptId: identity.attemptId ?? null,
    ticker: identity.ticker ?? null,
    asset: identity.asset ?? null,
    direction: identity.direction ?? null,
    side: identity.side ?? null,
    entryAt: identity.entryAt ?? null,
    entryPrice: finite(identity.entryPrice),
    entryScore: finite(identity.entryScore),
    entryFees: finite(identity.entryFees),
    quantity: finite(identity.quantity),
    fiveMinuteCheckpoint: null,
    currentBid: null,
    currentAsk: null,
    unrealizedPnl: null,
    mfe: null,
    mae: null,
    mfeAt: null,
    maeAt: null,
    settlementValue: null,
    realizedPnl: null,
    reconciliationPath: [],
    history: [],
  };
}

export function dynamicManagementStep(state, observation) {
  const next = structuredClone(state);
  next.history = Array.isArray(next.history) ? next.history : [];
  next.reconciliationPath = Array.isArray(next.reconciliationPath) ? next.reconciliationPath : [];

  const econ = economicsFromObservation(next, observation);
  Object.assign(next, econ);

  const score = finite(observation.score);
  const ageMs = finite(observation.ageMs);
  const thesisState = observation.thesisState ?? "UNKNOWN";
  const controlMaxHoldSatisfied = ageMs != null && ageMs >= CONTROL_MAX_HOLD_MS;
  const scoreExit = score != null && score <= CONTROL_EXIT_SCORE;

  const record = {
    at: observation.at,
    ageMs,
    score,
    bid: econ.currentBid,
    ask: econ.currentAsk,
    thesisState,
    providerState: observation.providerState ?? "UNKNOWN",
    reconciliationState: observation.reconciliationState ?? "UNKNOWN",
    contractIdentityOk: observation.contractIdentityOk !== false,
    sideIdentityOk: observation.sideIdentityOk !== false,
    controlMaxHoldSatisfied,
    scoreExit,
    experimentDecision: null,
    unrealizedPnl: econ.unrealizedPnl,
    mfe: econ.mfe,
    mae: econ.mae,
  };

  const evidenceUnavailable =
    record.providerState === "UNKNOWN" ||
    record.reconciliationState === "UNKNOWN" ||
    record.contractIdentityOk === false ||
    record.sideIdentityOk === false ||
    observation.requiredManagementEvidenceAvailable === false;

  if (observation.isFiveMinuteCheckpoint === true && next.fiveMinuteCheckpoint == null) {
    next.fiveMinuteCheckpoint = {
      ...record,
      controlWould: "MAX_HOLD_EXIT",
      experimentWould: scoreExit ? "SCORE_EXIT" : evidenceUnavailable ? "FAIL_CLOSED" : "CONTINUE",
    };
  }

  if (evidenceUnavailable) {
    record.experimentDecision = "FAIL_CLOSED_TO_CONTROL";
    next.history.push(record);
    next.state = "FAIL_CLOSED_TO_CONTROL";
    next.failClosedAt = observation.at;
    next.failClosedReason = "REQUIRED_EVIDENCE_UNAVAILABLE";
    next.controlFallback = {
      scoreExit,
      maxHoldSatisfied: controlMaxHoldSatisfied,
      eligibleExitReason: scoreExit ? "SCORE_EXIT" : controlMaxHoldSatisfied ? "MAX_HOLD_EXIT" : null,
      behavior: scoreExit || controlMaxHoldSatisfied ? "CONTROL_GOVERNED_EXIT_ELIGIBLE" : "CONTROL_MANAGEMENT_RESUMES",
    };
    return next;
  }

  if (scoreExit) {
    record.experimentDecision = "SCORE_EXIT";
    next.history.push(record);
    next.state = "EXIT_DECISION_RECORDED";
    next.exitClass = "SCORE_EXIT";
    next.exitDecisionAt = observation.at;
    return next;
  }

  if (observation.contractExpired === true) {
    record.experimentDecision = "SETTLEMENT_HOLD";
    next.history.push(record);
    next.state = "SETTLEMENT_HOLD";
    next.settlementAt = observation.at;
    next.settlementValue = finite(observation.settlementValue);
    next.realizedPnl = finite(observation.realizedPnl);
    if (observation.reconciliationState) next.reconciliationPath.push(observation.reconciliationState);
    return next;
  }

  record.experimentDecision = "CONTINUE";
  next.history.push(record);
  next.state = "CONTINUE";
  next.reason = observation.isFiveMinuteCheckpoint === true
    ? "FIVE_MINUTE_CHECKPOINT_OBSERVED_NO_TIME_ONLY_EXIT"
    : "SCORE_ABOVE_CONTROL_EXIT_AND_EVIDENCE_VALID";
  return next;
}

export function finalizeExperimentalExit(state, exit = {}) {
  const next = structuredClone(state);
  next.exitOrderAt = exit.exitOrderAt ?? null;
  next.exitOrderId = exit.exitOrderId ?? null;
  next.exitFillAt = exit.exitFillAt ?? null;
  next.exitFillPrice = finite(exit.exitFillPrice);
  next.exitFees = finite(exit.exitFees);
  next.exitUnfilled = exit.exitUnfilled === true;
  next.settlementValue = finite(exit.settlementValue) ?? next.settlementValue;
  next.realizedPnl = finite(exit.realizedPnl);
  next.reconciliationPath = [...(next.reconciliationPath || []), ...(exit.reconciliationPath || [])];
  next.state = exit.exitUnfilled === true ? "EXIT_UNFILLED_RECONCILE" : "RECONCILED";
  return next;
}

export function archiveKeyFor(state) {
  if (!state.seriesId || !state.attemptId || !state.ticker) throw new Error("DURABLE_IDENTITY_INCOMPLETE");
  return EXPERIMENT_ARCHIVE_PREFIX + encodeURIComponent(state.seriesId) + ":" +
    encodeURIComponent(state.attemptId) + ":" + encodeURIComponent(state.ticker);
}

export async function persistCompletedLifecycle(kv, state) {
  if (!kv || typeof kv.put !== "function") throw new Error("DURABLE_STORE_UNAVAILABLE");
  const key = archiveKeyFor(state);
  const payload = {
    schema: "AUTO_EXPERIMENT_V1_LIFECYCLE",
    version: 1,
    completed: true,
    evidence: structuredClone(state),
  };
  await kv.put(key, JSON.stringify(payload));
  return key;
}

export async function loadCompletedLifecycle(kv, key) {
  if (!kv || typeof kv.get !== "function") throw new Error("DURABLE_STORE_UNAVAILABLE");
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : null;
}
