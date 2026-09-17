import { PolymarketUS } from "polymarket-us";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: HTML_HEADERS });
}

function normalizeSecretKey(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { ok: false, reason: "EMPTY_SECRET" };
  if (trimmed.includes("-----BEGIN")) return { ok: false, reason: "PEM_FORMAT_NOT_EXPECTED" };

  let value = trimmed;
  let detected = "BASE64_STANDARD";

  if (/^[A-Za-z0-9_-]+={0,2}$/.test(value) && /[-_]/.test(value)) {
    detected = "BASE64URL";
    value = value.replace(/-/g, "+").replace(/_/g, "/");
  } else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return { ok: false, reason: "UNRECOGNIZED_SECRET_ENCODING" };
  }

  while (value.length % 4 !== 0) value += "=";

  try {
    const binary = atob(value);
    const byteLength = binary.length;
    if (byteLength !== 32 && byteLength !== 64) {
      return { ok: false, reason: "UNEXPECTED_ED25519_KEY_LENGTH", detected, byteLength };
    }
    return { ok: true, normalized: value, detected, byteLength };
  } catch {
    return { ok: false, reason: "BASE64_DECODE_FAILED", detected };
  }
}

function statusPayload(env) {
  return {
    ok: true,
    experiment: env.EXPERIMENT_NAME || "MARKET EDGE — BASELINE REAL",
    isolation: "DEDICATED_WORKER",
    marketScope: env.MARKET_SCOPE || "BTC_ETH_ONLY",
    executionMode: env.EXECUTION_MODE || "LOCKED",
    liveOrderSubmission: "DISABLED",
    fundingAuthorized: false,
    expectedFundingUsd: 0,
    shadowExperimentStarted: false,
    credentials: {
      keyIdInstalled: Boolean(env.POLYMARKET_US_KEY_ID),
      secretInstalled: Boolean(env.POLYMARKET_US_SECRET),
      valuesExposed: false,
    },
    accountConnection: "VERIFY_AT_/account",
    accountBalance: "VERIFY_AT_/account",
    evidenceLedger: "NOT_YET_STARTED",
    buildCheckpoint: "2026-09-17T19:50:00-04:00",
  };
}

function safeAccountView(response) {
  const hasArrayEnvelope = Array.isArray(response?.balances);
  const directBalance =
    response && typeof response === "object" && !hasArrayEnvelope &&
    ("currentBalance" in response || "buyingPower" in response)
      ? response
      : null;

  const rows = hasArrayEnvelope ? response.balances : [];
  const usd =
    rows.find((row) => String(row?.currency || "").toUpperCase() === "USD") ||
    rows[0] ||
    directBalance ||
    null;

  const noBalanceRecord = hasArrayEnvelope && rows.length === 0;

  return {
    responseShape: hasArrayEnvelope ? "BALANCES_ARRAY" : directBalance ? "DIRECT_BALANCE_OBJECT" : "UNKNOWN",
    balanceRecordCount: hasArrayEnvelope ? rows.length : directBalance ? 1 : 0,
    noBalanceRecord,
    currentBalance: usd?.currentBalance ?? null,
    currency: usd?.currency ?? null,
    buyingPower: usd?.buyingPower ?? null,
    assetNotional: usd?.assetNotional ?? null,
    assetAvailable: usd?.assetAvailable ?? null,
    openOrders: usd?.openOrders ?? null,
    unsettledFunds: usd?.unsettledFunds ?? null,
    marginRequirement: usd?.marginRequirement ?? null,
    pendingWithdrawals: Array.isArray(usd?.pendingWithdrawals)
      ? usd.pendingWithdrawals.length
      : null,
  };
}

async function createClient(env) {
  const credentialsPresent = Boolean(env.POLYMARKET_US_KEY_ID && env.POLYMARKET_US_SECRET);
  if (!credentialsPresent) return { ok: false, state: "CREDENTIALS_NOT_INSTALLED" };

  const secret = normalizeSecretKey(env.POLYMARKET_US_SECRET);
  if (!secret.ok) return { ok: false, state: "SECRET_FORMAT_INVALID", secret };

  return {
    ok: true,
    secret,
    client: new PolymarketUS({
      keyId: String(env.POLYMARKET_US_KEY_ID).trim(),
      secretKey: secret.normalized,
    }),
  };
}

async function accountProof(env) {
  const built = await createClient(env);

  if (!built.ok) {
    return {
      ok: false,
      state: built.state,
      accountConnection: "NOT_VERIFIED",
      credentialDiagnostics: {
        secretFormatReason: built.secret?.reason ?? null,
        detectedEncoding: built.secret?.detected ?? null,
        decodedByteLength: built.secret?.byteLength ?? null,
        valuesExposed: false,
      },
      fundingAuthorized: false,
      liveOrderSubmission: "DISABLED",
    };
  }

  try {
    const balances = await built.client.account.balances();
    const account = safeAccountView(balances);

    return {
      ok: true,
      state: "AUTHENTICATED_READ_ONLY",
      accountConnection: "VERIFIED",
      account,
      accountState: account.noBalanceRecord
        ? "AUTHENTICATED_NO_BALANCE_RECORDS"
        : account.currentBalance !== null
          ? "BALANCE_AVAILABLE"
          : "AUTHENTICATED_BALANCE_SHAPE_UNKNOWN",
      credentialDiagnostics: {
        detectedEncoding: built.secret.detected,
        decodedByteLength: built.secret.byteLength,
        valuesExposed: false,
      },
      fundingAuthorized: false,
      expectedFundingUsd: 0,
      shadowExperimentStarted: false,
      liveOrderSubmission: "DISABLED",
      note: account.noBalanceRecord
        ? "Authenticated successfully. Polymarket US returned an empty balances array; no funded balance record is present yet."
        : "Authenticated balance read only. No order submission is implemented.",
    };
  } catch (error) {
    return {
      ok: false,
      state: "AUTHENTICATION_OR_ACCOUNT_READ_FAILED",
      accountConnection: "NOT_VERIFIED",
      errorType: error?.name || "Error",
      message: error?.message || "Polymarket US account read failed.",
      credentialDiagnostics: {
        detectedEncoding: built.secret.detected,
        decodedByteLength: built.secret.byteLength,
        valuesExposed: false,
      },
      fundingAuthorized: false,
      liveOrderSubmission: "DISABLED",
    };
  }
}

async function marketSnapshot() {
  const client = new PolymarketUS();

  async function search(query) {
    try {
      const result = await client.search.query({ query, status: "active", limit: 6 });
      const events = Array.isArray(result?.events) ? result.events : [];
      return events.slice(0, 6).map((event) => ({
        id: event.id,
        slug: event.slug,
        title: event.title,
        active: event.active,
        closed: event.closed,
        volume: event.volume ?? null,
        liquidity: event.liquidity ?? null,
        markets: Array.isArray(event.markets)
          ? event.markets.slice(0, 4).map((market) => ({
              id: market.id,
              slug: market.slug,
              title: market.title,
              outcome: market.outcome,
              active: market.active,
              closed: market.closed,
              volume: market.volume ?? null,
              liquidity: market.liquidity ?? null,
            }))
          : [],
      }));
    } catch {
      return [];
    }
  }

  const [bitcoin, ethereum] = await Promise.all([search("bitcoin"), search("ethereum")]);

  return {
    ok: true,
    source: "POLYMARKET_US_PUBLIC_API",
    marketScope: "BTC_ETH_ONLY",
    bitcoin,
    ethereum,
    liveOrderSubmission: "DISABLED",
  };
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Market Edge — Baseline Real</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; background:#07111f; color:#eaf2ff; }
  .wrap { max-width:1180px; margin:0 auto; padding:24px; }
  .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap; }
  h1 { margin:0 0 8px; font-size:clamp(26px,4vw,42px); }
  .sub { color:#94a8c7; }
  .pill { display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border:1px solid #284261; border-radius:999px; background:#0d1b2e; font-size:13px; }
  .dot { width:9px; height:9px; border-radius:50%; background:#6f8097; }
  .good .dot { background:#30d17d; }
  .warn .dot { background:#ffbf47; }
  .lock .dot { background:#62a8ff; }
  .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
  .card { background:#0c192b; border:1px solid #20344f; border-radius:16px; padding:18px; }
  .label { color:#8297b5; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
  .value { font-size:24px; font-weight:750; margin-top:8px; word-break:break-word; }
  .small { color:#9db0ca; font-size:13px; margin-top:8px; line-height:1.45; }
  .section { margin-top:18px; }
  .section h2 { font-size:18px; margin:0 0 12px; }
  .wide { display:grid; grid-template-columns:1.25fr .75fr; gap:14px; }
  .rows { display:grid; gap:9px; }
  .row { display:flex; justify-content:space-between; gap:14px; padding:11px 0; border-bottom:1px solid #1b2d45; }
  .row:last-child { border-bottom:0; }
  .market { padding:12px 0; border-bottom:1px solid #1b2d45; }
  .market:last-child { border-bottom:0; }
  .market-title { font-weight:650; }
  .market-meta { color:#8fa4c0; font-size:12px; margin-top:4px; }
  button { border:1px solid #315a8c; background:#16385f; color:#edf6ff; border-radius:10px; padding:10px 14px; cursor:pointer; font-weight:650; }
  button:hover { background:#1d4777; }
  .danger { color:#ffb9b9; }
  .ok { color:#78e4ad; }
  .muted { color:#8297b5; }
  .footer { margin-top:18px; color:#6f839f; font-size:12px; }
  @media (max-width:850px) { .grid{grid-template-columns:repeat(2,1fr)} .wide{grid-template-columns:1fr} }
  @media (max-width:520px) { .wrap{padding:16px}.grid{grid-template-columns:1fr} }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <div class="label">NFE-OS Research Lab · Polymarket US</div>
      <h1>Market Edge — Baseline Real</h1>
      <div class="sub">Real account connection · BTC/ETH only · governed validation build</div>
    </div>
    <button id="refresh">Refresh Proof</button>
  </div>

  <div class="grid">
    <div class="card"><div class="label">Polymarket Connection</div><div id="conn" class="value">Checking…</div><div id="connSub" class="small"></div></div>
    <div class="card"><div class="label">Account Balance</div><div id="bal" class="value">Checking…</div><div id="balSub" class="small"></div></div>
    <div class="card"><div class="label">Funding</div><div class="value">LOCKED</div><div class="small">$0 authorized. Planned first governed test: $5 only after remaining gates pass.</div></div>
    <div class="card"><div class="label">Live Orders</div><div class="value">DISABLED</div><div class="small">No order-submission route is implemented.</div></div>
  </div>

  <div class="section wide">
    <div class="card">
      <h2>BTC / ETH Market Observation</h2>
      <div id="markets" class="small">Loading public Polymarket US markets…</div>
    </div>
    <div class="card">
      <h2>Governance Status</h2>
      <div class="rows">
        <div class="row"><span>Credentials</span><strong id="creds">Checking…</strong></div>
        <div class="row"><span>Secret exposure</span><strong class="ok">NONE</strong></div>
        <div class="row"><span>Shadow experiment</span><strong>NOT STARTED</strong></div>
        <div class="row"><span>Market scope</span><strong>BTC / ETH ONLY</strong></div>
        <div class="row"><span>Execution mode</span><strong>LOCKED</strong></div>
      </div>
    </div>
  </div>

  <div class="section card">
    <h2>Baseline Real Test Path</h2>
    <div class="rows">
      <div class="row"><span>1. Secure API credentials</span><strong class="ok">PASS</strong></div>
      <div class="row"><span>2. Authenticated read-only account connection</span><strong id="gateAccount">Checking…</strong></div>
      <div class="row"><span>3. Actual funded balance record</span><strong id="gateBalance">WAITING</strong></div>
      <div class="row"><span>4. Shadow ledger + market observation</span><strong>NOT STARTED</strong></div>
      <div class="row"><span>5. Order preview without submission</span><strong>NOT ENABLED</strong></div>
      <div class="row"><span>6. $5 funded test</span><strong>NOT AUTHORIZED</strong></div>
    </div>
  </div>

  <div class="footer">This dashboard is intentionally read-only. It cannot place an order or authorize funding.</div>
</div>

<script>
async function load() {
  const conn = document.getElementById("conn");
  const connSub = document.getElementById("connSub");
  const bal = document.getElementById("bal");
  const balSub = document.getElementById("balSub");
  const creds = document.getElementById("creds");
  const gateAccount = document.getElementById("gateAccount");
  const gateBalance = document.getElementById("gateBalance");
  const markets = document.getElementById("markets");

  try {
    const [accountRes, statusRes, marketRes] = await Promise.all([
      fetch("/account", { cache:"no-store" }),
      fetch("/status", { cache:"no-store" }),
      fetch("/markets", { cache:"no-store" })
    ]);

    const account = await accountRes.json();
    const status = await statusRes.json();
    const market = await marketRes.json();

    creds.textContent = status?.credentials?.keyIdInstalled && status?.credentials?.secretInstalled ? "INSTALLED" : "MISSING";

    if (account.ok && account.accountConnection === "VERIFIED") {
      conn.textContent = "VERIFIED";
      conn.className = "value ok";
      connSub.textContent = "Authenticated read-only API connection.";
      gateAccount.textContent = "PASS";
      gateAccount.className = "ok";

      const a = account.account || {};
      if (a.currentBalance !== null && a.currentBalance !== undefined) {
        const n = Number(a.currentBalance);
        bal.textContent = Number.isFinite(n) ? "$" + n.toFixed(2) : String(a.currentBalance);
        balSub.textContent = (a.currency || "USD") + " · Buying power: " + (a.buyingPower ?? "n/a");
        gateBalance.textContent = "AVAILABLE";
        gateBalance.className = "ok";
      } else if (a.noBalanceRecord) {
        bal.textContent = "$0.00*";
        balSub.textContent = "No funded balance record returned yet. *Displayed as unfunded, not treated as withdrawal proof.";
        gateBalance.textContent = "NO FUNDED RECORD";
        gateBalance.className = "muted";
      } else {
        bal.textContent = "Not available";
        balSub.textContent = "Authenticated, but balance response was not recognized.";
      }
    } else {
      conn.textContent = "NOT VERIFIED";
      conn.className = "value danger";
      connSub.textContent = account.message || account.state || "Account verification failed.";
      gateAccount.textContent = "FAILED";
      gateAccount.className = "danger";
      bal.textContent = "Unavailable";
    }

    const groups = [
      ["Bitcoin", market?.bitcoin || []],
      ["Ethereum", market?.ethereum || []]
    ];
    const parts = [];
    for (const [name, events] of groups) {
      parts.push("<div class='label' style='margin-top:8px'>" + name + "</div>");
      if (!events.length) {
        parts.push("<div class='market'><div class='market-meta'>No active search results returned.</div></div>");
      } else {
        for (const event of events.slice(0,4)) {
          parts.push("<div class='market'><div class='market-title'>" + escapeHtml(event.title || event.slug || "Market") + "</div><div class='market-meta'>Active public market data · observation only</div></div>");
        }
      }
    }
    markets.innerHTML = parts.join("");
  } catch (err) {
    conn.textContent = "CHECK FAILED";
    conn.className = "value danger";
    connSub.textContent = String(err?.message || err);
    bal.textContent = "Unavailable";
    markets.textContent = "Market observation check failed.";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.getElementById("refresh").addEventListener("click", load);
load();
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json({
        ok: false,
        error: "READ_ONLY_BUILD",
        message: "Baseline Real currently exposes GET-only validation routes. Live order submission is not implemented.",
      }, 405);
    }

    if (url.pathname === "/") return html(dashboardHtml());

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "market-edge-baseline-real",
        mode: "READ_ONLY_ACCOUNT_VERIFICATION",
        liveOrderSubmission: "DISABLED",
      });
    }

    if (url.pathname === "/status") return json(statusPayload(env));

    if (url.pathname === "/account") {
      const proof = await accountProof(env);
      const status = proof.ok ? 200 : proof.state === "SECRET_FORMAT_INVALID" ? 422 : 502;
      return json(proof, status);
    }

    if (url.pathname === "/markets") return json(await marketSnapshot());

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
