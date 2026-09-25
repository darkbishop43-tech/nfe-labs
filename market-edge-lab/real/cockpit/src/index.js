const COINBASE='https://api.exchange.coinbase.com';
const ASSETS=new Set(['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR']);
const GRANULARITIES=new Set([60,300,900,3600,86400]);
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});

async function publicJson(url,timeout=8000){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  try{
    const r=await fetch(url,{method:'GET',headers:{accept:'application/json'},signal:ctl.signal});
    const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}
    return {ok:r.ok,status:r.status,body};
  }catch(error){
    return {ok:false,status:0,body:null,error:String(error?.name||'FETCH_FAILED')};
  }finally{clearTimeout(timer)}
}

async function baselineJson(env,path){
  try{
    const r=await env.BASELINE.fetch(new Request('https://baseline.internal'+path,{method:'GET',headers:{accept:'application/json'}}));
    const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}
    return {ok:r.ok,status:r.status,body};
  }catch(error){
    return {ok:false,status:0,body:null,error:String(error?.name||'FETCH_FAILED')};
  }
}

async function currentTickers(env){
  const [shadow,mirror]=await Promise.all([
    baselineJson(env,'/shadow-state'),
    baselineJson(env,'/kalshi-live-mirror-data')
  ]);
  const opportunities=shadow.body?.opportunities||[];
  const set=new Set(opportunities.map(x=>String(x?.marketTicker||'')));
  return {set,shadow,mirror,opportunities};
}

function safeTicker(v){
  const s=String(v||'').trim();
  return /^[A-Z0-9-]{8,80}$/.test(s)?s:null;
}

export default{
  async fetch(request,env){
    const u=new URL(request.url);

    if(request.method!=='GET'){
      return json({ok:false,mode:'READ_ONLY_COCKPIT',error:'METHOD_NOT_ALLOWED',executionAuthority:false},405);
    }

    if(u.pathname==='/api/health'){
      return json({
        ok:true,service:'market-edge-founder-cockpit',mode:'READ_ONLY_PRESENTATION',
        executionAuthority:false,orderRoutes:0,baselineMutation:false,credentials:false
      });
    }

    if(u.pathname==='/api/runtime'){
      const paths=['/shadow-state','/wide-radar-state','/real-trade-state','/execution-test-state','/kalshi-live-mirror-data','/account','/status'];
      const res=await Promise.all(paths.map(p=>baselineJson(env,p)));
      const coreOk=res[0].ok&&res[3].ok;
      return json({
        ok:coreOk,state:coreOk?'LIVE_READ_ONLY':'CORE_READ_FAILED',
        observedAt:new Date().toISOString(),executionAuthority:false,baselineMutation:false,
        sources:Object.fromEntries(paths.map((p,i)=>[p,{ok:res[i].ok,httpStatus:res[i].status}])),
        shadow:res[0].ok?res[0].body:null,
        wideRadar:res[1].ok?res[1].body:null,
        realTradeState:res[2].ok?res[2].body:null,
        executionTestState:res[3].ok?res[3].body:null,
        mirror:res[4].ok?res[4].body:null,
        account:res[5].ok?res[5].body:null,
        status:res[6].ok?res[6].body:null
      },coreOk?200:502);
    }

    if(u.pathname==='/api/ticker'){
      const asset=String(u.searchParams.get('asset')||'').toUpperCase();
      if(!ASSETS.has(asset))return json({ok:false,error:'UNSUPPORTED_ASSET',asset},400);
      const r=await publicJson(COINBASE+'/products/'+encodeURIComponent(asset+'-USD')+'/ticker');
      if(!r.ok)return json({ok:false,error:'SPOT_READ_FAILED',asset,httpStatus:r.status},502);
      const p=Number(r.body?.price);
      return json({
        ok:Number.isFinite(p)&&p>0,source:'COINBASE_PUBLIC_READ',
        asset,product:asset+'-USD',price:Number.isFinite(p)?p:null,observedAt:new Date().toISOString()
      });
    }

    if(u.pathname==='/api/candles'){
      const asset=String(u.searchParams.get('asset')||'').toUpperCase();
      const g=Number(u.searchParams.get('granularity'));
      if(!ASSETS.has(asset))return json({ok:false,error:'UNSUPPORTED_ASSET'},400);
      if(!GRANULARITIES.has(g))return json({ok:false,error:'UNVERIFIED_GRANULARITY',allowed:[...GRANULARITIES]},400);
      const r=await publicJson(COINBASE+'/products/'+encodeURIComponent(asset+'-USD')+'/candles?granularity='+g,9000);
      if(!r.ok||!Array.isArray(r.body))return json({ok:false,error:'CANDLE_READ_FAILED',httpStatus:r.status},502);
      return json({
        ok:true,source:'COINBASE_PUBLIC_CANDLES',asset,product:asset+'-USD',
        granularity:g,candles:r.body,observedAt:new Date().toISOString()
      });
    }

    if(u.pathname==='/api/market'||u.pathname==='/api/orderbook'){
      const ticker=safeTicker(u.searchParams.get('ticker'));
      if(!ticker)return json({ok:false,error:'INVALID_TICKER'},400);

      const cur=await currentTickers(env);
      if(!cur.shadow.ok)return json({ok:false,error:'BASELINE_TICKER_ALLOWLIST_UNAVAILABLE'},502);
      if(!cur.set.has(ticker))return json({ok:false,error:'TICKER_NOT_IN_CURRENT_BASELINE_OPPORTUNITY_SET'},403);

      const suffix=u.pathname==='/api/market'?'':'/orderbook?depth=10';
      const r=await publicJson('https://api.elections.kalshi.com/trade-api/v2/markets/'+encodeURIComponent(ticker)+suffix,8000);

      if(u.pathname==='/api/market'){
        if(r.ok){
          const m=r.body?.market||r.body||{};
          return json({
            ok:true,available:true,readOnly:true,source:'KALSHI_PUBLIC_MARKET_READ',
            market:{
              ticker:m.ticker||ticker,title:m.title||null,subtitle:m.subtitle||null,status:m.status||null,
              open_time:m.open_time||null,close_time:m.close_time||null,can_close_early:m.can_close_early??null,
              yes_bid_dollars:m.yes_bid_dollars??m.yes_bid??null,yes_ask_dollars:m.yes_ask_dollars??m.yes_ask??null,
              no_bid_dollars:m.no_bid_dollars??m.no_bid??null,no_ask_dollars:m.no_ask_dollars??m.no_ask??null,
              volume:m.volume_fp??m.volume??null,liquidity:m.liquidity_dollars??m.liquidity??null,
              rules_primary:m.rules_primary||null,rules_secondary:m.rules_secondary||null,
              exchange_index:m.exchange_index??null
            }
          });
        }
        const o=cur.opportunities.find(x=>x.marketTicker===ticker)||null;
        const mr=(cur.mirror.body?.rows||[]).find(x=>x.ticker===ticker)||null;
        return json({
          ok:true,available:Boolean(o),readOnly:true,source:'BASELINE_GOVERNED_READ_FALLBACK',
          providerDetailStatus:r.status||null,
          market:o?{
            ticker, title:o.question||null,subtitle:o.subtitle||null,status:mr?.status||null,
            open_time:o.openTime||null,close_time:o.closeTime||null,can_close_early:null,
            yes_bid_dollars:mr?.yesBid??null,yes_ask_dollars:mr?.yesAsk??null,
            no_bid_dollars:mr?.noBid??null,no_ask_dollars:mr?.noAsk??null,
            volume:null,liquidity:mr?.liquidityDollars??null,
            rules_primary:null,rules_secondary:null,exchange_index:o.exchangeIndex??null
          }:null
        });
      }

      if(!r.ok){
        return json({
          ok:true,available:false,readOnly:true,source:'KALSHI_PUBLIC_ORDERBOOK_READ',
          ticker,providerHttpStatus:r.status||null,reason:r.status===429?'PROVIDER_RATE_LIMITED':'ORDERBOOK_UNAVAILABLE',
          orderbook:null,orderbook_fp:null
        });
      }
      return json({
        ok:true,available:true,readOnly:true,source:'KALSHI_PUBLIC_ORDERBOOK_READ',ticker,
        orderbook:r.body?.orderbook||null,orderbook_fp:r.body?.orderbook_fp||null
      });
    }

    return env.ASSETS.fetch(request);
  }
};