// Research-only bridge for existing PAYNE GET /display-market-feed.
// No trading imports, auth secrets, production state access, or writes.
// Feed is an optional partial observation; never synthesize depth, rules or probability.
import { observe, report } from './probability-shadow.mjs';
const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const price=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1?x:null;
export function fromVerifiedDisplayFeed(body){
  if(body?.schema!=='PAYNE_DISPLAY_MARKET_FEED_V1'||body?.source!=='PAYNE_AUTHENTICATED_KALSHI_GET_ONLY'||body?.providerWrites!==0||!Array.isArray(body.quotes))
    throw Error('UNVERIFIED_DISPLAY_FEED_SCHEMA');
  const output=[];
  for(const quote of body.quotes){
    const ticker=typeof quote?.ticker==='string'?quote.ticker:null;
    if(!ticker)continue;
    const observedAt=stamp(quote.observedAt),providerAt=stamp(quote.providerUpdatedAt);
    const fresh=quote.status==='LIVE'&&observedAt!==null;
    for(const side of ['YES','NO']){
      const rec={ticker,side,observedAt,settlementAt:stamp(quote.closeTime),settlementTarget:null,
        underlyingPrice:null,underlyingObservedAt:null,quoteObservedAt:providerAt,
        annualizedVolatility:null,entryAsk:fresh?price(side==='YES'?quote.yesAsk:quote.noAsk):null,
        entryDepthContracts:null,entryFeesPerContract:null,settlementOutcome:null,
        rulesVerified:false,settlementReferenceVerified:false,settlementOperator:null};
      output.push({ticker,side,status:fresh?'PARTIAL_VERIFIED_PROVIDER_QUOTE':'UNKNOWN',
        observedAt,providerUpdatedAt:providerAt,
        bid:fresh?price(side==='YES'?quote.yesBid:quote.noBid):null,
        ask:rec.entryAsk,depth:null,rules:null,underlying:null,volatility:null,
        probability:observe(rec),record:rec});
    }
  }
  return {schema:'PAYNE_PROBABILITY_RESEARCH_FEED_V1',source:'EXISTING_GET_DISPLAY_MARKET_FEED',
    providerWrites:0,records:output,coverage:report(output.map(x=>x.record))};
}
export async function fetchExistingReadOnlyFeed({getJson}={}){
 if(typeof getJson!=='function')throw Error('READ_ONLY_GET_CALLBACK_REQUIRED');
 return fromVerifiedDisplayFeed(await getJson('/display-market-feed'));
}
