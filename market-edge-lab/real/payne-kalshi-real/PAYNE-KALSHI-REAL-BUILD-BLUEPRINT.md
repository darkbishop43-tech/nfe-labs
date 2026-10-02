# NFE-OS PAYNE-KALSHI REAL — Authoritative Build Blueprint

**Purpose:** Permanent reconstruction, validation, maintenance, and handoff record for the isolated NFE-OS PAYNE-KALSHI REAL Worker.

**Authoritative branch:** `market-edge-payne-kalshi-real-step1`

**Source baseline entering this documentation mission:** `2cf20ab858c7d34413c681e2efe3f12f02199e2b`

**Cockpit-compaction source commit:** `32e94ace2ebe49abe8c87e6e2e5ace29098e1231`

> The branch tip after this document is committed is the authoritative repository HEAD. A document cannot permanently self-record its own final commit SHA without creating another commit; use the branch tip for the exact current HEAD and the two immutable source checkpoints above for reconstruction.

---

## 1. PURPOSE / MISSION

PAYNE-KALSHI REAL is an isolated Kalshi experiment that connects the existing Payne qualification model to the frozen REAL execution lifecycle while preserving a strict authority boundary.

The intended architecture is:

```text
REAL Kalshi market discovery
→ existing live score / edge / move
→ PAYNE RADAR
→ PAYNE LOCK IN
→ PAYNE PULL TRIGGER
→ exact-ticker fresh LOCK
→ same-ticker pre-submit reread
→ fee-safe sizing
→ IOC entry payload construction
→ isolated client-order identity
→ Index-3 funding-gate evaluation
→ PROVIDER POST HARD STOP
```

The current system is **pre-live / zero-money**. It observes, classifies, sizes, rehearses, persists evidence, and renders a Founder cockpit, but it cannot submit a provider order.

---

## 2. SAFETY AND AUTHORITY BOUNDARIES

Current frozen authority:

- Payne default ARM state: **DISARMED**
- authenticated Kalshi authority: **GET ONLY**
- provider writes: **0**
- provider POST: **HELD / HARD DISABLED**
- real execution: **DISABLED**
- funding authority: **DISABLED**
- capital movement: **$0**
- Second IOC: **HOLD / UNCHANGED**
- Baseline REAL: **hands off except read-only reference**
- Payne Paper: **hands off**
- Robinhood Edge: **hands off**

The hard runtime invariant is implemented in `hardStopBeforeProviderPost()`. A fully qualifying candidate still terminates with:

`STEP1_PROVIDER_POST_HARD_DISABLED`

No ARM state, scheduler call, Worker restart, state reload, sufficient balance, or qualifying score may cross that boundary in the current build.

---

## 3. CURRENT ARCHITECTURE

### Runtime

Cloudflare Worker:

`market-edge-payne-kalshi-real`

Public workers.dev hostname:

`market-edge-payne-kalshi-real.darkbishop43.workers.dev`

Main module:

`src/index.js`

Supporting runtime modules:

- `src/kalshi-get-only.js`
- `src/cockpit-html.js`

State:

Cloudflare KV binding `PAYNE_KALSHI_STATE`

Automatic observation:

one-minute Cloudflare scheduled trigger

### Data planes

1. **Kalshi authenticated GET plane**
   - balance
   - series-scoped live market discovery
   - exact ticker reads
   - proof reads

2. **PAYNE feature plane**
   - currently points read-only to Baseline REAL shadow-state
   - currently blocked live by HTTP 404
   - documented as the next technical mission; not repaired here

3. **Isolated evidence plane**
   - PAYNE-only KV keys
   - latest observation
   - history snapshots
   - state transitions
   - zero-money FIRE plans

---

## 4. DIRECTORY / FILE MAP

```text
market-edge-lab/real/payne-kalshi-real/
├── src/
│   ├── index.js
│   ├── kalshi-get-only.js
│   └── cockpit-html.js
├── test/
│   ├── step1.test.mjs
│   ├── get-only-auth.test.mjs
│   ├── step2.test.mjs
│   └── cockpit.test.mjs
├── package.json
├── wrangler.toml
└── PAYNE-KALSHI-REAL-BUILD-BLUEPRINT.md
```

Responsibilities:

- **index.js** — isolation, controls, market discovery, Payne classification, zero-money FIRE path, management fixtures, cockpit data API, scheduled read-only scan.
- **kalshi-get-only.js** — Kalshi RSA authentication/signing and GET-only transport.
- **cockpit-html.js** — Founder-facing cockpit HTML/CSS/JS only.
- **wrangler.toml** — Worker identity, vars, KV binding, cron.
- **tests** — zero-money, GET-only, lifecycle, isolation, cockpit semantics.

---

## 5. CLOUDFLARE WORKER CONFIGURATION

Worker name:

`market-edge-payne-kalshi-real`

Main source in repository:

`src/index.js`

Dashboard manual deployment entry module:

`worker.js`

The dashboard Worker must also contain the separate imported modules:

- `kalshi-get-only.js`
- `cockpit-html.js`

Current configuration values in `wrangler.toml`:

- `EXECUTION_MODE = "PRELIVE_REAL_COCKPIT_ZERO_MONEY"`
- `LIVE_ORDER_SUBMISSION = "DISABLED"`
- `FUNDING_AUTHORITY = "DISABLED"`
- `PAYNE_THRESHOLD = "0.70"`
- market scope covers BTC / ETH / SOL / XRP / HYPE / ZEC / DOGE / BNB / NEAR.

---

## 6. KV BINDINGS

Binding name:

`PAYNE_KALSHI_STATE`

Namespace ID:

`03352b0ccb034f1bb8206f663a04b125`

Cross-system state is forbidden. The Worker explicitly rejects known Baseline and Payne Paper key families.

Important isolated key families include:

- `payne-kalshi:control:v1`
- `payne-kalshi:current:v1`
- `payne-kalshi:event:*`
- `payne-kalshi:run:*`
- `payne-kalshi:attempt:*`
- `payne-kalshi:position:*`
- `payne-kalshi:scan-history:*`

---

## 7. SECRET NAMES — NAMES ONLY

Runtime authentication consumes:

- `KALSHI_EXECUTION_KEY_ID`
- `KALSHI_EXECUTION_PRIVATE_KEY`

Historical compatibility aliases were also present during authentication forensics:

- `KALSHI_KEY_ID`
- `KALSHI_PRIVATE_KEY`

The PAYNE GET path consumes the **EXECUTION** pair.

Never store, print, log, commit, screenshot, or copy secret values or private-key material into repository files.

---

## 8. CRON / SCHEDULE CONFIGURATION

`wrangler.toml`:

```toml
[triggers]
crons = ["* * * * *"]
```

Meaning:

- one scheduled invocation per minute
- authority is observation only
- scheduled handler initializes/loads isolated control state
- if `scanEnabled` is true, it runs `runReadOnlyScan(..., "SCHEDULED_CRON")`
- no provider POST is reachable

---

## 9. ROUTES / ENDPOINTS

### GET

- `/` — Founder cockpit
- `/cockpit` — Founder cockpit
- `/status` — frozen safety/status contract
- `/control` — read isolated Founder control state
- `/cockpit-data` — live cockpit evidence
- `/evidence/latest` — latest persisted observation
- `/proof` — safe authenticated Kalshi GET proof

### Local-control POST routes

- `POST /control`
- `POST /scan-now`

These POSTs are **local Worker control/evidence operations**, not Kalshi provider writes. They do not confer provider-write authority.

All other non-GET request methods are rejected.

---

## 10. KALSHI AUTHENTICATION / SIGNING FLOW

Implemented in `src/kalshi-get-only.js`.

Flow:

1. require method GET
2. require `KALSHI_EXECUTION_KEY_ID`
3. require `KALSHI_EXECUTION_PRIVATE_KEY`
4. detect PEM envelope
5. decode PEM base64
6. convert PKCS1 to PKCS8 when necessary
7. import private key with WebCrypto:
   - RSA-PSS
   - SHA-256
   - non-extractable
   - sign usage
8. timestamp is `String(Date.now())`
9. signed path strips query string
10. signed payload:
    `timestamp + "GET" + signPath`
11. RSA-PSS signature uses `saltLength: 32`
12. signature encoded base64
13. request headers:
    - `KALSHI-ACCESS-KEY`
    - `KALSHI-ACCESS-TIMESTAMP`
    - `KALSHI-ACCESS-SIGNATURE`
14. API origin:
    `https://external-api.kalshi.com`

Transport rejects paths not beginning with `/trade-api/`.

---

## 11. LIVE CONTRACT DISCOVERY

Original failed approach:

- broad `status=open` market catalogue scan
- bounded paging
- infer crypto 15-minute contracts afterward

That search dimension did not reliably surface the desired current crypto 15-minute contracts.

Current repaired approach:

exact known 15-minute series → current open markets per series.

Series map:

- BTC → `KXBTC15M`
- ETH → `KXETH15M`
- SOL → `KXSOL15M`
- XRP → `KXXRP15M`
- HYPE → `KXHYPE15M`
- ZEC → `KXZEC15M`
- DOGE → `KXDOGE15M`
- BNB → `KXBNB15M`
- NEAR → `KXNEAR15M`

Request form:

`/trade-api/v2/markets?series_ticker=<SERIES>&status=open&limit=20`

Each series is queried independently.

---

## 12. ASSET UNIVERSE + UP/DOWN REPRESENTATION

Executable discovery universe:

BTC / ETH / SOL / XRP / HYPE / ZEC / DOGE / BNB / NEAR

Founder-facing semantics:

- provider YES side → **UP**
- provider NO side → **DOWN**

Provider YES/NO remains visible as lower-level diagnostic evidence.

No missing asset is fabricated. If a current open contract is not returned by the provider series query, it remains absent.

---

## 13. PROVIDER PRICE READS

Provider market snapshots normalize Kalshi bid/ask data into decimal probabilities.

Visible evidence includes:

- YES bid / ask
- NO bid / ask
- selected side bid / ask
- live price
- ticker
- open time
- close time
- time remaining
- provider read timestamp

The current cockpit uses provider truth; it does not substitute fixture prices in live operation.

---

## 14. PAYNE FEATURE-DATA SOURCE

Current source constant:

`BASELINE_SHADOW_STATE_URL`

Current configured endpoint:

`https://market-edge-baseline-real.darkbishop43.workers.dev/shadow-state`

Intended authority:

read-only Baseline REAL shadow evidence for exact ticker + exact side.

Expected fields:

- move
- fair
- edge
- score
- direction
- outcomeSide
- lastRunAt
- priceSources

Freshness gate:

120 seconds.

**Current live blocker:** the configured endpoint returns HTTP 404.

Current cockpit consequence:

- Source: `BASELINE_REAL_SHADOW_READ_ONLY`
- Source HTTP: `404`
- Reason: `BASELINE_SHADOW_READ_FAILED_404`
- MOVE unavailable
- FAIR unavailable
- EDGE unavailable
- SCORE unavailable / rendered as zero-like placeholder in the current UI
- PAYNE state UNKNOWN
- RADAR UNKNOWN
- LOCK IN UNKNOWN
- PULL TRIGGER UNKNOWN
- zero-money FIRE NOT_REACHED

Do not infer that Kalshi contract price is Payne score.

---

## 15. RADAR → LOCK → PULL CLASSIFICATION

Frozen logic:

### RADAR

`score >= 0.50`

### LOCK IN

RADAR true
AND `score >= 0.65`
AND `edge > 0`

### PULL TRIGGER

LOCK IN true
AND `score >= activeThreshold`
AND `abs(move) >= 0.002`

Default active threshold:

`.70`

Founder-selectable thresholds:

`.70, .75, .80, .85`

No option below .70 is permitted in the current cockpit.

---

## 16. EXACT-TICKER FRESH LOCK

After PULL qualification, the zero-money execution path rereads the exact ticker.

Live endpoint form:

`/trade-api/v2/markets/<EXACT_TICKER>`

Fresh LOCK must match the candidate ticker.

A ticker mismatch fails closed.

---

## 17. PRE-SUBMIT REREAD

A second exact-ticker GET is performed immediately after fresh LOCK.

Purpose:

- prove same ticker at execution boundary
- obtain the latest side price
- prevent stale candidate data from carrying through to hypothetical FIRE

This remains a GET-only read.

---

## 18. TIME GATE

Entry-time safety:

contract must have **more than 6.5 minutes remaining**.

Function:

`kalshiCandidateTimeSafe()`

A candidate that does not satisfy this gate cannot progress to FIRE preview.

---

## 19. FEE-SAFE SIZING

Function:

`estimateKalshiFeeSafeSize(price, maxStakeUsd)`

Current formula record:

`ceil_to_cent(1 * 0.07 * C * P * (1-P))`

Sizing decrements count until:

premium + estimated fee <= configured max entry debit.

Current Founder stake options:

- $1
- $2
- $5
- $10

Sizing does not confer execution authority.

---

## 20. IOC PAYLOAD PREVIEW

Entry payload builder:

`kalshiV2EntryPayload()`

Current semantics:

- exact ticker
- isolated client order ID
- bid/ask side derived from outcome side
- count
- price
- `time_in_force: immediate_or_cancel`
- `self_trade_prevention_type: taker_at_cross`
- `post_only: false`
- `cancel_order_on_pause: true`
- `reduce_only: false`

This payload is constructed for zero-money evidence only.

---

## 21. ZERO-MONEY FIRE BOUNDARY

When all qualification and read gates pass:

`zeroMoneyPreviewFor()` returns:

`status: FIRE_READY`

Authority remains:

`PROVIDER_POST_HELD`

The next function reached is the hard stop:

`hardStopBeforeProviderPost()`

Expected terminal reason:

`STEP1_PROVIDER_POST_HARD_DISABLED`

No order submission function is called.

---

## 22. MANAGEMENT / POSITION LANE

Frozen management rules represented in code/cockpit:

- score exit: `.20`
- max hold: `5 minutes`
- max positions: `3`
- exits are reduce-only

The cockpit exposes:

- active positions
- ownership state
- `position_fp`
- entry time
- hold timer
- current score
- current market price
- exit reason
- reconciliation state

No real position is acquired in the current authority state.

---

## 23. RECONCILIATION MODEL

Required classifications:

- OPEN
- FLAT
- UNKNOWN

Important rule:

incomplete, malformed, ambiguous, failed, or insufficient provider evidence must classify UNKNOWN rather than silently FLAT.

Position parsing supports provider quantity fields including:

- `position_fp`
- `position`
- `quantity`

Settlement fallback is used only when the prerequisites for an authoritative fallback are satisfied.

---

## 24. COCKPIT CONTROLS AND EXACT SEMANTICS

### ARM

Sets isolated Payne `armed=true`.

It does **not** enable:

- provider writes
- provider POST
- real execution
- funding authority

### DISARM

Sets `armed=false` for new-entry intent.

### PAYNE THRESHOLD

Allowed:

`.70 / .75 / .80 / .85`

Changes the actual zero-money PULL threshold.

RADAR .50 and LOCK .65 remain frozen.

### MAX ENTRY DEBIT / STAKE

Allowed:

`$1 / $2 / $5 / $10`

Feeds fee-safe sizing only.

### ATTEMPT TARGET

Allowed:

`1 / 5 / 10 / 30`

Configuration only; does not place an order.

### AUTOMATIC SCAN START / PAUSE

Controls `scanEnabled`.

Affects read-only scheduled observation only.

### RUN SAFE SCAN NOW

Performs one immediate read-only observation/evidence cycle.

---

## 25. AUTOMATIC READ-ONLY SCANNING

Function:

`runReadOnlyScan()`

Path:

control state
→ authenticated balance read
→ series-scoped market discovery
→ PAYNE feature-source read
→ candidate views
→ fresh LOCK / pre-submit if selected
→ zero-money FIRE preview
→ isolated persistence

Provider writes remain zero.

---

## 26. PERSISTENCE / EVIDENCE MODEL

Latest observation key:

`payne-kalshi:current:v1`

Latest snapshot cadence:

5 minutes maximum interval, or immediately on significant transition/FIRE plan.

History cadence:

15 minutes, plus transition/FIRE-plan triggers.

Evidence includes:

- timestamp
- source
- authentication
- selected asset/ticker/direction/side
- selected bid/ask
- close time
- Payne evidence
- pipeline state
- zero-money preview
- discovered assets
- provider GET count
- providerWrites 0
- orders 0
- capitalMovedUsd 0
- Founder control state
- safety state

---

## 27. TEST SUITES / EXPECTED PROOFS

Package command:

`node --test test/*.test.mjs`

Suites:

### step1.test.mjs

Expected proof:

- isolation
- default DISARMED state
- threshold behavior
- time gate
- hard provider POST stop
- durable state/event primitives

### get-only-auth.test.mjs

Expected proof:

- credential presence handling
- PKCS1/PKCS8 import path
- GET-only enforcement
- secret suppression
- authenticated proof diagnostics
- provider GET accounting

### step2.test.mjs

Expected proof:

- full zero-money lifecycle integration
- fee-safe sizing
- IOC payload
- NO_FILL/FILLED fixtures
- ownership
- position_fp
- OPEN/FLAT/UNKNOWN
- settlement fallback
- score/max-hold exit
- reduce-only exit
- hard stop

### cockpit.test.mjs

Expected proof:

- live-series discovery representation
- Founder control semantics
- scan persistence
- management display
- zero-money FIRE state
- no order-submit controls

Before any provider-write authority change, the full suite must be green.

---

## 28. DEPLOYMENT PROCEDURE

Current Worker is **not Git-connected**.

Manual Cloudflare Dashboard deployment has therefore been used.

Required runtime files:

1. repository `src/index.js` → Cloudflare `worker.js`
2. repository `src/kalshi-get-only.js` → Cloudflare `kalshi-get-only.js`
3. repository `src/cockpit-html.js` → Cloudflare `cockpit-html.js`

Configuration must preserve:

- existing Worker identity
- existing `PAYNE_KALSHI_STATE` binding
- installed secret names
- one-minute cron
- no Baseline KV binding
- no Payne Paper binding

Do not create another Worker or namespace during normal deployment.

---

## 29. CURRENT AUTHORITATIVE BRANCH / HEAD

Authoritative branch:

`market-edge-payne-kalshi-real-step1`

Source baseline before cockpit compaction:

`2cf20ab858c7d34413c681e2efe3f12f02199e2b`

Cockpit-compaction code commit:

`32e94ace2ebe49abe8c87e6e2e5ace29098e1231`

The exact current repository HEAD is the branch tip containing this blueprint.

---

## 30. KNOWN CLOUDFLARE DASHBOARD BEHAVIOR / QUIRKS

Observed during this project:

1. Dashboard Edit Code can represent multiple modules.
2. The entry module may appear as `worker.js` even though repository source is `src/index.js`.
3. Imported support modules must exist separately under the exact import names.
4. Saving/editing source is not equivalent to activating that version.
5. The dashboard can show a saved/latest version while a different version remains active/deployed.
6. Promotion/activation must be explicitly completed in Cloudflare after source is present.
7. Founder validation must check the public Worker URL after promotion rather than assuming the editor buffer is live.
8. The current Worker is not Git-connected; repository commits do not automatically deploy.
9. Cloudflare Problems-panel JavaScript diagnostics can include editor/type-inference warnings that are not necessarily Worker runtime defects. Runtime evidence is authoritative.
10. Do not overwrite or recreate secrets during routine source promotion.

---

## 31. FAILURE / REPAIR HISTORY

### A. Initial authenticated GET failure

Initial `/proof`:

- authentication NOT_PROVEN
- authenticatedGet NOT_PROVEN
- providerGets originally appeared 0
- secrets suppressed

A safe diagnostic patch was added rather than exposing secret material.

### B. KEY_IMPORT diagnostics

Safe fields added:

- credentialsPresent
- privateKeyEnvelope
- failureStage
- providerGets
- errorClass

Live evidence reached:

- credentialsPresent true
- privateKeyEnvelope PKCS8
- failureStage KEY_IMPORT
- errorClass DataError

This established that the failure occurred before a usable HTTP response.

### C. PKCS1 / PKCS8 handling

The authentication helper supports:

- PKCS8 `BEGIN PRIVATE KEY`
- PKCS1 `BEGIN RSA PRIVATE KEY`

PKCS1 is wrapped into PKCS8 DER in memory before WebCrypto import.

No private-key material is returned.

### D. RESPONSE-stage 401

After private-key import was cleared, live evidence advanced to:

- privateKeyEnvelope PKCS1
- signing completed
- provider fetch completed
- HTTP 401
- providerResponseCategory AUTHENTICATION
- safe provider message: authentication failed

This proved RSA import/sign/fetch were no longer the active blocker.

### E. Credential-pair mismatch root cause

Source comparison showed PAYNE and the known working Baseline signing implementation materially matched.

The remaining runtime uncertainty was the encrypted credential identity pair.

After the matching execution key ID and private key were reconciled together, the unchanged GET-only path returned HTTP 200.

Supported root cause of the 401:

**execution credential pair mismatch**

### F. Successful authenticated GET proof

Fresh live proof subsequently established:

- authentication PROVEN
- authenticatedGet PROVEN
- providerGets 4
- accountBalanceGet PROVEN
- liveMarketGet PROVEN
- freshLockGet PROVEN
- preSubmitGet PROVEN
- HTTP 200
- providerWrites 0
- secretsExposed false

### G. Index 3 read-only proof

The successful balance proof returned a `balance_breakdown` containing exchange index 3.

Classification:

`READ-PROVEN AVAILABLE`

This is read evidence only. Funding authority remains disabled.

### H. Original 15-minute discovery failure

The initial broad open-market catalogue scan did not reliably discover the intended crypto 15-minute universe.

Root problem:

bounded global catalogue scan before domain narrowing.

### I. Repaired live 15-minute discovery

Repaired by querying each known 15-minute series directly.

This produced the live cockpit universe and provider prices without adding write authority.

### J. Cockpit creation

Founder cockpit added:

- safety state
- controls
- current 15-minute universe
- UP/DOWN candidate cards
- selected contract
- Payne feature evidence
- pre-fire pipeline
- fresh LOCK / pre-submit evidence
- zero-money FIRE
- management lane
- automatic scan / persistence evidence

### K. Cloudflare multi-file deployment

The accepted module architecture requires:

- worker.js
- kalshi-get-only.js
- cockpit-html.js

The dashboard can support these separate modules. Do not flatten them unless a future compatibility defect is proven.

### L. Saved/latest versus active/deployed version

Cloudflare editor state and active production version can differ.

Required operating rule:

after editing, verify source completeness, then promote/deploy, then validate the public Worker URL.

### M. Version promotion procedure used

Manual process used during project:

1. open isolated Worker Edit Code
2. update exact authoritative runtime modules
3. verify module names/imports
4. save/create version as required by dashboard
5. explicitly activate/deploy that version
6. reread public endpoints
7. treat public endpoint evidence as deployment truth

### N. Worker not Git-connected

Repository HEAD and Cloudflare production are separate states.

A Git commit does not imply deployment.

### O. Current Payne feature source 404

The cockpit currently points to:

`https://market-edge-baseline-real.darkbishop43.workers.dev/shadow-state`

Live result:

HTTP 404.

This blocks authentic Payne MOVE/FAIR/EDGE/SCORE despite live Kalshi market data being healthy.

This is intentionally **not repaired in this blueprint/compaction mission**.

---

## 32. CURRENT KNOWN BLOCKERS

### Active blocker

**Authoritative Payne feature source HTTP 404**

Current impact:

- market discovery works
- live prices work
- exact ticker reads work
- fresh LOCK works
- pre-submit works
- automatic GET-only scan works
- Payne feature values do not populate authoritatively
- RADAR / LOCK / PULL remain UNKNOWN
- zero-money FIRE cannot naturally reach qualification

### Next technical mission

```text
AUTHORITATIVE PAYNE FEATURE SOURCE
→ TRACE 404
→ COMPARE AGAINST PROVEN SOURCE
→ SMALLEST READ-ONLY REPAIR
→ ZERO-MONEY VALIDATION
```

Do not cross into provider-write authority while repairing this blocker.

---

## 33. FRESH-BUILDER STARTUP CHECKLIST

A fresh Builder/Main Chat should do the following in order:

1. Read this blueprint fully.
2. Confirm repository:
   `darkbishop43-tech/nfe-labs`
3. Confirm branch:
   `market-edge-payne-kalshi-real-step1`
4. Read branch tip and compare against the immutable checkpoints in Section 29.
5. Read:
   - `src/index.js`
   - `src/kalshi-get-only.js`
   - `src/cockpit-html.js`
   - `wrangler.toml`
   - all tests
6. Verify no Baseline/Payne Paper files are in the proposed diff.
7. Verify:
   - providerWritesEnabled false
   - realExecutionEnabled false
   - fundingAuthorityEnabled false
   - hard-stop reason still present
8. Verify Worker/KV names before any manual Cloudflare action.
9. Never request secret values.
10. Verify public `/proof` and `/cockpit-data` after deployment changes.
11. Treat current Payne feature-source HTTP 404 as the next blocker.
12. Repair only the feature-source read path in that mission.
13. Run the full test suite before proposing a new deployment.
14. Return evidence to Mission Control before crossing any provider-write boundary.

---

## 34. ABSOLUTE DO-NOT-CHANGE INVARIANTS

Unless a future Mission Control order explicitly changes a boundary:

- do not modify Baseline REAL execution
- do not modify Payne Paper
- do not modify Robinhood Edge
- do not expose secret values
- do not create/revoke/replace API keys casually
- do not change default Payne threshold below .70
- do not change RADAR .50
- do not change LOCK .65
- do not change minimum absolute move .002
- do not change .20 score exit
- do not change 5-minute max hold
- do not change max positions 3
- do not add market orders
- do not add price chasing
- do not add retry loops
- do not add resting-order strategy
- do not add Second IOC
- do not enable funding authority
- do not move capital
- do not allow provider POST
- do not arm as a substitute for real-execution authorization
- do not infer a missing provider truth
- do not classify incomplete reconciliation evidence as FLAT
- do not change strategy merely to force activity
- do not merge PAYNE state with Baseline or Payne Paper state
- do not treat GitHub source as deployed truth until the public Worker validates it

---

## CURRENT ACCEPTED SAFETY CHECKPOINT

```text
PAYNE-KALSHI REAL:
LIVE COCKPIT

KALSHI MARKET DISCOVERY:
WORKING

LIVE PROVIDER PRICES:
WORKING

AUTHENTICATED GET:
PROVEN

EXACT-TICKER FRESH LOCK:
PROVEN

PRE-SUBMIT READ:
PROVEN

AUTOMATIC GET-ONLY SCAN:
ACTIVE

PAYNE FEATURE SOURCE:
HTTP 404 — NEXT MISSION

PROVIDER WRITES:
0

ORDERS:
0

CAPITAL MOVED:
$0

REAL EXECUTION:
DISABLED

FUNDING AUTHORITY:
DISABLED

PROVIDER POST:
HELD / HARD DISABLED

SECOND IOC:
HOLD / UNCHANGED
```
