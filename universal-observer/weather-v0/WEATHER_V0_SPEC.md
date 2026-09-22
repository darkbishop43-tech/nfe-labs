# Universal Observer — Weather V0

Status: PAPER / OBSERVATION ONLY
Created: 2026-09-22
Isolation: No Kalshi credentials, no provider writes, no bankroll, no order submission. Baseline Real is outside this branch's execution scope.

## Core principle
One platform, multiple domain engines. Each engine owns its evidence sources, model, features, contract-selection logic, confidence calculation, and validation record.

## Weather V0 target
Start with Kalshi DAILY HIGH TEMPERATURE range markets. Do not reuse the crypto scoring model.

Why this family:
- many same-day repetitions across cities
- mutually exclusive temperature buckets
- objective resolution
- Kalshi states daily temperature markets settle from the final NWS Daily Climate Report
- enough market-price variation to test model probability vs market probability

## Required contract map
For every observed event preserve:
- event/market ticker and title
- city and exact settlement station from contract rules
- observation date and local timezone
- every temperature bucket, including tail buckets
- YES bid/ask and timestamp
- market volume / liquidity fields when available
- close/settlement timing
- exact settlement-source/rule text or durable reference
- contract-rule snapshot hash/reference

Never infer settlement station from city name. If exact rules/source cannot be established: PASS.

## Weather evidence feature set

### A. Settlement truth
1. exact NWS settlement station
2. final CLI product identity
3. reporting day/time convention
4. rule anomalies / delayed-determination conditions

### B. Forecast evidence
1. NWS point forecast high
2. NWS hourly forecast trajectory
3. forecast issuance/update timestamps
4. prior forecast values so revisions are measurable
5. independent forecast/model inputs when their provenance and timestamps can be preserved
6. disagreement/spread between available forecasts

### C. Live observation evidence
1. current station temperature
2. maximum observed temperature so far
3. hourly temperature trajectory
4. dew point / humidity
5. wind speed/direction
6. cloud/sky conditions
7. precipitation
8. observation age/staleness
9. hours remaining in the relevant observation day
10. distance between observed max and each contract boundary

### D. Market evidence
1. bucket YES bid/ask
2. implied probability reference
3. spread
4. volume/liquidity
5. price change since prior snapshot
6. time remaining
7. probability mass across all mutually exclusive buckets

## Weather probability model V0
Produce a probability distribution for the day's FINAL official high, not a single-temperature guess.

For each bucket:
model_probability = probability(final official high resolves inside bucket)
market_probability = executable market price reference
raw_edge = model_probability - market_probability

The engine must explicitly account for uncertainty. Forecast disagreement, stale observations, uncertain station mapping, or settlement ambiguity REDUCES confidence.

No fixed .80 crypto threshold is inherited.

## Contract selection
Evaluate ALL buckets for the same city/day.

A contract can become a PAPER CANDIDATE only when:
- settlement station/source is verified
- evidence is fresh enough for the observation stage
- model probability is available
- executable market quote is available
- uncertainty is quantified
- estimated edge remains positive after a conservative cost/slippage allowance

Rank by evidence-supported expected value, not by highest probability of being correct.

PASS is a first-class result and must be recorded.

## Paper ledger schema
Each decision record must preserve:

```json
{
  "schema": "UNIVERSAL_OBSERVER_WEATHER_V0",
  "decisionId": "...",
  "capturedAt": "...",
  "paperOnly": true,
  "domain": "WEATHER",
  "family": "DAILY_HIGH_TEMPERATURE",
  "contract": {
    "eventTicker": "...",
    "marketTicker": "...",
    "city": "...",
    "station": "...",
    "date": "...",
    "bucket": "...",
    "yesBid": null,
    "yesAsk": null,
    "volume": null,
    "rulesReference": "..."
  },
  "evidence": {
    "nwsForecastHighF": null,
    "nwsForecastIssuedAt": null,
    "currentTempF": null,
    "observedMaxF": null,
    "observationAt": null,
    "forecastRevisionF": null,
    "forecastSpreadF": null,
    "hoursRemaining": null,
    "weatherInputs": []
  },
  "assessment": {
    "modelProbability": null,
    "marketProbability": null,
    "rawEdge": null,
    "costAllowance": null,
    "netPaperEdge": null,
    "confidence": null,
    "selectionReason": "...",
    "decision": "CANDIDATE_OR_PASS"
  },
  "resolution": {
    "officialHighF": null,
    "settlementSource": null,
    "resolvedBucket": null,
    "contractWon": null,
    "paperPnl": null
  }
}
```

## Validation scoreboard
Weather V0 is judged on BOTH forecasting quality and contract-selection quality:
- resolved observations
- Brier score
- log loss
- calibration by probability band
- final-high absolute error
- market-vs-model probability error
- candidate count vs PASS count
- paper win/loss count
- gross paper P/L
- conservative-cost paper P/L
- maximum drawdown
- results by city
- results by hours-to-resolution
- results by model-vs-market edge band

No promotion based only on win rate or profit.

## First experiment
Observe every eligible daily-high market available to the collector. For each city/day, snapshot the complete bucket set at governed intervals, calculate probabilities independently, select at most one best paper contract or PASS, freeze the decision before resolution, then reconcile against the official settlement result.

Initial research stake convention: $1 PAPER exposure per selected specimen so P/L is directly comparable across cities. This is accounting only; no real order path exists.

## Promotion gate
Weather V0 remains paper-only until a later Founder decision. A future real-money proposal requires enough resolved out-of-sample observations to establish calibration, edge persistence after costs, failure behavior, and city/time segmentation. No automatic promotion exists.

## Current source findings
- Kalshi's climate/weather calendar exposes daily temperature, hourly temperature, snow/rain, heatwaves, hurricanes, natural disasters and climate markets.
- Kalshi Help states daily high/low temperature markets use the final NWS Daily Climate Report; hourly temperature uses The Weather Company. Specific market rules remain authoritative.
- NWS CLI products are issued multiple times daily; the final settlement-relevant value can differ from preliminary readings, so the engine must preserve the exact settlement convention rather than treating a generic weather app as truth.
