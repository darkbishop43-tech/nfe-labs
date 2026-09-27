# NFE-OS Market Edge — Founder Stake Deployment Preparation

Date: 2026-09-27

Purpose: human-applied preparation package for the Founder-selected stake propagation repair. This document does not change live execution authority and does not contain a ready-to-run live patch.

## Locked baseline

Repository: `darkbishop43-tech/nfe-labs`
Branch: `market-edge-baseline-real`
Branch checkpoint reviewed before this document: `f694e1b5a82c8f4fb19d1866895226ba3d268e3f`
Pre-repair snapshot authority supplied by Founder: `snapshot-2026-09-27-pre-founder-stake-authority`

Do not change any execution behavior outside the stake propagation path.

Preserve: RADAR, LOCK, FIRE, MANAGE, RECORD, scheduler, candidate selection/ranking, IOC, pre-submit refresh, YES/NO conversion, provider routing, ownership, OPEN/FLAT/UNKNOWN reconciliation, `position_fp`, pagination, `safeExitQuantity`, `reduce_only`, `.20` exit, five-minute max hold, Phase 1A/1B, NO_FILL behavior, accounting, reporting, queue behavior, threshold handling, attempts handling, concurrency handling, Original ARM, and DISARM.

## Human edit map

Target file: `market-edge-lab/real/baseline/src/index.js`

The repair should remain limited to these semantic points:

1. Existing execution-test ARM input handling
   - Continue accepting threshold and attempts exactly as today.
   - Add human-written handling for an already validated Founder stake value.
   - Valid supported stake range remains `$1` through `$10`.
   - Invalid explicit stake must fail closed; do not clamp or silently substitute.
   - When no explicit Founder stake exists, preserve the existing `$1` default.

2. Existing armed-series state
   - Persist the accepted stake into the existing `state.maxEntryDebitUsd` field.
   - Do not introduce a second state object or second execution path.
   - Keep `maxConcurrent` unchanged at `3` for this repair.

3. Existing ARM ledger record
   - Record the actual frozen series stake from state instead of a permanent literal `$1` entry.
   - Preserve all existing ledger history and event names unless a human review determines the event payload alone can be changed safely.

4. Existing execution-test first sizing stage
   - The human edit should make the existing sizing stage consume the frozen armed-series stake.
   - Preserve the existing static execution-test config only as the safe fallback for a missing series value.
   - Do not change fee calculation, quantity math, candidate selection, or provider payload format.

5. Existing execution-test pre-submit sizing stage
   - Apply the same frozen-series stake source at the final pre-submit sizing calculation.
   - Preserve every other pre-submit check and refresh rule.

6. Provider payload
   - Do not add a new dollar field to the provider payload.
   - Existing behavior derives provider order quantity from the sizing result; only the sizing cap source should change.

## Source anchors verified before preparation

The current control/state code already exposes an existing `state.maxEntryDebitUsd` field in the active frozen configuration display and retains the zero-money Coach Card validation path. The current execution-test status response still reports the live safety ceiling as `$1`, confirming no higher-stake live propagation has been deployed as part of this preparation.

The current Original ARM and DISARM must remain present after the human edit.

## Zero-money acceptance matrix

Do not arm a live run during verification.

### Case A — default

Input: no explicit Founder stake
Expected frozen state:
- `maxEntryDebitUsd = 1`
- `maxConcurrent = 3`
Expected sizing preview:
- first sizing stage cap = `1`
- pre-submit sizing stage cap = `1`

### Case B — Founder test target

Input:
- threshold `0.60`
- attempts `5`
- stake `$2`
- maxConcurrent `3`

Expected frozen state:
- threshold `0.60`
- maxAttempts `5`
- maxEntryDebitUsd `2`
- maxConcurrent `3`

Expected sizing preview:
- first sizing stage cap = `2`
- pre-submit sizing stage cap = `2`
- provider-order quantity preview is derived from the existing fee-safe sizing calculation under the `$2` cap

### Case C — additional supported previews

Verify independently:
- `$5` resolves to frozen stake `5` and both sizing stages read `5`
- `$10` resolves to frozen stake `10` and both sizing stages read `10`

### Case D — invalid input

Verify values outside the supported range fail closed.
Do not silently clamp.
Do not silently revert an explicitly invalid value to `$1`.

### Case E — immutability

After a valid configuration is frozen for preview, mutate the editable UI values.
Expected: the frozen preview/state copy does not change.

## Mandatory zero-money evidence

Before any production deployment, evidence must show:

- `providerWrites = 0`
- `capitalMovedUsd = 0`
- `tradingOrders = 0`
- Original ARM present = YES
- DISARM present = YES
- `maxConcurrent = 3`
- no new Worker
- no new scheduler
- no new execution engine
- no changes to provider routing or payload format

## Diff review gate

Before deployment, compare the human-edited commit against the preserved baseline/snapshot.

Reject the change if the diff contains edits outside:
- execution-test ARM stake input/persistence
- execution-test ARM ledger stake field
- execution-test first sizing cap source
- execution-test pre-submit sizing cap source
- non-executing verification code needed to prove the above

Any unrelated change is a stop condition.

## Deployment checklist for Founder

1. Confirm the snapshot/tag remains available.
2. Make the human-written stake propagation edits only.
3. Run the zero-money acceptance matrix.
4. Confirm provider writes/capital/orders are all zero.
5. Review the git diff against the snapshot/baseline.
6. Confirm Original ARM and DISARM still exist.
7. Confirm concurrency remains `3`.
8. Only after all checks are green, use the existing Baseline Real deployment workflow/Worker. Do not create a replacement deployment path.
9. Do not arm a real series as part of deployment verification.
10. After deployment, open `/execution-test-control` and verify the page loads before deciding whether to arm a bounded Founder test.

## Rollback rule

If build, zero-money verification, post-deploy health, or control-page verification is not green, stop and restore from the pre-repair snapshot/checkpoint rather than layering further execution changes.

Validation over everything. Reality keeps score.
