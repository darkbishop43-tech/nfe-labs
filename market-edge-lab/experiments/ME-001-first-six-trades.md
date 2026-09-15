# ME-001 — First Six Paper Trades

Status: PRESERVED BASELINE EVIDENCE
Mode: PAPER ONLY
Strategy changes: NONE

## Purpose

Preserve the first real Market Edge Lab paper-trading cohort before any strategy tuning.

## Observed cohort

- Starting paper balance: $100.00
- Ending paper balance: $94.30902595993723
- Realized P/L: -$5.690974040062773
- Closed trades: 6
- Open positions after cohort: 0

## Trade results

| Market | Entry YES | Exit YES | Stake | P/L | Recorded exit reason |
| --- | ---: | ---: | ---: | ---: | --- |
| ETH above $2,700 on Sep 15 | 3.85¢ | 3.55¢ | $5 | -$0.3896103896 | max_hold |
| ETH above $2,600 on Sep 15 | 18.50¢ | 16.50¢ | $5 | -$0.5405405405 | max_hold |
| ETH above $2,500 on Sep 15 | 78.50¢ | 75.50¢ | $5 | -$0.1910828025 | max_hold |
| BTC above $82,000 on Sep 15 | 5.05¢ | 3.15¢ | $5 | -$1.8811881188 | max_hold |
| BTC above $80,000 on Sep 15 | 24.75¢ | 14.65¢ | $5 | -$2.0404040404 | score_exit |
| BTC above $78,000 on Sep 15 | 81.00¢ | 70.50¢ | $5 | -$0.6481481481 | score_exit |

## Critical timing finding

All six positions were entered at 2026-09-14T19:52:03.027Z and exited at 2026-09-14T22:46:53.552Z.

Recorded hold time: 10,491,130 ms = about 174 minutes 51 seconds.

The research strategy intended a five-minute maximum hold. Therefore this cohort was held about 35 times longer than intended.

### Classification

ME-001 is valid execution evidence but not a clean test of the intended five-minute strategy.

The paper loss is real for what the system actually did. It must not be erased or rewritten. But it cannot by itself answer whether the intended five-minute strategy would have been profitable.

## Additional findings

1. **Scheduler contamination** — collector cadence did not preserve the intended holding period.
2. **Signal saturation** — all six entries recorded an entry score of 1.000 during the same collector run.
3. **Correlated exposure** — the six positions were three ETH threshold markets and three BTC threshold markets driven by two underlying asset moves, not six independent economic bets.
4. **Loss concentration** — BTC $82k and BTC $80k accounted for about $3.92 of the $5.69 total loss.

## Rules going forward

- Do not modify the original ME-001 evidence.
- Do not call the underlying strategy profitable or failed from this cohort alone.
- Repair cadence before interpreting the next cohort.
- Make one controlled strategy change at a time only after a clean baseline exists.
- Continue paper-only operation. No wallet, signing, exchange key, or live order submission.
