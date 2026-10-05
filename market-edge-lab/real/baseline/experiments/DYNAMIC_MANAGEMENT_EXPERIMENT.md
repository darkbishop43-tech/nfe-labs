# AUTO Dynamic Management Experiment — Zero-Money Design

Rollback baseline: branch `auto-control-rollback-2026-10-05` pinned to deployed commit `ebb49962a3d1e66ecf630a0d02c2b88e986df729`.

This branch is experimental only. Real experimental authority remains ZERO.

## Isolation
Entry brain is unchanged. Control retains SCORE_EXIT <= 0.20 and MAX_HOLD 5 minutes.

## Experimental state machine
OWNED -> CONTINUE -> EXIT_DECISION_RECORDED or SETTLEMENT_HOLD -> RECONCILE/RECORD.

At 5:00 the experiment records a checkpoint. Time alone does not emit an experimental exit.

## Strategy brain
No THESIS_EXIT numeric rule is implemented.
No ECONOMIC_EXIT numeric rule is implemented.
The harness accepts only an injected `approvedDecision` value so lifecycle mechanics can be tested before Founder approves any strategy rule.

## Fail closed
If provider state or reconciliation is UNKNOWN, contract identity is inconsistent, or required evidence is unavailable, experimental continuation is not authorized. State becomes FAIL_CLOSED with reason REQUIRED_EVIDENCE_UNAVAILABLE. Before any live authorization Main Chat must select the exact real-money safety action for this branch.

## Storage
This zero-money design adds no schema migration and does not mutate production KV/D1. Any future retention extension must be additive/backward-compatible.
