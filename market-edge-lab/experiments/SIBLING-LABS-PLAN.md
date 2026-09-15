# Market Edge Lab — Sibling Labs Plan

Record date: 2026-09-15
Mode: PAPER ONLY

## Governing rule

Preserve the currently working Market Edge Lab baseline exactly as the control. Build experimental siblings beside it, not through it. No sibling may share paper balance, positions, ledger, or mutable state with the baseline.

## Control — Market Edge Baseline

Status: FROZEN.

Purpose: preserve the current score/threshold strategy as the control group.

Do not add NFE reasoning, Payne logic, symmetric discovery, or tune thresholds/hold/risk rules inside this control.

## Sibling A — Symmetric UP/DOWN

Purpose: test the same baseline decision rules while expanding candidate discovery to both sides of the hypothesis space.

Only intended experimental difference: validated ABOVE/BELOW (or equivalent YES/NO where mathematically valid) market-side coverage.

Requirements:
- label every candidate/trade ABOVE or BELOW;
- avoid double-counting economically equivalent positions;
- preserve the same starting paper capital, score threshold, max stake, hold rule, and evidence discipline as the control unless a later experiment record explicitly changes one variable;
- separate state and evidence ledger.

## Sibling B — NFE Reasoning

Purpose: test whether NFE reasoning adds measurable decision value for a small everyday trader.

Decision sequence:
1. Receive the same timestamped candidate snapshot available to the control when practical.
2. Record the baseline decision before outcome is known.
3. Challenge assumptions.
4. Look for missing evidence.
5. Test the counter-case/opposite side.
6. Assess correlated exposure and risk.
7. Return ENTER / WATCH / REJECT with confidence, reason, primary risk, and invalidation condition.
8. Lock the decision before outcome is known.
9. Score the eventual outcome truthfully.

NFE receives no special treatment. Rejected winners are misses. Entered losers are failures. Avoided losers and captured winners are successes. Ambiguous evidence remains ambiguous. Reasoning quality and outcome quality are recorded separately.

## Sibling C — Payne Method

Purpose: test publicly described Charles Payne-style concepts without assuming they are correct.

Framework under test:
- RADAR — identify a candidate;
- LOCK IN — seek confirmation that the thesis/underlying case is strengthening;
- PULL TRIGGER — define entry timing;
- preserve explicit risk and exit rationale.

Payne concepts are hypotheses to test, not truths to encode. Record rejected candidates and losses as rigorously as winners.

## Common presentation

All siblings should intentionally retain the accepted Market Edge Lab visual language so comparisons are easy:
- NFE-OS branding;
- paper balance and realized P/L;
- BTC/ETH live-display cards and mini charts where relevant;
- collector health;
- testing counts;
- opportunity cards with prominent SCORE;
- open positions;
- closed paper trades;
- evidence export.

Each sibling must have an unmistakable identity badge: BASELINE, UP/DOWN, NFE REASONING, or PAYNE METHOD.

## Isolation

Each sibling requires its own mutable cloud state, paper balance, positions, and ledger. A failure or experimental change in one sibling must not mutate another sibling or the frozen baseline.

Shared read-only market snapshots are preferred when practical because simultaneous inputs make comparisons stronger.

## Comparison metrics

Compare systems using at least:
- net paper P/L;
- win/loss rate;
- expectancy;
- drawdown;
- number of trades;
- avoided losers;
- rejected/missed winners;
- exposure concentration;
- holding-time compliance;
- reasoning accuracy where reasoning exists;
- performance by ABOVE/BELOW side where applicable.

Do not declare a winner from a tiny sample. Preserve raw evidence and version boundaries.

## Long-term hypothesis

Only after the siblings have accumulated comparable evidence should we consider a combined NFE-OS Trading Assistant that incorporates components shown by evidence to add value. Do not merge features merely because they sound useful.

The combined assistant remains paper-only until a separate, explicit decision and safety/legal review authorizes anything else.
