// CLOUDFLARE DEPLOYMENT MARKER 2026-09-20: XRP recovery V2 proof route ce2252b / 7637a6f
import { PolymarketUS } from "polymarket-us";
// SHARD_ROUTING_DEPLOYMENT_MARKER_2026_09_20
// SHARD_ALLOCATION_DEPLOYMENT_MARKER_2026_09_20

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
    marketScope: env.MARKET_SCOPE || "BTC_ETH_SOL_XRP_HYPE",
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
    marketScope: "BTC_ETH_SOL_XRP_HYPE",
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

const ASSET_PRICE_META={
  BTC:{coinbase:"BTC-USD",coingecko:"bitcoin"},
  ETH:{coinbase:"ETH-USD",coingecko:"ethereum"},
  SOL:{coinbase:"SOL-USD",coingecko:"solana"},
  XRP:{coinbase:"XRP-USD",coingecko:"ripple"},
  HYPE:{coinbase:"HYPE-USD",coingecko:"hyperliquid"}
};
async function assetSpot(asset) {
  const meta=ASSET_PRICE_META[asset];
  if(!meta) throw new Error("UNSUPPORTED_ASSET");
  try { return {price:await coinbaseSpot(meta.coinbase),source:"COINBASE"}; } catch {}
  const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids="+encodeURIComponent(meta.coingecko)+"&vs_currencies=usd",{headers:{accept:"application/json"}});
  if(!r.ok) throw new Error("PUBLIC_SPOT_READ_FAILED_"+r.status);
  const data=await r.json(), price=Number(data?.[meta.coingecko]?.usd);
  if(!Number.isFinite(price)||price<=0) throw new Error("PUBLIC_SPOT_PRICE_INVALID");
  return {price,source:"COINGECKO_FALLBACK"};
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
  const assets=["BTC","ETH","SOL","XRP","HYPE"];
  const shadow=await loadShadowState(env);
  const make=async asset=>{
    const product=ASSET_PRICE_META[asset]?.coinbase||asset+"-USD";
    try {
      const [current,statsRes,candlesRes]=await Promise.all([
        coinbaseSpot(product),
        fetch("https://api.exchange.coinbase.com/products/"+product+"/stats",{headers:{accept:"application/json"}}),
        fetch("https://api.exchange.coinbase.com/products/"+product+"/candles?granularity=3600",{headers:{accept:"application/json"}})
      ]);
      if(!statsRes.ok||!candlesRes.ok) throw new Error("COINBASE_TREND_UNAVAILABLE");
      const [stats,candles]=await Promise.all([statsRes.json(),candlesRes.json()]);
      const open=Number(stats?.open),last=Number(stats?.last);
      const points=(Array.isArray(candles)?candles:[]).filter(x=>Array.isArray(x)&&Number.isFinite(Number(x[0]))&&Number.isFinite(Number(x[4]))).sort((a,b)=>Number(a[0])-Number(b[0])).slice(-24).map(x=>({ts:Number(x[0])*1000,price:Number(x[4])}));
      const changePct=Number.isFinite(open)&&open>0&&Number.isFinite(last)?((last-open)/open)*100:0;
      const fullCandles=(Array.isArray(candles)?candles:[]).filter(x=>Array.isArray(x)&&x.length>=5&&[0,1,2,3,4].every(i=>Number.isFinite(Number(x[i])))).sort((a,b)=>Number(a[0])-Number(b[0])).map(x=>({ts:Number(x[0])*1000,low:Number(x[1]),high:Number(x[2]),open:Number(x[3]),close:Number(x[4])}));
      return {product,current,changePct,points,candles:fullCandles,source:"COINBASE_EXCHANGE_HISTORY",window:"AVAILABLE_HOURLY"};
    } catch {
      try {
        const x=await assetSpot(asset);
        const current=Number(x.price);
        const prior=Number(shadow?.prices?.[asset]);
        const changePct=Number.isFinite(prior)&&prior>0?((current-prior)/prior)*100:0;
        const points=Number.isFinite(prior)&&prior>0?[{ts:Date.now()-60000,price:prior},{ts:Date.now(),price:current}]:[];
        return {product,current,changePct,points,source:x.source,window:"LIVE_FALLBACK"};
      } catch { return {product,current:null,changePct:null,points:[],source:"UNAVAILABLE",window:"UNAVAILABLE"}; }
    }
  };
  const values=await Promise.all(assets.map(make));
  return {ok:values.some(x=>Number.isFinite(Number(x.current))),window:"MIXED",...Object.fromEntries(assets.map((a,i)=>[a.toLowerCase(),values[i]])),note:"Per-asset live display; Coinbase is preferred and public fallback is used where Coinbase lacks a product."};
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
  // Exact frozen Paper Baseline scoring formula; only the venue/price source is adapted to Kalshi.
  const move = moves[market.asset] || 0;
  const directionalMove = market.bear ? -move : move;
  const fair = clamp(market.yes + directionalMove * 18, 0.02, 0.98);
  const edge = fair - market.yes;
  const score = clamp(0.5 + edge * 4, 0, 1);
  return { ...market, move, fair, edge, score };
}

async function loadShadowState(env) {
  // Edge cache is POP-local, while the scheduler can run in a different POP.
  // Compare the local cache with the globally visible scheduler snapshot and use
  // whichever successful observation is newer. Browser refresh never creates data.
  let edgeState=null, scheduledState=null;
  const cache = caches.default;
  const hit = await cache.match(shadowCacheRequest());
  if (hit) {
    try {
      const parsed = await hit.json();
      if (parsed && typeof parsed === "object") edgeState=parsed;
    } catch {}
  }
  if (env?.BASELINE_REAL_SHADOW_STATE) {
    try {
      const raw=await env.BASELINE_REAL_SHADOW_STATE.get(SCHEDULER_PROOF_KEY);
      if(raw){
        const proof=JSON.parse(raw);
        if(proof?.shadowSnapshot && typeof proof.shadowSnapshot==="object"){
          scheduledState={...proof.shadowSnapshot,persistence:"SCHEDULER_KV_SNAPSHOT"};
        }
      }
    } catch {}
  }
  if(edgeState||scheduledState){
    const edgeTs=Date.parse(edgeState?.lastRunAt||"")||0;
    const scheduledTs=Date.parse(scheduledState?.lastRunAt||"")||0;
    return scheduledTs>edgeTs ? scheduledState : edgeState;
  }
  if (env?.BASELINE_REAL_SHADOW_STATE) {
    try {
      const raw = await env.BASELINE_REAL_SHADOW_STATE.get("baseline-real-shadow-v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          parsed.persistence = "LEGACY_KV_MIGRATION_FALLBACK";
          return parsed;
        }
      }
    } catch {}
  }
  return {
    mode: "REAL_KALSHI_SHADOW",
    startedAt: null,
    lastRunAt: null,
    prices: { BTC: null, ETH: null, SOL: null, XRP: null, HYPE: null },
    moves: { BTC: 0, ETH: 0, SOL: 0, XRP: 0, HYPE: 0 },
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
  // High-frequency observation snapshots belong in edge cache. KV is reserved for
  // governed one-trade state/evidence so the 5-minute observer cannot exhaust KV writes.
  await caches.default.put(
    shadowCacheRequest(),
    new Response(JSON.stringify({ ...state, persistence: "EDGE_CACHE" }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=31536000",
      },
    })
  );
  state.persistence = "EDGE_CACHE";
}

function shadowLedger(state, type, payload = {}) {
  state.ledger.unshift({ ts: new Date().toISOString(), type, ...payload });
  state.ledger = state.ledger.slice(0, SHADOW_CONFIG.maxLedger);
}

async function kalshiShadowHeaders(env, method, path) {
  if (!env?.KALSHI_KEY_ID || !env?.KALSHI_PRIVATE_KEY) throw new Error("KALSHI_CREDENTIALS_NOT_INSTALLED");
  const body=String(env.KALSHI_PRIVATE_KEY).replace(/-----BEGIN [^-]+-----/g,"").replace(/-----END [^-]+-----/g,"").replace(/\s+/g,"");
  const raw=atob(body); const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  const key=await crypto.subtle.importKey("pkcs8",bytes.buffer,{name:"RSA-PSS",hash:"SHA-256"},false,["sign"]);
  const ts=String(Date.now()), signPath=path.split("?")[0];
  const sig=await crypto.subtle.sign({name:"RSA-PSS",saltLength:32},key,new TextEncoder().encode(ts+method.toUpperCase()+signPath));
  let binary=""; for(const x of new Uint8Array(sig)) binary+=String.fromCharCode(x);
  return {accept:"application/json","KALSHI-ACCESS-KEY":String(env.KALSHI_KEY_ID).trim(),"KALSHI-ACCESS-TIMESTAMP":ts,"KALSHI-ACCESS-SIGNATURE":btoa(binary)};
}
async function kalshiShadowGet(env,path) {
  let last=null;
  for(let attempt=0;attempt<2;attempt++){
    const headers=await kalshiShadowHeaders(env,"GET",path);
    try{
      const r=await fetch("https://external-api.kalshi.com"+path,{method:"GET",headers});
      last=r;
      if(r.ok || ![429,500,502,503,504].includes(r.status)) return r;
    }catch(error){
      if(attempt===1) throw error;
    }
    if(attempt===0) await new Promise(resolve=>setTimeout(resolve,350));
  }
  return last;
}

function derLengthBytes(n) {
  if(n<128) return [n];
  const out=[]; let x=n;
  while(x>0){out.unshift(x&255);x>>>=8;}
  return [128|out.length,...out];
}
function derWrap(tag,bytes) {
  const b=Array.from(bytes);
  return new Uint8Array([tag,...derLengthBytes(b.length),...b]);
}
function rsaPkcs1ToPkcs8(pkcs1) {
  const version=new Uint8Array([0x02,0x01,0x00]);
  const rsaAlgId=new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  const octet=derWrap(0x04,pkcs1);
  const inner=new Uint8Array(version.length+rsaAlgId.length+octet.length);
  inner.set(version,0); inner.set(rsaAlgId,version.length); inner.set(octet,version.length+rsaAlgId.length);
  return derWrap(0x30,inner);
}
async function kalshiExecutionHeaders(env, method, path) {
  if (!env?.KALSHI_EXECUTION_KEY_ID || !env?.KALSHI_EXECUTION_PRIVATE_KEY) throw new Error("KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED");
  const pem=String(env.KALSHI_EXECUTION_PRIVATE_KEY).trim();
  const isPkcs1=/-----BEGIN RSA PRIVATE KEY-----/.test(pem);
  const body=pem.replace(/-----BEGIN [^-]+-----/g,"").replace(/-----END [^-]+-----/g,"").replace(/\s+/g,"");
  const raw=atob(body); let bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  if(isPkcs1) bytes=rsaPkcs1ToPkcs8(bytes);
  const key=await crypto.subtle.importKey("pkcs8",bytes.buffer,{name:"RSA-PSS",hash:"SHA-256"},false,["sign"]);
  const ts=String(Date.now()), signPath=path.split("?")[0];
  const sig=await crypto.subtle.sign({name:"RSA-PSS",saltLength:32},key,new TextEncoder().encode(ts+method.toUpperCase()+signPath));
  let binary=""; for(const x of new Uint8Array(sig)) binary+=String.fromCharCode(x);
  return {accept:"application/json","KALSHI-ACCESS-KEY":String(env.KALSHI_EXECUTION_KEY_ID).trim(),"KALSHI-ACCESS-TIMESTAMP":ts,"KALSHI-ACCESS-SIGNATURE":btoa(binary)};
}
async function kalshiExecutionGet(env,path) {
  const headers=await kalshiExecutionHeaders(env,"GET",path);
  return fetch("https://external-api.kalshi.com"+path,{method:"GET",headers});
}

// Cold-path execution readiness: perform the slow authenticated balance read in parallel
// with market discovery. This does NOT weaken or bypass any gate; the controller still
// validates the candidate-specific shard and required debit from this same-cycle snapshot.
async function kalshiExecutionBalanceSnapshot(env) {
  const startedAt=Date.now();
  let lastStatus=null,lastBody=null,lastError=null,attempts=0;
  for(const delayMs of [0,350,800]){
    if(delayMs) await new Promise(resolve=>setTimeout(resolve,delayMs));
    attempts++;
    try {
      const response=await kalshiExecutionGet(env,"/trade-api/v2/portfolio/balance");
      const body=await response.json().catch(()=>({}));
      lastStatus=response.status; lastBody=body;
      if(response.ok) return {
        ok:true,httpStatus:response.status,body,
        checkedAt:new Date().toISOString(),latencyMs:Date.now()-startedAt,attempts
      };
      // Auth/permission/not-found style failures are not transient; fail closed immediately.
      if(![429,500,502,503,504].includes(response.status)) break;
    } catch(error) {
      lastError=String(error?.message||error||"EXECUTION_BALANCE_PREFLIGHT_FAILED").slice(0,160);
    }
  }
  return {
    ok:false,httpStatus:lastStatus,body:lastBody,checkedAt:new Date().toISOString(),
    latencyMs:Date.now()-startedAt,attempts,error:lastError
  };
}

async function reconcileCompletedKalshiProof(env,state) {
  if(!(Number(state?.filledCount)>0) || !(Number(state?.exitFilledTotal)>0)) return state;
  const proof=await kalshiExecutionBalanceSnapshot(env);
  if(!proof?.ok || !proof?.body) return state;
  const rawCents=Number(proof.body?.balance);
  const providerBalanceUsd=Number.isFinite(rawCents)?Number((rawCents/100).toFixed(2)):null;
  const post=state?.firstRealTradeEvidence?.postTradeOutcomeEvidence||{};
  const entry=safeFinite(post?.entry?.actualFillPrice), exit=safeFinite(post?.exit?.averageFillPrice);
  const qty=safeFinite(post?.exit?.filledCount??post?.entry?.quantity);
  const entryFee=safeFinite(post?.entry?.entryFeeUsd)||0, exitFee=safeFinite(post?.exit?.exitFeeUsd)||0;
  const gross=(entry!==null&&exit!==null&&qty!==null)?Number(((exit-entry)*qty).toFixed(4)):null;
  const executionNet=gross===null?null:Number((gross-entryFee-exitFee).toFixed(4));
  const bankrollNet=providerBalanceUsd===null?null:Number((providerBalanceUsd-REAL_TEST_CONFIG.initialBankrollUsd).toFixed(2));
  state.firstRealTradeEvidence=state.firstRealTradeEvidence||{};
  state.firstRealTradeEvidence.postTradeOutcomeEvidence={...post,
    realizedPnlUsd:executionNet,resultingCashBalanceUsd:providerBalanceUsd,
    bankrollNetChangeUsd:bankrollNet,providerBalanceRawCents:Number.isFinite(rawCents)?rawCents:null,
    accountingStatus:providerBalanceUsd!==null?"RECONCILED_FROM_KALSHI":"BALANCE_UNAVAILABLE",
    reconciledAt:new Date().toISOString()
  };
  state.firstRealTradeEvidence.postTradeResearchReview=buildPostTradeResearchReview(state);
  state.reconciledAccountBalanceUsd=providerBalanceUsd;
  state.reconciledBankrollPnlUsd=bankrollNet;
  state.reconciledAt=Date.now();
  if(providerBalanceUsd!==null && !state?.ledger?.some(x=>x?.type==="POST_TRADE_BALANCE_RECONCILED"))
    realTradeLedger(state,"POST_TRADE_BALANCE_RECONCILED",{resultingCashBalanceUsd:providerBalanceUsd,bankrollNetChangeUsd:bankrollNet,executionNetPnlUsd:executionNet});
  await saveRealTradeState(env,state);
  return state;
}

async function kalshiApprovedShardTransfer(env,payload) {
  const path="/trade-api/v2/portfolio/intra_exchange_instance_transfer";
  const headers=await kalshiExecutionHeaders(env,"POST",path);
  headers["content-type"]="application/json";
  return fetch("https://external-api.kalshi.com"+path,{method:"POST",headers,body:JSON.stringify(payload)});
}

function kalshiControllerSwitchEnabled(env) {
  return env?.KALSHI_ONE_TRADE_CONTROLLER_ENABLED === "ENABLED";
}
function kalshiAuthorizationValid(state, now=Date.now()) {
  // Founder authorization is for exactly one governed entry, not a short time window.
  // It remains valid while waiting for the frozen >= .80 signal and is permanently
  // consumed before the first provider entry write.
  return Boolean(state?.founderAuthorization?.authorized === true &&
    !state?.founderAuthorization?.consumed &&
    state?.founderAuthorization?.scope === "ONE_TRADE_MAX_5_USD");
}
function kalshiOneTradeEnabled(env, state=null) {
  return kalshiControllerSwitchEnabled(env) && kalshiAuthorizationValid(state);
}
function kalshiGateMatrixProof() {
  const future=Date.now()+15*60*1000;
  const auth={founderAuthorization:{authorized:true,consumed:false,expiresAt:future}};
  const noAuth={founderAuthorization:{authorized:false,consumed:false,expiresAt:future}};
  return {
    switchOff_authorizationAbsent:false,
    switchOff_authorizationPresent:false,
    switchOn_authorizationAbsent:false,
    switchOn_authorizationPresent:true,
    invariant:"PROVIDER_WRITE_REQUIRES_SWITCH_AND_UNEXPIRED_FOUNDER_AUTHORIZATION"
  };
}
async function kalshiExecutionWrite(env, state, method, path, payload) {
  if (!kalshiOneTradeEnabled(env,state)) throw new Error("KALSHI_ONE_TRADE_CONTROLLER_HARD_DISABLED");
  const headers=await kalshiExecutionHeaders(env,method,path);
  headers["content-type"]="application/json";
  return fetch("https://external-api.kalshi.com"+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
}
async function kalshiCreateOrderV2(env,state,payload) {
  return kalshiExecutionWrite(env,state,"POST","/trade-api/v2/portfolio/events/orders",payload);
}
async function kalshiCreateManagedExitV2(env,state,payload) {
  const ticker=String(state?.marketTicker||"");
  const filled=Number(state?.filledCount||0);
  const alreadyExited=Number(state?.exitFilledTotal||0);
  const remaining=Math.max(0,filled-alreadyExited);
  const requested=Number(payload?.count||0);
  if(!ticker || !(filled>0) || !(remaining>0)) throw new Error("MANAGED_EXIT_POSITION_INVALID");
  if(payload?.reduce_only!==true || String(payload?.ticker||"")!==ticker) throw new Error("MANAGED_EXIT_SCOPE_INVALID");
  if(!(requested>0) || requested>remaining+1e-9) throw new Error("MANAGED_EXIT_COUNT_INVALID");
  const headers=await kalshiExecutionHeaders(env,"POST","/trade-api/v2/portfolio/events/orders");
  headers["content-type"]="application/json";
  return fetch("https://external-api.kalshi.com/trade-api/v2/portfolio/events/orders",{
    method:"POST",headers,body:JSON.stringify(payload)
  });
}
async function kalshiCancelOrderV2(env,state,orderId) {
  return kalshiExecutionWrite(env,state,"DELETE","/trade-api/v2/portfolio/events/orders/"+encodeURIComponent(orderId));
}

async function kalshiGetOrderV2(env,orderId) {
  return kalshiExecutionGet(env,"/trade-api/v2/portfolio/orders/"+encodeURIComponent(orderId));
}
async function kalshiGetFillsV2(env,orderId) {
  return kalshiExecutionGet(env,"/trade-api/v2/portfolio/fills?order_id="+encodeURIComponent(orderId)+"&limit=100");
}
function kalshiV2BookSide(outcomeSide) {
  return String(outcomeSide||"").toUpperCase()==="YES" ? "bid" :
         String(outcomeSide||"").toUpperCase()==="NO" ? "ask" : null;
}
function kalshiV2EntryPayload(candidate,sizing,clientOrderId) {
  const side=kalshiV2BookSide(candidate?.outcomeSide);
  if(!side) return null;
  // V2 uses one YES-leg price scale. YES long = bid at yes ask.
  // NO long = ask YES, economically buying NO at (1 - yes price).
  const yesLegPrice=side==="bid" ? Number(candidate?.yes) : Number(1-Number(candidate?.yes));
  if(!Number.isFinite(yesLegPrice)||yesLegPrice<=0||yesLegPrice>=1) return null;
  return {
    ticker:String(candidate.marketTicker),
    client_order_id:String(clientOrderId),
    side,
    count:Number(sizing.count).toFixed(2),
    price:yesLegPrice.toFixed(4),
    time_in_force:"immediate_or_cancel",
    self_trade_prevention_type:"taker_at_cross",
    post_only:false,
    cancel_order_on_pause:true,
    reduce_only:false,
    // exchange_index intentionally omitted: API2 auto-routes using ticker; shard balance is still preflighted.
  };
}
function kalshiV2ExitPayload(state,currentBid,clientOrderId) {
  const entrySide=kalshiV2BookSide(state?.outcomeSide);
  if(!entrySide) return null;
  // Closing reverses the single-book side and is reduce-only so it cannot grow/reverse exposure.
  const side=entrySide==="bid" ? "ask" : "bid";
  const outcomeBid=Number(currentBid);
  const yesLegPrice=String(state?.outcomeSide).toUpperCase()==="YES" ? outcomeBid : 1-outcomeBid;
  if(!Number.isFinite(yesLegPrice)||yesLegPrice<=0||yesLegPrice>=1) return null;
  return {
    ticker:String(state.marketTicker),
    client_order_id:String(clientOrderId),
    side,
    count:Number(state.remainingExitCount||state.filledCount||state.entryCount||0).toFixed(2),
    price:yesLegPrice.toFixed(4),
    time_in_force:"immediate_or_cancel",
    self_trade_prevention_type:"taker_at_cross",
    post_only:false,
    cancel_order_on_pause:true,
    reduce_only:true,
    // exchange_index intentionally omitted on exit: API2 auto-routes using ticker.
  };
}
function kalshiExecutionProofEntryPayload(candidate,clientOrderId) {
  const side=kalshiV2BookSide(candidate?.outcomeSide);
  if(!side) return null;
  // One-contract plumbing proof: deliberately marketable IOC while bounding worst-case
  // premium + estimated taker fee to $1.00. YES uses 0.99 bid; NO uses 0.01 YES ask.
  return {
    ticker:String(candidate.marketTicker),
    client_order_id:String(clientOrderId),
    side,
    count:"1.00",
    price:side==="bid"?"0.9900":"0.0100",
    time_in_force:"immediate_or_cancel",
    self_trade_prevention_type:"taker_at_cross",
    post_only:false,
    cancel_order_on_pause:true,
    reduce_only:false
  };
}
function kalshiExecutionProofExitPayload(state,clientOrderId) {
  const entrySide=kalshiV2BookSide(state?.outcomeSide);
  if(!entrySide) return null;
  // Immediate reduce-only close of exactly the filled proof quantity. Reverse the book side
  // and cross aggressively so the acceptance test does not wait on the strategy exit logic.
  const side=entrySide==="bid"?"ask":"bid";
  return {
    ticker:String(state.marketTicker),
    client_order_id:String(clientOrderId),
    side,
    count:Number(state.remainingExitCount||state.filledCount||0).toFixed(2),
    price:side==="bid"?"0.9900":"0.0100",
    time_in_force:"immediate_or_cancel",
    self_trade_prevention_type:"taker_at_cross",
    post_only:false,
    cancel_order_on_pause:true,
    reduce_only:true
  };
}
function summarizeKalshiV2CreateResponse(x) {
  return {
    orderId:x?.order_id||null,
    clientOrderId:x?.client_order_id||null,
    fillCount:Number(x?.fill_count||0),
    remainingCount:Number(x?.remaining_count||0),
    averageFillPrice:x?.average_fill_price??null,
    averageFeePaid:x?.average_fee_paid??null
  };
}

function kalshiGeneralTakerFeeUsd(price,count,multiplier=1) {
  const p=Number(price), n=Number(count), m=Number(multiplier);
  if(!Number.isFinite(p)||p<=0||p>=1||!Number.isFinite(n)||n<=0||!Number.isFinite(m)||m<0) return null;
  const raw=m*0.07*n*p*(1-p);
  // Conservative implementation: always round upward to the next cent.
  return Math.ceil((raw-1e-12)*100)/100;
}
function estimateKalshiFeeSafeSize(price, maxStakeUsd) {
  const p=Number(price), cap=Number(maxStakeUsd);
  if(!Number.isFinite(p)||p<=0||p>=1||!Number.isFinite(cap)||cap<=0) return {ok:false,reason:"INVALID_PRICE_OR_CAP",count:0,executionAllowed:false};
  for(let count=Math.floor(cap/p);count>=1;count--){
    const premium=Number((count*p).toFixed(4));
    const fee=kalshiGeneralTakerFeeUsd(p,count,1);
    const total=Number((premium+fee).toFixed(4));
    if(fee!==null && total<=cap) return {
      ok:true,
      reason:"GENERAL_TAKER_FEE_VERIFIED_AND_WITHIN_CAP",
      scheduleEffective:"2026-07-07",
      feeFormula:"ceil_to_cent(1 * 0.07 * C * P * (1-P))",
      multiplier:1,
      count,
      premiumUsd:premium,
      feeUsd:fee,
      totalDebitUsd:total,
      maxStakeUsd:cap,
      executionAllowed:false,
      note:"Sizing is fee-safe; execution remains separately hard-disabled."
    };
  }
  return {ok:false,reason:"NO_CONTRACT_FITS_PREMIUM_PLUS_FEE_CAP",count:0,premiumUsd:0,feeUsd:0,totalDebitUsd:0,maxStakeUsd:cap,executionAllowed:false};
}
async function discoverKalshi15mSeriesFromOpenMarkets(env, wantedAssets) {
  const aliases={BTC:["BTC","BITCOIN"],ETH:["ETH","ETHEREUM"],SOL:["SOL","SOLANA"],XRP:["XRP","RIPPLE"],HYPE:["HYPE","HYPERLIQUID"]};
  const found={}, evidence=Object.fromEntries(wantedAssets.map(a=>[a,{textMatches:0,durationMatches:0,seriesTickers:[]}]));
  let cursor="", pages=0, scanned=0, reachedEnd=false, readError=null;
  // Exhaust the provider cursor (bounded only by a high safety ceiling) so "not found"
  // means the catalogue was actually traversed rather than only the first 2,400 rows.
  while(pages<100) {
    const path="/trade-api/v2/markets?status=open&limit=200"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
    let r; try{r=await kalshiShadowGet(env,path);}catch{readError="NETWORK_OR_SIGNING_READ_FAILED";break;}
    if(!r.ok){readError="MARKETS_READ_FAILED_"+r.status;break;}
    const data=await r.json();
    const markets=Array.isArray(data?.markets)?data.markets:[];
    scanned+=markets.length;
    for(const m of markets){
      const title=String(m?.title||"").toUpperCase(), subtitle=String(m?.subtitle||"").toUpperCase();
      const ticker=String(m?.ticker||"").toUpperCase(), seriesTicker=String(m?.series_ticker||m?.seriesTicker||"").toUpperCase();
      const text=title+" "+subtitle+" "+ticker+" "+seriesTicker;
      const open=Date.parse(m?.open_time||""), close=Date.parse(m?.close_time||"");
      const duration=Number.isFinite(open)&&Number.isFinite(close)?close-open:null;
      const durationMatch=duration!==null&&duration>=10*60*1000&&duration<=20*60*1000;
      const shortText=/15\s*(MIN|MINUTE)|15M/.test(text);
      for(const asset of wantedAssets){
        const assetMatch=(aliases[asset]||[asset]).some(alias=>new RegExp("(^|[^A-Z])"+alias+"([^A-Z]|$)").test(text));
        if(!assetMatch) continue;
        evidence[asset].textMatches++;
        if(durationMatch||shortText) evidence[asset].durationMatches++;
        if(seriesTicker&&!evidence[asset].seriesTickers.includes(seriesTicker)&&evidence[asset].seriesTickers.length<8) evidence[asset].seriesTickers.push(seriesTicker);
        if(!found[asset]&&(durationMatch||shortText)&&seriesTicker){
          found[asset]={ticker:seriesTicker,title:m?.title||"",frequency:"15m",settlementSources:[],dynamicallyResolved:true,discoveredFrom:"OPEN_MARKET_CATALOGUE"};
        }
      }
    }
    cursor=String(data?.cursor||""); pages++;
    if(!cursor){reachedEnd=true;break;}
    if(Object.keys(found).length>=wantedAssets.length) break;
  }
  Object.defineProperty(found,"_proof",{value:{pages,scanned,reachedEnd,readError,evidence},enumerable:false});
  return found;
}

async function resolveKalshi15mSeries(env, priorSeries=[]) {
  const wanted={
    BTC:{coinbaseProduct:"BTC-USD",aliases:["BTC","BITCOIN"]},
    ETH:{coinbaseProduct:"ETH-USD",aliases:["ETH","ETHEREUM"]},
    SOL:{coinbaseProduct:"SOL-USD",aliases:["SOL","SOLANA"]},
    XRP:{coinbaseProduct:"XRP-USD",aliases:["XRP","RIPPLE"]},
    HYPE:{coinbaseProduct:"HYPE-USD",aliases:["HYPE","HYPERLIQUID"]},
  };
  const path="/trade-api/v2/series?category="+encodeURIComponent("Crypto")+"&include_product_metadata=true";
  const r=await kalshiShadowGet(env,path);
  if(!r.ok) throw new Error("KALSHI_SERIES_READ_FAILED_"+r.status);
  const data=await r.json();
  const rows=Array.isArray(data?.series)?data.series:[];
  const priorByAsset=Object.fromEntries((Array.isArray(priorSeries)?priorSeries:[]).filter(x=>x?.asset&&x?.ticker).map(x=>[x.asset,x]));
  const knownFallbacks={BTC:"KXBTC15M",ETH:"KXETH15M",SOL:"KXSOL15M",XRP:"KXXRP15M",HYPE:"KXHYPE15M"};
  // Catalogue discovery is the source of truth for assets beyond the already proven
  // BTC/ETH series. A guessed fallback ticker must never suppress real discovery.
  const assetTextMatch=(asset,text)=>wanted[asset].aliases.some(alias=>new RegExp("(^|[^A-Z])"+alias+"([^A-Z]|$)").test(text));
  const catalogueHas15m=(asset)=>rows.some(s=>{
    const title=String(s?.title||"").toUpperCase(), ticker=String(s?.ticker||"").toUpperCase(), freq=String(s?.frequency||"").toUpperCase();
    return assetTextMatch(asset,title+" "+ticker) && (/15\s*(MIN|MINUTE)/.test(title)||freq.includes("15")||ticker.includes("15M"));
  });
  const unresolvedAssets=Object.keys(wanted).filter(asset=>!catalogueHas15m(asset) && !priorByAsset[asset]);
  // The Crypto series catalogue above is the bounded primary source. Before walking
  // the entire open-market catalogue, probe only candidate 15m series tickers and
  // accept one solely when Kalshi itself returns a matching series record.
  const candidate15mTickers={SOL:["KXSOL15M"],XRP:["KXXRP15M"],HYPE:["KXHYPE15M"]};
  const targetedDiscovered={};
  for(const asset of unresolvedAssets){
    for(const ticker of (candidate15mTickers[asset]||[])){
      let tr; try{tr=await kalshiShadowGet(env,"/trade-api/v2/series/"+encodeURIComponent(ticker));}catch{continue;}
      if(!tr.ok) continue;
      let td; try{td=await tr.json();}catch{continue;}
      const s=td?.series||td;
      const actualTicker=String(s?.ticker||"").toUpperCase();
      const title=String(s?.title||"");
      const frequency=String(s?.frequency||"");
      const text=(actualTicker+" "+title+" "+frequency).toUpperCase();
      const assetMatch=assetTextMatch(asset,text);
      const shortMatch=/15\s*(MIN|MINUTE)/i.test(title)||/15\s*M/i.test(frequency)||actualTicker.includes("15M");
      if(actualTicker===ticker && assetMatch && shortMatch){
        targetedDiscovered[asset]={
          ticker:actualTicker,title,frequency:frequency||"15m",
          settlementSources:Array.isArray(s?.settlement_sources)?s.settlement_sources:[],
          dynamicallyResolved:true,discoveredFrom:"TARGETED_SERIES_API"
        };
        break;
      }
    }
  }
  const stillUnresolved=unresolvedAssets.filter(asset=>!targetedDiscovered[asset]);
  const broadDiscovered=stillUnresolved.length ? await discoverKalshi15mSeriesFromOpenMarkets(env,stillUnresolved) : {};
  const marketDiscovered={...broadDiscovered,...targetedDiscovered};
  const discoveryProof=broadDiscovered?._proof||{pages:0,scanned:0,reachedEnd:true,readError:null,evidence:{}};
  const resolved=[];
  for(const [asset,meta] of Object.entries(wanted)) {
    const exact=rows.find(s=>{
      const title=String(s?.title||"").toUpperCase();
      const freq=String(s?.frequency||"").toLowerCase();
      const ticker=String(s?.ticker||"").toUpperCase();
      const assetMatch=assetTextMatch(asset,title+" "+ticker);
      const shortMatch=/15\s*(MIN|MINUTE)/i.test(title)||/15\s*m/i.test(freq)||ticker.includes("15M");
      return assetMatch && shortMatch;
    });
    // Only BTC/ETH have independently proven 15-minute series fallbacks.
    // SOL/XRP/HYPE must be discovered from Kalshi evidence, not ticker guesses.
    const fallback={BTC:"KXBTC15M",ETH:"KXETH15M"}[asset]||null;
    const prior=priorByAsset[asset]||null;
    const marketFound=marketDiscovered[asset]||null;
    const chosenTicker=String(exact?.ticker||prior?.ticker||marketFound?.ticker||fallback||"");
    const chosenSources=Array.isArray(exact?.settlement_sources)&&exact.settlement_sources.length
      ? exact.settlement_sources
      : (Array.isArray(prior?.settlementSources)&&prior.settlementSources.length?prior.settlementSources:(marketFound?.settlementSources||[]));
    const dynamicallyResolved=Boolean(exact?.ticker||prior?.dynamicallyResolved||marketFound?.dynamicallyResolved);
    const metadataReady=Boolean(chosenTicker) && chosenSources.length>0;
    resolved.push({
      asset,
      ticker:chosenTicker,
      title:String(exact?.title||prior?.title||marketFound?.title||""),
      frequency:String(exact?.frequency||prior?.frequency||marketFound?.frequency||""),
      settlementSources:chosenSources,
      coinbaseProduct:meta.coinbaseProduct,
      dynamicallyResolved,
      discoveredFrom: exact?.ticker?"SERIES_CATALOGUE":prior?.discoveredFrom||marketFound?.discoveredFrom||(fallback?"KNOWN_VALIDATED_FALLBACK":null),
      metadataReady,
      executionEligible:(asset==="BTC"||asset==="ETH") ? Boolean(chosenTicker) : metadataReady,
      discoveryProof: discoveryProof?.evidence?.[asset] ? {...discoveryProof.evidence[asset],pages:discoveryProof.pages,scanned:discoveryProof.scanned,reachedEnd:discoveryProof.reachedEnd,readError:discoveryProof.readError} : null
    });
  }
  return resolved;
}

async function discoverKalshiShadowMarkets(env, priorSeries=[]) {
  const series=await resolveKalshi15mSeries(env, priorSeries);
  const candidates=[]; let seen=0,rejected=0;
  const readFailures=[];
  for(const s of series) {
    if(!s.ticker) continue;
    // Freshness is enforced by close time, not provider status alone. Kalshi's Get Markets
    // supports min_close_ts when status is omitted; this prevents an old still-labelled-open
    // 15-minute market from re-entering the dashboard/opportunity pool.
    const discoveryNow=Date.now();
    const path="/trade-api/v2/markets?series_ticker="+encodeURIComponent(s.ticker)+"&status=open&limit=200";
    let r;
    try { r=await kalshiShadowGet(env,path); }
    catch(error){ readFailures.push({asset:s.asset,seriesTicker:s.ticker,reason:"NETWORK_OR_SIGNING_READ_FAILED"}); continue; }
    if(!r.ok) { readFailures.push({asset:s.asset,seriesTicker:s.ticker,status:r.status,reason:"MARKETS_READ_FAILED"}); continue; }
    const data=await r.json(), markets=Array.isArray(data?.markets)?data.markets:[];
    seen+=markets.length;
    for(const m of markets) {
      const yesAsk=normalizeProbability(m?.yes_ask_dollars??m?.yes_ask);
      const yesBid=normalizeProbability(m?.yes_bid_dollars??m?.yes_bid);
      const directNoAsk=normalizeProbability(m?.no_ask_dollars??m?.no_ask);
      const directNoBid=normalizeProbability(m?.no_bid_dollars??m?.no_bid);
      const noAsk=directNoAsk!==null?directNoAsk:(yesBid!==null?Number((1-yesBid).toFixed(4)):null);
      const noBid=directNoBid!==null?directNoBid:(yesAsk!==null?Number((1-yesAsk).toFixed(4)):null);
      const providerStatus=String(m?.status||"").toLowerCase();
      if(!m?.ticker || !["active","open"].includes(providerStatus) || yesAsk===null || yesBid===null || noAsk===null || noBid===null){rejected++;continue;}
      if(yesAsk<=0.01 || yesAsk>=0.99 || noAsk<=0.01 || noAsk>=0.99){rejected++;continue;}
      const open=Date.parse(m?.open_time||""), close=Date.parse(m?.close_time||"");
      const durationMs=Number.isFinite(open)&&Number.isFinite(close)?close-open:15*60*1000;
      const durationSafe=durationMs>=10*60*1000 && durationMs<=20*60*1000;
      // A 15-minute opportunity must have a real future close and be in the current
      // rolling window. This is defense-in-depth for both display and controller input.
      const freshnessMs=Number.isFinite(close)?close-discoveryNow:NaN;
      const freshnessSafe=Number.isFinite(freshnessMs) && freshnessMs>0 && freshnessMs<=20*60*1000;
      if(!freshnessSafe){rejected++;continue;}
      const executionEligible=Boolean(s.executionEligible && durationSafe && freshnessSafe);
      const base={
        marketTicker:m.ticker,slug:m.ticker,question:m.title||s.title||s.ticker,
        exchangeIndex:Number.isInteger(Number(m?.exchange_index))?Number(m.exchange_index):null,
        subtitle:m?.subtitle||null,yesSubTitle:m?.yes_sub_title||null,noSubTitle:m?.no_sub_title||null,
        floorStrike:m?.floor_strike??null,capStrike:m?.cap_strike??null,functionalStrike:m?.functional_strike||null,
        expectedExpirationTime:m?.expected_expiration_time||null,expirationTime:m?.expiration_time||null,
        asset:s.asset,source:"KALSHI",horizon:"15M",durationMs,
        openTime:m?.open_time||null,closeTime:m?.close_time||null,
        executionEligible,seriesTicker:s.ticker,seriesTitle:s.title,
        seriesFrequency:s.frequency,dynamicallyResolved:s.dynamicallyResolved,
        settlementSources:s.settlementSources
      };
      candidates.push({...base,id:m.ticker+":YES",outcomeSide:"YES",direction:"UP",bear:false,yes:yesAsk,bid:yesBid});
      candidates.push({...base,id:m.ticker+":NO",outcomeSide:"NO",direction:"DOWN",bear:true,yes:noAsk,bid:noBid});
    }
  }
  const coverage=Object.fromEntries(series.map(s=>[s.asset,{
    eligible:candidates.filter(x=>x.asset===s.asset).length,
    up:candidates.filter(x=>x.asset===s.asset&&x.direction==="UP").length,
    down:candidates.filter(x=>x.asset===s.asset&&x.direction==="DOWN").length,
    executionEligible:candidates.some(x=>x.asset===s.asset&&x.executionEligible===true),
    seriesTicker:s.ticker||null,
    dynamicallyResolved:Boolean(s.dynamicallyResolved)
  }]));
  return {markets:candidates,seen,rejected,coverage,pages:1,reachedEnd:true,source:"KALSHI_AUTHENTICATED_READ_ONLY",series,readFailures,partialReadFailure:readFailures.length>0};
}

async function runShadow(env) {
  const state = await loadShadowState(env);
  const now = Date.now();

  let stage = "MULTI_ASSET_SPOT";
  let discovery;
  try {
    const trackedAssets=["BTC","ETH","SOL","XRP","HYPE"];
    stage = "KALSHI_DISCOVERY";
    discovery = await discoverKalshiShadowMarkets(env, state?.kalshiSeriesCache||[]);
    stage = "MULTI_ASSET_SPOT";
    const liveAssets=[...new Set((discovery.markets||[]).map(m=>m.asset).filter(a=>trackedAssets.includes(a)))];
    const spotResults=await Promise.all(liveAssets.map(async asset=>{
      try{return [asset,await assetSpot(asset),null];}
      catch(error){return [asset,null,String(error?.message||"SPOT_READ_FAILED").slice(0,80)];}
    }));
    const spot={...Object.fromEntries(trackedAssets.map(a=>[a,Number(state?.prices?.[a])||null]))};
    const spotSources={...Object.fromEntries(trackedAssets.map(a=>[a,state?.priceSources?.[a]||null]))};
    const spotReadFailures=[];
    for(const [asset,x,error] of spotResults){
      if(x){spot[asset]=x.price;spotSources[asset]=x.source;}
      else spotReadFailures.push({asset,reason:error});
    }
    const scorableAssets=new Set(liveAssets.filter(asset=>Number.isFinite(Number(spot[asset]))&&Number(spot[asset])>0));
    discovery.markets=(discovery.markets||[]).filter(m=>scorableAssets.has(m.asset));
    for(const asset of liveAssets){
      if(!scorableAssets.has(asset)){
        discovery.coverage[asset]={...(discovery.coverage?.[asset]||{}),eligible:0,up:0,down:0,executionEligible:false,spotSignalReady:false};
      } else if(discovery.coverage?.[asset]) discovery.coverage[asset].spotSignalReady=true;
    }
    state.spotReadFailures=spotReadFailures;
    const btc=spot.BTC, eth=spot.ETH;
    state.kalshiSeriesCache=discovery.series||state?.kalshiSeriesCache||[];
    const priorCoverageProof=state?.assetCoverageProof||{};
    const currentCoverage=Object.fromEntries(trackedAssets.map(a=>[
      a, Number(discovery?.coverage?.[a]?.eligible||0)>0 && discovery?.coverage?.[a]?.executionEligible===true
    ]));
    state.assetCoverageProof={
      ...Object.fromEntries(trackedAssets.map(a=>[a,Boolean(priorCoverageProof?.[a]||currentCoverage[a])])),
      current:currentCoverage,
      anyValidatedAssetLive:Object.values(currentCoverage).some(Boolean),
      updatedAt:new Date(now).toISOString()
    };
    state.firstTradeCoverageGate=state.assetCoverageProof.anyValidatedAssetLive
      ? "AT_LEAST_ONE_VALIDATED_ASSET_LIVE"
      : "HOLD_UNTIL_A_VALIDATED_ASSET_IS_LIVE";
    stage = "SCORING";

    const previous = state.prices || {};
    const moves=Object.fromEntries(Object.entries(spot).map(([asset,price])=>[
      asset, Number.isFinite(Number(price))&&Number(price)>0&&Number.isFinite(Number(previous[asset]))&&Number(previous[asset])>0
        ? (Number(price)-Number(previous[asset]))/Number(previous[asset])
        : 0
    ]));

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

    state.prices = spot;
    state.moves = moves;
    state.priceSources = spotSources;
    state.opportunities = opportunities.slice(0, 20);
    state.eligibleCount = discovery.markets.length;
    state.assetCoverage = discovery.coverage;
    state.assetCoverageReady = Object.values(discovery.coverage||{}).some(v=>Number(v?.eligible||0)>0 && v?.executionEligible===true);
    state.currentObservationExecutionEligible = state.assetCoverageReady;
    state.failedObservation = null;
    state.rejectedCount = discovery.rejected;
    state.seenCount = discovery.seen;
    state.lastRunAt = new Date(now).toISOString();
    state.startedAt = state.startedAt || state.lastRunAt;
    state.runs = Number(state.runs || 0) + 1;
    state.status = discovery.partialReadFailure
      ? (discovery.markets.length>0 ? "LIVE_KALSHI_SHADOW_PARTIAL" : "LIVE_KALSHI_ZERO_RESULT")
      : "LIVE_KALSHI_SHADOW";
    state.lastSuccessfulObservationAt = new Date(now).toISOString();
    state.consecutiveObservationFailures = 0;
    state.venue = "KALSHI";
    state.errorCode = discovery.partialReadFailure ? "PARTIAL_KALSHI_READ_FAILURE" : null;
    state.errorStage = discovery.partialReadFailure ? "KALSHI_DISCOVERY_PARTIAL" : null;
    state.discoveryReadFailures = discovery.readFailures || [];
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
    // Fail closed for execution, but preserve the last successful observation separately
    // so one transient provider failure does not visually erase known-good evidence.
    state.lastRunAt = new Date(now).toISOString();
    state.status = "ERROR";
    state.errorCode = String(error?.message || "SHADOW_OBSERVATION_FAILED").slice(0, 120);
    state.errorStage = stage;
    state.consecutiveObservationFailures = Number(state.consecutiveObservationFailures||0)+1;
    state.lastObservationFailureAt = new Date(now).toISOString();
    state.assetCoverageReady = false;
    state.currentObservationExecutionEligible = false;
    state.failedObservation = {
      at: state.lastObservationFailureAt,
      stage,
      code: state.errorCode,
      consecutiveFailures: state.consecutiveObservationFailures
    };
    shadowLedger(state, "SHADOW_ERROR", {
      errorType: error?.name || "Error",
      message: "Shadow observation failed; last successful display evidence preserved; execution held closed.",
      stage,
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
const SCHEDULER_PROOF_KEY = "baseline-real-scheduler-proof-v1";

async function loadSchedulerProof(env) {
  if (!env?.BASELINE_REAL_SHADOW_STATE) return null;
  try {
    const raw=await env.BASELINE_REAL_SHADOW_STATE.get(SCHEDULER_PROOF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveSchedulerProof(env, proof) {
  if (!env?.BASELINE_REAL_SHADOW_STATE) return false;
  await env.BASELINE_REAL_SHADOW_STATE.put(SCHEDULER_PROOF_KEY, JSON.stringify(proof));
  return true;
}

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

async function saveRealTradeStateIfChanged(env, state, beforeState) {
  const comparable = (value) => {
    const copy = JSON.parse(JSON.stringify(value || {}));
    delete copy.updatedAt;
    return JSON.stringify(copy);
  };
  if (comparable(state) === comparable(beforeState)) return false;
  await saveRealTradeState(env, state);
  return true;
}

function realTradeLedger(state, type, payload = {}) {
  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  state.ledger.unshift({ ts: new Date().toISOString(), type, ...payload });
  state.ledger = state.ledger.slice(0, 80);
}
function safeFinite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function firstTradeEvidenceStage(state){
  const pre=state?.firstRealTradeEvidence?.preTradeDecisionSnapshot;
  if(!pre)return "WAITING_FOR_QUALIFYING_DECISION";
  if(!state?.entrySubmitStartedAt)return "SELECTED_PRE_SUBMIT";
  if(!state?.entryOrderId)return "SUBMITTED_OR_PROVIDER_RESPONSE_PENDING";
  if(!(Number(state?.filledCount)>0))return "SUBMITTED_NOT_FILLED";
  if(!state?.consumed)return "FILLED_POSITION_OPEN";
  return "EXITED_OR_SETTLED_ACCOUNTING_PENDING";
}
function publicFirstTradeEvidence(state){
  const e=state?.firstRealTradeEvidence||{};
  return {stage:firstTradeEvidenceStage(state),preTradeDecisionSnapshot:e.preTradeDecisionSnapshot||null,postTradeOutcomeEvidence:e.postTradeOutcomeEvidence||null,postTradeResearchReview:e.postTradeResearchReview||null,chain:{
    discovered:Boolean(e.preTradeDecisionSnapshot),qualified:Boolean(e.preTradeDecisionSnapshot?.qualification?.score>=REAL_TEST_CONFIG.entryScore),
    compared:Array.isArray(e.preTradeDecisionSnapshot?.eligibleCandidatesConsidered),selected:Boolean(e.preTradeDecisionSnapshot?.selected),
    authorized:Boolean(e.preTradeDecisionSnapshot?.authorization?.oneTradeAuthorized),submitted:Boolean(state?.entryOrderId),
    submissionAttempted:Boolean(state?.entrySubmitStartedAt),filled:Number(state?.filledCount||0)>0,exitedOrSettled:Boolean(state?.consumed),
    accounted:e.postTradeOutcomeEvidence?.resultingCashBalanceUsd!=null
  }};
}
function buildPostTradeResearchReview(state){
  const pre=state?.firstRealTradeEvidence?.preTradeDecisionSnapshot;
  const post=state?.firstRealTradeEvidence?.postTradeOutcomeEvidence;
  if(!pre||!post||!state?.consumed)return null;
  const entry=safeFinite(post?.entry?.actualFillPrice);
  const exit=safeFinite(post?.exit?.averageFillPrice);
  const qty=safeFinite(post?.exit?.filledCount??post?.entry?.quantity);
  const entryFee=safeFinite(post?.entry?.entryFeeUsd)||0;
  const exitFee=safeFinite(post?.exit?.exitFeeUsd)||0;
  const gross=(entry!==null&&exit!==null&&qty!==null)?Number(((exit-entry)*qty).toFixed(4)):null;
  const net=gross===null?null:Number((gross-entryFee-exitFee).toFixed(4));
  const outcome=net===null?"ACCOUNTING_PENDING":net>0?"GAIN":net<0?"LOSS":"FLAT";
  const observations=[];
  if(post?.exit?.reason==="MAX_HOLD_EXIT") observations.push("Position reached the existing 5-minute maximum-hold boundary.");
  if(post?.exit?.reason==="SCORE_EXIT") observations.push("Existing Baseline exit score condition triggered before maximum hold.");
  if(entry!==null&&pre?.qualification?.observedAsk!=null&&Math.abs(entry-Number(pre.qualification.observedAsk))>0.0001) observations.push("Actual entry fill differed from the decision-time observed ask; execution slippage should be tracked.");
  if((entryFee+exitFee)>0) observations.push("Real venue fees reduced realized result and should remain part of future paper-vs-real comparison.");
  if(outcome==="LOSS") observations.push("Loss preserved as evidence; inspect pre-trade movement, edge, contract price and competing candidates without changing the frozen rule from this single result.");
  if(outcome==="GAIN") observations.push("Gain preserved as evidence; do not infer profitability or tune the frozen rule from this single result.");
  return {
    schema:"BASELINE_REAL_POST_TRADE_RESEARCH_V1",generatedFromPreservedEvidence:true,
    strategyMutationAuthorized:false,outcome,grossPnlUsd:gross,totalRecordedFeesUsd:Number((entryFee+exitFee).toFixed(4)),netPnlUsd:net,
    observations,
    futureShadowHypotheses:observations.map((x,i)=>({id:i+1,hypothesis:x,status:"PROSPECTIVE_TEST_REQUIRED",mayChangeBaseline:false})),
    learningRule:"RECORD -> COMPARE BEFORE/AFTER -> FORM HYPOTHESIS -> TEST ON FUTURE SHADOW/PAPER DATA -> FOUNDER REVIEW BEFORE ANY STRATEGY CHANGE"
  };
}

function realTradeArmed(env) {
  return false;
}

const KALSHI_ONE_TRADE_SAFETY = {
  minTimeToCloseMs: REAL_TEST_CONFIG.maxHoldMs + 90 * 1000,
  pendingOrderTimeoutMs: 30 * 1000,
};

function kalshiClientOrderId(state, phase) {
  const seed=String(state?.authorizationNonce||state?.createdAt||Date.now()).replace(/[^0-9A-Za-z]/g,"").slice(-18);
  return ("baseline-real-"+phase+"-"+seed).slice(0,64);
}

function kalshiCandidateTimeSafe(candidate, now=Date.now()) {
  const close=Date.parse(candidate?.closeTime||"");
  return Number.isFinite(close) && (close-now) > KALSHI_ONE_TRADE_SAFETY.minTimeToCloseMs;
}
function executionProofEligibleCandidates(shadow, now=Date.now()) {
  const proofMinTimeToCloseMs=30*1000;
  return (shadow?.opportunities||[]).filter(o => {
    const close=Date.parse(o?.closeTime||"");
    return Number(o?.yes)>0.01 && Number(o?.yes)<0.99 && o?.marketTicker &&
      o?.executionEligible===true &&
      ["BTC","ETH","SOL","XRP","HYPE"].includes(String(o?.asset||"")) &&
      (o?.outcomeSide==="YES"||o?.outcomeSide==="NO") &&
      Number.isFinite(close) && (close-now)>proofMinTimeToCloseMs;
  });
}

function hasOpposingUnderlyingPosition(shadow, candidate) {
  const ticker=String(candidate?.marketTicker||candidate?.slug||"");
  if(!ticker) return true;
  return (shadow?.positions||[]).some(p => {
    const pt=String(p?.marketTicker||p?.slug||"").split(":")[0];
    const ps=String(p?.outcomeSide||"").toUpperCase();
    const cs=String(candidate?.outcomeSide||"").toUpperCase();
    return pt===ticker && (ps==="YES"||ps==="NO") && (cs==="YES"||cs==="NO") && ps!==cs;
  });
}

async function maybeRunKalshiOneTrade(env, freshShadow=null, triggerSource="SCHEDULED_AUTO", preparedBalance=null, stakeCapUsd=REAL_TEST_CONFIG.maxStakeUsd, executionProofMode=false) {
  const state=await loadRealTradeState(env);
  const persistedState=JSON.parse(JSON.stringify(state));
  const persistIfChanged=()=>saveRealTradeStateIfChanged(env,state,persistedState);
  const now=Date.now();

  if(triggerSource==="SCHEDULED_AUTO" && state?.founderAuthorization?.executionProofOnly===true) {
    state.status="EXECUTION_PROOF_ARMED_WAITING_FOR_FOUNDER";
    await persistIfChanged();
    return state;
  }

  if(state.consumed) {
    state.status="ONE_TRADE_COMPLETE";
    await persistIfChanged();
    return state;
  }
  if(!state.entryOrderId && state.entrySubmitStartedAt) {
    if(state.entryProviderStatus!=null) state.status="BLOCKED_ENTRY_PROVIDER_REJECTED";
    else if(state.entryWriteError) state.status="BLOCKED_ENTRY_WRITE_ERROR";
    else if(!String(state.status||"").startsWith("BLOCKED_ENTRY_") && state.status!=="BLOCKED_V2_REQUEST_BUILD") state.status="BLOCKED_ENTRY_RECONCILIATION";
    await persistIfChanged();
    return state;
  }
  if(!state.entryOrderId && !kalshiOneTradeEnabled(env,state)) {
    state.status="KALSHI_READY_HARD_DISABLED";
    await persistIfChanged();
    return state;
  }
  if(!env?.BASELINE_REAL_SHADOW_STATE) {
    state.status="BLOCKED_PERSISTENT_ONE_SHOT_LOCK_REQUIRED";
    return state;
  }

  const shadow=freshShadow && typeof freshShadow==="object" ? freshShadow : await loadShadowState(env);
  if(!shadow?.assetCoverageReady || shadow?.status!=="LIVE_KALSHI_SHADOW") {
    state.status="HOLD_LIVE_KALSHI_COVERAGE_REQUIRED";
    await persistIfChanged();
    return state;
  }

  if(!state.entryOrderId) {
    if(state.entrySubmitStartedAt || state.status==="ENTRY_SUBMITTING" || state.status==="BLOCKED_ENTRY_RECONCILIATION") {
      state.status="BLOCKED_ENTRY_RECONCILIATION";
      await persistIfChanged();
      return state;
    }
    const authorizedTestThreshold=Number(state?.founderAuthorization?.testEntryScore);
    const activeEntryThreshold=(!executionProofMode && Number.isFinite(authorizedTestThreshold))
      ? authorizedTestThreshold : REAL_TEST_CONFIG.entryScore;
    const qualifyingCandidates=executionProofMode
      ? executionProofEligibleCandidates(shadow,now)
      : (shadow.opportunities||[]).filter(o =>
          Number(o?.score)>=activeEntryThreshold && Number(o?.edge)>0 &&
          Number(o?.yes)>0.01 && Number(o?.yes)<0.99 && o?.marketTicker &&
          o?.executionEligible===true &&
          ["BTC","ETH","SOL","XRP","HYPE"].includes(String(o?.asset||"")) &&
          (o?.outcomeSide==="YES"||o?.outcomeSide==="NO") && kalshiCandidateTimeSafe(o,now)
        );
    const candidate=qualifyingCandidates.slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0))[0]||null;
    if(!candidate) {
      state.status="SHADOW_WAITING_FOR_SIGNAL";
      await persistIfChanged();
      return state;
    }
    if(hasOpposingUnderlyingPosition(shadow,candidate)) {
      state.status="BLOCKED_OPPOSING_POSITION";
      await persistIfChanged();
      return state;
    }

    const effectiveStakeCapUsd=Math.min(REAL_TEST_CONFIG.maxStakeUsd,Number(stakeCapUsd)||REAL_TEST_CONFIG.maxStakeUsd);
    const sizing=executionProofMode
      ? {ok:true,count:1,premiumUsd:0.99,feeUsd:0.01,totalDebitUsd:1,maxStakeUsd:1,reason:"EXECUTION_PROOF_ONE_CONTRACT_MAX_1_USD"}
      : estimateKalshiFeeSafeSize(candidate.yes,effectiveStakeCapUsd);
    if(!sizing.ok || sizing.totalDebitUsd>effectiveStakeCapUsd || sizing.count<1) {
      state.status="BLOCKED_FEE_SAFE_SIZE";
      await persistIfChanged();
      return state;
    }

    const balanceProof=preparedBalance && typeof preparedBalance==="object"
      ? preparedBalance : await kalshiExecutionBalanceSnapshot(env);
    if(!balanceProof.ok || !balanceProof.body) {
      state.status="BLOCKED_EXECUTION_BALANCE_READ";
      state.executionBalancePreflight={
        checkedAt:balanceProof?.checkedAt||new Date().toISOString(),
        passed:false,httpStatus:balanceProof?.httpStatus??null,
        latencyMs:balanceProof?.latencyMs??null,
        attempts:balanceProof?.attempts??null,
        error:balanceProof?.error||null,
        source:preparedBalance?"COLD_PATH_SAME_CYCLE":"HOT_PATH_FALLBACK"
      };
      await persistIfChanged();
      return state;
    }
    const balance=balanceProof.body;
    const candidateExchangeIndex=Number(candidate?.exchangeIndex);
    const balanceRows=Array.isArray(balance?.balance_breakdown)?balance.balance_breakdown:[];
    const shardRow=balanceRows.find(row=>Number(row?.exchange_index)===candidateExchangeIndex);
    const shardBalanceUsd=Number(shardRow?.balance);
    const requiredDebitUsd=Number(sizing.totalDebitUsd);
    if(!Number.isInteger(candidateExchangeIndex) || !Number.isFinite(shardBalanceUsd) ||
       !Number.isFinite(requiredDebitUsd) || shardBalanceUsd + 1e-9 < requiredDebitUsd) {
      state.status="BLOCKED_INSUFFICIENT_CANDIDATE_SHARD_BALANCE";
      state.executionBalancePreflight={
        checkedAt:new Date().toISOString(),
        exchangeIndex:Number.isInteger(candidateExchangeIndex)?candidateExchangeIndex:null,
        shardBalanceUsd:Number.isFinite(shardBalanceUsd)?shardBalanceUsd:null,
        requiredDebitUsd:Number.isFinite(requiredDebitUsd)?requiredDebitUsd:null,
        aggregateBalanceCents:Number.isFinite(Number(balance?.balance))?Number(balance.balance):null,
        passed:false
      };
      realTradeLedger(state,"CANDIDATE_SHARD_BALANCE_PREFLIGHT_BLOCKED",state.executionBalancePreflight);
      await persistIfChanged();
      return state;
    }
    state.executionBalancePreflight={
      checkedAt:balanceProof.checkedAt||new Date().toISOString(),exchangeIndex:candidateExchangeIndex,
      shardBalanceUsd,requiredDebitUsd,
      aggregateBalanceCents:Number.isFinite(Number(balance?.balance))?Number(balance.balance):null,
      passed:true,latencyMs:balanceProof.latencyMs??null,attempts:balanceProof.attempts??null,
      source:preparedBalance?"COLD_PATH_SAME_CYCLE":"HOT_PATH_FALLBACK"
    };

    const priorPre=state?.firstRealTradeEvidence?.preTradeDecisionSnapshot||null;
    const priorFailedWithoutOrder=Boolean(
      priorPre &&
      !state?.entryOrderId &&
      Number(state?.filledCount||0)===0 &&
      (state?.entryProviderStatus!=null || state?.entryWriteError)
    );
    if(priorFailedWithoutOrder){
      state.failedRealTradeAttempts=Array.isArray(state.failedRealTradeAttempts)?state.failedRealTradeAttempts:[];
      const priorKey=String(priorPre?.capturedAt||"")+"|"+String(priorPre?.selected?.marketTicker||"");
      const alreadyArchived=state.failedRealTradeAttempts.some(x=>
        String(x?.preTradeDecisionSnapshot?.capturedAt||"")+"|"+String(x?.preTradeDecisionSnapshot?.selected?.marketTicker||"")===priorKey
      );
      if(!alreadyArchived){
        state.failedRealTradeAttempts.push({
          schema:"BASELINE_REAL_FAILED_ATTEMPT_V1",immutable:true,archivedAt:new Date(now).toISOString(),
          preTradeDecisionSnapshot:priorPre,
          providerFailure:{status:state?.entryProviderStatus??null,response:state?.entryProviderResponse??null,writeError:state?.entryWriteError??null},
          entryClientOrderId:state?.entryClientOrderId||null,
          entryOrderId:state?.entryOrderId||null,
          filledCount:Number(state?.filledCount||0)
        });
        realTradeLedger(state,"FAILED_REAL_TRADE_ATTEMPT_ARCHIVED",{marketTicker:priorPre?.selected?.marketTicker||null,capturedAt:priorPre?.capturedAt||null});
      }
      state.firstRealTradeEvidence={
        preTradeDecisionSnapshot:null,
        postTradeOutcomeEvidence:null,
        postTradeResearchReview:null
      };
      await persistIfChanged();
    }

    if(!state?.firstRealTradeEvidence?.preTradeDecisionSnapshot){
      const ranked=qualifyingCandidates.slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
      const grossPayout=Number(Number(sizing.count||0).toFixed(4));
      state.firstRealTradeEvidence={...(state.firstRealTradeEvidence||{}),preTradeDecisionSnapshot:{
        schema:"BASELINE_REAL_FIRST_TRADE_DECISION_V1",immutable:true,capturedAt:new Date(now).toISOString(),
        selected:{asset:candidate.asset||null,marketTicker:candidate.marketTicker||null,question:candidate.question||null,side:candidate.outcomeSide||null,direction:candidate.direction||null},
        qualification:{score:safeFinite(candidate.score),threshold:REAL_TEST_CONFIG.entryScore,edge:safeFinite(candidate.edge),movement:safeFinite(candidate.move),observedAsk:safeFinite(candidate.yes),observedBid:safeFinite(candidate.bid)},
        capital:{startingResearchCapitalUsd:10,intendedContractCount:safeFinite(sizing.count),intendedPremiumUsd:safeFinite(sizing.premiumUsd),estimatedEntryFeeUsd:safeFinite(sizing.feeUsd),maximumEntryDebitUsd:safeFinite(sizing.totalDebitUsd),maximumPossibleDollarLossUsd:safeFinite(sizing.totalDebitUsd),maximumPossibleGrossPayoutUsd:grossPayout,maximumPossibleGrossProfitUsd:Number((grossPayout-Number(sizing.premiumUsd||0)-Number(sizing.feeUsd||0)).toFixed(4)),untouchedReserveMinimumUsd:5},
        settlement:{seriesTicker:candidate.seriesTicker||null,seriesTitle:candidate.seriesTitle||null,seriesFrequency:candidate.seriesFrequency||null,settlementSources:Array.isArray(candidate.settlementSources)?candidate.settlementSources:[],openTime:candidate.openTime||null,closeTime:candidate.closeTime||null},
        baselineInputs:{assetSpotUsd:safeFinite(shadow?.prices?.[candidate.asset]),assetSpotSource:shadow?.priceSources?.[candidate.asset]||null,movement:safeFinite(candidate.move),marketAsk:safeFinite(candidate.yes),marketBid:safeFinite(candidate.bid),edge:safeFinite(candidate.edge),score:safeFinite(candidate.score)},
        eligibleCandidatesConsidered:ranked.map((o,index)=>({rank:index+1,asset:o.asset||null,marketTicker:o.marketTicker||null,question:o.question||null,side:o.outcomeSide||null,direction:o.direction||null,score:safeFinite(o.score),edge:safeFinite(o.edge),movement:safeFinite(o.move),observedAsk:safeFinite(o.yes),observedBid:safeFinite(o.bid)})),
        selectionExplanation:{rule:executionProofMode?"FOUNDER $1 EXECUTION PROOF — HIGHEST CURRENTLY EXECUTION-ELIGIBLE TIME-SAFE CANDIDATE; BASELINE >= 0.80 STRATEGY FLOOR NOT USED FOR THIS PLUMBING TEST":"HIGHEST EXISTING BASELINE SCORE AMONG CURRENTLY ELIGIBLE CANDIDATES MEETING >= 0.80",selectedScore:safeFinite(candidate.score),alternativeCount:Math.max(0,ranked.length-1),noNewReasoningIntroduced:true,triggerSource,executionProofMode:Boolean(executionProofMode)},
        authorization:{oneTradeAuthorized:kalshiAuthorizationValid(state),scope:state?.founderAuthorization?.scope||null,authorizedAt:state?.founderAuthorization?.authorizedAt||null,expiresAt:state?.founderAuthorization?.expiresAt??null}
      },postTradeOutcomeEvidence:state?.firstRealTradeEvidence?.postTradeOutcomeEvidence||null};
      realTradeLedger(state,"FIRST_REAL_TRADE_DECISION_SNAPSHOT_CAPTURED",{marketTicker:candidate.marketTicker,asset:candidate.asset,score:safeFinite(candidate.score),exchangeIndex:candidate.exchangeIndex??null,triggerSource});
      await persistIfChanged();
    }

    state.authorizationNonce=state.authorizationNonce||crypto.randomUUID();
    state.marketSlug=candidate.marketTicker;
    state.marketTicker=candidate.marketTicker;
    state.exchangeIndex=Number.isInteger(Number(candidate?.exchangeIndex))?Number(candidate.exchangeIndex):null;
    state.outcomeSide=candidate.outcomeSide;
    state.direction=candidate.direction;
    state.question=candidate.question||null;
    state.asset=candidate.asset||null;
    state.entryScore=Number(candidate.score);
    state.entryObservedAsk=Number(candidate.yes);
    state.entryCount=sizing.count;
    state.entryFeeBudgetUsd=sizing.feeUsd;
    state.entryTotalDebitCapUsd=sizing.totalDebitUsd;
    state.entryClientOrderId=kalshiClientOrderId(state,"entry");
    state.entrySubmitStartedAt=now;
    state.status="ENTRY_SUBMITTING";
    realTradeLedger(state,"KALSHI_ENTRY_PRE_SUBMIT_LATCHED",{
      marketTicker:state.marketTicker,outcomeSide:state.outcomeSide,score:state.entryScore,exchangeIndex:state.exchangeIndex??null,
      count:state.entryCount,totalDebitCapUsd:state.entryTotalDebitCapUsd,clientOrderId:state.entryClientOrderId,triggerSource
    });
    await persistIfChanged();

    const dryEntry=executionProofMode
      ? kalshiExecutionProofEntryPayload(candidate,state.entryClientOrderId)
      : kalshiV2EntryPayload(candidate,sizing,state.entryClientOrderId);
    if(!dryEntry) {
      state.status="BLOCKED_V2_REQUEST_BUILD";
      await persistIfChanged();
      return state;
    }
    state.founderAuthorization.consumed=true;
    state.founderAuthorization.consumedAt=Date.now();
    await persistIfChanged();

    let er;
    try {
      er=await kalshiCreateOrderV2(env,{...state,founderAuthorization:{...state.founderAuthorization,consumed:false}},dryEntry);
    } catch(e) {
      state.status="BLOCKED_ENTRY_WRITE_ERROR";
      state.entryWriteError=String(e?.message||e);
      await persistIfChanged();
      return state;
    }
    const entryBody=await er.json().catch(()=>({}));
    if(!er.ok) {
      state.status="BLOCKED_ENTRY_PROVIDER_REJECTED";
      state.entryProviderStatus=er.status;
      state.entryProviderResponse=entryBody;
      await persistIfChanged();
      return state;
    }
    const es=summarizeKalshiV2CreateResponse(entryBody);
    state.entryOrderId=es.orderId;
    state.filledCount=es.fillCount;
    state.entryRemainingCount=es.remainingCount;
    state.entryAverageFillPrice=es.averageFillPrice;
    state.entryAverageFeePaid=es.averageFeePaid;
    state.entryFilledAt=Date.now();
    if(!state.entryOrderId) {
      state.status="BLOCKED_ENTRY_RESPONSE_MISSING_ORDER_ID";
      await persistIfChanged();
      return state;
    }
    if(!(state.filledCount>0)) {
      state.status="ONE_TRADE_ENTRY_NO_FILL_COMPLETE";
      state.consumed=true;
      realTradeLedger(state,"KALSHI_ENTRY_NO_FILL",{orderId:state.entryOrderId});
      await persistIfChanged();
      return state;
    }
    state.status="POSITION_OPEN";
    state.firstRealTradeEvidence=state.firstRealTradeEvidence||{};
    state.firstRealTradeEvidence.postTradeOutcomeEvidence={...(state.firstRealTradeEvidence.postTradeOutcomeEvidence||{}),entry:{submittedAt:state.entrySubmitStartedAt||null,orderId:state.entryOrderId||null,requestedPrice:state.entryObservedAsk??null,filledAt:state.entryFilledAt||null,actualFillPrice:state.entryAverageFillPrice??null,quantity:state.filledCount??null,entryFeeUsd:state.entryAverageFeePaid??null,status:"FILLED"},positionState:"OPEN"};
    realTradeLedger(state,"KALSHI_ENTRY_FILLED",{orderId:state.entryOrderId,filledCount:state.filledCount,averageFillPrice:state.entryAverageFillPrice});
    await persistIfChanged();

    if(executionProofMode){
      const remaining=Number(state.filledCount||0);
      state.exitAttempt=1;
      state.remainingExitCount=remaining;
      state.exitClientOrderId=kalshiClientOrderId(state,"proof-exit");
      state.exitSubmitStartedAt=Date.now();
      state.exitReason="EXECUTION_PROOF_IMMEDIATE_EXIT";
      const proofExit=kalshiExecutionProofExitPayload(state,state.exitClientOrderId);
      if(!proofExit){
        state.status="PROOF_EXIT_REQUEST_BUILD_FAILED";
        state.exitSubmitStartedAt=null;
        await persistIfChanged();
        return state;
      }
      let xr;
      try { xr=await kalshiCreateManagedExitV2(env,state,proofExit); }
      catch(e){
        state.status="PROOF_EXIT_WRITE_ERROR";
        state.exitWriteError=String(e?.message||e);
        state.exitSubmitStartedAt=null;
        await persistIfChanged();
        return state;
      }
      const xb=await xr.json().catch(()=>({}));
      state.exitSubmitStartedAt=null;
      if(!xr.ok){
        state.status="PROOF_EXIT_PROVIDER_REJECTED";
        state.exitProviderStatus=xr.status;
        state.exitProviderResponse=xb;
        await persistIfChanged();
        return state;
      }
      const xs=summarizeKalshiV2CreateResponse(xb);
      state.exitOrderId=xs.orderId;
      state.exitFilledCount=xs.fillCount;
      state.exitFilledTotal=Number(xs.fillCount||0);
      state.exitRemainingCount=Math.max(0,remaining-state.exitFilledTotal);
      state.exitAverageFillPrice=xs.averageFillPrice;
      state.exitAverageFeePaid=xs.averageFeePaid;
      if(state.exitRemainingCount<=1e-9){
        state.status="EXECUTION_PROOF_ROUND_TRIP_COMPLETE";
        state.consumed=true;
        state.completedAt=Date.now();
        state.firstRealTradeEvidence.postTradeOutcomeEvidence={...(state.firstRealTradeEvidence.postTradeOutcomeEvidence||{}),exit:{orderId:state.exitOrderId||null,reason:state.exitReason,filledCount:state.exitFilledTotal,averageFillPrice:state.exitAverageFillPrice??null,exitFeeUsd:state.exitAverageFeePaid??null,completedAt:new Date(state.completedAt).toISOString()},positionState:"CLOSED",accountingStatus:"WAITING_FOR_FINAL_BALANCE_RECONCILIATION"};
        realTradeLedger(state,"EXECUTION_PROOF_EXIT_FILLED",{orderId:state.exitOrderId,filledCount:state.exitFilledTotal});
      } else {
        state.status="EXECUTION_PROOF_EXIT_NO_FILL";
        realTradeLedger(state,"EXECUTION_PROOF_EXIT_NO_FILL",{orderId:state.exitOrderId,remaining:state.exitRemainingCount});
      }
      await persistIfChanged();
      return state;
    }
    return state;
  }

  if(!(Number(state.filledCount)>0)) {
    state.status="BLOCKED_POSITION_WITHOUT_FILL";
    await persistIfChanged();
    return state;
  }
  const shadowNow=await loadShadowState(env);
  const current=(shadowNow?.opportunities||[]).find(o=>o?.marketTicker===state.marketTicker&&o?.outcomeSide===state.outcomeSide);
  const age=now-Number(state.entryFilledAt||state.entrySubmitStartedAt||now);
  const holdDurationProof=state?.founderAuthorization?.holdDurationProof===true;
  const exitByScore=!holdDurationProof && current && Number(current.score)<=REAL_TEST_CONFIG.exitScore;
  const exitByTime=age>=REAL_TEST_CONFIG.maxHoldMs;
  if(!exitByScore&&!exitByTime) {
    state.status="POSITION_OPEN_WAITING_FOR_EXIT";
    await persistIfChanged();
    return state;
  }
  if(!current || !(Number(current.bid)>0.01) || !(Number(current.bid)<0.99)) {
    state.status="EXIT_REQUIRED_WAITING_FOR_LIVE_BID";
    await persistIfChanged();
    return state;
  }
  if(state.exitSubmitStartedAt && (now-Number(state.exitSubmitStartedAt))<KALSHI_ONE_TRADE_SAFETY.pendingOrderTimeoutMs) {
    state.status="BLOCKED_EXIT_RECONCILIATION";
    await persistIfChanged();
    return state;
  }
  if(state.exitSubmitStartedAt) state.exitSubmitStartedAt=null;
  const alreadyExited=Number(state.exitFilledTotal||0);
  const remaining=Math.max(0,Number(state.filledCount)-alreadyExited);
  if(!(remaining>0)) {
    state.status="ONE_TRADE_COMPLETE";
    state.consumed=true;
    state.completedAt=Date.now();
    await persistIfChanged();
    return state;
  }
  state.exitAttempt=Number(state.exitAttempt||0)+1;
  state.remainingExitCount=remaining;
  state.exitClientOrderId=kalshiClientOrderId(state,"exit"+state.exitAttempt);
  state.exitSubmitStartedAt=Date.now();
  state.exitReason=exitByScore?"SCORE_EXIT":"MAX_HOLD_EXIT";
  await persistIfChanged();
  const exitPayload=kalshiV2ExitPayload(state,current.bid,state.exitClientOrderId);
  if(!exitPayload) {
    state.status="BLOCKED_EXIT_REQUEST_BUILD";
    await persistIfChanged();
    return state;
  }
  let xr;
  try { xr=await kalshiCreateManagedExitV2(env,state,exitPayload); }
  catch(e) {
    state.status="EXIT_WRITE_ERROR_RETRY_PENDING";
    state.exitWriteError=String(e?.message||e);
    state.exitSubmitStartedAt=null;
    await persistIfChanged();
    return state;
  }
  const exitBody=await xr.json().catch(()=>({}));
  if(!xr.ok) {
    state.status="EXIT_PROVIDER_REJECTED_RETRY_PENDING";
    state.exitProviderStatus=xr.status;
    state.exitProviderResponse=exitBody;
    state.exitSubmitStartedAt=null;
    await persistIfChanged();
    return state;
  }
  const xs=summarizeKalshiV2CreateResponse(exitBody);
  state.exitOrderId=xs.orderId;
  state.exitFilledCount=xs.fillCount;
  state.exitFilledTotal=Number((alreadyExited+Number(xs.fillCount||0)).toFixed(4));
  state.exitRemainingCount=Math.max(0,Number(state.filledCount)-state.exitFilledTotal);
  state.exitAverageFillPrice=xs.averageFillPrice;
  state.exitAverageFeePaid=xs.averageFeePaid;
  state.exitSubmitStartedAt=null;
  if(state.exitRemainingCount<=1e-9) {
    state.status="ONE_TRADE_COMPLETE";
    state.consumed=true;
    state.completedAt=Date.now();
    state.firstRealTradeEvidence=state.firstRealTradeEvidence||{};
    state.firstRealTradeEvidence.postTradeOutcomeEvidence={...(state.firstRealTradeEvidence.postTradeOutcomeEvidence||{}),exit:{orderId:state.exitOrderId||null,reason:state.exitReason||null,filledCount:state.exitFilledTotal??null,averageFillPrice:state.exitAverageFillPrice??null,exitFeeUsd:state.exitAverageFeePaid??null,completedAt:new Date(state.completedAt).toISOString()},positionState:"CLOSED",realizedPnlUsd:null,resultingCashBalanceUsd:null,accountingStatus:"WAITING_FOR_FINAL_BALANCE_RECONCILIATION"};
    realTradeLedger(state,"KALSHI_EXIT_FILLED",{orderId:state.exitOrderId,reason:state.exitReason,filledCount:state.exitFilledTotal});
    state.firstRealTradeEvidence.postTradeResearchReview=buildPostTradeResearchReview(state);
    realTradeLedger(state,"POST_TRADE_RESEARCH_REVIEW_CREATED",{outcome:state.firstRealTradeEvidence.postTradeResearchReview?.outcome||"ACCOUNTING_PENDING",strategyMutationAuthorized:false});
  } else {
    state.status="POSITION_OPEN_EXIT_RETRY_REQUIRED";
    realTradeLedger(state,"KALSHI_EXIT_PARTIAL",{orderId:state.exitOrderId,attempt:state.exitAttempt,filledThisAttempt:Number(xs.fillCount||0),remaining:state.exitRemainingCount});
  }
  await persistIfChanged();
  return state;
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

  if (!state.entryOrderId) {
    if (state.status === "ENTRY_SUBMITTING" || state.status === "BLOCKED_ENTRY_RECONCILIATION") {
      state.status = "BLOCKED_ENTRY_RECONCILIATION";
      realTradeLedger(state, "REAL_TEST_BLOCKED", { reason: "ENTRY_RECONCILIATION_REQUIRED" });
      await saveRealTradeState(env, state);
      return state;
    }

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
      state.status = "SHADOW_WAITING_FOR_SIGNAL";
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

    await built.client.orders.preview({ request });

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
    armed: kalshiOneTradeEnabled(env,state),
    controllerSwitchEnabled: kalshiControllerSwitchEnabled(env),
    founderAuthorizationActive: kalshiAuthorizationValid(state),
    managedPositionOpen: Boolean(state?.entryOrderId && Number(state?.filledCount)>Number(state?.exitFilledTotal||0)),
    status: state?.status || "UNKNOWN",
    consumed: Boolean(state?.consumed),
    initialBankrollUsd: REAL_TEST_CONFIG.initialBankrollUsd,
    currentProviderBalanceUsd: safeFinite(state?.reconciledAccountBalanceUsd),
    reconciledBankrollPnlUsd: safeFinite(state?.reconciledBankrollPnlUsd),
    balanceReconciledAt: state?.reconciledAt ? new Date(state.reconciledAt).toISOString() : null,
    completedManualExecutionProof: state?.completedManualExecutionProof || null,
    completedManualReconciledBalanceUsd: safeFinite(state?.completedManualReconciledBalanceUsd),
    completedManualReconciledPnlUsd: safeFinite(state?.completedManualReconciledPnlUsd),
    founderAuthorization: state?.founderAuthorization ? {
      authorized:Boolean(state.founderAuthorization.authorized),
      consumed:Boolean(state.founderAuthorization.consumed),
      executionProofOnly:Boolean(state.founderAuthorization.executionProofOnly),
      automaticSignalProof:Boolean(state.founderAuthorization.automaticSignalProof),
      testEntryScore:safeFinite(state.founderAuthorization.testEntryScore),
      holdDurationProof:Boolean(state.founderAuthorization.holdDurationProof),
      maxEntryDebitUsd:safeFinite(state.founderAuthorization.maxEntryDebitUsd)
    } : null,
    maxStakeUsd: REAL_TEST_CONFIG.maxStakeUsd,
    entryScore: REAL_TEST_CONFIG.entryScore,
    exitScore: REAL_TEST_CONFIG.exitScore,
    maxHoldMs: REAL_TEST_CONFIG.maxHoldMs,
    marketSlug: state?.marketSlug || null,
    question: state?.question || null,
    entryOrderPresent: Boolean(state?.entryOrderId),
    entrySubmitAttempted: Boolean(state?.entrySubmitStartedAt),
    filledCount: Number(state?.filledCount||0),
    exitFilledTotal: Number(state?.exitFilledTotal||0),
    entryFailureStatus: !state?.entryOrderId && state?.entrySubmitStartedAt
      ? (state?.entryProviderStatus!=null ? "BLOCKED_ENTRY_PROVIDER_REJECTED" : state?.entryWriteError ? "BLOCKED_ENTRY_WRITE_ERROR" : "BLOCKED_ENTRY_RECONCILIATION")
      : null,
    entryProviderStatus: state?.entryProviderStatus ?? null,
    entryProviderResponse: state?.entryProviderResponse ?? null,
    entryWriteError: state?.entryWriteError ?? null,
    exitOrderPresent: Boolean(state?.exitOrderId),
    openedAt: state?.openedAt || null,
    closedAt: state?.closedAt || null,
    exitReason: state?.exitReason || null,
    recentEvidence: (state?.ledger || []).slice(0, 20),
    firstRealTradeEvidence: publicFirstTradeEvidence(state),
    executionBalancePreflight: state?.executionBalancePreflight ? {
      passed:Boolean(state.executionBalancePreflight.passed),
      httpStatus:state.executionBalancePreflight.httpStatus??null,
      latencyMs:state.executionBalancePreflight.latencyMs??null,
      attempts:state.executionBalancePreflight.attempts??null,
      error:state.executionBalancePreflight.error??null,
      source:state.executionBalancePreflight.source??null
    } : null,
    actualProviderBalanceAmountsExposed: false,
  };
}

function publicShadowView(state) {
  return {
    ok: state?.status !== "ERROR",
    mode: "REAL_KALSHI_SHADOW",
    venue: state?.venue || "KALSHI",
    status: state?.status || "UNKNOWN",
    startedAt: state?.startedAt || null,
    lastRunAt: state?.lastRunAt || null,
    runs: state?.runs || 0,
    strategy: state?.strategy || SHADOW_CONFIG,
    eligibleCount: state?.eligibleCount || 0,
    assetCoverage: state?.assetCoverage || { BTC:{eligible:0,up:0,down:0}, ETH:{eligible:0,up:0,down:0} },
    assetCoverageReady: Boolean(state?.assetCoverageReady),
    currentObservationExecutionEligible: Boolean(state?.currentObservationExecutionEligible),
    failedObservation: state?.failedObservation||null,
    priceSources: state?.priceSources || {},
    spotReadFailures: Array.isArray(state?.spotReadFailures)?state.spotReadFailures:[],
    consecutiveObservationFailures: Number(state?.consecutiveObservationFailures||0),
    lastSuccessfulObservationAt: state?.lastSuccessfulObservationAt||null,
    lastObservationFailureAt: state?.lastObservationFailureAt||null,
    rejectedCount: state?.rejectedCount || 0,
    seenCount: state?.seenCount || 0,
    errorCode: state?.errorCode || null,
    errorStage: state?.errorStage || null,
    discoveryReadFailures: Array.isArray(state?.discoveryReadFailures)?state.discoveryReadFailures:[],
    opportunities: (state?.opportunities || []).map((o) => ({
      slug: o.slug,
      marketTicker: o.marketTicker || o.slug,
      exchangeIndex: o.exchangeIndex ?? null,
      outcomeSide: o.outcomeSide || null,
      direction: o.direction || null,
      closeTime: o.closeTime || null,
      question: o.question,
      subtitle: o.subtitle || null,
      yesSubTitle: o.yesSubTitle || null,
      noSubTitle: o.noSubTitle || null,
      floorStrike: o.floorStrike ?? null,
      capStrike: o.capStrike ?? null,
      functionalStrike: o.functionalStrike || null,
      openTime: o.openTime || null,
      expectedExpirationTime: o.expectedExpirationTime || null,
      expirationTime: o.expirationTime || null,
      settlementSources: Array.isArray(o.settlementSources)?o.settlementSources:[],
      seriesTicker: o.seriesTicker || null,
      asset: o.asset,
      executionEligible: o.executionEligible===true,
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
      marketTicker: p.marketTicker || p.slug,
      outcomeSide: p.outcomeSide || null,
      direction: p.direction || null,
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Market Edge — Baseline Real</title></head><body><div id="app"></div><script>
async function load(){
  const [account,shadow,realTrade]=await Promise.all([fetch('/account',{cache:'no-store'}).then(r=>r.json()),fetch('/shadow-state',{cache:'no-store'}).then(r=>r.json()),fetch('/real-trade-state',{cache:'no-store'}).then(r=>r.json())]);
  document.getElementById('app').textContent=JSON.stringify({account,shadow,realTrade},null,2);
}
load();
</script></body></html>`;
}
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const invokedAt=Date.now();
      const [freshShadow,preparedBalance]=await Promise.all([runShadow(env),kalshiExecutionBalanceSnapshot(env)]);
      let controllerState=null;
      let controllerError=null;
      try {
        const scheduledState=await loadRealTradeState(env);
        const authorizedCap=Number(scheduledState?.founderAuthorization?.maxEntryDebitUsd);
        const scheduledStakeCap=Number.isFinite(authorizedCap)&&authorizedCap>0?Math.min(REAL_TEST_CONFIG.maxStakeUsd,authorizedCap):REAL_TEST_CONFIG.maxStakeUsd;
        controllerState=await maybeRunKalshiOneTrade(env, freshShadow, "SCHEDULED_AUTO", preparedBalance, scheduledStakeCap, false);
      } catch(error) {
        controllerError=String(error?.message||error||"CONTROLLER_RUNTIME_ERROR").slice(0,160);
      }
      const traceState=await loadRealTradeState(env);
      const traceTestThreshold=Number(traceState?.founderAuthorization?.testEntryScore);
      const traceEntryThreshold=kalshiAuthorizationValid(traceState)&&Number.isFinite(traceTestThreshold)?traceTestThreshold:REAL_TEST_CONFIG.entryScore;
      const controllerEligible=(freshShadow?.opportunities||[]).filter(o =>
        Number(o?.score)>=traceEntryThreshold && Number(o?.edge)>0 && Number(o?.yes)>0.01 && Number(o?.yes)<0.99 && o?.marketTicker && o?.executionEligible===true && ["BTC","ETH","SOL","XRP","HYPE"].includes(String(o?.asset||"")) && (o?.outcomeSide==="YES"||o?.outcomeSide==="NO")
      );
      const controllerTimeSafe=controllerEligible.filter(o=>kalshiCandidateTimeSafe(o,invokedAt));
      const traceEntry={invokedAt:new Date(invokedAt).toISOString(),shadowLastRunAt:freshShadow?.lastRunAt||null,eligibleCount:Number(freshShadow?.eligibleCount||0),activeEntryThreshold:traceEntryThreshold,baselineEntryThreshold:REAL_TEST_CONFIG.entryScore,scoreQualifyingCandidateCount:controllerEligible.length,timeSafeQualifyingCandidateCount:controllerTimeSafe.length,controllerStatus:controllerState?.status||null,controllerError};
      const minute=new Date(invokedAt).getUTCMinutes();
      const significant=controllerEligible.length>0 || Boolean(controllerError) || Boolean(controllerState?.entrySubmitStartedAt) || Boolean(controllerState?.entryOrderId) || Boolean(controllerState?.founderAuthorization?.consumed);
      const heartbeat=(minute%5===0);
      if(significant||heartbeat){
        const priorSchedulerProof=await loadSchedulerProof(env);
        const priorHistory=Array.isArray(priorSchedulerProof?.controllerTraceHistory)?priorSchedulerProof.controllerTraceHistory:[];
        await saveSchedulerProof(env,{invokedAt:new Date(invokedAt).toISOString(),completedAt:new Date().toISOString(),shadowLastRunAt:freshShadow?.lastRunAt||null,shadowStatus:freshShadow?.status||"UNKNOWN",eligibleCount:Number(freshShadow?.eligibleCount||0),controllerStatus:controllerState?.status||null,controllerError,observerCadenceSeconds:60,dashboardHeartbeatSeconds:300,controllerTraceHistory:[traceEntry,...priorHistory].slice(0,12),shadowSnapshot:freshShadow});
      }
      if(controllerError) throw new Error(controllerError);
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/kalshi-authorize-one-trade") {
      if(!kalshiControllerSwitchEnabled(env)) return json({ok:false,state:"CONTROLLER_SWITCH_HARD_DISABLED",armed:false,submitted:false,realMoneyMoved:false},423);
      let state=await loadRealTradeState(env);
      let body={}; try{body=await request.json();}catch{}
      if(body?.authorization!=="AUTHORIZE_ONE_AUTO_50_HOLD_PROOF_MAX_1_USD") return json({ok:false,state:"EXPLICIT_AUTHORIZATION_PHRASE_REQUIRED",armed:false},400);
      if(state?.consumed && Number(state?.filledCount)>0 && Number(state?.exitFilledTotal)>0){
        state=await reconcileCompletedKalshiProof(env,state);
        state.completedManualExecutionProof=JSON.parse(JSON.stringify(state.firstRealTradeEvidence||{}));
        state.completedManualReconciledBalanceUsd=state.reconciledAccountBalanceUsd;
        state.completedManualReconciledPnlUsd=state.reconciledBankrollPnlUsd;
        state.completedManualExecutionLedger=Array.isArray(state.ledger)?JSON.parse(JSON.stringify(state.ledger)):[];
        state.entryOrderId=null; state.exitOrderId=null; state.entrySubmitStartedAt=null; state.exitSubmitStartedAt=null;
        state.entryProviderStatus=null; state.entryProviderResponse=null; state.entryWriteError=null;
        state.filledCount=0; state.exitFilledTotal=0; state.exitRemainingCount=0; state.remainingExitCount=0;
        state.marketSlug=null; state.question=null; state.outcomeSide=null; state.entryScore=null;
        state.entryFilledAt=null; state.entryAverageFillPrice=null; state.entryAverageFeePaid=null;
        state.exitAverageFillPrice=null; state.exitAverageFeePaid=null; state.completedAt=null;
        state.firstRealTradeEvidence={preTradeDecisionSnapshot:null,postTradeOutcomeEvidence:null,postTradeResearchReview:null};
        state.consumed=false;
        realTradeLedger(state,"MANUAL_EXECUTION_PROOF_PRESERVED",{providerConfirmed:true});
      } else if(state?.consumed||state?.entryOrderId||state?.entrySubmitStartedAt) {
        return json({ok:false,state:"ONE_TRADE_ALREADY_USED_OR_LATCHED",armed:false},409);
      }
      const now=Date.now();
      state.authorizationNonce=crypto.randomUUID();
      state.founderAuthorization={authorized:true,authorizedAt:now,expiresAt:null,consumed:false,scope:"ONE_TRADE_MAX_5_USD",executionProofOnly:false,maxEntryDebitUsd:1,automaticSignalProof:true,testEntryScore:0.50,holdDurationProof:true};
      state.status="AUTHORIZED_WAITING_FOR_AUTO_50_HOLD_PROOF";
      realTradeLedger(state,"FOUNDER_AUTO_50_HOLD_PROOF_AUTHORIZED",{testThreshold:0.50,baselineThreshold:REAL_TEST_CONFIG.entryScore,maxEntryDebitUsd:1,holdMs:REAL_TEST_CONFIG.maxHoldMs,automatic:true});
      await saveRealTradeState(env,state);
      return json({ok:true,state:state.status,armed:true,automatic:true,testThreshold:0.50,baselineThreshold:REAL_TEST_CONFIG.entryScore,maxEntryDebitUsd:1,holdMs:REAL_TEST_CONFIG.maxHoldMs,submitted:false,realMoneyMoved:false});
    }

    if (request.method !== "GET") return json({ ok:false,error:"READ_ONLY_BUILD" },405);
    if (url.pathname === "/") return html(dashboardHtml());
    if (url.pathname === "/health") return json({ok:true,service:"market-edge-baseline-real"});
    if (url.pathname === "/account") return json(await accountProof(env));
    if (url.pathname === "/shadow-state") return json(publicShadowView(await loadShadowState(env)));
    if (url.pathname === "/real-trade-state") {
      let state=await loadRealTradeState(env);
      if(state?.consumed && Number(state?.filledCount)>0 && Number(state?.exitFilledTotal)>0 && state?.firstRealTradeEvidence?.postTradeOutcomeEvidence?.accountingStatus!=="RECONCILED_FROM_KALSHI") state=await reconcileCompletedKalshiProof(env,state);
      return json(publicRealTradeView(state, env));
    }
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
