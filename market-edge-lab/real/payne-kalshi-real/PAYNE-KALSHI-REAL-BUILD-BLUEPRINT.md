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
   - reads the existing Baseline REAL public shadow representation through a Cloudflare Service Binding
   - binding: `BASELINE_REAL_READ`
   - exact downstream path: `GET /shadow-state`
   - no Baseline source, execution, state, credential, or deployment change is required

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

Authoritative feature source:

the existing Baseline REAL `publicShadowView()` representation returned by:

`GET /shadow-state`

PAYNE reaches that route through a Cloudflare Service Binding:

- binding: `BASELINE_REAL_READ`
- target service: `market-edge-baseline-real`
- transport: `SERVICE_BINDING`
- method: `GET`
- path: `/shadow-state`

### Why the former public workers.dev fetch returned 404

PAYNE previously attempted:

`fetch("https://market-edge-baseline-real.darkbishop43.workers.dev/shadow-state")`

from inside another Cloudflare Worker.

Cloudflare Worker-to-Worker routing on the same Cloudflare zone/account path is not equivalent to an ordinary browser request to the public `workers.dev` hostname. The platform-supported Worker-to-Worker mechanism is a Service Binding (or a deliberately enabled strictly-public global fetch mode).

The Baseline repository source already contained `GET /shadow-state`; the defect was the **PAYNE transport path**, not a missing Baseline route and not a Baseline execution defect.

Smallest repair:

- add `[[services]] BASELINE_REAL_READ → market-edge-baseline-real` to PAYNE only
- replace public-hostname global fetch with `env.BASELINE_REAL_READ.fetch()`
- construct one exact `GET /shadow-state` request
- fail closed when the binding is absent or the response is stale/invalid

Baseline was not modified.

### Authoritative field provenance

For an exact `marketTicker + outcomeSide` match:

- **MOVE** — Baseline shadow opportunity `move`
- **FAIR** — Baseline shadow opportunity `fair`
- **EDGE** — Baseline shadow opportunity `edge`
- **SCORE** — Baseline shadow opportunity `score`
- **direction / outcomeSide** — Baseline shadow opportunity
- **underlying price source** — Baseline `priceSources[asset]`
- **feature observation time** — Baseline `lastRunAt`
- **Baseline contract/window timing** — exact shadow opportunity `openTime / closeTime / durationMs / horizon` when exposed
- **PAYNE STATE** — derived locally from the frozen Payne thresholds; it is not supplied by Kalshi

Freshness gate:

120 seconds.

If the binding is missing, the route fails, the Baseline observation is stale, or the exact ticker/side fields are incomplete:

PAYNE fields remain UNKNOWN.

No Kalshi contract price is substituted for Payne score.

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

Current observation cadence:

**every successful scheduled scan** updates `payne-kalshi:current:v1`.

The one-minute observer is not limited by the controlled experiment attempt target.

History cadence:

15 minutes, plus state-transition and zero-money FIRE-plan triggers.

Each persisted observation is bounded in size and includes the per-candidate decision explanation for the currently observed universe.

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
- Cloudflare Service Binding `BASELINE_REAL_READ → market-edge-baseline-real`
- no Baseline KV binding
- no Payne Paper binding

The Service Binding is a PAYNE configuration change only. PAYNE source constrains its use to one exact read path: `GET /shadow-state`.

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

### Repository/source state

The former PAYNE feature-source 404 has a source-level repair:

```text
PAYNE Worker
→ BASELINE_REAL_READ service binding
→ GET /shadow-state
→ Baseline publicShadowView
→ exact ticker + outcomeSide feature match
```

Source-level fixture/harness proof confirms authentic MOVE / FAIR / EDGE / SCORE can populate from that shape.

### Live deployment state

The current repository repair is not equivalent to a live Cloudflare deployment.

Before declaring the former 404 closed live, Founder must deploy:

1. updated PAYNE `worker.js` from repository `src/index.js`
2. unchanged/updated `cockpit-html.js` as applicable
3. configure the PAYNE Worker Service Binding:
   `BASELINE_REAL_READ → market-edge-baseline-real`
4. preserve the existing one-minute cron, KV, and secrets
5. reread public PAYNE cockpit/evidence

Until that occurs, live authenticated feature-read success is **pending deployment validation**, not claimed.

### Remaining platform truth that must stay UNKNOWN

Baseline does not expose an authoritative next-observation timestamp. PAYNE therefore displays:

`nextObservationAt = null`

with reason:

`NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE`

Kalshi next reset is represented truthfully by the current provider contract close time. PAYNE does not invent the next contract open time before the provider exposes it.

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
11. Verify `BASELINE_REAL_READ` is configured on the PAYNE Worker.
12. Verify service-bound `GET /shadow-state` returns HTTP 200 and fresh exact ticker/side features.
13. Verify scheduled evidence shows `source = SCHEDULED_CRON` without manual interaction.
14. Run the full test suite before proposing any provider-write authority.
15. Return evidence to Mission Control before crossing any provider-write boundary.

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


---

# OCTOBER 2, 2026 — AUTONOMOUS ZERO-MONEY OBSERVER ACTIVATION UPDATE

## Feature-source 404 forensic conclusion

Repository comparison proved that the Baseline source already implements:

`GET /shadow-state → publicShadowView(await loadShadowState(env))`

The former PAYNE URL was therefore targeting a real route in source, but it was being invoked through a cross-Worker public `workers.dev` fetch.

The PAYNE-only repair adds:

```toml
[[services]]
binding = "BASELINE_REAL_READ"
service = "market-edge-baseline-real"
```

PAYNE now invokes exactly one downstream route:

`GET /shadow-state`

through that binding.

No Baseline mutation is part of this repair.

## Autonomous decision evidence

Every observed candidate now carries bounded classification evidence:

- `RADAR_REJECT_SCORE_BELOW_0_50`
- `RADAR_PASS`
- `LOCK_REJECT_SCORE_BELOW_0_65`
- `LOCK_REJECT_EDGE_NOT_POSITIVE`
- `LOCK_PASS`
- `PULL_REJECTED_SCORE_BELOW_THRESHOLD`
- `PULL_REJECTED_MOVE_BELOW_0_002`
- `PULL_QUALIFIED`

Selected-candidate final decisions can additionally record:

- `FEATURES_UNAVAILABLE`
- `TIME_GATE_REJECT`
- `FRESH_LOCK_INVALIDATED`
- `PRE_SUBMIT_INVALIDATED`
- `FRESH_LOCK_TICKER_MISMATCH`
- `PULL_QUALIFIED_ZERO_MONEY_FIRE_READY`

These are evidence labels describing the frozen rules; they do not alter thresholds.

## Zero-money FIRE evidence

When authentic data satisfies PULL and all execution-read gates, PAYNE may build and persist the existing hypothetical IOC plan.

The terminal authority remains:

`STEP1_PROVIDER_POST_HARD_DISABLED`

No order function is enabled.

## Continuous observation semantics

The one-minute scheduled observer is architecturally independent from controlled experiment attempt targets.

Each scheduled scan updates:

`payne-kalshi:current:v1`

History remains lower-frequency:

- 15-minute periodic history
- state transitions
- zero-money FIRE-ready plans

The cockpit refreshes itself every 60 seconds; `RUN SAFE SCAN NOW` is diagnostic only.

## Clock provenance

### Kalshi

Source:

current authenticated provider contract.

Displayed:

- open time if provider returns it
- close time
- remaining time
- next reset = current close time
- next contract start = UNKNOWN until provider exposes the next contract

### Baseline

Source:

exact matched Baseline shadow opportunity plus Baseline `lastRunAt`.

Displayed when available:

- Baseline feature observation time
- observation age
- matched opportunity open time
- matched opportunity close time
- remaining time
- next reset = matched opportunity close time

Not fabricated:

- next Baseline observation timestamp

Reason:

`NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE`

## Safety state after this source mission

- providerWrites: 0
- orders: 0
- capitalMovedUsd: $0
- provider POST: HELD / HARD DISABLED
- realExecution: DISABLED
- fundingAuthority: DISABLED
- Second IOC: HOLD / UNCHANGED
- Baseline source changes: 0


---

# OCTOBER 2, 2026 — FOUNDER DATA EXPORT + RUN-MODE ROADMAP UPDATE

## Source reconciliation

Accepted blueprint head before the interrupted Builder:

`4012e601b48168be2f48c74363a596b07da511a3`

Interrupted Builder tip recovered on the authoritative branch:

`5cdd50b84ef295a7610f9adcefa9c513a49da0d0`

Repository comparison proves `5cdd50b...` is six commits ahead of `4012e601...`, zero commits behind, and is therefore a continuation of the accepted branch rather than a detached reconstruction.

Its feature-source repair is source-complete and fixture-tested but still requires live deployment validation.

## Export architecture

Founder export is implemented as a GET-only read path on the isolated PAYNE Worker.

Route:

`GET /export`

Supported query parameters:

- `range=current|daily|weekly|monthly|custom`
- `format=csv|json`
- custom only: `from=<ISO timestamp>`
- custom optional: `to=<ISO timestamp>`

Window semantics:

- current = latest persisted observation only
- daily = current UTC calendar day
- weekly = rolling seven days
- monthly = current UTC calendar month
- custom = Founder-selected ISO range

The cockpit exposes Founder buttons for:

- current CSV / JSON
- daily CSV / JSON
- weekly CSV / JSON
- monthly CSV / JSON
- custom CSV / JSON

The browser export controls call only `GET /export`.

No provider POST, order, cancel, close, funding, or capital path is called by export.

## Export evidence source

Exports are generated only from isolated PAYNE persisted observation keys:

- `payne-kalshi:current:v1`
- `payne-kalshi:scan-history:*`

The export path does not read secret bindings or credential values.

Each export row may include:

- observation timestamp / scan source
- asset
- UP / DOWN
- outcome side
- exact ticker
- contract open / close
- live bid / ask / selected price
- MOVE / FAIR / EDGE / SCORE
- PAYNE state
- RADAR / LOCK / PULL result
- rejection / advancement decision
- initial price
- fresh LOCK price
- pre-submit price
- 6.5-minute time-gate result
- ticker consistency
- side consistency
- zero-money FIRE status
- zero-money hypothetical count
- estimated zero-money debit
- provider GET count
- providerWrites
- orders
- capitalMovedUsd
- Kalshi window timing
- Baseline observation / window timing

Terminal safety values in export remain:

- providerWrites = 0
- orders = 0
- capitalMovedUsd = 0

## Evidence-model extension

The isolated PAYNE observation snapshot now retains candidate-level:

- contract open / close
- live bid / ask / selected price
- MOVE / FAIR / EDGE / SCORE
- PAYNE state
- decision evidence

The selected candidate additionally retains:

- initial price
- fresh LOCK price
- pre-submit price

This extension is PAYNE-only.

No Baseline state or execution model is modified.

## Continuous vs bounded run model

The intended control model remains two distinct run modes:

### BOUNDED

Used for controlled experiments such as:

- 10 observations
- 30 observations
- other explicit Founder-defined targets

A bounded target is an experiment/reporting boundary and must not redefine the observer architecture.

### CONTINUOUS

The one-minute read-only observer continues unattended until Founder pauses/stops it.

Current authorized continuous authority:

`READ-ONLY OBSERVATION ONLY`

Current unauthorized continuous authority:

`REAL EXECUTION`

Do not hardcode a permanent 30-observation ceiling into the final observer architecture.

## Stake-control roadmap

Current source still exposes the historical validated presets:

- $1
- $2
- $5
- $10

This is not the intended final Founder interface.

Future design requirement:

- validated Founder numeric input
- explicit lower/upper validation
- fee-safe sizing reread
- no hidden default escalation
- no provider-write authority merely from editing the value

This roadmap does not authorize larger real-money execution.

Provider POST remains held.

## Deployment / validation state

Source implementation now includes:

- service-bound authoritative Baseline feature read
- autonomous one-minute read-only scan evidence
- cycle clocks
- decision evidence
- CSV / JSON export route
- Founder export controls
- export route tests

Live Cloudflare deployment has not been claimed by this source update.

Before live acceptance:

1. deploy the PAYNE Worker source from the authoritative branch
2. preserve `PAYNE_KALSHI_STATE`
3. preserve the one-minute cron
4. configure/preserve `BASELINE_REAL_READ → market-edge-baseline-real`
5. verify `GET /shadow-state` through the binding
6. verify scheduled evidence source is `SCHEDULED_CRON`
7. verify `/export?range=current&format=json`
8. verify one CSV export
9. verify cockpit export controls
10. verify providerWrites = 0
11. verify orders = 0
12. verify capitalMovedUsd = 0

## Safety state

- provider POST: HELD / HARD DISABLED
- real execution: DISABLED
- funding authority: DISABLED
- Second IOC: HOLD / UNCHANGED
- Baseline execution changes: 0
- Payne Paper changes: 0


---

# NFE-OS UNIVERSAL MARKET CLOCK STANDARD

## Purpose

One authoritative market window must mean the same market window across NFE-OS projects observing the same market domain.

Projects may use different models, scores, strategies, or decision rules.

They must not create independent 15-minute market clocks that drift apart.

Universal temporal order:

```text
PROVIDER TIME
→ AUTHORITATIVE WINDOW
→ BASELINE OBSERVATION TIME
→ PROJECT OBSERVATION TIME
→ DECISION TIME
→ FRESH-LOCK TIME
→ PRE-SUBMIT TIME
→ RECORD
```

## Authoritative Kalshi clock

Source of truth:

- provider contract ticker
- provider contract open timestamp
- provider contract close timestamp
- current observation timestamp

Derived values:

- elapsed time in current provider window
- remaining time
- lifecycle fraction / position in the window
- next reset = current contract close where that close is the authoritative boundary

No project-local 15-minute epoch is permitted to replace these provider timestamps.

## Authoritative Baseline clock

Where exposed by Baseline shadow evidence, retain:

- Baseline observation timestamp
- Baseline observation age
- matched opportunity open timestamp
- matched opportunity close timestamp
- matched opportunity remaining time
- matched-window next reset = matched opportunity close

If Baseline does not expose a future scheduled observation time, represent it exactly as:

`NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE`

Do not infer or synthesize one from PAYNE cron cadence.

## PAYNE observation clock

Each PAYNE observation retains:

- PAYNE observation timestamp
- associated Kalshi ticker
- associated Kalshi window open
- associated Kalshi window close
- elapsed milliseconds within Kalshi window
- remaining milliseconds
- fraction through current Kalshi window
- Fresh LOCK timestamp where performed
- pre-submit timestamp where performed
- Baseline → PAYNE observation timestamp delta where comparable

PAYNE's one-minute cron is an observer cadence only.

It does not define the market window.

## Window consistency evidence

PAYNE compares:

- Kalshi ticker/window identity
- Kalshi provider open/close
- Baseline matched opportunity open/close
- PAYNE associated provider window

Evidence object:

`NFE_OS_UNIVERSAL_MARKET_CLOCK_V1`

Required consistency state:

- `TRUE`
- `FALSE`
- `UNKNOWN`

Diagnostics:

- `WINDOW_CONSISTENT`
- `WINDOW_MISMATCH`
- `WINDOW_CONSISTENCY_UNKNOWN`

If an authoritative Baseline window disagrees with the provider window:

- do not silently normalize it
- preserve the discrepancy
- expose `WINDOW_MISMATCH`
- do not advance the zero-money FIRE preview as though the evidence were temporally aligned

## Cockpit presentation

The cockpit displays three timing groups.

### KALSHI WINDOW

- OPEN
- CLOSE
- REMAINING
- NEXT RESET

### BASELINE WINDOW

- OBSERVED AT
- OBSERVATION AGE
- OPEN
- CLOSE
- REMAINING
- NEXT RESET
- NEXT OBSERVATION, or `NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE`

### PAYNE OBSERVATION

- OBSERVED AT
- AGE
- associated Kalshi ticker
- elapsed time in current provider window
- percentage position in current provider window
- Fresh LOCK timestamp
- pre-submit timestamp
- window consistency diagnostic
- Baseline → PAYNE observation delta

Browser countdowns are PRESENTATION ONLY.

They recompute from the authoritative timestamps.

They are not persisted as a decrementing authoritative counter.

On refresh or reload they reconstruct from provider/Baseline/PAYNE timestamps.

## Research questions enabled by the standard

Persisted clock evidence is intended to support later descriptive research such as:

- whether PAYNE and Baseline saw a signal in the same authoritative window
- which system observed it first
- seconds between Baseline and PAYNE observations
- remaining-time point where RADAR appeared
- remaining-time point where LOCK appeared
- remaining-time point where PULL / zero-money FIRE would occur
- whether a signal disappeared before Fresh LOCK
- whether systems disagreed early and converged later
- whether useful signals cluster early, middle, or late in a 15-minute lifecycle
- whether rejection rates change near expiration

No conclusion is implied by collecting these fields.

## PAYNE implementation status

Implemented in PAYNE-KALSHI REAL source:

- provider-clock association
- Baseline-clock association
- PAYNE observation clock
- lifecycle elapsed/remaining/fraction evidence
- Fresh LOCK timestamp
- pre-submit timestamp
- Baseline → PAYNE observation delta
- TRUE / FALSE / UNKNOWN window consistency
- WINDOW_MISMATCH diagnostic
- zero-money FIRE fail-closed on proven window mismatch
- export fields for timing comparison
- browser presentation countdown reconstructed from timestamps

Live deployment proof remains a separate acceptance requirement.

## Cross-project timer rollout inventory

This mission does NOT mutate the projects below.

Repository evidence identifies the following later rollout candidates.

### 1. Baseline REAL

Evidence:

- `market-edge-lab/real/baseline/src/index.js`
- exposes Kalshi 15-minute opportunity `closeTime`
- exposes `/shadow-state`
- is the authoritative Baseline source consumed by PAYNE

Future adoption target:

- formalize the same universal-clock evidence shape at the source
- preserve provider open/close where available
- keep observation timestamp explicit
- expose window identity consistently to downstream read-only consumers

No Baseline change is authorized by the current PAYNE mission.

### 2. Hold Observer

Evidence:

- `market-edge-lab/real/hold-observer/src/index.js`
- reads `/shadow-state`
- tracks provider close time
- records entry/checkpoint/exit timestamps
- uses a Durable Object timer for observational checkpoints

Future adoption target:

- distinguish hold/checkpoint timer from authoritative market window clock
- associate every checkpoint with the provider/Baseline window identity
- expose window-consistency diagnostics

No Hold Observer mutation is authorized here.

### 3. Founder Read Bridge

Evidence:

- `market-edge-lab/real/founder-read-bridge/src/index.js`
- read-only bridge exposes Baseline `/shadow-state` and related evidence

Future adoption target:

- preserve/pass universal-clock evidence without reinterpretation
- do not create independent timing semantics in the bridge

No bridge mutation is authorized here.

### 4. BTC 15-Minute Robinhood Observer

Evidence:

- `market-edge-lab/real/robinhood-15m/src/index.js`
- explicitly identifies itself as a BTC 15-minute real observer

Future adoption target:

- if comparing its instrument lifecycle against NFE-OS 15-minute research, use its own provider-authoritative contract timestamps
- do not pretend Robinhood and Kalshi windows are identical merely because both are 15-minute instruments
- only mark cross-venue window equivalence when authoritative timestamps support it

No Robinhood mutation is authorized here.

### 5. Legacy Market Edge Cloud Worker / Paper collection surfaces

Evidence:

- `market-edge-lab/cloudflare/worker.js`
- `.github/workflows/market-edge-paper-collector.yml`
- `.github/workflows/market-edge-sibling-paper-cloud.yml`

Future adoption target:

- review any persisted observation or paper-trade timestamps before cross-system research
- align paper observations to provider-defined market windows where applicable

These surfaces require separate reconciliation before any modification.

### 6. Universal Market Observer repository

Repository:

`darkbishop43-tech/market-edge-universal-observer`

Evidence:

- `src/observer/kalshi.js`
- `src/observer/run.js`
- `src/stream/kalshi-stream-do.js`

Future adoption target:

- use provider timestamps as canonical market/window identity
- use the same consistency vocabulary when later correlating Universal Observer evidence with Baseline/PAYNE evidence
- domain-specific observers such as Weather/Economics may use different lifecycle semantics, but must still distinguish authoritative event/market time from scheduler time

No Universal Observer mutation is authorized in this PAYNE mission.

## Cross-project rollout governance

Rollout order is not authorized by this blueprint.

Every project requires a separate Mission Control / Founder-authorized change.

The universal rule is architectural:

`scheduler cadence ≠ market clock`

and:

`presentation countdown ≠ authoritative time state`



## Clock-standard validation workflow

A project-scoped GitHub Actions workflow is present at:

`.github/workflows/payne-kalshi-real-zero-money-tests.yml`

Purpose:

- run the complete PAYNE zero-money Node test suite
- execute only against PAYNE source/tests
- no deployment step
- no provider credentials required by the workflow definition
- no provider POST
- no capital movement

Workflow command:

`npm test`

This workflow exists to turn source assertions into executable validation evidence before live deployment.



---

# OCTOBER 2, 2026 — ZERO-MONEY OBSERVATION / COMPARISON TARGET

## Immediate operating objective

Tonight's operating sequence is:

```text
LIVE OBSERVATION
→ RADAR
→ LOCK
→ WOULD FIRE
→ RECORD
→ COMPARE
```

Trading is not the objective.

PAYNE-KALSHI REAL is intended to remain unattended in:

- LIVE provider data
- LIVE one-minute scanning
- LIVE feature classification
- LIVE evidence collection
- ZERO MONEY

Founder manual `RUN SAFE SCAN NOW` remains diagnostic only.

## Durable decision-event evidence

The observer records bounded decision-transition events as:

`OBSERVATION_DECISION_EVENT`

with event classes:

- `RADAR`
- `LOCK`
- `PULL`
- `WOULD_FIRE`
- `REJECT`

The event includes, where authoritative:

- asset
- exact ticker
- direction
- outcome side
- score
- edge
- move
- rejection / advancement reason
- PAYNE observation timestamp
- provider window close
- time remaining
- Fresh LOCK timestamp
- pre-submit timestamp
- selected-candidate comparison evidence
- providerWrites = 0
- orders = 0
- capitalMovedUsd = 0

Events are written on a decision-signature transition rather than blindly duplicating every unchanged candidate every minute.

This preserves research evidence while avoiding needless KV write amplification.

Existing zero-money FIRE-ready evidence remains separately recordable as:

`ZERO_MONEY_FIRE_PLAN_RECORDED`

## Accumulated descriptive counters

Cumulative counters are carried inside the existing current observation snapshot instead of requiring a second per-minute counter key write.

Counters include:

- observations collected
- contracts examined
- RADAR count
- LOCK count
- PULL count
- WOULD-FIRE count
- REJECT count
- Fresh-LOCK invalidations
- pre-submit invalidations
- window mismatches
- Baseline actual matches
- Baseline actual fills
- Payne Paper matches
- Payne Paper unknown comparisons

These are descriptive research counts.

They are not profitability or strategy-performance claims.

## PAYNE ↔ Baseline actual comparison

Repository evidence proves Baseline exposes the GET-only route:

`GET /execution-test-state`

through the existing Baseline Worker.

PAYNE may access that exact path through the existing:

`BASELINE_REAL_READ`

Service Binding.

Allowed PAYNE service-binding read paths are currently constrained to:

- `GET /shadow-state`
- `GET /execution-test-state`

No POST path is allowed.

The Baseline actual comparison is explicitly labeled:

`EXECUTION_TEST_NOT_PRODUCTION_BASELINE`

This prevents execution-test evidence from being falsely represented as the frozen production Baseline lane.

For an exact ticker + outcome-side match, the comparison may retain:

- matching contract
- attempted
- attempt status
- filled
- filled count
- fill timestamp
- actual entry fill price
- Baseline execution-test score where exposed
- order ID where exposed
- closed status / exit reason where exposed

Important limitation:

the execution-test route does not expose an authoritative provider submission/FIRE timestamp.

Therefore:

`fireTime = null`

with:

`NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE`

Do not substitute fill time for FIRE time.

## PAYNE hypothetical FIRE comparison

When the full zero-money path reaches:

`PULL_QUALIFIED_ZERO_MONEY_FIRE_READY`

PAYNE comparison evidence records:

- wouldFire = true
- wouldFireAt = pre-submit reread timestamp
- hypothetical entry price = pre-submit selected ask
- score
- exact ticker
- asset
- direction
- authoritative Kalshi window
- remaining time

This is hypothetical execution evidence only.

It creates no provider order.

## Payne Paper comparison status

Repository evidence proves a paper executor workflow calls:

`https://market-edge-siblings.darkbishop43.workers.dev/api/run`

and expects an isolated `payne_method` state in its response.

However, the PAYNE-KALSHI REAL repository does NOT currently expose or document a proven read-only Payne Paper historical/event endpoint.

PAYNE-KALSHI REAL MUST NOT call the paper `/api/run` mutation/executor endpoint merely to perform comparison reads.

Therefore the current comparison truth is:

`READ_ONLY_AUTHORITATIVE_EVENT_SOURCE_NOT_EXPOSED_TO_PAYNE_KALSHI_REAL`

and Payne Paper event comparison fields remain UNKNOWN.

This is an active research-source blocker, not permission to fabricate paper events.

A future mission may connect a proven read-only Payne Paper history/state source.

## Cross-system comparison schema

Current schema:

`PAYNE_CROSS_SYSTEM_COMPARISON_V1`

PAYNE side may contain:

- watched contract
- ticker
- asset
- direction
- score
- state
- observation timestamp
- would-fire state
- would-fire timestamp
- hypothetical entry price
- market-window close
- time remaining

Baseline side may contain actual attributable execution-test evidence where present.

Payne Paper side remains UNKNOWN until a read-only authoritative event source is proven.

Unlike metrics are not forced into equivalence.

## Research exports

The Founder CSV / JSON export now includes additional comparison fields:

- baselineActualLane
- baselineActualMatch
- baselineAttempted
- baselineFilled
- baselineFillTime
- baselineEntryPrice
- baselineScore
- paynePaperComparisonStatus

Together with the universal-clock fields, this supports later analysis of:

- same asset
- same contract/window
- same direction
- observation-time differences
- hypothetical PAYNE FIRE time
- Baseline actual fill time
- entry-price differences
- score differences where comparable
- Fresh LOCK effects
- remaining-time differences

Final result comparison remains available only where an authoritative source exposes it.

## Future Founder control architecture — documentation only

Current values are validation defaults / active safety constraints, not permanent architectural ceilings.

Future control model should support:

### STAKE

validated numeric Founder input

### RUN LENGTH

validated bounded numeric Founder input

### RUN MODE

- BOUNDED
- CONTINUOUS

### POSITION CAP

validated Founder-configurable multi-position limit

Current values such as:

- $1 / $2 / $5 / $10
- 10 / 30 attempts
- 3 simultaneous positions

must not silently become permanent design ceilings.

However, this requirement grants ZERO authority to relax any active live execution safety limit.

Tonight:

- do not increase live-money authority
- do not enable unlimited positions
- do not enable continuous real-money execution
- do not remove current safety caps from Baseline or any active execution path

## Future real-money readiness sequence

A later separately-authorized mission may follow:

```text
FUND REQUIRED ACCOUNT / INDEX
→ VALIDATE NUMERIC STAKE INPUT
→ VALIDATE RUN MODE / RUN LENGTH
→ VALIDATE POSITION CAP
→ CONNECT PROVEN CONTROLS TO GOVERNED EXECUTION AUTHORITY
→ PROVE BUTTONS / STATE TRANSITIONS
→ SEPARATELY AUTHORIZED BOUNDED LIVE VALIDATION
```

This mission ends before that boundary.

## Terminal safety

PAYNE-KALSHI REAL remains:

- providerWrites = 0
- orders = 0
- capitalMovedUsd = $0
- provider POST = HELD / HARD DISABLED
- real execution = DISABLED
- funding authority = DISABLED
- Second IOC = HOLD



## Research event ledger access

PAYNE now exposes a GET-only research event ledger:

`GET /evidence/events?limit=<1..1000>`

Response schema:

`PAYNE_RESEARCH_EVENT_LEDGER_V1`

It returns persisted research events such as:

- `OBSERVATION_DECISION_EVENT`
- `ZERO_MONEY_FIRE_PLAN_RECORDED`
- `PAYNE_STATE_TRANSITION`

The cockpit exposes a Founder control:

`RESEARCH EVENT LEDGER → LATEST EVENTS JSON`

The standard JSON `GET /export` response also includes:

- `eventCount`
- `events[]`

for the requested export range.

CSV remains the tabular observation/candidate evidence export.

JSON carries both the observation rows and durable transition/event ledger.

Safety remains:

- providerWrites = 0
- orders = 0
- capitalMovedUsd = 0



---

# OCTOBER 2, 2026 — LIVE ZERO-MONEY OBSERVATORY ACCEPTANCE

## Validated source

Pre-deployment complete suite:

- tests: 59
- pass: 59
- fail: 0
- skipped: 0

## Live deployment

Worker:

`market-edge-payne-kalshi-real`

Live URL:

`https://market-edge-payne-kalshi-real.darkbishop43.workers.dev`

Cloudflare Worker version:

`bd5683fa-8e1d-4044-8ee4-c45c643fcfbc`

Cron:

`* * * * *`

Live bindings reported by Wrangler include:

- `PAYNE_KALSHI_STATE`
- `BASELINE_REAL_READ → market-edge-baseline-real`

## Live zero-money proof

Live acceptance returned:

```text
LIVE_STATUS=GREEN_ZERO_MONEY
FEATURE_HTTP=200
PAYNE_STATE=RADAR
WINDOW_CONSISTENCY=true
BASELINE_ACTUAL_LANE=EXECUTION_TEST_NOT_PRODUCTION_BASELINE
PAYNE_PAPER_STATUS=READ_ONLY_AUTHORITATIVE_EVENT_SOURCE_NOT_EXPOSED_TO_PAYNE_KALSHI_REAL
SCHEDULED_SOURCE=SCHEDULED_CRON
providerWrites=0
orders=0
capitalMovedUsd=0
```

This proves the unattended observer is running from scheduled Cloudflare invocation without Founder scan clicks.

## Live scheduled evidence specimen

A live persisted `SCHEDULED_CRON` observation demonstrated:

- authentic live 15-minute Kalshi contract
- authentic Baseline service-bound PAYNE fields
- RADAR classification
- exact-ticker Fresh LOCK
- pre-submit reread
- universal market-clock association
- `WINDOW_CONSISTENT`
- zero provider writes
- zero orders
- zero capital movement

The observed example was in the provider 09:30 → 09:45 UTC market window and retained both Fresh LOCK and pre-submit timestamps.

The specific market/state is evidence only and is not a trading-performance conclusion.

## Live export / event-ledger proof

Live acceptance successfully validated:

- `GET /export?range=current&format=json`
- `GET /export?range=current&format=csv`
- `GET /evidence/events?limit=200`

JSON export contains observation rows plus durable research events.

Event-ledger schema:

`PAYNE_RESEARCH_EVENT_LEDGER_V1`

## Baseline comparison status

Live read-only Baseline execution-test comparison is active.

Lane is explicitly:

`EXECUTION_TEST_NOT_PRODUCTION_BASELINE`

It is not represented as production Baseline.

## Payne Paper comparison blocker

Payne Paper comparison remains:

`READ_ONLY_AUTHORITATIVE_EVENT_SOURCE_NOT_EXPOSED_TO_PAYNE_KALSHI_REAL`

This is the remaining cross-system research-source gap.

It does NOT block PAYNE from:

- watching
- RADAR
- LOCK
- PULL
- zero-money WOULD-FIRE planning
- rejecting
- recording
- exporting
- comparing with currently exposed Baseline evidence

It DOES block authoritative live PAYNE ↔ Payne Paper event comparison until a separate read-only paper history/state source is proven.

## Authority state after live acceptance

- providerWrites = 0
- orders = 0
- capitalMovedUsd = $0
- provider POST = HELD / HARD DISABLED
- real execution = DISABLED
- funding authority = DISABLED
- Second IOC = HOLD
- Baseline source changes = 0
- Baseline deployments = 0
- Payne Paper changes = 0



---

# OCTOBER 2, 2026 — FINAL COCKPIT PRESENTATION STANDARD

## Scope

This is presentation-only polish.

No observer, strategy, threshold, scheduler, persistence, comparison, Baseline, or execution semantics are changed.

## Above-the-fold master clocks

The cockpit mirrors existing authoritative timing evidence into a compact:

`NFE-OS MASTER CLOCKS`

strip directly below the live-read status.

It contains:

- KALSHI WINDOW
- BASELINE
- PAYNE
- SCAN

### KALSHI

Uses the existing provider-authoritative window close/reset timestamp.

The visible countdown is reconstructed as:

`authoritative close timestamp - browser current time`

It is presentation only and is never persisted as market truth.

### BASELINE

When the authoritative Baseline feature/window evidence is fresh:

- remaining time is displayed
- current observation age is displayed
- authoritative reset/window close is displayed

When Baseline evidence is stale:

- display `STALE`
- display the real observation age
- display the authoritative stale reason
- do not manufacture a window countdown when no matched authoritative window is available

The existing freshness gate remains unchanged.

### PAYNE

Displays:

- PAYNE observation age
- authoritative current-window lifecycle position where exposed

### SCAN

Displays:

- `AUTO SCAN ACTIVE` or paused state
- `60 SEC CADENCE`

No future cron execution timestamp is fabricated.

The presentation explicitly preserves:

`scheduler cadence ≠ market clock`

## Unavailable feature presentation

The numeric cockpit formatter now distinguishes missing values from numeric zero.

Null / undefined / unavailable feature evidence does not render as:

`0.000000`
`0.0000`
`0.00`

When PAYNE feature evidence is unavailable because the authoritative Baseline source is stale/unavailable, the feature panel shows:

`UNAVAILABLE`

while the existing state/reason remains authoritative.

Actual numeric zero remains displayable when the source truly supplies a numeric zero.

No classification or feature-calculation logic is changed.

## Compact token identifiers

The existing 28px circular token treatment is preserved.

Local inline presentation marks are used with no external dependency:

- BTC → `₿`
- ETH → `Ξ`
- SOL → `≋`
- XRP → `✕`
- HYPE → `HY`
- ZEC → `ⓩ`
- DOGE → `Ð`
- BNB → `◈`
- NEAR → `Ⓝ`

These identifiers are presentation only.

Asset mapping and market semantics remain unchanged.

## Stop rule

After this presentation change is live-validated, cockpit presentation work stops.

PAYNE remains unattended so the zero-money research dataset can continue accumulating.



---

# OCTOBER 2, 2026 — PAYNE WOULD-FIRE FORENSIC STANDARD

## Mission boundary

This mission is forensic only.

It does not authorize:

- strategy tuning
- threshold changes
- score-formula changes
- fair/edge changes
- time-gate changes
- Fresh LOCK changes
- pre-submit changes
- stake/run/concurrency changes
- provider POST
- real execution
- Baseline writes or deployments

## Primary forensic source

Authoritative PAYNE WOULD-FIRE rows are reconstructed from persisted PAYNE scan-history snapshots whose:

`zeroMoneyPreview.status === FIRE_READY`

This is stronger than trusting only the cumulative counter because every FIRE-ready scan is already forced into history.

The historical snapshot preserves, where available:

- PAYNE observation time
- exact ticker
- asset / direction / outcome side
- authoritative market open / close
- time remaining
- lifecycle fraction
- MOVE / FAIR / EDGE / SCORE
- initial price
- Fresh LOCK price / timestamp
- pre-submit price / timestamp
- window consistency
- final qualification chain
- zero-money sizing evidence
- per-event Baseline comparison evidence

Stable forensic identity uses the checkpoint row number plus:

`pre-submit timestamp + exact ticker + side`

## Checkpoint rule

The route defaults to:

`checkpoint=59`

It analyzes the first 59 persisted FIRE_READY snapshots chronologically when at least 59 exist.

It also reports the newer authoritative total so the Founder can distinguish:

- the preserved 59-event checkpoint
- any later events accumulated after that checkpoint

No count is hard-coded as the live total.

## Outcome truth

Each analyzed exact ticker is queried read-only from Kalshi.

Directional classification is:

- DIRECTIONALLY_CORRECT
- DIRECTIONALLY_WRONG
- UNRESOLVED

based only on authoritative final market result/settlement evidence where exposed.

Directional correctness is kept separate from financial profitability.

## Frozen PAYNE lifecycle P/L

Frozen lifecycle remains:

- SCORE EXIT at score <= .20
- MAX HOLD at 5 minutes
- same ticker / same outcome side
- reduce-only exit semantics

Hypothetical P/L is reconstructed only when persisted same-ticker/side evidence provides an attributable exit bid:

1. first subsequent SCORE_EXIT observation; otherwise
2. a same-ticker/side observation within 15 seconds of the exact 5-minute deadline.

If that evidence does not exist:

`HYPOTHETICAL_PNL = UNKNOWN`

No settlement payout is substituted for the frozen 5-minute lifecycle.

When an exit price is reconstructable:

`gross / pre-fee P&L = (exit bid - pre-submit entry price) × PAYNE count`

The existing PAYNE fee-safe sizing entry-fee estimate is preserved when present.

Net P/L remains UNKNOWN unless an attributable hypothetical exit fee can be reconstructed.

No exit fee is fabricated.

## Baseline overlap attribution

The primary Baseline overlap source is the exact persisted comparison attached to the same PAYNE snapshot.

This preserves what PAYNE could authoritatively read at the time:

- exact matching contract
- attempted
- attempt status
- filled
- fill time
- actual entry price
- Baseline score
- final state / exit reason where exposed

Classification:

- PAYNE_FIRED_BASELINE_FILLED
- PAYNE_FIRED_BASELINE_NO_FILL
- PAYNE_FIRED_BASELINE_ATTEMPTED_OTHER_STATE
- PAYNE_FIRED_BASELINE_DID_NOT_ATTEMPT
- PAYNE_FIRED_BASELINE_MATCH_UNKNOWN

Baseline FIRE/submission time remains:

`NOT_EXPOSED_BY_AUTHORITATIVE_SOURCE`

Baseline fill time remains separately labeled.

## Current Baseline read-only enrichment

PAYNE may additionally GET through the existing Baseline service binding:

- `/execution-test-state`
- `/execution-test-nofill-forensic`
- `/forensic-provider-history`

These are enrichment only.

Account-wide provider history is never silently treated as proof that a row was a Baseline trade.

Exact persisted per-event attribution remains primary.

## Descriptive buckets

The forensic JSON includes descriptive summaries only:

SCORE:

- .70-.74
- .75-.79
- .80-.84
- .85+

ENTRY PRICE:

- <.50
- .50-.69
- .70-.84
- .85+

TIME REMAINING:

- 6.5-8m
- 8-10m
- 10m+

plus:

- asset
- direction

No bucket result authorizes tuning.

## Read-only routes

JSON:

`GET /forensic/would-fire?checkpoint=59&format=json`

CSV:

`GET /forensic/would-fire?checkpoint=59&format=csv`

Schema:

`PAYNE_WOULD_FIRE_FORENSIC_V1`

No forensic POST route exists.

## Safety

The forensic response reports:

- providerWrites = 0
- orders = 0
- capitalMovedUsd = 0
- provider POST = HELD / HARD DISABLED
- real execution = DISABLED
- funding authority = DISABLED
- Second IOC = HOLD
- Baseline writes = 0
- Baseline deployments = 0



## Baseline fill-price comparison semantics

Kalshi V2 order responses expose one YES-leg price scale.

For Baseline:

- YES long economic entry price = stored YES-leg average fill price
- NO long economic entry price = `1 - stored YES-leg average fill price`

The PAYNE forensic layer therefore preserves both:

- raw Baseline YES-leg fill price
- normalized economic outcome-side entry price

Only the normalized outcome-side price is compared with PAYNE's hypothetical outcome-side entry price.

Example proven live:

- PAYNE NO hypothetical entry = 0.76
- Baseline stored raw YES-leg average fill = 0.24
- normalized Baseline NO economic entry = 0.76
- comparable entry-price delta = 0.00

This normalization is forensic interpretation only.

Baseline source/state is not changed.
