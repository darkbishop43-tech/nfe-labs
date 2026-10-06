const FEATURE_STATE_KEY='payne-kalshi:feature-shadow:v1';
const FEATURE_MAX_AGE_MS=120000;
const FEATURE_EPOCH_MS=60000;

const ASSET_PRICE_META=Object.freeze({
  BTC:{coinbase:'BTC-USD',coingecko:'bitcoin'},
  ETH:{coinbase:'ETH-USD',coingecko:'ethereum'},
  SOL:{coinbase:'SOL-USD',coingecko:'solana'},
  XRP:{coinbase:'XRP-USD',coingecko:'ripple'},
  HYPE:{coinbase:'HYPE-USD',coingecko:'hyperliquid'},
  ZEC:{coinbase:'ZEC-USD'},
  DOGE:{coinbase:'DOGE-USD'},
  BNB:{coinbase:'BNB-USD'},
  NEAR:{coinbase:'NEAR-USD'},
});

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

export function payneMoveParity(current,previous){
  const c=Number(current),p=Number(previous);
  return Number.isFinite(c)&&c>0&&Number.isFinite(p)&&p>0 ? (c-p)/p : 0;
}

export function payneFeatureParity({ask,move,outcomeSide}){
  const marketAsk=Number(ask), rawMove=Number(move);
  if(!Number.isFinite(marketAsk)||!(marketAsk>0&&marketAsk<1)||!Number.isFinite(rawMove)) return null;
  const bear=String(outcomeSide||'').toUpperCase()==='NO';
  const directionalMove=bear?-rawMove:rawMove;
  const fair=clamp(marketAsk+directionalMove*18,0.02,0.98);
  const edge=fair-marketAsk;
  const score=clamp(0.5+edge*4,0,1);
  return {move:rawMove,fair,edge,score};
}

function kv(env){return env?.PAYNE_KALSHI_STATE||null;}
async function loadPrior(env){
  try{
    const store=kv(env); if(!store||typeof store.get!=='function') return null;
    const raw=await store.get(FEATURE_STATE_KEY);
    return raw?JSON.parse(raw):null;
  }catch{return null;}
}
async function saveCurrent(env,state){
  try{
    const store=kv(env); if(!store||typeof store.put!=='function') return false;
    await store.put(FEATURE_STATE_KEY,JSON.stringify(state));
    return true;
  }catch{return false;}
}

async function coinbaseSpot(product,fetchImpl){
  const r=await fetchImpl('https://api.exchange.coinbase.com/products/'+encodeURIComponent(product)+'/ticker',{
    headers:{'User-Agent':'NFE-OS-PAYNE-KALSHI-REAL/1.0',accept:'application/json'}
  });
  if(!r.ok) throw new Error('COINBASE_READ_FAILED_'+r.status);
  const body=await r.json();
  const price=Number(body?.price);
  if(!Number.isFinite(price)||price<=0) throw new Error('COINBASE_PRICE_INVALID');
  return price;
}

async function assetSpot(asset,fetchImpl){
  const meta=ASSET_PRICE_META[asset];
  if(!meta) throw new Error('UNSUPPORTED_ASSET');
  try{
    return {price:await coinbaseSpot(meta.coinbase,fetchImpl),source:'COINBASE'};
  }catch(error){
    if(!meta.coingecko) throw new Error('COINBASE_SPOT_UNAVAILABLE_NO_FALLBACK');
    const r=await fetchImpl('https://api.coingecko.com/api/v3/simple/price?ids='+encodeURIComponent(meta.coingecko)+'&vs_currencies=usd',{headers:{accept:'application/json'}});
    if(!r.ok) throw new Error('PUBLIC_SPOT_READ_FAILED_'+r.status);
    const body=await r.json();
    const price=Number(body?.[meta.coingecko]?.usd);
    if(!Number.isFinite(price)||price<=0) throw new Error('PUBLIC_SPOT_PRICE_INVALID');
    return {price,source:'COINGECKO_FALLBACK'};
  }
}

export function payneFeatureIdentity(row,market,outcomeSide){
  const side=String(outcomeSide||'').toUpperCase();
  const tickerMatch=String(row?.marketTicker||'')===String(market?.ticker||'');
  const sideMatch=String(row?.outcomeSide||'').toUpperCase()===side;
  const openMatch=Boolean(row?.openTime&&market?.openTime&&String(row.openTime)===String(market.openTime));
  const closeMatch=Boolean(row?.closeTime&&market?.closeTime&&String(row.closeTime)===String(market.closeTime));
  return {
    tickerMatch,
    sideMatch,
    windowMatch:openMatch&&closeMatch,
    openMatch,
    closeMatch,
    pass:tickerMatch&&sideMatch&&openMatch&&closeMatch,
  };
}

export async function buildPayneOwnedFeatureState(env,markets,nowMs=Date.now(),{fetchImpl=fetch,forceRefresh=false}={}){
  const currentMarkets=Array.isArray(markets)?markets.filter(Boolean):[];
  const prior=await loadPrior(env);
  const epochMs=Math.floor(Number(nowMs)/FEATURE_EPOCH_MS)*FEATURE_EPOCH_MS;
  const sameEpoch=Number(prior?.epochMs)===epochMs;
  const priorRows=Array.isArray(prior?.opportunities)?prior.opportunities:[];
  const currentIds=new Set(currentMarkets.map(m=>[String(m?.ticker||''),String(m?.openTime||''),String(m?.closeTime||'')].join('|')));
  const cachedIds=new Set(priorRows.map(r=>[String(r?.marketTicker||''),String(r?.openTime||''),String(r?.closeTime||'')].join('|')));
  const exactWindowSet=currentIds.size>0 && currentIds.size===cachedIds.size && [...currentIds].every(x=>cachedIds.has(x));
  if(!forceRefresh && sameEpoch && exactWindowSet && prior?.featureState){
    const cached=prior.featureState;
    const ageMs=Math.max(0,Number(nowMs)-Date.parse(cached?.calculationAt||cached?.lastRunAt||''));
    return {...cached,ageMs,fresh:ageMs<=FEATURE_MAX_AGE_MS && Array.isArray(cached?.opportunities) && cached.opportunities.length>0};
  }
  const assets=[...new Set(currentMarkets.map(m=>m?.asset).filter(a=>ASSET_PRICE_META[a]))];
  const referencePrices=sameEpoch
    ? (prior?.referencePrices||prior?.prices||{})
    : (prior?.prices||prior?.referencePrices||{});

  const spotRows=await Promise.all(assets.map(async asset=>{
    try{return {asset,ok:true,...await assetSpot(asset,fetchImpl)};}
    catch(error){return {asset,ok:false,error:String(error?.message||error||'SPOT_READ_FAILED').slice(0,120)};}
  }));

  const prices={},priceSources={},spotReadFailures=[];
  for(const row of spotRows){
    if(row.ok){prices[row.asset]=row.price;priceSources[row.asset]=row.source;}
    else spotReadFailures.push({asset:row.asset,reason:row.error});
  }

  const opportunities=[];
  for(const market of currentMarkets){
    const asset=market?.asset;
    const currentPrice=Number(prices[asset]);
    if(!Number.isFinite(currentPrice)||currentPrice<=0) continue;
    const previousPrice=Number(referencePrices?.[asset]);
    const move=payneMoveParity(currentPrice,previousPrice);
    for(const side of ['YES','NO']){
      const ask=side==='YES'?Number(market?.yesAsk):Number(market?.noAsk);
      const bid=side==='YES'?Number(market?.yesBid):Number(market?.noBid);
      const feature=payneFeatureParity({ask,move,outcomeSide:side});
      if(!feature) continue;
      opportunities.push({
        marketTicker:String(market?.ticker||''),
        asset,
        outcomeSide:side,
        direction:side==='YES'?'UP':'DOWN',
        openTime:market?.openTime||null,
        closeTime:market?.closeTime||null,
        durationMs:market?.durationMs??null,
        horizon:'15M',
        exchangeIndex:market?.exchangeIndex??null,
        executionEligible:market?.executionEligible===true,
        providerTimestamp:market?.providerReadAt||null,
        calculationAt:new Date(nowMs).toISOString(),
        observedAsk:ask,
        observedBid:Number.isFinite(bid)?bid:null,
        underlyingSpot:currentPrice,
        previousUnderlyingSpot:Number.isFinite(previousPrice)&&previousPrice>0?previousPrice:null,
        underlyingPriceSource:priceSources[asset]||null,
        ...feature,
      });
    }
  }

  const calculatedAt=new Date(nowMs).toISOString();
  const ageMs=Math.max(0,Date.now()-nowMs);
  const state={
    schema:'PAYNE_OWNED_KALSHI_FEATURE_STATE_V1',
    source:'KALSHI_AUTHORITATIVE',
    transport:'PAYNE_KALSHI_READ',
    spotTransport:'PAYNE_DIRECT_SPOT_READ',
    binding:'PAYNE_KALSHI_STATE',
    endpoint:'KALSHI_CURRENT_CONTRACTS_PLUS_DIRECT_UNDERLYING_SPOT',
    httpStatus:200,
    lastRunAt:calculatedAt,
    calculationAt:calculatedAt,
    ageMs,
    fresh:ageMs<=FEATURE_MAX_AGE_MS && opportunities.length>0,
    status:spotReadFailures.length?'PAYNE_KALSHI_FEATURES_PARTIAL':'PAYNE_KALSHI_FEATURES_CURRENT',
    prices,
    priceSources,
    spotReadFailures,
    opportunities,
    error:opportunities.length?null:'PAYNE_FRESH_FEATURE_INPUTS_UNAVAILABLE',
    baselineStateRead:false,
    providerWrites:0,
    orders:0,
    capitalMovedUsd:0,
  };

  await saveCurrent(env,{
    schema:state.schema,
    savedAt:calculatedAt,
    epochMs,
    prices,
    referencePrices,
    priceSources,
    markets:currentMarkets.map(m=>({ticker:m?.ticker||null,asset:m?.asset||null,openTime:m?.openTime||null,closeTime:m?.closeTime||null,providerReadAt:m?.providerReadAt||null})),
    opportunities,
    featureState:state,
  });
  return state;
}
