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
      message: "Polymarket US account read failed. Sensitive provider error details are suppressed.",
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

async function previewProof(env) {
  const built = await createClient(env);
  if (!built.ok) return { ok: false, state: built.state, submitted: false, liveOrderSubmission: "DISABLED" };

  try {
    const publicClient = new PolymarketUS();
    const now = new Date();
    const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const listed = await publicClient.events.list({
      active: true,
      closed: false,
      ended: false,
      startTimeMin: now.toISOString(),
      startTimeMax: horizon.toISOString(),
      orderBy: ["startTime"],
      orderDirection: "asc",
      limit: 100,
    });
    const crypto = (Array.isArray(listed?.events) ? listed.events : []).filter((event) => {
      const hay = [event?.title,event?.slug,event?.description,event?.series?.title,event?.series?.slug,...(event?.tags||[]).flatMap(t=>[t?.label,t?.slug])].filter(Boolean).join(" ").toLowerCase();
      return /bitcoin|btc|ethereum|eth/.test(hay);
    });
    const candidates = crypto.flatMap((event) =>
      (Array.isArray(event?.markets) ? event.markets : [])
        .filter((market) => market?.active && !market?.closed && market?.slug)
        .map((market) => ({ market, event }))
    );
    if (!candidates.length) return { ok:false,state:"NO_SHORT_HORIZON_BTC_ETH_CANDIDATE",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,discovery:{windowHours:72,eventsScanned:(listed?.events||[]).length,cryptoEvents:crypto.length,sensitiveTextExposed:false} };

    const diagnostics=[];
    for (const { market, event } of candidates.slice(0, 20)) {
      try {
        const bbo = await publicClient.markets.bbo(market.slug);
        const askValue = bbo?.bestAsk?.value ?? bbo?.bestAsk;
        const ask = Number(askValue);
        if (!Number.isFinite(ask) || ask <= 0) { diagnostics.push("NO_VALID_ASK"); continue; }
        const request={marketSlug:market.slug,intent:"ORDER_INTENT_BUY_LONG",type:"ORDER_TYPE_LIMIT",price:String(askValue),quantity:1,tif:"TIME_IN_FORCE_IMMEDIATE_OR_CANCEL",manualOrderIndicator:"MANUAL_ORDER_INDICATOR_AUTOMATIC",synchronousExecution:false};
        const response=await built.client.orders.preview({request});
        const order=response?.order||{};
        return {ok:true,state:"AUTHENTICATED_ORDER_PREVIEW_ACCEPTED",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,preview:{eventTitle:event?.title||null,marketSlug:market.slug,marketTitle:market.title||null,outcome:market.outcome||null,type:order.type||request.type,intent:order.intent||request.intent,tif:order.tif||request.tif,price:order.price??request.price,quantity:order.quantity??request.quantity,state:order.state||null,manualOrderIndicator:request.manualOrderIndicator},discovery:{windowHours:72,cryptoEvents:crypto.length,candidates:candidates.length},note:"Polymarket US authenticated preview accepted. No order was created or submitted."};
      } catch(error) {
        const raw=String(error?.message||"").toLowerCase();
        const status=Number(error?.status||error?.statusCode||error?.response?.status||0)||null;
        let category="UNCLASSIFIED_REJECTION";
        if(raw.includes("balance")||raw.includes("fund"))category="ACCOUNT_FUNDING_OR_BALANCE";
        else if(raw.includes("minimum")||raw.includes("quantity")||raw.includes("size"))category="ORDER_SIZE_OR_MINIMUM";
        else if(raw.includes("price")||raw.includes("tick"))category="PRICE_OR_TICK";
        else if(raw.includes("market")||raw.includes("slug"))category="MARKET_OR_SLUG";
        else if(raw.includes("intent")||raw.includes("side"))category="ORDER_INTENT_OR_SIDE";
        else if(raw.includes("auth")||status===401||status===403)category="AUTHORIZATION";
        diagnostics.push(category+(status?"_HTTP_"+status:""));
      }
    }
    return {ok:false,state:"SHORT_HORIZON_CANDIDATES_NOT_PREVIEWABLE",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,diagnostic:{category:diagnostics[0]||"NO_VALID_BBO",attempted:Math.min(candidates.length,20),sensitiveTextExposed:false},discovery:{windowHours:72,cryptoEvents:crypto.length,candidates:candidates.length}};
  } catch {
    return {ok:false,state:"PREVIEW_PROOF_FAILED",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false};
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
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Market Edge — Baseline Real</title>
<style>
:root{--bg:#050a11;--p:#0d1724;--p2:#111e2d;--line:#243a55;--gold:#d8b15e;--gold2:#f3d58a;--blue:#3479e8;--text:#f5f7fb;--muted:#91a6be;--green:#67e49b;--yellow:#f0c75e;--red:#ff8585;--shadow:0 14px 38px #0007}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#0d2440 0,transparent 35%),var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;min-height:100vh}.w{max-width:1080px;margin:auto;padding:16px 12px 48px}.hero,.card,.opp{background:linear-gradient(180deg,var(--p2),var(--p));border:1px solid var(--line);border-radius:16px}.hero{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:15px}.brand{display:flex;align-items:center;gap:14px}.logo{width:140px;height:78px;object-fit:contain;border-radius:10px}.k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}h1{font-size:28px;margin:3px 0}.sub,.m{font-size:12px;color:var(--muted)}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pill,.btn{border:1px solid #725f34;color:var(--gold2);background:#0b1421;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:800}.pill.real{border-color:#315a8c;color:#a9d0ff}.btn{cursor:pointer}.btn:hover{border-color:var(--gold2);background:#121e2c}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:11px}.card{padding:14px}.label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.val{font-size:24px;font-weight:850;margin-top:5px}.good{color:var(--green)}.warn{color:var(--yellow)}.bad{color:var(--red)}.section{margin-top:11px}.statusline{display:flex;align-items:center;gap:9px;margin-top:8px}.dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px #67e49b18}.dot.warn{background:var(--yellow);box-shadow:0 0 0 5px #f0c75e18}.dot.bad{background:var(--red);box-shadow:none}.wide{display:grid;grid-template-columns:1.25fr .75fr;gap:10px}.rows{display:grid}.row{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-top:1px solid #1b2d42;font-size:12px}.row:first-child{border-top:0}.opps{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:9px}.opp{padding:11px}.oppHead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.q{font-size:13px;font-weight:700;line-height:1.35}.tag{border:1px solid #725f34;background:#0a1421;color:var(--gold2);border-radius:10px;padding:6px 8px;font-size:9px;font-weight:900;white-space:nowrap}.meta{font-size:11px;color:var(--muted);margin-top:7px}.gate{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #1b2d42;font-size:12px}.gate:first-child{border-top:0}.footer{text-align:center;color:#62778e;font-size:10px;margin-top:18px}.notice{border-left:3px solid var(--gold);padding:9px 11px;background:#0a1421;color:var(--muted);font-size:11px;line-height:1.45;margin-top:10px}
@media(max-width:720px){.grid{grid-template-columns:repeat(2,1fr)}.wide{grid-template-columns:1fr}.opps{grid-template-columns:1fr}.logo{width:100px;height:58px}h1{font-size:23px}.hero{align-items:flex-start}}@media(max-width:460px){.grid{grid-template-columns:1fr}.brand{gap:8px}.logo{width:78px;height:48px}.k{font-size:8px}.sub{font-size:10px}.pill,.btn{font-size:9px;padding:6px 8px}.val{font-size:20px}.hero{padding:12px}}
</style>
</head>
<body>
<div class="w">
  <div class="hero">
    <div class="brand">
      <img class="logo" alt="NFE-OS" src="https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/main/market-edge-lab/public/nfe-os-logo-market-edge.webp">
      <div><div class="k">NFE-OS Research Lab · Polymarket US</div><h1>Market Edge — Baseline Real</h1><div class="sub">Real account validation · BTC/ETH only · governed test environment</div></div>
    </div>
    <div class="actions"><button id="refresh" class="btn" type="button">REFRESH PROOF</button><div class="pill real">REAL · READ ONLY</div><div class="pill">FUNDING LOCKED</div></div>
  </div>

  <div class="grid">
    <div class="card"><div class="label">Polymarket Connection</div><div id="conn" class="val">CHECKING…</div><div id="connSub" class="m"></div></div>
    <div class="card"><div class="label">Account State</div><div id="bal" class="val">CHECKING…</div><div id="balSub" class="m"></div></div>
    <div class="card"><div class="label">Funding Authorization</div><div class="val warn">LOCKED</div><div class="m">$0 authorized · first governed test target $5 only after remaining gates pass.</div></div>
    <div class="card"><div class="label">Live Orders</div><div class="val warn">DISABLED</div><div class="m">No live order-submission route is implemented.</div></div>
  </div>

  <div class="card section">
    <b>Real-System Status</b>
    <div class="statusline"><span id="statusDot" class="dot warn"></span><div><div id="statusText"><b>CHECKING AUTHENTICATED READ…</b></div><div class="m">This page can observe and verify. It cannot authorize funding or submit an order.</div></div></div>
  </div>

  <div class="section wide">
    <div>
      <b>BTC / ETH Market Observation</b>
      <div id="markets" class="opps"><div class="m">Loading public Polymarket US markets…</div></div>
    </div>
    <div class="card">
      <b>Governance Status</b>
      <div class="rows" style="margin-top:8px">
        <div class="row"><span>Credentials</span><strong id="creds">CHECKING…</strong></div>
        <div class="row"><span>Secret exposure</span><strong class="good">NONE</strong></div>
        <div class="row"><span>Shadow experiment</span><strong>NOT STARTED</strong></div>
        <div class="row"><span>Market scope</span><strong>BTC / ETH ONLY</strong></div>
        <div class="row"><span>Execution mode</span><strong>LOCKED</strong></div>
      </div>
    </div>
  </div>

  <div class="card section">
    <b>Baseline Real Test Path</b>
    <div style="margin-top:8px">
      <div class="gate"><span>1. Secure API credentials</span><strong class="good">PASS</strong></div>
      <div class="gate"><span>2. Authenticated read-only account connection</span><strong id="gateAccount">CHECKING…</strong></div>
      <div class="gate"><span>3. Actual funded balance record</span><strong id="gateBalance">WAITING</strong></div>
      <div class="gate"><span>4. Shadow ledger + real market observation</span><strong>NOT STARTED</strong></div>
      <div class="gate"><span>5. Authenticated order preview without submission</span><strong id="gatePreview">CHECKING…</strong></div>
      <div class="gate"><span>6. First governed $5 funded test</span><strong>NOT AUTHORIZED</strong></div>
    </div>
    <div class="notice">A displayed unfunded state is not withdrawal proof. Funding remains locked until the remaining execution, rules, settlement, recordkeeping, and cash-out gates are independently verified.</div>
  </div>
  <div class="footer">NFE-OS · MARKET EDGE — BASELINE REAL · GOVERNED VALIDATION · LIVE ORDERS DISABLED</div>
</div>
<script>
const E=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function load(){
  const conn=E('conn'),connSub=E('connSub'),bal=E('bal'),balSub=E('balSub'),creds=E('creds'),gateAccount=E('gateAccount'),gateBalance=E('gateBalance'),gatePreview=E('gatePreview'),markets=E('markets'),statusDot=E('statusDot'),statusText=E('statusText');
  try{
    const [ar,sr,mr,pr]=await Promise.all([fetch('/account',{cache:'no-store'}),fetch('/status',{cache:'no-store'}),fetch('/markets',{cache:'no-store'}),fetch('/preview-proof',{cache:'no-store'})]);
    const account=await ar.json(),status=await sr.json(),market=await mr.json(),preview=await pr.json();
    creds.textContent=status?.credentials?.keyIdInstalled&&status?.credentials?.secretInstalled?'INSTALLED':'MISSING';
    creds.className=creds.textContent==='INSTALLED'?'good':'bad';gatePreview.textContent=preview?.ok&&preview?.submitted===false?'PASS · NO SUBMISSION':((preview?.diagnostic?.category||preview?.state||'NOT PROVEN')+(preview?.diagnostic?.httpStatus?' · HTTP '+preview.diagnostic.httpStatus:''));gatePreview.className=preview?.ok&&preview?.submitted===false?'good':'m';
    if(account.ok&&account.accountConnection==='VERIFIED'){
      conn.textContent='VERIFIED';conn.className='val good';connSub.textContent='Authenticated read-only Polymarket US API connection.';
      gateAccount.textContent='PASS';gateAccount.className='good';statusDot.className='dot';statusText.innerHTML='<b class="good">AUTHENTICATED READ-ONLY · VERIFIED</b>';
      const a=account.account||{};
      if(a.currentBalance!==null&&a.currentBalance!==undefined){
        const n=Number(a.currentBalance);bal.textContent=Number.isFinite(n)?'$'+n.toFixed(2):'BALANCE AVAILABLE';balSub.textContent=(a.currency||'USD')+' · buying power record available';gateBalance.textContent='AVAILABLE';gateBalance.className='good';
      }else if(a.noBalanceRecord){
        bal.textContent='$0.00*';balSub.textContent='No funded balance record returned. *Unfunded display only; not withdrawal proof.';gateBalance.textContent='NO FUNDED RECORD';gateBalance.className='m';
      }else{bal.textContent='NOT AVAILABLE';balSub.textContent='Authenticated, but balance response was not recognized.';}
    }else{
      conn.textContent='NOT VERIFIED';conn.className='val bad';connSub.textContent='Authenticated account proof is unavailable. See /account for safe diagnostic state.';gateAccount.textContent='FAILED';gateAccount.className='bad';bal.textContent='UNAVAILABLE';statusDot.className='dot bad';statusText.innerHTML='<b class="bad">ACCOUNT PROOF NOT VERIFIED</b>';
    }
    const groups=[['BTC',market?.bitcoin||[]],['ETH',market?.ethereum||[]]],parts=[];
    for(const [name,events] of groups){
      if(!events.length){parts.push('<div class="opp"><div class="oppHead"><div class="q">'+name+' market search</div><div class="tag">OBSERVE ONLY</div></div><div class="meta">No active search results returned. This does not prove no '+name+' markets exist.</div></div>');continue;}
      for(const event of events.slice(0,4))parts.push('<div class="opp"><div class="oppHead"><div class="q">'+esc(event.title||event.slug||'Market')+'</div><div class="tag">'+name+' · OBSERVE</div></div><div class="meta">Public Polymarket US market data · no order action</div></div>');
    }
    markets.innerHTML=parts.join('');
  }catch{
    conn.textContent='CHECK FAILED';conn.className='val bad';connSub.textContent='Dashboard proof request failed; no secret details are displayed.';bal.textContent='UNAVAILABLE';statusDot.className='dot bad';statusText.innerHTML='<b class="bad">PROOF REFRESH FAILED</b>';markets.innerHTML='<div class="opp"><div class="meta">Market observation check failed.</div></div>';
  }
}
E('refresh').addEventListener('click',load);load();
</script>
</body></html>`;
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

    if (url.pathname === "/preview-proof") {
      const proof = await previewProof(env);
      return json(proof, proof.ok ? 200 : 422);
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
