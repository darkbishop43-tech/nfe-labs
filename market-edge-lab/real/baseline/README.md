# Market Edge — Baseline Real

Status: ACTIVE BUILD

Checkpoint: 2026-09-17 approximately 01:51 EDT

## Isolation boundary

This is a new, separate Baseline Real application. It must not modify the existing Market Edge paper Baseline, NFE Reasoning, or Payne Method builds, their code, Workers, KV state, schedulers, balances, ledgers, or dashboards.

## Experimental objective

Test whether the existing Baseline decision model survives real Polymarket US market conditions and, only after explicit safety/compliance gates, tiny real-money execution.

## Initial state

- Polymarket US developer credentials: created by Founder; secrets must never be committed to GitHub or exposed client-side.
- Funding: $0.00 until gates pass.
- Live order submission: LOCKED.
- Shadow observation: begins only when the new collector is independently verified live.
- Intended initial experimental funding after approval: $5, with any later increase requiring a separate decision.

## Required progression

1. Isolated server-side credential storage.
2. Authenticated read-only account/balance proof.
3. Real market-data observation and timestamped shadow ledger.
4. Authenticated order preview/validation without submission.
5. Verify applicable Polymarket US rules, eligibility, funding, fees/minimums, settlement/redemption, withdrawal, and automated-trading requirements.
6. Founder explicitly authorizes funding.
7. One deliberately authorized minimal live transaction; reconcile Polymarket account result against local evidence ledger.
8. Autonomous real-money execution remains locked until separately authorized after evidence review.

## Comparison rule

Do not restart or synchronize the existing paper experiments. Preserve their prior history. Record the exact Baseline Real shadow-live timestamp and compare only overlapping periods where appropriate.

## Capital rule

Experimental capital is for validation, not income maximization. No automatic replenishment, escalation, or increase after wins or losses.
