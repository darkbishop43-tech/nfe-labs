export const EXPERIMENT_MODE = "ZERO_MONEY_ONLY";

export function dynamicManagementStep(state, observation) {
  const next = structuredClone(state);
  next.history = Array.isArray(next.history) ? next.history : [];
  const record = {
    at: observation.at,
    score: observation.score ?? null,
    marketPrice: observation.marketPrice ?? null,
    thesisState: observation.thesisState ?? "UNKNOWN",
    remainingMs: observation.remainingMs ?? null,
    providerState: observation.providerState ?? "UNKNOWN",
    reconciliationState: observation.reconciliationState ?? "UNKNOWN",
    controlWouldExitAtFive: observation.controlWouldExitAtFive === true,
    approvedDecision: observation.approvedDecision ?? null,
  };
  next.history.push(record);

  if (observation.isFiveMinuteCheckpoint === true && next.fiveMinuteCheckpoint == null) {
    next.fiveMinuteCheckpoint = { ...record };
  }

  if (observation.reconciliationState === "UNKNOWN" ||
      observation.providerState === "UNKNOWN" ||
      observation.contractIdentityOk === false) {
    next.state = "FAIL_CLOSED";
    next.reason = "REQUIRED_EVIDENCE_UNAVAILABLE";
    return next;
  }

  if (observation.approvedDecision === "THESIS_EXIT" ||
      observation.approvedDecision === "ECONOMIC_EXIT" ||
      observation.approvedDecision === "SAFETY_EXIT") {
    next.state = "EXIT_DECISION_RECORDED";
    next.exitClass = observation.approvedDecision;
    next.exitDecisionAt = observation.at;
    return next;
  }

  if (observation.contractExpired === true) {
    next.state = "SETTLEMENT_HOLD";
    next.settlementAt = observation.at;
    return next;
  }

  next.state = "CONTINUE";
  next.reason = observation.isFiveMinuteCheckpoint === true
    ? "FIVE_MINUTE_CHECKPOINT_OBSERVED_NO_TIME_ONLY_EXIT"
    : "NO_APPROVED_EXIT_DECISION";
  return next;
}

export function initialDynamicManagementState(identity = {}) {
  return {
    experimentAuthority: "ZERO",
    providerWrites: 0,
    orders: 0,
    capitalMovedUsd: 0,
    state: "OWNED",
    identity,
    fiveMinuteCheckpoint: null,
    history: [],
  };
}
