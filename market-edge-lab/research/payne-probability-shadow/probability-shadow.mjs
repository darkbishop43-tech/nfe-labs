// Isolated probability observatory: pure calculations; no live trading imports or writes.
const n=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const timestamp=x=>Number.isFinite(Date.parse(x))?Date.parse(x):null;
const cdf=z=>{let t=1/(1+0.2316419*Math.abs(z));let p=t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));let q=0.3989422804014327*Math.exp(-z*z/2)*p;return Math.max(0,Math.min(1,z>=0?1-q:q));};
export const REQUIRED=Object.freeze(['ticker','side','observedAt','settlementAt','settlementTarget','underlyingPrice','underlyingObservedAt','quoteObservedAt','annualizedVolatility','entryAsk','entryDepthContracts','entryFeesPerContract','settlementOutcome','rulesVerified','settlementReferenceVerified','settlementOperator']);
export function observe(record, {maxAgeMs=60000,driftAnnual=0}={}){
 const r=record&&typeof record==='object'?record:{},missing=[];
 for(const k of REQUIRED)if(r[k]===null||r[k]===undefined||r[k]==='')missing.push(k);
 const o=timestamp(r.observedAt),e=timestamp(r.settlementAt),p=timestamp(r.underlyingObservedAt),q=timestamp(r.quoteObservedAt);
 if(o===null||e===null||e<=o)missing.push('validSettlementTime');
 if(p===null||o===null||p>o||o-p>maxAgeMs)missing.push('freshUnderlying');
 if(q===null||o===null||q>o||o-q>maxAgeMs)missing.push('freshQuote');
 if(r.rulesVerified!==true||r.settlementReferenceVerified!==true||r.settlementOperator!=='STRICT_ABOVE')missing.push('settlementRuleVerified');
 const side=String(r.side||'').toUpperCase(),outcome=String(r.settlementOutcome||'').toUpperCase();
 if(!['YES','NO'].includes(side))missing.push('validSide');
 if(!['YES','NO'].includes(outcome))missing.push('validOutcome');
 const target=n(r.settlementTarget),price=n(r.underlyingPrice),vol=n(r.annualizedVolatility),ask=n(r.entryAsk),depth=n(r.entryDepthContracts),fees=n(r.entryFeesPerContract);
 if(!(target>0&&price>0&&vol>0))missing.push('validModelParameters');
 if(!(ask>0&&ask<1&&depth>=1&&fees>=0))missing.push('validEntryEconomics');
 if(!Number.isFinite(driftAnnual))missing.push('validDrift');
 const result={ticker:r.ticker||null,side,observedAt:r.observedAt||null,status:'UNKNOWN',missing:[...new Set(missing)],pWin:null,breakEvenP:null,expectedNetValue:null,brier:null};
 if(result.missing.length)return result;
 const T=(e-o)/(365.25*86400000);
 const z=(Math.log(price/target)+(driftAnnual-vol*vol/2)*T)/(vol*Math.sqrt(T));
 const pYes=cdf(z),pWin=side==='YES'?pYes:1-pYes,actual=side===outcome?1:0;
 return {...result,status:'VERIFIED_INPUTS',pWin,breakEvenP:ask+fees,expectedNetValue:pWin-ask-fees,brier:(pWin-actual)**2,actualOutcome:actual,fillableOneContract:true};
}
export function report(records,opts={}){
 if(!Array.isArray(records))throw Error('OBSERVATION_ARRAY_REQUIRED');
 const observations=records.map(r=>observe(r,opts)),complete=observations.filter(r=>r.status==='VERIFIED_INPUTS');
 const missingByField={};for(const row of observations)for(const k of row.missing)missingByField[k]=(missingByField[k]||0)+1;
 return {totalObservations:observations.length,distinctContracts:new Set(observations.map(x=>x.ticker).filter(Boolean)).size,complete:complete.length,incomplete:observations.length-complete.length,missingByField,meanBrier:complete.length?complete.reduce((s,x)=>s+x.brier,0)/complete.length:null,aggregateHypotheticalHeldToSettlementEV:complete.length?complete.reduce((s,x)=>s+x.expectedNetValue,0):null,observations};
}
// Research results are held-to-settlement only. PAYNE 5-minute exit EV requires separate future executable bids.
// Preview runner is offline only; supply captured point-in-time observation JSON array.
