import { calculateNV0, calculateFullSIV0, calculateSICoreV0A, N_VERSION, SI_VERSION } from "./si-n-v0.js";
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const BINANCE_US_BASE = "https://api.binance.us";
const DAY_MS = 86400000;

const json = (value, status = 200) => new Response(JSON.stringify(value, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
  },
});

function clamp(x, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }
function logistic(x) { return 1 / (1 + Math.exp(-x)); }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function sampleStd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function percentileRank(values, x) {
  if (!values.length || !Number.isFinite(x)) return null;
  const usable = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!usable.length) return null;
  let below = 0, equal = 0;
  for (const v of usable) { if (v < x) below++; else if (v === x) equal++; }
  return clamp((below + 0.5 * equal) / usable.length);
}
function ema(values, period) {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  let out = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) out = alpha * values[i] + (1 - alpha) * out;
  return out;
}
function atrSeries(bars, period = 14) {
  if (bars.length < period + 1) return [];
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const h=bars[i].high,l=bars[i].low,pc=bars[i-1].close;
    tr.push(Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)));
  }
  if (tr.length < period) return [];
  let atr = mean(tr.slice(0, period));
  const out = [{ index: period, atr }];
  for (let i = period; i < tr.length; i++) {
    atr = ((atr * (period - 1)) + tr[i]) / period;
    out.push({ index: i + 1, atr });
  }
  return out;
}
function parseKline(k) {
  return {
    openTime:Number(k[0]), open:Number(k[1]), high:Number(k[2]), low:Number(k[3]), close:Number(k[4]),
    volume:Number(k[5]), closeTime:Number(k[6]), quoteVolume:Number(k[7]), tradeCount:Number(k[8]),
    takerBuyBaseVolume:Number(k[9]), takerBuyQuoteVolume:Number(k[10])
  };
}
async function publicGet(path, params={}) {
  const u = new URL(BINANCE_US_BASE + path);
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  const r = await fetch(u.toString(), { headers: { "accept":"application/json", "user-agent":"NFE-OS-Robinhood-Observatory-V0A/1.0" }});
  const text = await r.text();
  if (!r.ok) throw new Error(`Binance.US ${path} HTTP ${r.status}: ${text.slice(0,200)}`);
  return JSON.parse(text);
}
async function loadSnapshot(env) {
  const u = new URL("https://asset.local/data/snapshot.json");
  const r = await env.ASSETS.fetch(new Request(u.toString()));
  if (!r.ok) throw new Error("Local snapshot unavailable");
  return r.json();
}
async function exchangeInfo() { return publicGet("/api/v3/exchangeInfo", { showPermissionSets:"false" }); }

function mapRobinhoodToBinance(robinhoodSymbol, symbols) {
  const base = robinhoodSymbol.replace(/-USD$/,"");
  const candidates = symbols.filter(s => s.baseAsset === base && s.status === "TRADING" && ["USD","USDT"].includes(s.quoteAsset));
  const usd = candidates.find(s=>s.quoteAsset==="USD");
  const usdt = candidates.find(s=>s.quoteAsset==="USDT");
  const chosen = usd || usdt || null;
  return {
    robinhoodSymbol,
    binanceSymbol: chosen?.symbol || null,
    baseAsset: base,
    quoteCurrency: chosen?.quoteAsset || null,
    mappingStatus: chosen ? "MAPPED" : "RESEARCH DATA UNAVAILABLE",
    mappingConfidence: usd ? "HIGH — exact base + USD quote" : usdt ? "MEDIUM — exact base + USDT quote; quote differs from Robinhood USD" : "NONE",
    alternatives: candidates.map(x=>({symbol:x.symbol,quoteCurrency:x.quoteAsset}))
  };
}

async function fetchKlinesRange(symbol, interval, startTime, endTime) {
  const all=[]; let cursor=startTime; let guard=0;
  while (cursor < endTime && guard++ < 50) {
    const rows = await publicGet("/api/v3/klines",{symbol,interval,startTime:cursor,endTime,limit:1000});
    if (!Array.isArray(rows) || !rows.length) break;
    const bars=rows.map(parseKline);
    all.push(...bars);
    const next=bars[bars.length-1].closeTime+1;
    if (next<=cursor) break;
    cursor=next;
    if (rows.length<1000) break;
  }
  const dedup=new Map(all.map(x=>[x.openTime,x]));
  return [...dedup.values()].sort((a,b)=>a.openTime-b.openTime);
}
function horizonStats(bars) {
  if (bars.length < 3) return null;
  const returns=[];
  for(let i=1;i<bars.length;i++) returns.push((bars[i].close-bars[i-1].close)/bars[i-1].close);
  const current=returns[returns.length-1], hist=returns.slice(0,-1);
  const m=mean(hist), sd=sampleStd(hist);
  const z=(sd && Number.isFinite(sd) && sd>0)?(current-m)/sd:null;
  return { return:current, mean:m, realizedVolatility:sd, z, logistic:z==null?null:logistic(z), observations:hist.length };
}
async function mappingResponse(env) {
  const [snapshot, info] = await Promise.all([loadSnapshot(env), exchangeInfo()]);
  const symbols=info.symbols||[];
  const rows=(snapshot.cryptoUniverse?.rows||[]).map(x=>({
    ...mapRobinhoodToBinance(x.symbol,symbols),
    robinhoodTradable:x.tradable,
    robinhoodProviderTradability:x.providerTradability,
    robinhoodHalted:x.halted
  }));
  return {
    source:"Binance.US public /api/v3/exchangeInfo — no credential",
    capturedAt:new Date().toISOString(),
    robinhoodPairs:rows.length,
    mapped:rows.filter(x=>x.mappingStatus==="MAPPED").length,
    unmapped:rows.filter(x=>x.mappingStatus!=="MAPPED").length,
    rows
  };
}
async function researchResponse(env, request) {
  const url=new URL(request.url);
  const robinhoodSymbol=url.searchParams.get("symbol")||"BTC-USD";
  const featureInterval=url.searchParams.get("featureInterval")||null;
  const lookbackDays=Number(url.searchParams.get("lookbackDays")||"0");
  if (!featureInterval || !["5m","15m","1h"].includes(featureInterval)) {
    return json({error:"featureInterval is required and must be 5m, 15m, or 1h. No default is hard-coded."},400);
  }
  if (!Number.isFinite(lookbackDays)||lookbackDays<=0||lookbackDays>60) {
    return json({error:"lookbackDays is required (1..60). No default research lookback is hard-coded."},400);
  }

  const [snapshot, info] = await Promise.all([loadSnapshot(env), exchangeInfo()]);
  const mapping=mapRobinhoodToBinance(robinhoodSymbol,info.symbols||[]);
  if (!mapping.binanceSymbol) return json({mapping, status:"RESEARCH DATA UNAVAILABLE"},404);

  const end=Date.now(), start=end-lookbackDays*DAY_MS;
  const [k5raw,k15raw,k60raw,book,depth] = await Promise.all([
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"5m",limit:1000}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"15m",limit:1000}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"1h",startTime:start,endTime:end,limit:1000}),
    publicGet("/api/v3/ticker/bookTicker",{symbol:mapping.binanceSymbol}),
    publicGet("/api/v3/depth",{symbol:mapping.binanceSymbol,limit:20})
  ]);
  const k5=k5raw.map(parseKline), k15=k15raw.map(parseKline), k60=k60raw.map(parseKline);
  const featureBars = featureInterval==="5m" ? k5 : featureInterval==="15m" ? k15 : k60;

  const h5=horizonStats(k5), h15=horizonStats(k15), h60=horizonStats(k60);
  const M=[h5?.logistic,h15?.logistic,h60?.logistic].every(Number.isFinite)
    ? 0.50*h5.logistic+0.30*h15.logistic+0.20*h60.logistic : null;

  const closes=featureBars.map(x=>x.close);
  const ema9=ema(closes,9), ema20=ema(closes,20), ema50=ema(closes,50);
  const atrs=atrSeries(featureBars,14);
  const currentAtr=atrs.length?atrs[atrs.length-1].atr:null;
  const currentClose=featureBars.at(-1)?.close??null;
  const D1=(ema9!=null&&ema20!=null&&currentAtr)?(ema9-ema20)/currentAtr:null;
  const D2=(ema20!=null&&ema50!=null&&currentAtr)?(ema20-ema50)/currentAtr:null;
  const T=(D1!=null&&D2!=null)?0.5*logistic(D1)+0.5*logistic(D2):null;

  const atrFractions=atrs.map(x=>x.atr/featureBars[x.index].close).filter(Number.isFinite);
  const currentAtrFraction=(currentAtr&&currentClose)?currentAtr/currentClose:null;
  const pAtr=currentAtrFraction==null?null:percentileRank(atrFractions.slice(0,-1),currentAtrFraction);
  const V=pAtr==null?null:clamp(1-2*Math.abs(pAtr-0.5));

  const latest=featureBars.at(-1), previous=featureBars.slice(0,-1);
  const normalVolume=mean(previous.map(x=>x.volume).filter(Number.isFinite));
  const rvol=(latest&&normalVolume)?latest.volume/normalVolume:null;
  const F=rvol==null?null:clamp(rvol/2);

  const dollarVolumes=previous.map(x=>x.quoteVolume).filter(Number.isFinite);
  const currentDollarVolume=latest?.quoteVolume??null;
  const qLiquidity=currentDollarVolume==null?null:percentileRank(dollarVolumes,currentDollarVolume);
  const bid=Number(book.bidPrice),ask=Number(book.askPrice),mark=(bid+ask)/2;
  const researchSpreadPct=mark?((ask-bid)/mark):null;
  const qSpread=null;
  const Q=null;

  const components={M,T,V,F,Q};
  const coreState=calculateSICoreV0A({M,T,V,Q,F});
  const coreReady=coreState.status==="VALID";
  const SI_CORE_V0A=coreState.value;

  const rh=(snapshot.cryptoUniverse?.rows||[]).find(x=>x.symbol===robinhoodSymbol)||null;
  return {
    status: coreReady?"CORE COMPUTED":"CORE INCOMPLETE — Q SPREAD HISTORY NOT YET COLLECTED",
    capturedAt:new Date().toISOString(),
    provenance:{
      researchSource:"Binance.US public market data",
      lockAuthority:"Robinhood MCP only",
      positionAuthority:"Robinhood MCP only",
      credential:"NONE",
      executionAuthority:"NONE"
    },
    configuration:{featureInterval,lookbackDays,momentumHorizons:["5m","15m","1h"],momentumDistribution:"most recent up to 1000 bars per horizon",featureHistoryRequirement:"caller-selected interval; lookbackDays applies to 1h feature history in this V0-A specimen"},
    mapping,
    robinhoodSnapshot:rh?{symbol:rh.symbol,bid:rh.bid,ask:rh.ask,mark:rh.mark,providerTimestamp:rh.providerTimestamp,tradable:rh.tradable,halted:rh.halted}:null,
    raw:{
      returns:{m5:h5,m15:h15,m60:h60},
      ema9,ema20,ema50,atr14:currentAtr,atrFraction:currentAtrFraction,atrPercentile:pAtr,
      volume:latest?.volume??null,relativeVolume:rvol,quoteVolume:latest?.quoteVolume??null,
      takerBuyBaseVolume:latest?.takerBuyBaseVolume??null,takerBuyQuoteVolume:latest?.takerBuyQuoteVolume??null,
      tradeCount:latest?.tradeCount??null,dollarVolume:currentDollarVolume,
      researchBook:{bid,ask,mark,spreadPct:researchSpreadPct,bidQty:Number(book.bidQty),askQty:Number(book.askQty)},
      depthSummary:{bidLevels:depth.bids?.length||0,askLevels:depth.asks?.length||0,bestBid:depth.bids?.[0]||null,bestAsk:depth.asks?.[0]||null},
      qLiquidityPercentile:qLiquidity,
      qSpreadPercentile:null
    },
    components:{
      M:{value:M,source:"Binance.US",formula:"0.50*L(Z5)+0.30*L(Z15)+0.20*L(Z60)"},
      T:{value:T,source:"Binance.US",formula:"0.50*L((EMA9-EMA20)/ATR14)+0.50*L((EMA20-EMA50)/ATR14)"},
      V:{value:V,source:"Binance.US",formula:"clamp(1-2*abs(P_ATR-0.50),0,1)"},
      F:{value:F,source:"Binance.US",formula:"clamp(RVOL/2,0,1)"},
      Q:{value:Q,source:"Binance.US historical research + Robinhood lock truth",qLiquidity,qSpread,reason:"Historical Binance.US spread distribution does not exist retroactively in REST data; must be collected prospectively."},
      N:{value:null,source:"NFE/UMEO research only",state:"RESEARCH_ONLY"}
    },
    scores:{SI_CORE_V0A,fullSI:null,fullSIState:"INCOMPLETE — N RESEARCH STATE NOT VALID"},
    missingInputFlags:["historical spread distribution for Q_SPREAD","persistent observation ledger","forward outcome reconciliation","+1m/+5m/+15m/+1h outcomes","MFE","MAE"],
    fireAuthority:"ZERO"
  };
}


async function resolveMapping(env, robinhoodSymbol) {
  const [snapshot, info] = await Promise.all([loadSnapshot(env), exchangeInfo()]);
  const mapping=mapRobinhoodToBinance(robinhoodSymbol,info.symbols||[]);
  const rh=(snapshot.cryptoUniverse?.rows||[]).find(x=>x.symbol===robinhoodSymbol)||null;
  return {mapping,rh};
}
async function momentumResponse(env, request) {
  const url=new URL(request.url);
  const robinhoodSymbol=url.searchParams.get("symbol")||"BTC-USD";
  const bars=Number(url.searchParams.get("bars")||"0");
  if (!Number.isInteger(bars)||bars<100||bars>1000) return json({error:"bars is required (100..1000). No default is hard-coded."},400);
  const {mapping,rh}=await resolveMapping(env,robinhoodSymbol);
  if(!mapping.binanceSymbol) return json({mapping,status:"RESEARCH DATA UNAVAILABLE"},404);
  const [a,b,d]=await Promise.all([
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"5m",limit:bars}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"15m",limit:bars}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"1h",limit:bars})
  ]);
  const h5=horizonStats(a.map(parseKline)),h15=horizonStats(b.map(parseKline)),h60=horizonStats(d.map(parseKline));
  const M=[h5?.logistic,h15?.logistic,h60?.logistic].every(Number.isFinite)?0.50*h5.logistic+0.30*h15.logistic+0.20*h60.logistic:null;
  return json({status:M==null?"INCOMPLETE":"PASS",provenance:{researchSource:"Binance.US",lockAuthority:"Robinhood MCP only",credential:"NONE"},mapping,robinhoodSnapshot:rh,configuration:{bars,momentumHorizons:["5m","15m","1h"]},raw:{m5:h5,m15:h15,m60:h60},M,fireAuthority:"ZERO"});
}
async function featureResponse(env, request) {
  const url=new URL(request.url);
  const robinhoodSymbol=url.searchParams.get("symbol")||"BTC-USD";
  const featureInterval=url.searchParams.get("featureInterval")||null;
  const lookbackDays=Number(url.searchParams.get("lookbackDays")||"0");
  if(!featureInterval||!["5m","15m","1h"].includes(featureInterval)) return json({error:"featureInterval is required: 5m, 15m, or 1h."},400);
  if(!Number.isFinite(lookbackDays)||lookbackDays<=0||lookbackDays>30) return json({error:"lookbackDays is required (1..30)."},400);
  const {mapping,rh}=await resolveMapping(env,robinhoodSymbol);
  if(!mapping.binanceSymbol) return json({mapping,status:"RESEARCH DATA UNAVAILABLE"},404);
  const end=Date.now(),start=end-lookbackDays*DAY_MS;
  const raw=await publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:featureInterval,startTime:start,endTime:end,limit:1000});
  const bars=raw.map(parseKline), closes=bars.map(x=>x.close);
  const ema9=ema(closes,9),ema20=ema(closes,20),ema50=ema(closes,50);
  const atrs=atrSeries(bars,14),currentAtr=atrs.length?atrs[atrs.length-1].atr:null,currentClose=bars.length?bars[bars.length-1].close:null;
  const D1=(ema9!=null&&ema20!=null&&currentAtr)?(ema9-ema20)/currentAtr:null;
  const D2=(ema20!=null&&ema50!=null&&currentAtr)?(ema20-ema50)/currentAtr:null;
  const T=(D1!=null&&D2!=null)?0.5*logistic(D1)+0.5*logistic(D2):null;
  const atrFractions=atrs.map(x=>x.atr/bars[x.index].close).filter(Number.isFinite);
  const currentAtrFraction=(currentAtr&&currentClose)?currentAtr/currentClose:null;
  const pAtr=currentAtrFraction==null?null:percentileRank(atrFractions.slice(0,-1),currentAtrFraction);
  const V=pAtr==null?null:clamp(1-2*Math.abs(pAtr-0.5));
  const latest=bars.length?bars[bars.length-1]:null, previous=bars.slice(0,-1);
  const normalVolume=mean(previous.map(x=>x.volume).filter(Number.isFinite));
  const rvol=(latest&&normalVolume)?latest.volume/normalVolume:null;
  const F=rvol==null?null:clamp(rvol/2);
  const dollarVolumes=previous.map(x=>x.quoteVolume).filter(Number.isFinite);
  const qLiquidity=latest?percentileRank(dollarVolumes,latest.quoteVolume):null;
  return json({status:[T,V,F].every(Number.isFinite)?"PASS":"INCOMPLETE",provenance:{researchSource:"Binance.US",lockAuthority:"Robinhood MCP only",credential:"NONE"},mapping,robinhoodSnapshot:rh,configuration:{featureInterval,lookbackDays},raw:{ema9,ema20,ema50,atr14:currentAtr,atrFraction:currentAtrFraction,atrPercentile:pAtr,volume:latest?.volume??null,relativeVolume:rvol,quoteVolume:latest?.quoteVolume??null,takerBuyBaseVolume:latest?.takerBuyBaseVolume??null,takerBuyQuoteVolume:latest?.takerBuyQuoteVolume??null,tradeCount:latest?.tradeCount??null,dollarVolume:latest?.quoteVolume??null,qLiquidityPercentile:qLiquidity},T,V,F,qLiquidity,fireAuthority:"ZERO"});
}
async function bookResponse(env, request) {
  const url=new URL(request.url),robinhoodSymbol=url.searchParams.get("symbol")||"BTC-USD";
  const {mapping,rh}=await resolveMapping(env,robinhoodSymbol);
  if(!mapping.binanceSymbol) return json({mapping,status:"RESEARCH DATA UNAVAILABLE"},404);
  const [book,depth]=await Promise.all([
    publicGet("/api/v3/ticker/bookTicker",{symbol:mapping.binanceSymbol}),
    publicGet("/api/v3/depth",{symbol:mapping.binanceSymbol,limit:20})
  ]);
  const bid=Number(book.bidPrice),ask=Number(book.askPrice),mark=(bid+ask)/2,spreadPct=mark?((ask-bid)/mark):null;
  return json({status:"PASS / Q INCOMPLETE",provenance:{researchSource:"Binance.US",lockAuthority:"Robinhood MCP only",credential:"NONE"},mapping,robinhoodSnapshot:rh,researchBook:{bid,ask,mark,spreadPct,bidQty:Number(book.bidQty),askQty:Number(book.askQty)},depthSummary:{bidLevels:depth.bids?.length||0,askLevels:depth.asks?.length||0,bestBid:depth.bids?.[0]||null,bestAsk:depth.asks?.[0]||null},qSpread:null,Q:null,reason:"Historical same-pair spread distribution must be collected prospectively; current Binance.US spread never substitutes for Robinhood LOCK spread.",fireAuthority:"ZERO"});
}


async function computeShadowFeatureSet(env, robinhoodSymbol, mapping, currentBook) {
  const [m5raw,m15raw,m60raw,featureRaw] = await Promise.all([
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"5m",limit:1000}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"15m",limit:1000}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"1h",limit:1000}),
    publicGet("/api/v3/klines",{symbol:mapping.binanceSymbol,interval:"1h",startTime:Date.now()-30*DAY_MS,endTime:Date.now(),limit:1000})
  ]);
  const k5=m5raw.map(parseKline),k15=m15raw.map(parseKline),k60=m60raw.map(parseKline),bars=featureRaw.map(parseKline);
  const h5=horizonStats(k5),h15=horizonStats(k15),h60=horizonStats(k60);
  const M=[h5?.logistic,h15?.logistic,h60?.logistic].every(Number.isFinite)?0.50*h5.logistic+0.30*h15.logistic+0.20*h60.logistic:null;

  const closes=bars.map(x=>x.close);
  const ema9=ema(closes,9),ema20=ema(closes,20),ema50=ema(closes,50);
  const atrs=atrSeries(bars,14), currentAtr=atrs.length?atrs[atrs.length-1].atr:null, currentClose=bars.at(-1)?.close??null;
  const D1=(ema9!=null&&ema20!=null&&currentAtr)?(ema9-ema20)/currentAtr:null;
  const D2=(ema20!=null&&ema50!=null&&currentAtr)?(ema20-ema50)/currentAtr:null;
  const T=(D1!=null&&D2!=null)?0.5*logistic(D1)+0.5*logistic(D2):null;

  const atrFractions=atrs.map(x=>x.atr/bars[x.index].close).filter(Number.isFinite);
  const currentAtrFraction=(currentAtr&&currentClose)?currentAtr/currentClose:null;
  const pAtr=currentAtrFraction==null?null:percentileRank(atrFractions.slice(0,-1),currentAtrFraction);
  const V=pAtr==null?null:clamp(1-2*Math.abs(pAtr-0.5));

  const latest=bars.at(-1), previous=bars.slice(0,-1);
  const normalVolume=mean(previous.map(x=>x.volume).filter(Number.isFinite));
  const rvol=(latest&&normalVolume)?latest.volume/normalVolume:null;
  const F=rvol==null?null:clamp(rvol/2);
  const qLiquidity=latest?percentileRank(previous.map(x=>x.quoteVolume).filter(Number.isFinite),latest.quoteVolume):null;

  const prior=await env.V0A_DB.prepare(
    "SELECT spread_pct FROM v0a_spread_samples WHERE research_symbol = ? ORDER BY sampled_at_ms ASC"
  ).bind(mapping.binanceSymbol).all();
  const priorSpreads=(prior.results||[]).map(x=>Number(x.spread_pct)).filter(Number.isFinite);
  const qSpreadPercentile=priorSpreads.length?percentileRank(priorSpreads,currentBook.spreadPct):null;
  const qSpread=qSpreadPercentile==null?null:1-qSpreadPercentile;
  const Q=(qSpread!=null&&qLiquidity!=null)?0.50*qSpread+0.50*qLiquidity:null;
  const SI_CORE_V0A=calculateSICoreV0A({M,T,V,Q,F}).value;

  return {
    returns:{r5:h5?.return??null,r15:h15?.return??null,r60:h60?.return??null},
    ema9,ema20,ema50,atr14:currentAtr,atrPercentile:pAtr,
    volume:latest?.volume??null,relativeVolume:rvol,quoteVolume:latest?.quoteVolume??null,
    takerBuyBaseVolume:latest?.takerBuyBaseVolume??null,takerBuyQuoteVolume:latest?.takerBuyQuoteVolume??null,
    tradeCount:latest?.tradeCount??null,dollarVolume:latest?.quoteVolume??null,
    M,T,V,F,Q,qSpread,qLiquidity,SI_CORE_V0A,priorSpreadSamples:priorSpreads.length
  };
}

async function reconcileOutcomes(env, nowMs) {
  const pending=await env.V0A_DB.prepare(
    `SELECT o.id,o.observation_id,o.horizon_minutes,o.due_at_ms,o.start_mark,
            obs.research_symbol,obs.observed_at_ms
       FROM v0a_outcomes o
       JOIN v0a_observations obs ON obs.id=o.observation_id
      WHERE o.status='PENDING' AND o.due_at_ms <= ?
      ORDER BY o.due_at_ms ASC
      LIMIT 200`
  ).bind(nowMs).all();

  let reconciled=0;
  for (const row of pending.results||[]) {
    const end=await env.V0A_DB.prepare(
      `SELECT mark,sampled_at_ms FROM v0a_spread_samples
        WHERE research_symbol=? AND sampled_at_ms>=?
        ORDER BY sampled_at_ms ASC LIMIT 1`
    ).bind(row.research_symbol,row.due_at_ms).first();
    if(!end) continue;
    const extrema=await env.V0A_DB.prepare(
      `SELECT MIN(mark) AS min_mark,MAX(mark) AS max_mark
         FROM v0a_spread_samples
        WHERE research_symbol=? AND sampled_at_ms>=? AND sampled_at_ms<=?`
    ).bind(row.research_symbol,row.observed_at_ms,end.sampled_at_ms).first();
    const start=Number(row.start_mark), endMark=Number(end.mark), minMark=Number(extrema?.min_mark), maxMark=Number(extrema?.max_mark);
    const outcome=start?((endMark-start)/start):null;
    const mfe=start&&Number.isFinite(maxMark)?((maxMark-start)/start):null;
    const mae=start&&Number.isFinite(minMark)?((minMark-start)/start):null;
    await env.V0A_DB.prepare(
      `UPDATE v0a_outcomes
          SET reconciled_at=?,reconciled_at_ms=?,end_mark=?,outcome_return=?,mfe=?,mae=?,status='RECONCILED'
        WHERE id=?`
    ).bind(new Date(nowMs).toISOString(),nowMs,endMark,outcome,mfe,mae,row.id).run();
    reconciled++;
  }
  return reconciled;
}

async function runScheduledCollection(env) {
  if(!env.V0A_DB) throw new Error("V0A_DB binding missing");
  const nowMs=Date.now(), nowIso=new Date(nowMs).toISOString();
  const [snapshot, mappingState, allBooks] = await Promise.all([
    loadSnapshot(env),
    mappingResponse(env),
    publicGet("/api/v3/ticker/bookTicker")
  ]);
  const bookMap=new Map((Array.isArray(allBooks)?allBooks:[]).map(x=>[x.symbol,x]));
  const spreadStatements=[];
  const mappedRows=(mappingState.rows||[]).filter(x=>x.mappingStatus==="MAPPED" && x.robinhoodTradable);
  for(const m of mappedRows){
    const b=bookMap.get(m.binanceSymbol);
    if(!b) continue;
    const bid=Number(b.bidPrice),ask=Number(b.askPrice),mark=(bid+ask)/2;
    if(!(bid>0&&ask>0&&mark>0)) continue;
    const spread=ask-bid,spreadPct=spread/mark;
    spreadStatements.push(env.V0A_DB.prepare(
      `INSERT INTO v0a_spread_samples
       (sampled_at,sampled_at_ms,robinhood_symbol,research_symbol,quote_currency,mapping_confidence,bid,ask,mark,spread,spread_pct,bid_qty,ask_qty,source)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(nowIso,nowMs,m.robinhoodSymbol,m.binanceSymbol,m.quoteCurrency,m.mappingConfidence,bid,ask,mark,spread,spreadPct,Number(b.bidQty)||null,Number(b.askQty)||null,"BINANCE.US_PUBLIC"));
  }

  const governedSymbol=snapshot.operationalCockpit?.lock?.symbol || snapshot.siCryptoV0A?.instrumentationLedger?.observation?.symbol || null;
  let observationId=null,featureState=null;
  if(governedSymbol){
    const mapping=mappedRows.find(x=>x.robinhoodSymbol===governedSymbol);
    const b=mapping?bookMap.get(mapping.binanceSymbol):null;
    const rh=(snapshot.cryptoUniverse?.rows||[]).find(x=>x.symbol===governedSymbol)||null;
    if(mapping&&b){
      const bid=Number(b.bidPrice),ask=Number(b.askPrice),mark=(bid+ask)/2,spreadPct=(ask-bid)/mark;
      const currentBook={bid,ask,mark,spreadPct};
      featureState=await computeShadowFeatureSet(env,governedSymbol,mapping,currentBook);
      const nState=calculateNV0(snapshot.siCryptoV0A?.nEvidenceBundle??null,nowMs);
      const fullState=calculateFullSIV0({M:featureState.M,T:featureState.T,V:featureState.V,Q:featureState.Q,F:featureState.F,N:nState.value});
      const missing=[];
      if(featureState.Q==null) missing.push("Q_SPREAD_HISTORY");
      if(featureState.SI_CORE_V0A==null) missing.push("SI_CORE_INCOMPLETE");
      for(const m of nState.missing) missing.push(`${m.component}:${m.reason}`);
      const ins=await env.V0A_DB.prepare(
        `INSERT INTO v0a_observations (
          observed_at,observed_at_ms,robinhood_symbol,research_symbol,research_source,mapping_status,mapping_confidence,quote_currency,
          research_bid,research_ask,research_mark,research_spread_pct,robinhood_bid,robinhood_ask,robinhood_mark,robinhood_provider_timestamp,
          return_5m,return_15m,return_1h,ema9,ema20,ema50,atr14,atr_percentile,volume,relative_volume,quote_volume,
          taker_buy_base_volume,taker_buy_quote_volume,trade_count,dollar_volume,q_spread,q_liquidity,m,t,v,f,q,
          n_e,n_fr,n_tr,n_tx,n_a,n_c,si_core_v0a,full_si,full_si_state,data_freshness,missing_input_flags
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        nowIso,nowMs,governedSymbol,mapping.binanceSymbol,"BINANCE.US_PUBLIC","MAPPED",mapping.mappingConfidence,mapping.quoteCurrency,
        bid,ask,mark,spreadPct,rh?.bid??null,rh?.ask??null,rh?.mark??null,rh?.providerTimestamp??null,
        featureState.returns.r5,featureState.returns.r15,featureState.returns.r60,featureState.ema9,featureState.ema20,featureState.ema50,
        featureState.atr14,featureState.atrPercentile,featureState.volume,featureState.relativeVolume,featureState.quoteVolume,
        featureState.takerBuyBaseVolume,featureState.takerBuyQuoteVolume,featureState.tradeCount,featureState.dollarVolume,
        featureState.qSpread,featureState.qLiquidity,featureState.M,featureState.T,featureState.V,featureState.F,featureState.Q,
        nState.components.N_E.value,nState.components.N_Fr.value,nState.components.N_Tr.value,nState.components.N_Tx.value,nState.components.N_A.value,nState.components.N_C.value,
        featureState.SI_CORE_V0A,fullState.value,fullState.status==="VALID"?"VALID":"INCOMPLETE — "+fullState.missing.join(","),"BINANCE.US_PUBLIC_CURRENT",JSON.stringify(missing)
      ).run();
      observationId=Number(ins.meta?.last_row_id||ins.results?.meta?.last_row_id||0)||null;
      if(observationId){
        await env.V0A_DB.prepare(
          `UPDATE v0a_observations
              SET n_version=?,si_version=?,n_v0=?,n_status=?,n_missing_components=?,n_provenance_json=?,
                  n_e_reason=?,n_fr_reason=?,n_tr_reason=?,n_tx_reason=?,n_a_reason=?,n_c_reason=?
            WHERE id=?`
        ).bind(
          N_VERSION,SI_VERSION,nState.value,nState.status,JSON.stringify(nState.missing),JSON.stringify(nState.provenance),
          nState.components.N_E.reason,nState.components.N_Fr.reason,nState.components.N_Tr.reason,nState.components.N_Tx.reason,nState.components.N_A.reason,nState.components.N_C.reason,
          observationId
        ).run();
        const horizons=[1,5,15,60];
        await env.V0A_DB.batch(horizons.map(h=>env.V0A_DB.prepare(
          "INSERT OR IGNORE INTO v0a_outcomes(observation_id,horizon_minutes,due_at_ms,start_mark,status,source) VALUES(?,?,?,?,?,?)"
        ).bind(observationId,h,nowMs+h*60000,mark,"PENDING","BINANCE.US_RESEARCH")));
      }
    }
  }

  if(spreadStatements.length) await env.V0A_DB.batch(spreadStatements);
  const reconciled=await reconcileOutcomes(env,nowMs);
  return {sampledAt:nowIso,spreadSamplesInserted:spreadStatements.length,governedSymbol,observationId,reconciled,featureState};
}

async function ledgerStatus(env) {
  if(!env.V0A_DB) return {status:"D1_BINDING_MISSING"};
  const [obs,spreads,outcomes,pending,reconciled,lastObs,lastSpread]=await Promise.all([
    env.V0A_DB.prepare("SELECT COUNT(*) AS n FROM v0a_observations").first(),
    env.V0A_DB.prepare("SELECT COUNT(*) AS n FROM v0a_spread_samples").first(),
    env.V0A_DB.prepare("SELECT COUNT(*) AS n FROM v0a_outcomes").first(),
    env.V0A_DB.prepare("SELECT COUNT(*) AS n FROM v0a_outcomes WHERE status='PENDING'").first(),
    env.V0A_DB.prepare("SELECT COUNT(*) AS n FROM v0a_outcomes WHERE status='RECONCILED'").first(),
    env.V0A_DB.prepare("SELECT * FROM v0a_observations ORDER BY observed_at_ms DESC LIMIT 1").first(),
    env.V0A_DB.prepare("SELECT sampled_at,sampled_at_ms,research_symbol,spread_pct FROM v0a_spread_samples ORDER BY sampled_at_ms DESC LIMIT 1").first()
  ]);
  const byHorizon=await env.V0A_DB.prepare(
    "SELECT horizon_minutes,status,COUNT(*) AS n FROM v0a_outcomes GROUP BY horizon_minutes,status ORDER BY horizon_minutes,status"
  ).all();
  return {
    status:"PASS",
    database:"nfe-os-robinhood-si-v0a-ledger",
    authority:"RESEARCH_ONLY",
    counts:{observations:Number(obs?.n||0),spreadSamples:Number(spreads?.n||0),outcomes:Number(outcomes?.n||0),pending:Number(pending?.n||0),reconciled:Number(reconciled?.n||0)},
    byHorizon:byHorizon.results||[],
    latestObservation:lastObs||null,
    latestSpreadSample:lastSpread||null,
    versions:{n:N_VERSION,si:SI_VERSION},
    nPolicy:{missingData:"FAIL_CLOSED_NO_DEFAULT",marketDataDoubleCountPrevented:true},
    robinhoodExecution:"DISARMED",
    binanceExecutionAuthority:"NONE",
    fireAuthority:"ZERO"
  };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledCollection(env));
  },
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {status:405,headers:{"Allow":"GET, HEAD",...SECURITY_HEADERS}});
    }
    const url=new URL(request.url);
    try {
      if (url.pathname === "/api/v0a/mapping") return json(await mappingResponse(env));
      if (url.pathname === "/api/v0a/research") return json({status:"SPLIT ROUTES REQUIRED",routes:["/api/v0a/momentum","/api/v0a/features","/api/v0a/book"],reason:"V0-A stateless runtime uses bounded component routes."},409);
      if (url.pathname === "/api/v0a/momentum") return await momentumResponse(env,request);
      if (url.pathname === "/api/v0a/features") return await featureResponse(env,request);
      if (url.pathname === "/api/v0a/book") return await bookResponse(env,request);
      if (url.pathname === "/api/v0a/ledger-status") return json(await ledgerStatus(env));
      if (url.pathname === "/api/v0a/ping") {
        const p=await publicGet("/api/v3/ping");
        return json({status:"PASS",source:"Binance.US public market data",credential:"NONE",executionAuthority:"NONE",upstream:p});
      }
    } catch (e) {
      return json({status:"ERROR",message:String(e?.message||e),fabricatedValues:false},502);
    }
    const assetResponse=await env.ASSETS.fetch(request);
    const headers=new Headers(assetResponse.headers);
    for (const [name,value] of Object.entries(SECURITY_HEADERS)) headers.set(name,value);
    return new Response(assetResponse.body,{status:assetResponse.status,statusText:assetResponse.statusText,headers});
  },
};
