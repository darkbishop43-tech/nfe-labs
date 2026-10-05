import { initialDynamicManagementState, dynamicManagementStep } from "../experiments/dynamic-management-zero-money.js";

export const AUTO_V1_DORMANT = "DORMANT";
export const AUTO_V1_ACTIVE = "FOUNDER_ACTIVE_V1";

export function autoV1Authority(env) {
  return String(env?.AUTO_DYNAMIC_MANAGEMENT_V1_AUTHORITY || AUTO_V1_DORMANT).trim().toUpperCase();
}

export function applyAutoV1OwnedManagement({ env, position, seriesId, now, ageMs, score, bid, exitByTime }) {
  if (autoV1Authority(env) !== AUTO_V1_ACTIVE) {
    position.autoV1Authority = AUTO_V1_DORMANT;
    return { effectiveExitByTime: Boolean(exitByTime), v1State: position.autoV1Management || null };
  }

  if (!position.autoV1Management) {
    position.autoV1Management = initialDynamicManagementState({
      seriesId,
      attemptId: String(position?.attemptNo ?? "UNKNOWN"),
      ticker: position?.marketTicker ?? null,
      asset: position?.asset ?? null,
      direction: position?.direction ?? null,
      side: position?.outcomeSide ?? null,
      entryAt: position?.filledAt ?? position?.submittedAt ?? null,
      entryPrice: position?.fillPrice ?? position?.entryPrice ?? position?.submittedPrice ?? null,
      entryScore: position?.entryScore ?? null,
      entryFees: position?.entryFees ?? position?.fees ?? null,
      quantity: position?.filledCount ?? null
    });
  }

  const exactScore = Number.isFinite(Number(score)) ? Number(score) : null;
  const exactBid = Number.isFinite(Number(bid)) ? Number(bid) : null;
  const evidenceReady = Boolean(
    exactBid != null &&
    exactScore != null &&
    position?.reconciliationClassification === "OPEN"
  );

  position.autoV1Management = dynamicManagementStep(position.autoV1Management, {
    at: new Date(now).toISOString(),
    ageMs,
    score: exactScore,
    bid: exactBid,
    ask: null,
    thesisState: exactScore == null ? "UNKNOWN" : "UNCHANGED",
    providerState: position?.reconciliationClassification || "UNKNOWN",
    reconciliationState: position?.reconciliationClassification || "UNKNOWN",
    contractIdentityOk: String(position?.matchedTicker || position?.marketTicker || "") === String(position?.marketTicker || ""),
    sideIdentityOk: Boolean(position?.outcomeSide),
    requiredManagementEvidenceAvailable: evidenceReady,
    isFiveMinuteCheckpoint: Boolean(exitByTime && !position.autoV1Management?.fiveMinuteCheckpoint),
    contractExpired: false
  });

  position.autoV1Authority = AUTO_V1_ACTIVE;
  position.autoV1ControlWouldMaxHold = Boolean(exitByTime);

  return {
    effectiveExitByTime: position.autoV1Management?.state === "CONTINUE" ? false : Boolean(exitByTime),
    v1State: position.autoV1Management
  };
}
