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
    liveOrderSubmission: env.LIVE_ORDER_SUBMISSION || "DISABLED",
    fundingAuthorized: true,
    expectedFundingUsd: 10,
    fundingScope: "DEPOSIT_PROOF_ONLY",
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
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

  return {
    responseShape: hasArrayEnvelope ? "BALANCES_ARRAY" : directBalance ? "DIRECT_BALANCE_OBJECT" : "UNKNOWN",
    balanceRecordCount: hasArrayEnvelope ? rows.length : directBalance ? 1 : 0,
    noBalanceRecord,
    fundedRecordPresent: usd?.currentBalance !== null && usd?.currentBalance !== undefined,
    buyingPowerAvailable: positive(usd?.buyingPower),
    unsettledFundsPresent: positive(usd?.unsettledFunds),
    pendingWithdrawalPresent: Array.isArray(usd?.pendingWithdrawals)
      ? usd.pendingWithdrawals.length > 0
      : false,
    sensitiveAmountsExposed: false,
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
        : account.fundedRecordPresent
          ? "FUNDED_RECORD_PRESENT"
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

async function moneyPathProof(env) {
  const built = await createClient(env);
  if (!built.ok) return {ok:false,state:built.state,depositActivity:"NOT_PROVEN",withdrawalActivity:"NOT_PROVEN",cashOutLoop:"NOT_PROVEN",fundingAuthorized:false};
  try {
    const [balances, deposits, withdrawals] = await Promise.all([
      built.client.account.balances(),
      built.client.portfolio.activities({types:["ACTIVITY_TYPE_ACCOUNT_DEPOSIT"],limit:20,sortOrder:"SORT_ORDER_DESCENDING"}),
      built.client.portfolio.activities({types:["ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL"],limit:20,sortOrder:"SORT_ORDER_DESCENDING"})
    ]);
    const account=safeAccountView(balances);
    const ds=Array.isArray(deposits?.activities)?deposits.activities:[];
    const ws=Array.isArray(withdrawals?.activities)?withdrawals.activities:[];
    const hasBuyingPower = account.buyingPowerAvailable;
    const hasUnsettled = account.unsettledFundsPresent;
    const hasPendingWithdrawal = account.pendingWithdrawalPresent;
    const hasBalanceRecord = account.fundedRecordPresent;
    return {
      ok:true,state:"AUTHENTICATED_MONEY_PATH_READ_ONLY",
      depositActivity:ds.length?"OBSERVED":"NOT_YET_PROVEN",
      buyingPower:hasBuyingPower?"AVAILABLE":"NOT_YET_PROVEN",
      fundsClearing:hasUnsettled?"UNSETTLED_FUNDS_PRESENT":(hasBalanceRecord?"NO_UNSETTLED_FUNDS_REPORTED":"NOT_YET_PROVEN"),
      fundedBalance:hasBalanceRecord?"OBSERVED":"NOT_YET_PROVEN",
      withdrawalEligibility:(hasBalanceRecord&&!hasUnsettled)?"BALANCE_PRESENT_NO_UNSETTLED_FUNDS_REPORTED":"NOT_YET_PROVEN",
      withdrawalActivity:ws.length?"OBSERVED":"NOT_YET_PROVEN",
      pendingWithdrawal:hasPendingWithdrawal?"OBSERVED":"NONE_REPORTED",
      cashOutLoop:(ds.length&&ws.length)?"ACTIVITY_OBSERVED_NOT_FULL_LOOP_CERTIFIED":"NOT_YET_PROVEN",
      depositCount:ds.length,withdrawalCount:ws.length,fundingAuthorized:false,liveOrderSubmission:"DISABLED",sensitiveTextExposed:false
    };
  } catch {
    return {ok:false,state:"MONEY_PATH_READ_FAILED",depositActivity:"NOT_PROVEN",withdrawalActivity:"NOT_PROVEN",cashOutLoop:"NOT_PROVEN",fundingAuthorized:false,sensitiveTextExposed:false};
  }
}

async function previewProof(env) {
  const built = await createClient(env);
  if (!built.ok) return { ok: false, state: built.state, submitted: false, liveOrderSubmission: "DISABLED" };

  try {
    const publicClient = new PolymarketUS();
    const [btcSearch, ethSearch] = await Promise.all([
      publicClient.search.query({ query: "bitcoin", status: "active", limit: 50 }),
      publicClient.search.query({ query: "ethereum", status: "active", limit: 50 }),
    ]);
    const eventMap = new Map();
    for (const event of [...(btcSearch?.events||[]), ...(ethSearch?.events||[])]) {
      const key = String(event?.id ?? event?.slug ?? "");
      if (key) eventMap.set(key, event);
    }
    const crypto = [...eventMap.values()].filter((event) => {
      const hay = [event?.title,event?.slug,event?.description,event?.series?.title,event?.series?.slug,...(event?.tags||[]).flatMap(t=>[t?.label,t?.slug])].filter(Boolean).join(" ").toLowerCase();
      return /bitcoin|\bbtc\b|ethereum|\beth\b/.test(hay);
    });
    const searchedMarkets = crypto.flatMap((event) =>
      (Array.isArray(event?.markets) ? event.markets : [])
        .filter((market) => market?.active && !market?.closed && market?.slug)
        .map((market) => ({ market, event }))
    );
    const eventSlugs = [...new Set(crypto.map((event)=>event?.slug).filter(Boolean))];
    const listed = eventSlugs.length ? await publicClient.markets.list({ eventSlug:eventSlugs, active:true, closed:false, orderBy:["volume"], orderDirection:"desc", limit:100 }) : {markets:[]};
    const detailMap = new Map((listed?.markets||[]).filter((market)=>market?.slug).map((market)=>[market.slug,market]));
    const candidates = searchedMarkets.map(({market,event})=>({market:detailMap.get(market.slug)||market,event}));
    if (!candidates.length) return { ok:false,state:"NO_ACTIVE_US_BTC_ETH_CANDIDATE",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,discovery:{searchEvents:eventMap.size,cryptoEvents:crypto.length,candidates:0,sensitiveTextExposed:false} };

    const hydratedCandidates=[];
    for (const item of candidates.slice(0,20)) {
      try {
        const detail=await publicClient.markets.retrieveBySlug(item.market.slug);
        hydratedCandidates.push({market:detail?.market||item.market,event:item.event});
      } catch {
        hydratedCandidates.push(item);
      }
    }

    const diagnostics=[];
    const marketEvidence=[];
    for (const { market, event } of hydratedCandidates) {
      try {
        const bboRaw = await publicClient.markets.bbo(market.slug);
        const bbo = bboRaw?.marketData || bboRaw;
        let askValue = bbo?.bestAsk?.value ?? bbo?.bestAsk;
        let ask = Number(askValue);
        if (!Number.isFinite(ask) || ask <= 0) {
          const bookRaw = await publicClient.markets.book(market.slug);
          const book = bookRaw?.marketData || bookRaw;
          const offers = Array.isArray(book?.offers) ? book.offers : [];
          askValue = offers[0]?.px?.value ?? offers[0]?.px;
          ask = Number(askValue);
        }
        if (!Number.isFinite(ask) || ask <= 0) {
          const probeBook = await publicClient.markets.book(market.slug).catch(()=>null);
          marketEvidence.push({slug:market.slug,id:market.id??null,title:market.title||null,outcome:market.outcome||null,active:market.active??null,closed:market.closed??null,state:probeBook?.state||null,bids:Array.isArray(probeBook?.bids)?probeBook.bids.length:0,offers:Array.isArray(probeBook?.offers)?probeBook.offers.length:0});
          diagnostics.push("NO_VALID_ASK_OR_BOOK_OFFER");
          continue;
        }
        const request={marketSlug:market.slug,intent:"ORDER_INTENT_BUY_LONG",type:"ORDER_TYPE_LIMIT",price:{value:String(askValue),currency:"USD"},quantity:1,tif:"TIME_IN_FORCE_IMMEDIATE_OR_CANCEL",manualOrderIndicator:"MANUAL_ORDER_INDICATOR_AUTOMATIC",synchronousExecution:false};
        const response=await built.client.orders.preview({request});
        const order=response?.order||{};
        return {ok:true,state:"AUTHENTICATED_ORDER_PREVIEW_ACCEPTED",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,preview:{eventTitle:event?.title||null,marketSlug:market.slug,marketTitle:market.title||null,outcome:market.outcome||null,type:order.type||request.type,intent:order.intent||request.intent,tif:order.tif||request.tif,price:order.price??request.price,quantity:order.quantity??request.quantity,state:order.state||null,manualOrderIndicator:request.manualOrderIndicator},discovery:{searchEvents:eventMap.size,cryptoEvents:crypto.length,candidates:candidates.length},note:"Polymarket US authenticated preview accepted. No order was created or submitted."};
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
    return {ok:false,state:"SHORT_HORIZON_CANDIDATES_NOT_PREVIEWABLE",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,diagnostic:{category:diagnostics[0]||"NO_VALID_BBO",attempted:Math.min(candidates.length,20),allCandidateDiagnostics:[...new Set(diagnostics)].slice(0,8)},marketEvidence:marketEvidence.slice(0,5)};
  } catch {
    return {ok:false,state:"PREVIEW_PROOF_FAILED",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false};
  }
}

async function marketSnapshot() {
  const client = new PolymarketUS();
  const [bitcoin, ethereum] = await Promise.all([
    client.search.query({ query: "bitcoin", status: "active", limit: 50 }).catch(()=>({events:[]})),
    client.search.query({ query: "ethereum", status: "active", limit: 50 }).catch(()=>({events:[]})),
  ]);
  return {
    ok: true,
    source: "POLYMARKET_US",
    marketScope: "BTC_ETH_ONLY",
    bitcoin,
    ethereum,
    liveOrderSubmission: "DISABLED",
  };
}

const ROBINHOOD_BTC_15M_URL = "https://robinhood.com/us/en/prediction-markets/crypto/";

function cleanPublicHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function robinhoodBtc15mLinks(html) {
  const links = [];
  const hrefToken = '/prediction-markets/crypto/events/';
  const hrefRe = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const raw = match[1];
    if (!raw.includes(hrefToken)) continue;
    const href = raw.startsWith("http") ? raw : "https://robinhood.com" + raw;
    const hay = href.toLowerCase();
    if (!/(btc|bitcoin)/.test(hay) || !/15[ -]?min/.test(hay)) continue;
    links.push({ href, text: href });
  }
  return [...new Map(links.map((row) => [row.href, row])).values()];
}

async function robinhoodBtc15mProof() {
  const base = {
    ok: false,
    mode: "OBSERVE_ONLY",
    targetInstrument: "BTC_15_MINUTE_EVENT_CONTRACTS",
    signalStrategyChanged: false,
    crossVenueExecution: "BLOCKED",
    orderSubmission: "DISABLED_FOR_ROBINHOOD_SIGNALS",
    moneyMovement: "DISABLED_FOR_ROBINHOOD_SIGNALS",
    source: "ROBINHOOD_PUBLIC_WEB",
    observedAt: new Date().toISOString(),
  };
  try {
    const index = await fetch(ROBINHOOD_BTC_15M_URL, {
      headers: { accept: "text/html", "user-agent": "NFE-Market-Edge-Baseline-Real/0.4" },
      cf: { cacheTtl: 0 },
    });
    if (!index.ok) return { ...base, state: "PUBLIC_INDEX_UNAVAILABLE", httpStatus: index.status };
    const links = robinhoodBtc15mLinks(await index.text());
    const events = [];
    for (const link of links.slice(0, 12)) {
      try {
        const response = await fetch(link.href, {
          headers: { accept: "text/html", "user-agent": "NFE-Market-Edge-Baseline-Real/0.4" },
          cf: { cacheTtl: 0 },
        });
        if (!response.ok) continue;
        const text = cleanPublicHtml(await response.text());
        const targetRaw = text.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)\s+or above/i)?.[1] || null;
        const bidRaw = text.match(/Bid\s+([0-9]+(?:\.[0-9]+)?)¢/i)?.[1] || null;
        const askRaw = text.match(/Ask\s+([0-9]+(?:\.[0-9]+)?)¢/i)?.[1] || null;
        const title = text.match(/BTC 15 min\\s*·\\s*[^$<]{1,60}/i)?.[0]?.replace(/Prediction Market.*$/i, "Prediction Market").trim() || "BTC 15 min";
        const live = /\bLIVE\b/i.test(text) && !/closed and no longer tradable/i.test(text);
        events.push({
          asset: "BTC",
          instrumentWindow: "15_MINUTES",
          title,
          target: targetRaw ? Number(targetRaw.replace(/,/g, "")) : null,
          bidCents: bidRaw ? Number(bidRaw) : null,
          askCents: askRaw ? Number(askRaw) : null,
          live,
          url: link.href,
          execution: "OBSERVE_ONLY",
        });
      } catch {}
    }
    const liveEvents = events.filter((row) => row.live);
    return {
      ...base,
      ok: true,
      state: liveEvents.length ? "LIVE_BTC_15M_OBSERVED" : "NO_LIVE_BTC_15M_OBSERVED",
      discoveredLinks: links.length,
      liveCoverage: { BTC: liveEvents.length },
      events: liveEvents,
    };
  } catch {
    return { ...base, state: "PUBLIC_OBSERVATION_FAILED" };
  }
}


async function robinhoodBtc15mSignal(env) {
  const [proof, state, btc] = await Promise.all([
    robinhoodBtc15mProof(),
    loadShadowState(env),
    coinbaseSpot("BTC-USD"),
  ]);
  const event = Array.isArray(proof?.events) ? proof.events[0] : null;
  const previous = Number(state?.prices?.BTC);
  const ask = Number(event?.askCents) / 100;
  if (!proof?.ok || !event || !Number.isFinite(ask) || ask <= 0 || ask >= 1) {
    return {
      ok: false,
      state: "NO_SCOREABLE_BTC_15M_EVENT",
      observation: proof,
      execution: "OBSERVE_ONLY",
      crossVenueExecution: "BLOCKED",
      orderSubmission: "DISABLED_FOR_ROBINHOOD_SIGNALS",
    };
  }
  const move = Number.isFinite(previous) && previous > 0 ? (btc - previous) / previous : 0;
  const fair = clamp(ask + move * 18, 0.02, 0.98);
  const edge = fair - ask;
  const score = clamp(0.5 + edge * 4, 0, 1);
  const action = score >= SHADOW_CONFIG.entryScore && edge > 0 ? "ENTRY_SIGNAL" : "WAIT";
  return {
    ok: true,
    state: "BTC_15M_SIGNAL_READY",
    contract: {
      title: event.title,
      target: event.target,
      bidCents: event.bidCents,
      askCents: event.askCents,
      live: event.live,
      url: event.url,
      window: event.instrumentWindow,
    },
    market: {
      coinbaseBtcUsd: btc,
      previousBaselineBtcUsd: Number.isFinite(previous) ? previous : null,
      btcMovePct: move * 100,
      settlementBenchmarkNote: "Robinhood resolves against CF Benchmarks BRTI; Coinbase is the unchanged Baseline movement input adaptation.",
    },
    signal: {
      askProbability: ask,
      fair,
      edge,
      score,
      entryThreshold: SHADOW_CONFIG.entryScore,
      exitThreshold: SHADOW_CONFIG.exitScore,
      maxHoldMinutes: SHADOW_CONFIG.maxHoldMs / 60000,
      maxStakeUsd: SHADOW_CONFIG.maxStakeUsd,
      action,
      strategyChanged: false,
    },
    execution: "OBSERVE_ONLY",
    crossVenueExecution: "BLOCKED",
    orderSubmission: "DISABLED_FOR_ROBINHOOD_SIGNALS",
    moneyMovement: "DISABLED_FOR_ROBINHOOD_SIGNALS",
    observedAt: new Date().toISOString(),
  };
}

const SHADOW_CONFIG = {
  entryScore: 0.80,
  exitScore: 0.20,
  maxStakeUsd: 5,
  maxHoldMs: 5 * 60 * 1000,
  maxLedger: 250,
};

const SHADOW_CACHE_URL = "https://market-edge-baseline-real.internal/shadow-state-v1";
const shadowCacheRequest = () => new Request(SHADOW_CACHE_URL, { method: "GET" });

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeProbability(value) {
  const n = Number(value?.value ?? value);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) return n / 100;
  if (n >= 0 && n <= 1) return n;
  return null;
}

async function coinbaseSpot(product) {
  const r = await fetch("https://api.exchange.coinbase.com/products/" + product + "/ticker", {
    headers: { "User-Agent": "NFE-Market-Edge-Baseline-Real/0.3" },
  });
  if (!r.ok) throw new Error("COINBASE_READ_FAILED_" + r.status);
  const data = await r.json();
  const price = Number(data?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("COINBASE_PRICE_INVALID");
  return price;
}

async function loadShadowState(env) {
  if (env?.BASELINE_REAL_SHADOW_STATE?.get) {
    try {
      const raw = await env.BASELINE_REAL_SHADOW_STATE.get("baseline-real-shadow-v1", "json");
      if (raw) return { ...raw, persistence: "ISOLATED_KV" };
    } catch {}
  }
  try {
    const cache = caches.default;
    const hit = await cache.match(shadowCacheRequest());
    if (hit) return { ...(await hit.json()), persistence: "BEST_EFFORT_EDGE_CACHE" };
  } catch {}
  return {
    startedAt: null,lastRunAt:null,runs:0,status:"NOT_STARTED",prices:{},opportunities:[],positions:[],ledger:[],eligibleCount:0,seen:0,rejected:0,
    assetCoverage:{BTC:{eligible:0,up:0,down:0},ETH:{eligible:0,up:0,down:0}},
    strategy: SHADOW_CONFIG,persistence:"BEST_EFFORT_EDGE_CACHE"
  };
}

async function saveShadowState(env,state) {
  state.persistence = "BEST_EFFORT_EDGE_CACHE";
  if (env?.BASELINE_REAL_SHADOW_STATE?.put) {
    await env.BASELINE_REAL_SHADOW_STATE.put("baseline-real-shadow-v1", JSON.stringify(state));
    state.persistence = "ISOLATED_KV";
    return;
  }
  try {
    await caches.default.put(shadowCacheRequest(), new Response(JSON.stringify(state), {headers:{"content-type":"application/json","cache-control":"max-age=31536000"}}));
  } catch {}
}

function shadowLedger(state,type,payload={}) {
  state.ledger.unshift({at:new Date().toISOString(),type,...payload});
  if(state.ledger.length>SHADOW_CONFIG.maxLedger)state.ledger.length=SHADOW_CONFIG.maxLedger;
}

async function discoverUsShadowMarkets() {
  const client = new PolymarketUS();
  const queries=["bitcoin","BTC","ethereum","ETH","ether"];
  const eventMap=new Map();
  for(const q of queries){
    try{
      const result=await client.search.query({query:q,status:"active",limit:100});
      for(const event of result?.events||[]){
        const key=String(event?.id??event?.slug??"");
        if(key)eventMap.set(key,event);
      }
    }catch{}
  }
  const candidates=[]; let seen=0,rejected=0;
  for(const event of eventMap.values()){
    const eventHay=[event?.title,event?.slug,event?.description,event?.series?.title,event?.series?.slug,...(event?.tags||[]).flatMap(t=>[t?.label,t?.slug])].filter(Boolean).join(" ").toLowerCase();
    const eventAsset=/bitcoin|\bbtc\b/.test(eventHay)?"BTC":(/ethereum|\beth\b|\bether\b/.test(eventHay)?"ETH":null);
    for(const market of event?.markets||[]){
      seen++;
      const hay=[event?.title,event?.slug,market?.title,market?.slug,market?.question,market?.description,market?.outcome].filter(Boolean).join(" ").toLowerCase();
      const asset=/bitcoin|\bbtc\b/.test(hay)?"BTC":(/ethereum|\beth\b|\bether\b/.test(hay)?"ETH":eventAsset);
      const directional=/(above|over|higher|greater|below|under|lower|less)/.test(hay);
      if(!asset||!directional||!market?.active||market?.closed||!market?.slug){rejected++;continue;}
      try{
        const [detailRaw,bboRaw]=await Promise.all([
          client.markets.retrieveBySlug(market.slug).catch(()=>null),
          client.markets.bbo(market.slug).catch(()=>null),
        ]);
        const detail=detailRaw?.market||market;
        const bbo=bboRaw?.marketData||bboRaw||{};
        let ask=normalizeProbability(bbo?.bestAsk);
        let bid=normalizeProbability(bbo?.bestBid);
        if(ask===null||bid===null){
          const bookRaw=await client.markets.book(market.slug).catch(()=>null);
          const book=bookRaw?.marketData||bookRaw||{};
          if(ask===null)ask=normalizeProbability(book?.offers?.[0]?.px);
          if(bid===null)bid=normalizeProbability(book?.bids?.[0]?.px);
        }
        if(ask===null||ask<=0||ask>=1){rejected++;continue;}
        if(bid===null)bid=ask;
        candidates.push({
          id:String(detail?.id??market?.id??market.slug),slug:market.slug,question:detail?.title||market?.title||event?.title||market.slug,
          asset,bear:/(below|under|lower|less)/.test(hay),yes:ask,bid,ask,eventTitle:event?.title||null,source:"POLYMARKET_US"
        });
      }catch{rejected++;}
    }
  }
  return {
    markets:candidates,seen,rejected,
    coverage:{
      BTC:{eligible:candidates.filter(m=>m.asset==="BTC").length,up:candidates.filter(m=>m.asset==="BTC"&&!m.bear).length,down:candidates.filter(m=>m.asset==="BTC"&&m.bear).length},
      ETH:{eligible:candidates.filter(m=>m.asset==="ETH").length,up:candidates.filter(m=>m.asset==="ETH"&&!m.bear).length,down:candidates.filter(m=>m.asset==="ETH"&&m.bear).length},
    }
  };
}

function scoreShadowMarket(m,moves){
  const move=moves[m.asset]||0;
  const directionalMove=m.bear?-move:move;
  const fair=clamp(m.yes+directionalMove*18,0.02,0.98);
  const edge=fair-m.yes;
  const score=clamp(0.5+edge*4,0,1);
  return {...m,move,fair,edge,score};
}

async function runShadow(env){
  const state=await loadShadowState(env); const now=Date.now();
  try{
    const [btc,eth,discovery]=await Promise.all([coinbaseSpot("BTC-USD"),coinbaseSpot("ETH-USD"),discoverUsShadowMarkets()]);
    const prev=state.prices||{};
    const moves={BTC:prev.BTC?(btc-prev.BTC)/prev.BTC:0,ETH:prev.ETH?(eth-prev.ETH)/prev.ETH:0};
    const opportunities=discovery.markets.map(m=>scoreShadowMarket(m,moves)).sort((a,b)=>b.score-a.score);
    state.prices={BTC:btc,ETH:eth}; state.opportunities=opportunities.slice(0,50); state.eligibleCount=opportunities.length; state.seen=discovery.seen; state.rejected=discovery.rejected; state.assetCoverage=discovery.coverage;
    state.runs=(state.runs||0)+1; state.startedAt=state.startedAt||new Date().toISOString(); state.lastRunAt=new Date().toISOString(); state.status="RUNNING";
    shadowLedger(state,"SHADOW_REFRESH",{btc,eth,eligibleCount:opportunities.length,seen:discovery.seen,rejected:discovery.rejected,assetCoverage:discovery.coverage,realMoneyMoved:false});
    await saveShadowState(env,state); return state;
  }catch(error){
    state.status="ERROR"; state.lastRunAt=new Date().toISOString(); state.runs=(state.runs||0)+1;
    shadowLedger(state,"SHADOW_ERROR",{errorType:error?.name||"Error",realMoneyMoved:false});
    try{await saveShadowState(env,state);}catch{}
    return state;
  }
}

function publicShadowView(state){
  return {ok:state?.status!=="ERROR",mode:"REAL_US_SHADOW",status:state?.status||"UNKNOWN",startedAt:state?.startedAt||null,lastRunAt:state?.lastRunAt||null,runs:state?.runs||0,strategy:state?.strategy||SHADOW_CONFIG,eligibleCount:state?.eligibleCount||0,assetCoverage:state?.assetCoverage||{BTC:{eligible:0,up:0,down:0},ETH:{eligible:0,up:0,down:0}},opportunities:(state?.opportunities||[]).slice(0,30),persistence:state?.persistence||"BEST_EFFORT_EDGE_CACHE",realMoneyMoved:false,liveOrderSubmission:"DISABLED"};
}

const REAL_TEST_CONFIG={initialBankrollUsd:10,maxStakeUsd:5,entryScore:0.80,exitScore:0.20,maxHoldMs:5*60*1000};
const REAL_STATE_KEY="baseline-real-one-trade-v1";
async function loadRealTradeState(env){
  if(env?.BASELINE_REAL_SHADOW_STATE?.get){try{const row=await env.BASELINE_REAL_SHADOW_STATE.get(REAL_STATE_KEY,"json");if(row)return row;}catch{}}
  return {phase:"ARMED_WAITING_FOR_ENTRY",position:null,entry:null,exit:null,completed:false,realizedPnlUsd:0,unrealizedPnlUsd:0,submittedOrders:0,lastError:null,updatedAt:new Date().toISOString()};
}
function publicRealTradeView(s,env){return {mode:"ONE_TRADE_TEST",executionSafetyGate:"POLYMARKET_CONTROLLER_NOT_SCHEDULED_DURING_ROBINHOOD_15M_REPAIR",phase:s.phase,position:s.position,entry:s.entry,exit:s.exit,completed:s.completed,realizedPnlUsd:s.realizedPnlUsd||0,unrealizedPnlUsd:s.unrealizedPnlUsd||0,totalPnlUsd:(s.realizedPnlUsd||0)+(s.unrealizedPnlUsd||0),submittedOrders:s.submittedOrders||0,lastError:s.lastError||null,authorizedMaxStakeUsd:REAL_TEST_CONFIG.maxStakeUsd,liveOrderSubmission:"BLOCKED_DURING_ROBINHOOD_15M_REPAIR",credentialsInstalled:Boolean(env.POLYMARKET_US_KEY_ID&&env.POLYMARKET_US_SECRET),updatedAt:s.updatedAt||null};}

function dashboardHtml(){return `<!doctype html>
<html>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Market Edge — Baseline Real</title>
<style>
:root{--bg:#07111d;--card:#101d2b;--line:#29435f;--text:#fff;--muted:#9db1c7;--good:#77e6a5;--warn:#f0c75e;--bad:#ff8a8a;--blue:#8ec5ff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:var(--bg);color:var(--text);padding:18px}.wrap{max-width:1100px;margin:auto}.hero,.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}.hero h1{margin:0 0 6px;font-size:28px}.muted{color:var(--muted)}.bad{color:var(--bad)}.good{color:var(--good)}.warn{color:var(--warn)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}.v{font-size:24px;font-weight:800;margin-top:5px}.label{font-size:11px;color:var(--muted);text-transform:uppercase}.wide{grid-column:span 2}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.pill{padding:7px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px}.links a{color:var(--blue);margin-right:16px}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;color:var(--muted)}@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}.wide{grid-column:span 2}.hero h1{font-size:23px}}
</style>
</head>
<body><div class="wrap">
<div class="hero">
<h1>Market Edge — Baseline Real</h1>
<div class="muted">BTC 15-minute live observation + unchanged Baseline signal layer</div>
<p class="bad"><strong>Execution safety gate:</strong> Robinhood signals cannot submit Polymarket orders. Real-money execution remains blocked.</p>
<div class="links"><a href="/btc-15m-proof">Observation proof</a><a href="/btc-15m-signal">Signal proof</a><a href="/shadow-state">Shadow state</a><a href="/real-trade-state">Real trade state</a></div>
</div>
<div class="grid">
<div class="card wide"><div class="label">Live BTC 15-minute contract</div><div id="contract" class="v">Loading…</div><div id="target" class="muted"></div></div>
<div class="card"><div class="label">Live Ask</div><div id="ask" class="v">—</div></div>
<div class="card"><div class="label">Signal</div><div id="action" class="v">—</div></div>
<div class="card"><div class="label">BTC Move</div><div id="move" class="v">—</div></div>
<div class="card"><div class="label">Baseline Score</div><div id="score" class="v">—</div><div class="muted">Entry ≥ 0.80</div></div>
<div class="card"><div class="label">Edge</div><div id="edge" class="v">—</div></div>
<div class="card"><div class="label">Safety</div><div class="v good">BLOCKED</div><div class="muted">No Robinhood-triggered order submission</div></div>
</div>
<div class="card" style="margin-top:10px"><div class="label">Runtime evidence</div><div id="status" class="muted">Refreshing every 15 seconds…</div><pre id="details"></pre></div>
</div>
<script>
const f=(n,d=2)=>Number.isFinite(Number(n))?Number(n).toFixed(d):"—";
async function refresh(){
 try{
  const r=await fetch("/btc-15m-signal",{cache:"no-store"}); const d=await r.json();
  const c=d.contract||{}; const s=d.signal||{}; const m=d.market||{};
  document.getElementById("contract").textContent=c.title||d.state||"No live contract";
  document.getElementById("target").textContent=c.target?"Target $"+Number(c.target).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):"";
  document.getElementById("ask").textContent=Number.isFinite(Number(c.askCents))?f(c.askCents,1)+"¢":"—";
  const a=document.getElementById("action");a.textContent=s.action||"WAIT";a.className="v "+(s.action==="ENTRY_SIGNAL"?"good":"warn");
  document.getElementById("move").textContent=f(m.btcMovePct,3)+"%";
  document.getElementById("score").textContent=f(s.score,2);
  document.getElementById("edge").textContent=f((s.edge||0)*100,2)+"%";
  document.getElementById("status").textContent=(d.ok?"LIVE SIGNAL LAYER":"NOT READY")+" · "+(d.observedAt||"");
  document.getElementById("details").textContent="Coinbase BTC: $"+f(m.coinbaseBtcUsd,2)+" | Previous Baseline BTC: $"+f(m.previousBaselineBtcUsd,2)+" | max hold 5m | max stake $5 | execution "+(d.execution||"BLOCKED");
 }catch(e){document.getElementById("status").textContent="Signal refresh failed";}}
refresh();setInterval(refresh,15000);
</script></body></html>`;}
export default {
  async scheduled(_event,env,_ctx){
    await runShadow(env);
  },
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET")return json({ok:false,error:"METHOD_NOT_ALLOWED",liveOrderSubmission:"DISABLED"},405);
    if(url.pathname==="/")return html(dashboardHtml());
    if(url.pathname==="/health")return json({ok:true,service:"market-edge-baseline-real",mode:"READ_ONLY_ACCOUNT_VERIFICATION",liveOrderSubmission:"DISABLED"});
    if(url.pathname==="/status")return json(statusPayload(env));
    if(url.pathname==="/account"){const proof=await accountProof(env);return json(proof,proof.ok?200:proof.state==="SECRET_FORMAT_INVALID"?422:502);}
    if(url.pathname==="/markets")return json(await marketSnapshot());
    if(url.pathname==="/btc-15m-proof")return json(await robinhoodBtc15mProof());
    if(url.pathname==="/btc-15m-signal")return json(await robinhoodBtc15mSignal(env));
    if(url.pathname==="/money-path-proof")return json(await moneyPathProof(env));
    if(url.pathname==="/preview-proof"){const proof=await previewProof(env);return json(proof,proof.ok?200:422);}
    if(url.pathname==="/shadow-state")return json(publicShadowView(await loadShadowState(env)));
    if(url.pathname==="/real-trade-state")return json(publicRealTradeView(await loadRealTradeState(env),env));
    if(url.pathname==="/shadow-run")return json(publicShadowView(await runShadow(env)));
    return json({ok:false,error:"NOT_FOUND"},404);
  }
};
