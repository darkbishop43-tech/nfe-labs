import {
  PAYNE_PAPER_RULES,
  PAYNE_PAPER_SOURCE,
  paperFeatureMath,
  paperMove,
} from './payne-paper-brain.js';

const FEATURE_STATE_KEY='payne-kalshi:feature-shadow:v2-paper-brain';
const FEATURE_MAX_AGE_MS=PAYNE_PAPER_RULES.sourceCadenceMs;
const FEATURE_EPOCH_MS=PAYNE_PAPER_RULES.sourceCadenceMs;

// Paper source produced BTC/ETH opportunities only. Keep the direct read metadata
// explicit so the promoted brain is not silently expanded to unproven assets.
const ASSET_PRICE_META=Object.freeze({
  BTC:{coinbase:'BTC-USD',coingecko:'bitcoin'},
  ETH:{coinbase:'ETH-USD',coingecko:'ethereum'},
});

export function payneMoveParity(current,previous){
  return paperMove(current,previous);
}

export function payneFeatureParity({ask,move,outcomeSide}){
  return paperFeatureMath({
    marketPrice:ask,
    move,
    outcomeSide,
    direction:String(outcomeSide||'').toUpperCase()==='NO'?'BELOW':'ABOVE',
  });
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
  // Contract assets come from the existing Kalshi series discovery.
  // Coinbase must actually return a valid USD spot; unsupported pairs fail closed.
  const symbol=String(asset||'').toUpperCase();
  if(!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('INVALID_MARKET_ASSET_SYMBOL');
  const meta=ASSET_PRICE_META[symbol]||{coinbase:symbol+'-USD',coingecko:null};
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

function sourceProvenMarkets(markets){
  // Eligibility is based on genuine discovered Kalshi contracts, not the
  // narrower historical BTC/ETH Paper source inventory.
  return (Array.isArray(markets)?markets:[]).filter(m=>
    /^[A-Z0-9]{2,10}$/.test(String(m?.asset||'')) &&
    Boolean(m?.ticker && m?.openTime && m?.closeTime)
  );
}

export async function buildPayneOwnedFeatureState(env,markets,nowMs=Date.now(),{fetchImpl=fetch,forceRefresh=false}={}){
  const currentMarkets=sourceProvenMarkets(markets).filter(Boolean);
  const prior=await loadPrior(env);
  const epochMs=Math.floor(Number(nowMs)/FEATURE_EPOCH_MS)*FEATURE_EPOCH_MS;
  const sameEpoch=Number(prior?.epochMs)===epochMs;
  const priorRows=Array.isArray(prior?.opportunities)?prior.opportunities:[];
  const currentIds=new Set(currentMarkets.map(m=>[String(m?.ticker||''),String(m?.openTime||''),String(m?.closeTime||'')].join('|')));
  const cachedIds=new Set(priorRows.map(r=>[String(r?.marketTicker||''),String(r?.openTime||''),String(r?.closeTime||'')].join('|')));
  const exactWindowSet=currentIds.size>0 && currentIds.size===cachedIds.size && [...currentIds].every(x=>cachedIds.has(x));

  // Paper's authoritative collector ran every five minutes. Fresh-lock and
  // pre-submit provider reads remain real-time, but the Paper brain itself does
  // not invent sub-cadence feature epochs.
  if(sameEpoch && exactWindowSet && prior?.featureState){
    const cached=prior.featureState;
    const ageMs=Math.max(0,Number(nowMs)-Date.parse(cached?.calculationAt||cached?.lastRunAt||''));
    return {
      ...cached,
      ageMs,
      fresh:ageMs<=FEATURE_MAX_AGE_MS && Array.isArray(cached?.opportunities) && cached.opportunities.length>0,
      forceRefreshRequested:forceRefresh===true,
      forceRefreshApplied:false,
      forceRefreshReason:'PAPER_BRAIN_FIVE_MINUTE_EPOCH_PRESERVED',
    };
  }

  const assets=[...new Set(currentMarkets.map(m=>m?.asset).filter(Boolean))];
  const referencePrices=prior?.prices||{};

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
    const referencePrice=Number(referencePrices?.[asset]);
    const move=paperMove(currentPrice,referencePrice);
    for(const side of ['YES','NO']){
      const ask=side==='YES'?Number(market?.yesAsk):Number(market?.noAsk);
      const bid=side==='YES'?Number(market?.yesBid):Number(market?.noBid);
      const feature=paperFeatureMath({
        marketPrice:ask,
        move,
        outcomeSide:side,
        direction:side==='YES'?'ABOVE':'BELOW',
      });
      if(!feature) continue;
      opportunities.push({
        marketTicker:String(market?.ticker||''),
        asset,
        outcomeSide:side,
        direction:side==='YES'?'UP':'DOWN',
        paperDirection:side==='YES'?'ABOVE':'BELOW',
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
        previousUnderlyingSpot:Number.isFinite(referencePrice)&&referencePrice>0?referencePrice:null,
        underlyingPriceSource:priceSources[asset]||null,
        ...feature,
      });
    }
  }

  const calculatedAt=new Date(nowMs).toISOString();
  const ageMs=0;
  const state={
    ok:opportunities.length>0,
    schema:'PAYNE_PAPER_BRAIN_KALSHI_FEATURE_STATE_V1',
    source:'PAYNE_PAPER_BRAIN_ON_KALSHI_REALITY',
    strategyAuthority:'PAYNE_PAPER',
    sourceProof:PAYNE_PAPER_SOURCE,
    sourceCadenceMs:PAYNE_PAPER_RULES.sourceCadenceMs,
    sourceAssets:[...PAYNE_PAPER_RULES.sourceAssets],
    transport:'PAYNE_KALSHI_READ',
    spotTransport:'PAYNE_DIRECT_SPOT_READ',
    binding:'PAYNE_KALSHI_STATE',
    endpoint:'KALSHI_CURRENT_CONTRACTS_PLUS_DIRECT_UNDERLYING_SPOT',
    httpStatus:200,
    lastRunAt:calculatedAt,
    calculationAt:calculatedAt,
    ageMs,
    fresh:ageMs<=FEATURE_MAX_AGE_MS && opportunities.length>0,
    status:spotReadFailures.length?'PAYNE_PAPER_BRAIN_FEATURES_PARTIAL':'PAYNE_PAPER_BRAIN_FEATURES_CURRENT',
    epochMs,
    prices,
    referencePrices,
    priceSources,
    spotReadFailures,
    opportunities,
    error:opportunities.length?null:'PAYNE_PAPER_BRAIN_FEATURE_INPUTS_UNAVAILABLE',
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
