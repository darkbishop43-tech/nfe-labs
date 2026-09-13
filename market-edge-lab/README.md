# NFE Market Edge Lab — V0

Standalone research experiment inside `nfe-labs`. It does **not** connect to NFE-OS Workspace, BLUE, Billing Lab, Production, wallets, exchanges, or live-money execution.

## Purpose

Test whether short-lived BTC/ETH price movement can expose repeatable temporary pricing dislocations in directional Polymarket markets **after spread, timing, liquidity, misses, and losses are recorded**.

## V0 pipeline

```text
Coinbase BTC / ETH live ticker
        ↓
Polymarket active directional crypto markets + order books
        ↓
Deterministic mispricing / lead-lag detector
        ↓
PAPER execution engine ($100 starting balance)
        ↓
Evidence ledger (every refresh / entry / exit / error)
        ↓
Later: NFE → HDP → RRS → Arena analysis over the accumulated evidence
```

## Safety boundary

- PAPER ONLY.
- No wallet connection.
- No exchange API key.
- No Polymarket signing key.
- No order submission endpoint.
- No live-money execution code.
- No modification to protected NFE-OS repositories or Production.

## Current V0 heuristic

V0 intentionally uses a simple, falsifiable lead-lag hypothesis rather than pretending it already knows fair value:

1. Watch BTC-USD and ETH-USD live ticker updates from Coinbase.
2. Measure 60-second price movement.
3. Discover active Polymarket crypto questions whose wording is explicitly directional (`up`, `above`, `higher`, `down`, `below`, etc.).
4. Infer whether YES is bullish or bearish from the market wording.
5. Apply a bounded expected probability shift from crypto momentum.
6. Subtract observed spread as a penalty.
7. Produce a 0–1 research score.
8. Simulate a YES entry only when score >= 0.80, net edge > 0, and paper cash is available.
9. Max simulated stake = $5.
10. Exit when score <= 0.20 or after five minutes.

This heuristic is **not certified** and is expected to change after evidence review.

## Run locally

Requirements: Node 20+

```bash
cd market-edge-lab
npm install
npm start
```

Open:

```text
http://localhost:8787
```

## Evidence

The service writes newline-delimited JSON to:

```text
data/evidence-ledger.jsonl
```

Ledger event types currently include:

- `SYSTEM`
- `MARKET_REFRESH`
- `PAPER_ENTRY`
- `PAPER_EXIT`
- `ERROR`

## Research gates before any consideration of real money

Real-money execution is outside V0. At minimum the evidence should answer:

- How many genuine opportunities were observed?
- How often did the signal win and lose?
- What was simulated P&L after observed spread?
- How sensitive is performance to latency assumptions?
- How much quoted liquidity was actually available?
- Does the apparent edge survive hundreds or thousands of trials?
- Is performance concentrated in one unusual market or repeatable across markets?
- Does the edge remain after more realistic slippage and fee modeling?
- Would a naive BTC momentum baseline perform just as well?

Only after those questions are answered should NFE/HDP/RRS/Arena evaluate whether a stronger experiment is justified.
