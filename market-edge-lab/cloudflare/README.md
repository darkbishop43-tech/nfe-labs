# NFE Market Edge Lab — Free 24/7 Cloud Collector

This is a PAPER-ONLY Cloudflare Worker + Workers KV deployment for the Market Edge Lab.

## Safety boundary
- No wallet connection
- No exchange API key
- No Polymarket signing key
- No live order submission
- $100 simulated starting balance
- $5 maximum simulated stake per entry
- Automatic paper entries/exits only

## What runs in the cloud
Every 5 minutes the Worker:
1. Gets BTC and ETH spot prices from Coinbase.
2. Searches Polymarket BTC/ETH events.
3. Rejects closed, expired, non-orderable, and near-zero/near-one contracts.
4. Computes the research edge score.
5. Opens/closes simulated paper positions when thresholds are met.
6. Saves balance, positions, P/L, opportunities, and the evidence ledger to Workers KV.

The Worker also serves a phone-friendly dashboard at its workers.dev URL.

## Required Cloudflare resources
- 1 Worker named `nfe-market-edge-lab`
- 1 Workers KV namespace
- KV binding name: `MARKET_EDGE_STATE`
- Cron: `*/5 * * * *`

No paid Supabase project is required for this version.
