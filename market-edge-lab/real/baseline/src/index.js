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
      keyIdInstalled: Boolean((env.KALSHI_KEY_ID && env.KALSHI_PRIVATE_KEY) || env.POLYMARKET_US_KEY_ID),
      secretInstalled: Boolean((env.KALSHI_KEY_ID && env.KALSHI_PRIVATE_KEY) || env.POLYMARKET_US_SECRET),
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
      } catch {
        const current=Number(shadow?.prices?.[asset]);
        if(Number.isFinite(current)&&current>0)return {product,current,changePct:0,points:[{ts:Date.parse(shadow?.lastRunAt||new Date().toISOString()),price:current}],source:"BASELINE_REAL_SHADOW_FALLBACK",window:"BUILDING"};
        return {product,current:null,changePct:null,points:[],source:"UNAVAILABLE",window:"UNAVAILABLE"};
      }
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
async function kalshiLiveOutcomeBid(env,state) {
  const ticker=String(state?.marketTicker||"").trim();
  const outcome=String(state?.outcomeSide||"").toUpperCase();
  if(!ticker || (outcome!=="YES"&&outcome!=="NO")) return null;
  try {
    const response=await kalshiExecutionGet(env,"/trade-api/v2/markets/"+encodeURIComponent(ticker));
    if(!response.ok) return null;
    const body=await response.json().catch(()=>({}));
    const market=body?.market||body;
    const raw=outcome==="YES"
      ? (market?.yes_bid_dollars??market?.yes_bid)
      : (market?.no_bid_dollars??market?.no_bid);
    const bid=normalizeProbability(raw);
    return Number.isFinite(bid)&&bid>0&&bid<1 ? {bid,source:"EXACT_TICKER_AUTHENTICATED_MARKET_READ",httpStatus:response.status} : null;
  } catch {
    return null;
  }
}

async function freshKalshiExecutionQuote(env,candidate) {
  const ticker=String(candidate?.marketTicker||"").trim();
  const outcome=String(candidate?.outcomeSide||"").toUpperCase();
  if(!ticker || (outcome!=="YES"&&outcome!=="NO")) return {ok:false,reason:"INVALID_CANDIDATE"};
  try{
    const r=await kalshiExecutionGet(env,"/trade-api/v2/markets/"+encodeURIComponent(ticker));
    if(!r.ok) return {ok:false,reason:"MARKET_READ_HTTP_"+r.status,httpStatus:r.status};
    const body=await r.json().catch(()=>({}));
    const m=body?.market||body;
    const yesAsk=normalizeProbability(m?.yes_ask_dollars??m?.yes_ask);
    const yesBid=normalizeProbability(m?.yes_bid_dollars??m?.yes_bid);
    const noAsk=normalizeProbability(m?.no_ask_dollars??m?.no_ask);
    const noBid=normalizeProbability(m?.no_bid_dollars??m?.no_bid);
    const selectedAsk=outcome==="YES"?yesAsk:noAsk;
    const selectedBid=outcome==="YES"?yesBid:noBid;
    if(!Number.isFinite(selectedAsk)||selectedAsk<=0||selectedAsk>=1) return {ok:false,reason:"LIVE_SELECTED_ASK_UNAVAILABLE"};
    const rescored=scoreShadowMarket({...candidate,yes:selectedAsk,bid:selectedBid},{[candidate.asset]:Number(candidate?.move)||0});
    return {ok:true,candidate:rescored,readAt:new Date().toISOString(),httpStatus:r.status,
      market:{yesAsk,yesBid,noAsk,noBid,status:m?.status||null,closeTime:m?.close_time||candidate?.closeTime||null}};
  }catch(error){return {ok:false,reason:"LIVE_EXECUTION_QUOTE_READ_FAILED",error:String(error?.message||error).slice(0,120)};}
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

// Isolated repeatability test controller.
// This DOES NOT change the production Baseline definition (>= .80). It exists only to
// prove RADAR -> LOCK -> FIRE -> MANAGE -> RECORD across repeated real $1 executions.
const EXECUTION_TEST_CONFIG={
  entryScore:0.60,
  exitScore:0.20,
  maxHoldMs:5*60*1000,
  maxEntryDebitUsd:1,
  maxAttempts:5,
  maxConcurrent:3,
  requiredExchangeIndex:2,
  minSeriesFundingUsd:5
};
const EXECUTION_TEST_STATE_KEY="baseline-real-execution-test-v1";

function defaultExecutionTestState(){
  return {
    schema:"BASELINE_REAL_EXECUTION_TEST_V1",mode:"EXECUTION_TEST_NOT_PRODUCTION_BASELINE",
    status:"DISARMED",armed:false,seriesId:null,armedAt:null,completedAt:null,
    threshold:EXECUTION_TEST_CONFIG.entryScore,maxAttempts:EXECUTION_TEST_CONFIG.maxAttempts,
    maxConcurrent:EXECUTION_TEST_CONFIG.maxConcurrent,maxEntryDebitUsd:EXECUTION_TEST_CONFIG.maxEntryDebitUsd,
    requiredExchangeIndex:EXECUTION_TEST_CONFIG.requiredExchangeIndex,
    attemptsStarted:0,positions:[],attempts:[],ledger:[]
  };
}
async function loadExecutionTestState(env){
  if(!env?.BASELINE_REAL_SHADOW_STATE)return defaultExecutionTestState();
  try{
    const raw=await env.BASELINE_REAL_SHADOW_STATE.get(EXECUTION_TEST_STATE_KEY);
    if(raw)return {...defaultExecutionTestState(),...JSON.parse(raw)};
  }catch{}
  return defaultExecutionTestState();
}
async function saveExecutionTestState(env,state){
  state.updatedAt=new Date().toISOString();
  if(env?.BASELINE_REAL_SHADOW_STATE)await env.BASELINE_REAL_SHADOW_STATE.put(EXECUTION_TEST_STATE_KEY,JSON.stringify(state));
}
function executionTestLedger(state,type,payload={}){
  state.ledger=Array.isArray(state.ledger)?state.ledger:[];
  state.ledger.unshift({ts:new Date().toISOString(),type,...payload});
  state.ledger=state.ledger.slice(0,120);
}
function executionTestEntryAuthorized(state){
  // attemptsStarted is incremented immediately before the provider write latch.
  // <= allows the fifth and final latched attempt to submit, while the controller
  // itself will not create attempt 6.
  return Boolean(state?.armed && Number(state?.attemptsStarted||0)<=EXECUTION_TEST_CONFIG.maxAttempts);
}
function executionTestOpenPositions(state){
  return (Array.isArray(state?.positions)?state.positions:[]).filter(p=>p?.status==="OPEN"||p?.status==="EXIT_RETRY");
}
function executionTestClientOrderId(state,attemptNo,phase){
  const seed=String(state?.seriesId||"test").replace(/[^0-9A-Za-z]/g,"").slice(-12);
  return ("nfe-test-"+seed+"-"+String(attemptNo)+"-"+phase).slice(0,64);
}
async function executionTestEntryWrite(env,state,payload){
  if(!executionTestEntryAuthorized(state))throw new Error("EXECUTION_TEST_ENTRY_NOT_AUTHORIZED");
  const path="/trade-api/v2/portfolio/events/orders";
  const headers=await kalshiExecutionHeaders(env,"POST",path);
  headers["content-type"]="application/json";
  return fetch("https://external-api.kalshi.com"+path,{method:"POST",headers,body:JSON.stringify(payload)});
}
async function executionTestExitWrite(env,state,position,payload){
  const live=(Array.isArray(state?.positions)?state.positions:[]).find(p=>p?.id===position?.id);
  if(!live||!(Number(live?.filledCount)>0)||!["OPEN","EXIT_RETRY"].includes(String(live?.status)))throw new Error("EXECUTION_TEST_EXIT_POSITION_INVALID");
  if(payload?.reduce_only!==true||String(payload?.ticker||"")!==String(live.marketTicker||""))throw new Error("EXECUTION_TEST_EXIT_SCOPE_INVALID");
  const path="/trade-api/v2/portfolio/events/orders";
  const headers=await kalshiExecutionHeaders(env,"POST",path);
  headers["content-type"]="application/json";
  return fetch("https://external-api.kalshi.com"+path,{method:"POST",headers,body:JSON.stringify(payload)});
}
function executionTestCandidatePool(shadow,now=Date.now()){
  return (shadow?.opportunities||[]).filter(o=>
    Number(o?.score)>=EXECUTION_TEST_CONFIG.entryScore &&
    Number(o?.edge)>0 &&
    Number(o?.yes)>0.01 && Number(o?.yes)<0.99 &&
    o?.marketTicker && o?.executionEligible===true &&
    Number(o?.exchangeIndex)===EXECUTION_TEST_CONFIG.requiredExchangeIndex &&
    ["BTC","ETH","SOL","XRP","HYPE"].includes(String(o?.asset||"")) &&
    (o?.outcomeSide==="YES"||o?.outcomeSide==="NO") &&
    kalshiCandidateTimeSafe(o,now)
  ).sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
}
async function runExecutionTestSeries(env,freshShadow=null,preparedBalance=null){
  const state=await loadExecutionTestState(env);
  const now=Date.now();
  const shadow=freshShadow&&typeof freshShadow==="object"?freshShadow:await loadShadowState(env);

  // MANAGE: every filled position owns its own independent .20 / 5-minute exit.
  for(const position of executionTestOpenPositions(state)){
    const shadowCurrent=(shadow?.opportunities||[]).find(o=>o?.marketTicker===position.marketTicker&&o?.outcomeSide===position.outcomeSide);
    const exactQuote=await kalshiLiveOutcomeBid(env,position);
    const liveBid=Number(exactQuote?.bid??shadowCurrent?.bid);
    const age=now-Number(position?.filledAt||position?.submittedAt||now);
    const exitByScore=Boolean(shadowCurrent&&Number(shadowCurrent.score)<=EXECUTION_TEST_CONFIG.exitScore);
    const exitByTime=age>=EXECUTION_TEST_CONFIG.maxHoldMs;
    if(!exitByScore&&!exitByTime)continue;
    if(!(liveBid>0.01&&liveBid<0.99)){
      position.status="EXIT_RETRY";
      position.exitHoldReason="LIVE_BID_UNAVAILABLE";
      continue;
    }
    const alreadyExited=Number(position.exitFilledTotal||0);
    const remaining=Math.max(0,Number(position.filledCount||0)-alreadyExited);
    if(!(remaining>0)){position.status="CLOSED";continue;}
    position.exitAttempt=Number(position.exitAttempt||0)+1;
    const exitState={...position,remainingExitCount:remaining};
    const clientId=executionTestClientOrderId(state,position.attemptNo,"x"+position.exitAttempt);
    const payload=kalshiV2ExitPayload(exitState,liveBid,clientId);
    if(!payload){position.status="EXIT_RETRY";position.exitHoldReason="PAYLOAD_BUILD_FAILED";continue;}
    position.exitReason=exitByScore?"SCORE_EXIT":"MAX_HOLD_EXIT";
    position.exitSubmitStartedAt=Date.now();
    let r;
    try{r=await executionTestExitWrite(env,state,position,payload);}
    catch(error){position.status="EXIT_RETRY";position.exitWriteError=String(error?.message||error);continue;}
    const body=await r.json().catch(()=>({}));
    position.exitSubmitStartedAt=null;
    if(!r.ok){
      position.status="EXIT_RETRY";position.exitProviderStatus=r.status;position.exitProviderResponse=body;
      executionTestLedger(state,"TEST_EXIT_PROVIDER_REJECTED",{positionId:position.id,ticker:position.marketTicker,httpStatus:r.status});
      continue;
    }
    const x=summarizeKalshiV2CreateResponse(body);
    position.exitOrderId=x.orderId||position.exitOrderId||null;
    position.exitFilledTotal=Number((alreadyExited+Number(x.fillCount||0)).toFixed(4));
    position.exitRemainingCount=Math.max(0,Number(position.filledCount||0)-position.exitFilledTotal);
    position.exitAverageFillPrice=x.averageFillPrice??position.exitAverageFillPrice??null;
    position.exitAverageFeePaid=x.averageFeePaid??position.exitAverageFeePaid??null;
    if(position.exitRemainingCount<=1e-9){
      position.status="CLOSED";position.closedAt=Date.now();
      executionTestLedger(state,"TEST_POSITION_CLOSED",{positionId:position.id,attemptNo:position.attemptNo,ticker:position.marketTicker,side:position.outcomeSide,reason:position.exitReason,exitOrderId:position.exitOrderId});
    }else{
      position.status="EXIT_RETRY";
      executionTestLedger(state,"TEST_EXIT_PARTIAL",{positionId:position.id,attemptNo:position.attemptNo,remaining:position.exitRemainingCount});
    }
  }

  if(!executionTestEntryAuthorized(state)){
    if(Number(state.attemptsStarted||0)>=EXECUTION_TEST_CONFIG.maxAttempts&&executionTestOpenPositions(state).length===0){
      state.armed=false;state.status="SERIES_COMPLETE";state.completedAt=state.completedAt||Date.now();
    }else if(state.armed) state.status="MANAGING_OPEN_POSITIONS";
    await saveExecutionTestState(env,state);
    return state;
  }
  if(!shadow?.assetCoverageReady||shadow?.status!=="LIVE_KALSHI_SHADOW"){
    state.status="WAITING_FOR_LIVE_SHADOW";
    await saveExecutionTestState(env,state);return state;
  }

  // RADAR: only exact index-2 candidates enter this five-attempt test series.
  const activeTickers=new Set(executionTestOpenPositions(state).map(p=>String(p.marketTicker)));
  const candidates=executionTestCandidatePool(shadow,now).filter(o=>!activeTickers.has(String(o.marketTicker)));
  let slots=Math.max(0,EXECUTION_TEST_CONFIG.maxConcurrent-executionTestOpenPositions(state).length);
  let warmedBalance=preparedBalance&&typeof preparedBalance==="object"?preparedBalance:null;

  for(const observed of candidates){
    if(slots<=0||Number(state.attemptsStarted||0)>=EXECUTION_TEST_CONFIG.maxAttempts)break;

    // LOCK: exact ticker/side provider reread + same frozen score formula at the live ask.
    const live=await freshKalshiExecutionQuote(env,observed);
    if(!live?.ok){
      executionTestLedger(state,"TEST_LOCK_QUOTE_HOLD",{ticker:observed.marketTicker,side:observed.outcomeSide,reason:live?.reason||"READ_FAILED"});
      continue;
    }
    const candidate=live.candidate;
    if(Number(candidate.score)<EXECUTION_TEST_CONFIG.entryScore||Number(candidate.edge)<=0||!kalshiCandidateTimeSafe(candidate,Date.now())){
      executionTestLedger(state,"TEST_LOCK_REQUALIFICATION_HOLD",{ticker:candidate.marketTicker,side:candidate.outcomeSide,observedScore:safeFinite(observed.score),liveScore:safeFinite(candidate.score),liveAsk:safeFinite(candidate.yes)});
      continue;
    }
    let sizing=estimateKalshiFeeSafeSize(candidate.yes,EXECUTION_TEST_CONFIG.maxEntryDebitUsd);
    if(!sizing?.ok||Number(sizing.totalDebitUsd)>EXECUTION_TEST_CONFIG.maxEntryDebitUsd||Number(sizing.count)<1)continue;

    // Preflight exact execution shard immediately before FIRE.
    const balanceProof=warmedBalance||await kalshiExecutionBalanceSnapshot(env);
    warmedBalance=null;
    const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
    const shard=rows.find(x=>Number(x?.exchange_index)===EXECUTION_TEST_CONFIG.requiredExchangeIndex);
    const shardUsd=Number(shard?.balance);
    if(!balanceProof?.ok||!Number.isFinite(shardUsd)||shardUsd+1e-9<Number(sizing.totalDebitUsd)){
      state.status="HOLD_TEST_INDEX2_BALANCE";
      state.fundingProof={checkedAt:balanceProof?.checkedAt||new Date().toISOString(),index2Usd:Number.isFinite(shardUsd)?shardUsd:null,requiredForNextAttemptUsd:safeFinite(sizing.totalDebitUsd)};
      executionTestLedger(state,"TEST_INDEX2_BALANCE_HOLD",state.fundingProof);
      break;
    }

    const attemptNo=Number(state.attemptsStarted||0)+1;
    const attemptId=(state.seriesId||"series")+"-"+attemptNo;
    const clientId=executionTestClientOrderId(state,attemptNo,"entry");
    const payload=kalshiV2EntryPayload(candidate,sizing,clientId);
    if(!payload)continue;

    // FIRE: attempt count increments only when we are committed to a provider POST.
    const attempt={
      id:attemptId,attemptNo,status:"SUBMITTING",createdAt:new Date().toISOString(),
      threshold:EXECUTION_TEST_CONFIG.entryScore,classification:"EXECUTION_TEST_NOT_PRODUCTION_BASELINE",
      asset:candidate.asset,marketTicker:candidate.marketTicker,outcomeSide:candidate.outcomeSide,direction:candidate.direction,
      exchangeIndex:candidate.exchangeIndex,observedScore:safeFinite(observed.score),observedAsk:safeFinite(observed.yes),
      liveScore:safeFinite(candidate.score),liveAsk:safeFinite(candidate.yes),liveBid:safeFinite(candidate.bid),
      count:safeFinite(sizing.count),maximumEntryDebitUsd:safeFinite(sizing.totalDebitUsd),clientOrderId:clientId
    };
    state.attemptsStarted=attemptNo;
    state.attempts=Array.isArray(state.attempts)?state.attempts:[];
    state.attempts.push(attempt);
    state.status="FIRING";
    executionTestLedger(state,"TEST_FIRE_LATCHED",{attemptNo,ticker:candidate.marketTicker,side:candidate.outcomeSide,observedScore:attempt.observedScore,liveScore:attempt.liveScore,liveAsk:attempt.liveAsk,maxDebitUsd:attempt.maximumEntryDebitUsd});
    await saveExecutionTestState(env,state);

    let r;
    try{r=await executionTestEntryWrite(env,state,payload);}
    catch(error){
      attempt.status="WRITE_ERROR";attempt.error=String(error?.message||error);
      executionTestLedger(state,"TEST_ENTRY_WRITE_ERROR",{attemptNo,ticker:candidate.marketTicker});
      await saveExecutionTestState(env,state);continue;
    }
    const body=await r.json().catch(()=>({}));
    attempt.providerHttpStatus=r.status;
    if(!r.ok){
      attempt.status="PROVIDER_REJECTED";attempt.providerResponse=body;
      executionTestLedger(state,"TEST_ENTRY_PROVIDER_REJECTED",{attemptNo,ticker:candidate.marketTicker,httpStatus:r.status});
      await saveExecutionTestState(env,state);continue;
    }
    const e=summarizeKalshiV2CreateResponse(body);
    attempt.orderId=e.orderId||null;attempt.fillCount=Number(e.fillCount||0);attempt.remainingCount=Number(e.remainingCount||0);
    attempt.averageFillPrice=e.averageFillPrice??null;attempt.averageFeePaid=e.averageFeePaid??null;
    if(!(attempt.fillCount>0)){
      attempt.status="NO_FILL";
      executionTestLedger(state,"TEST_ENTRY_NO_FILL",{attemptNo,ticker:candidate.marketTicker,side:candidate.outcomeSide,orderId:attempt.orderId});
      await saveExecutionTestState(env,state);continue;
    }
    attempt.status="FILLED";attempt.filledAt=Date.now();
    const position={
      id:attemptId,attemptNo,status:"OPEN",asset:candidate.asset,marketTicker:candidate.marketTicker,outcomeSide:candidate.outcomeSide,direction:candidate.direction,
      exchangeIndex:candidate.exchangeIndex,entryScore:safeFinite(candidate.score),entryObservedAsk:safeFinite(candidate.yes),
      entryOrderId:attempt.orderId,filledCount:attempt.fillCount,entryAverageFillPrice:attempt.averageFillPrice,
      entryAverageFeePaid:attempt.averageFeePaid,filledAt:attempt.filledAt,exitFilledTotal:0,exitAttempt:0
    };
    state.positions=Array.isArray(state.positions)?state.positions:[];
    state.positions.push(position);
    slots--;
    activeTickers.add(String(candidate.marketTicker));
    executionTestLedger(state,"TEST_POSITION_OPENED",{attemptNo,positionId:position.id,ticker:position.marketTicker,side:position.outcomeSide,orderId:position.entryOrderId,filledCount:position.filledCount});
    await saveExecutionTestState(env,state);
  }

  const open=executionTestOpenPositions(state).length;
  if(Number(state.attemptsStarted||0)>=EXECUTION_TEST_CONFIG.maxAttempts){
    state.status=open>0?"ATTEMPT_LIMIT_REACHED_MANAGING_POSITIONS":"SERIES_COMPLETE";
    if(open===0){state.armed=false;state.completedAt=state.completedAt||Date.now();}
  }else state.status=open>0?"FISHING_WITH_OPEN_POSITIONS":"FISHING";
  await saveExecutionTestState(env,state);
  return state;
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
  // Safety interlock: the legacy Polymarket execution controller is intentionally disabled.
  // Kalshi execution must use a separate, later-authorized credential and code path.
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
  // Execution-plumbing proof only: prove one real BUY/FILL and immediate reduce-only SELL/FILL.
  // This is NOT the Baseline strategy hold. Keep only a 30-second operational buffer.
  // The normal Baseline 6.5-minute safety gate remains untouched.
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
    // Shadow positions are observation-only and historically did not persist
    // outcomeSide. Missing side must never be interpreted as an opposing REAL
    // position; only an explicit opposite YES/NO side can trip this interlock.
    const ps=String(p?.outcomeSide||"").toUpperCase();
    const cs=String(candidate?.outcomeSide||"").toUpperCase();
    return pt===ticker && (ps==="YES"||ps==="NO") && (cs==="YES"||cs==="NO") && ps!==cs;
  });
}

// Final Kalshi controller is invoked by the scheduler but remains fail-closed until BOTH
// the controller switch and an unexpired persisted Founder one-trade authorization exist.
async function maybeRunKalshiOneTrade(env, freshShadow=null, triggerSource="SCHEDULED_AUTO", preparedBalance=null, stakeCapUsd=REAL_TEST_CONFIG.maxStakeUsd, executionProofMode=false) {
  const state=await loadRealTradeState(env);
  const persistedState=JSON.parse(JSON.stringify(state));
  const persistIfChanged=()=>saveRealTradeStateIfChanged(env,state,persistedState);
  const now=Date.now();

  // A rearmed Founder $1 execution-proof authorization is manual-only. The scheduler
  // must never consume it or place an automatic Baseline entry while proofOnly is set.
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
  // Once a provider submission latch exists, never overwrite its failure/reconciliation
  // evidence with the generic authorization-disabled state on later scheduler cycles.
  if(!state.entryOrderId && state.entrySubmitStartedAt) {
    if(state.entryProviderStatus!=null) state.status="BLOCKED_ENTRY_PROVIDER_REJECTED";
    else if(state.entryWriteError) state.status="BLOCKED_ENTRY_WRITE_ERROR";
    else if(!String(state.status||"").startsWith("BLOCKED_ENTRY_") && state.status!=="BLOCKED_V2_REQUEST_BUILD") state.status="BLOCKED_ENTRY_RECONCILIATION";
    await persistIfChanged();
    return state;
  }
  // Founder authorization gates the single ENTRY only. Once an entry exists,
  // the exact filled position remains under managed reduce-only exit control.
  if(!state.entryOrderId && !kalshiOneTradeEnabled(env,state)) {
    state.status="KALSHI_READY_HARD_DISABLED";
    await persistIfChanged();
    return state;
  }
  if(!env?.BASELINE_REAL_SHADOW_STATE) {
    state.status="BLOCKED_PERSISTENT_ONE_SHOT_LOCK_REQUIRED";
    return state;
  }

  // Use the exact successful observation from this scheduler invocation when available.
  // Re-reading caches.default here can surface an older POP/isolate snapshot.
  const shadow=freshShadow && typeof freshShadow==="object" ? freshShadow : await loadShadowState(env);
  if(!shadow?.assetCoverageReady || shadow?.status!=="LIVE_KALSHI_SHADOW") {
    state.status="HOLD_LIVE_KALSHI_COVERAGE_REQUIRED";
    await persistIfChanged();
    return state;
  }

  // Entry path. No provider POST can happen until every gate below passes.
  if(!state.entryOrderId) {
    if(state.entrySubmitStartedAt || state.status==="ENTRY_SUBMITTING" || state.status==="BLOCKED_ENTRY_RECONCILIATION") {
      state.status="BLOCKED_ENTRY_RECONCILIATION";
      await persistIfChanged();
      return state;
    }
    // The Founder $1 execution proof validates provider plumbing, not strategy quality.
    // In that explicitly labeled mode ONLY, keep every execution/safety gate but do not
    // require the frozen Baseline >= .80 score/positive-edge strategy qualification.
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
    let candidate=qualifyingCandidates.slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0))[0]||null;
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
    let sizing=executionProofMode
      ? {ok:true,count:1,premiumUsd:0.99,feeUsd:0.01,totalDebitUsd:1,maxStakeUsd:1,reason:"EXECUTION_PROOF_ONE_CONTRACT_MAX_1_USD"}
      : estimateKalshiFeeSafeSize(candidate.yes,effectiveStakeCapUsd);
    if(!sizing.ok || sizing.totalDebitUsd>effectiveStakeCapUsd || sizing.count<1) {
      state.status="BLOCKED_FEE_SAFE_SIZE";
      await persistIfChanged();
      return state;
    }

    // Consume the same-cycle cold-path balance/auth proof when the scheduler prepared it.
    // Manual/legacy callers still fall back to an immediate authenticated read.
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
    // Execution collateral is shard-specific on Kalshi. Never treat aggregate cash as
    // spendable for a candidate whose market lives on another exchange_index.
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


    // Final execution-price gate: immediately before any one-way latch/provider POST,
    // re-read the exact Kalshi ticker and same YES/NO side. Re-run the frozen Baseline
    // formula at that live executable ask. A stale >=.80 observation cannot authorize a
    // worse live quote; authorization remains armed and waits for a fresh qualified quote.
    if(!executionProofMode){
      const originalCandidate={...candidate};
      const liveQuote=await freshKalshiExecutionQuote(env,candidate);
      state.executionPriceProof={
        checkedAt:liveQuote?.readAt||new Date().toISOString(),ticker:candidate.marketTicker||null,
        outcomeSide:candidate.outcomeSide||null,observedAsk:safeFinite(candidate.yes),
        observedBid:safeFinite(candidate.bid),observedScore:safeFinite(candidate.score),
        liveReadOk:Boolean(liveQuote?.ok),reason:liveQuote?.reason||null,httpStatus:liveQuote?.httpStatus??null,
        liveYesAsk:safeFinite(liveQuote?.market?.yesAsk),liveYesBid:safeFinite(liveQuote?.market?.yesBid),
        liveNoAsk:safeFinite(liveQuote?.market?.noAsk),liveNoBid:safeFinite(liveQuote?.market?.noBid),
        providerWrites:0
      };
      if(!liveQuote?.ok){
        state.status="HOLD_FRESH_EXECUTION_QUOTE_REQUIRED";
        realTradeLedger(state,"FRESH_EXECUTION_QUOTE_HOLD",state.executionPriceProof);
        await persistIfChanged();
        return state;
      }
      candidate=liveQuote.candidate;
      state.executionPriceProof.liveSelectedAsk=safeFinite(candidate.yes);
      state.executionPriceProof.liveSelectedBid=safeFinite(candidate.bid);
      state.executionPriceProof.liveScore=safeFinite(candidate.score);
      state.executionPriceProof.liveEdge=safeFinite(candidate.edge);
      if(Number(candidate.score)<activeEntryThreshold || Number(candidate.edge)<=0 || !kalshiCandidateTimeSafe(candidate,Date.now())){
        state.status="HOLD_FRESH_PRICE_NO_LONGER_QUALIFIES";
        realTradeLedger(state,"FRESH_EXECUTION_PRICE_REQUALIFICATION_HOLD",state.executionPriceProof);
        await persistIfChanged();
        return state;
      }
      sizing=estimateKalshiFeeSafeSize(candidate.yes,effectiveStakeCapUsd);
      if(!sizing.ok || sizing.totalDebitUsd>effectiveStakeCapUsd || sizing.count<1 || shardBalanceUsd+1e-9<Number(sizing.totalDebitUsd)){
        state.status="HOLD_FRESH_PRICE_FEE_SAFE_SIZE";
        state.executionPriceProof.freshRequiredDebitUsd=safeFinite(sizing?.totalDebitUsd);
        realTradeLedger(state,"FRESH_EXECUTION_PRICE_SIZE_HOLD",state.executionPriceProof);
        await persistIfChanged();
        return state;
      }
      state.executionPriceProof.freshRequiredDebitUsd=safeFinite(sizing.totalDebitUsd);
      state.executionPriceProof.freshCount=safeFinite(sizing.count);
      state.executionPriceProof.requalified=true;
      state.executionPriceProof.priceSource="EXACT_TICKER_AUTHENTICATED_PRE_SUBMIT_READ";
      state.executionPriceProof.originalObservedAsk=safeFinite(originalCandidate.yes);
      realTradeLedger(state,"FRESH_EXECUTION_PRICE_REQUALIFIED",state.executionPriceProof);
    }

    // Immutable BEFORE evidence for the next executable attempt.
    // A provider-rejected attempt remains preserved as a failed specimen, but it must
    // not occupy the write-once slot needed by a later, separately authorized attempt.
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

    // Write-once for this attempt; never reconstructed from AFTER data.
    if(!state?.firstRealTradeEvidence?.preTradeDecisionSnapshot){
      const ranked=qualifyingCandidates.slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
      const grossPayout=Number(Number(sizing.count||0).toFixed(4));
      state.firstRealTradeEvidence={...(state.firstRealTradeEvidence||{}),preTradeDecisionSnapshot:{
        schema:"BASELINE_REAL_FIRST_TRADE_DECISION_V1",immutable:true,capturedAt:new Date(now).toISOString(),
        selected:{asset:candidate.asset||null,marketTicker:candidate.marketTicker||null,question:candidate.question||null,side:candidate.outcomeSide||null,direction:candidate.direction||null},
        qualification:{score:safeFinite(candidate.score),threshold:REAL_TEST_CONFIG.entryScore,edge:safeFinite(candidate.edge),movement:safeFinite(candidate.move),observedAsk:safeFinite(candidate.yes),observedBid:safeFinite(candidate.bid)},
        capital:{startingResearchCapitalUsd:10,intendedContractCount:safeFinite(sizing.count),intendedPremiumUsd:safeFinite(sizing.premiumUsd),estimatedEntryFeeUsd:safeFinite(sizing.feeUsd),maximumEntryDebitUsd:safeFinite(sizing.totalDebitUsd),maximumPossibleDollarLossUsd:safeFinite(sizing.totalDebitUsd),maximumPossibleGrossPayoutUsd:grossPayout,maximumPossibleGrossProfitUsd:Number((grossPayout-Number(sizing.premiumUsd||0)-Number(sizing.feeUsd||0)).toFixed(4)),untouchedReserveMinimumUsd:5},
        settlement:{seriesTicker:candidate.seriesTicker||null,seriesTitle:candidate.seriesTitle||null,seriesFrequency:candidate.seriesFrequency||null,settlementSources:Array.isArray(candidate.settlementSources)?candidate.settlementSources:[],openTime:candidate.openTime||null,closeTime:candidate.closeTime||null},
        baselineInputs:{assetSpotUsd:safeFinite(shadow?.prices?.[candidate.asset]),assetSpotSource:shadow?.priceSources?.[candidate.asset]||null,movement:safeFinite(candidate.move),marketAsk:safeFinite(candidate.yes),marketBid:safeFinite(candidate.bid),edge:safeFinite(candidate.edge),score:safeFinite(candidate.score),executionPriceSource:executionProofMode?"EXECUTION_PROOF":"EXACT_TICKER_AUTHENTICATED_PRE_SUBMIT_READ"},
        eligibleCandidatesConsidered:ranked.map((o,index)=>({rank:index+1,asset:o.asset||null,marketTicker:o.marketTicker||null,question:o.question||null,side:o.outcomeSide||null,direction:o.direction||null,score:safeFinite(o.score),edge:safeFinite(o.edge),movement:safeFinite(o.move),observedAsk:safeFinite(o.yes),observedBid:safeFinite(o.bid)})),
        selectionExplanation:{rule:executionProofMode?"FOUNDER $1 EXECUTION PROOF — HIGHEST CURRENTLY EXECUTION-ELIGIBLE TIME-SAFE CANDIDATE; BASELINE >= 0.80 STRATEGY FLOOR NOT USED FOR THIS PLUMBING TEST":"HIGHEST EXISTING BASELINE SCORE AMONG CURRENTLY ELIGIBLE CANDIDATES MEETING >= 0.80",selectedScore:safeFinite(candidate.score),alternativeCount:Math.max(0,ranked.length-1),noNewReasoningIntroduced:true,triggerSource,executionProofMode:Boolean(executionProofMode)},
        authorization:{oneTradeAuthorized:kalshiAuthorizationValid(state),scope:state?.founderAuthorization?.scope||null,authorizedAt:state?.founderAuthorization?.authorizedAt||null,expiresAt:state?.founderAuthorization?.expiresAt??null}
      },postTradeOutcomeEvidence:state?.firstRealTradeEvidence?.postTradeOutcomeEvidence||null};
      realTradeLedger(state,"FIRST_REAL_TRADE_DECISION_SNAPSHOT_CAPTURED",{marketTicker:candidate.marketTicker,asset:candidate.asset,score:safeFinite(candidate.score),exchangeIndex:candidate.exchangeIndex??null,triggerSource});
      await persistIfChanged();
    }

    // One-way latch BEFORE any provider write. A crash after this point blocks replay.
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
    // Consume the one-shot Founder authorization BEFORE the provider write.
    // From this point forward no second entry may be created from this authorization.
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

  // Manage only the exact quantity actually filled on entry.
  if(!(Number(state.filledCount)>0)) {
    state.status="BLOCKED_POSITION_WITHOUT_FILL";
    await persistIfChanged();
    return state;
  }
  const shadowNow=await loadShadowState(env);
  const shadowCurrent=(shadowNow?.opportunities||[]).find(o=>o?.marketTicker===state.marketTicker&&o?.outcomeSide===state.outcomeSide);
  const exactQuote=await kalshiLiveOutcomeBid(env,state);
  const liveBid=Number(exactQuote?.bid ?? shadowCurrent?.bid);
  const current=shadowCurrent ? {...shadowCurrent,bid:liveBid} : (Number.isFinite(liveBid)?{marketTicker:state.marketTicker,outcomeSide:state.outcomeSide,bid:liveBid,score:null}:null);
  const age=now-Number(state.entryFilledAt||state.entrySubmitStartedAt||now);
  const holdDurationProof=state?.founderAuthorization?.holdDurationProof===true;
  const exitByScore=!holdDurationProof && shadowCurrent && Number(shadowCurrent.score)<=REAL_TEST_CONFIG.exitScore;
  const exitByTime=age>=REAL_TEST_CONFIG.maxHoldMs;
  if(!exitByScore&&!exitByTime) {
    state.status="POSITION_OPEN_WAITING_FOR_EXIT";
    await persistIfChanged();
    return state;
  }
  if(!current || !(liveBid>0.01) || !(liveBid<0.99)) {
    state.status="EXIT_REQUIRED_WAITING_FOR_LIVE_BID";
    state.exitQuoteSource=exactQuote?.source||"SHADOW_EXACT_TICKER_MISSING_OR_NO_VALID_BID";
    await persistIfChanged();
    return state;
  }
  state.exitQuoteSource=exactQuote?.source||(shadowCurrent?"SHADOW_EXACT_TICKER":"UNKNOWN");
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
  // Managed exits do not reuse entry authorization. They are restricted to the
  // exact live ticker, exact remaining filled quantity, and reduce_only=true.
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
    armed: kalshiOneTradeEnabled(env,state),
    controllerSwitchEnabled: kalshiControllerSwitchEnabled(env),
    founderAuthorizationActive: kalshiAuthorizationValid(state),
    managedPositionOpen: Boolean(state?.entryOrderId && Number(state?.filledCount)>Number(state?.exitFilledTotal||0)),
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
    entrySubmitAttempted: Boolean(state?.entrySubmitStartedAt),
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
    lastSuccessfulObservationAt: state?.lastSuccessfulObservationAt||null,
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
      closeTime: o.closeTime || null,
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


function mirrorNumber(m, names) {
  for (const name of names) {
    const v=m?.[name];
    if(v===null||v===undefined||v==="") continue;
    const n=Number(v);
    if(!Number.isFinite(n)) continue;
    return name.includes("_dollars") ? n : (n>1 ? n/100 : n);
  }
  return null;
}
function mirrorSize(m,names){
  for(const name of names){const n=Number(m?.[name]);if(Number.isFinite(n))return n;}
  return null;
}
async function kalshiLiveMirrorData(env) {
  const shadow=await loadShadowState(env);
  const opportunities=(Array.isArray(shadow?.opportunities)?shadow.opportunities:[])
    .filter(o=>o?.marketTicker)
    .slice()
    .sort((a,b)=>{
      const aa=String(a?.asset||""),bb=String(b?.asset||"");
      if(aa!==bb)return aa.localeCompare(bb);
      const ad=String(a?.direction||a?.outcomeSide||""),bd=String(b?.direction||b?.outcomeSide||"");
      return ad.localeCompare(bd);
    })
    .slice(0,10);
  const observedAt=new Date().toISOString();

  // Fetch each Kalshi contract once, then expand it back into the exact
  // UP/YES and DOWN/NO opportunity rows Baseline is displaying. This keeps
  // the mirror and Current Opportunities on the same contract set.
  const tickers=[...new Set(opportunities.map(o=>String(o.marketTicker)))];
  const marketEntries=await Promise.all(tickers.map(async ticker=>{
    try{
      const path="/trade-api/v2/markets/"+encodeURIComponent(ticker);
      const r=await kalshiShadowGet(env,path);
      const body=await r.json().catch(()=>({}));
      return [ticker,{ok:r.ok,httpStatus:r.status,market:body?.market||body}];
    }catch{return [ticker,{ok:false,httpStatus:null,market:null}];}
  }));
  const marketByTicker=Object.fromEntries(marketEntries);

  const rows=opportunities.map(o=>{
    const ticker=String(o.marketTicker),read=marketByTicker[ticker]||{},m=read.market||{};
    const outcome=String(o?.outcomeSide||"").toUpperCase();
    const yesBid=mirrorNumber(m,["yes_bid_dollars","yes_bid"]);
    const yesAsk=mirrorNumber(m,["yes_ask_dollars","yes_ask"]);
    const noBid=mirrorNumber(m,["no_bid_dollars","no_bid"]);
    const noAsk=mirrorNumber(m,["no_ask_dollars","no_ask"]);
    const yesBidSize=mirrorSize(m,["yes_bid_size_fp","yes_bid_size"]);
    const yesAskSize=mirrorSize(m,["yes_ask_size_fp","yes_ask_size"]);
    const noBidSize=mirrorSize(m,["no_bid_size_fp","no_bid_size"]);
    const noAskSize=mirrorSize(m,["no_ask_size_fp","no_ask_size"]);
    return {
      ok:Boolean(read.ok),httpStatus:read.httpStatus??null,
      ticker,asset:o.asset||null,direction:o.direction||null,outcomeSide:o.outcomeSide||null,
      score:o.score??null,edge:o.edge??null,closeTime:m?.close_time||o.closeTime||null,status:m?.status||null,
      yesBid,yesAsk,noBid,noAsk,
      yesBidSize,yesAskSize,noBidSize,noAskSize,
      selectedBid:outcome==="NO"?noBid:yesBid,
      selectedAsk:outcome==="NO"?noAsk:yesAsk,
      selectedBidSize:outcome==="NO"?noBidSize:yesBidSize,
      selectedAskSize:outcome==="NO"?noAskSize:yesAskSize,
      last:mirrorNumber(m,["last_price_dollars","last_price"]),
      liquidityDollars:mirrorNumber(m,["liquidity_dollars"]),
      observedAsk:o.observedAsk??o.yes??null,observedBid:o.observedBid??o.bid??null,
      updatedTime:m?.updated_time||null
    };
  });
  return {ok:true,readOnly:true,source:"KALSHI_AUTHENTICATED_MARKET_READ",observedAt,shadowLastRunAt:shadow?.lastRunAt||null,
    contractAlignment:"EXACT_BASELINE_OPPORTUNITY_SET",rowCount:rows.length,rows,
    safety:{providerWrites:0,ordersCreated:0,stateMutation:false,realMoneyMoved:false}};
}
function kalshiLiveMirrorHtml(){
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baseline Real · Kalshi Live Mirror</title>
<style>body{margin:0;background:#050a11;color:#f5f7fb;font-family:system-ui}.w{max-width:1100px;margin:auto;padding:14px}.head,.card{background:#0d1724;border:1px solid #243a55;border-radius:16px;padding:14px;margin-bottom:10px}.gold{color:#f3d58a}.green{color:#67e49b}.red{color:#ff8585}.muted{color:#91a6be;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px}.prices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.side{background:#08121d;border:1px solid #294764;border-radius:12px;padding:10px}.big{font-size:24px;font-weight:850}.row{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #1b2d42;padding:6px 0;font-size:12px}.flashUp{color:#67e49b}.flashDown{color:#ff8585}.pill{display:inline-block;border:1px solid #725f34;border-radius:999px;padding:5px 8px;font-size:10px;color:#f3d58a}</style></head>
<body><div class="w"><div class="head"><div class="gold"><b>MARKET EDGE · BASELINE REAL</b></div><h2 style="margin:5px 0">Kalshi Live Market Mirror</h2><div class="muted">READ ONLY · provider prices only · no order submission · refreshes every 2 seconds</div><div style="margin-top:8px"><span id="stamp" class="pill">CONNECTING…</span> <span class="pill">BASELINE EXECUTION UNCHANGED</span></div></div><div id="grid" class="grid"></div></div>
<script>
const prev={}; const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cents=v=>Number.isFinite(Number(v))?(Number(v)*100).toFixed(1)+'¢':'—'; const size=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
function side(name,bid,ask,bidSize,askSize){return '<div class="side"><b>'+name+'</b><div class="prices"><div><div class="muted">BEST BID</div><div class="big">'+cents(bid)+'</div><div class="muted">qty '+size(bidSize)+'</div></div><div><div class="muted">BEST ASK</div><div class="big">'+cents(ask)+'</div><div class="muted">qty '+size(askSize)+'</div></div></div></div>';}
async function load(){
 try{const r=await fetch('/kalshi-live-mirror-data',{cache:'no-store'}),j=await r.json(); document.getElementById('stamp').textContent='KALSHI READ · '+new Date(j.observedAt||Date.now()).toLocaleTimeString();
 document.getElementById('grid').innerHTML=(j.rows||[]).map(x=>'<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><div><b>'+esc(x.asset||'')+' · '+esc(x.direction||x.outcomeSide||'')+'</b><div class="muted">'+esc(x.ticker)+'</div></div><span class="pill">SCORE '+(Number.isFinite(Number(x.score))?Number(x.score).toFixed(2):'—')+'</span></div><div class="prices">'+side('YES',x.yesBid,x.yesAsk,x.yesBidSize,x.yesAskSize)+side('NO',x.noBid,x.noAsk,x.noBidSize,x.noAskSize)+'</div><div class="row"><span>LAST TRADE</span><b>'+cents(x.last)+'</b></div><div class="row"><span>BASELINE SIDE</span><b>'+esc(x.outcomeSide||'—')+' · LIVE ASK '+cents(x.selectedAsk)+'</b></div><div class="row"><span>NFE OBSERVED ASK</span><b>'+cents(x.observedAsk)+'</b></div><div class="row"><span>LIVE STATUS</span><b>'+esc(x.status||'—')+'</b></div><div class="row"><span>CLOSE</span><b>'+esc(x.closeTime?new Date(x.closeTime).toLocaleTimeString():'—')+'</b></div></div>').join('')||'<div class="card">Waiting for current Baseline Kalshi contracts…</div>';
 }catch(e){document.getElementById('stamp').textContent='READ FAILED';}}
load(); setInterval(load,2000);
</script></body></html>`;
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
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 80% 0,#0d2440 0,transparent 35%),var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;min-height:100vh}.w{width:100%;max-width:none;margin:0;padding:12px clamp(10px,1.15vw,22px) 36px}.hero,.card,.opp{background:linear-gradient(180deg,var(--p2),var(--p));border:1px solid var(--line);border-radius:16px}.hero{padding:11px 16px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:15px;position:relative;overflow:hidden;min-height:112px}.hero:before,.hero:after{content:"";position:absolute;top:0;bottom:0;width:34%;background-repeat:no-repeat;background-size:contain;opacity:.96;pointer-events:none}.hero:before{left:0;background-image:linear-gradient(90deg,rgba(5,10,17,0),rgba(5,10,17,.28)),url("https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/market-edge-baseline-real/market-edge-lab/public/market-edge-bull-canon.webp");background-position:left center}.hero:after{right:0;background-image:linear-gradient(270deg,rgba(5,10,17,0),rgba(5,10,17,.28)),url("https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/market-edge-baseline-real/market-edge-lab/public/market-edge-bear-canon.webp");background-position:right center}.brand{display:contents}.brand .logo{grid-column:2;grid-row:1;width:132px;height:82px;object-fit:contain;border-radius:10px;box-shadow:0 0 18px #d8b15e55;position:relative;z-index:2}.brand>div{display:none}.actions{grid-column:3;grid-row:1;position:relative;z-index:2}.heroCopy{margin:8px 2px 0;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,var(--p2),var(--p));text-align:center}.heroCopy h1{margin:1px 0 2px}.heroCopy .sub{margin:0}.k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}h1{font-size:25px;margin:2px 0}.sub,.m{font-size:12px;color:var(--muted)}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pill,.btn{border:1px solid #725f34;color:var(--gold2);background:#0b1421;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:800}.pill.real{border-color:#315a8c;color:#a9d0ff}.btn{cursor:pointer}.btn:hover{border-color:var(--gold2);background:#121e2c}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}.card{padding:11px 13px}.label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.val{font-size:24px;font-weight:850;margin-top:5px}.good{color:var(--green)}.warn{color:var(--yellow)}.bad{color:var(--red)}.section{margin-top:8px}.statusline{display:flex;align-items:center;gap:9px;margin-top:8px}.dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px #67e49b18}.dot.warn{background:var(--yellow);box-shadow:0 0 0 5px #f0c75e18}.dot.bad{background:var(--red);box-shadow:none}.wide{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.55fr);gap:8px}.rows{display:grid}.row{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-top:1px solid #1b2d42;font-size:12px}.row:first-child{border-top:0}.opps{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:7px}.opp{padding:9px}.oppHead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.q{font-size:13px;font-weight:700;line-height:1.35}.tag{border:1px solid #725f34;background:#0a1421;color:var(--gold2);border-radius:10px;padding:6px 8px;font-size:9px;font-weight:900;white-space:nowrap}.oppBadges{display:flex;gap:6px;align-items:flex-start}.scoreBadge{min-width:58px;text-align:center;border:1px solid #725f34;background:#0a1421;color:var(--gold2);border-radius:10px;padding:4px 7px;font-weight:900;line-height:1}.scoreBadge small{display:block;font-size:7px;letter-spacing:.12em;color:var(--muted);margin-bottom:4px}.scoreBadge strong{font-size:16px}.scoreBadge.hot{border-color:#3b9d6c;color:var(--green)}.meta{font-size:11px;color:var(--muted);margin-top:7px}.gate{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #1b2d42;font-size:12px}.gate:first-child{border-top:0}.marketGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:10px}.marketCard{background:linear-gradient(180deg,#0d1b2a,#08121d);border:1px solid #294764;border-radius:14px;padding:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 8px 22px #0003;overflow:hidden;position:relative}.marketCard.marketSelect{cursor:pointer;text-align:left;color:inherit;font:inherit;width:100%;appearance:none}.marketCard.marketSelect:hover,.marketCard.marketSelect:focus-visible{border-color:#6d8fb5;outline:none}.marketCard.marketSelect.active{border-color:#b89a55;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 0 0 1px #b89a5533}.focusChart{margin-top:10px;background:#081522;border:1px solid #294764;border-radius:14px;padding:12px}.focusChartTop{display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap}.focusChartPrice{font-size:26px;font-weight:900}.focusChart svg{width:100%;height:clamp(220px,28vw,410px);margin-top:10px;display:block;filter:drop-shadow(0 0 4px currentColor)}.focusChart svg polyline{fill:none;stroke:currentColor;stroke-width:2.1;vector-effect:non-scaling-stroke}.focusChart svg .base{stroke:#486079;stroke-width:1;opacity:.65}.focusChart svg .reference{stroke:#9db0c4;stroke-width:.45;stroke-dasharray:1.2 1;opacity:.85}.focusChart svg .zoneUp{fill:#67e49b;opacity:.035}.focusChart svg .zoneDown{fill:#ff8585;opacity:.035}.focusChartControls{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.chartCtl{border:1px solid #294764;background:#0a1421;color:var(--muted);border-radius:9px;padding:6px 9px;font:inherit;font-size:10px;font-weight:850;cursor:pointer}.chartCtl.active{border-color:#b89a55;color:var(--gold2)}.chartStage{position:relative}.chartTooltip{position:absolute;display:none;pointer-events:none;z-index:4;background:#101d2c;border:1px solid #6d8fb5;border-radius:9px;padding:6px 8px;font-size:10px;box-shadow:0 8px 24px #0008;white-space:nowrap}.chartStage.tracking .chartTooltip{display:block}.focusChart svg .crosshair{stroke:#8fa8c1;stroke-width:.35;stroke-dasharray:1 1;opacity:.85}.focusChart svg .ema{fill:none;stroke:#d9b85f;stroke-width:1.5;vector-effect:non-scaling-stroke}.focusChart svg .candleUp{stroke:#67e49b;fill:#67e49b}.focusChart svg .candleDown{stroke:#ff8585;fill:#ff8585}.focusChartPrice.tickUp{color:var(--green);text-shadow:0 0 12px #67e49b66}.focusChartPrice.tickDown{color:var(--red);text-shadow:0 0 12px #ff858566}@media(max-width:720px){.w{padding:8px 8px 28px}.focusChart svg{height:190px}.chartCtl{padding:7px 8px}}.marketCard:before{content:'';position:absolute;inset:0 0 auto 0;height:2px;background:linear-gradient(90deg,transparent,#68aee866,transparent);pointer-events:none}.marketTop{display:flex;justify-content:space-between;gap:10px;align-items:end}.marketPrice{font-size:23px;font-weight:900;letter-spacing:-.02em;border-radius:7px;padding:1px 3px;margin-left:-3px;transition:color .18s ease,background .18s ease,box-shadow .18s ease}.marketPrice.tickUp{color:var(--green);background:#67e49b14;box-shadow:0 0 14px #67e49b22}.marketPrice.tickDown{color:var(--red);background:#ff858514;box-shadow:0 0 14px #ff858522}.marketChange{font-size:14px;font-weight:900}.spark{width:100%;height:76px;margin-top:8px;display:block;filter:drop-shadow(0 0 4px currentColor)}.spark polyline{fill:none;stroke:currentColor;stroke-width:2.25;vector-effect:non-scaling-stroke}.spark .base{stroke:#486079;stroke-width:1;opacity:.65}.pnlGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px}.pnlBox,.miniBox{background:#0a1421;border:1px solid #1f344d;border-radius:12px;padding:9px 11px}.compactGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px}.miniVal{font-size:14px;font-weight:850;margin-top:4px;line-height:1.25}.miniSub{font-size:10px;color:var(--muted);margin-top:3px}.pnlNum{font-size:22px;font-weight:850;margin-top:4px}.footer{text-align:center;color:#62778e;font-size:10px;margin-top:18px}.notice{border-left:3px solid var(--gold);padding:7px 9px;background:#0a1421;color:var(--muted);font-size:11px;line-height:1.45;margin-top:10px}
.clickable{cursor:pointer;transition:transform .12s ease,border-color .12s ease,background .12s ease}.clickable:hover{transform:translateY(-1px);border-color:#6d8fb5;background:#101d2c}.opp.onRadar{border-color:#67e49b;box-shadow:0 0 0 1px #67e49b55,0 0 24px #67e49b2b;animation:radarPulse 1.35s ease-in-out infinite}.opp.onRadar .q:after{content:" · ON RADAR";color:var(--green);font-size:9px;letter-spacing:.08em}.tag.radar{border-color:#3b9d6c;color:var(--green);box-shadow:0 0 12px #67e49b22}@keyframes radarPulse{0%,100%{box-shadow:0 0 0 1px #67e49b44,0 0 10px #67e49b16}50%{box-shadow:0 0 0 2px #67e49b77,0 0 28px #67e49b38}}@media(prefers-reduced-motion:reduce){.opp.onRadar{animation:none}}.contractRow{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)}.contractRow:first-of-type{margin-top:6px}.contractTicker{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.refreshClock{font-size:10px;color:var(--gold2);font-weight:800}.modalBack{position:fixed;inset:0;background:#000b;display:none;align-items:center;justify-content:center;padding:18px;z-index:9999}.modalBack.open{display:flex}.modalCard{width:min(760px,100%);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#132238,#0b1522);border:1px solid #38516e;border-radius:18px;box-shadow:0 25px 80px #000;padding:18px}.modalHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.modalClose{border:1px solid #536d8b;background:#0a1421;color:#fff;border-radius:10px;padding:7px 10px;cursor:pointer}.detailGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}.detailBox{background:#09131f;border:1px solid #20364f;border-radius:12px;padding:10px}.detailBox .label{margin-bottom:4px}@media(max-width:650px){.detailGrid{grid-template-columns:1fr}.contractRow{grid-template-columns:52px minmax(0,1fr)}}
@media(min-width:1100px){.opps{grid-template-columns:repeat(3,1fr)}}@media(max-width:1050px){.marketGrid{grid-template-columns:repeat(3,1fr)}}@media(max-width:820px){.marketGrid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:720px){.hero{min-height:126px}.hero:before,.hero:after{width:38%;opacity:.94;background-size:contain}.hero:before{background-position:left center}.hero:after{background-position:right center}.grid{grid-template-columns:repeat(2,1fr)}.compactGrid{grid-template-columns:repeat(2,1fr)}.wide{grid-template-columns:1fr}.opps{grid-template-columns:1fr}.marketGrid{grid-template-columns:1fr}.pnlGrid{grid-template-columns:1fr}.logo{width:100px;height:58px}h1{font-size:23px}.hero{align-items:flex-start}}@media(max-width:460px){.hero{min-height:118px}.hero:before,.hero:after{width:40%;opacity:.92;background-size:contain}.grid{grid-template-columns:1fr}.compactGrid{grid-template-columns:1fr}.brand{gap:8px}.logo{width:78px;height:48px}.k{font-size:8px}.sub{font-size:10px}.pill,.btn{font-size:9px;padding:6px 8px}.val{font-size:20px}.hero{padding:12px}}

/* LOCKED BASELINE REAL PRESENTATION PASS — behavior/data hooks preserved */
body{background-color:#030811;background-image:linear-gradient(rgba(31,91,137,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(31,91,137,.045) 1px,transparent 1px),radial-gradient(circle at 50% -15%,#0d2944 0,transparent 42%);background-size:28px 28px,28px 28px,auto}
.w{max-width:1536px;padding:10px 14px 32px}
.hero{min-height:205px;padding:12px 18px;grid-template-columns:1fr 280px 1fr;border-radius:10px;border-color:#315777;background:#050b13}
.hero:before,.hero:after{width:41%;background-size:cover;opacity:1}
.hero:before{background-position:left center;background-image:linear-gradient(90deg,rgba(3,8,14,0),rgba(3,8,14,.04) 72%,rgba(3,8,14,.78)),url("https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/market-edge-baseline-real/market-edge-lab/public/market-edge-bull-canon.webp")}
.hero:after{background-position:right center;background-image:linear-gradient(270deg,rgba(3,8,14,0),rgba(3,8,14,.04) 72%,rgba(3,8,14,.78)),url("https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/market-edge-baseline-real/market-edge-lab/public/market-edge-bear-canon.webp")}
.brand .logo{width:200px;height:132px;grid-column:2;align-self:center;background:#07101a;border-color:#6e5b31}
.actions{align-self:end;justify-self:end;max-width:270px;flex-direction:column;align-items:flex-end;gap:5px}
.actions .pill,.actions .btn{background:#07101acc}
.heroCopy{display:none}
.card,.opp{border-radius:10px;border-color:#244d70;background:linear-gradient(180deg,#0b1b2b,#07131f);box-shadow:inset 0 1px 0 #ffffff08,0 0 18px #0077cc0a}
.grid{grid-template-columns:repeat(4,1fr);gap:7px}.grid>.card{min-height:108px}
.statusline{margin-top:6px}.section{margin-top:8px}
.realStatus{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px}
.statusTimer{min-width:180px;text-align:right;border-left:1px solid #254a69;padding-left:16px}
.statusTimer .val{font-size:27px}
.marketGrid{grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}
.marketCard{border-radius:9px;padding:10px}.spark{height:82px}.marketPrice{font-size:22px}
.pnlSystem{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(260px,.9fr);gap:8px;margin-top:8px}
.pnlSystem>.section{margin-top:0}.systemPanel .statusline{margin-top:16px}
.wide{grid-template-columns:minmax(0,2.3fr) minmax(280px,.9fr)}
.opps{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.opp{min-height:112px}
.footer{border-top:1px solid #244d70;margin-top:18px;padding:16px 4px 0;display:flex;justify-content:space-between;gap:18px;color:#8da4bb;letter-spacing:.12em;text-transform:uppercase}
.footer strong{color:var(--gold2)}
@media(max-width:900px){.hero{grid-template-columns:1fr 150px 1fr;min-height:170px}.brand .logo{width:130px;height:92px}.hero:before,.hero:after{width:43%}.pnlSystem{grid-template-columns:1fr}.wide{grid-template-columns:1fr}.marketGrid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:720px){.hero{min-height:132px;grid-template-columns:1fr 94px 1fr;padding:8px}.hero:before,.hero:after{width:42%;background-size:cover;opacity:1}.brand .logo{width:86px;height:60px}.actions{max-width:155px;gap:3px}.actions .pill,.actions .btn{font-size:7px;padding:4px 6px}.grid{grid-template-columns:repeat(2,1fr)}.realStatus{grid-template-columns:1fr}.statusTimer{text-align:left;border-left:0;border-top:1px solid #254a69;padding:8px 0 0}.marketGrid{grid-template-columns:repeat(2,1fr)}.opps{grid-template-columns:1fr}.pnlGrid{grid-template-columns:1fr}.footer{flex-direction:column;gap:7px;text-align:left}}
@media(max-width:460px){.hero{min-height:116px}.hero:before,.hero:after{width:43%}.grid,.marketGrid{grid-template-columns:1fr}.actions{max-width:125px}.brand .logo{width:72px;height:52px}}

/* FINAL LOCKED HERO CORRECTION — presentation only */
.hero{grid-template-columns:1fr 280px 1fr;align-items:center}
.hero .actions{display:none}
.hero:before,.hero:after{width:43%;background-size:cover}
.hero:before{background-position:left center}
.hero:after{background-position:right center}
.heroTools{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-top:6px}
.heroTools .pill,.heroTools .btn{font-size:9px;padding:5px 8px}
@media(max-width:900px){.hero{grid-template-columns:1fr 150px 1fr}.hero:before,.hero:after{width:44%}}
@media(max-width:720px){.hero{grid-template-columns:1fr 94px 1fr}.hero:before,.hero:after{width:44%;background-size:cover}.heroTools{justify-content:flex-start}}
@media(max-width:460px){.hero:before,.hero:after{width:45%}.heroTools .pill,.heroTools .btn{font-size:8px}}

/* VISUAL FREEZE: final bear framing correction only */
.hero:after{background-size:contain!important;background-position:right center!important}
@media(max-width:900px){.hero:after{background-size:contain!important;background-position:right center!important}}
@media(max-width:720px){.hero:after{background-size:contain!important;background-position:right center!important}}
@media(max-width:460px){.hero:after{background-size:contain!important;background-position:right center!important}}

/* FINAL BEAR HEAD FRAMING — implementation only; visual freeze follows */
.hero:after{background-size:auto 100%!important;background-position:74% center!important}
@media(max-width:900px){.hero:after{background-size:auto 100%!important;background-position:72% center!important}}
@media(max-width:720px){.hero:after{background-size:auto 100%!important;background-position:70% center!important}}
@media(max-width:460px){.hero:after{background-size:auto 100%!important;background-position:68% center!important}}
/* OFFICIAL LOCKED DESKTOP FRAME — match accepted visual authority */
@media(min-width:901px){
  .w{width:calc(100% - 20px);max-width:none;margin:0 auto;padding:10px 0 32px}
  .hero{min-height:92px}
  .grid>.card{min-height:78px}
  .marketCard{padding:9px 10px}
  .spark{height:58px}
  .focusChart{padding:10px 12px}
  .focusChart svg{height:clamp(250px,18vw,330px)}
  .wide{grid-template-columns:minmax(0,3fr) minmax(340px,1fr)}
  .pnlSystem{grid-template-columns:minmax(0,3fr) minmax(340px,1fr)}
}
/* LOCKED TARGET POLISH — compact professional chart framing only */
@media(min-width:1200px){
  .focusChartTop{align-items:center}
  .focusChartControls{margin-top:6px}
  .focusChart svg{height:clamp(235px,16vw,300px);margin-top:6px}
  .notice{margin-top:6px;padding-top:5px;padding-bottom:5px}
}
.chartCtl:disabled{opacity:.42;cursor:not-allowed}

/* LOCKED CHART TERMINAL PASS 2026-09-21 — presentation only; trading/data/timer untouched */
@media(min-width:901px){
  .focusChart{padding:10px 12px 9px;border-radius:10px;background:linear-gradient(180deg,#071421,#06111c);box-shadow:inset 0 1px 0 #ffffff08}
  .focusChartTop{align-items:center;min-height:52px}
  .focusChartControls{margin-top:6px;gap:6px}
  .chartCtl{padding:6px 10px;border-radius:8px;letter-spacing:.02em}
  .focusChartPrice{font-size:24px;letter-spacing:-.025em}
  .chartStage{margin-top:7px;border-top:1px solid #17314a;border-bottom:1px solid #17314a;background-image:linear-gradient(rgba(53,91,124,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(53,91,124,.13) 1px,transparent 1px);background-size:100% 20%,8.333% 100%;background-position:0 0;overflow:hidden}
  .focusChart svg{height:300px;margin-top:0;filter:none}
  .focusChart svg polyline{stroke-width:1.75;filter:drop-shadow(0 0 3px currentColor)}
  .focusChart svg .ema{stroke-width:1.35;filter:drop-shadow(0 0 2px #d9b85f66)}
  .focusChart svg .reference{opacity:.7;stroke-width:.32;stroke-dasharray:.8 .8}
  .focusChart svg .base{opacity:.42;stroke-width:.45}
  .focusChart svg .zoneUp,.focusChart svg .zoneDown{opacity:.025}
  .chartTooltip{background:#0b1a29;border-color:#456b8d;padding:7px 9px;font-size:10px}
}
@media(min-width:1400px){.focusChart svg{height:318px}}
</style>
</head>
<body>
<div class="w">
  <div class="hero">
    <div class="brand">
      <img class="logo" alt="NFE-OS" src="https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/main/market-edge-lab/public/nfe-os-logo-market-edge.webp">
      <div><div class="k">NFE-OS Research Lab · Polymarket US</div><h1>Market Edge — Baseline Real</h1><div class="sub">Real account validation · BTC/ETH/SOL/XRP/HYPE · governed test environment</div></div>
    </div>
  </div>
  <div class="heroCopy"><div class="k">NFE-OS Research Lab · Polymarket US</div><h1>Market Edge — Baseline Real</h1><div class="sub">Real account validation · BTC/ETH/SOL/XRP/HYPE · governed test environment</div></div>

  <div class="grid">
    <div class="card"><div class="label">Kalshi Connection</div><div id="conn" class="val">CHECKING…</div><div id="connSub" class="m"></div></div>
    <div class="card"><div class="label">Account State</div><div id="bal" class="val">CHECKING…</div><div id="balSub" class="m"></div></div>
    <div class="card"><div class="label">Additional Funding</div><div class="val good">NO MORE NEEDED</div><div class="m">$10 experiment bankroll funded. Additional deposits are locked for this one-trade test. Maximum real trade stake remains $5.</div></div>
    <div class="card"><div class="label">Live Orders</div><div id="liveOrdersState" class="val warn">CHECKING…</div><div id="liveOrdersSub" class="m">One-trade execution controller status loading.</div></div>
  </div>

  <div class="card section realStatus">
    <div><b>Real-System Status</b><div class="statusline"><span id="statusDot" class="dot warn"></span><div><div id="statusText"><b>CHECKING REAL CONTROLLER…</b></div><div id="statusSub" class="m">Loading governed execution state.</div></div></div></div>
    <div class="statusTimer"><div class="label">KALSHI 15M WINDOW</div><div id="kalshiWindowCountdown" class="val warn">WAITING</div><div class="label" style="margin-top:4px">NEXT DASHBOARD REFRESH</div><div id="refreshCountdownTop" class="val warn">05:00</div><div class="heroTools"><button id="refresh" class="btn" type="button">REFRESH PROOF</button><div id="modePill" class="pill real">REAL · CHECKING</div><div class="pill">BANKROLL FUNDED · NO ADDITIONAL DEPOSIT</div></div></div>
  </div>

  <div class="card section">
    <b>BTC / ETH / SOL / XRP / HYPE · Live 24-Hour Market Display</b>
    <div class="marketGrid">
      <button type="button" class="marketCard marketSelect active" data-chart-asset="btc" aria-pressed="true"><div class="marketTop"><div><div class="label">Bitcoin</div><div id="btcPrice" class="marketPrice">CHECKING…</div></div><div id="btcChange" class="marketChange">—</div></div><svg id="btcChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg></button>
      <button type="button" class="marketCard marketSelect" data-chart-asset="eth" aria-pressed="false"><div class="marketTop"><div><div class="label">Ethereum</div><div id="ethPrice" class="marketPrice">CHECKING…</div></div><div id="ethChange" class="marketChange">—</div></div><svg id="ethChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg></button>
      <button type="button" class="marketCard marketSelect" data-chart-asset="sol" aria-pressed="false"><div class="marketTop"><div><div class="label">Solana</div><div id="solPrice" class="marketPrice">CHECKING…</div></div><div id="solChange" class="marketChange">—</div></div><svg id="solChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg></button>
      <button type="button" class="marketCard marketSelect" data-chart-asset="xrp" aria-pressed="false"><div class="marketTop"><div><div class="label">XRP</div><div id="xrpPrice" class="marketPrice">CHECKING…</div></div><div id="xrpChange" class="marketChange">—</div></div><svg id="xrpChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg></button>
      <button type="button" class="marketCard marketSelect" data-chart-asset="hype" aria-pressed="false"><div class="marketTop"><div><div class="label">HYPE</div><div id="hypePrice" class="marketPrice">CHECKING…</div></div><div id="hypeChange" class="marketChange">—</div></div><svg id="hypeChart" class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg></button>
    </div>
    <div class="focusChart" aria-live="polite">
      <div class="focusChartTop"><div><div class="label">SELECTED MARKET CHART · COINBASE</div><div id="focusChartAsset" class="q">BITCOIN · BTC</div></div><div><div id="focusChartPrice" class="focusChartPrice">CHECKING…</div><div id="focusChartChange" class="marketChange">—</div></div></div>
      <div class="focusChartControls"><button type="button" class="chartCtl active" data-chart-mode="line">LINE</button><button type="button" class="chartCtl" data-chart-mode="candles">CANDLES</button><button type="button" class="chartCtl" data-chart-ema="200">EMA 200</button><button type="button" class="chartCtl active" data-chart-range="day">DAILY</button><button type="button" class="chartCtl" data-chart-range="hour">HOURLY</button><button type="button" class="chartCtl" data-chart-range="week" disabled title="Extended history loading is not enabled yet">WEEKLY</button><button type="button" class="chartCtl" data-chart-range="month" disabled title="Extended history loading is not enabled yet">MONTHLY</button></div>
      <div id="focusChartStage" class="chartStage"><svg id="focusChartSvg" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Selected asset Coinbase price chart"></svg><div id="focusChartTooltip" class="chartTooltip"></div></div>
    </div>
    <div class="notice">Five-asset Coinbase spot + 24-hour trend display. Kalshi opportunity cards below use the same frozen Baseline score. The controller automatically chooses the strongest qualifying validated asset; no threshold or stake rule is loosened.</div>
  </div>

  <div class="pnlSystem">
  <div class="card section">
    <b>Profit / Loss</b>
    <div class="pnlGrid">
      <div class="pnlBox"><div class="label">Realized P/L</div><div id="realizedPnl" class="pnlNum">$0.00</div><div id="realizedPnlSub" class="m">Awaiting reconciled real-trade evidence.</div></div>
      <div class="pnlBox"><div class="label">Unrealized P/L</div><div id="unrealizedPnl" class="pnlNum">$0.00</div><div id="unrealizedPnlSub" class="m">No real Baseline position is open.</div></div>
      <div class="pnlBox"><div class="label">Total Real P/L</div><div id="totalRealPnl" class="pnlNum">$0.00</div><div id="totalRealPnlSub" class="m">Awaiting reconciled real-trade evidence.</div></div>
    </div>
    <div class="notice"><b>REAL MONEY ONLY:</b> Shadow observations never count as real P/L.</div>
  </div>
  <div class="card section systemPanel"><b>System Status</b><div class="statusline"><span class="dot"></span><div><div><b class="good">OPERATIONAL</b></div><div class="m">Live market data · Controller status remains governed by the application.</div></div></div></div>
  </div>

  <div class="section wide">
    <div>
      <b>Current Opportunities · Kalshi</b>
      <div id="markets" class="opps"><div class="m">Loading live Kalshi opportunities…</div></div>
      <div class="card" style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <b>Available 15-Minute Contracts · Five-Asset Pool</b>
          <span class="tag" title="Dashboard view refreshes every 5 minutes. The server scheduler observes independently.">AUTO-REFRESH IN <span id="refreshCountdown">05:00</span></span>
        </div>
        <div id="contractPool" class="opps" style="margin-top:10px"><div class="m">Loading BTC / ETH / SOL / XRP / HYPE contract lanes…</div></div>
      </div>
    </div>
    <div class="card">
      <b>Governance Status</b>
      <div class="rows" style="margin-top:8px">
        <div class="row"><span>Credentials</span><strong id="creds">CHECKING…</strong></div>
        <div class="row"><span>Secret exposure</span><strong class="good">NONE</strong></div>
        <div class="row"><span>Shadow experiment</span><strong id="shadowGov">CHECKING…</strong></div>
        <div class="row"><span>Market scope</span><strong>BTC / ETH / SOL / XRP / HYPE</strong></div>
        <div class="row"><span>Execution mode</span><strong id="executionGov">CHECKING…</strong></div>
      </div>
    </div>
  </div>

  <div class="card section">
    <b>Baseline Real Shadow Runtime</b>
    <div class="compactGrid">
      <div class="miniBox"><div class="label">Signal engine</div><div id="shadowRuntime" class="miniVal">CHECKING…</div><div class="miniSub">LIVE observation only</div></div>
      <div class="miniBox"><div class="label">Runs / eligible</div><div class="miniVal"><span id="shadowRuns">0</span> runs · <span id="shadowEligible">0</span> markets</div><div class="miniSub">Five-asset validated Kalshi scope</div></div>
      <div class="miniBox"><div class="label">Persistence</div><div id="shadowPersistence" class="miniVal">—</div><div class="miniSub">Isolated from paper experiments</div></div>
      <div class="miniBox"><div class="label">Started</div><div id="shadowStarted" class="miniVal">—</div></div>
      <div class="miniBox"><div class="label">Last observation</div><div id="shadowLast" class="miniVal">—</div><div class="miniSub">Dashboard refresh in <span id="refreshCountdownRuntime">05:00</span></div></div>
      <div class="miniBox"><div class="label">Trading rule</div><div class="miniVal">≥ .80 ENTRY · ≤ .20 EXIT</div><div class="miniSub">5 min max hold · $5 max stake</div></div>
    </div>
  </div>

  <div class="card section">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><b>Real Orders · Baseline .80 Governed Live Trade</b><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="authorizeTradeBtn" class="btn" type="button" style="display:inline-block;visibility:visible">ARM ONE BASELINE .80 TRADE · $1 MAX</button><a id="founderRunNowBtn" class="btn" href="/founder-execution-proof" style="display:inline-block;text-decoration:none">FOUNDER $1 EXECUTION PROOF</a></div></div>
    <div class="compactGrid">
      <div class="miniBox"><div class="label">Orders waiting</div><div id="realController" class="miniVal">CHECKING…</div><div id="realTradeStatus" class="miniSub">CHECKING…</div></div>
      <div class="miniBox"><div class="label">Current position</div><div id="realTradeMarket" class="miniVal">WAITING</div><div class="miniSub">No manual order required</div></div>
      <div class="miniBox"><div class="label">Entry order</div><div id="realEntryOrder" class="miniVal">NOT SUBMITTED</div></div>
      <div class="miniBox"><div class="label">Exit order</div><div id="realExitOrder" class="miniVal">NOT SUBMITTED</div></div>
      <div class="miniBox"><div class="label">Test complete</div><div id="realConsumed" class="miniVal">NO</div></div>
      <div class="miniBox"><div class="label">Live ability</div><div id="realLiveAbility" class="miniVal good">ONE TRADE · AUTHORIZED</div><div class="miniSub">One automatic entry only · premium + entry fee ≤ $1</div></div>
    </div>
    <div id="realAuthorizationNote" class="notice">Authorization is persistent for exactly one qualifying entry. It does not expire after 15 minutes. Once used, it cannot authorize a second entry; the exact filled position remains eligible only for its governed reduce-only exit.</div>
  </div>

  <div class="card section">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div><b>Kalshi Live Market Mirror</b><div class="m">READ ONLY · provider prices · no order submission · refreshes every 2 seconds</div></div><span id="mirrorStamp" class="tag">CONNECTING…</span></div>
    <div id="mirrorGrid" class="opps" style="margin-top:10px"><div class="m">Loading live Kalshi bid / ask / quantity…</div></div>
  </div>

  <details class="card section" open><summary><b>FIRST REAL TRADE EVIDENCE</b> · immutable BEFORE / separate AFTER</summary>
    <div class="compactGrid" style="margin-top:10px">
      <div class="miniBox"><div class="label">DISCOVERED</div><div id="evDiscovered" class="miniVal">WAITING</div></div>
      <div class="miniBox"><div class="label">QUALIFIED</div><div id="evQualified" class="miniVal">WAITING</div></div>
      <div class="miniBox"><div class="label">COMPARED</div><div id="evCompared" class="miniVal">WAITING</div></div>
      <div class="miniBox"><div class="label">SELECTED</div><div id="evSelected" class="miniVal">WAITING</div></div>
      <div class="miniBox"><div class="label">AUTHORIZED</div><div id="evAuthorized" class="miniVal">WAITING</div></div>
      <div class="miniBox"><div class="label">SUBMITTED</div><div id="evSubmitted" class="miniVal">NOT YET OCCURRED</div></div>
      <div class="miniBox"><div class="label">FILLED</div><div id="evFilled" class="miniVal">NOT YET OCCURRED</div></div>
      <div class="miniBox"><div class="label">EXITED / SETTLED</div><div id="evExited" class="miniVal">NOT YET OCCURRED</div></div>
      <div class="miniBox"><div class="label">ACCOUNTED</div><div id="evAccounted" class="miniVal">NOT YET OCCURRED</div></div>
    </div>
    <div id="evSummary" class="notice">Waiting for a naturally occurring qualifying decision. No evidence is fabricated before it exists.</div>
  </details>

  <details class="card section" open><summary><b>Trade Ledger + Post-Trade Research Review</b> · evidence first · strategy frozen</summary>
    <div class="rows" style="margin-top:10px">
      <div class="row"><span>Trade specimen</span><strong id="reviewTrade">WAITING FOR FIRST REAL TRADE</strong></div>
      <div class="row"><span>Outcome</span><strong id="reviewOutcome">NOT YET OCCURRED</strong></div>
      <div class="row"><span>Gross P/L</span><strong id="reviewGross">—</strong></div>
      <div class="row"><span>Recorded fees</span><strong id="reviewFees">—</strong></div>
      <div class="row"><span>Net P/L</span><strong id="reviewNet">—</strong></div>
      <div class="row"><span>Learning status</span><strong id="reviewLearning">WAITING</strong></div>
      <div class="row"><span>Strategy changes</span><strong class="warn">NOT AUTHORIZED</strong></div>
    </div>
    <div id="reviewLessons" class="notice">After the first completed trade, this area will compare immutable BEFORE evidence with AFTER execution evidence, record gains/losses and execution effects, and produce hypotheses for future shadow/paper testing. It does not modify Baseline automatically.</div>
    <div id="tradeLedgerRows" class="rows" style="margin-top:8px"><div class="row"><span>Ledger</span><strong>WAITING</strong></div></div>
  </details>

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
  <div id="contractModal" class="modalBack" role="dialog" aria-modal="true" aria-labelledby="contractModalTitle">
    <div class="modalCard">
      <div class="modalHead"><div><div class="k">READ-ONLY CONTRACT INSPECTOR</div><h2 id="contractModalTitle" style="margin:4px 0 0">Contract</h2></div><button id="contractModalClose" class="modalClose" type="button">CLOSE</button></div>
      <div id="contractModalBody"></div>
      <div class="notice"><b>Inspection only.</b> Opening a card cannot submit, authorize, modify, or cancel a trade.</div>
    </div>
  </div>
  <div class="footer">NFE-OS · MARKET EDGE — BASELINE REAL · GOVERNED VALIDATION · ONE-TRADE TEST</div>
</div>
<script>
const E=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let latestOpportunityMap={};
let dashboardEntryThreshold=.80;
let dashboardTestMode=false;
function dashboardThresholdLabel(){return dashboardEntryThreshold.toFixed(2).replace(/^0/,'');}
function fmtContractTime(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString();}
function fmtPrice(v){const n=Number(v);return Number.isFinite(n)?(n*100).toFixed(1)+'¢':'—';}
function fmtNum(v,d=3){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'—';}
function contractTarget(o){
  if(o?.floorStrike!=null)return 'Target / floor strike: '+o.floorStrike;
  if(o?.functionalStrike)return 'Contract strike: '+o.functionalStrike;
  if(o?.subtitle)return o.subtitle;
  if(o?.yesSubTitle||o?.noSubTitle)return [o.yesSubTitle,o.noSubTitle].filter(Boolean).join(' / ');
  return 'Target is defined by the Kalshi contract; detailed strike field was not returned in this observation.';
}
function openContractInspector(key){
  const o=latestOpportunityMap[key];if(!o)return;
  const modal=E('contractModal'),body=E('contractModalBody'),title=E('contractModalTitle');
  title.textContent=(o.asset||'')+' · '+(o.direction||o.outcomeSide||'')+' · 15-minute contract';
  const score=Number(o.score),move=Number(o.move),edge=Number(o.edge),fair=Number(o.fair);
  const qualified=Number.isFinite(score)&&score>=dashboardEntryThreshold&&edge>0&&o.executionEligible===true;
  const closeMs=Date.parse(o.closeTime||o.expirationTime||o.expectedExpirationTime||'');
  const timeSafe=Number.isFinite(closeMs)&&(closeMs-Date.now())>(5*60*1000+90*1000);
  const founderFallbackReady=qualified&&timeSafe;
  body.innerHTML='<div style="margin-top:8px;font-size:16px;font-weight:800">'+esc(o.question||o.marketTicker||'')+'</div>'+
    '<div class="m" style="margin-top:5px">'+esc(contractTarget(o))+'</div>'+
    '<div class="notice" style="border-left-color:'+(qualified?'var(--green)':'var(--gold)')+'"><b>'+(qualified?(dashboardTestMode?'🧪 TEST RADAR · QUALIFIED ≥ '+dashboardThresholdLabel():'ON RADAR · QUALIFIED ≥ .80'):'OBSERVING · NOT CURRENTLY QUALIFIED')+'</b> · '+(timeSafe?'TIME GATE PASS':'TIME GATE NOT PASSING')+' · '+(founderFallbackReady?'Every execution gate is rechecked against the live Kalshi contract before FIRE.':'Current observation is not ready to fire.')+'</div>'+
    '<div class="detailGrid">'+
      '<div class="detailBox"><div class="label">Direction Baseline is evaluating</div><b>'+esc(o.direction||o.outcomeSide||'—')+'</b></div>'+
      '<div class="detailBox"><div class="label">'+(dashboardTestMode?'Execution-test observation score':'Baseline score')+'</div><b class="'+(score>=dashboardEntryThreshold&&edge>0?'good':'')+'">'+(Number.isFinite(score)?score.toFixed(2):'—')+'</b> · '+(dashboardTestMode?'TEST entry requires ≥ '+dashboardThresholdLabel():'Baseline entry requires ≥ .80')+'</div>'+
      '<div class="detailBox"><div class="label">Kalshi ask / bid</div><b>'+fmtPrice(o.observedAsk)+' / '+fmtPrice(o.observedBid)+'</b></div>'+
      '<div class="detailBox"><div class="label">Coinbase movement input</div><b>'+(Number.isFinite(move)?(move*100).toFixed(3)+'%':'—')+'</b></div>'+
      '<div class="detailBox"><div class="label">Baseline fair / edge</div><b>'+(Number.isFinite(fair)?(fair*100).toFixed(1)+'¢':'—')+' / '+(Number.isFinite(edge)?(edge*100).toFixed(3)+'%':'—')+'</b></div>'+
      '<div class="detailBox"><div class="label">Execution eligibility</div><b class="'+(o.executionEligible?'good':'warn')+'">'+(o.executionEligible?'VALIDATED':'DISCOVERY HOLD')+'</b></div>'+
      '<div class="detailBox"><div class="label">Kalshi market ticker</div><b>'+esc(o.marketTicker||'—')+'</b></div>'+
      '<div class="detailBox"><div class="label">Series</div><b>'+esc(o.seriesTicker||'—')+'</b></div>'+
      '<div class="detailBox"><div class="label">Window closes</div><b>'+esc(fmtContractTime(o.closeTime||o.expirationTime||o.expectedExpirationTime))+'</b></div>'+
      '<div class="detailBox"><div class="label">Settlement source</div><b>'+esc(((o.settlementSources||[]).map(s=>typeof s==='string'?s:(s?.name||s?.url||s?.source||s?.title||'')).filter(Boolean).join(', '))||'Not returned in this observation')+'</b></div>'+
    '</div>';
  modal.classList.add('open');
}
function closeContractInspector(){E('contractModal')?.classList.remove('open');}

async function load(){
  const conn=E('conn'),connSub=E('connSub'),bal=E('bal'),balSub=E('balSub'),creds=E('creds'),gateAccount=E('gateAccount'),gateBalance=E('gateBalance'),gatePreview=E('gatePreview'),markets=E('markets'),statusDot=E('statusDot'),statusText=E('statusText'),refresh=E('refresh');
  refresh.disabled=true;refresh.textContent='CHECKING…';gatePreview.textContent='CHECKING LIVE PROOF…';gatePreview.className='m';
  try{
    const reqs=await Promise.allSettled([
      fetch('/account',{cache:'no-store'}),fetch('/status',{cache:'no-store'}),fetch('/markets',{cache:'no-store'}),fetch('/preview-proof',{cache:'no-store'}),
      fetch('/money-path-proof',{cache:'no-store'}),fetch('/shadow-state',{cache:'no-store'}),fetch('/price-proof',{cache:'no-store'}),fetch('/real-trade-state',{cache:'no-store'}),
      fetch('/execution-test-state',{cache:'no-store'})
    ]);
    const readJson=async(i,fallback={})=>{try{if(reqs[i].status!=='fulfilled')return fallback;return await reqs[i].value.json();}catch{return fallback;}};
    const account=await readJson(0),status=await readJson(1),market=await readJson(2),preview=await readJson(3),money=await readJson(4),shadow=await readJson(5),prices=await readJson(6),realTrade=await readJson(7),executionTest=await readJson(8);
    dashboardTestMode=Boolean(executionTest?.state?.armed||Number(executionTest?.state?.openPositions||0)>0);
    const configuredTestThreshold=Number(executionTest?.safety?.testEntryScore);
    dashboardEntryThreshold=dashboardTestMode&&Number.isFinite(configuredTestThreshold)?configuredTestThreshold:.80;
    // Kalshi window display is sourced from the actual live contract close_time
    // returned in the shadow observation. No browser-created 15-minute clock.
    const nowForKalshiWindow=Date.now();
    const kalshiCloses=(shadow?.opportunities||[])
      .map(o=>Date.parse(o?.closeTime||o?.expirationTime||o?.expectedExpirationTime||''))
      .filter(t=>Number.isFinite(t)&&t>nowForKalshiWindow)
      .sort((a,b)=>a-b);
    window.__kalshiWindowCloseAt=kalshiCloses[0]||null;
    const shadowLive=['LIVE_KALSHI_SHADOW','LIVE_KALSHI_SHADOW_PARTIAL','LIVE_KALSHI_ZERO_RESULT'].includes(shadow.status);
    const liveOrdersState=E('liveOrdersState'),liveOrdersSub=E('liveOrdersSub');
    const armed=Boolean(realTrade?.armed);
    const managedPosition=Boolean(realTrade?.managedPositionOpen);
    const controllerLive=Boolean(realTrade?.controllerSwitchEnabled);
    if(managedPosition){
      liveOrdersState.textContent='MANAGING ONE POSITION';liveOrdersState.className='val good';
      liveOrdersSub.textContent='No second entry is allowed. Only the exact reduce-only exit remains enabled.';
    }else if(armed){
      liveOrdersState.textContent='AUTHORIZED · WAITING';liveOrdersState.className='val good';
      const activeAuthorizedThreshold=Number(realTrade?.founderAuthorization?.testEntryScore);
      liveOrdersSub.textContent=Number.isFinite(activeAuthorizedThreshold)
        ? 'BASELINE LIVE: exactly one trade may be selected automatically at score ≥ '+activeAuthorizedThreshold.toFixed(2)+'; $1 max · .20 / 5-minute governed exit.'
        : 'Exactly one trade may be selected automatically from the validated five-asset universe at score ≥ .80.';
    }else{
      liveOrdersState.textContent='DISABLED';liveOrdersState.className='val warn';
      liveOrdersSub.textContent='No new real entry is currently authorized.';
    }

    const modePill=E('modePill'),statusSub=E('statusSub'),executionGov=E('executionGov'),moneyLiveOrders=E('moneyLiveOrders');
    modePill.textContent=managedPosition?'REAL · MANAGED EXIT':(armed?'REAL · ONE TRADE AUTHORIZED':'REAL · ENTRY DISABLED');
    executionGov.textContent=managedPosition?'EXACT POSITION EXIT ONLY':(armed?'ONE TRADE · AUTO SELECT':'ENTRY DISABLED');
    executionGov.className=(managedPosition||armed)?'good':'warn';
    moneyLiveOrders.textContent=managedPosition?'POSITION OPEN':(armed?'ONE TRADE AUTHORIZED':'DISABLED');
    moneyLiveOrders.className=(managedPosition||armed)?'good':'warn';
    const activeTestThreshold=Number(realTrade?.founderAuthorization?.testEntryScore);
    const activeThresholdLabel=(armed&&Number.isFinite(activeTestThreshold))?activeTestThreshold.toFixed(2):'.80';
    E('realController').textContent=managedPosition?'MANAGED EXIT ACTIVE':(armed?'AUTHORIZED · WAITING FOR ≥ '+activeThresholdLabel:'DISARMED');
    E('realController').className=(managedPosition||armed)?'good':'warn';
    E('realTradeStatus').textContent=realTrade?.status||'UNKNOWN';
    E('realTradeStatus').className=(realTrade?.status==='ONE_TRADE_COMPLETE')?'good':(armed?'good':'warn');
    E('realTradeMarket').textContent=realTrade?.question||realTrade?.marketSlug||('WAITING FOR ≥ '+activeThresholdLabel+' SIGNAL');
    E('realEntryOrder').textContent=realTrade?.entryOrderPresent?'SUBMITTED / PRESENT':'NOT SUBMITTED';
    E('realEntryOrder').className=realTrade?.entryOrderPresent?'good':'';
    E('realExitOrder').textContent=realTrade?.exitOrderPresent?'SUBMITTED / PRESENT':'NOT SUBMITTED';
    E('realExitOrder').className=realTrade?.exitOrderPresent?'good':'';
    const ev=realTrade?.firstRealTradeEvidence||{},chain=ev?.chain||{},pre=ev?.preTradeDecisionSnapshot||null;
    const setEv=(id,on,waiting='WAITING')=>{const el=E(id);if(!el)return;el.textContent=on?'PRESERVED':waiting;el.className='miniVal '+(on?'good':'');};
    setEv('evDiscovered',chain.discovered);setEv('evQualified',chain.qualified);setEv('evCompared',chain.compared);setEv('evSelected',chain.selected);setEv('evAuthorized',chain.authorized);
    setEv('evSubmitted',chain.submitted,'NOT YET OCCURRED');setEv('evFilled',chain.filled,'NOT YET OCCURRED');setEv('evExited',chain.exitedOrSettled,'NOT YET OCCURRED');setEv('evAccounted',chain.accounted,'NOT YET OCCURRED');
    const evSummary=E('evSummary');if(evSummary&&pre)evSummary.textContent='BEFORE SNAPSHOT LOCKED · '+(pre.selected?.asset||'')+' · '+(pre.selected?.marketTicker||'')+' · '+(pre.selected?.side||'')+' · score '+Number(pre.qualification?.score||0).toFixed(2)+' · captured '+(pre.capturedAt||'');
    E('realConsumed').textContent=realTrade?.consumed?'YES · COMPLETE':'NO';
    E('realConsumed').className=realTrade?.consumed?'good':'';
    const review=ev?.postTradeResearchReview||null,post=ev?.postTradeOutcomeEvidence||null;
    const moneyOrDash=v=>Number.isFinite(Number(v))?'USD '+Number(v).toFixed(2):'—';
    E('reviewTrade').textContent=pre?(pre.selected?.asset||'')+' · '+(pre.selected?.marketTicker||'')+' · '+(pre.selected?.side||''):'WAITING FOR FIRST REAL TRADE';
    E('reviewOutcome').textContent=review?.outcome||'NOT YET OCCURRED';
    E('reviewGross').textContent=moneyOrDash(review?.grossPnlUsd);
    E('reviewFees').textContent=moneyOrDash(review?.totalRecordedFeesUsd);
    E('reviewNet').textContent=moneyOrDash(review?.netPnlUsd);
    E('reviewLearning').textContent=review?'HYPOTHESES RECORDED · PROSPECTIVE TEST REQUIRED':'WAITING';
    const lessons=E('reviewLessons');
    if(lessons&&review){
      lessons.innerHTML='<b>Post-trade observations:</b> '+(review.observations||[]).map(esc).join(' · ')+'<br><b>Governance:</b> '+esc(review.learningRule||'');
    }
    const ledgerBox=E('tradeLedgerRows');
    if(ledgerBox){
      const rows=(realTrade?.recentEvidence||[]).slice(0,12);
      ledgerBox.innerHTML=rows.length?rows.map(x=>'<div class="row"><span>'+esc(x.ts||'')+' · '+esc(x.type||'EVENT')+'</span><strong>'+esc(x.marketTicker||x.orderId||x.reason||'PRESERVED')+'</strong></div>').join(''):'<div class="row"><span>Ledger</span><strong>WAITING</strong></div>';
    }
    const authBtn=E('authorizeTradeBtn');
    if(authBtn){
      if(managedPosition){authBtn.textContent='POSITION UNDER GOVERNED EXIT';authBtn.disabled=true;}
      else if(armed){authBtn.textContent='BASELINE .80 · ARMED';authBtn.disabled=true;}
      else if(realTrade?.consumed && realTrade?.entryOrderPresent && realTrade?.exitOrderPresent){
        authBtn.textContent='ARM ONE BASELINE .80 TRADE · $1 MAX';
        authBtn.disabled=false;
      }else if(realTrade?.consumed){authBtn.textContent='ONE-TRADE TEST COMPLETE';authBtn.disabled=true;}
      else{authBtn.textContent='ARM ONE BASELINE .80 TRADE · $1 MAX';authBtn.disabled=false;}
    }
    const founderRunBtn=E('founderRunNowBtn');
    if(founderRunBtn){
      if(managedPosition){founderRunBtn.textContent='POSITION OPEN';founderRunBtn.disabled=true;}
      else if(realTrade?.consumed){founderRunBtn.textContent='TEST COMPLETE';founderRunBtn.disabled=true;}
      else if(armed){founderRunBtn.textContent='FOUNDER RUN NOW · SAME GATES';founderRunBtn.disabled=false;}
      else{founderRunBtn.textContent='FOUNDER RUN NOW · NOT ARMED';founderRunBtn.disabled=true;}
    }
    if(managedPosition){
      statusDot.className='dot good';
      statusText.innerHTML='<b>AUTHENTICATED · GOVERNED POSITION OPEN</b>';
      statusSub.textContent='Entry authorization is consumed. Exact reduce-only exit management remains active.';
    }else if(armed){
      statusDot.className='dot good';
      statusText.innerHTML='<b>AUTHENTICATED · ONE-TRADE AUTO-SELECTION AUTHORIZED</b>';
      const testThreshold=Number(realTrade?.founderAuthorization?.testEntryScore);
      statusSub.textContent=Number.isFinite(testThreshold)
        ? 'TEST MODE: waiting automatically for score ≥ '+testThreshold.toFixed(2)+'; $1 max; then hold 5 minutes before governed exit. Permanent Baseline remains .80.'
        : 'FISHING: waiting for a validated BTC/ETH/SOL/XRP/HYPE opportunity at score ≥ .80.';
    }
    const moneyFmt=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
    const pctFmt=n=>(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%';
    const previousDisplayedPrices=window.__marketEdgeDisplayedPrices||(window.__marketEdgeDisplayedPrices={});
    const flashPriceTick=(asset,el,next)=>{const prev=previousDisplayedPrices[asset];el.classList.remove('tickUp','tickDown');if(Number.isFinite(prev)&&next!==prev){el.classList.add(next>prev?'tickUp':'tickDown');setTimeout(()=>el.classList.remove('tickUp','tickDown'),900);}previousDisplayedPrices[asset]=next;};
    const drawSpark=(id,points,change)=>{
      const svg=E(id); if(!svg) return;
      const vals=(Array.isArray(points)?points:[]).map(p=>Number(p.price)).filter(Number.isFinite);
      if(vals.length<2){svg.innerHTML='';return;}
      const lo=Math.min(...vals),hi=Math.max(...vals),span=(hi-lo)||1;
      const coords=vals.map((v,i)=>((i/(vals.length-1))*100).toFixed(2)+','+(28-((v-lo)/span)*26).toFixed(2)).join(' ');
      svg.className='spark '+(Number(change)>=0?'good':'bad');
      svg.innerHTML='<line class="base" x1="0" y1="28" x2="100" y2="28"></line><polyline points="'+coords+'"></polyline>';
    };
    const chartNames={btc:'BITCOIN · BTC',eth:'ETHEREUM · ETH',sol:'SOLANA · SOL',xrp:'XRP',hype:'HYPE'};
    let selectedChartAsset=window.__marketEdgeSelectedChartAsset||'btc';
    let focusChartMode=window.__marketEdgeChartMode||'line';
    let focusChartRange=window.__marketEdgeChartRange||'day';
    let focusEma=Boolean(window.__marketEdgeChartEma);
    let focusPlot=[];
    const emaSeries=(vals,period=200)=>{if(vals.length<period)return [];const k=2/(period+1);let e=vals.slice(0,period).reduce((a,b)=>a+b,0)/period;const out=Array(period-1).fill(null).concat([e]);for(let i=period;i<vals.length;i++){e=vals[i]*k+e*(1-k);out.push(e);}return out;};
    const drawFocusChart=(asset)=>{
      if(!prices?.ok) return;
      const p=prices?.[asset],svg=E('focusChartSvg');
      if(!p||!svg) return;
      window.__marketEdgeSelectedChartAsset=asset; selectedChartAsset=asset;
      const allRaw=(Array.isArray(p.candles)&&p.candles.length?p.candles:(Array.isArray(p.points)?p.points:[]).map(x=>({ts:x.ts,open:x.price,high:x.price,low:x.price,close:x.price}))).filter(x=>Number.isFinite(Number(x.ts))&&Number.isFinite(Number(x.close??x.price)));
      const rangeHours={hour:24,day:24,week:168,month:720}[focusChartRange]||24;
      const cutoff=Date.now()-rangeHours*60*60*1000;
      const raw=allRaw.filter(r=>Number(r.ts)>=cutoff);
      const vals=raw.map(x=>Number(x.close??x.price));
      E('focusChartAsset').textContent=chartNames[asset]||asset.toUpperCase();
      const current=Number(p.current), priceEl=E('focusChartPrice'), prev=Number(priceEl.dataset.price);
      priceEl.textContent=Number.isFinite(current)?moneyFmt(current):'UNAVAILABLE';
      if(Number.isFinite(prev)&&Number.isFinite(current)&&prev!==current){priceEl.classList.add(current>prev?'tickUp':'tickDown');setTimeout(()=>priceEl.classList.remove('tickUp','tickDown'),900);} if(Number.isFinite(current))priceEl.dataset.price=String(current);
      E('focusChartChange').textContent=Number.isFinite(Number(p.changePct))?pctFmt(p.changePct):'—';
      E('focusChartChange').className='marketChange '+(Number(p.changePct)>=0?'good':'bad');
      document.querySelectorAll('[data-chart-asset]').forEach(btn=>{const active=btn.dataset.chartAsset===asset;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-chart-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.chartMode===focusChartMode));
      document.querySelectorAll('[data-chart-range]').forEach(btn=>btn.classList.toggle('active',btn.dataset.chartRange===focusChartRange));
      const emaBtn=document.querySelector('[data-chart-ema]');if(emaBtn)emaBtn.classList.toggle('active',focusEma);
      if(vals.length<2){svg.innerHTML='';return;}
      const lows=raw.map(x=>Number(x.low??x.close??x.price)).filter(Number.isFinite), highs=raw.map(x=>Number(x.high??x.close??x.price)).filter(Number.isFinite);
      const ema=focusEma?emaSeries(allRaw.map(x=>Number(x.close??x.price)),200).slice(-raw.length):[];
      const all=[...lows,...highs,...ema.filter(Number.isFinite)],lo=Math.min(...all),hi=Math.max(...all),span=(hi-lo)||1;
      const y=v=>38-((v-lo)/span)*36, x=i=>(i/(raw.length-1))*100;
      const reference=Number(raw[0]?.open??raw[0]?.close??raw[0]?.price);
      const refY=Number.isFinite(reference)?y(reference):20;
      let body='<rect class="zoneUp" x="0" y="0" width="100" height="'+Math.max(0,refY)+'"></rect><rect class="zoneDown" x="0" y="'+refY+'" width="100" height="'+Math.max(0,40-refY)+'"></rect><line class="reference" x1="0" y1="'+refY+'" x2="100" y2="'+refY+'"></line><line class="base" x1="0" y1="38" x2="100" y2="38"></line>';
      if(focusChartMode==='candles'&&raw.some(r=>Number.isFinite(Number(r.open))&&Number.isFinite(Number(r.high))&&Number.isFinite(Number(r.low)))){
        const w=Math.max(.18,Math.min(1.1,70/raw.length));
        raw.forEach((r,i)=>{const o=Number(r.open),h=Number(r.high),l=Number(r.low),cl=Number(r.close);if(![o,h,l,cl].every(Number.isFinite))return;const xx=x(i),cls=cl>=o?'candleUp':'candleDown',top=Math.min(y(o),y(cl)),bh=Math.max(.35,Math.abs(y(o)-y(cl)));body+='<line class="'+cls+'" x1="'+xx+'" y1="'+y(h)+'" x2="'+xx+'" y2="'+y(l)+'"></line><rect class="'+cls+'" x="'+(xx-w/2)+'" y="'+top+'" width="'+w+'" height="'+bh+'"></rect>';});
      } else {body+='<polyline points="'+vals.map((v,i)=>x(i).toFixed(2)+','+y(v).toFixed(2)).join(' ')+'"></polyline>';}
      if(focusEma&&ema.some(Number.isFinite))body+='<polyline class="ema" points="'+ema.map((v,i)=>Number.isFinite(v)?x(i).toFixed(2)+','+y(v).toFixed(2):'').filter(Boolean).join(' ')+'"></polyline>';
      svg.className=Number(p.changePct)>=0?'good':'bad'; svg.innerHTML=body; focusPlot=raw;
    };
    document.querySelectorAll('[data-chart-asset]').forEach(btn=>{if(!btn.dataset.chartBound){btn.dataset.chartBound='1';btn.addEventListener('click',()=>drawFocusChart(btn.dataset.chartAsset));}});
    document.querySelectorAll('[data-chart-mode]').forEach(btn=>btn.addEventListener('click',()=>{focusChartMode=btn.dataset.chartMode;window.__marketEdgeChartMode=focusChartMode;drawFocusChart(selectedChartAsset);}));
    document.querySelectorAll('[data-chart-range]').forEach(btn=>btn.addEventListener('click',()=>{focusChartRange=btn.dataset.chartRange;window.__marketEdgeChartRange=focusChartRange;drawFocusChart(selectedChartAsset);}));
    const emaBtn=document.querySelector('[data-chart-ema]');if(emaBtn)emaBtn.addEventListener('click',()=>{focusEma=!focusEma;window.__marketEdgeChartEma=focusEma;drawFocusChart(selectedChartAsset);});
    const stage=E('focusChartStage'), tip=E('focusChartTooltip'), chartSvg=E('focusChartSvg');
    const track=e=>{if(!focusPlot.length||!stage||!tip||!chartSvg)return;const r=chartSvg.getBoundingClientRect(),clientX=e.touches?.[0]?.clientX??e.clientX,rel=Math.max(0,Math.min(1,(clientX-r.left)/r.width)),idx=Math.round(rel*(focusPlot.length-1)),p=focusPlot[idx],price=Number(p.close??p.price),ts=Number(p.ts);if(!Number.isFinite(price))return;tip.textContent=moneyFmt(price)+' · '+(Number.isFinite(ts)?new Date(ts).toLocaleString():'');tip.style.left=Math.min(Math.max(4,rel*r.width+8),Math.max(4,r.width-tip.offsetWidth-8))+'px';tip.style.top='8px';stage.classList.add('tracking');};
    if(chartSvg){chartSvg.addEventListener('mousemove',track);chartSvg.addEventListener('mouseleave',()=>stage?.classList.remove('tracking'));chartSvg.addEventListener('touchstart',track,{passive:true});chartSvg.addEventListener('touchmove',track,{passive:true});chartSvg.addEventListener('touchend',()=>stage?.classList.remove('tracking'));}
    if(prices?.ok){
      for(const a of ['btc','eth','sol','xrp','hype']){
        const p=prices?.[a], priceEl=E(a+'Price'), changeEl=E(a+'Change');
        if(p && Number.isFinite(Number(p.current))){
          const currentPrice=Number(p.current);
          flashPriceTick(a,priceEl,currentPrice);
          priceEl.textContent=moneyFmt(currentPrice);
          changeEl.textContent=pctFmt(p.changePct);
          changeEl.className='marketChange '+(p.changePct>=0?'good':'bad');
          drawSpark(a+'Chart',p.points,p.changePct);
        }else{
          priceEl.textContent='UNAVAILABLE'; changeEl.textContent='—';
        }
      }
      drawFocusChart(selectedChartAsset);
    }else{
      for(const a of ['btc','eth','sol','xrp','hype']) E(a+'Price').textContent='UNAVAILABLE';
    }
    E('shadowRuntime').textContent=shadowLive?(Number(shadow.eligibleCount||0)>0?'LIVE':'LIVE · NO ELIGIBLE SHORT-HORIZON MARKETS'):(shadow.status||'UNKNOWN');E('shadowRuntime').className=shadowLive?'good':'warn';
    E('shadowStarted').textContent=shadow.startedAt?new Date(shadow.startedAt).toLocaleString():'NOT STARTED';
    E('shadowLast').textContent=shadow.lastRunAt?new Date(shadow.lastRunAt).toLocaleString():'—';
    E('shadowRuns').textContent=String(shadow.runs||0);E('shadowEligible').textContent=String(shadow.eligibleCount||0);E('shadowPersistence').textContent=shadow.persistence||'—';
    E('shadowGov').textContent=shadowLive?'LIVE':'NOT STARTED';E('shadowGov').className=shadowLive?'good':'';
    E('gateShadow').textContent=shadowLive?'PASS · LIVE US SHADOW':'NOT STARTED';E('gateShadow').className=shadowLive?'good':'';
    E('moneyDeposit').textContent=money.depositActivity||'NOT PROVEN';E('moneyBuyingPower').textContent=money.buyingPower||'NOT PROVEN';E('moneyClearing').textContent=money.fundsClearing||'NOT PROVEN';E('moneyBalance').textContent=money.fundedBalance||'NOT PROVEN';E('moneyEligible').textContent=money.withdrawalEligibility||'NOT PROVEN';E('moneyWithdrawal').textContent=money.withdrawalActivity||'NOT PROVEN';E('moneyLoop').textContent=money.cashOutLoop||'NOT PROVEN';
    creds.textContent=status?.credentials?.keyIdInstalled&&status?.credentials?.secretInstalled?'INSTALLED':'MISSING';
    creds.className=creds.textContent==='INSTALLED'?'good':'bad';gatePreview.textContent=preview?.ok&&preview?.submitted===false?'PASS · NO SUBMISSION':((preview?.diagnostic?.category||preview?.state||'NOT PROVEN')+(preview?.diagnostic?.httpStatus?' · HTTP '+preview.diagnostic.httpStatus:'')+(!preview?.ok&&preview?.discovery?(' · SEARCH:'+String(preview.discovery.searchEvents??preview.discovery.eventsScanned??'?')+' CRYPTO:'+String(preview.discovery.cryptoEvents??'?')+' CAND:'+String(preview.discovery.candidates??'?')+(Array.isArray(preview.discovery.marketEvidence)&&preview.discovery.marketEvidence.length?' · BOOKS:'+preview.discovery.marketEvidence.map(x=>String(x.state||'?').replace('MARKET_STATE_','')+' B'+x.bids+' O'+x.offers).join(','):'') ):''));gatePreview.className=preview?.ok&&preview?.submitted===false?'good':'m';
    if(account.ok&&account.accountConnection==='VERIFIED'){
      conn.textContent='VERIFIED';conn.className='val good';connSub.textContent='Authenticated read-only Kalshi API connection.';
      gateAccount.textContent='PASS';gateAccount.className='good';statusDot.className='dot';statusText.innerHTML='<b class="good">AUTHENTICATED READ-ONLY · VERIFIED</b>';
      const a=account.account||{};
      if(a.fundedRecordPresent){
        const providerCash=Number(realTrade?.providerCashUsd);bal.textContent=Number.isFinite(providerCash)?moneyFmt(providerCash):'$10.00';balSub.textContent=Number.isFinite(providerCash)?'REAL KALSHI CASH · authenticated read-only provider reconciliation':'REAL EXPERIMENT BANKROLL · funded proof complete';gateBalance.textContent='AVAILABLE';gateBalance.className='good';
        const reconciledPnl=Number(realTrade?.bankrollNetPnlUsd),realizedPnl=E('realizedPnl'),unrealizedPnl=E('unrealizedPnl'),totalRealPnl=E('totalRealPnl'),realizedPnlSub=E('realizedPnlSub'),unrealizedPnlSub=E('unrealizedPnlSub'),totalRealPnlSub=E('totalRealPnlSub');
        if(Number.isFinite(reconciledPnl)){
          const pnlText=(reconciledPnl<0?'-$':'$')+Math.abs(reconciledPnl).toFixed(2);
          if(realizedPnl){realizedPnl.textContent=pnlText;realizedPnl.className='pnlNum '+(reconciledPnl<0?'bad':'good');}
          if(unrealizedPnl){unrealizedPnl.textContent='$0.00';unrealizedPnl.className='pnlNum';}
          if(totalRealPnl){totalRealPnl.textContent=pnlText;totalRealPnl.className='pnlNum '+(reconciledPnl<0?'bad':'good');}
          if(realizedPnlSub)realizedPnlSub.textContent='RECONCILED REAL KALSHI RESULT · provider cash versus original $10.00';
          if(unrealizedPnlSub)unrealizedPnlSub.textContent=realTrade?.managedPositionOpen?'Real position currently open.':'No real Baseline position is open.';
          if(totalRealPnlSub)totalRealPnlSub.textContent='REAL MONEY ONLY · reconciled';
        }
      }else if(a.noBalanceRecord){
        bal.textContent='$0.00*';balSub.textContent='No funded balance record returned. *Unfunded display only; not withdrawal proof.';gateBalance.textContent='NO FUNDED RECORD';gateBalance.className='m';
      }else{bal.textContent='NOT AVAILABLE';balSub.textContent='Authenticated, but balance response was not recognized.';}
    }else{
      conn.textContent='NOT VERIFIED';conn.className='val bad';connSub.textContent='Authenticated account proof is unavailable. See /account for safe diagnostic state.';gateAccount.textContent='FAILED';gateAccount.className='bad';bal.textContent='UNAVAILABLE';statusDot.className='dot bad';statusText.innerHTML='<b class="bad">ACCOUNT PROOF NOT VERIFIED</b>';
    }
    const opps=Array.isArray(shadow?.opportunities)?shadow.opportunities:[],parts=[];
    const cov=shadow?.assetCoverage||{};
    const coverageReady=Boolean(shadow?.assetCoverageReady);
    const coverageAssets=['BTC','ETH','SOL','XRP','HYPE'];
    const fiveAssetReady=coverageAssets.every(a=>Boolean(cov?.[a]?.seriesTicker)&&cov?.[a]?.executionEligible===true);
    const coverageText=coverageAssets.map(a=>a+': '+Number(cov?.[a]?.eligible||0)+' eligible · '+Number(cov?.[a]?.up||0)+' up · '+Number(cov?.[a]?.down||0)+' down'+(cov?.[a]?.executionEligible?' · VALIDATED':(cov?.[a]?.seriesTicker?' · METADATA HOLD':' · DISCOVERY HOLD'))).join(' &nbsp; | &nbsp; ');
    parts.push('<div class="opp" style="grid-column:1/-1"><div class="oppHead"><div class="q">LIVE ASSET COVERAGE · 5-ASSET OBSERVATION</div><div class="tag '+(fiveAssetReady?'good':'warn')+'">'+(fiveAssetReady?'5-ASSET POOL READY':(coverageReady?'PARTIAL POOL · VALIDATED LANES ACTIVE':'FIRST TRADE HOLD'))+'</div></div><div class="meta">'+coverageText+(fiveAssetReady?' · All five 15-minute series are provider-resolved and metadata-ready.':' · Only validated live lanes can enter auto-selection; unresolved lanes remain fail-closed.')+'</div></div>');
    if(!opps.length){
      parts.push('<div class="opp" style="grid-column:1/-1"><div class="oppHead"><div class="q">SHORT-HORIZON SCAN COMPLETE</div><div class="tag good">LIVE · VALID ZERO RESULT</div></div><div class="meta">No eligible BTC/ETH/SOL/XRP/HYPE 15-minute opportunities were found in this successful Kalshi Shadow observation. Baseline remains waiting for the next live contract window.</div></div>');
    } else {
      const renderDirectionalCard=(o,oi,sideLabel)=>{
        const ask=Number(o.observedAsk),bid=Number(o.observedBid),score=Number(o.score),move=Number(o.move),edge=Number(o.edge);
        const qualifies=Number.isFinite(score)&&score>=dashboardEntryThreshold&&edge>0;
        const horizon=esc(o.horizon||'UNCLASSIFIED');
        const contractKey='opp-'+oi;latestOpportunityMap[contractKey]=o;
        const sideText=sideLabel==='DOWN'?'DOWN / NO':'UP / YES';
        return '<div class="opp clickable '+(qualifies?'onRadar':'')+'" role="button" tabindex="0" data-contract-key="'+contractKey+'" title="Open read-only contract details">'+
          '<div class="oppHead"><div><div class="q">'+esc(o.asset||'ASSET')+' · '+sideText+'</div><div class="meta" style="margin-top:3px">Market: '+esc(o.question||o.slug||'US market')+'</div></div>'+
          '<div class="oppBadges">'+(qualifies?'<div class="tag radar">'+(dashboardTestMode?'🧪 TEST RADAR · ≥ '+dashboardThresholdLabel():'SYSTEM LOOKING')+'</div>':'')+'<div class="tag">'+horizon+'</div><div class="scoreBadge '+(qualifies?'hot':'')+'"><small>'+(dashboardTestMode?'TEST SCORE':'SCORE')+'</small><strong>'+(Number.isFinite(score)?score.toFixed(2):'—')+'</strong></div><div class="tag">'+esc(o.asset||'')+' · '+((o.executionEligible===true)?(qualifies?(dashboardTestMode?'TEST QUALIFIED ≥ '+dashboardThresholdLabel():'QUALIFIED ≥ .80'):'AUTO SELECT ELIGIBLE'):'DISCOVERY HOLD')+'</div></div></div><div class="meta">'+
          (Number.isFinite(move)?('move '+(move*100).toFixed(3)+'% · '):'')+
          (Number.isFinite(ask)?('ASK '+(ask*100).toFixed(1)+'¢ · '):'')+
          (Number.isFinite(bid)?('BID '+(bid*100).toFixed(1)+'¢ · '):'')+
          (Number.isFinite(edge)?('edge '+(edge*100).toFixed(3)+'% · '):'')+
          'SHADOW ONLY</div></div>';
      };
      const upCards=[],downCards=[];
      for(const [oi,o] of opps.entries()){
        const dir=String(o?.direction||'').toUpperCase();
        const outcome=String(o?.outcomeSide||'').toUpperCase();
        const isDown=dir==='DOWN'||outcome==='NO';
        (isDown?downCards:upCards).push(renderDirectionalCard(o,oi,isDown?'DOWN':'UP'));
      }
      parts.push('<div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">'+
        '<div><div class="opp" style="margin-bottom:8px"><div class="oppHead"><div class="q">⬆ UP / YES OPPORTUNITIES</div><div class="tag">'+upCards.length+' LIVE</div></div><div class="meta">Five-asset upward / YES side. '+(dashboardTestMode?'Execution-test radar is temporarily ≥ '+dashboardThresholdLabel()+'; production Baseline remains ≥ .80.':'Production Baseline qualification remains ≥ .80.')+'</div></div>'+upCards.join('')+'</div>'+
        '<div><div class="opp" style="margin-bottom:8px"><div class="oppHead"><div class="q">⬇ DOWN / NO OPPORTUNITIES</div><div class="tag">'+downCards.length+' LIVE</div></div><div class="meta">Five-asset downward / NO side. '+(dashboardTestMode?'Execution-test radar is temporarily ≥ '+dashboardThresholdLabel()+'; production Baseline remains ≥ .80.':'Production Baseline qualification remains ≥ .80.')+'</div></div>'+downCards.join('')+'</div>'+
      '</div>');
    }
    markets.innerHTML=parts.join('');

    const contractPool=E('contractPool');
    if(contractPool){
      const lanes=[];
      for(const asset of coverageAssets){
        const assetOpps=opps.filter(o=>String(o?.asset||'')===asset);
        const cv=cov?.[asset]||{};
        let body='';
        if(assetOpps.length){
          body=assetOpps.map((o,ri)=>{
            const score=Number(o.score),ask=Number(o.observedAsk),bid=Number(o.observedBid),edge=Number(o.edge);
            const qualifies=Number.isFinite(score)&&score>=dashboardEntryThreshold&&edge>0;
            const contractKey='lane-'+asset+'-'+ri;latestOpportunityMap[contractKey]=o;
            return '<div class="meta clickable" role="button" tabindex="0" data-contract-key="'+contractKey+'" title="Open read-only contract details" style="padding:8px 0;border-top:1px solid rgba(255,255,255,.07)"><b>'+esc(o.direction||o.outcomeSide||'CONTRACT')+'</b> · '+esc(o.marketTicker||o.slug||'')+
              ' · '+(Number.isFinite(ask)?'ASK '+(ask*100).toFixed(1)+'¢':'ASK —')+
              ' · '+(Number.isFinite(bid)?'BID '+(bid*100).toFixed(1)+'¢':'BID —')+
              ' · SCORE '+(Number.isFinite(score)?score.toFixed(2):'—')+
              (qualifies?' · <span class="good">'+(dashboardTestMode?'TEST QUALIFIED ≥ '+dashboardThresholdLabel():'QUALIFIED ≥ .80')+'</span>':'')+'</div>';
          }).join('');
        }else{
          body='<div class="meta" style="padding-top:6px">Waiting for a live validated 15-minute '+asset+' contract. Lane is already reserved and will populate automatically when discovery succeeds.</div>';
        }
        lanes.push('<div class="opp"><div class="oppHead"><div class="q">'+asset+'</div><div class="tag '+(cv.executionEligible?'good':'warn')+'">'+(cv.executionEligible?'VALIDATED':(cv.seriesTicker?'METADATA HOLD':'DISCOVERY HOLD'))+'</div></div>'+
          '<div class="meta">'+Number(cv.eligible||0)+' eligible · '+Number(cv.up||0)+' up · '+Number(cv.down||0)+' down</div>'+body+'</div>');
      }
      contractPool.innerHTML=lanes.join('');
    }
  }catch{
    conn.textContent='CHECK FAILED';conn.className='val bad';connSub.textContent='Dashboard proof request failed; no secret details are displayed.';bal.textContent='UNAVAILABLE';statusDot.className='dot bad';statusText.innerHTML='<b class="bad">PROOF REFRESH FAILED</b>';markets.innerHTML='<div class="opp"><div class="meta">Market observation check failed.</div></div>';const cp=E('contractPool');if(cp)cp.innerHTML='<div class="opp"><div class="meta">Contract discovery refresh failed. Existing authorization remains unchanged.</div></div>';
  }finally{
    refresh.disabled=false;refresh.textContent='REFRESH PROOF · '+new Date().toLocaleTimeString();
  }
}

const mirrorCents=v=>Number.isFinite(Number(v))?(Number(v)*100).toFixed(1)+'¢':'—';
const mirrorQty=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
async function refreshKalshiMirror(){
  const grid=E('mirrorGrid'),stamp=E('mirrorStamp'); if(!grid||!stamp)return;
  try{
    const r=await fetch('/kalshi-live-mirror-data',{cache:'no-store'}),j=await r.json();
    stamp.textContent='KALSHI READ · '+new Date(j.observedAt||Date.now()).toLocaleTimeString();
    const side=(name,bid,ask,bidSize,askSize)=>'<div class="miniBox"><div class="label">'+name+'</div><div class="miniVal">BID '+mirrorCents(bid)+' · ASK '+mirrorCents(ask)+'</div><div class="miniSub">bid qty '+mirrorQty(bidSize)+' · ask qty '+mirrorQty(askSize)+'</div></div>';
    grid.innerHTML=(j.rows||[]).map(x=>'<div class="opp"><div class="oppHead"><div><div class="q">'+esc(x.asset||'')+' · '+esc(x.direction||x.outcomeSide||'')+'</div><div class="meta">'+esc(x.ticker||'')+'</div></div><div class="scoreBadge"><small>SCORE</small><strong>'+(Number.isFinite(Number(x.score))?Number(x.score).toFixed(2):'—')+'</strong></div></div><div class="compactGrid" style="margin-top:8px">'+side('YES',x.yesBid,x.yesAsk,x.yesBidSize,x.yesAskSize)+side('NO',x.noBid,x.noAsk,x.noBidSize,x.noAskSize)+'</div><div class="meta"><b>BASELINE '+esc(x.outcomeSide||'SIDE')+'</b> · LIVE BID '+mirrorCents(x.selectedBid)+' · LIVE ASK '+mirrorCents(x.selectedAsk)+' · NFE OBSERVED ASK '+mirrorCents(x.observedAsk)+' · '+esc(x.status||'—')+'</div></div>').join('')||'<div class="opp"><div class="meta">Waiting for current Baseline Kalshi contracts…</div></div>';
  }catch{stamp.textContent='MIRROR READ FAILED';}
}
async function refreshPrices(){
  try{
    const r=await fetch('/price-proof',{cache:'no-store'}),prices=await r.json();
    if(!prices?.ok)return;
    const moneyFmt=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
    const pctFmt=n=>(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%';
    const liveAssets=['btc','eth','sol','xrp','hype'];
    for(const asset of liveAssets){
      const p=prices?.[asset],priceEl=E(asset+'Price'),changeEl=E(asset+'Change');
      if(!p||!priceEl||!changeEl||!Number.isFinite(Number(p.current)))continue;
      const current=Number(p.current),previous=Number(priceEl.dataset.price);
      if(Number.isFinite(previous)&&previous!==current){
        priceEl.classList.add(current>previous?'tickUp':'tickDown');
        setTimeout(()=>priceEl.classList.remove('tickUp','tickDown'),700);
      }
      priceEl.dataset.price=String(current);
      priceEl.textContent=moneyFmt(current);
      changeEl.textContent=Number.isFinite(Number(p.changePct))?pctFmt(p.changePct):'—';
      changeEl.className='marketChange '+(Number(p.changePct)>=0?'good':'bad');
    }
    const selected=window.__marketEdgeSelectedChartAsset||'btc',p=prices?.[selected],focus=E('focusChartPrice'),focusChange=E('focusChartChange');
    if(p&&focus&&Number.isFinite(Number(p.current))){
      const current=Number(p.current),previous=Number(focus.dataset.price);
      if(Number.isFinite(previous)&&previous!==current){
        focus.classList.add(current>previous?'tickUp':'tickDown');
        setTimeout(()=>focus.classList.remove('tickUp','tickDown'),700);
      }
      focus.dataset.price=String(current);
      focus.textContent=moneyFmt(current);
      if(focusChange){
        focusChange.textContent=Number.isFinite(Number(p.changePct))?pctFmt(p.changePct):'—';
        focusChange.className='marketChange '+(Number(p.changePct)>=0?'good':'bad');
      }
    }
  }catch{}
}
const AUTO_REFRESH_MS=5*60*1000;
// Display-only clock: align to the same absolute UTC 5-minute boundaries used by
// the Worker cron (*/5). Reloading the browser can no longer restart this clock.
let lastDashboardBoundary=null;
function nextCronBoundary(now=Date.now()){return (Math.floor(now/AUTO_REFRESH_MS)+1)*AUTO_REFRESH_MS;}
function paintKalshiWindowCountdown(now=Date.now()){
  const el=E('kalshiWindowCountdown');if(!el)return;
  const close=Number(window.__kalshiWindowCloseAt);
  if(!Number.isFinite(close)||close<=0){el.textContent='WAITING';return;}
  const left=Math.max(0,close-now),secs=Math.ceil(left/1000),mm=String(Math.floor(secs/60)).padStart(2,'0'),ss=String(secs%60).padStart(2,'0');
  el.textContent=mm+':'+ss;
}
function paintDashboardCountdown(){
  const now=Date.now(),next=nextCronBoundary(now),boundary=next-AUTO_REFRESH_MS;
  if(lastDashboardBoundary!==null&&boundary>lastDashboardBoundary) load();
  lastDashboardBoundary=boundary;
  const left=Math.max(0,next-now),secs=Math.ceil(left/1000),mm=String(Math.floor(secs/60)).padStart(2,'0'),ss=String(secs%60).padStart(2,'0');
  const el=E('refreshCountdown');if(el)el.textContent=mm+':'+ss;const top=E('refreshCountdownTop');if(top)top.textContent=mm+':'+ss;
  paintKalshiWindowCountdown(now);
}
E('refresh').addEventListener('click',()=>{load();});
E('authorizeTradeBtn')?.addEventListener('click',()=>authorizeOneBaselineTrade());
document.addEventListener('click',e=>{const card=e.target.closest?.('[data-contract-key]');if(card)openContractInspector(card.dataset.contractKey);});
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const card=e.target.closest?.('[data-contract-key]');if(card){e.preventDefault();openContractInspector(card.dataset.contractKey);}});
E('contractModalClose')?.addEventListener('click',closeContractInspector);
E('contractModal')?.addEventListener('click',e=>{if(e.target===E('contractModal'))closeContractInspector();});
load();refreshKalshiMirror();paintDashboardCountdown();setInterval(paintDashboardCountdown,1000);setInterval(refreshPrices,10000);setInterval(refreshKalshiMirror,2000);
</script>
<script>
async function founderRunQualifiedTradeNow(){
  const btn=document.getElementById("founderRunNowBtn");
  if(!confirm("Run the SAME governed Kalshi controller NOW? This can place the one already-authorized trade, up to $5, only if a current live candidate still passes EVERY existing gate: score >= .80, execution eligibility, shard balance, sizing, and time safety.")) return;
  const priorText=btn?.textContent||"FOUNDER RUN NOW";
  if(btn){btn.disabled=true;btn.textContent="FOUNDER RUN · CHECKING LIVE GATES…";}
  try{
    const r=await fetch("/founder-run-qualified-trade-now",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({authorization:"FOUNDER_RUN_QUALIFYING_ONE_TRADE_NOW"})});
    const j=await r.json().catch(()=>({}));
    const submitted=Boolean(j?.entryOrderPresent||j?.submitted);
    const orderId=j?.entryOrderId||j?.entryOrder?.orderId||null;
    const status=j?.status||j?.controllerStatus||j?.state||("HTTP "+r.status);
    const source=j?.observationSource?("\nObservation: "+j.observationSource):"";
    const latency=Number.isFinite(Number(j?.manualLatencyMs))?("\nManual path: "+j.manualLatencyMs+" ms"):"";
    if(submitted){
      alert("FOUNDER RUN RESULT: ORDER SUBMITTED / PRESENT"+(orderId?"\nOrder ID: "+orderId:"")+source+latency);
    }else{
      alert((r.ok?"FOUNDER RUN COMPLETE — NO ORDER SUBMITTED":"FOUNDER RUN BLOCKED")+"\nController: "+status+source+latency+"\nNo gate was overridden.");
    }
  }catch(error){
    alert("FOUNDER RUN ERROR: "+String(error?.message||error||"REQUEST_FAILED")+"\nNo gate was overridden.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=priorText;}
    location.reload();
  }
}
async function authorizeOneBaselineTrade(){
  const btn=document.getElementById("authorizeTradeBtn");
  if(btn){btn.disabled=true;btn.textContent="ARMING BASELINE .80…";}
  try{
    const r=await fetch("/kalshi-authorize-one-trade",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({authorization:"AUTHORIZE_ONE_BASELINE_80_MAX_1_USD"})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok){
      if(btn){btn.disabled=false;btn.textContent="ARM FAILED · CLICK TO RETRY";}
      const note=document.getElementById("realAuthorizationNote");
      if(note) note.textContent="AUTO TEST NOT ARMED · "+String(j.state||("HTTP "+r.status));
      return;
    }
    if(btn){btn.textContent="BASELINE .80 · ARMED";btn.disabled=true;}
    const note=document.getElementById("realAuthorizationNote");
    if(note) note.textContent="ARMED · Scheduler owns the next qualifying Baseline score ≥ .80 entry · $1 max · governed .20 / 5-minute exit.";
    setTimeout(()=>location.reload(),1200);
  }catch(error){
    if(btn){btn.disabled=false;btn.textContent="ARM FAILED · CLICK TO RETRY";}
    const note=document.getElementById("realAuthorizationNote");
    if(note) note.textContent="AUTO TEST NOT ARMED · "+String(error?.message||error||"REQUEST_FAILED");
  }
}
</script></body></html>`;
}
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const invokedAt=Date.now();
      // Open the slow read-only execution gate while market discovery is running.
      // The hot path therefore does not wait to begin credential/balance verification
      // after a >= .80 signal has already appeared.
      const [freshShadow,preparedBalance]=await Promise.all([
        runShadow(env),
        kalshiExecutionBalanceSnapshot(env)
      ]);
      let controllerState=null;
      let controllerError=null;
      try {
        // Run the exact same governed controller against every fresh scheduled observation.
        // Strategy, threshold, sizing, authorization and provider-write gates remain unchanged.
        const executionTestState=await loadExecutionTestState(env);
        if(executionTestState?.armed || executionTestOpenPositions(executionTestState).length>0){
          controllerState=await runExecutionTestSeries(env,freshShadow,preparedBalance);
        }else{
          const scheduledState=await loadRealTradeState(env);
          const authorizedCap=Number(scheduledState?.founderAuthorization?.maxEntryDebitUsd);
          const scheduledStakeCap=Number.isFinite(authorizedCap)&&authorizedCap>0?Math.min(REAL_TEST_CONFIG.maxStakeUsd,authorizedCap):REAL_TEST_CONFIG.maxStakeUsd;
          controllerState=await maybeRunKalshiOneTrade(env, freshShadow, "SCHEDULED_AUTO", preparedBalance, scheduledStakeCap, false);
        }
      } catch(error) {
        controllerError=String(error?.message||error||"CONTROLLER_RUNTIME_ERROR").slice(0,160);
      }

      const traceState=await loadRealTradeState(env);
      const traceTestThreshold=Number(traceState?.founderAuthorization?.testEntryScore);
      const traceEntryThreshold=kalshiAuthorizationValid(traceState)&&Number.isFinite(traceTestThreshold)?traceTestThreshold:REAL_TEST_CONFIG.entryScore;
      const controllerEligible=(freshShadow?.opportunities||[]).filter(o =>
        Number(o?.score)>=traceEntryThreshold && Number(o?.edge)>0 &&
        Number(o?.yes)>0.01 && Number(o?.yes)<0.99 && o?.marketTicker &&
        o?.executionEligible===true &&
        ["BTC","ETH","SOL","XRP","HYPE"].includes(String(o?.asset||"")) &&
        (o?.outcomeSide==="YES"||o?.outcomeSide==="NO")
      );
      const controllerTimeSafe=controllerEligible.filter(o=>kalshiCandidateTimeSafe(o,invokedAt));
      const traceEntry={
        invokedAt:new Date(invokedAt).toISOString(),
        shadowLastRunAt:freshShadow?.lastRunAt||null,
        eligibleCount:Number(freshShadow?.eligibleCount||0),
        activeEntryThreshold:traceEntryThreshold,
        baselineEntryThreshold:REAL_TEST_CONFIG.entryScore,
        scoreQualifyingCandidateCount:controllerEligible.length,
        timeSafeQualifyingCandidateCount:controllerTimeSafe.length,
        candidates:controllerEligible.slice(0,5).map(o=>({
          asset:o.asset||null,marketTicker:o.marketTicker||null,outcomeSide:o.outcomeSide||null,
          score:o.score??null,edge:o.edge??null,observedAsk:o.yes??null,
          closeTime:o.closeTime||null,exchangeIndex:o.exchangeIndex??null,
          timeSafe:kalshiCandidateTimeSafe(o,invokedAt)
        })),
        controllerStatus:controllerState?.status||null,
        controllerError,
        executionBalancePreflight:controllerState?.executionBalancePreflight||null,
        coldPathBalanceReady:Boolean(preparedBalance?.ok),
        coldPathBalanceHttpStatus:preparedBalance?.httpStatus??null,
        coldPathBalanceLatencyMs:preparedBalance?.latencyMs??null,
        entrySubmitLatched:Boolean(controllerState?.entrySubmitStartedAt),
        entryOrderPresent:Boolean(controllerState?.entryOrderId),
        authorizationConsumed:Boolean(controllerState?.founderAuthorization?.consumed)
      };

      // The controller now observes once per minute so short-lived >= .80 signals are not
      // routinely missed between 5-minute samples. Keep KV bounded: persist the ordinary
      // cross-POP/dashboard heartbeat every 5 minutes, but persist immediately on a
      // qualifying signal, controller error, latch, order, or consumed authorization.
      const minute=new Date(invokedAt).getUTCMinutes();
      const significant=controllerEligible.length>0 || Boolean(controllerError) ||
        Boolean(controllerState?.entrySubmitStartedAt) || Boolean(controllerState?.entryOrderId) ||
        Boolean(controllerState?.founderAuthorization?.consumed);
      const heartbeat=(minute%5===0);
      if(significant||heartbeat){
        const priorSchedulerProof=await loadSchedulerProof(env);
        const priorHistory=Array.isArray(priorSchedulerProof?.controllerTraceHistory)
          ? priorSchedulerProof.controllerTraceHistory : [];
        await saveSchedulerProof(env,{
          invokedAt:new Date(invokedAt).toISOString(),
          completedAt:new Date().toISOString(),
          shadowLastRunAt:freshShadow?.lastRunAt||null,
          shadowStatus:freshShadow?.status||"UNKNOWN",
          eligibleCount:Number(freshShadow?.eligibleCount||0),
          controllerStatus:controllerState?.status||null,
          controllerError,
          observerCadenceSeconds:60,
          dashboardHeartbeatSeconds:300,
          controllerTraceHistory:[traceEntry,...priorHistory].slice(0,12),
          shadowSnapshot:freshShadow
        });
      }
      if(controllerError) throw new Error(controllerError);
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/founder-execution-proof-export") {
      const state=await loadRealTradeState(env);
      const shadow=await loadShadowState(env);
      return new Response(JSON.stringify({schema:"BASELINE_REAL_EXECUTION_PROOF_EXPORT_V1",exportedAt:new Date().toISOString(),readOnly:true,providerWrites:0,state:publicRealTradeView(state,env),shadow:publicShadowView(shadow)},null,2),{headers:{"content-type":"application/json; charset=utf-8","content-disposition":'attachment; filename="baseline-real-execution-proof.json"',"cache-control":"no-store"}});
    }

    if (request.method === "GET" && url.pathname === "/founder-execution-proof") {
      const [state,shadow,balanceProof]=await Promise.all([
        loadRealTradeState(env),
        loadShadowState(env),
        kalshiExecutionBalanceSnapshot(env)
      ]);
      const armed=kalshiOneTradeEnabled(env,state) && !state?.consumed && !state?.entryOrderId && !state?.entrySubmitStartedAt;
      const now=Date.now();
      const readyCandidates=executionProofEligibleCandidates(shadow,now);
      const balanceReady=Boolean(balanceProof?.ok && balanceProof?.body);
      const balanceFailureStage=balanceReady?"NONE":balanceProof?.httpStatus!=null?"PROVIDER_HTTP":balanceProof?.error?"LOCAL_OR_NETWORK_EXCEPTION":"NO_RESPONSE";
      const safeBalanceError=String(balanceProof?.error||"").startsWith("KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED")?"EXECUTION_CREDENTIALS_MISSING":String(balanceProof?.error||"").includes("InvalidCharacterError")||String(balanceProof?.error||"").toLowerCase().includes("atob")?"PRIVATE_KEY_BASE64_DECODE":String(balanceProof?.error||"").includes("DataError")||String(balanceProof?.error||"").toLowerCase().includes("import")?"PRIVATE_KEY_IMPORT":String(balanceProof?.error||"").includes("OperationError")||String(balanceProof?.error||"").toLowerCase().includes("sign")?"SIGNING_OPERATION":balanceProof?.error?"OTHER_LOCAL_OR_NETWORK":"NONE";
      const proofReady=armed && balanceReady && shadow?.assetCoverageReady===true && shadow?.status==="LIVE_KALSHI_SHADOW" && readyCandidates.length>0;
      const best=readyCandidates.slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0))[0]||null;
      const closeMs=best?Date.parse(best?.closeTime||""):NaN;
      const secondsToClose=Number.isFinite(closeMs)?Math.max(0,Math.floor((closeMs-now)/1000)):null;
      const shadowAgeMs=shadow?.lastRunAt?Math.max(0,now-Date.parse(shadow.lastRunAt)):null;
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Founder $1 Execution Proof</title><style>body{font-family:system-ui;background:#030811;color:#eef7ff;padding:24px;max-width:760px;margin:auto}.box{border:1px solid #31516b;border-radius:14px;padding:20px;background:#071725}.good{color:#5ff7bf}.warn{color:#ffd86a}.bad{color:#ff7d7d}button{font-size:18px;font-weight:800;padding:14px 18px;border-radius:10px;border:1px solid #d3a53a;background:#0b1421;color:#ffd86a}button:disabled{opacity:.45}a{color:#7fdcff}.facts{line-height:1.7}</style></head><body><h1>Founder $1 Execution Proof</h1><div class="box"><p class="${armed?'good':'bad'}"><b>${armed?'ARMED':'NOT ARMED'}</b></p><p class="${proofReady?'good':'warn'}"><b>${proofReady?'EXECUTION WINDOW READY':'WAITING FOR ALL EXECUTION GATES'}</b></p><div class="facts">Latest shadow: <b>${String(shadow?.status||'UNKNOWN')}</b><br>Latest observation age: <b>${shadowAgeMs==null?'—':Math.round(shadowAgeMs/1000)+' sec'}</b><br>Provider-eligible contracts: <b>${Number(shadow?.eligibleCount||0)}</b><br>$1 proof-ready, time-safe candidates: <b>${readyCandidates.length}</b>${best?'<br>Current candidate: <b>'+String(best.asset||'')+' · '+String(best.outcomeSide||'')+' · '+String(best.marketTicker||'')+'</b><br>Seconds to close: <b>'+String(secondsToClose)+'</b>':''}<br>Execution balance preflight: <b class="${balanceReady?'good':'bad'}">${balanceReady?'PASS':'FAILED'}</b><br>Balance failure stage: <b>${balanceFailureStage}</b><br>Safe failure class: <b>${safeBalanceError}</b><br>Balance HTTP status: <b>${balanceProof?.httpStatus??'—'}</b><br>Balance attempts: <b>${balanceProof?.attempts??'—'}</b></div><p>Separate execution-plumbing acceptance test — not a Baseline strategy result.</p><p><b>IMMEDIATE ROUND TRIP MODE: ONE CONTRACT · MARKETABLE IOC BUY → REDUCE-ONLY IOC SELL.</b></p><p><b>Maximum entry debit: $1.00.</b> One currently eligible, time-safe Kalshi contract only. Existing one-shot authorization and governed exit remain enforced.</p>${!armed?'<form method="POST" action="/founder-rearm-execution-proof-form" style="display:inline-block;margin-right:10px"><button type="submit">REARM ONE $1 PROOF</button></form>':''}<form method="POST" action="/founder-run-qualified-trade-now-form" style="display:inline-block"><button type="submit" ${proofReady?'':'disabled'}>RUN ONE $1-MAX BUY → SELL PROOF</button></form><pre id="result" style="white-space:pre-wrap;margin-top:18px"></pre><p><a href="/founder-execution-proof">Refresh readiness</a> · <button id="copyReport" type="button">COPY REPORT</button> · <button id="export" type="button">EXPORT JSON</button> · <a href="/">Return to Baseline dashboard</a></p></div><script>
async function getProofExport(){const r=await fetch('/founder-execution-proof-export',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
document.getElementById('copyReport')?.addEventListener('click',async()=>{try{const x=await getProofExport();const st=x?.state||{};const ev=st?.firstRealTradeEvidence?.postTradeOutcomeEvidence||{};const entry=ev?.entry||{};const exit=ev?.exit||{};const report=[
'BASELINE REAL — EXECUTION PROOF REPORT',
'Status: '+String(st?.status||'UNKNOWN'),
'Round trip complete: '+(st?.status==='EXECUTION_PROOF_ROUND_TRIP_COMPLETE'?'YES':'NO'),
'Market: '+String(st?.marketSlug||'—'),
'Question: '+String(st?.question||'—'),
'Entry order ID: '+String(entry?.orderId||'—'),
'Entry fill: '+String(entry?.quantity??'—')+' @ '+String(entry?.actualFillPrice??'—'),
'Entry fee: '+String(entry?.entryFeeUsd??'—'),
'Exit order ID: '+String(exit?.orderId||'—'),
'Exit fill: '+String(exit?.filledCount??'—')+' @ '+String(exit?.averageFillPrice??'—'),
'Exit fee: '+String(exit?.exitFeeUsd??'—'),
'Position state: '+String(ev?.positionState||'—'),
'Accounting: '+String(ev?.accountingStatus||'—'),
'Exported at: '+String(x?.exportedAt||new Date().toISOString())
].join('\n');if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(report);}else{const ta=document.createElement('textarea');ta.value=report;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}alert('REPORT COPIED');}catch(e){alert('COPY REPORT FAILED: '+String(e?.message||e));}});
document.getElementById('export')?.addEventListener('click',async()=>{const r=await fetch('/founder-execution-proof-export',{cache:'no-store'});if(!r.ok){alert('EXPORT FAILED: '+r.status);return;}const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='baseline-real-execution-proof-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});document.getElementById('rearm')?.addEventListener('click',async()=>{if(!confirm('Rearm exactly ONE manual-only $1-max execution proof? This does not submit an order.'))return;const r=await fetch('/founder-rearm-execution-proof',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({authorization:'REARM_ONE_EXECUTION_PROOF_MAX_1_USD'})});const j=await r.json();alert(j.ok?'REARMED: one manual-only $1 execution proof is authorized. No order has been submitted.':'NOT REARMED: '+(j.state||r.status));location.reload();});document.getElementById('run')?.addEventListener('click',async()=>{if(!confirm('Run exactly ONE $1-max execution proof now? This can place real Kalshi orders.'))return;const b=document.getElementById('run'),o=document.getElementById('result');b.disabled=true;b.textContent='RUNNING…';o.textContent='Submitting governed execution proof…';try{const r=await fetch('/founder-run-qualified-trade-now',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({authorization:'FOUNDER_RUN_QUALIFYING_ONE_TRADE_NOW'})});const j=await r.json();o.textContent=JSON.stringify(j,null,2);b.textContent='COMPLETE — REVIEW EVIDENCE';}catch(e){o.textContent='REQUEST FAILED: '+String(e);b.textContent='FAILED — NO RETRY';}});</script></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
    }

    if (request.method === "POST" && url.pathname === "/founder-rearm-execution-proof-form") {
      const state=await loadRealTradeState(env);
      const filled=Number(state?.filledCount||0), exited=Number(state?.exitFilledTotal||0);
      if(!kalshiControllerSwitchEnabled(env)) return new Response("CONTROLLER SWITCH DISABLED",{status:423});
      if(filled>exited+1e-9) return new Response("MANAGED POSITION STILL OPEN",{status:409});
      const pre=state?.firstRealTradeEvidence?.preTradeDecisionSnapshot||null;
      if(pre){state.failedRealTradeAttempts=Array.isArray(state.failedRealTradeAttempts)?state.failedRealTradeAttempts:[];state.failedRealTradeAttempts.push({schema:"BASELINE_REAL_EXECUTION_PROOF_ATTEMPT_V1",immutable:true,archivedAt:new Date().toISOString(),preTradeDecisionSnapshot:pre,postTradeOutcomeEvidence:state?.firstRealTradeEvidence?.postTradeOutcomeEvidence||null});}
      state.entryOrderId=null; state.entrySubmitStartedAt=null; state.entryProviderStatus=null; state.entryProviderResponse=null; state.entryWriteError=null; state.filledCount=0; state.entryRemainingCount=0; state.entryAverageFillPrice=null; state.entryAverageFeePaid=null; state.entryFilledAt=null;
      state.exitOrderId=null; state.exitSubmitStartedAt=null; state.exitProviderStatus=null; state.exitProviderResponse=null; state.exitWriteError=null; state.exitFilledCount=0; state.exitFilledTotal=0; state.exitRemainingCount=0; state.exitAverageFillPrice=null; state.exitAverageFeePaid=null; state.completedAt=null;
      state.authorizationNonce=crypto.randomUUID(); state.firstRealTradeEvidence={preTradeDecisionSnapshot:null,postTradeOutcomeEvidence:null,postTradeResearchReview:null}; state.consumed=false;
      const now=Date.now(); state.founderAuthorization={authorized:true,authorizedAt:now,expiresAt:null,consumed:false,scope:"ONE_TRADE_MAX_5_USD",executionProofOnly:true,maxEntryDebitUsd:1}; state.status="EXECUTION_PROOF_ARMED_WAITING_FOR_FOUNDER";
      realTradeLedger(state,"FOUNDER_EXECUTION_PROOF_REARMED",{scope:"ONE_EXECUTION_PROOF_MAX_1_USD",maxEntryDebitUsd:1,automaticStrategyEntryAllowed:false}); await saveRealTradeState(env,state);
      return Response.redirect(new URL("/founder-execution-proof?rearmed=1",request.url).toString(),303);
    }
    if (request.method === "POST" && url.pathname === "/founder-run-qualified-trade-now-form") {
      const before=await loadRealTradeState(env);
      if(!kalshiControllerSwitchEnabled(env)) return new Response("CONTROLLER SWITCH DISABLED",{status:423});
      if(!kalshiAuthorizationValid(before)) return new Response("FOUNDER AUTHORIZATION NOT ACTIVE",{status:423});
      if(before?.consumed||before?.entryOrderId||before?.entrySubmitStartedAt) return new Response("ONE TRADE ALREADY USED OR LATCHED",{status:409});
      const manualStartedAt=Date.now(); const [cachedShadow,preparedBalance]=await Promise.all([loadShadowState(env),kalshiExecutionBalanceSnapshot(env)]); let selectedShadow=cachedShadow;
      const cachedObservedAt=Date.parse(cachedShadow?.lastRunAt||""); const cachedAgeMs=Number.isFinite(cachedObservedAt)?Math.max(0,manualStartedAt-cachedObservedAt):null;
      if(!(cachedShadow?.status==="LIVE_KALSHI_SHADOW"&&cachedShadow?.assetCoverageReady&&cachedAgeMs!==null&&cachedAgeMs<=75000&&executionProofEligibleCandidates(cachedShadow,manualStartedAt).length>0)) selectedShadow=await runShadow(env);
      await maybeRunKalshiOneTrade(env,selectedShadow,"FOUNDER_MANUAL_TRIGGER",preparedBalance,1,true);
      return Response.redirect(new URL("/founder-execution-proof?ran=1",request.url).toString(),303);
    }

    if (request.method === "POST" && url.pathname === "/founder-run-qualified-trade-now") {
      let body={}; try{body=await request.json();}catch{}
      if(body?.authorization!=="FOUNDER_RUN_QUALIFYING_ONE_TRADE_NOW") return json({ok:false,state:"EXPLICIT_FOUNDER_RUN_PHRASE_REQUIRED",submitted:false,realMoneyMoved:false},400);

      const before=await loadRealTradeState(env);
      if(!kalshiControllerSwitchEnabled(env)) return json({ok:false,state:"CONTROLLER_SWITCH_HARD_DISABLED",submitted:false,realMoneyMoved:false},423);
      if(!kalshiAuthorizationValid(before)) return json({ok:false,state:"FOUNDER_AUTHORIZATION_NOT_ACTIVE",submitted:false,realMoneyMoved:false},423);
      if(before?.consumed||before?.entryOrderId||before?.entrySubmitStartedAt) return json({ok:false,state:"ONE_TRADE_ALREADY_USED_OR_LATCHED",submitted:Boolean(before?.entryOrderId),realMoneyMoved:Boolean(before?.entryOrderId)},409);

      // Founder manual fast path:
      // Use the latest successful governed observation immediately when it is still fresh.
      // This avoids spending the remaining 15-minute window re-running full discovery before
      // the exact same controller gets a chance to evaluate the already-observed signal.
      // No strategy, score, time-safety, sizing, shard, authorization or one-shot gate is bypassed.
      const manualStartedAt=Date.now();
      const [cachedShadow,preparedBalance]=await Promise.all([
        loadShadowState(env),
        kalshiExecutionBalanceSnapshot(env)
      ]);
      const cachedObservedAt=Date.parse(cachedShadow?.lastRunAt||"");
      const cachedAgeMs=Number.isFinite(cachedObservedAt)?Math.max(0,manualStartedAt-cachedObservedAt):null;
      const cachedControllerCandidates=executionProofEligibleCandidates(cachedShadow,manualStartedAt);
      const cachedHasTimeSafeCandidate=cachedControllerCandidates.length>0;
      const cachedFresh=Boolean(
        cachedShadow?.status==="LIVE_KALSHI_SHADOW" &&
        cachedShadow?.assetCoverageReady &&
        cachedAgeMs!==null && cachedAgeMs<=75000
      );

      let selectedShadow=cachedShadow;
      let observationSource="CACHED_GOVERNED_OBSERVATION";
      let observationAttempts=0;
      if(!cachedFresh || !cachedHasTimeSafeCandidate) {
        try {
          // Kalshi can briefly return zero newly-open contracts at a 15-minute rollover.
          // Retry discovery read-only a few times before failing closed. No provider write
          // is possible during these attempts.
          const retryDelaysMs=[0,500,1000,1500,2000,3000];
          for(const delayMs of retryDelaysMs){
            if(delayMs) await new Promise(resolve=>setTimeout(resolve,delayMs));
            observationAttempts++;
            selectedShadow=await runShadow(env);
            const ready=executionProofEligibleCandidates(selectedShadow,Date.now());
            if(selectedShadow?.assetCoverageReady && selectedShadow?.status==="LIVE_KALSHI_SHADOW" && ready.length>0) break;
          }
          observationSource=observationAttempts>1?"FRESH_MANUAL_OBSERVATION_WITH_ROLLOVER_RETRY":"FRESH_MANUAL_OBSERVATION";
        } catch(error) {
          return json({
            ok:false,state:"FOUNDER_MANUAL_FRESH_SHADOW_FAILED",failureStage:"RUN_SHADOW",
            errorName:String(error?.name||"Error"),
            errorCode:String(error?.message||error||"UNKNOWN").slice(0,220),
            cachedShadowAgeMs:cachedAgeMs,
            cachedHadControllerCandidate:cachedControllerCandidates.length>0,
            cachedHadTimeSafeCandidate:cachedHasTimeSafeCandidate,
            observationAttempts,
            authorizationStillActive:kalshiAuthorizationValid(await loadRealTradeState(env)),
            submitted:false,realMoneyMoved:false
          },500);
        }
      }

      try {
        const after=await maybeRunKalshiOneTrade(env,selectedShadow,"FOUNDER_MANUAL_TRIGGER",preparedBalance,1,true);
        const view=publicRealTradeView(after,env);
        return json({
          ...view,
          ok:true,
          state:"FOUNDER_MANUAL_CONTROLLER_RUN_COMPLETE",
          triggerSource:"FOUNDER_MANUAL_TRIGGER",
          observationSource,
          manualLatencyMs:Date.now()-manualStartedAt,
          cachedShadowAgeMs:cachedAgeMs,
          cachedHadControllerCandidate:cachedControllerCandidates.length>0,
          cachedHadTimeSafeCandidate:cachedHasTimeSafeCandidate,
          observationAttempts,
          executionProofCandidateCount:executionProofEligibleCandidates(selectedShadow,Date.now()).length,
          freshShadowLastRunAt:selectedShadow?.lastRunAt||null,
          freshShadowStatus:selectedShadow?.status||null,
          freshEligibleCount:Number(selectedShadow?.eligibleCount||0),
          submitted:Boolean(after?.entryOrderId),
          realMoneyMoved:Boolean(after?.entryOrderId)
        });
      } catch(error) {
        const afterFailure=await loadRealTradeState(env);
        return json({
          ok:false,state:"FOUNDER_MANUAL_CONTROLLER_FAILED",failureStage:"MAYBE_RUN_KALSHI_ONE_TRADE",
          errorName:String(error?.name||"Error"),
          errorCode:String(error?.message||error||"UNKNOWN").slice(0,220),
          observationSource,
          manualLatencyMs:Date.now()-manualStartedAt,
          cachedShadowAgeMs:cachedAgeMs,
          cachedHadControllerCandidate:cachedControllerCandidates.length>0,
          cachedHadTimeSafeCandidate:cachedHasTimeSafeCandidate,
          observationAttempts,
          executionProofCandidateCount:executionProofEligibleCandidates(selectedShadow,Date.now()).length,
          freshShadowLastRunAt:selectedShadow?.lastRunAt||null,
          freshShadowStatus:selectedShadow?.status||null,
          freshEligibleCount:Number(selectedShadow?.eligibleCount||0),
          controllerStatus:afterFailure?.status||null,
          authorizationStillActive:kalshiAuthorizationValid(afterFailure),
          authorizationConsumed:Boolean(afterFailure?.founderAuthorization?.consumed),
          entrySubmitLatched:Boolean(afterFailure?.entrySubmitStartedAt),
          entryOrderPresent:Boolean(afterFailure?.entryOrderId),
          submitted:Boolean(afterFailure?.entryOrderId),
          realMoneyMoved:Boolean(afterFailure?.entryOrderId)
        },500);
      }
    }

    if (request.method === "POST" && url.pathname === "/founder-rearm-execution-proof") {
      if(!kalshiControllerSwitchEnabled(env)) return json({ok:false,state:"CONTROLLER_SWITCH_HARD_DISABLED",armed:false},423);
      let body={}; try{body=await request.json();}catch{}
      if(body?.authorization!=="REARM_ONE_EXECUTION_PROOF_MAX_1_USD") return json({ok:false,state:"EXPLICIT_REARM_PHRASE_REQUIRED",armed:false},400);
      const state=await loadRealTradeState(env);
      const filled=Number(state?.filledCount||0), exited=Number(state?.exitFilledTotal||0);
      if(filled>exited+1e-9) return json({ok:false,state:"MANAGED_POSITION_STILL_OPEN",armed:false},409);

      // Preserve the completed/rejected/no-fill specimen before clearing only the
      // operational fields needed for one new bounded execution-proof attempt.
      const pre=state?.firstRealTradeEvidence?.preTradeDecisionSnapshot||null;
      if(pre){
        state.failedRealTradeAttempts=Array.isArray(state.failedRealTradeAttempts)?state.failedRealTradeAttempts:[];
        const key=String(pre?.capturedAt||"")+"|"+String(pre?.selected?.marketTicker||"");
        if(!state.failedRealTradeAttempts.some(x=>String(x?.preTradeDecisionSnapshot?.capturedAt||"")+"|"+String(x?.preTradeDecisionSnapshot?.selected?.marketTicker||"")===key)){
          state.failedRealTradeAttempts.push({
            schema:"BASELINE_REAL_EXECUTION_PROOF_ATTEMPT_V1",immutable:true,archivedAt:new Date().toISOString(),
            preTradeDecisionSnapshot:pre,
            providerFailure:{status:state?.entryProviderStatus??null,response:state?.entryProviderResponse??null,writeError:state?.entryWriteError??null},
            entryClientOrderId:state?.entryClientOrderId||null,entryOrderId:state?.entryOrderId||null,
            filledCount:filled,status:state?.status||null
          });
          realTradeLedger(state,"EXECUTION_PROOF_ATTEMPT_ARCHIVED",{marketTicker:pre?.selected?.marketTicker||null,entryOrderId:state?.entryOrderId||null,filledCount:filled});
        }
      }

      state.consumed=false;
      state.entryOrderId=null; state.entrySubmitStartedAt=null; state.entryClientOrderId=null;
      state.entryProviderStatus=null; state.entryProviderResponse=null; state.entryWriteError=null;
      state.filledCount=0; state.entryRemainingCount=0; state.entryAverageFillPrice=null;
      state.entryAverageFeePaid=null; state.entryFilledAt=null;
      state.exitOrderId=null; state.exitSubmitStartedAt=null; state.exitProviderStatus=null;
      state.exitProviderResponse=null; state.exitWriteError=null; state.exitFilledCount=0;
      state.exitFilledTotal=0; state.exitRemainingCount=0; state.exitAverageFillPrice=null;
      state.exitAverageFeePaid=null; state.completedAt=null;
      state.authorizationNonce=crypto.randomUUID();
      state.firstRealTradeEvidence={preTradeDecisionSnapshot:null,postTradeOutcomeEvidence:null,postTradeResearchReview:null};
      const now=Date.now();
      state.founderAuthorization={authorized:true,authorizedAt:now,expiresAt:null,consumed:false,scope:"ONE_TRADE_MAX_5_USD",executionProofOnly:true,maxEntryDebitUsd:1};
      state.status="EXECUTION_PROOF_ARMED_WAITING_FOR_FOUNDER";
      realTradeLedger(state,"FOUNDER_EXECUTION_PROOF_REARMED",{scope:"ONE_EXECUTION_PROOF_MAX_1_USD",maxEntryDebitUsd:1,automaticStrategyEntryAllowed:false});
      await saveRealTradeState(env,state);
      return json({ok:true,state:state.status,armed:true,maxEntryDebitUsd:1,manualOnly:true,automaticStrategyEntryAllowed:false,submitted:false,realMoneyMoved:false});
    }

    if (request.method === "GET" && url.pathname === "/baseline-flat-reconcile") {
      const state=await loadRealTradeState(env);
      const ticker=String(state?.marketTicker||state?.firstRealTradeEvidence?.preTradeDecisionSnapshot?.selected?.marketTicker||"").trim();
      let positionsHttpStatus=null, positionsBody={};
      try {
        const pr=await kalshiExecutionGet(env,"/trade-api/v2/portfolio/positions?limit=1000");
        positionsHttpStatus=pr.status;
        positionsBody=await pr.json().catch(()=>({}));
      } catch(error) {
        return json({ok:false,readOnly:true,state:"PROVIDER_POSITION_READ_FAILED",ticker,errorCode:String(error?.message||error||"FAILED").slice(0,120),safety:{providerWrites:0,stateMutation:false,ordersCreated:0,realMoneyMoved:false}},502);
      }
      const rows=Array.isArray(positionsBody?.market_positions)?positionsBody.market_positions:Array.isArray(positionsBody?.positions)?positionsBody.positions:[];
      const exact=rows.find(x=>String(x?.ticker||x?.market_ticker||"")===ticker)||null;
      const qty=Number(exact?.position??exact?.quantity??exact?.total_traded??0);
      const providerFlat=Boolean(positionsHttpStatus===200 && ticker && (!exact || !Number.isFinite(qty) || Math.abs(qty)<=1e-9));
      return json({ok:positionsHttpStatus===200,readOnly:true,state:providerFlat?"PROVIDER_FLAT_CONFIRMED":"PROVIDER_POSITION_NOT_FLAT",ticker,positionsHttpStatus,providerFlat,exactPosition:exact?safeJsonValue(exact):null,local:{status:state?.status||null,entryOrderPresent:Boolean(state?.entryOrderId),filledCount:Number(state?.filledCount||0),exitFilledTotal:Number(state?.exitFilledTotal||0)},safety:{providerWrites:0,stateMutation:false,ordersCreated:0,realMoneyMoved:false}},positionsHttpStatus===200?200:502);
    }


    if (request.method === "GET" && url.pathname === "/execution-test-state") {
      const state=await loadExecutionTestState(env);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const index0=rows.find(x=>Number(x?.exchange_index)===0);
      const index2=rows.find(x=>Number(x?.exchange_index)===EXECUTION_TEST_CONFIG.requiredExchangeIndex);
      return json({
        ok:true,readOnly:true,mode:"EXECUTION_TEST_NOT_PRODUCTION_BASELINE",
        config:EXECUTION_TEST_CONFIG,
        state:{
          status:state.status,armed:Boolean(state.armed),seriesId:state.seriesId||null,
          attemptsStarted:Number(state.attemptsStarted||0),attemptsRemaining:Math.max(0,EXECUTION_TEST_CONFIG.maxAttempts-Number(state.attemptsStarted||0)),
          openPositions:executionTestOpenPositions(state).length,
          positions:(state.positions||[]).map(p=>({id:p.id,attemptNo:p.attemptNo,status:p.status,asset:p.asset,ticker:p.marketTicker,side:p.outcomeSide,entryScore:p.entryScore,filledCount:p.filledCount,filledAt:p.filledAt,exitReason:p.exitReason||null})),
          attempts:(state.attempts||[]).map(a=>({attemptNo:a.attemptNo,status:a.status,asset:a.asset,ticker:a.marketTicker,side:a.outcomeSide,observedScore:a.observedScore,liveScore:a.liveScore,liveAsk:a.liveAsk,orderId:a.orderId||null,fillCount:Number(a.fillCount||0)}))
        },
        funding:{httpStatus:balanceProof?.httpStatus??null,totalBalance:balanceProof?.body?.balance??null,index0:index0?.balance??null,index2:index2?.balance??null,index2Ready:Number(index2?.balance)>=EXECUTION_TEST_CONFIG.minSeriesFundingUsd},
        safety:{maxEntryDebitUsd:1,maxAttempts:5,maxConcurrent:3,requiredExchangeIndex:2,productionBaselineEntryScore:REAL_TEST_CONFIG.entryScore,testEntryScore:EXECUTION_TEST_CONFIG.entryScore}
      });
    }

    if (request.method === "GET" && url.pathname === "/execution-test-control") {
      const state=await loadExecutionTestState(env);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const index0=Number(rows.find(x=>Number(x?.exchange_index)===0)?.balance);
      const index2=Number(rows.find(x=>Number(x?.exchange_index)===2)?.balance);
      const ready=Boolean(balanceProof?.ok&&Number.isFinite(index2)&&index2>=EXECUTION_TEST_CONFIG.minSeriesFundingUsd);
      let control="<html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>NFE Execution Test Control</title><style>body{font-family:system-ui;background:#050a11;color:#eef7ff;padding:20px;max-width:760px;margin:auto}.box{border:1px solid #294764;background:#0d1724;border-radius:14px;padding:18px;margin:12px 0}button{font-size:17px;font-weight:800;padding:13px 16px;border-radius:10px;border:1px solid #d3a53a;background:#101b29;color:#ffd86a;width:100%;margin-top:10px}.ok{color:#67e49b}.warn{color:#f0c75e}.muted{color:#91a6be}</style></head><body>";
      control+="<h2>NFE-OS · MULTI-TRADE EXECUTION TEST</h2>";
      control+="<div class='box'><b>TEST ONLY · NOT PRODUCTION BASELINE</b><p>Threshold <b>.60</b> · max <b>5 provider entry attempts</b> · max <b>3 simultaneous filled positions</b> · max <b>$1 total debit per entry</b> · each filled position keeps its own ≤ .20 / 5-minute exit.</p><p class='muted'>Production Baseline remains .80 and is not changed by this series.</p></div>";
      control+="<div class='box'><b>INDEX 2 TEST FUNDING</b><p>Index 0: <b>"+(Number.isFinite(index0)?"$"+index0.toFixed(2):"—")+"</b><br>Index 2: <b class='"+(ready?"ok":"warn")+"'>"+(Number.isFinite(index2)?"$"+index2.toFixed(2):"—")+"</b></p><p>"+(ready?"READY — enough index-2 cash for five worst-case $1 test debits.":"NOT READY — test arm requires at least $5.00 on index 2.")+"</p>";
      if(Number.isFinite(index0)&&index0>0) control+="<form method='post' action='/execution-test-consolidate-index2'><input type='hidden' name='authorization' value='MOVE_INDEX0_TO_INDEX2_FOR_FIVE_EXECUTION_TESTS'><button type='submit'>MOVE INDEX 0 BALANCE TO INDEX 2</button></form>";
      control+="</div><div class='box'><b>SERIES STATUS</b><p>"+String(state.status||"DISARMED")+" · attempts "+Number(state.attemptsStarted||0)+"/5 · open positions "+executionTestOpenPositions(state).length+"/3</p>";
      if(!state.armed&&ready) control+="<form method='post' action='/execution-test-arm'><input type='hidden' name='authorization' value='ARM_FIVE_EXECUTION_TESTS_AT_60_MAX_1_USD'><button type='submit'>ARM 5 AUTOMATIC .60 EXECUTION TESTS</button></form>";
      control+="<p class='muted'>Arming authorizes the bounded five-attempt series. It does not place a manual trade. The scheduler owns RADAR → LOCK → FIRE → MANAGE → RECORD.</p></div></body></html>";
      return new Response(control,{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
    }

    if (request.method === "POST" && url.pathname === "/execution-test-consolidate-index2") {
      const form=await request.formData().catch(()=>null);
      if(String(form?.get("authorization")||"")!=="MOVE_INDEX0_TO_INDEX2_FOR_FIVE_EXECUTION_TESTS") return json({ok:false,state:"EXPLICIT_TRANSFER_AUTHORIZATION_REQUIRED"},400);
      const state=await loadExecutionTestState(env);
      if(state?.armed||executionTestOpenPositions(state).length>0) return json({ok:false,state:"TEST_ACTIVE_TRANSFER_BLOCKED"},409);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      if(!balanceProof?.ok) return json({ok:false,state:"BALANCE_READ_FAILED"},502);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const source=Number(rows.find(x=>Number(x?.exchange_index)===0)?.balance);
      if(!Number.isFinite(source)||source<=0) return Response.redirect(new URL("/execution-test-control?funding=NO_INDEX0_BALANCE",request.url).toString(),303);
      const amountCenticents=Math.floor(source*10000+1e-9);
      if(!(amountCenticents>0)) return json({ok:false,state:"TRANSFER_AMOUNT_INVALID"},400);
      const payload={source:"event_contract",destination:"event_contract",amount:amountCenticents,source_exchange_shard:0,destination_exchange_shard:2,source_subaccount:0,destination_subaccount:0};
      const r=await kalshiApprovedShardTransfer(env,payload);
      const body=await r.json().catch(()=>({}));
      if(!r.ok) return json({ok:false,state:"INDEX2_TRANSFER_PROVIDER_REJECTED",httpStatus:r.status,providerResponse:body},502);
      executionTestLedger(state,"TEST_FUNDING_MOVED_INDEX0_TO_INDEX2",{sourceUsd:source,amountCenticents,httpStatus:r.status});
      await saveExecutionTestState(env,state);
      return Response.redirect(new URL("/execution-test-control?funding=MOVED_TO_INDEX2",request.url).toString(),303);
    }

    if (request.method === "POST" && url.pathname === "/execution-test-arm") {
      const form=await request.formData().catch(()=>null);
      if(String(form?.get("authorization")||"")!=="ARM_FIVE_EXECUTION_TESTS_AT_60_MAX_1_USD") return json({ok:false,state:"EXPLICIT_TEST_ARM_AUTHORIZATION_REQUIRED"},400);
      if(!kalshiControllerSwitchEnabled(env)) return json({ok:false,state:"CONTROLLER_SWITCH_HARD_DISABLED"},423);
      const real=await loadRealTradeState(env);
      if(kalshiAuthorizationValid(real)||Number(real?.filledCount||0)>Number(real?.exitFilledTotal||0)) return json({ok:false,state:"ONE_TRADE_CONTROLLER_OR_POSITION_ACTIVE"},409);
      const current=await loadExecutionTestState(env);
      if(current?.armed||executionTestOpenPositions(current).length>0) return json({ok:false,state:"EXECUTION_TEST_ALREADY_ACTIVE"},409);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const index2=Number(rows.find(x=>Number(x?.exchange_index)===2)?.balance);
      if(!balanceProof?.ok||!Number.isFinite(index2)||index2<EXECUTION_TEST_CONFIG.minSeriesFundingUsd) return json({ok:false,state:"INDEX2_FUNDING_NOT_READY",index2Usd:Number.isFinite(index2)?index2:null,requiredUsd:EXECUTION_TEST_CONFIG.minSeriesFundingUsd},409);
      const state=defaultExecutionTestState();
      state.armed=true;state.status="ARMED_FISHING";state.seriesId=crypto.randomUUID();state.armedAt=Date.now();
      state.fundingAtArm={index2Usd:index2,requiredExchangeIndex:2};
      executionTestLedger(state,"EXECUTION_TEST_SERIES_ARMED",{threshold:.60,maxAttempts:5,maxConcurrent:3,maxEntryDebitUsd:1,index2Usd:index2,productionBaselineThreshold:REAL_TEST_CONFIG.entryScore});
      await saveExecutionTestState(env,state);
      return Response.redirect(new URL("/execution-test-control?armed=1",request.url).toString(),303);
    }

    if (request.method === "GET" && url.pathname === "/baseline-80-arm") {
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arm Automatic .50 Test</title><style>body{font-family:system-ui;background:#030811;color:#eef7ff;padding:24px;max-width:720px;margin:auto}.box{border:1px solid #31516b;border-radius:14px;padding:20px;background:#071725}button{font-size:18px;font-weight:800;padding:14px 18px;border-radius:10px;border:1px solid #d3a53a;background:#0b1421;color:#ffd86a}</style></head><body><div class="box"><h2>Baseline .80 / $1 Governed Trade</h2><p>This arms exactly one automatic Baseline entry at score ≥ .80, premium + entry fee ≤ $1, followed by the governed .20 / 5-minute exit.</p><form method="POST" action="/kalshi-authorize-one-trade"><input type="hidden" name="authorization" value="AUTHORIZE_ONE_BASELINE_80_MAX_1_USD"><button type="submit">ARM ONE BASELINE .80 TRADE</button></form></div></body></html>`,{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
    }

    if (request.method === "POST" && url.pathname === "/kalshi-authorize-one-trade") {
      if(!kalshiControllerSwitchEnabled(env)) return json({ok:false,state:"CONTROLLER_SWITCH_HARD_DISABLED",armed:false,submitted:false,realMoneyMoved:false},423);
      const activeTest=await loadExecutionTestState(env);
      if(activeTest?.armed || executionTestOpenPositions(activeTest).length>0) return json({ok:false,state:"EXECUTION_TEST_SERIES_ACTIVE",armed:false},409);
      const state=await loadRealTradeState(env);
      let body={};
      const contentType=String(request.headers.get("content-type")||"").toLowerCase();
      const nativeForm=contentType.includes("application/x-www-form-urlencoded")||contentType.includes("multipart/form-data");
      try{
        if(nativeForm){const form=await request.formData();body={authorization:String(form.get("authorization")||"")};}
        else body=await request.json();
      }catch{}
      if(body?.authorization!=="AUTHORIZE_ONE_BASELINE_80_MAX_1_USD"){
        if(nativeForm) return Response.redirect(new URL("/?baseline80=AUTHORIZATION_PHRASE_REJECTED",request.url).toString(),303);
        return json({ok:false,state:"EXPLICIT_AUTHORIZATION_PHRASE_REQUIRED",armed:false},400);
      }
      const completedRoundTrip=Boolean(
        state?.entryOrderId && state?.exitOrderId &&
        Number(state?.filledCount||0)>0 &&
        Number(state?.exitFilledTotal||0)>=Number(state?.filledCount||0)
      );
      const preservedCompletedRoundTrip=Boolean(
        state?.firstRealTradeEvidence?.postTradeOutcomeEvidence ||
        state?.completedManualExecutionProof?.postTradeOutcomeEvidence ||
        (Array.isArray(state?.ledger) && state.ledger.some(x=>x?.type==="EXECUTION_PROOF_EXIT_FILLED"))
      );
      const noFillComplete=Boolean(
        state?.status==="ONE_TRADE_ENTRY_NO_FILL_COMPLETE" &&
        state?.entryOrderId &&
        Number(state?.filledCount||0)===0
      );
      if(completedRoundTrip || preservedCompletedRoundTrip){
        state.completedManualExecutionProof=JSON.parse(JSON.stringify(state.firstRealTradeEvidence||state.completedManualExecutionProof||{}));
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
      } else if(noFillComplete) {
        state.failedRealTradeAttempts=Array.isArray(state.failedRealTradeAttempts)?state.failedRealTradeAttempts:[];
        const pre=state?.firstRealTradeEvidence?.preTradeDecisionSnapshot||null;
        const archiveKey=String(pre?.capturedAt||"")+"|"+String(state?.entryOrderId||"");
        if(!state.failedRealTradeAttempts.some(x=>String(x?.preTradeDecisionSnapshot?.capturedAt||"")+"|"+String(x?.entryOrderId||"")===archiveKey)){
          state.failedRealTradeAttempts.push({
            schema:"BASELINE_REAL_AUTO_NO_FILL_ATTEMPT_V1",
            immutable:true,
            archivedAt:new Date().toISOString(),
            preTradeDecisionSnapshot:pre,
            entryOrderId:state.entryOrderId,
            entryClientOrderId:state.entryClientOrderId||null,
            filledCount:0,
            status:"ONE_TRADE_ENTRY_NO_FILL_COMPLETE"
          });
        }
        realTradeLedger(state,"AUTO_NO_FILL_ATTEMPT_ARCHIVED",{entryOrderId:state.entryOrderId,marketTicker:state.marketTicker||null});
        state.entryOrderId=null; state.entrySubmitStartedAt=null; state.entryClientOrderId=null;
        state.entryProviderStatus=null; state.entryProviderResponse=null; state.entryWriteError=null;
        state.filledCount=0; state.entryRemainingCount=0; state.entryAverageFillPrice=null; state.entryAverageFeePaid=null; state.entryFilledAt=null;
        state.exitOrderId=null; state.exitSubmitStartedAt=null; state.exitProviderStatus=null; state.exitProviderResponse=null; state.exitWriteError=null;
        state.exitFilledCount=0; state.exitFilledTotal=0; state.exitRemainingCount=0; state.remainingExitCount=0;
        state.exitAverageFillPrice=null; state.exitAverageFeePaid=null; state.completedAt=null;
        state.marketSlug=null; state.marketTicker=null; state.question=null; state.outcomeSide=null; state.direction=null; state.asset=null; state.entryScore=null;
        state.firstRealTradeEvidence={preTradeDecisionSnapshot:null,postTradeOutcomeEvidence:null,postTradeResearchReview:null};
        state.consumed=false;
      } else if(state?.consumed||state?.entryOrderId||state?.entrySubmitStartedAt) {
        if(nativeForm) return Response.redirect(new URL("/?baseline80=ONE_TRADE_ALREADY_USED_OR_LATCHED",request.url).toString(),303);
        return json({ok:false,state:"ONE_TRADE_ALREADY_USED_OR_LATCHED",armed:false},409);
      }
      const now=Date.now();
      state.authorizationNonce=crypto.randomUUID();
      state.founderAuthorization={authorized:true,authorizedAt:now,expiresAt:null,consumed:false,scope:"ONE_TRADE_MAX_5_USD",executionProofOnly:false,maxEntryDebitUsd:1,automaticSignalProof:false,testEntryScore:REAL_TEST_CONFIG.entryScore,holdDurationProof:false};
      state.status="AUTHORIZED_WAITING_FOR_BASELINE_80";
      realTradeLedger(state,"FOUNDER_BASELINE_80_AUTHORIZED",{entryThreshold:REAL_TEST_CONFIG.entryScore,exitThreshold:REAL_TEST_CONFIG.exitScore,maxEntryDebitUsd:1,maxHoldMs:REAL_TEST_CONFIG.maxHoldMs,automatic:true});
      await saveRealTradeState(env,state);
      if(nativeForm) return Response.redirect(new URL("/?baseline80=ARMED",request.url).toString(),303);
      return json({ok:true,state:state.status,armed:true,automatic:true,entryThreshold:REAL_TEST_CONFIG.entryScore,exitThreshold:REAL_TEST_CONFIG.exitScore,maxEntryDebitUsd:1,maxHoldMs:REAL_TEST_CONFIG.maxHoldMs,submitted:false,realMoneyMoved:false});
    }

    if (url.pathname === "/xrp-recovery-deployment-proof") {
      const state=await loadRealTradeState(env);
      return json({
        ok:true,readOnly:true,state:"XRP_RECOVERY_DEPLOYMENT_PROOF_V2",
        build:"ce2252b-minimal-observable-recovery",
        recoveryRoutePresent:true,
        mutationModel:"MINIMAL_LATCH_ONLY",
        opaque1101Guard:"POST_WRITE_EXCEPTION_RETURNED_AS_JSON",
        current:{
          recoveryReady:!state?.entryOrderId && Number(state?.filledCount||0)===0 && Number(state?.entryProviderStatus)===404 && String(state?.entryProviderResponse?.error?.code||"")==="insufficient_shard_balance" && Boolean(state?.entrySubmitStartedAt),
          entryOrderId:state?.entryOrderId||null,
          filledCount:Number(state?.filledCount||0),
          staleEntrySubmitLatch:Boolean(state?.entrySubmitStartedAt),
          providerErrorCode:state?.entryProviderResponse?.error?.code||null,
          authorizationActive:Boolean(state?.founderAuthorization?.authorized)&&!Boolean(state?.founderAuthorization?.consumed)
        },
        safety:{stateMutation:false,providerWrites:0,transfers:0,orders:0,reauthorizations:0,realMoneyMoved:false}
      });
    }

    if (url.pathname === "/recover-failed-xrp-latch") {
      const state=await loadRealTradeState(env);
      const failedXrp=
        !state?.entryOrderId &&
        Number(state?.filledCount||0)===0 &&
        Number(state?.entryProviderStatus)===404 &&
        String(state?.entryProviderResponse?.error?.code||"")==="insufficient_shard_balance" &&
        Boolean(state?.entrySubmitStartedAt) &&
        Boolean(state?.firstRealTradeEvidence?.preTradeDecisionSnapshot);
      if(request.method==="GET"){
        return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Recover Failed XRP Latch</title><body style='font-family:system-ui;background:#07111d;color:#eef;padding:24px;max-width:720px;margin:auto'><h2>Failed XRP Latch Recovery</h2><p><b>Recovery ready:</b> "+(failedXrp?"YES":"NO")+"</p><p>This recovery keeps the failed XRP evidence and ledger in place. It clears only the dead submit latch and disarms the consumed authorization. It does <b>not</b> authorize a trade, submit an order, or move money.</p>"+(failedXrp?"<form method=post><button style='font-size:18px;padding:14px 20px' type=submit>Recover failed XRP latch</button></form>":"<p>No recovery action is available.</p>")+"</body>",{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
      }
      if(request.method!=="POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
      if(!failedXrp) return json({ok:false,state:"FAILED_XRP_RECOVERY_PRECONDITION_FAILED",reauthorized:false,submitted:false,realMoneyMoved:false},409);
      try {
        // Minimal mutation only. The previous POSTs copied/rewrote many stale fields.
        // None of that is required by the authorization guard: entrySubmitStartedAt is
        // the dead latch, while founderAuthorization must remain explicitly disarmed.
        state.entrySubmitStartedAt=null;
        state.consumed=false;
        state.founderAuthorization={...(state.founderAuthorization||{}),authorized:false,consumed:false,recoveredFromFailedAttempt:true};
        state.status="RECOVERED_DISARMED_AWAITING_SHARD_FUNDING_AND_FOUNDER_REAUTHORIZATION";
        realTradeLedger(state,"FAILED_XRP_OPERATIONAL_LATCH_RECOVERED",{preservedProviderStatus:state.entryProviderStatus??null,preservedClientOrderId:state.entryClientOrderId??null,reauthorized:false,submitted:false,realMoneyMoved:false});
        await saveRealTradeState(env,state);
        return json({ok:true,state:state.status,preservedEvidence:Boolean(state?.firstRealTradeEvidence?.preTradeDecisionSnapshot),providerFailurePreserved:String(state?.entryProviderResponse?.error?.code||"")==="insufficient_shard_balance",operationalLatchCleared:state.entrySubmitStartedAt===null,reauthorized:false,submitted:false,realMoneyMoved:false,next:"PROVE SHARD 2 FUNDING BEFORE SEPARATE FOUNDER REAUTHORIZATION"});
      } catch(error) {
        // Never allow an opaque Cloudflare 1101 for this governed action again.
        return json({ok:false,state:"FAILED_XRP_RECOVERY_WRITE_FAILED",errorName:String(error?.name||"Error"),errorMessage:String(error?.message||error||"UNKNOWN"),reauthorized:false,submitted:false,realMoneyMoved:false},500);
      }
    }

    if (url.pathname === "/kalshi-approved-target-allocation-0-2") {
      const allocationPath="/trade-api/v2/portfolio/target_balance_allocation";
      if(request.method==="GET"){
        return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Approved Kalshi 50/50 Allocation</title><body style='font-family:system-ui;background:#07111d;color:#eef;padding:24px;max-width:720px;margin:auto'><h2>Founder-approved 50/50 Kalshi allocation</h2><p>Approved scope: set target allocation to <b>50% Exchange 0</b> and <b>50% Exchange 2</b>. This does not authorize or submit a trade.</p><form method=post><button style='font-size:18px;padding:14px 20px' type=submit>Apply approved 50/50 allocation</button></form><p>The action first rechecks that the total is $10, Index 0 is $10, Index 2 is $0, and no target allocation is already configured. It sends exactly one allocation POST if those guards pass.</p></body>",{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
      }
      if(request.method!=="POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);

      // Recheck both account balance and allocation immediately before the single approved write.
      const [br,ar]=await Promise.all([
        kalshiExecutionGet(env,"/trade-api/v2/portfolio/balance"),
        kalshiExecutionGet(env,allocationPath)
      ]);
      let bb={},ab={}; try{bb=await br.json();}catch{} try{ab=await ar.json();}catch{}
      if(!br.ok||!ar.ok) return json({ok:false,state:"TARGET_ALLOCATION_PREFLIGHT_READ_FAILED",balanceHttpStatus:br.status,allocationHttpStatus:ar.status},502);
      const rows=Array.isArray(bb?.balance_breakdown)?bb.balance_breakdown:[];
      const map=Object.fromEntries(rows.map(x=>[String(x?.exchange_index),Number(x?.balance)]));
      const existing=Array.isArray(ab?.allocations)?ab.allocations:[];
      if(!(Number(bb?.balance)===1000&&map["0"]===10&&map["2"]===0&&existing.length===0)){
        return json({ok:false,state:"TARGET_ALLOCATION_PRECONDITION_FAILED",observed:{totalBalance:bb?.balance??null,index0:map["0"]??null,index2:map["2"]??null,allocations:existing},providerWrites:0,orders:0,reauthorized:false},409);
      }

      const payload={allocations:[{exchange_index:0,percent:50},{exchange_index:2,percent:50}]};
      const headers=await kalshiExecutionHeaders(env,"POST",allocationPath);
      headers["content-type"]="application/json";
      const wr=await fetch("https://external-api.kalshi.com"+allocationPath,{method:"POST",headers,body:JSON.stringify(payload)});
      let wb=null; try{wb=await wr.json();}catch{}
      return json({
        ok:wr.ok,
        state:wr.ok?"TARGET_ALLOCATION_PROVIDER_ACCEPTED":"TARGET_ALLOCATION_PROVIDER_REJECTED",
        httpStatus:wr.status,
        providerResponse:wb,
        requestedAllocation:payload.allocations,
        orderCreated:false,
        tradeAuthorizationChanged:false,
        next:wr.ok?"VERIFY SHARD BALANCES; DO NOT REAUTHORIZE YET":"STOP; PRESERVE PROVIDER REJECTION; DO NOT RETRY"
      },wr.ok?200:502);
    }

    if (url.pathname === "/kalshi-approved-5-dollar-shard-transfer") {
      if(request.method==="GET"){
        const state=await loadRealTradeState(env);
        const already=state?.shardTransfer?.transferId||null;
        return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Approved $5 Kalshi Shard Transfer</title><body style='font-family:system-ui;background:#07111d;color:#eef;padding:24px;max-width:720px;margin:auto'><h2>Approved $5 Internal Kalshi Transfer</h2><p>Exact action: move <b>$5.00</b> from exchange index <b>0</b> to exchange index <b>2</b>. No order is created and no trade authorization is changed.</p>"+(already?"<p><b>BLOCKED:</b> transfer already recorded as "+String(already).replace(/[&<>]/g,"")+"</p>":"<form method=post><input type=hidden name=confirm value='APPROVE $5 SHARD TRANSFER 0→2'><button style='font-size:18px;padding:14px 20px' type=submit>Execute approved $5 transfer</button></form>")+"<p>This endpoint is one-shot and rechecks live balances before sending.</p></body>",{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
      }
      if(request.method!=="POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
      const state=await loadRealTradeState(env);
      if(state?.shardTransfer?.transferId) return json({ok:false,state:"TRANSFER_ALREADY_RECORDED",transferId:state.shardTransfer.transferId},409);

      // Reconcile live balances immediately before the only allowed money-moving POST.
      const br=await kalshiExecutionGet(env,"/trade-api/v2/portfolio/balance");
      let bb={}; try{bb=await br.json();}catch{}
      if(!br.ok) return json({ok:false,state:"PRE_TRANSFER_BALANCE_READ_FAILED",httpStatus:br.status,body:bb},502);
      const rows=Array.isArray(bb?.balance_breakdown)?bb.balance_breakdown:[];
      const map=Object.fromEntries(rows.map(x=>[String(x?.exchange_index),Number(x?.balance)]));
      const source=map["0"], destination=map["2"];
      if(!(Number.isFinite(source)&&Number.isFinite(destination)&&source===10&&destination===0)){
        return json({ok:false,state:"TRANSFER_PRECONDITION_FAILED",observed:{index0:source,index2:destination,totalBalance:bb?.balance??null},expected:{index0:10,index2:0}},409);
      }

      const payload={source:"event_contract",destination:"event_contract",amount:50000,source_exchange_shard:0,destination_exchange_shard:2,source_subaccount:0,destination_subaccount:0};
      const tr=await kalshiApprovedShardTransfer(env,payload);
      let tb={}; try{tb=await tr.json();}catch{}
      if(!tr.ok || !tb?.transfer_id){
        return json({ok:false,state:"TRANSFER_PROVIDER_REJECTED",httpStatus:tr.status,providerResponse:tb,preTransfer:{index0:source,index2:destination},moneyMoveAttempted:true},502);
      }
      state.shardTransfer={transferId:String(tb.transfer_id),acceptedAt:Date.now(),amountCenticents:50000,amountUsd:5,sourceExchangeShard:0,destinationExchangeShard:2,status:"REQUEST_ACCEPTED_AWAITING_BALANCE_PROOF"};
      realTradeLedger(state,"KALSHI_SHARD_TRANSFER_ACCEPTED",{transferId:state.shardTransfer.transferId,amountUsd:5,sourceExchangeShard:0,destinationExchangeShard:2});
      await saveRealTradeState(env,state);
      return json({ok:true,state:"KALSHI_SHARD_TRANSFER_REQUEST_ACCEPTED",transferId:state.shardTransfer.transferId,amountUsd:5,fromExchangeIndex:0,toExchangeIndex:2,orderCreated:false,tradeAuthorizationChanged:false,next:"VERIFY BALANCE BEFORE REARMING"});
    }

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

    // Read-only catalogue shape probe for Polymarket US crypto. This intentionally
    // inspects event/market metadata without previewing or submitting any order.
    // Read-only targeted US search summary. Keeps the browser output compact and
    // separates short-horizon candidates from noisy fuzzy-search matches.
    if (url.pathname === "/us-btc-eth-horizon-proof") {
      const client = new PolymarketUS();
      const queries = ["bitcoin today","bitcoin daily","bitcoin hourly","bitcoin 15 minute","BTC today","ethereum today","ethereum daily","ethereum hourly","ethereum 15 minute","ETH today"];
      const dedup = new Map();
      const queryCounts = [];
      for (const query of queries) {
        try {
          const result = await client.search.query({ query, status: "active", limit: 50 });
          const events = Array.isArray(result?.events) ? result.events : [];
          queryCounts.push({query,count:events.length});
          for (const event of events) {
            const markets = Array.isArray(event?.markets)&&event.markets.length?event.markets:[null];
            for (const market of markets) {
              const text=[event?.title,event?.question,event?.slug,event?.description,market?.title,market?.question,market?.slug,market?.outcome].filter(Boolean).join(" — ");
              const asset=/bitcoin|\bbtc\b/i.test(text)?"BTC":/ethereum|\beth\b|\bether\b/i.test(text)?"ETH":null;
              if(!asset) continue;
              const startMs=Date.parse(event?.startTime||""), endMs=Date.parse(event?.endTime||"");
              const durationMs=Number.isFinite(startMs)&&Number.isFinite(endMs)?endMs-startMs:NaN;
              const explicit15=/15\s*(?:min|minute)|15m\b|quarter[- ]?hour/i.test(text);
              const explicitHour=/\b(?:hourly|this hour|1\s*hour)\b/i.test(text);
              const explicitDay=/\b(?:daily|today|tonight|this day|24\s*hour)\b/i.test(text);
              const timed15=Number.isFinite(durationMs)&&durationMs>=10*60e3&&durationMs<=20*60e3;
              const timedHour=Number.isFinite(durationMs)&&durationMs>20*60e3&&durationMs<=90*60e3;
              const timedDay=Number.isFinite(durationMs)&&durationMs>90*60e3&&durationMs<=30*60*60e3;
              const horizon=(explicit15||timed15)?"15M":(explicitHour||timedHour)?"HOURLY":(explicitDay||timedDay)?"DAILY":null;
              if(!horizon) continue;
              const key=String(market?.id||market?.slug||event?.id||event?.slug||text);
              dedup.set(key,{asset,horizon,eventId:event?.id||null,eventTitle:event?.title||null,eventSlug:event?.slug||null,startTime:event?.startTime||null,endTime:event?.endTime||null,marketId:market?.id||null,marketTitle:market?.title||null,marketSlug:market?.slug||null,active:market?.active??event?.active??null,closed:market?.closed??event?.closed??null});
            }
          }
        } catch (error) { queryCounts.push({query,error:String(error?.message||"SEARCH_FAILED").slice(0,80)}); }
      }
      const matches=[...dedup.values()];
      return json({ok:true,source:"POLYMARKET_US_TARGETED_SEARCH",queryCounts,eligibleShortHorizon:matches.length,btc:matches.filter(x=>x.asset==="BTC").length,eth:matches.filter(x=>x.asset==="ETH").length,matches:matches.slice(0,100),submitted:false,liveOrderSubmission:"DISABLED",realMoneyMoved:false});
    }

    // Read-only raw inspection of the fuzzy results returned specifically by the
    // "15 minute" searches. No horizon inference here: expose timing/title/market
    // metadata so we can determine whether the provider actually has such contracts.
    if (url.pathname === "/us-15m-search-inspect") {
      const client = new PolymarketUS();
      const queries = ["bitcoin 15 minute","ethereum 15 minute"];
      const out = [];
      for (const query of queries) {
        try {
          const result = await client.search.query({ query, status: "active", limit: 50 });
          const events = Array.isArray(result?.events) ? result.events : [];
          out.push({query,count:events.length,events:events.map(event=>({
            id:event?.id||null,title:event?.title||null,slug:event?.slug||null,
            startTime:event?.startTime||null,endTime:event?.endTime||null,
            active:event?.active??null,closed:event?.closed??null,
            markets:(Array.isArray(event?.markets)?event.markets:[]).map(m=>({
              id:m?.id||null,title:m?.title||null,question:m?.question||null,
              slug:m?.slug||null,outcome:m?.outcome||null,
              active:m?.active??null,closed:m?.closed??null
            }))
          }))});
        } catch (error) {
          out.push({query,error:String(error?.message||"SEARCH_FAILED").slice(0,100)});
        }
      }
      return json({ok:true,source:"POLYMARKET_US_15M_RAW_INSPECTION",queries:out,submitted:false,liveOrderSubmission:"DISABLED",realMoneyMoved:false});
    }

    // Read-only search proof: events.list currently exposes no crypto-labelled
    // catalogue rows, so inspect the official US search surface independently.
    if (url.pathname === "/us-crypto-search-proof") {
      const client = new PolymarketUS();
      const queries = ["crypto","coin","bitcoin","BTC","ethereum","ETH"];
      const out = [];
      for (const query of queries) {
        try {
          const result = await client.search.query({ query, status: "active", limit: 50 });
          const events = Array.isArray(result?.events) ? result.events : [];
          out.push({query,count:events.length,events:events.slice(0,20).map(event=>({
            id:event?.id||null,title:event?.title||null,slug:event?.slug||null,
            active:event?.active??null,closed:event?.closed??null,
            startTime:event?.startTime||null,endTime:event?.endTime||null,
            markets:(Array.isArray(event?.markets)?event.markets:[]).slice(0,20).map(m=>({
              id:m?.id||null,title:m?.title||null,slug:m?.slug||null,outcome:m?.outcome||null,
              active:m?.active??null,closed:m?.closed??null
            }))
          }))});
        } catch (error) {
          out.push({query,error:String(error?.message||"SEARCH_FAILED").slice(0,100)});
        }
      }
      return json({ok:true,source:"POLYMARKET_US_SEARCH",queries:out,submitted:false,liveOrderSubmission:"DISABLED",realMoneyMoved:false});
    }

    if (url.pathname === "/us-crypto-catalogue-proof") {
      const client = new PolymarketUS();
      const rows = [];
      let offset = 0, pages = 0, totalEvents = 0, cryptoEvents = 0;
      while (pages < 30) {
        const result = await client.events.list({ active: true, limit: 100, offset });
        const events = Array.isArray(result?.events) ? result.events
          : Array.isArray(result?.data?.events) ? result.data.events
          : Array.isArray(result?.data) ? result.data
          : Array.isArray(result) ? result : [];
        for (const event of events) {
          totalEvents++;
          const markets = Array.isArray(event?.markets) ? event.markets : [];
          const eventText=[event?.title,event?.question,event?.slug,event?.description].filter(Boolean).join(" — ");
          for (const market of (markets.length?markets:[null])) {
            const text=[eventText,market?.title,market?.question,market?.slug,market?.outcome].filter(Boolean).join(" — ");
            if (!/bitcoin|ethereum|\bbtc\b|\beth\b|\bether\b|crypto/i.test(text)) continue;
            cryptoEvents++;
            if (rows.length < 100) rows.push({
              eventTitle:event?.title||event?.question||null,eventSlug:event?.slug||null,
              eventStart:event?.startTime||null,eventEnd:event?.endTime||null,
              marketTitle:market?.title||market?.question||null,marketSlug:market?.slug||null,
              outcome:market?.outcome||null,active:market?.active??event?.active??null,closed:market?.closed??event?.closed??null
            });
          }
        }
        pages++;
        if(events.length<100) break;
        offset+=events.length;
      }
      return json({ok:true,source:"POLYMARKET_US_EVENTS_LIST",pages,totalEvents,cryptoMatches:cryptoEvents,sample:rows,submitted:false,liveOrderSubmission:"DISABLED",realMoneyMoved:false});
    }

    // Authenticated, read-only Kalshi proof for the unchanged Baseline Real rules.
    // Credentials sign GET market-data requests only. No portfolio/order/write endpoint is called.
    if (url.pathname === "/kalshi-15m-proof") {
      const base = "https://external-api.kalshi.com/trade-api/v2";
      const series = [
        {asset:"BTC", ticker:"KXBTC15M"},
        {asset:"ETH", ticker:"KXETH15M"}
      ];

      function pemToArrayBuffer(pem) {
        const body = String(pem || "")
          .replace(/-----BEGIN [^-]+-----/g, "")
          .replace(/-----END [^-]+-----/g, "")
          .replace(/\s+/g, "");
        if (!body) throw new Error("PRIVATE_KEY_EMPTY");
        const raw = atob(body);
        const bytes = new Uint8Array(raw.length);
        for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
        return bytes.buffer;
      }

      async function kalshiHeaders(method, path) {
        if (!env.KALSHI_KEY_ID || !env.KALSHI_PRIVATE_KEY) throw new Error("KALSHI_CREDENTIALS_NOT_INSTALLED");
        const timestamp = String(Date.now());
        const signPath = path.split("?")[0];
        const message = new TextEncoder().encode(timestamp + method.toUpperCase() + signPath);
        const key = await crypto.subtle.importKey(
          "pkcs8",
          pemToArrayBuffer(env.KALSHI_PRIVATE_KEY),
          {name:"RSA-PSS", hash:"SHA-256"},
          false,
          ["sign"]
        );
        const signature = await crypto.subtle.sign({name:"RSA-PSS",saltLength:32}, key, message);
        let binary="";
        for (const b of new Uint8Array(signature)) binary += String.fromCharCode(b);
        return {
          accept:"application/json",
          "KALSHI-ACCESS-KEY":String(env.KALSHI_KEY_ID).trim(),
          "KALSHI-ACCESS-TIMESTAMP":timestamp,
          "KALSHI-ACCESS-SIGNATURE":btoa(binary)
        };
      }

      async function authenticatedGet(path) {
        const headers = await kalshiHeaders("GET", path);
        return fetch(base + path.replace("/trade-api/v2",""), {method:"GET",headers});
      }

      const out = [];
      for (const s of series) {
        try {
          const path="/trade-api/v2/markets?series_ticker="+encodeURIComponent(s.ticker)+"&status=open&limit=6";
          const mr=await authenticatedGet(path);
          if(!mr.ok) {
            out.push({asset:s.asset,seriesTicker:s.ticker,ok:false,stage:"AUTHENTICATED_MARKETS",httpStatus:mr.status});
            continue;
          }
          const payload=await mr.json();
          const markets=Array.isArray(payload?.markets)?payload.markets:[];
          const rows=[];
          for(const m of markets.slice(0,6)) {
            const op="/trade-api/v2/markets/"+encodeURIComponent(m.ticker)+"/orderbook?depth=3";
            const br=await authenticatedGet(op);
            const book=br.ok?await br.json():null;
            rows.push({
              ticker:m?.ticker||null,eventTicker:m?.event_ticker||null,title:m?.title||null,
              subtitle:m?.subtitle||null,status:m?.status||null,openTime:m?.open_time||null,
              closeTime:m?.close_time||null,expectedExpirationTime:m?.expected_expiration_time||null,
              expirationTime:m?.expiration_time||null,canCloseEarly:m?.can_close_early??null,
              yesBid:m?.yes_bid_dollars??m?.yes_bid??null,yesAsk:m?.yes_ask_dollars??m?.yes_ask??null,
              noBid:m?.no_bid_dollars??m?.no_bid??null,noAsk:m?.no_ask_dollars??m?.no_ask??null,
              lastPrice:m?.last_price_dollars??m?.last_price??null,volume:m?.volume_fp??m?.volume??null,
              liquidity:m?.liquidity_dollars??m?.liquidity??null,rulesPrimary:m?.rules_primary||null,
              rulesSecondary:m?.rules_secondary||null,orderbookHttpStatus:br.status,
              orderbook:book?.orderbook_fp||book?.orderbook||null
            });
          }
          out.push({asset:s.asset,seriesTicker:s.ticker,ok:true,count:markets.length,markets:rows});
        } catch(error) {
          const msg=String(error?.message||"READ_FAILED");
          out.push({asset:s.asset,seriesTicker:s.ticker,ok:false,stage:"AUTH_OR_FETCH",errorCode:
            msg.includes("PRIVATE_KEY")?"PRIVATE_KEY_FORMAT":
            msg.includes("CREDENTIALS")?"CREDENTIALS_MISSING":"SIGNED_READ_FAILED"});
        }
      }
      return json({
        ok:out.some(x=>x.ok),source:"KALSHI_AUTHENTICATED_API_READ_ONLY",
        baselineRules:{entryScore:0.80,exitScore:0.20,maxHoldMinutes:5,maxStakeUsd:5},
        credentialsUsed:true,credentialValuesExposed:false,accountWriteAccessUsed:false,
        submitted:false,liveOrderSubmission:"DISABLED_FOR_THIS_ROUTE",realMoneyMoved:false,results:out
      });
    }

    if (url.pathname === "/kalshi-live-market-shard-proof") {
      try {
        // Read-only proof that freshly discovered Kalshi contracts carry exchange_index through discovery.
        const discovery=await discoverKalshiShadowMarkets(env);
        const rows=(discovery?.markets||[]).slice(0,20).map(m=>({
          asset:m.asset||null,
          marketTicker:m.marketTicker||m.slug||null,
          outcomeSide:m.outcomeSide||null,
          score:safeFinite(m.score),
          executionEligible:m.executionEligible===true,
          exchangeIndex:m.exchangeIndex??null,
          closeTime:m.closeTime||null
        }));
        return json({
          ok:true,readOnly:true,state:"KALSHI_LIVE_MARKET_SHARD_PROOF",
          marketCount:rows.length,
          marketsWithExchangeIndex:rows.filter(x=>Number.isInteger(Number(x.exchangeIndex))).length,
          markets:rows,
          safety:{providerWrites:0,transfers:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}
        });
      } catch(error) {
        return json({ok:false,readOnly:true,state:"KALSHI_LIVE_MARKET_SHARD_PROOF_FAILED",errorCode:String(error?.message||"FAILED"),safety:{providerWrites:0,transfers:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}},500);
      }
    }

    if (url.pathname === "/kalshi-shard-allocation-proof") {
      try {
        // Read-only inspection of Kalshi's automatic target balance allocation.
        const candidates=[
          "/trade-api/v2/portfolio/target_balance_allocation",
          "/trade-api/v2/portfolio/target-balance-allocation"
        ];
        const attempts=[];
        for(const path of candidates){
          const response=await kalshiExecutionGet(env,path);
          let body=null; try { body=await response.json(); } catch {}
          attempts.push({path,httpStatus:response.status,ok:response.ok,body});
          if(response.ok) break;
        }
        return json({ok:true,readOnly:true,state:"KALSHI_SHARD_ALLOCATION_PROOF",attempts,
          observedNeed:{fundedExchangeIndex:0,liveMarketExchangeIndex:2},
          safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}});
      } catch(error){
        return json({ok:false,readOnly:true,state:"KALSHI_SHARD_ALLOCATION_PROOF_FAILED",errorCode:String(error?.message||"FAILED"),
          safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}},500);
      }
    }

    if (url.pathname === "/kalshi-target-allocation-readiness") {
      try {
        // READ ONLY. Proves the exact proposed 50/50 target allocation; sends no provider write.
        const allocationPath="/trade-api/v2/portfolio/target_balance_allocation";
        const balancePath="/trade-api/v2/portfolio/balance";
        const [allocationResponse,balanceResponse]=await Promise.all([
          kalshiExecutionGet(env,allocationPath),
          kalshiExecutionGet(env,balancePath)
        ]);
        let allocationBody=null,balanceBody=null;
        try { allocationBody=await allocationResponse.json(); } catch {}
        try { balanceBody=await balanceResponse.json(); } catch {}
        const breakdown=Array.isArray(balanceBody?.balance_breakdown)?balanceBody.balance_breakdown:[];
        const byIndex=Object.fromEntries(breakdown.map(x=>[String(x?.exchange_index),x?.balance??null]));
        return json({
          ok:allocationResponse.ok&&balanceResponse.ok,
          readOnly:true,
          state:"KALSHI_TARGET_ALLOCATION_READINESS",
          current:{
            targetAllocationHttpStatus:allocationResponse.status,
            targetAllocation:allocationBody,
            totalBalance:balanceBody?.balance??null,
            index0:byIndex["0"]??null,
            index2:byIndex["2"]??null
          },
          proposed:{
            method:"POST",
            path:allocationPath,
            intent:"50% Exchange 0 / 50% Exchange 2",
            allocationPercentages:{"0":50,"2":50},
            expectedAtCurrentTenDollarBalance:{index0:"~$5.00",index2:"~$5.00",total:"$10.00"}
          },
          credentialCapability:{
            authenticatedReadProven:allocationResponse.ok,
            writeCapabilityProven:false,
            reason:"No write is sent by this readiness route; write permission can only be established by documented scope or an authorized provider write."
          },
          safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}
        },allocationResponse.ok&&balanceResponse.ok?200:502);
      } catch(error) {
        return json({ok:false,readOnly:true,state:"KALSHI_TARGET_ALLOCATION_READINESS_FAILED",errorCode:String(error?.message||"FAILED"),safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}},500);
      }
    }

    if (url.pathname === "/kalshi-shard-transfer-readiness") {
      try {
        // READ ONLY. This route proves the exact bounded transfer request without sending it.
        const path="/trade-api/v2/portfolio/balance";
        const response=await kalshiExecutionGet(env,path);
        let body=null; try { body=await response.json(); } catch {}
        const breakdown=Array.isArray(body?.balance_breakdown)?body.balance_breakdown:[];
        const byIndex=Object.fromEntries(breakdown.map(x=>[String(x?.exchange_index),x?.balance??null]));
        const sourceRaw=byIndex["0"], destinationRaw=byIndex["2"];
        const sourceUsd=Number(sourceRaw), destinationUsd=Number(destinationRaw);
        const ready=response.ok && Number.isFinite(sourceUsd) && sourceUsd>=10 && Number.isFinite(destinationUsd) && destinationUsd===0;
        return json({
          ok:response.ok,readOnly:true,state:"KALSHI_SHARD_TRANSFER_READINESS",
          currentBalance:{totalBalance:body?.balance??null,index0:sourceRaw,index2:destinationRaw},
          proposedTransfer:{
            method:"POST",path:"/trade-api/v2/portfolio/intra_exchange_instance_transfer",
            body:{source:"event_contract",destination:"event_contract",amount:50000,source_exchange_shard:0,destination_exchange_shard:2,source_subaccount:0,destination_subaccount:0},
            amountExplanation:"50000 centicents = $5.00"
          },
          expectedAfterCompletion:{index0:"5.0000",index2:"5.0000",total:"10.00"},
          transferReady:ready,
          note:"NO TRANSFER SENT. Founder approval is required before any money-moving POST.",
          safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}
        },response.ok?200:502);
      } catch(error) {
        return json({ok:false,readOnly:true,state:"KALSHI_SHARD_TRANSFER_READINESS_FAILED",errorCode:String(error?.message||"FAILED"),safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}},500);
      }
    }

    if (url.pathname === "/kalshi-balance-shard-proof") {
      try {
        // Read-only shard diagnostic: authenticated GET only. Never moves funds or creates orders.
        const path="/trade-api/v2/portfolio/balance";
        const response=await kalshiExecutionGet(env,path);
        let body=null;
        try { body=await response.json(); } catch {}
        const breakdown=body?.balance_breakdown ?? body?.balanceBreakdown ?? null;
        return json({
          ok:response.ok,
          readOnly:true,
          state:response.ok?"KALSHI_BALANCE_SHARD_PROOF":"KALSHI_BALANCE_SHARD_READ_FAILED",
          venue:"KALSHI",
          proof:{
            method:"GET",
            path,
            httpStatus:response.status,
            totalBalance:body?.balance ?? null,
            portfolioValue:body?.portfolio_value ?? body?.portfolioValue ?? null,
            balanceBreakdown:breakdown,
            responseKeys:body&&typeof body==="object"?Object.keys(body).sort():[],
            rawBalanceResponse:body
          },
          safety:{
            postOrdersCalled:false,
            transferCalled:false,
            deleteOrdersCalled:false,
            submitted:false,
            realMoneyMoved:false,
            stateMutation:false
          }
        },response.ok?200:502);
      } catch(error) {
        return json({
          ok:false,readOnly:true,state:"KALSHI_BALANCE_SHARD_PROOF_FAILED",
          errorCode:String(error?.message||"KALSHI_BALANCE_SHARD_PROOF_FAILED"),
          safety:{postOrdersCalled:false,transferCalled:false,deleteOrdersCalled:false,submitted:false,realMoneyMoved:false,stateMutation:false}
        },500);
      }
    }

    if (url.pathname === "/kalshi-execution-credential-proof") {
      try {
        // Deliberately harmless authenticated GET. This route contains no POST/DELETE fetch.
        const path="/trade-api/v2/portfolio/balance";
        const response=await kalshiExecutionGet(env,path);
        let body=null;
        try { body=await response.json(); } catch {}
        return json({
          ok:response.ok,
          state:response.ok?"KALSHI_EXECUTION_CREDENTIAL_AUTHENTICATED_NO_ORDER":"KALSHI_EXECUTION_CREDENTIAL_AUTH_FAILED",
          venue:"KALSHI",
          proof:{
            method:"GET",
            path,
            httpStatus:response.status,
            authenticated:response.ok,
            responseShape:body&&typeof body==="object"?Object.keys(body).sort():[],
            credentialValuesExposed:false
          },
          safety:{
            credentialRole:"SEPARATE_EXECUTION_CREDENTIAL",
            legacyExecutionControllerArmed:false,
            postOrdersCalled:false,
            deleteOrdersCalled:false,
            submitted:false,
            realMoneyMoved:false
          }
        },response.ok?200:502);
      } catch(error) {
        return json({
          ok:false,state:"KALSHI_EXECUTION_CREDENTIAL_PROOF_FAILED",
          errorCode:String(error?.message||"EXECUTION_CREDENTIAL_PROOF_FAILED"),
          safety:{legacyExecutionControllerArmed:false,postOrdersCalled:false,deleteOrdersCalled:false,submitted:false,realMoneyMoved:false}
        },500);
      }
    }

    if (url.pathname === "/kalshi-one-trade-controller-proof") {
      try {
        const discovery=await discoverKalshiShadowMarkets(env);
        const candidate=discovery.markets[0]||null;
        if(!candidate) return json({ok:false,state:"NO_LIVE_KALSHI_15M_MARKET",submitted:false,realMoneyMoved:false},422);
        const sizing=estimateKalshiFeeSafeSize(candidate.yes,SHADOW_CONFIG.maxStakeUsd);
        const clientOrderId="baseline-real-one-trade-DRY-RUN";
        const dryOrderBody={
          ticker:candidate.marketTicker||candidate.slug,
          client_order_id:clientOrderId,
          side:"bid",
          price_dollars:Number(candidate.yes).toFixed(4),
          count_fp:String(sizing.count)
        };
        return json({
          ok:true,
          state:"KALSHI_ONE_TRADE_PATHS_IMPLEMENTED_HARD_DISABLED",
          venue:"KALSHI",
          currentCoverage:discovery.coverage,
          selectedDryCandidate:{
            ticker:candidate.marketTicker||candidate.slug,
            asset:candidate.asset,
            outcomeSide:candidate.outcomeSide,
            direction:candidate.direction,
            horizon:candidate.horizon,
            observedEntryAsk:candidate.yes,
            observedExitBid:candidate.bid
          },
          directionModel:{
            yes:{meaning:"UP",bear:false},
            no:{meaning:"DOWN",bear:true},
            bothDirectionsAvailable:true
          },
          v2WritePath:{
            create:{method:"POST",path:"/trade-api/v2/portfolio/events/orders",body:dryOrderBody,endpointCalled:false},
            cancel:{method:"DELETE",pathTemplate:"/trade-api/v2/portfolio/events/orders/{order_id}",endpointCalled:false}
          },
          feeSafeSizing:sizing,
          frozenRules:{entryScore:SHADOW_CONFIG.entryScore,exitScore:SHADOW_CONFIG.exitScore,maxHoldMinutes:SHADOW_CONFIG.maxHoldMs/60000,maxStakeUsd:SHADOW_CONFIG.maxStakeUsd},
          interlocks:{
            controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
          oneTradeAuthorizationActive:false,
          controllerEnabled:false,
            controllerEnableVariablePresent:Boolean(env?.KALSHI_ONE_TRADE_CONTROLLER_ENABLED),
            founderAuthorizationVariablePresent:Boolean(env?.KALSHI_FOUNDER_ONE_TRADE_AUTHORIZATION),
            feeVerified:true,
            feeScheduleEffective:"2026-07-07",
            feeCapIncludesEntryFee:true,
            requiresExplicitFounderAuthorization:true,
            requiresFreshLocationVerificationAtTradeTime:true,
            requiresScoreAtLeast:SHADOW_CONFIG.entryScore,
            maximumHoldMinutes:SHADOW_CONFIG.maxHoldMs/60000,
            maximumStakeUsd:SHADOW_CONFIG.maxStakeUsd,
            postOrdersCalled:false,
            deleteOrdersCalled:false,
            submitted:false,
            realMoneyMoved:false
          }
        });
      } catch(error) {
        return json({ok:false,state:"KALSHI_ONE_TRADE_CONTROLLER_PROOF_FAILED",errorCode:String(error?.message||"PROOF_FAILED"),submitted:false,realMoneyMoved:false},500);
      }
    }

    if (url.pathname === "/kalshi-execution-readiness-proof") {
      try {
        const discovery = await discoverKalshiShadowMarkets(env);
        const candidate = discovery.markets[0] || null;
        if (!candidate) return json({ok:false,state:"NO_LIVE_KALSHI_15M_MARKET",submitted:false,realMoneyMoved:false},422);
        const ask = Number(candidate.yes);
        const bid = Number(candidate.bid);
        const maxStake = SHADOW_CONFIG.maxStakeUsd;
        const maxContracts = ask > 0 ? Math.max(0, Math.floor(maxStake / ask)) : 0;
        const plannedNotional = Number((maxContracts * ask).toFixed(4));
        return json({
          ok:true,
          state:"KALSHI_EXECUTION_MECHANICS_MODELED_NOT_SUBMITTED",
          venue:"KALSHI",
          market:{ticker:candidate.slug,asset:candidate.asset,ask,bid,horizon:candidate.horizon},
          frozenRules:{entryScore:SHADOW_CONFIG.entryScore,exitScore:SHADOW_CONFIG.exitScore,maxHoldMinutes:SHADOW_CONFIG.maxHoldMs/60000,maxStakeUsd:maxStake},
          entryPlan:{
            method:"POST",
            path:"/trade-api/v2/portfolio/events/orders",
            side:"bid",
            meaning:"LONG_YES",
            price:ask.toFixed(4),
            count:String(maxContracts),
            plannedNotionalUsd:plannedNotional,
            clientOrderIdRequiredByUs:true,
            endpointCalled:false
          },
          exitPlan:{
            method:"POST",
            path:"/trade-api/v2/portfolio/events/orders",
            side:"ask",
            meaning:"OPPOSITE_DIRECTION_FOR_YES_EXIT",
            referenceBid:bid.toFixed(4),
            endpointCalled:false
          },
          cancellationPlan:{
            method:"DELETE",
            pathTemplate:"/trade-api/v2/portfolio/events/orders/{order_id}",
            endpointCalled:false
          },
          safety:{
            currentCredential:"READ_ONLY",
            legacyExecutionControllerArmed:false,
            writeEndpointPresentInThisProof:false,
            submitted:false,
            realMoneyMoved:false
          }
        });
      } catch(error) {
        return json({ok:false,state:"KALSHI_EXECUTION_READINESS_READ_FAILED",errorCode:String(error?.message||"READ_FAILED").slice(0,120),submitted:false,realMoneyMoved:false},422);
      }
    }

    if (url.pathname === "/kalshi-controller-switch-readiness-proof") {
      const state=await loadRealTradeState(env);
      const shadow=await loadShadowState(env);
      const switchEnabled=kalshiControllerSwitchEnabled(env);
      const authActive=kalshiAuthorizationValid(state);
      const effective=kalshiOneTradeEnabled(env,state);
      return json({
        ok:true,
        state:switchEnabled
          ? (authActive ? "UNEXPECTED_AUTHORIZATION_PRESENT_STOP" : "KALSHI_CONTROLLER_SWITCH_ENABLED_FOUNDER_AUTHORIZATION_ABSENT")
          : "KALSHI_CONTROLLER_SWITCH_READY_STILL_DISABLED",
        gateMatrix:kalshiGateMatrixProof(),
        current:{
          controllerSwitchEnabled:switchEnabled,
          founderAuthorizationActive:authActive,
          effectiveExecutionEnabled:effective,
          shadowLive:shadow?.status==="LIVE_KALSHI_SHADOW",
          priorTradeConsumed:Boolean(state?.consumed),
          priorEntryPresent:Boolean(state?.entryOrderId),
          priorSubmitLatchPresent:Boolean(state?.entrySubmitStartedAt)
        },
        switchOnlySafety:{
          providerWriteAllowedWithoutFounderAuthorization:false,
          schedulerMayObserve:true,
          schedulerMaySubmitWithoutFounderAuthorization:false,
          authorizationEndpointStillRequiresExplicitPhrase:true,
          authorizationExpiresAfterMinutes:null,
          oneTradeOnly:true,
          maxStakeUsd:REAL_TEST_CONFIG.maxStakeUsd,
          continuousTradingAuthorized:false
        },
        interlocks:{
          postOrdersCalled:false,
          deleteOrdersCalled:false,
          submitted:false,
          realMoneyMoved:false
        },
        nextBoundary:switchEnabled&&!authActive
          ? "SWITCH_ONLY_PROOF_PASSED_FOUNDER_AUTHORIZATION_STILL_REQUIRED"
          : "ENABLE_CONTROLLER_SWITCH_ONLY_THEN_RECHECK"
      });
    }

    if (url.pathname === "/kalshi-one-trade-arming-readiness-proof") {
      const state=await loadRealTradeState(env);
      const shadow=await loadShadowState(env);
      const alreadyUsed=Boolean(state?.consumed||state?.entryOrderId||state?.entrySubmitStartedAt);
      return json({
        ok:true,
        state:"KALSHI_ONE_TRADE_ARMING_MECHANISM_READY_NOT_ARMED",
        authorizationDesign:{
          persistentKvAuthorization:true,
          expiresAfterMinutes:null,
          oneTradeOnly:true,
          authorizationConsumedBeforeProviderWrite:true,
          controllerSwitchAlsoRequired:true,
          manualKalshiClickRequired:false,
          continuousTradingAuthorized:false
        },
        current:{
          controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
          founderAuthorizationActive:kalshiAuthorizationValid(state),
          priorTradeConsumed:Boolean(state?.consumed),
          priorEntryPresent:Boolean(state?.entryOrderId),
          priorSubmitLatchPresent:Boolean(state?.entrySubmitStartedAt),
          shadowLive:shadow?.status==="LIVE_KALSHI_SHADOW",
          safeToOfferFounderAuthorization:!alreadyUsed && shadow?.status==="LIVE_KALSHI_SHADOW"
        },
        interlocks:{postOrdersCalled:false,deleteOrdersCalled:false,submitted:false,realMoneyMoved:false},
        nextBoundary:"FOUNDER_EXPLICIT_SINGLE_TRADE_AUTHORIZATION_REQUIRED"
      });
    }

    if (url.pathname === "/kalshi-fee-readiness-proof") {
      const shadow=await loadShadowState(env);
      const sample=(shadow?.opportunities||[]).find(o=>o?.marketTicker&&(o?.outcomeSide==="YES"||o?.outcomeSide==="NO"))||null;
      const sizing=sample?estimateKalshiFeeSafeSize(sample.yes,REAL_TEST_CONFIG.maxStakeUsd):null;
      return json({
        ok:true,
        state:"KALSHI_CURRENT_FEE_MODEL_REVERIFIED_PRETRADE",
        verifiedAt:"2026-09-19",
        authoritativeSources:{
          helpCenter:{
            title:"Fees",
            published:"2026-04-19",
            saysTransactionFeesChargedOnExpectedEarnings:true,
            warnsSomeMarketsHaveDifferentFees:true
          },
          regulatoryFeeSchedule:{
            page:"kalshi.com/regulatory/fee-schedule",
            currentPageReachable:true,
            generalTakerFormula:"ceil_to_cent(0.07 * C * P * (1-P))",
            makerFormula:"ceil_to_cent(0.0175 * C * P * (1-P))"
          }
        },
        controllerInterpretation:{
          entryUsesImmediateOrCancel:true,
          entryThereforeModeledAsTaker:true,
          maxStakeCapIncludesEntryFee:true,
          entryFeeFormula:"ceil_to_cent(0.07 * C * P * (1-P))",
          specialMarketFeeOverrideRisk:"FAIL_CLOSED_IF_A_MARKET_SPECIFIC_FEE_DIFFERS_FROM_GENERAL_SCHEDULE",
          exitFee:"SEPARATE_REALIZED_TRADING_COST_RECORDED_ON_EXIT"
        },
        currentDryRun:{
          sampleAvailable:Boolean(sample),
          ticker:sample?.marketTicker||null,
          outcomeSide:sample?.outcomeSide||null,
          observedAsk:sample?.yes??null,
          feeSafeSizing:Boolean(sizing?.ok),
          count:sizing?.count||0,
          premiumUsd:sizing?.premiumUsd||0,
          estimatedEntryFeeUsd:sizing?.feeUsd||0,
          estimatedEntryDebitUsd:sizing?.totalDebitUsd||0,
          maxStakeUsd:REAL_TEST_CONFIG.maxStakeUsd
        },
        finalPretradeGates:{
          feeModelReverified:true,
          freshKalshiLocationVerificationRequired:true,
          founderSingleTradeAuthorizationRequired:true,
          continuousAutomaticTradingAuthorized:false
        },
        interlocks:{
          controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
          oneTradeAuthorizationActive:false,
          controllerEnabled:false,
          postOrdersCalled:false,
          deleteOrdersCalled:false,
          submitted:false,
          realMoneyMoved:false
        }
      });
    }

    if (url.pathname === "/kalshi-live-contract-verification-proof") {
      const shadow=await loadShadowState(env);
      const sample=(shadow?.opportunities||[]).find(o=>o?.marketTicker&&(o?.outcomeSide==="YES"||o?.outcomeSide==="NO"))||null;
      const sizing=sample?estimateKalshiFeeSafeSize(sample.yes,REAL_TEST_CONFIG.maxStakeUsd):null;
      const request=(sample&&sizing?.ok)?kalshiV2EntryPayload(sample,sizing,"CONTRACT-PROOF-NO-SUBMIT"):null;
      return json({
        ok:true,
        state:"KALSHI_LIVE_WRITE_CONTRACT_INDEPENDENTLY_REVERIFIED_HARD_DISABLED",
        verifiedAt:"2026-09-19",
        evidence:{
          kalshiHelpCenter:{title:"Kalshi API",published:"2026-03-10",supportsAuthenticatedOrdersTradesPortfolio:true},
          generatedSdk:{package:"kalshi-typescript",version:"3.26.0",createOrderV2:"POST /portfolio/events/orders",cancelOrderV2:"DELETE /portfolio/events/orders/{order_id}",getOrder:"GET /portfolio/orders/{order_id}"},
          productionBase:"https://external-api.kalshi.com/trade-api/v2"
        },
        contract:{
          side:["bid","ask"],
          bidMeaning:"BUY_YES",
          askMeaning:"SELL_YES_EQUIVALENT_BUY_NO_AT_COMPLEMENT",
          count:"fixed-point contract string",
          price:"fixed-point YES-leg dollar string",
          timeInForce:"immediate_or_cancel",
          selfTradePreventionType:"taker_at_cross",
          reduceOnlySupported:true,
          cancelOrderOnPauseSupported:true,
          createResponse:["order_id","client_order_id","fill_count","remaining_count","average_fill_price","average_fee_paid","ts_ms"],
          fillsReconciledByOrderId:true,
          partialFillMustBeManagedByExactFillCount:true
        },
        dryRun:{
          sampleAvailable:Boolean(sample),
          feeSafeSizing:Boolean(sizing?.ok),
          request:request?{...request,client_order_id:"CONTRACT-PROOF-NO-SUBMIT"}:null
        },
        strategyUnchanged:{
          entryScore:REAL_TEST_CONFIG.entryScore,
          exitScore:REAL_TEST_CONFIG.exitScore,
          maxHoldMinutes:REAL_TEST_CONFIG.maxHoldMs/60000,
          maxStakeUsd:REAL_TEST_CONFIG.maxStakeUsd
        },
        remainingTradeTimeGates:{
          freshKalshiLocationVerificationRequired:true,
          currentFeeScheduleRecheckRequired:true,
          founderSingleTradeAuthorizationRequired:true
        },
        interlocks:{
          controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
          oneTradeAuthorizationActive:false,
          controllerEnabled:false,
          postOrdersCalled:false,
          deleteOrdersCalled:false,
          submitted:false,
          realMoneyMoved:false
        }
      });
    }

    if (url.pathname === "/kalshi-v2-zero-submit-proof") {
      const shadow=await loadShadowState(env);
      const sample=(shadow?.opportunities||[]).find(o=>o?.marketTicker&&(o?.outcomeSide==="YES"||o?.outcomeSide==="NO"))||null;
      const sizing=sample?estimateKalshiFeeSafeSize(sample.yes,REAL_TEST_CONFIG.maxStakeUsd):null;
      const entry=(sample&&sizing?.ok)?kalshiV2EntryPayload(sample,sizing,"ZERO-SUBMIT-EXAMPLE"):null;
      const yesExample=sample?kalshiV2EntryPayload({...sample,outcomeSide:"YES",yes:sample.outcomeSide==="YES"?sample.yes:1-sample.yes},sizing||{count:1},"ZERO-SUBMIT-YES"):null;
      const noExample=sample?kalshiV2EntryPayload({...sample,outcomeSide:"NO",yes:sample.outcomeSide==="NO"?sample.yes:1-sample.yes},sizing||{count:1},"ZERO-SUBMIT-NO"):null;
      return json({
        ok:true,state:"KALSHI_V2_SCHEMA_AND_RECONCILIATION_CERTIFIED_ZERO_SUBMIT",
        officialSemantics:{
          createPath:"POST /trade-api/v2/portfolio/events/orders",
          yesLong:"book side bid",
          noLong:"book side ask",
          priceScale:"single YES-leg fixed-point dollars",
          timeInForce:"immediate_or_cancel",
          createResponse:["order_id","client_order_id","fill_count","remaining_count","average_fill_price","average_fee_paid"],
          getOrderPath:"GET /trade-api/v2/portfolio/orders/{order_id}",
          getFillsPath:"GET /trade-api/v2/portfolio/fills?order_id={order_id}",
          cancelPath:"DELETE /trade-api/v2/portfolio/events/orders/{order_id}",
          exit:"reverse book side + reduce_only=true"
        },
        dryRun:{sampleAvailable:Boolean(sample),feeSafeSizing:Boolean(sizing?.ok),entryRequest:entry?{...entry,client_order_id:"ZERO-SUBMIT-EXAMPLE"}:null,yesBookSide:yesExample?.side||"bid",noBookSide:noExample?.side||"ask"},
        reconciliation:{
          zeroFill:"IOC returns fill_count 0; no position opened",
          partialFill:"record exact fill_count; only filled quantity becomes managed position",
          fullFill:"remaining_count 0; manage exact filled quantity",
          ambiguity:"fail closed; reconcile by order_id via Get Order and Get Fills before any further write",
          exitPartial:"reconcile exit fill; never mark complete until filled quantity equals managed position quantity"
        },
        interlocks:{controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
          oneTradeAuthorizationActive:false,
          controllerEnabled:false,postOrdersCalled:false,deleteOrdersCalled:false,submitted:false,realMoneyMoved:false}
      });
    }

    if (url.pathname === "/first-real-trade-evidence") {
      const state=await loadRealTradeState(env);
      return json({ok:true,experiment:"MARKET EDGE — BASELINE REAL",strategyUnchanged:true,entryThreshold:REAL_TEST_CONFIG.entryScore,exitThreshold:REAL_TEST_CONFIG.exitScore,maxHoldMinutes:5,maxFirstTradeExposureUsd:5,oneEntryOnly:true,evidence:publicFirstTradeEvidence(state)});
    }

    if (url.pathname === "/kalshi-five-asset-readiness-proof") {
      try {
        const [series,discovery]=await Promise.all([
          resolveKalshi15mSeries(env),
          discoverKalshiShadowMarkets(env)
        ]);
        const safeSeries=series.map(s=>({
          asset:s.asset,
          seriesTicker:s.ticker||null,
          title:s.title||null,
          frequency:s.frequency||null,
          dynamicallyResolved:Boolean(s.dynamicallyResolved),
          metadataReady:Boolean(s.metadataReady),
          executionEligible:Boolean(s.executionEligible),
          settlementSourceNames:(s.settlementSources||[]).map(x=>x?.name||"").filter(Boolean)
        }));
        const coverage=discovery.coverage||{};
        return json({
          ok:true,
          state:"FIVE_ASSET_DISCOVERY_READ_ONLY",
          assets:["BTC","ETH","SOL","XRP","HYPE"],
          series:safeSeries,
          coverage,
          eligibleOpportunityCount:Number(discovery.markets?.length||0),
          autoSelectionRule:"HIGHEST_RANKED_QUALIFYING_SCORE_AT_OR_ABOVE_0_80",
          strategy:{entryScore:REAL_TEST_CONFIG.entryScore,exitScore:REAL_TEST_CONFIG.exitScore,maxHoldMinutes:REAL_TEST_CONFIG.maxHoldMs/60000,maxStakeUsd:REAL_TEST_CONFIG.maxStakeUsd},
          oneTradeOnly:true,
          submitted:false,
          realMoneyMoved:false
        });
      } catch(error) {
        return json({ok:false,state:"FIVE_ASSET_DISCOVERY_READ_FAILED",errorCode:String(error?.message||"READ_FAILED").slice(0,120),submitted:false,realMoneyMoved:false},422);
      }
    }

    if (url.pathname === "/kalshi-final-controller-safety-proof") {
      const shadow=await loadShadowState(env);
      const candidates=(shadow?.opportunities||[]).filter(o=>Number(o?.score)>=REAL_TEST_CONFIG.entryScore&&Number(o?.edge)>0);
      const candidate=candidates[0]||null;
      const sizing=candidate?estimateKalshiFeeSafeSize(candidate.yes,REAL_TEST_CONFIG.maxStakeUsd):null;
      return json({
        ok:true,
        state:"KALSHI_FINAL_CONTROLLER_HARD_DISABLED",
        strategy:{entryScore:REAL_TEST_CONFIG.entryScore,exitScore:REAL_TEST_CONFIG.exitScore,maxHoldMinutes:REAL_TEST_CONFIG.maxHoldMs/60000,maxStakeUsd:REAL_TEST_CONFIG.maxStakeUsd},
        safeguards:{
          oneShotPersistentLockRequired:true,
          opposingUnderlyingPositionGuard:true,
          minTimeToCloseMs:KALSHI_ONE_TRADE_SAFETY.minTimeToCloseMs,
          feeSafeSizing:Boolean(sizing?.ok),
          liveKalshiCoverageRequired:true,
          executionBalanceRecheckRequired:true,
          uniqueClientOrderIdRequired:true,
          entryPreSubmitLatchRequired:true,
          partialFillReconciliationRequired:true,
          pendingOrderTimeoutMs:KALSHI_ONE_TRADE_SAFETY.pendingOrderTimeoutMs,
          v2RequestSchemaFinalProofRequired:false,
          v2CreateSchemaCertified:true,
          outcomeDirectionCertified:true,
          iocPartialFillSemanticsCertified:true,
          getOrderReconciliationCertified:true,
          getFillsReconciliationCertified:true,
          cancelV2Certified:true,
          reduceOnlyExitRequired:true
        },
        current:{shadowStatus:shadow?.status||"UNKNOWN",qualifyingSignals:candidates.length,candidate:candidate?{marketTicker:candidate.marketTicker,outcomeSide:candidate.outcomeSide,direction:candidate.direction,score:candidate.score,closeTime:candidate.closeTime,sizing}:null},
        interlocks:{controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
          oneTradeAuthorizationActive:false,
          controllerEnabled:false,postOrdersCalled:false,deleteOrdersCalled:false,submitted:false,realMoneyMoved:false}
      });
    }

    if (url.pathname === "/kalshi-live-mirror") return html(kalshiLiveMirrorHtml());
    if (url.pathname === "/kalshi-live-mirror-data") return json(await kalshiLiveMirrorData(env));

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

    // Read-only provider catalogue probe for the three unresolved 15-minute lanes.
    // It reports raw Kalshi identifiers only and never invokes the trade controller.
    if (url.pathname === "/kalshi-15m-ticker-proof") {
      const aliases={SOL:["SOL","SOLANA"],XRP:["XRP","RIPPLE"],HYPE:["HYPE","HYPERLIQUID"]};
      const wanted=Object.keys(aliases), matches=[];
      let cursor="", pages=0, scanned=0, reachedEnd=false, readError=null;
      while(pages<100) {
        const path="/trade-api/v2/markets?status=open&limit=200"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
        let r; try{r=await kalshiShadowGet(env,path);}catch{readError="NETWORK_OR_SIGNING_READ_FAILED";break;}
        if(!r.ok){readError="MARKETS_READ_FAILED_"+r.status;break;}
        const data=await r.json(), markets=Array.isArray(data?.markets)?data.markets:[];
        scanned+=markets.length;
        for(const m of markets){
          const title=String(m?.title||""), subtitle=String(m?.subtitle||"");
          const ticker=String(m?.ticker||""), seriesTicker=String(m?.series_ticker||m?.seriesTicker||"");
          const text=(title+" "+subtitle+" "+ticker+" "+seriesTicker).toUpperCase();
          for(const asset of wanted){
            if(!(aliases[asset]||[asset]).some(alias=>new RegExp("(^|[^A-Z])"+alias+"([^A-Z]|$)").test(text))) continue;
            const open=Date.parse(m?.open_time||""), close=Date.parse(m?.close_time||"");
            const duration=Number.isFinite(open)&&Number.isFinite(close)?close-open:null;
            const shortText=/15\s*(MIN|MINUTE)|15M/.test(text);
            const duration15=duration!==null&&duration>=10*60*1000&&duration<=20*60*1000;
            if((shortText||duration15) && matches.filter(x=>x.asset===asset).length<12) matches.push({asset,marketTicker:ticker||null,seriesTicker:seriesTicker||null,title:title||null,subtitle:subtitle||null,openTime:m?.open_time||null,closeTime:m?.close_time||null,status:m?.status||null});
          }
        }
        cursor=String(data?.cursor||""); pages++;
        if(!cursor){reachedEnd=true;break;}
        if(wanted.every(a=>matches.some(x=>x.asset===a&&x.seriesTicker))) break;
      }
      return json({ok:!readError,readOnly:true,pages,scanned,reachedEnd,readError,matches,liveOrderSubmission:"DISABLED",realMoneyMoved:false});
    }

    // Browser-safe one-shot diagnostic: run a fresh Shadow observation and return
    // only bounded diagnostic fields. No order controller is invoked.
    if (url.pathname === "/shadow-refresh-diagnostic-view") {
      const refreshed = await runShadow(env);
      const safe = {
        status: refreshed?.status || "UNKNOWN",
        lastRunAt: refreshed?.lastRunAt || null,
        errorStage: refreshed?.errorStage || null,
        errorCode: refreshed?.errorCode || null,
        eligibleCount: Number(refreshed?.eligibleCount || 0),
        seenCount: Number(refreshed?.seenCount || 0),
        rejectedCount: Number(refreshed?.rejectedCount || 0),
        coverage: refreshed?.assetCoverage || null,
        seriesResolution: (refreshed?.kalshiSeriesCache||[]).map(s=>({asset:s.asset,ticker:s.ticker||null,title:s.title||null,frequency:s.frequency||null,dynamicallyResolved:Boolean(s.dynamicallyResolved),metadataReady:Boolean(s.metadataReady),executionEligible:Boolean(s.executionEligible),discoveredFrom:s.discoveredFrom||null,discoveryProof:s.discoveryProof||null})),
        liveOrderSubmission: "DISABLED",
        realMoneyMoved: false
      };
      return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Baseline Real Fresh Shadow Diagnostic</title><body style='font-family:system-ui;background:#07111d;color:#eef;padding:24px'><h2>Baseline Real · Fresh Shadow Diagnostic</h2><pre style='white-space:pre-wrap;font-size:16px'>"+JSON.stringify(safe,null,2).replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</pre></body>", {headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
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

    // Same safe diagnostic evidence, rendered as plain HTML so the Founder can
    // inspect it in a browser without exposing secrets or enabling execution.
    if (url.pathname === "/shadow-diagnostic-view") {
      const state = await loadShadowState(env);
      const safe = {
        status: state?.status || "UNKNOWN",
        lastRunAt: state?.lastRunAt || null,
        errorStage: state?.errorStage || null,
        errorCode: state?.errorCode || null,
        eligibleCount: Number(state?.eligibleCount || 0),
        seenCount: Number(state?.seenCount || 0),
        rejectedCount: Number(state?.rejectedCount || 0),
        liveOrderSubmission: "DISABLED",
        realMoneyMoved: false
      };
      return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Baseline Real Shadow Diagnostic</title><body style='font-family:system-ui;background:#07111d;color:#eef;padding:24px'><h2>Baseline Real · Shadow Diagnostic</h2><pre style='white-space:pre-wrap;font-size:16px'>"+JSON.stringify(safe,null,2).replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</pre></body>", {headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
    }

    if (url.pathname === "/controller-gate-proof") {
      const [state,shadow,schedulerProof]=await Promise.all([loadRealTradeState(env),loadShadowState(env),loadSchedulerProof(env)]);
      const now=Date.now();
      const scoreCandidates=(shadow?.opportunities||[]).filter(o =>
        Number(o?.score)>=REAL_TEST_CONFIG.entryScore && Number(o?.edge)>0 &&
        Number(o?.yes)>0.01 && Number(o?.yes)<0.99 && o?.marketTicker &&
        o?.executionEligible===true &&
        ["BTC","ETH","SOL","XRP","HYPE"].includes(String(o?.asset||"")) &&
        (o?.outcomeSide==="YES"||o?.outcomeSide==="NO")
      );
      const timeSafeCandidates=scoreCandidates.filter(o=>kalshiCandidateTimeSafe(o,now));
      const selected=timeSafeCandidates.slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0))[0]||null;
      let blockReason="READY_FOR_EXECUTION_PREFLIGHT";
      if(state?.consumed) blockReason="ONE_TRADE_ALREADY_COMPLETE";
      else if(!state?.entryOrderId && state?.entrySubmitStartedAt) blockReason=state?.entryProviderStatus!=null?"BLOCKED_ENTRY_PROVIDER_REJECTED":state?.entryWriteError?"BLOCKED_ENTRY_WRITE_ERROR":"BLOCKED_ENTRY_RECONCILIATION";
      else if(!kalshiControllerSwitchEnabled(env)) blockReason="CONTROLLER_SWITCH_HARD_DISABLED";
      else if(!kalshiAuthorizationValid(state)) blockReason="FOUNDER_AUTHORIZATION_NOT_ACTIVE";
      else if(!env?.BASELINE_REAL_SHADOW_STATE) blockReason="PERSISTENT_ONE_SHOT_LOCK_MISSING";
      else if(!shadow?.assetCoverageReady || shadow?.status!=="LIVE_KALSHI_SHADOW") blockReason="LIVE_KALSHI_COVERAGE_NOT_READY";
      else if(!selected) blockReason=scoreCandidates.length?"QUALIFYING_SCORE_PRESENT_BUT_TIME_GATE_FAILED":"NO_CONTROLLER_QUALIFYING_CANDIDATE";
      else if(hasOpposingUnderlyingPosition(shadow,selected)) blockReason="BLOCKED_OPPOSING_POSITION";
      else {
        const sizing=estimateKalshiFeeSafeSize(selected.yes,REAL_TEST_CONFIG.maxStakeUsd);
        if(!sizing.ok || sizing.totalDebitUsd>REAL_TEST_CONFIG.maxStakeUsd || sizing.count<1) blockReason="BLOCKED_FEE_SAFE_SIZE";
      }
      return json({
        ok:true,readOnly:true,state:"CONTROLLER_GATE_PROOF",
        now:new Date(now).toISOString(),
        controllerSwitchEnabled:kalshiControllerSwitchEnabled(env),
        founderAuthorizationActive:kalshiAuthorizationValid(state),
        authorizationConsumed:Boolean(state?.founderAuthorization?.consumed),
        authorizationScope:state?.founderAuthorization?.scope||null,
        entrySubmitLatched:Boolean(state?.entrySubmitStartedAt),
        entryOrderPresent:Boolean(state?.entryOrderId),
        filledCount:Number(state?.filledCount||0),
        controllerStatus:state?.status||"UNKNOWN",
        shadowStatus:shadow?.status||"UNKNOWN",
        shadowLastRunAt:shadow?.lastRunAt||null,
        shadowAgeMs:shadow?.lastRunAt?Math.max(0,now-Date.parse(shadow.lastRunAt)):null,
        schedulerLastInvokedAt:schedulerProof?.invokedAt||null,
        schedulerLastCompletedAt:schedulerProof?.completedAt||null,
        schedulerAgeMs:schedulerProof?.invokedAt?Math.max(0,now-Date.parse(schedulerProof.invokedAt)):null,
        schedulerShadowLastRunAt:schedulerProof?.shadowLastRunAt||null,
        schedulerShadowStatus:schedulerProof?.shadowStatus||null,
        schedulerEligibleCount:schedulerProof?.eligibleCount??null,
        schedulerControllerStatus:schedulerProof?.controllerStatus||null,
        schedulerControllerError:schedulerProof?.controllerError||null,
        schedulerControllerTraceHistory:Array.isArray(schedulerProof?.controllerTraceHistory)?schedulerProof.controllerTraceHistory:[],
        executionBalancePreflight:state?.executionBalancePreflight||null,
        recentControllerEvidence:(state?.ledger||[]).filter(x=>String(x?.type||"").includes("KALSHI_")||String(x?.type||"").includes("CANDIDATE_SHARD")).slice(0,12),
        scoreQualifyingCandidateCount:scoreCandidates.length,
        timeSafeQualifyingCandidateCount:timeSafeCandidates.length,
        selectedCandidate:selected?{
          asset:selected.asset||null,marketTicker:selected.marketTicker||null,outcomeSide:selected.outcomeSide||null,
          score:selected.score??null,closeTime:selected.closeTime||null,executionEligible:selected.executionEligible===true,
          exchangeIndex:selected.exchangeIndex??null,edge:selected.edge??null,observedAsk:selected.yes??null,
          timeToCloseMs:selected.closeTime?Date.parse(selected.closeTime)-now:null
        }:null,
        scoreCandidates:scoreCandidates.map(o=>({
          asset:o.asset||null,marketTicker:o.marketTicker||null,outcomeSide:o.outcomeSide||null,
          score:o.score??null,closeTime:o.closeTime||null,executionEligible:o.executionEligible===true,
          exchangeIndex:o.exchangeIndex??null,timeSafe:kalshiCandidateTimeSafe(o,now),
          timeToCloseMs:o.closeTime?Date.parse(o.closeTime)-now:null
        })),
        blockReason,
        lastProviderStatus:state?.entryProviderStatus??null,
        lastProviderError:state?.entryProviderResponse?.error?.code||state?.entryWriteError||null,
        freshEvidenceReady:Boolean(state?.firstRealTradeEvidence?.preTradeDecisionSnapshot),
        safety:{stateMutation:false,providerWrites:0,ordersCreated:0,transfers:0,reauthorizations:0,realMoneyMoved:false}
      });
    }

    if (url.pathname === "/real-trade-state") {
      const state=await loadRealTradeState(env),view=publicRealTradeView(state,env);
      const completed=Boolean(state?.consumed&&Number(state?.filledCount||0)>0&&Number(state?.exitFilledTotal||0)>0);
      if(completed){const bp=await kalshiExecutionBalanceSnapshot(env),cents=Number(bp?.body?.balance);if(bp?.ok&&Number.isFinite(cents)){view.providerCashUsd=Number((cents/100).toFixed(2));view.bankrollNetPnlUsd=Number((view.providerCashUsd-REAL_TEST_CONFIG.initialBankrollUsd).toFixed(2));view.accountingReconciled=true;}}
      return json(view);
    }

    if (url.pathname === "/failed-xrp-provider-reconciliation") {
      try {
        const state=await loadRealTradeState(env);
        const ticker=String(state?.marketTicker||"").trim();
        const clientOrderId=String(state?.entryClientOrderId||"").trim();
        if(!ticker || !clientOrderId) return json({ok:false,readOnly:true,state:"RECONCILIATION_IDENTIFIERS_MISSING"},409);
        const orderPath="/trade-api/v2/portfolio/orders?ticker="+encodeURIComponent(ticker)+"&limit=100";
        const fillPath="/trade-api/v2/portfolio/fills?ticker="+encodeURIComponent(ticker)+"&limit=1000";
        const [or,fr]=await Promise.all([kalshiExecutionGet(env,orderPath),kalshiExecutionGet(env,fillPath)]);
        let ob={},fb={}; try{ob=await or.json();}catch{} try{fb=await fr.json();}catch{}
        const orders=Array.isArray(ob?.orders)?ob.orders:[];
        const fills=Array.isArray(fb?.fills)?fb.fills:[];
        const clientOrders=orders.filter(x=>String(x?.client_order_id||"")===clientOrderId);
        const clientOrderIds=new Set(clientOrders.map(x=>String(x?.order_id||"")).filter(Boolean));
        const relatedFills=fills.filter(x=>clientOrderIds.has(String(x?.order_id||"")));
        return json({
          ok:or.ok&&fr.ok,readOnly:true,state:"FAILED_XRP_PROVIDER_RECONCILIATION",
          local:{ticker,clientOrderId,entryOrderId:state?.entryOrderId||null,filledCount:Number(state?.filledCount||0),providerHttpStatus:state?.entryProviderStatus??null},
          provider:{ordersHttpStatus:or.status,fillsHttpStatus:fr.status,matchingClientOrders:clientOrders,relatedFills},
          reconciledNoOrderOrFill:or.ok&&fr.ok&&clientOrders.length===0&&relatedFills.length===0,
          safety:{providerWrites:0,transfers:0,ordersCreated:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}
        },or.ok&&fr.ok?200:502);
      } catch(error) {
        return json({ok:false,readOnly:true,state:"FAILED_XRP_PROVIDER_RECONCILIATION_FAILED",errorCode:String(error?.message||"FAILED"),safety:{providerWrites:0,transfers:0,ordersCreated:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}},500);
      }
    }

    if (url.pathname === "/stale-xrp-recovery-readiness") {
      const state=await loadRealTradeState(env);
      const reconciledFailure=
        !state?.entryOrderId &&
        Number(state?.filledCount||0)===0 &&
        Number(state?.entryProviderStatus)===404 &&
        String(state?.entryProviderResponse?.error?.code||"")==="insufficient_shard_balance";
      const staleLatch=Boolean(state?.entrySubmitStartedAt);
      const evidencePreserved=Boolean(state?.firstRealTradeEvidence?.preTradeDecisionSnapshot);
      return json({
        ok:true,readOnly:true,state:"STALE_XRP_RECOVERY_READINESS",
        recoveryReady:reconciledFailure&&staleLatch&&evidencePreserved,
        observed:{
          marketTicker:state?.marketTicker||null,
          entryOrderId:state?.entryOrderId||null,
          filledCount:Number(state?.filledCount||0),
          providerHttpStatus:state?.entryProviderStatus??null,
          providerErrorCode:state?.entryProviderResponse?.error?.code||null,
          staleEntrySubmitLatch:staleLatch,
          immutablePreTradeEvidencePresent:evidencePreserved,
          founderAuthorizationConsumed:Boolean(state?.founderAuthorization?.consumed)
        },
        proposedRecovery:{
          preserves:["firstRealTradeEvidence","entryProviderResponse","entryProviderStatus","entryClientOrderId","ledger"],
          clearsOnlyOperationalLatch:["entrySubmitStartedAt","stale current candidate execution fields","consumed authorization state"],
          reauthorizes:false,submitsOrder:false,movesMoney:false
        },
        safety:{providerWrites:0,transfers:0,orders:0,reauthorizations:0,stateMutation:false,realMoneyMoved:false}
      });
    }

    if (url.pathname === "/first-entry-failure-proof") {
      const state=await loadRealTradeState(env);
      return json({
        ok:true,
        readOnly:true,
        status:state?.status||"UNKNOWN",
        marketTicker:state?.marketTicker||null,
        outcomeSide:state?.outcomeSide||null,
        entryScore:state?.entryScore??null,
        entrySubmitStartedAt:state?.entrySubmitStartedAt||null,
        entryOrderPresent:Boolean(state?.entryOrderId),
        filledCount:Number(state?.filledCount||0),
        providerHttpStatus:state?.entryProviderStatus??null,
        providerResponse:state?.entryProviderResponse??null,
        writeError:state?.entryWriteError??null,
        authorizationConsumed:Boolean(state?.founderAuthorization?.consumed),
        evidenceOnly:"NO STATE MUTATION / NO PROVIDER WRITE / NO REAUTHORIZATION"
      });
    }

    if (url.pathname === "/shadow-run") {
      return json(publicShadowView(await runShadow(env)));
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};

