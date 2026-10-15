// Research-only ranking. Neither scores nor ranks may authorize PAYNE trades.
export function rankVerifiedStaircase(markets,history,nowMs){
 const list=[];
 for(const m of markets||[]){
  if(!m||!m.ticker||!['open','active'].includes(String(m.status||'').toLowerCase())||!(Date.parse(m.closeTime)>nowMs))continue;
  const options=[];
  for(const side of ['YES','NO']){
   const bid=side==='YES'?m.yesBid:m.noBid;
   if(typeof bid!=='number'||!Number.isFinite(bid)||bid<=0||bid>=1)continue;
   const samples=(history||[]).filter(x=>x?.ticker===m.ticker&&x?.side===side&&x?.source==='DIRECT_KALSHI_GET'&&
      typeof x.bid==='number'&&Number.isFinite(x.bid)&&x.bid>0&&x.bid<1&&Number.isFinite(Date.parse(x.at))&&
      Date.parse(x.at)<=nowMs&&Date.parse(x.at)<Date.parse(m.closeTime))
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
   const distinct=samples.filter((x,i)=>i===0||x.at!==samples[i-1].at);
   const first=distinct[0],last=distinct[distinct.length-1];
   const delta=distinct.length>=2?(last.bid-first.bid)*100:null;
   options.push({side,bid,delta,samples:distinct,high:distinct.length?Math.max(...distinct.map(x=>x.bid))*100:null});
  }
  if(!options.length)continue;
  options.sort((a,b)=>(b.delta??-Infinity)-(a.delta??-Infinity)||a.side.localeCompare(b.side));
  const best=options[0];
  list.push({asset:m.asset,ticker:m.ticker,side:best.side,currentBidCents:best.bid*100,
    deltaCents:best.delta,highCents:best.high,observationCount:best.samples.length,
    samples:best.samples.map(x=>({at:x.at,cents:x.bid*100})),
    lastVerifiedReadAt:m.providerReadAt||null,
    status:best.delta===null?'INSUFFICIENT_OBSERVATIONS':'VERIFIED_MOVE'});
 }
 list.sort((a,b)=>(b.deltaCents??-Infinity)-(a.deltaCents??-Infinity)||a.ticker.localeCompare(b.ticker));
 return list.slice(0,3);
}
