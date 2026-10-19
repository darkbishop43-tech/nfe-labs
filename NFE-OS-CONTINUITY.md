# NFE-OS — AUTHORITATIVE CONTINUITY & SUCCESSOR GATE
Last updated: 2026-10-19
Owner: Founder
Status: Continuity record; **not** proof of live production state.

## Mandatory first-read protocol
Every successor Main Chat, Builder, Grok, Claude, or other agent **must read this file first**, before planning, coding, giving deployment orders, or diagnosing known blockers. On every handoff, update this file with verified changes and the next single action. A new chat does **not** reset project facts, permissions, or infrastructure. A successor must verify that it can access the file; if it cannot, request its contents rather than pretending to have read it.

Governance: Founder decides; Main Chat reasons/validates; Builder executes; Kalshi audits. One action -> verify -> STOP. Do not infer from tests that production is fixed. Do not ARM/DISARM, modify live KV/ownership, reset coordinator, submit provider orders, or change strategy without the appropriate explicit Founder authorization. AUTO remains offline; PAYNE PAPER unchanged. No new infrastructure or credential values without authorization. Never put secret values in this file.

## Immediate mission — PAYNE DOGE close synchronization
Kalshi-confirmed DOGE YES trade closed, while PAYNE cockpit showed OWNERSHIP OPEN / MANAGEMENT ACTIVE. Contract `KXDOGE15M-26OCT190045-45`; series `02809a98-c978-4ef4-992e-ebb894243a1a`; reported PAYNE entry order `01a15272-8ba8-73c9-911a-f6c15215a46e`. Founder observed 1 YES buy ~90.63c and sell ~98.61c, ~$0.08 net. Provider history closure is Founder-confirmed; live persisted PAYNE ownership, coordinator identity and current exposure are **not yet independently reverified**. Do not manually clear ownership from screenshot alone.

Required permanent behavior: after exact provider closure/exposure and identity verification, PAYNE automatically reconciles ownership/management/cockpit/ledger; retries bookkeeping safely; no duplicate close or exit; UNKNOWN remains UNKNOWN on incomplete evidence.

## Accepted validated source — do not rebuild
Repo: `darkbishop43-tech/nfe-labs`
Branch: `payne-close-sync-retry-isolated-20261019`
Source repair: `d49c8807e672bf212c11187585b7a6c02f79a6dd`
Final validated commit: `a1548d778f863cba0b329bfce74e2371bfa96392`
Source file: `market-edge-lab/real/payne-kalshi-real/src/index.js`
Offline validation run: `39217667749` — 301 PASS, 0 FAIL, 3 TODO. Targeted test: first provider-FLAT close record fails, later reverified FLAT and successful retry leads CLOSED, owned count 0, one close ledger record, no extra provider exit; cross-series ownership protected. Offline validation only.

Founder explicitly authorized **gated production promotion of this exact repair**. Promotion workflow commit: `1579411ce230e840aa1a3f1dda5419d7bce8384d`. Deployment run `39218678494` failed **before deployment** at `Prepare authenticated PAYNE maintenance proof read-only` with `PROTECTED_PROVIDER_EVIDENCE_FAILED` (exit 1). Source/regression, Cloudflare credential and production baseline checks passed. No new Worker version, no production mutations. Authorization does not permit weakening safety gates or changing live ownership.

## Verified deployment deadlock and credential locations
Grok examined failed run and `.github/scripts/payne-maintenance-decision.mjs`: when `openPositions !== 0`, maintenance proof calls `GET /internal/closure-maintenance-evidence`. That route is present in validated assembly `a1548d77...` but absent from then-current deployed production Worker, creating a circular dependency. Existing deployed routes `/internal/series-claims-diagnostic` and `/internal/atomic-claim-diagnostic` provide coordinator diagnostics, **not** Kalshi exposure evidence. Do not conflate coordinator read with provider position/order proof.

Founder visually verified GitHub repository Settings -> Secrets and variables -> Actions -> Repository secrets on Oct 19. Names present:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN`
- `ROBINHOOD_CLOUDFLARE_API_TOKEN`

**Kalshi API key names were not listed as repository-level Actions secrets.** This does **not** mean PAYNE lacks Kalshi credentials: existing production Cloudflare Worker has Kalshi credential pairs reported previously (`KALSHI_EXECUTION_KEY_ID`, `KALSHI_EXECUTION_PRIVATE_KEY`, `KALSHI_KEY_ID`, `KALSHI_PRIVATE_KEY`); their current presence and permissions must be checked through authorized non-disclosing paths. Also distinguish repository, environment and organization Actions secrets. Never print or copy secret values.

Do not assume changing chat or Builder versions changes GitHub/Cloudflare secrets. The issue is **which execution environment can access which secrets/evidence**, and the undeployed endpoint dependency. Do not repeatedly ask Founder to install credentials without first checking existing paths and actual need.

## One bounded next action
Fix the existing deployment evidence deadlock using the **smallest testable safe change**. Verify the actual existing authenticated provider read options, choose a path independent of the new Worker, preserve real provider exposure + coordinator identity checks, and test preflight before calling release deployment-ready. If a new secret, diagnostic-only deployment, safety-gate change, or live state mutation is required, state the exact change and STOP for separate Founder approval. Once genuine evidence passes, promote only the approved repair via existing gates; verify exact Worker version, 100% traffic and live DOGE reconciliation. Do not claim completed until verified.

## Mandatory handoff update template
Before transferring Builder/Main Chat/AI:
- Date and outgoing/incoming versions
- Original mission and current exact symptom
- Accepted evidence with run IDs, branch, commit, file, test results
- Live production status vs offline tests
- Credential **locations and access scope** (names only; no values)
- Founder approvals and forbidden actions
- One exact blocker and smallest next action
- What was changed this session and what was NOT changed
- Whose turn; STOP

Successor first response: confirm this file was actually read, identify the current mission, accepted evidence, and **one** next testable action. No fresh investigation into completed work without new contrary evidence.


## Production recovery deployment — October 19, 2026 (verified)
Source report: Grok deployment; independently verified against GitHub Actions job/logs for run `39228666970`: SUCCESS. All assembly regression, source, Cloudflare credential, maintenance evidence, authenticated zero-attempt proof, predeploy/postdeploy KV, disarmed-state, cockpit-read, and deployment/traffic-verification steps succeeded. Worker version `d3567528-5c09-45ff-aa93-784c2e1d3196` verified at **100%** traffic by workflow Cloudflare API comparison. Deployment remains disarmed by Founder.
Reported fix/source commit `e089ef4ee723dce93ba0cb00bb7ebf3406a2cc25` (this commit specifically changes closure regression tests; inspect earlier source commits for implementation): when exact Kalshi flat closure evidence is established, a coordinator claim-record failure does not keep PAYNE ownership OPEN; manager closes/releases slot, logs claim failure. This changes earlier retry semantics; verify actual live state and any lingering coordinator claim before concluding the system can be rearmed safely.
**DOGE has not been verified closed in live PAYNE after management cycle.** Deployment logs showed stale DOGE `openPositions=1` in pre/post checks. Series `02809a98-c978-4ef4-992e-ebb894243a1a`, ticker `KXDOGE15M-26OCT190045-45`. **Immediate ONE next action:** Founder refresh PAYNE cockpit after a management cycle and provide ownership/management state. If still OPEN, investigate only whether a disarmed management cycle executes and the exact live blocker; no blind claims/KV reset and no ARM without verifying reconciled provider state. All next agents read this continuity before work. AUTO offline; PAYNE paper unchanged.
