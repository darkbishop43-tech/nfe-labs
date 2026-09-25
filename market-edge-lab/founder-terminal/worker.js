const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"content-type"};
const BASELINE="https://market-edge-baseline-real.darkbishop43.workers.dev";
const KALSHI="https://api.elections.kalshi.com/trade-api/v2";
const COINBASE="https://api.exchange.coinbase.com";
const PRODUCTS=new Set(["BTC-USD","ETH-USD","SOL-USD","XRP-USD","HYPE-USD","ZEC-USD","DOGE-USD","BNB-USD","NEAR-USD","ADA-USD","TON-USD","BCH-USD"]);
const GRANULARITY=new Map([["60",60],["300",300],["900",900],["3600",3600],["86400",86400]]);
const json=(x,s=200)=>new Response(JSON.stringify(x,null,2),{status:s,headers:JSON_HEADERS});
async function getJson(url,timeout=12000){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),timeout);
  try{const r=await fetch(url,{headers:{accept:"application/json","user-agent":"NFE-OS-Founder-Terminal-ReadOnly/2.0"},signal:ctl.signal});let body=null;try{body=await r.json()}catch{}return{ok:r.ok,status:r.status,body};}
  catch(e){return{ok:false,status:null,error:e?.name==="AbortError"?"TIMEOUT":"FETCH_FAILED",body:null};}
  finally{clearTimeout(t)}
}
async function getBaselineJson(env,path){
  try{
    if(!env?.BASELINE_READ)return{ok:false,status:null,error:"BASELINE_READ_BINDING_MISSING",body:null};
    const r=await env.BASELINE_READ.fetch(new Request("https://baseline-read.internal"+path,{method:"GET",headers:{accept:"application/json","x-nfe-cockpit-mode":"READ_ONLY"}}));
    let body=null;try{body=await r.json()}catch{}
    return{ok:r.ok,status:r.status,body};
  }catch{return{ok:false,status:null,error:"BASELINE_READ_FAILED",body:null}}
}
function cleanTicker(v){const s=String(v||"").trim();return /^[A-Z0-9._-]{4,96}$/.test(s)?s:null}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
async function snapshot(env){
  const paths=["/health","/status","/account","/shadow-state","/execution-test-state","/real-trade-state","/kalshi-live-mirror-data","/wide-radar-state"];
  const reads=await Promise.all(paths.map(p=>getBaselineJson(env,p)));
  const map=Object.fromEntries(paths.map((p,i)=>[p,{ok:reads[i].ok,status:reads[i].status,body:reads[i].body}]));
  return {
    ok:reads[0].ok,readOnly:true,source:"PUBLIC_BASELINE_READS_ONLY",observedAt:new Date().toISOString(),
    endpoints:map,
    safety:{providerCredentials:false,workerBindings:0,providerWrites:0,orderRoutes:0,cancelRoutes:0,transferRoutes:0,baselineMutation:false}
  };
}
async function contract(env,ticker){
  const [baseline,market,book]=await Promise.all([
    getBaselineJson(env,"/kalshi-live-mirror-data"),
    getJson(KALSHI+"/markets/"+encodeURIComponent(ticker)),
    getJson(KALSHI+"/markets/"+encodeURIComponent(ticker)+"/orderbook?depth=10")
  ]);
  const mirrorRows=Array.isArray(baseline?.body?.rows)?baseline.body.rows:[];
  const mirror=mirrorRows.find(x=>String(x?.ticker||"")===ticker)||null;
  const providerMarket=market.body?.market||market.body||null;
  return {
    ok:Boolean(mirror||market.ok),readOnly:true,ticker,observedAt:new Date().toISOString(),
    inspectionSource:market.ok?"KALSHI_PUBLIC_EXACT_MARKET":mirror?"BASELINE_AUTHENTICATED_LIVE_MIRROR_FALLBACK":"UNAVAILABLE",
    baselineMirrorHttpStatus:baseline.status,mirror,
    marketHttpStatus:market.status,market:providerMarket,
    orderbookHttpStatus:book.status,orderbook:book.ok?(book.body?.orderbook_fp||book.body?.orderbook||book.body):null,
    providerDetailAvailable:market.ok,depthAvailable:book.ok,
    safety:{providerWrites:0,orders:0,cancels:0,transfers:0,baselineMutation:false}
  };
}
async function candles(product,granularity){
  if(!PRODUCTS.has(product))return{ok:false,error:"UNSUPPORTED_PRODUCT"};
  if(!GRANULARITY.has(String(granularity)))return{ok:false,error:"UNSUPPORTED_GRANULARITY"};
  const g=GRANULARITY.get(String(granularity));
  const url=COINBASE+"/products/"+encodeURIComponent(product)+"/candles?granularity="+g;
  const r=await getJson(url);
  const rows=Array.isArray(r.body)?r.body:[];
  const candles=rows.map(x=>Array.isArray(x)&&x.length>=6?{time:Number(x[0]),low:num(x[1]),high:num(x[2]),open:num(x[3]),close:num(x[4]),volume:num(x[5])}:null).filter(Boolean).sort((a,b)=>a.time-b.time);
  return {ok:r.ok,readOnly:true,source:"COINBASE_PUBLIC_CANDLES",product,granularity:g,httpStatus:r.status,count:candles.length,candles};
}
export default {
 async fetch(req,env){
   if(req.method==="OPTIONS")return new Response(null,{status:204,headers:JSON_HEADERS});
   const u=new URL(req.url);
   if(req.method!=="GET")return json({ok:false,error:"READ_ONLY_METHOD_NOT_ALLOWED"},405);
   if(u.pathname==="/api/health")return json({ok:true,service:"market-edge-founder-terminal-reader",mode:"READ_ONLY",baseline:BASELINE,safety:{credentials:false,orders:false,writes:false}});
   if(u.pathname==="/api/snapshot")return json(await snapshot(env));
   if(u.pathname==="/api/contract"){const ticker=cleanTicker(u.searchParams.get("ticker"));if(!ticker)return json({ok:false,error:"INVALID_TICKER"},400);return json(await contract(env,ticker));}
   if(u.pathname==="/api/candles"){const p=String(u.searchParams.get("product")||"").toUpperCase(),g=String(u.searchParams.get("granularity")||"300");const out=await candles(p,g);return json(out,out.ok?200:400);}
   return json({ok:true,service:"market-edge-founder-terminal-reader",routes:["/api/health","/api/snapshot","/api/contract?ticker=...","/api/candles?product=BTC-USD&granularity=300"],readOnly:true});
 }
};