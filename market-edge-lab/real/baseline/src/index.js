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

    // Search/event payloads can contain compact market objects. Hydrate each candidate
    // through the official market-by-slug endpoint before asking for BBO/book data.
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
    return {ok:false,state:"SHORT_HORIZON_CANDIDATES_NOT_PREVIEWABLE",submitted:false,liveOrderSubmission:"DISABLED",fundingAuthorized:false,diagnostic:{category:diagnostics[0]||"NO_VALID_BBO",attempted:Math.min(candidates.length,20),allCandidateDiagnostics:[...new Set(diagnostics)].slice(0,6),sensitiveTextExposed:false},discovery:{searchEvents:eventMap.size,cryptoEvents:crypto.length,candidates:candidates.length,marketEvidence:marketEvidence.slice(0,6)}};
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

function shadowPriceSeries(asset) {
  return loadShadowState(globalThis.__baselineRealEnv || {}).then((state) => {
    const ledger = Array.isArray(state?.ledger) ? state.ledger : [];
    const field = asset === "BTC" ? "btc" : "eth";
    const points = ledger
      .filter((row) => row?.type === "SHADOW_REFRESH" && Number.isFinite(Number(row?.[field])))
      .map((row) => ({ ts: Date.parse(row.at), price: Number(row[field]) }))
      .filter((p) => Number.isFinite(p.ts) && p.price > 0)
      .slice(-288);
    const current = Number(state?.prices?.[asset]);
    if (Number.isFinite(current) && current > 0 && (!points.length || points[points.length - 1].price !== current)) {
      points.push({ ts: Date.parse(state?.lastRunAt || new Date().toISOString()), price: current });
    }
    const first = points[0]?.price ?? current;
    const changePct = Number.isFinite(current) && first > 0 ? ((current - first) / first) * 100 : 0;
    return { product: asset + "-USD", current, changePct, points, source: "BASELINE_REAL_SHADOW_OBSERVATIONS", window: points.length >= 2 ? "OBSERVED" : "BUILDING" };
  });
}

async function livePriceProof(env) {
  // Display-only market monitor. This intentionally mirrors the frozen Paper Baseline:
  // live Coinbase spot + Coinbase Exchange 24h stats/candles. It does not mutate Shadow state.
  try {
    const make = async (asset) => {
      const product = asset + "-USD";
      const [current, statsRes, candlesRes] = await Promise.all([
        coinbaseSpot(product),
        fetch("https://api.exchange.coinbase.com/products/" + product + "/stats", { headers: { accept: "application/json" } }),
        fetch("https://api.exchange.coinbase.com/products/" + product + "/candles?granularity=3600", { headers: { accept: "application/json" } }),
      ]);
      if (!statsRes.ok || !candlesRes.ok) throw new Error("COINBASE_TREND_UNAVAILABLE");
      const [stats, candles] = await Promise.all([statsRes.json(), candlesRes.json()]);
      const open = Number(stats?.open);
      const last = Number(stats?.last);
      const closes = (Array.isArray(candles) ? candles : [])
        .filter((x) => Array.isArray(x) && Number.isFinite(Number(x[0])) && Number.isFinite(Number(x[4])))
        .sort((a,b) => Number(a[0]) - Number(b[0]))
        .slice(-24)
        .map((x) => ({ ts: Number(x[0]) * 1000, price: Number(x[4]) }));
      const changePct = Number.isFinite(open) && open > 0 && Number.isFinite(last) ? ((last-open)/open)*100 : 0;
      return { product, current, changePct, points: closes, source: "COINBASE_EXCHANGE_24H", window: "24H" };
    };
    const [btc, eth] = await Promise.all([make("BTC"), make("ETH")]);
    return { ok: true, window: "24H", btc, eth, note: "Display-only Coinbase 24-hour trend, matching the frozen Paper Baseline monitor. Shadow trading state is unchanged." };
  } catch {
    return { ok: false, state: "PRICE_SERIES_UNAVAILABLE", window: "24H" };
  }
}
function shadowRelevant(text) {
  const q = String(text || "").toLowerCase();
  const asset = q.includes("bitcoin") || /\bbtc\b/.test(q)
    ? "BTC"
    : q.includes("ethereum") || /\beth\b/.test(q) || /\bether\b/.test(q)
      ? "ETH"
      : null;
  if (!asset) return null;
  // US crypto events commonly use "high/low" wording and Ethereum can be named
  // "Ether". These are classification aliases only; scoring and execution rules
  // remain unchanged.
  const up = /\b(up|above|higher|high|rise|gain|over|increase)\b/.test(q);
  const down = /\b(down|below|lower|low|fall|drop|dip|under|decrease)\b/.test(q);
  if (!up && !down) return null;
  return { asset, bear: down && !up };
}

function scoreShadowMarket(market, moves) {
  // Exact frozen Paper Baseline scoring formula; only the venue/price source is adapted to Polymarket US.
  const move = moves[market.asset] || 0;
  const directionalMove = market.bear ? -move : move;
  const fair = clamp(market.yes + directionalMove * 18, 0.02, 0.98);
  const edge = fair - market.yes;
  const score = clamp(0.5 + edge * 4, 0, 1);
  return { ...market, move, fair, edge, score };
}

async function loadShadowState(env) {
  if (env?.BASELINE_REAL_SHADOW_STATE) {
    try {
      const raw = await env.BASELINE_REAL_SHADOW_STATE.get("baseline-real-shadow-v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          parsed.persistence = "ISOLATED_KV";
          return parsed;
        }
      }
    } catch {}
  }
  const cache = caches.default;
  const hit = await cache.match(shadowCacheRequest());
  if (hit) {
    try {
      const parsed = await hit.json();
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return {
    mode: "REAL_US_SHADOW",
    startedAt: null,
    lastRunAt: null,
    prices: { BTC: null, ETH: null },
    moves: { BTC: 0, ETH: 0 },
    positions: [],
    opportunities: [],
    ledger: [],
    runs: 0,
    status: "READY_NOT_STARTED",
    persistence: "BEST_EFFORT_EDGE_CACHE",
    liveOrderSubmission: "DISABLED",
  };
}

async function saveShadowState(env, state) {
  state.updatedAt = new Date().toISOString();
  if (env?.BASELINE_REAL_SHADOW_STATE) {
    await env.BASELINE_REAL_SHADOW_STATE.put("baseline-real-shadow-v1", JSON.stringify({ ...state, persistence: "ISOLATED_KV" }));
    state.persistence = "ISOLATED_KV";
    return;
  }
  await caches.default.put(
    shadowCacheRequest(),
    new Response(JSON.stringify(state), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=31536000",
      },
    })
  );
}

function shadowLedger(state, type, payload = {}) {
  state.ledger.unshift({ ts: new Date().toISOString(), type, ...payload });
  state.ledger = state.ledger.slice(0, SHADOW_CONFIG.maxLedger);
}

async function discoverUsShadowMarkets() {
  const client = new PolymarketUS();
  // Query both long names and ticker/common-name variants. Results are deduplicated
  // below, so broadening discovery does not duplicate markets or change scoring.
  const searchTerms = ["bitcoin","BTC","bitcoin up or down","BTC up or down","ethereum","ETH","ether","ethereum up or down","ETH up or down"];
  // One rejected fuzzy-search request must not kill the entire Shadow observation.
  // This matters because the provider can throttle or reject individual broad queries.
  const settled = await Promise.allSettled(
    searchTerms.map((query) => client.search.query({ query, status: "active", limit: 50 }))
  );
  const searches = settled.filter((x) => x.status === "fulfilled").map((x) => x.value);
  if (!searches.length) throw new Error("POLYMARKET_US_SEARCH_UNAVAILABLE");

  const eventMap = new Map();
  for (const result of searches) {
    for (const event of (result?.events || [])) {
      const key = String(event?.id ?? event?.slug ?? "");
      if (key) eventMap.set(key, event);
    }
  }

  const candidates = [];
  let seen = 0;
  let rejected = 0;

  for (const event of eventMap.values()) {
    for (const compact of (event?.markets || [])) {
      seen += 1;
      if (!compact?.slug || compact?.active === false || compact?.closed === true) {
        rejected += 1;
        continue;
      }

      let market = compact;
      try {
        const detail = await client.markets.retrieveBySlug(compact.slug);
        market = detail?.market || compact;
      } catch {}

      const text = [event?.title, event?.slug, market?.title, market?.slug, market?.outcome].filter(Boolean).join(" — ");
      const rel = shadowRelevant(text);

      // Baseline Real accepts short-horizon contracts only. Preference is
      // 15-minute, then hourly, then daily. Longer contracts are rejected.
      const startMs = Date.parse(event?.startTime || "");
      const endMs = Date.parse(event?.endTime || "");
      const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : NaN;
      const explicit15m = /15\s*(?:min|minute)|15m\b|quarter[- ]?hour/i.test(text);
      const explicitHourly = /\b(?:hourly|this hour|1\s*hour)\b/i.test(text);
      const explicitDaily = /\b(?:daily|today|tonight|this day|24\s*hour)\b/i.test(text);
      const timed15m = Number.isFinite(durationMs) && durationMs >= 10 * 60 * 1000 && durationMs <= 20 * 60 * 1000;
      const timedHourly = Number.isFinite(durationMs) && durationMs > 20 * 60 * 1000 && durationMs <= 90 * 60 * 1000;
      const timedDaily = Number.isFinite(durationMs) && durationMs > 90 * 60 * 1000 && durationMs <= 30 * 60 * 60 * 1000;
      const horizon = (explicit15m || timed15m) ? "15M"
        : (explicitHourly || timedHourly) ? "HOURLY"
        : (explicitDaily || timedDaily) ? "DAILY"
        : null;
      if (!rel || !horizon || market?.active === false || market?.closed === true) {
        rejected += 1;
        continue;
      }

      try {
        const bboRaw = await client.markets.bbo(market.slug);
        const bbo = bboRaw?.marketData || bboRaw;
        let yes = normalizeProbability(bbo?.bestAsk);
        let bid = normalizeProbability(bbo?.bestBid);

        if (yes === null) {
          const bookRaw = await client.markets.book(market.slug);
          const book = bookRaw?.marketData || bookRaw;
          const offers = Array.isArray(book?.offers) ? book.offers : [];
          const bids = Array.isArray(book?.bids) ? book.bids : [];
          yes = normalizeProbability(offers[0]?.px);
          if (bid === null) bid = normalizeProbability(bids[0]?.px);
        }

        if (yes === null || yes <= 0.01 || yes >= 0.99) {
          rejected += 1;
          continue;
        }

        candidates.push({
          id: String(market?.id ?? market?.slug),
          slug: market.slug,
          question: text,
          asset: rel.asset,
          bear: rel.bear,
          yes,
          bid,
          source: "POLYMARKET_US",
          horizon,
          durationMs: Number.isFinite(durationMs) ? durationMs : null,
        });
      } catch {
        rejected += 1;
      }
    }
  }

  const horizonRank = { "15M": 0, "HOURLY": 1, "DAILY": 2 };
  candidates.sort((a, b) => (horizonRank[a.horizon] ?? 9) - (horizonRank[b.horizon] ?? 9));

  const coverage = {
    BTC: {
      eligible: candidates.filter((m) => m.asset === "BTC").length,
      up: candidates.filter((m) => m.asset === "BTC" && !m.bear).length,
      down: candidates.filter((m) => m.asset === "BTC" && m.bear).length,
    },
    ETH: {
      eligible: candidates.filter((m) => m.asset === "ETH").length,
      up: candidates.filter((m) => m.asset === "ETH" && !m.bear).length,
      down: candidates.filter((m) => m.asset === "ETH" && m.bear).length,
    },
  };

  return { markets: candidates, seen, rejected, coverage };
}

async function runShadow(env) {
  const state = await loadShadowState(env);
  const now = Date.now();

  let stage = "BTC_SPOT";
  try {
    const btc = await coinbaseSpot("BTC-USD");
    stage = "ETH_SPOT";
    const eth = await coinbaseSpot("ETH-USD");
    stage = "POLYMARKET_DISCOVERY";
    const discovery = await discoverUsShadowMarkets();
    stage = "SCORING";

    const previous = state.prices || {};
    const moves = {
      BTC: previous.BTC ? (btc - previous.BTC) / previous.BTC : 0,
      ETH: previous.ETH ? (eth - previous.ETH) / previous.ETH : 0,
    };

    const horizonRank = { "15M": 0, "HOURLY": 1, "DAILY": 2 };
    const opportunities = discovery.markets
      .map((m) => scoreShadowMarket(m, moves))
      .sort((a, b) => (horizonRank[a.horizon] ?? 9) - (horizonRank[b.horizon] ?? 9) || b.score - a.score);

    for (const position of [...(state.positions || [])]) {
      const current = opportunities.find((o) => o.id === position.marketId);
      if (!current) continue;
      const age = now - position.openedAt;
      if (current.score <= SHADOW_CONFIG.exitScore || age >= SHADOW_CONFIG.maxHoldMs) {
        state.positions = state.positions.filter((p) => p.marketId !== position.marketId);
        shadowLedger(state, "SHADOW_EXIT", {
          marketId: position.marketId,
          slug: position.slug,
          question: position.question,
          entryObservedAsk: position.entryObservedAsk,
          exitObservedBid: current.bid,
          heldMs: age,
          reason: current.score <= SHADOW_CONFIG.exitScore ? "score_exit" : "max_hold",
          realMoneyMoved: false,
        });
      }
    }

    for (const o of opportunities.slice(0, 20)) {
      if ((state.positions || []).some((p) => p.marketId === o.id)) continue;
      if (o.score < SHADOW_CONFIG.entryScore || o.edge <= 0) continue;
      state.positions.push({
        marketId: o.id,
        slug: o.slug,
        question: o.question,
        asset: o.asset,
        entryObservedAsk: o.yes,
        maxStakeUsd: SHADOW_CONFIG.maxStakeUsd,
        openedAt: now,
        entryScore: o.score,
      });
      shadowLedger(state, "SHADOW_ENTRY", {
        marketId: o.id,
        slug: o.slug,
        question: o.question,
        asset: o.asset,
        observedAsk: o.yes,
        maxStakeUsd: SHADOW_CONFIG.maxStakeUsd,
        score: o.score,
        edge: o.edge,
        realMoneyMoved: false,
      });
    }

    state.prices = { BTC: btc, ETH: eth };
    state.moves = moves;
    state.opportunities = opportunities.slice(0, 20);
    state.eligibleCount = discovery.markets.length;
    state.assetCoverage = discovery.coverage;
    state.assetCoverageReady = Number(discovery.coverage?.BTC?.eligible || 0) > 0 && Number(discovery.coverage?.ETH?.eligible || 0) > 0;
    state.rejectedCount = discovery.rejected;
    state.seenCount = discovery.seen;
    state.lastRunAt = new Date(now).toISOString();
    state.startedAt = state.startedAt || state.lastRunAt;
    state.runs = Number(state.runs || 0) + 1;
    state.status = "LIVE_US_SHADOW";
    state.errorCode = null;
    state.errorStage = null;
    state.liveOrderSubmission = "DISABLED";
    state.strategy = {
      entryScore: SHADOW_CONFIG.entryScore,
      exitScore: SHADOW_CONFIG.exitScore,
      maxHoldMs: SHADOW_CONFIG.maxHoldMs,
      maxStakeUsd: SHADOW_CONFIG.maxStakeUsd,
    };
    shadowLedger(state, "SHADOW_REFRESH", {
      eligible: state.eligibleCount,
      rejected: state.rejectedCount,
      seen: state.seenCount,
      qualifying: opportunities.filter((o) => o.score >= SHADOW_CONFIG.entryScore && o.edge > 0).length,
      btc,
      eth,
      btcMove: moves.BTC,
      ethMove: moves.ETH,
      realMoneyMoved: false,
    });
  } catch (error) {
    // A failed discovery must fail closed: stale long-duration cards are not evidence.
    state.opportunities = [];
    state.eligibleCount = 0;
    state.assetCoverage = { BTC: { eligible: 0, up: 0, down: 0 }, ETH: { eligible: 0, up: 0, down: 0 } };
    state.assetCoverageReady = false;
    state.lastRunAt = new Date(now).toISOString();
    state.status = "ERROR";
    state.errorCode = String(error?.message || "SHADOW_OBSERVATION_FAILED").slice(0, 120);
    state.errorStage = stage;
    shadowLedger(state, "SHADOW_ERROR", {
      errorType: error?.name || "Error",
      message: "Shadow observation failed; provider details suppressed.",
      realMoneyMoved: false,
    });
  }

  try {
    await saveShadowState(env, state);
  } catch {
    // Observation evidence remains usable for this request even if persistence is
    // temporarily unavailable; never turn a successful provider read into SIGNAL ERROR.
    state.persistence = "WRITE_UNAVAILABLE_THIS_RUN";
  }
  return state;
}


const REAL_TEST_CONFIG = {
  initialBankrollUsd: 10,
  maxStakeUsd: 5,
  entryScore: 0.80,
  exitScore: 0.20,
  maxHoldMs: 5 * 60 * 1000,
};

const REAL_TRADE_STATE_KEY = "baseline-real-one-trade-v1";

async function loadRealTradeState(env) {
  if (!env?.BASELINE_REAL_SHADOW_STATE) {
    return {
      status: "READY_DISARMED",
      consumed: false,
      entryOrderId: null,
      exitOrderId: null,
      marketSlug: null,
      openedAt: null,
      closedAt: null,
      entryScore: null,
      exitReason: null,
      initialBankrollUsd: REAL_TEST_CONFIG.initialBankrollUsd,
      maxStakeUsd: REAL_TEST_CONFIG.maxStakeUsd,
      ledger: [],
    };
  }
  try {
    const raw = await env.BASELINE_REAL_SHADOW_STATE.get(REAL_TRADE_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    status: "READY_DISARMED",
    consumed: false,
    entryOrderId: null,
    exitOrderId: null,
    marketSlug: null,
    openedAt: null,
    closedAt: null,
    entryScore: null,
    exitReason: null,
    initialBankrollUsd: REAL_TEST_CONFIG.initialBankrollUsd,
    maxStakeUsd: REAL_TEST_CONFIG.maxStakeUsd,
    ledger: [],
  };
}

async function saveRealTradeState(env, state) {
  state.updatedAt = new Date().toISOString();
  if (env?.BASELINE_REAL_SHADOW_STATE) {
    await env.BASELINE_REAL_SHADOW_STATE.put(REAL_TRADE_STATE_KEY, JSON.stringify(state));
  }
}

function realTradeLedger(state, type, payload = {}) {
  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  state.ledger.unshift({ ts: new Date().toISOString(), type, ...payload });
  state.ledger = state.ledger.slice(0, 80);
}

function realTradeArmed(env) {
  return env?.EXECUTION_MODE === "ONE_TRADE_TEST" && env?.LIVE_ORDER_SUBMISSION === "ONE_TRADE_ARMED";
}

async function maybeRunOneTrade(env) {
  const state = await loadRealTradeState(env);

  if (!realTradeArmed(env)) {
    if (!state.consumed && !state.entryOrderId) state.status = "READY_DISARMED";
    await saveRealTradeState(env, state);
    return state;
  }

  if (state.consumed) {
    state.status = "ONE_TRADE_COMPLETE";
    await saveRealTradeState(env, state);
    return state;
  }

  const built = await createClient(env);
  if (!built.ok) {
    state.status = "BLOCKED_AUTH";
    realTradeLedger(state, "REAL_TEST_BLOCKED", { reason: built.state });
    await saveRealTradeState(env, state);
    return state;
  }

  const shadow = await loadShadowState(env);
  const now = Date.now();

  // Entry: exactly one governed real order, only from a qualifying Shadow opportunity.
  if (!state.entryOrderId) {
    if (state.status === "ENTRY_SUBMITTING" || state.status === "BLOCKED_ENTRY_RECONCILIATION") {
      state.status = "BLOCKED_ENTRY_RECONCILIATION";
      realTradeLedger(state, "REAL_TEST_BLOCKED", { reason: "ENTRY_RECONCILIATION_REQUIRED" });
      await saveRealTradeState(env, state);
      return state;
    }

    // Safety gate for the first governed trade: do not allow the acceptance test
    // to fire until live discovery has positively demonstrated BOTH BTC and ETH.
    // This prevents a silently BTC-only discovery bug from consuming the one-trade test.
    if (!shadow?.assetCoverageReady) {
      state.status = "HOLD_ASSET_COVERAGE_NOT_PROVEN";
      await saveRealTradeState(env, state);
      return state;
    }

    const candidate = (shadow?.opportunities || []).find((o) =>
      Number(o?.score) >= REAL_TEST_CONFIG.entryScore &&
      Number(o?.edge) > 0 &&
      Number(o?.yes) > 0.01 &&
      Number(o?.yes) < 0.99 &&
      o?.slug
    );

    if (!candidate) {
      state.status = "ARMED_WAITING_FOR_ENTRY";
      await saveRealTradeState(env, state);
      return state;
    }

    const balances = await built.client.account.balances();
    const account = safeAccountView(balances);
    if (!account.fundedRecordPresent || !account.buyingPowerAvailable) {
      state.status = "BLOCKED_NO_BUYING_POWER";
      await saveRealTradeState(env, state);
      return state;
    }

    const request = {
      marketSlug: candidate.slug,
      intent: "ORDER_INTENT_BUY_LONG",
      type: "ORDER_TYPE_MARKET",
      cashOrderQty: { value: REAL_TEST_CONFIG.maxStakeUsd.toFixed(2), currency: "USD" },
      manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
      synchronousExecution: true,
    };

    // Mandatory preview immediately before the one allowed create call.
    await built.client.orders.preview({ request });

    // Persist a one-way pre-submit latch BEFORE the provider POST. If the worker dies
    // after the POST but before the response is saved, the next run blocks instead of
    // risking a duplicate real-money order.
    state.marketSlug = candidate.slug;
    state.question = candidate.question || null;
    state.asset = candidate.asset || null;
    state.entryScore = Number(candidate.score);
    state.status = "ENTRY_SUBMITTING";
    state.entrySubmitStartedAt = now;
    realTradeLedger(state, "REAL_ENTRY_PRE_SUBMIT_LATCHED", {
      marketSlug: state.marketSlug,
      question: state.question,
      asset: state.asset,
      score: state.entryScore,
      maxCashStakeUsd: REAL_TEST_CONFIG.maxStakeUsd,
    });
    await saveRealTradeState(env, state);

    const created = await built.client.orders.create(request);

    state.entryOrderId = created?.id || null;
    state.openedAt = Date.now();
    state.status = state.entryOrderId ? "ENTRY_SUBMITTED" : "BLOCKED_ENTRY_RECONCILIATION";
    realTradeLedger(state, "REAL_ENTRY_SUBMITTED", {
      orderId: state.entryOrderId,
      marketSlug: state.marketSlug,
      question: state.question,
      asset: state.asset,
      score: state.entryScore,
      maxCashStakeUsd: REAL_TEST_CONFIG.maxStakeUsd,
    });
    await saveRealTradeState(env, state);
    return state;
  }

  // Exit: close the single test position at score <= .20 or after 5 minutes.
  if (!state.exitOrderId) {
    if (state.status === "EXIT_SUBMITTING" || state.status === "BLOCKED_EXIT_RECONCILIATION") {
      state.status = "BLOCKED_EXIT_RECONCILIATION";
      realTradeLedger(state, "REAL_TEST_BLOCKED", { reason: "EXIT_RECONCILIATION_REQUIRED" });
      await saveRealTradeState(env, state);
      return state;
    }

    const current = (shadow?.opportunities || []).find((o) => o?.slug === state.marketSlug);
    const age = state.openedAt ? now - Number(state.openedAt) : 0;
    const scoreExit = current && Number(current.score) <= REAL_TEST_CONFIG.exitScore;
    const timeExit = age >= REAL_TEST_CONFIG.maxHoldMs;

    if (!scoreExit && !timeExit) {
      state.status = "OPEN_WAITING_FOR_EXIT";
      await saveRealTradeState(env, state);
      return state;
    }

    state.status = "EXIT_SUBMITTING";
    state.exitSubmitStartedAt = now;
    state.exitReason = scoreExit ? "score_exit" : "max_hold";
    realTradeLedger(state, "REAL_EXIT_PRE_SUBMIT_LATCHED", {
      marketSlug: state.marketSlug,
      reason: state.exitReason,
      heldMs: age,
      observedExitScore: current ? Number(current.score) : null,
    });
    await saveRealTradeState(env, state);

    const closed = await built.client.orders.closePosition({
      marketSlug: state.marketSlug,
      manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
      synchronousExecution: true,
    });

    state.exitOrderId = closed?.id || null;
    state.closedAt = Date.now();
    state.consumed = Boolean(state.exitOrderId);
    state.status = state.exitOrderId ? "ONE_TRADE_COMPLETE" : "BLOCKED_EXIT_RECONCILIATION";
    realTradeLedger(state, "REAL_EXIT_SUBMITTED", {
      orderId: state.exitOrderId,
      marketSlug: state.marketSlug,
      reason: state.exitReason,
      heldMs: age,
      observedExitScore: current ? Number(current.score) : null,
    });
    await saveRealTradeState(env, state);
  }

  return state;
}

function publicRealTradeView(state, env) {
  return {
    ok: true,
    controller: "ONE_GOVERNED_REAL_TRADE",
    armed: realTradeArmed(env),
    status: state?.status || "UNKNOWN",
    consumed: Boolean(state?.consumed),
    initialBankrollUsd: REAL_TEST_CONFIG.initialBankrollUsd,
    maxStakeUsd: REAL_TEST_CONFIG.maxStakeUsd,
    entryScore: REAL_TEST_CONFIG.entryScore,
    exitScore: REAL_TEST_CONFIG.exitScore,
    maxHoldMs: REAL_TEST_CONFIG.maxHoldMs,
    marketSlug: state?.marketSlug || null,
    question: state?.question || null,
    entryOrderPresent: Boolean(state?.entryOrderId),
    exitOrderPresent: Boolean(state?.exitOrderId),
    openedAt: state?.openedAt || null,
    closedAt: state?.closedAt || null,
    exitReason: state?.exitReason || null,
    recentEvidence: (state?.ledger || []).slice(0, 20),
    actualProviderBalanceAmountsExposed: false,
  };
}

function publicShadowView(state) {
  return {
    ok: state?.status !== "ERROR",
    mode: "REAL_US_SHADOW",
    status: state?.status || "UNKNOWN",
    startedAt: state?.startedAt || null,
    lastRunAt: state?.lastRunAt || null,
    runs: state?.runs || 0,
    strategy: state?.strategy || SHADOW_CONFIG,
    eligibleCount: state?.eligibleCount || 0,
    assetCoverage: state?.assetCoverage || { BTC:{eligible:0,up:0,down:0}, ETH:{eligible:0,up:0,down:0} },
    assetCoverageReady: Boolean(state?.assetCoverageReady),
    rejectedCount: state?.rejectedCount || 0,
    seenCount: state?.seenCount || 0,
    errorCode: state?.errorCode || null,
    errorStage: state?.errorStage || null,
    opportunities: (state?.opportunities || []).map((o) => ({
      slug: o.slug,
      question: o.question,
      asset: o.asset,
      observedAsk: o.yes,
      observedBid: o.bid,
      score: o.score,
      edge: o.edge,
      move: o.move,
      fair: o.fair,
      horizon: o.horizon || null,
      durationMs: o.durationMs ?? null,
    })),
    openShadowPositions: (state?.positions || []).map((p) => ({
      slug: p.slug,
      question: p.question,
      asset: p.asset,
      entryObservedAsk: p.entryObservedAsk,
      maxStakeUsd: p.maxStakeUsd,
      openedAt: p.openedAt,
      entryScore: p.entryScore,
    })),
    recentEvidence: (state?.ledger || []).slice(0, 25),
    persistence: state?.persistence || "BEST_EFFORT_EDGE_CACHE",
    realMoneyMoved: false,
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
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 80% 0,#0d2440 0,transparent 35%),var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;min-height:100vh}.w{max-width:1320px;margin:auto;padding:12px 14px 36px}.hero,.card,.opp{background:linear-gradient(180deg,var(--p2),var(--p));border:1px solid var(--line);border-radius:16px}.hero{padding:11px 16px;display:flex;align-items:center;justify-content:space-between;gap:15px}.brand{display:flex;align-items:center;gap:14px}.logo{width:112px;height:64px;object-fit:contain;border-radius:10px}.k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}h1{font-size:25px;margin:2px 0}.sub,.m{font-size:12px;color:var(--muted)}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pill,.btn{border:1px solid #725f34;color:var(--gold2);background:#0b1421;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:800}.pill.real{border-color:#315a8c;color:#a9d0ff}.btn{cursor:pointer}.btn:hover{border-color:var(--gold2);background:#121e2c}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}.card{padding:11px 13px}.label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.val{font-size:24px;font-weight:850;margin-top:5px}.good{color:var(--green)}.warn{color:var(--yellow)}.bad{color:var(--red)}.section{margin-top:8px}.statusline{display:flex;align-items:center;gap:9px;margin-top:8px}.dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px #67e49b18}.dot.warn{background:var(--yellow);box-shadow:0 0 0 5px #f0c75e18}.dot.bad{background:var(--red);box-shadow:none}.wide{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.55fr);gap:8px}.rows{display:grid}.row{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-top:1px solid #1b2d42;font-size:12px}.row:first-child{border-top:0}.opps{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:7px}.opp{padding:9px}.oppHead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.q{font-size:13px;font-weight:700;line-height:1.35}.tag{border:1px solid #725f34;background:#0a1421;color:var(--gold2);border-radius:10px;padding:6px 8px;font-size:9px;font-weight:900;white-space:nowrap}.oppBadges{display:flex;gap:6px;align-items:flex-start}.scoreBadge{min-width:58px;text-align:center;border:1px solid #725f34;background:#0a1421;color:var(--gold2);border-radius:10px;padding:4px 7px;font-weight:900;line-height:1}.scoreBadge small{display:block;font-size:7px;letter-spacing:.12em;color:var(--muted);margin-bottom:4px}.scoreBadge strong{font-size:16px}.scoreBadge.hot{border-color:#3b9d6c;color:var(--green)}.meta{font-size:11px;color:var(--muted);margin-top:7px}.gate{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #1b2d42;font-size:12px}.gate:first-child{border-top:0}.marketGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:7px}.marketCard{background:#0a1421;border:1px solid #1f344d;border-radius:14px;padding:10px 12px}.marketTop{display:flex;justify-content:space-between;gap:12px;align-items:end}.marketPrice{font-size:25px;font-weight:850}.marketChange{font-size:15px;font-weight:850}.spark{width:100%;height:70px;margin-top:6px;display:block}.spark polyline{fill:none;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}.spark .base{stroke:#486079;stroke-width:1}.pnlGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px}.pnlBox,.miniBox{background:#0a1421;border:1px solid #1f344d;border-radius:12px;padding:9px 11px}.compactGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px}.miniVal{font-size:14px;font-weight:850;margin-top:4px;line-height:1.25}.miniSub{font-size:10px;color:var(--muted);margin-top:3px}.pnlNum{font-size:22px;font-weight:850;margin-top:4px}.footer{text-align:center;color:#62778e;font-size:10px;margin-top:18px}.notice{border-left:3px solid var(--gold);padding:7px 9px;background:#0a1421;color:var(--muted);font-size:11px;line-height:1.45;margin-top:10px}
@media(min-width:1100px){.opps{grid-template-columns:repeat(3,1fr)}}
@media(max-width:720px){.grid{grid-template-columns:repeat(2,1fr)}.compactGrid{grid-template-columns:repeat(2,1fr)}.wide{grid-template-columns:1fr}.opps{grid-template-columns:1fr}.marketGrid{grid-template-columns:1fr}.pnlGrid{grid-template-columns:1fr}.logo{width:100px;height:58px}h1{font-size:23px}.hero{align-items:flex-start}}@media(max-width:460px){.grid{grid-template-columns:1fr}.compactGrid{grid-template-columns:1fr}.brand{gap:8px}.logo{width:78px;height:48px}.k{font-size:8px}.sub{font-size:10px}.pill,.btn{font-size:9px;padding:6px 8px}.val{font-size:20px}.hero{padding:12px}}
</style>
</head>
<body>
<div class="w">
  <div class="hero">
    <div class="brand">
      <img class="logo" alt="NFE-OS" src="https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/main/market-edge-lab/public/nfe-os-logo-market-edge.webp">
      <div><div class="k">NFE-OS Research Lab · Polymarket US</div><h1>Market Edge — Baseline Real</h1><div class="sub">Real account validation · BTC/ETH only · governed test environment</div></div>
    </div>
    <div class="actions"><button id="refresh" class="btn" type="button">REFRESH PROOF</button><div id="modePill" class="pill real">REAL · CHECKING</div><div class="pill">BANKROLL FUNDED · NO ADDITIONAL DEPOSIT</div></div>
  </div>

  <div class="grid">
    <div class="card"><div class="label">Polymarket Connection</div><div id="conn" class="val">CHECKING…</div><div id="connSub" class="m"></div></div>
    <div class="card"><div class="label">Account State</div><div id="bal" class="val">CHECKING…</div><div id="balSub" class="m"></div></div>
    <div class="card"><div class="label">Additional Funding</div><div class="val good">NO MORE NEEDED</div><div class="m">$10 experiment bankroll funded. Additional deposits are locked for this one-trade test. Maximum real trade stake remains $5.</div></div>
    <div class="card"><div class="label">Live Orders</div><div id="liveOrdersState" class="val warn">CHECKING…</div><div id="liveOrdersSub" class="m">One-trade execution controller status loading.</div></div>
  </div>

  <div class="card section">
    <b>Real-System Status</b>
    <div class="statusline"><span id="statusDot" class="dot warn"></span><div><div id="statusText"><b>CHECKING REAL CONTROLLER…</b></div><div id="statusSub" class="m">Loading governed execution state.</div></div></div>
  </div>

  <div class="card section">
    <b>BTC / ETH · Live 24-Hour Market Display</b>
    <div class="marketGrid">
      <div class="marketCard">
        <div class="marketTop"><div><div class="label">Bitcoin</div><div id="btcPrice" class="marketPrice">CHECKING…</div></div><div id="btcChange" class="marketChange">—</div></div>
        <svg id="btcChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Bitcoin 24 hour price chart"></svg>
      </div>
      <div class="marketCard">
        <div class="marketTop"><div><div class="label">Ethereum</div><div id="ethPrice" class="marketPrice">CHECKING…</div></div><div id="ethChange" class="marketChange">—</div></div>
        <svg id="ethChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Ethereum 24 hour price chart"></svg>
      </div>
    </div>
    <div class="notice">Live display mirrors Paper Baseline: Coinbase spot refresh plus Coinbase Exchange 24-hour candles. Display only; it does not change Shadow decisions and does not represent Polymarket contract prices.</div>
  </div>

  <div class="card section">
    <b>Profit / Loss</b>
    <div class="pnlGrid">
      <div class="pnlBox"><div class="label">Realized P/L</div><div class="pnlNum">$0.00</div><div class="m">No Baseline Real orders have been submitted.</div></div>
      <div class="pnlBox"><div class="label">Unrealized P/L</div><div class="pnlNum">$0.00</div><div class="m">No real Baseline position is open.</div></div>
      <div class="pnlBox"><div class="label">Total Real P/L</div><div class="pnlNum">$0.00</div><div class="m">REAL P/L · NOT STARTED</div></div>
    </div>
    <div class="notice"><b>REAL MONEY ONLY:</b> Shadow observations never count as real P/L.</div>
  </div>

  <div class="section wide">
    <div>
      <b>Current Opportunities · Polymarket US</b>
      <div id="markets" class="opps"><div class="m">Loading public Polymarket US markets…</div></div>
    </div>
    <div class="card">
      <b>Governance Status</b>
      <div class="rows" style="margin-top:8px">
        <div class="row"><span>Credentials</span><strong id="creds">CHECKING…</strong></div>
        <div class="row"><span>Secret exposure</span><strong class="good">NONE</strong></div>
        <div class="row"><span>Shadow experiment</span><strong id="shadowGov">CHECKING…</strong></div>
        <div class="row"><span>Market scope</span><strong>BTC / ETH ONLY</strong></div>
        <div class="row"><span>Execution mode</span><strong id="executionGov">CHECKING…</strong></div>
      </div>
    </div>
  </div>

  <div class="card section">
    <b>Baseline Real Shadow Runtime</b>
    <div class="compactGrid">
      <div class="miniBox"><div class="label">Signal engine</div><div id="shadowRuntime" class="miniVal">CHECKING…</div><div class="miniSub">LIVE observation only</div></div>
      <div class="miniBox"><div class="label">Runs / eligible</div><div class="miniVal"><span id="shadowRuns">0</span> runs · <span id="shadowEligible">0</span> markets</div><div class="miniSub">BTC / ETH US scope</div></div>
      <div class="miniBox"><div class="label">Persistence</div><div id="shadowPersistence" class="miniVal">—</div><div class="miniSub">Isolated from paper experiments</div></div>
      <div class="miniBox"><div class="label">Started</div><div id="shadowStarted" class="miniVal">—</div></div>
      <div class="miniBox"><div class="label">Last observation</div><div id="shadowLast" class="miniVal">—</div></div>
      <div class="miniBox"><div class="label">Trading rule</div><div class="miniVal">≥ .80 ENTRY · ≤ .20 EXIT</div><div class="miniSub">5 min max hold · $5 max stake</div></div>
    </div>
  </div>

  <div class="card section">
    <b>Real Orders · One-Trade Acceptance Test</b>
    <div class="compactGrid">
      <div class="miniBox"><div class="label">Orders waiting</div><div id="realController" class="miniVal">CHECKING…</div><div id="realTradeStatus" class="miniSub">CHECKING…</div></div>
      <div class="miniBox"><div class="label">Current position</div><div id="realTradeMarket" class="miniVal">WAITING</div><div class="miniSub">No manual order required</div></div>
      <div class="miniBox"><div class="label">Entry order</div><div id="realEntryOrder" class="miniVal">NOT SUBMITTED</div></div>
      <div class="miniBox"><div class="label">Exit order</div><div id="realExitOrder" class="miniVal">NOT SUBMITTED</div></div>
      <div class="miniBox"><div class="label">Test complete</div><div id="realConsumed" class="miniVal">NO</div></div>
      <div class="miniBox"><div class="label">Live ability</div><div class="miniVal good">ARMED · AUTOMATIC</div><div class="miniSub">One trade · max $5</div></div>
    </div>
    <div class="notice">WAITING is a valid live state: the controller will act only on a qualifying ≥ .80 Baseline signal. Polymarket remains the independent source of truth for actual order/position activity.</div>
  </div>

  <details class="card section"><summary><b>Setup / Validation Proof</b> · completed evidence</summary>
    <div style="margin-top:8px">
      <div class="gate"><span>1. Secure API credentials</span><strong class="good">PASS</strong></div>
      <div class="gate"><span>2. Authenticated read-only account connection</span><strong id="gateAccount">CHECKING…</strong></div>
      <div class="gate"><span>3. Actual funded balance record</span><strong id="gateBalance">WAITING</strong></div>
      <div class="gate"><span>4. Shadow ledger + real market observation</span><strong id="gateShadow">CHECKING…</strong></div>
      <div class="gate"><span>5. Authenticated order preview without submission</span><strong id="gatePreview">CHECKING…</strong></div>
      <div class="gate"><span>6. First governed $10 account-funding proof</span><strong class="good">AUTHORIZED · DEPOSIT ONLY</strong></div>
    </div>
    <div class="notice">A displayed unfunded state is not withdrawal proof. Funding remains locked until the remaining execution, rules, settlement, recordkeeping, and cash-out gates are independently verified.</div>
  </details>

  <details class="card section"><summary><b>Money Path Proof</b> · funding / withdrawal evidence</summary>
    <div class="actions" style="justify-content:flex-start;margin-top:10px"><a class="btn" href="https://polymarket.us/" target="_blank" rel="noopener noreferrer" style="text-decoration:none">DEPOSIT $10 · OFFICIAL POLYMARKET US</a><a class="btn" href="https://polymarket.us/" target="_blank" rel="noopener noreferrer" style="text-decoration:none">WITHDRAW · OFFICIAL POLYMARKET US</a></div>
    <div class="rows" style="margin-top:8px">
      <div class="row"><span>Deposit activity</span><strong id="moneyDeposit">CHECKING…</strong></div>
      <div class="row"><span>Buying power available</span><strong id="moneyBuyingPower">CHECKING…</strong></div>
      <div class="row"><span>Funds clearing state</span><strong id="moneyClearing">CHECKING…</strong></div>
      <div class="row"><span>Funded balance</span><strong id="moneyBalance">CHECKING…</strong></div>
      <div class="row"><span>Withdrawal eligibility evidence</span><strong id="moneyEligible">CHECKING…</strong></div>
      <div class="row"><span>Withdrawal activity</span><strong id="moneyWithdrawal">CHECKING…</strong></div>
      <div class="row"><span>Cash-out loop</span><strong id="moneyLoop">CHECKING…</strong></div>
    </div>
    <div class="notice"><b>FIRST BANKROLL CONTROL:</b> $10 first account-funding proof, based on the verified minimum encountered in the Founder’s actual card funding path. This does not raise the Baseline trading rule: maximum stake remains $5. Debit card is the intended first funding method. Buying power is not the same as cleared/withdrawable funds. These controls hand money movement to the official Polymarket US site; Baseline Real never receives bank credentials or initiates deposits/withdrawals.</div>
    <div class="rows" style="margin-top:8px">
      <div class="row"><span>First account-funding proof</span><strong>$10</strong></div>
      <div class="row"><span>Maximum Baseline trade stake</span><strong>$5</strong></div>
      <div class="row"><span>Intended first funding method</span><strong>DEBIT CARD</strong></div>
      <div class="row"><span>Funding authorization</span><strong class="good">$10 · DEPOSIT PROOF ONLY</strong></div>
      <div class="row"><span>Live order submission</span><strong id="moneyLiveOrders">CHECKING…</strong></div>
    </div>
    </div>
    <div class="notice">A displayed unfunded state is not withdrawal proof. Funding remains locked until the remaining execution, rules, settlement, recordkeeping, and cash-out gates are independently verified.</div>
  </details>
  <div class="footer">NFE-OS · MARKET EDGE — BASELINE REAL · GOVERNED VALIDATION · ONE-TRADE TEST</div>
</div>
<script>
const E=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function load(){
  const conn=E('conn'),connSub=E('connSub'),bal=E('bal'),balSub=E('balSub'),creds=E('creds'),gateAccount=E('gateAccount'),gateBalance=E('gateBalance'),gatePreview=E('gatePreview'),markets=E('markets'),statusDot=E('statusDot'),statusText=E('statusText'),refresh=E('refresh');
  refresh.disabled=true;refresh.textContent='CHECKING…';gatePreview.textContent='CHECKING LIVE PROOF…';gatePreview.className='m';
  try{
    const [ar,sr,mr,pr,moneyr,shr,pxr,rtr]=await Promise.all([fetch('/account',{cache:'no-store'}),fetch('/status',{cache:'no-store'}),fetch('/markets',{cache:'no-store'}),fetch('/preview-proof',{cache:'no-store'}),fetch('/money-path-proof',{cache:'no-store'}),fetch('/shadow-state',{cache:'no-store'}),fetch('/price-proof',{cache:'no-store'}),fetch('/real-trade-state',{cache:'no-store'})]);
    const account=await ar.json(),status=await sr.json(),market=await mr.json(),preview=await pr.json(),money=await moneyr.json(),shadow=await shr.json(),prices=await pxr.json(),realTrade=await rtr.json();
    const shadowLive=shadow.status==='LIVE_US_SHADOW';
    const liveOrdersState=E('liveOrdersState'),liveOrdersSub=E('liveOrdersSub');
    if(realTrade?.armed){
      liveOrdersState.textContent='ONE-TRADE ARMED';liveOrdersState.className='val good';
      liveOrdersSub.textContent='Exactly one governed real trade may execute when Baseline score ≥ .80. Max stake $5. Then controller consumes itself.';
    }else{
      liveOrdersState.textContent='DISABLED';liveOrdersState.className='val warn';
      liveOrdersSub.textContent='One-trade execution controller is implemented but DISARMED.';
    }

    const armed=Boolean(realTrade?.armed);
    const modePill=E('modePill'),statusSub=E('statusSub'),executionGov=E('executionGov'),moneyLiveOrders=E('moneyLiveOrders');
    modePill.textContent=armed?'REAL · ONE-TRADE ARMED':'REAL · EXECUTION DISARMED';
    executionGov.textContent=armed?'ONE_TRADE_TEST · ARMED':'LOCKED / DISARMED';
    executionGov.className=armed?'good':'warn';
    moneyLiveOrders.textContent=armed?'ONE-TRADE ARMED':'DISABLED';
    moneyLiveOrders.className=armed?'good':'warn';
    E('realController').textContent=armed?'ARMED · ONE TRADE ONLY':'DISARMED';
    E('realController').className=armed?'good':'warn';
    E('realTradeStatus').textContent=realTrade?.status||'UNKNOWN';
    E('realTradeStatus').className=(realTrade?.status==='ONE_TRADE_COMPLETE')?'good':(armed?'good':'warn');
    E('realTradeMarket').textContent=realTrade?.question||realTrade?.marketSlug||'WAITING FOR ≥ .80 SIGNAL';
    E('realEntryOrder').textContent=realTrade?.entryOrderPresent?'SUBMITTED / PRESENT':'NOT SUBMITTED';
    E('realEntryOrder').className=realTrade?.entryOrderPresent?'good':'';
    E('realExitOrder').textContent=realTrade?.exitOrderPresent?'SUBMITTED / PRESENT':'NOT SUBMITTED';
    E('realExitOrder').className=realTrade?.exitOrderPresent?'good':'';
    E('realConsumed').textContent=realTrade?.consumed?'YES · COMPLETE':'NO';
    E('realConsumed').className=realTrade?.consumed?'good':'';
    if(armed){
      statusDot.className='dot good';
      statusText.innerHTML='<b>AUTHENTICATED · ONE-TRADE CONTROLLER ARMED</b>';
      statusSub.textContent='One governed real trade may execute automatically when the Baseline entry rule qualifies. No manual order is required.';
    }
    const moneyFmt=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
    const pctFmt=n=>(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%';
    const drawSpark=(id,points,change)=>{
      const svg=E(id); if(!svg) return;
      const vals=(Array.isArray(points)?points:[]).map(p=>Number(p.price)).filter(Number.isFinite);
      if(vals.length<2){svg.innerHTML='';return;}
      const lo=Math.min(...vals),hi=Math.max(...vals),span=(hi-lo)||1;
      const coords=vals.map((v,i)=>((i/(vals.length-1))*100).toFixed(2)+','+(28-((v-lo)/span)*26).toFixed(2)).join(' ');
      svg.className='spark '+(Number(change)>=0?'good':'bad');
      svg.innerHTML='<line class="base" x1="0" y1="28" x2="100" y2="28"></line><polyline points="'+coords+'"></polyline>';
    };
    if(prices?.ok){
      E('btcPrice').textContent=moneyFmt(prices.btc.current); E('btcChange').textContent=pctFmt(prices.btc.changePct); E('btcChange').className='marketChange '+(prices.btc.changePct>=0?'good':'bad'); drawSpark('btcChart',prices.btc.points,prices.btc.changePct);
      E('ethPrice').textContent=moneyFmt(prices.eth.current); E('ethChange').textContent=pctFmt(prices.eth.changePct); E('ethChange').className='marketChange '+(prices.eth.changePct>=0?'good':'bad'); drawSpark('ethChart',prices.eth.points,prices.eth.changePct);
    }else{
      E('btcPrice').textContent='UNAVAILABLE'; E('ethPrice').textContent='UNAVAILABLE';
    }
    E('shadowRuntime').textContent=shadow.status||'UNKNOWN';E('shadowRuntime').className=shadowLive?'good':'warn';
    E('shadowStarted').textContent=shadow.startedAt?new Date(shadow.startedAt).toLocaleString():'NOT STARTED';
    E('shadowLast').textContent=shadow.lastRunAt?new Date(shadow.lastRunAt).toLocaleString():'—';
    E('shadowRuns').textContent=String(shadow.runs||0);E('shadowEligible').textContent=String(shadow.eligibleCount||0);E('shadowPersistence').textContent=shadow.persistence||'—';
    E('shadowGov').textContent=shadowLive?'LIVE':'NOT STARTED';E('shadowGov').className=shadowLive?'good':'';
    E('gateShadow').textContent=shadowLive?'PASS · LIVE US SHADOW':'NOT STARTED';E('gateShadow').className=shadowLive?'good':'';
    E('moneyDeposit').textContent=money.depositActivity||'NOT PROVEN';E('moneyBuyingPower').textContent=money.buyingPower||'NOT PROVEN';E('moneyClearing').textContent=money.fundsClearing||'NOT PROVEN';E('moneyBalance').textContent=money.fundedBalance||'NOT PROVEN';E('moneyEligible').textContent=money.withdrawalEligibility||'NOT PROVEN';E('moneyWithdrawal').textContent=money.withdrawalActivity||'NOT PROVEN';E('moneyLoop').textContent=money.cashOutLoop||'NOT PROVEN';
    creds.textContent=status?.credentials?.keyIdInstalled&&status?.credentials?.secretInstalled?'INSTALLED':'MISSING';
    creds.className=creds.textContent==='INSTALLED'?'good':'bad';gatePreview.textContent=preview?.ok&&preview?.submitted===false?'PASS · NO SUBMISSION':((preview?.diagnostic?.category||preview?.state||'NOT PROVEN')+(preview?.diagnostic?.httpStatus?' · HTTP '+preview.diagnostic.httpStatus:'')+(!preview?.ok&&preview?.discovery?(' · SEARCH:'+String(preview.discovery.searchEvents??preview.discovery.eventsScanned??'?')+' CRYPTO:'+String(preview.discovery.cryptoEvents??'?')+' CAND:'+String(preview.discovery.candidates??'?')+(Array.isArray(preview.discovery.marketEvidence)&&preview.discovery.marketEvidence.length?' · BOOKS:'+preview.discovery.marketEvidence.map(x=>String(x.state||'?').replace('MARKET_STATE_','')+' B'+x.bids+' O'+x.offers).join(','):'') ):''));gatePreview.className=preview?.ok&&preview?.submitted===false?'good':'m';
    if(account.ok&&account.accountConnection==='VERIFIED'){
      conn.textContent='VERIFIED';conn.className='val good';connSub.textContent='Authenticated read-only Polymarket US API connection.';
      gateAccount.textContent='PASS';gateAccount.className='good';statusDot.className='dot';statusText.innerHTML='<b class="good">AUTHENTICATED READ-ONLY · VERIFIED</b>';
      const a=account.account||{};
      if(a.fundedRecordPresent){
        bal.textContent='$10.00';balSub.textContent='REAL EXPERIMENT BANKROLL · funded proof complete · provider account amounts remain private';gateBalance.textContent='AVAILABLE';gateBalance.className='good';
      }else if(a.noBalanceRecord){
        bal.textContent='$0.00*';balSub.textContent='No funded balance record returned. *Unfunded display only; not withdrawal proof.';gateBalance.textContent='NO FUNDED RECORD';gateBalance.className='m';
      }else{bal.textContent='NOT AVAILABLE';balSub.textContent='Authenticated, but balance response was not recognized.';}
    }else{
      conn.textContent='NOT VERIFIED';conn.className='val bad';connSub.textContent='Authenticated account proof is unavailable. See /account for safe diagnostic state.';gateAccount.textContent='FAILED';gateAccount.className='bad';bal.textContent='UNAVAILABLE';statusDot.className='dot bad';statusText.innerHTML='<b class="bad">ACCOUNT PROOF NOT VERIFIED</b>';
    }
    const opps=Array.isArray(shadow?.opportunities)?shadow.opportunities:[],parts=[];
    const cov=shadow?.assetCoverage||{};
    const coverageReady=Boolean(shadow?.assetCoverageReady);
    parts.push('<div class="opp" style="grid-column:1/-1"><div class="oppHead"><div class="q">LIVE ASSET COVERAGE</div><div class="tag '+(coverageReady?'good':'warn')+'">'+(coverageReady?'BTC + ETH PROVEN':'FIRST TRADE HOLD')+'</div></div><div class="meta">BTC: '+Number(cov?.BTC?.eligible||0)+' eligible · '+Number(cov?.BTC?.up||0)+' up · '+Number(cov?.BTC?.down||0)+' down &nbsp; | &nbsp; ETH: '+Number(cov?.ETH?.eligible||0)+' eligible · '+Number(cov?.ETH?.up||0)+' up · '+Number(cov?.ETH?.down||0)+' down'+(coverageReady?'':' · Controller will not submit the first real order until both assets are discovered live.')+'</div></div>');
    if(!opps.length){
      parts.push('<div class="opp"><div class="meta">No eligible BTC/ETH opportunities in the current Polymarket US Shadow observation.</div></div>');
    } else {
      for(const o of opps){
        const ask=Number(o.observedAsk),bid=Number(o.observedBid),score=Number(o.score),move=Number(o.move),edge=Number(o.edge);
        const qualifies=Number.isFinite(score)&&score>=0.80&&edge>0;
        const horizon=esc(o.horizon||'UNCLASSIFIED');
        parts.push('<div class="opp"><div class="oppHead"><div class="q">'+esc(o.question||o.slug||'US market')+'</div><div class="oppBadges"><div class="tag">'+horizon+'</div><div class="scoreBadge '+(qualifies?'hot':'')+'"><small>SCORE</small><strong>'+(Number.isFinite(score)?score.toFixed(2):'—')+'</strong></div><div class="tag">'+esc(o.asset||'')+' · '+(qualifies?'ENTRY ≥ .80':'OBSERVE')+'</div></div></div><div class="meta">'+
          (Number.isFinite(move)?('move '+(move*100).toFixed(3)+'% · '):'')+
          (Number.isFinite(ask)?('ASK '+(ask*100).toFixed(1)+'¢ · '):'')+
          (Number.isFinite(bid)?('BID '+(bid*100).toFixed(1)+'¢ · '):'')+
          (Number.isFinite(edge)?('edge '+(edge*100).toFixed(3)+'% · '):'')+
          'SHADOW ONLY</div></div>');
      }
    }
    markets.innerHTML=parts.join('');
  }catch{
    conn.textContent='CHECK FAILED';conn.className='val bad';connSub.textContent='Dashboard proof request failed; no secret details are displayed.';bal.textContent='UNAVAILABLE';statusDot.className='dot bad';statusText.innerHTML='<b class="bad">PROOF REFRESH FAILED</b>';markets.innerHTML='<div class="opp"><div class="meta">Market observation check failed.</div></div>';
  }finally{
    refresh.disabled=false;refresh.textContent='REFRESH PROOF · '+new Date().toLocaleTimeString();
  }
}
async function refreshPrices(){
  try{
    const r=await fetch('/price-proof',{cache:'no-store'}),prices=await r.json();
    if(!prices?.ok)return;
    const moneyFmt=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
    const pctFmt=n=>(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%';
    const drawSpark=(id,points,change)=>{const svg=E(id);if(!svg)return;const vals=(Array.isArray(points)?points:[]).map(p=>Number(p.price)).filter(Number.isFinite);if(vals.length<2){svg.innerHTML='';return;}const lo=Math.min(...vals),hi=Math.max(...vals),span=(hi-lo)||1;const coords=vals.map((v,i)=>((i/(vals.length-1))*100).toFixed(2)+','+(28-((v-lo)/span)*26).toFixed(2)).join(' ');svg.className='spark '+(Number(change)>=0?'good':'bad');svg.innerHTML='<line class="base" x1="0" y1="28" x2="100" y2="28"></line><polyline points="'+coords+'"></polyline>';};
    E('btcPrice').textContent=moneyFmt(prices.btc.current);E('btcChange').textContent=pctFmt(prices.btc.changePct);E('btcChange').className='marketChange '+(prices.btc.changePct>=0?'good':'bad');drawSpark('btcChart',prices.btc.points,prices.btc.changePct);
    E('ethPrice').textContent=moneyFmt(prices.eth.current);E('ethChange').textContent=pctFmt(prices.eth.changePct);E('ethChange').className='marketChange '+(prices.eth.changePct>=0?'good':'bad');drawSpark('ethChart',prices.eth.points,prices.eth.changePct);
  }catch{}
}
E('refresh').addEventListener('click',load);load();setInterval(refreshPrices,10000);
</script>
</body></html>`;
}
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await runShadow(env);
      // SAFETY HOLD: keep live one-trade submission unscheduled while short-horizon
      // Polymarket BTC/ETH market discovery is being validated.
    })());
  },

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

    // Temporary read-only Polymarket US catalogue proof for the requested
    // short-horizon BTC/ETH instrument check. No preview or order submission.
    if (url.pathname === "/crypto-short-horizon-proof") {
      const client = new PolymarketUS();
      const found = [];
      let offset = 0, pages = 0, totalEvents = 0, reachedEnd = false;
      while (pages < 50) {
        let result;
        try { result = await client.events.list({ active: true, limit: 100, offset }); }
        catch { return json({ok:false,state:"EVENT_CATALOGUE_READ_FAILED",pages,totalEvents,submitted:false}); }
        const events = Array.isArray(result?.events) ? result.events : [];
        for (const event of events) {
          totalEvents++;
          const markets = Array.isArray(event?.markets) && event.markets.length ? event.markets : [null];
          for (const market of markets) {
            const text=[event?.title,event?.slug,event?.description,market?.title,market?.slug,market?.outcome].filter(Boolean).join(" — ");
            const asset=/bitcoin|\bbtc\b/i.test(text)?"BTC":/ethereum|\beth\b|\bether\b/i.test(text)?"ETH":null;
            if(!asset) continue;
            const is15=/15\s*(?:min|minute)|15m\b|quarter[- ]?hour/i.test(text);
            const intraday=is15||/\b(?:5|10|30|45|60)\s*(?:min|minute)|hourly|this hour|today|daily|intraday/i.test(text);
            if(intraday) found.push({asset,is15,eventTitle:event?.title||null,eventSlug:event?.slug||null,marketTitle:market?.title||null,marketSlug:market?.slug||null});
          }
        }
        pages++;
        if(events.length<100){reachedEnd=true;break;}
        offset+=events.length;
      }
      const rows=[...new Map(found.map(x=>[(x.marketSlug||x.eventSlug||JSON.stringify(x)),x])).values()];
      return json({ok:true,source:"POLYMARKET_US_EVENTS_LIST",pages,totalEvents,reachedEnd,btc15m:rows.filter(x=>x.asset==="BTC"&&x.is15).length,eth15m:rows.filter(x=>x.asset==="ETH"&&x.is15).length,btcIntraday:rows.filter(x=>x.asset==="BTC").length,ethIntraday:rows.filter(x=>x.asset==="ETH").length,matches:rows.slice(0,50),submitted:false,liveOrderSubmission:"DISABLED"});
    }

    // Read-only Polymarket US short-horizon catalogue diagnostic.
    // This scans the official US event catalogue directly so fuzzy search cannot
    // hide BTC/ETH markets. It never previews or submits an order.
    if (url.pathname === "/crypto-short-horizon-proof") {
      const client = new PolymarketUS();
      const matches = [];
      let offset = 0, pages = 0, totalEvents = 0, reachedEnd = false;
      while (pages < 60) {
        let result;
        try {
          result = await client.events.list({ active: true, limit: 100, offset });
        } catch {
          return json({ok:false,state:"POLYMARKET_US_EVENT_SCAN_FAILED",pages,totalEvents,matches:matches.slice(0,40),submitted:false});
        }
        const events = Array.isArray(result?.events) ? result.events
          : Array.isArray(result?.data?.events) ? result.data.events
          : Array.isArray(result?.data) ? result.data
          : Array.isArray(result) ? result : [];
        for (const event of events) {
          totalEvents += 1;
          const markets = Array.isArray(event?.markets) ? event.markets : [];
          const rows = markets.length ? markets : [null];
          for (const market of rows) {
            const text = [event?.title,event?.question,event?.slug,event?.description,market?.title,market?.question,market?.slug,market?.description].filter(Boolean).join(" — ");
            const asset = /bitcoin|\bbtc\b/i.test(text) ? "BTC" : /ethereum|\beth\b|\bether\b/i.test(text) ? "ETH" : null;
            if (!asset) continue;
            const short = /15\s*(?:min|minute)|quarter[- ]?hour|15m\b/i.test(text);
            const intraday = short || /\b(?:5|10|30|45|60)\s*(?:min|minute)|hourly|this hour|today|daily|intraday/i.test(text);
            if (!intraday) continue;
            matches.push({
              asset,
              short15m: short,
              eventTitle:event?.title||event?.question||null,
              eventSlug:event?.slug||null,
              marketTitle:market?.title||market?.question||null,
              marketSlug:market?.slug||null,
              active:market?.active??event?.active??null,
              closed:market?.closed??event?.closed??null
            });
          }
        }
        pages += 1;
        if (events.length < 100) { reachedEnd = true; break; }
        offset += events.length;
      }
      const dedup=[...new Map(matches.map(x=>[(x.marketSlug||x.eventSlug||JSON.stringify(x)),x])).values()];
      return json({
        ok:true,source:"POLYMARKET_US_EVENTS_LIST",pages,totalEvents,reachedEnd,
        btc15m:dedup.filter(x=>x.asset==="BTC"&&x.short15m).length,
        eth15m:dedup.filter(x=>x.asset==="ETH"&&x.short15m).length,
        btcIntraday:dedup.filter(x=>x.asset==="BTC").length,
        ethIntraday:dedup.filter(x=>x.asset==="ETH").length,
        matches:dedup.slice(0,40),submitted:false,liveOrderSubmission:"DISABLED"
      });
    }

    if (url.pathname === "/price-proof") return json(await livePriceProof(env));

    if (url.pathname === "/money-path-proof") return json(await moneyPathProof(env));

    if (url.pathname === "/preview-proof") {
      const proof = await previewProof(env);
      return json(proof, proof.ok ? 200 : 422);
    }

    if (url.pathname === "/market-diagnostic") {
      const proof = await previewProof(env);
      return json({ok:proof.ok,state:proof.state,diagnostic:proof.diagnostic||null,discovery:proof.discovery||null,submitted:false,sensitiveTextExposed:false}, 200);
    }

    if (url.pathname === "/shadow-state") {
      return json(publicShadowView(await loadShadowState(env)));
    }

    // Read-only diagnostic trigger. It refreshes Shadow evidence only and never
    // invokes maybeRunOneTrade or any provider order endpoint.
    if (url.pathname === "/shadow-refresh-proof") {
      const refreshed = await runShadow(env);
      return json(publicShadowView(refreshed));
    }

    // Public, read-only diagnostic view: exposes only bounded failure stage/code.
    // No credentials, provider payloads, order calls, or secret text are returned.
    if (url.pathname === "/shadow-diagnostic") {
      const state = await loadShadowState(env);
      return json({
        ok: state?.status !== "ERROR",
        status: state?.status || "UNKNOWN",
        lastRunAt: state?.lastRunAt || null,
        errorStage: state?.errorStage || null,
        errorCode: state?.errorCode || null,
        eligibleCount: Number(state?.eligibleCount || 0),
        seenCount: Number(state?.seenCount || 0),
        rejectedCount: Number(state?.rejectedCount || 0),
        liveOrderSubmission: "DISABLED",
        realMoneyMoved: false
      });
    }

    if (url.pathname === "/real-trade-state") {
      return json(publicRealTradeView(await loadRealTradeState(env), env));
    }

    if (url.pathname === "/shadow-run") {
      return json(publicShadowView(await runShadow(env)));
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
