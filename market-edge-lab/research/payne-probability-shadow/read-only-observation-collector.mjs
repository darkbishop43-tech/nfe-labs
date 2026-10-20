// Isolated research only. No production imports, credentials, fetch globals, or write methods.
// The caller supplies the EXISTING approved authenticated Kalshi GET transport; it must be
// read-only and must not have provider POST, state mutation, or trading authority.
import {observe,report} from './probability-shadow.mjs';
const validTicker=t=>/^[A-Z0-9_-]{4,160}$/.test(String(t||''));
const number=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const unknown=(ticker,side,reason,record={})=>({ticker,side,status:'UNKNOWN',reason,record,probability:observe(record)});
function dollar(x){const n=number(x);return n!==null&&n>=0&&n<=1?n:null;}
function bookLevels(body,side){
  const raw=body?.orderbook_fp||body?.orderbook;
  const yes=raw?.yes_dollars||raw?.yes||[],no=raw?.no_dollars||raw?.no||[];
  const levels=(side==='YES'?no:yes).map(pair=>Array.isArray(pair)?{price:dollar(pair[0]),quantity:number(pair[1])}:null).filter(x=>x&&x.price!==null&&x.quantity>0);
  // Kalshi books show resting bids, so the opposite-side bid implies this side's ask.
  return levels.map(x=>({ask:1-x.price,quantity:x.quantity})).sort((a,b)=>a.ask-b.ask);
}
export async function collectReadOnly({get,seriesTickers,underlyingAt,volatilityAt,now=()=>new Date().toISOString()}={}){
 if(typeof get!=='function'||!Array.isArray(seriesTickers))throw Error('APPROVED_GET_AND_SERIES_REQUIRED');
 const output=[];
 for(const seriesTicker of seriesTickers){
  if(!validTicker(seriesTicker))throw Error('INVALID_SERIES_TICKER');
  let page;
  try{page=await get('/trade-api/v2/markets?series_ticker='+encodeURIComponent(seriesTicker)+'&status=open&limit=100');}
  catch(e){output.push(unknown(null,null,'AUTHENTICATED_MARKET_GET_UNAVAILABLE',{seriesTicker}));continue;}
  const markets=Array.isArray(page?.markets)?page.markets:[];
  for(const m of markets){
   const ticker=String(m?.ticker||''),at=iso(now());
   if(!validTicker(ticker)){output.push(unknown(ticker,null,'INVALID_CONTRACT_TICKER'));continue;}
   let details=null,book=null;
   try{details=await get('/trade-api/v2/markets/'+encodeURIComponent(ticker));book=await get('/trade-api/v2/markets/'+encodeURIComponent(ticker)+'/orderbook');}
   catch{output.push(unknown(ticker,null,'AUTHENTICATED_CONTRACT_OR_BOOK_GET_UNAVAILABLE'));continue;}
   const d=details?.market||details||{},terms={primary:d.rules_primary??null,secondary:d.rules_secondary??null,settlementSource:d.settlement_source??null};
   const bookAt=iso(book?.provider_timestamp||book?.timestamp)||null;
   for(const side of ['YES','NO']){
    const levels=bookLevels(book,side),best=levels[0],price=best?.ask??null;
    const marketAsk=dollar(side==='YES'?d.yes_ask_dollars:d.no_ask_dollars);
    let underlying=null,volatility=null;
    try{if(typeof underlyingAt==='function')underlying=await underlyingAt({ticker,seriesTicker,observedAt:at,terms});}catch{}
    try{if(typeof volatilityAt==='function')volatility=await volatilityAt({ticker,seriesTicker,observedAt:at,terms});}catch{}
    // Contract-specific official target and strict-above operator must be
    // externally verified; never derive from market ticker, title or subtitle.
    const rec={ticker,side,observedAt:at,settlementAt:iso(d.expiration_time||d.close_time),settlementTarget:null,underlyingPrice:number(underlying?.price),underlyingObservedAt:iso(underlying?.observedAt),quoteObservedAt:bookAt,annualizedVolatility:number(volatility?.annualized),entryAsk:price,entryDepthContracts:best?.quantity??null,entryFeesPerContract:null,settlementOutcome:null,rulesVerified:false,settlementReferenceVerified:false,settlementOperator:null};
    output.push({ticker,seriesTicker,side,status:'OBSERVED_UNVERIFIED',terms,bid:dollar(side==='YES'?d.yes_bid_dollars:d.no_bid_dollars),ask:marketAsk,bookTopAsk:price,topDepth:best?.quantity??null,volume:number(d.volume_fp??d.volume),observationTime:at,providerBookTime:bookAt,contractWindow:{close:d.close_time??null,expiration:d.expiration_time??null},record:rec,probability:observe(rec)});
   }
  }
 }
 return {readOnly:true,providerWrites:0,records:output,coverage:report(output.map(x=>x.record||{}))};
}
