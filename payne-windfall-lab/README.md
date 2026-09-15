# ME-002 — Payne Windfall Paper Track

Status: SCAFFOLD ONLY
Mode: PAPER ONLY
Relationship to Market Edge Lab: PARALLEL EXPERIMENT, NOT A REPLACEMENT

## Research question

Can a rules-based implementation inspired by Charles Payne's publicly described investing framework identify U.S. equity opportunities with better-than-baseline outcomes when tested under NFE evidence discipline?

This lab does not assume the strategy works. It converts the public framework into falsifiable paper-trading rules and measures the results.

## Public framework being tested

### Three candidate sources

1. IPO Reversals
2. New Mavericks
3. Evolving Giants

### Three-stage decision process

1. RADAR — identify a potential windfall candidate before the major move.
2. LOCK IN — require evidence that the underlying business is getting stronger.
3. PULL TRIGGER — only after the first two gates pass, identify a defined technical entry condition.

## NFE translation

### RADAR gate

A candidate must be assigned to a specific source class with evidence. No vague 'interesting stock' entries.

Possible evidence fields:
- IPO date and post-IPO drawdown/recovery context
- industry or technology shift
- company reinvention or new growth engine
- market-cap and liquidity sanity checks

### LOCK IN gate

Require measurable business-strength evidence before any paper entry is eligible.

Candidate fields:
- revenue trend
- earnings trend
- margins
- cash generation
- balance-sheet direction
- management execution evidence
- industry tailwind
- material risks / contradictory evidence

NFE must record what evidence supports the thesis and what evidence could disprove it.

### PULL TRIGGER gate

Only candidates that passed RADAR and LOCK IN may receive a paper entry signal.

Potential technical fields to test rather than assume:
- trendline recovery / breakout
- volume confirmation
- moving-average reclaim
- relative strength
- defined invalidation level
- maximum planned loss

The exact trigger rules must be frozen before a cohort begins so results cannot be cherry-picked afterward.

## Evidence record for every candidate

Record before outcome is known:
- symbol
- timestamp
- RADAR class and evidence
- LOCK IN evidence and counterevidence
- trigger rule
- paper entry price
- planned risk
- invalidation condition
- planned holding thesis
- rejected-candidate reason when no trade is taken

Record after outcome:
- exit price and reason
- realized paper P/L
- maximum favorable excursion
- maximum adverse excursion
- holding time
- whether the original thesis remained true
- NFE postmortem classification

## Required evaluation

Do not judge the framework from one or two winners.

Evaluate by cohorts such as 25 / 50 / 100 qualified candidates using:
- qualification rate
- win rate
- average winner
- average loser
- payoff ratio
- expectancy
- maximum drawdown
- concentration risk
- benchmark-relative return
- performance by RADAR source class
- performance by trigger type

## Guardrails

- Paper trading only.
- No brokerage connection or order submission.
- Do not overwrite Market Edge ME-001 or its crypto/prediction-market strategy.
- Do not backfill rules after seeing outcomes.
- Public promotional performance claims are hypotheses to test, not assumptions.
- A losing cohort must be retained as evidence, not tuned away.

## Activation gate

ME-002 should not begin live paper collection until:

1. Market Edge cadence repair is verified with repeated near-five-minute collector runs.
2. A free or acceptable U.S. equity data source is selected.
3. The first RADAR / LOCK IN / PULL TRIGGER ruleset is frozen and versioned.
