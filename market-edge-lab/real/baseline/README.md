# Market Edge — Baseline Real

Status: KALSHI BASELINE REAL

## Isolation boundary

This application is the governed real-money Baseline. It remains isolated from the paper Baseline, Payne, Adaptive Market Lab, and UMEO state.

## Provider authority

Kalshi is the sole active real-market provider for Baseline Real.

Active Baseline functionality uses Kalshi-native contract discovery, tickers, quotes, authenticated account reads, execution, positions, balances, and bounded historical evidence reads.

If Kalshi data is unavailable, Baseline must report an unavailable/updating/hold state. It must not fall back to a retired provider.

## Protected production behavior

- Production entry score: >= .80
- Governed exit score: <= .20
- Maximum hold: 5 minutes
- Maximum real entry debit: $1
- Maximum simultaneous filled positions: 3
- Venue: Kalshi
- Funding shard: Index 2
- Supported assets: BTC, ETH, SOL, XRP, HYPE
- Entry execution: bounded IOC
- Strategy score and Kalshi market price are separate quantities

## Evidence rule

Runtime/provider evidence outranks source intention. Historical experiments remain frozen and must not be rewritten or mixed across threshold series.

## Security

Kalshi credentials are server-side Cloudflare secrets only. Never commit API keys, private keys, signatures, or other authentication material to GitHub or expose them client-side.

## Forensic route

The temporary bounded route `/forensic-historical-orders` is GET-only and may read only Kalshi historical orders with whitelisted query parameters. It has no authority to submit, cancel, authorize, or mutate trades.
