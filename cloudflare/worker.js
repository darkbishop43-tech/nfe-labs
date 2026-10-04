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
  const [k5,k15,k60,featureBars,book,depth] = await Promise.all([
    fetchKlinesRange(mapping.binanceSymbol,"5m",start,end),
    fetchKlinesRange(mapping.binanceSymbol,"15m",start,end),
    fetchKlinesRange(mapping.binanceSymbol,"1h",start,end),
    featureInterval==="5m"?fetchKlinesRange(mapping.binanceSymbol,"5m",start,end):
      featureInterval==="15m"?fetchKlinesRange(mapping.binanceSymbol,"15m",start,end):
      fetchKlinesRange(mapping.binanceSymbol,"1h",start,end),
    publicGet("/api/v3/ticker/bookTicker",{symbol:mapping.binanceSymbol}),
    publicGet("/api/v3/depth",{symbol:mapping.binanceSymbol,limit:20})
  ]);

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
  const coreReady=[M,T,V,F,Q].every(Number.isFinite);
  const SI_CORE_V0A=coreReady?100*(0.30*M+0.20*T+0.15*V+0.10*Q+0.15*F)/0.90:null;

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
    configuration:{featureInterval,lookbackDays,momentumHorizons:["5m","15m","1h"]},
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

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {status:405,headers:{"Allow":"GET, HEAD",...SECURITY_HEADERS}});
    }
    const url=new URL(request.url);
    try {
      if (url.pathname === "/api/v0a/mapping") return json(await mappingResponse(env));
      if (url.pathname === "/api/v0a/research") return await researchResponse(env,request);
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
