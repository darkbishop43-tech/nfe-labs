import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ASSETS=["BTC","ETH","SOL","XRP","HYPE","ZEC","DOGE","BNB","NEAR"];
const HISTORY_DIR=new URL("../advisor-history/out/",import.meta.url);
const OUTPUT_DIR=new URL("./out/",import.meta.url);
const MINUTE=60_000;
const CYCLE=15*MINUTE;

const AUTHORITY=Object.freeze({
  advisorCanObserve:true,advisorCanRecommend:true,advisorCanRankAttention:true,
  advisorCanReadHistory:true,advisorCanPersistBriefing:true,
  advisorCanModifyScore:false,advisorCanModifyExecution:false,
  advisorCanSubmitOrders:false,advisorCanCancelOrders:false,
  advisorCanChangeCapital:false,advisorCanArm:false,advisorCanDisarm:false,
  advisorCanWriteSeriesState:false
});
const SAFETY=Object.freeze({providerTradingWrites:0,capitalMovedUsd:0,ordersSubmittedByAdvisor:0,executionStateTouched:false,armDisarmTouched:false});

const f=n=>Number.isFinite(Number(n))?Number(n):null;
const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?((a-b)/b)*100:null;
const round=(x,d=6)=>Number.isFinite(x)?Number(x.toFixed(d)):null;
const iso=ms=>new Date(ms).toISOString();

function contiguousTail(bars,count){
  if(!Array.isArray(bars)||bars.length<count)return null;
  const s=bars.slice(-count);
  for(let i=1;i<s.length;i++){
    if(Date.parse(s[i].timestamp)-Date.parse(s[i-1].timestamp)!==MINUTE)return null;
  }
  return s;
}
function closes(bars){return bars.map(b=>f(b.close)).filter(Number.isFinite)}
function sma(values,n){if(values.length<n)return null;return values.slice(-n).reduce((a,b)=>a+b,0)/n}
function emaSeries(values,period){
  if(values.length<period)return [];
  const k=2/(period+1);let e=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const out=new Array(period-1).fill(null);out.push(e);
  for(let i=period;i<values.length;i++){e=values[i]*k+e*(1-k);out.push(e)}
  return out;
}
function rsiSeries(values,period=14){
  if(values.length<period+2)return [];
  const out=new Array(values.length).fill(null);let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}
  gain/=period;loss/=period;
  const calc=()=>loss===0?100:100-(100/(1+gain/loss));
  out[period]=calc();
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;out[i]=calc();
  }
  return out;
}
function atrSeries(bars,period=14){
  if(bars.length<period+1)return [];
  const tr=[];
  for(let i=0;i<bars.length;i++){
    const h=f(bars[i].high),l=f(bars[i].low),pc=i?f(bars[i-1].close):null;
    tr.push(i===0?h-l:Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
  }
  const out=new Array(bars.length).fill(null);let a=tr.slice(1,period+1).reduce((x,y)=>x+y,0)/period;out[period]=a;
  for(let i=period+1;i<tr.length;i++){a=(a*(period-1)+tr[i])/period;out[i]=a}
  return out;
}
function cross(prevA,a,prevB,b){
  if(![prevA,a,prevB,b].every(Number.isFinite))return null;
  if(prevA<=prevB&&a> b)return "UP";
  if(prevA>=prevB&&a< b)return "DOWN";
  return null;
}
function lastCross(a,b,bars,maxLookback=60){
  const start=Math.max(1,a.length-maxLookback);
  for(let i=a.length-1;i>=start;i--){const d=cross(a[i-1],a[i],b[i-1],b[i]);if(d)return{crossDirection:d,crossTimestamp:bars[i].timestamp,barsSinceCross:a.length-1-i}}
  return null;
}
function candleFacts(bars){
  const t=contiguousTail(bars,3);if(!t)return{status:"UNAVAILABLE"};
  const [a,b,c]=t;const body=x=>Math.abs(x.close-x.open),range=x=>x.high-x.low,upper=x=>x.high-Math.max(x.open,x.close),lower=x=>Math.min(x.open,x.close)-x.low;
  const bull=x=>x.close>x.open,bear=x=>x.close<x.open;
  const consecutive=(pred)=>{let n=0;for(let i=bars.length-1;i>=0&&pred(bars[i]);i--)n++;return n};
  return {
    status:"AVAILABLE",
    bullishEngulfing:bear(b)&&bull(c)&&c.open<=b.close&&c.close>=b.open,
    bearishEngulfing:bull(b)&&bear(c)&&c.open>=b.close&&c.close<=b.open,
    hammer:range(c)>0&&lower(c)>=2*Math.max(body(c),range(c)*.05)&&upper(c)<=range(c)*.25,
    shootingStar:range(c)>0&&upper(c)>=2*Math.max(body(c),range(c)*.05)&&lower(c)<=range(c)*.25,
    doji:range(c)>0&&body(c)<=range(c)*.1,
    insideBar:c.high<=b.high&&c.low>=b.low,
    outsideBar:c.high>=b.high&&c.low<=b.low,
    longUpperWick:range(c)>0&&upper(c)>=range(c)*.45,
    longLowerWick:range(c)>0&&lower(c)>=range(c)*.45,
    consecutiveBullCandles:consecutive(bull),consecutiveBearCandles:consecutive(bear),
    higherHigh:c.high>b.high,higherLow:c.low>b.low,lowerHigh:c.high<b.high,lowerLow:c.low<b.low
  };
}
function swings(bars,lookback=45){
  const s=bars.slice(-lookback);if(s.length<5)return{recentSwingHigh:null,recentSwingLow:null};
  const highs=[],lows=[];
  for(let i=2;i<s.length-2;i++){
    if(s[i].high>s[i-1].high&&s[i].high>=s[i-2].high&&s[i].high>s[i+1].high&&s[i].high>=s[i+2].high)highs.push(s[i]);
    if(s[i].low<s[i-1].low&&s[i].low<=s[i-2].low&&s[i].low<s[i+1].low&&s[i].low<=s[i+2].low)lows.push(s[i]);
  }
  return{recentSwingHigh:highs.at(-1)?.high??Math.max(...s.map(x=>x.high)),recentSwingLow:lows.at(-1)?.low??Math.min(...s.map(x=>x.low))};
}
function previous15(bars,start,end){
  const s=bars.filter(b=>{const t=Date.parse(b.timestamp);return t>=start&&t<end});
  if(s.length!==15||!contiguousTail(s,15))return{status:"PARTIAL",barCount:s.length};
  return{status:"READY",barCount:15,open:s[0].open,high:Math.max(...s.map(x=>x.high)),low:Math.min(...s.map(x=>x.low)),close:s.at(-1).close,volume:s.every(x=>Number.isFinite(x.volume))?s.reduce((a,b)=>a+b.volume,0):null};
}
function classifyRsi(r){if(!Number.isFinite(r))return"UNAVAILABLE";if(r<30)return"OVERSOLD";if(r<45)return"WEAK";if(r<=55)return"NEUTRAL";if(r<=70)return"STRONG";return"OVERBOUGHT"}
function directionFromPct(x){return !Number.isFinite(x)?"UNKNOWN":x>0.05?"UP":x<-0.05?"DOWN":"FLAT"}

function assessAsset(history,cutoffMs,previousStart,previousEnd){
  const all=(history?.bars||[]).filter(b=>b.complete===true&&Date.parse(b.timestamp)+MINUTE<=cutoffMs).map(b=>({...b,open:f(b.open),high:f(b.high),low:f(b.low),close:f(b.close),volume:f(b.volume)}));
  const dataStatus=history?.status||"UNAVAILABLE";
  const last=all.at(-1)||null;
  if(!last)return{asset:history?.asset||"UNKNOWN",dataStatus:"UNAVAILABLE",advisoryBias:"NEUTRAL",advisoryConfidence:"LOW",trendState:"UNKNOWN",momentumState:"UNKNOWN",setupPhase:"NO_CLEAR_SETUP",supportingSignals:[],conflictingSignals:[],watchLevels:[],riskFlags:["NO_COMPLETED_HISTORY"],confluenceCount:0,reasoningSummary:"Historical evidence unavailable.",authority:AUTHORITY};
  const c=closes(all),lastClose=last.close;
  const m1=contiguousTail(all,2),m5=contiguousTail(all,6),m15=contiguousTail(all,16);
  const momentum1m=m1?pct(m1.at(-1).close,m1[0].close):null,momentum5m=m5?pct(m5.at(-1).close,m5[0].close):null,momentum15m=m15?pct(m15.at(-1).close,m15[0].close):null;

  const rsiTail=contiguousTail(all,45);let rsi14=null,previousRsi14=null;
  if(rsiTail){const rs=rsiSeries(closes(rsiTail),14);rsi14=rs.at(-1);previousRsi14=rs.at(-2)}
  const rsi={rsi14:round(rsi14),previousRsi14:round(previousRsi14),rsiSlope:round(Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)?rsi14-previousRsi14:null),classification:classifyRsi(rsi14),crossed30Up:Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)&&previousRsi14<30&&rsi14>=30,crossed30Down:Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)&&previousRsi14>=30&&rsi14<30,crossed50Up:Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)&&previousRsi14<50&&rsi14>=50,crossed50Down:Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)&&previousRsi14>=50&&rsi14<50,crossed70Up:Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)&&previousRsi14<70&&rsi14>=70,crossed70Down:Number.isFinite(rsi14)&&Number.isFinite(previousRsi14)&&previousRsi14>=70&&rsi14<70};

  const emaTail=contiguousTail(all,90);let ema={status:"UNAVAILABLE"};
  if(emaTail){const v=closes(emaTail),e9=emaSeries(v,9),e12=emaSeries(v,12),e26=emaSeries(v,26);const i=v.length-1,p=i-1;const a=e9[i],b=e12[i],d=e26[i];let structure="MIXED";const spread=Math.max(a,b,d)-Math.min(a,b,d);if(spread/lastClose<0.0007)structure="COMPRESSED";else if(a>b&&b>d)structure="BULLISH_STACK";else if(a<b&&b<d)structure="BEARISH_STACK";else if((a>b||b>d)&&a>d)structure="BULLISH_TRANSITION";else if((a<b||b<d)&&a<d)structure="BEARISH_TRANSITION";
    ema={status:"AVAILABLE",ema9:round(a),ema12:round(b),ema26:round(d),ema9Slope:round(a-e9[p]),ema12Slope:round(b-e12[p]),ema26Slope:round(d-e26[p]),priceAboveEma9:lastClose>a,priceAboveEma12:lastClose>b,priceAboveEma26:lastClose>d,ema9Above12:a>b,ema9Above26:a>d,ema12Above26:b>d,structure,cross9x12:lastCross(e9,e12,emaTail),cross9x26:lastCross(e9,e26,emaTail),cross12x26:lastCross(e12,e26,emaTail)};
  }

  const maTail=contiguousTail(all,202);let ma200={status:"UNAVAILABLE"};
  if(maTail){const v=closes(maTail),cur=sma(v,200),prev=sma(v.slice(0,-1),200),prevPrice=v.at(-2);ma200={status:"AVAILABLE",ma200:round(cur),previousMa200:round(prev),ma200Slope:round(cur-prev),priceAboveMa200:lastClose>cur,priceBelowMa200:lastClose<cur,distanceFromMa200Pct:round(pct(lastClose,cur),4),crossedMa200Up:prevPrice<=prev&&lastClose>cur,crossedMa200Down:prevPrice>=prev&&lastClose<cur,recentReclaim:prevPrice<=prev&&lastClose>cur,recentLoss:prevPrice>=prev&&lastClose<cur};}

  const atrTail=contiguousTail(all,45);let volatility={status:"UNAVAILABLE"};
  if(atrTail){const at=atrSeries(atrTail,14),cur=at.at(-1),prev=at.at(-2),recent=at.slice(-6).filter(Number.isFinite),prior=at.slice(-12,-6).filter(Number.isFinite);const rAvg=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:null,pAvg=prior.length?prior.reduce((a,b)=>a+b,0)/prior.length:null;volatility={status:"AVAILABLE",atr14:round(cur),atrPct:round(cur/lastClose*100,4),volatilityIncreasing:Number.isFinite(prev)&&cur>prev,volatilityDecreasing:Number.isFinite(prev)&&cur<prev,rangeExpansion:Number.isFinite(rAvg)&&Number.isFinite(pAvg)&&rAvg>pAvg*1.15,rangeCompression:Number.isFinite(rAvg)&&Number.isFinite(pAvg)&&rAvg<pAvg*.85};}

  const p15=previous15(all,previousStart,previousEnd),sw=swings(all),support=Math.max(...[p15.low,sw.recentSwingLow].filter(Number.isFinite)),resistance=Math.min(...[p15.high,sw.recentSwingHigh].filter(Number.isFinite));
  const levels={prior15High:p15.high??null,prior15Low:p15.low??null,recentSwingHigh:sw.recentSwingHigh,recentSwingLow:sw.recentSwingLow,nearestSupport:Number.isFinite(support)?support:null,nearestResistance:Number.isFinite(resistance)?resistance:null,distanceToSupportPct:Number.isFinite(support)?round(pct(lastClose,support),4):null,distanceToResistancePct:Number.isFinite(resistance)?round(pct(resistance,lastClose),4):null,breakoutAboveResistance:Number.isFinite(resistance)&&lastClose>resistance,breakdownBelowSupport:Number.isFinite(support)&&lastClose<support};
  const candles=candleFacts(all);
  const volTail=contiguousTail(all,21);let volume={volumeState:history?.volumeState||"UNAVAILABLE"};if(volTail&&volTail.every(x=>Number.isFinite(x.volume))){const vols=volTail.map(x=>x.volume),avg=vols.slice(0,-1).reduce((a,b)=>a+b,0)/(vols.length-1),cur=vols.at(-1);volume={volumeState:"AVAILABLE",volume:round(cur),recentAverageVolume:round(avg),volumeRatio:round(avg?cur/avg:null,4),volumeIncreasing:cur>avg,volumeDecreasing:cur<avg};}

  const supporting=[],conflicting=[],risk=[];
  if(rsi.crossed50Up)supporting.push("RSI_CROSSED_50_UP"); if(rsi.crossed50Down)supporting.push("RSI_CROSSED_50_DOWN");
  if(ema.structure==="BULLISH_STACK")supporting.push("BULLISH_EMA_STACK");if(ema.structure==="BEARISH_STACK")supporting.push("BEARISH_EMA_STACK");
  if(ma200.recentReclaim)supporting.push("MA200_RECLAIM");if(ma200.recentLoss)supporting.push("MA200_LOSS");
  if(levels.breakoutAboveResistance)supporting.push("RESISTANCE_BREAKOUT");if(levels.breakdownBelowSupport)supporting.push("SUPPORT_BREAKDOWN");
  if(volatility.rangeExpansion)supporting.push("RANGE_EXPANSION");if(volume.volumeRatio>1.5)supporting.push("HIGH_VOLUME_CONFIRMATION");
  const bullSignals=[ema.structure==="BULLISH_STACK",Number.isFinite(rsi14)&&rsi14>52,Number.isFinite(momentum15m)&&momentum15m>0,ma200.priceAboveMa200===true,levels.breakoutAboveResistance].filter(Boolean).length;
  const bearSignals=[ema.structure==="BEARISH_STACK",Number.isFinite(rsi14)&&rsi14<48,Number.isFinite(momentum15m)&&momentum15m<0,ma200.priceBelowMa200===true,levels.breakdownBelowSupport].filter(Boolean).length;
  if(bullSignals&&bearSignals)conflicting.push("MIXED_DIRECTIONAL_EVIDENCE");
  if(rsi14>70)risk.push("RSI_OVERBOUGHT_CONTEXT");if(rsi14<30)risk.push("RSI_OVERSOLD_CONTEXT");if(dataStatus!=="READY")risk.push("PARTIAL_HISTORY");if(history?.gapCount>0)risk.push("HISTORICAL_GAPS_PRESENT");
  let advisoryBias="NEUTRAL";if(bullSignals>=3&&bullSignals>bearSignals)advisoryBias="BULLISH";else if(bearSignals>=3&&bearSignals>bullSignals)advisoryBias="BEARISH";else if(bullSignals&&bearSignals)advisoryBias="MIXED";
  const comparable=[Number.isFinite(rsi14),ema.status==="AVAILABLE",Number.isFinite(momentum15m),ma200.status==="AVAILABLE",Number.isFinite(levels.nearestSupport)||Number.isFinite(levels.nearestResistance)].filter(Boolean).length;
  const agreement=Math.max(bullSignals,bearSignals);const advisoryConfidence=comparable>=4&&agreement>=4?"HIGH":comparable>=3&&agreement>=2?"MEDIUM":"LOW";
  let trendState="UNKNOWN";if(ema.structure==="BULLISH_STACK"&&ma200.priceAboveMa200)trendState=bullSignals>=4?"STRONG_UPTREND":"UPTREND";else if(ema.structure==="BEARISH_STACK"&&ma200.priceBelowMa200)trendState=bearSignals>=4?"STRONG_DOWNTREND":"DOWNTREND";else if(ema.status==="AVAILABLE")trendState="TRANSITION";
  let momentumState="UNKNOWN";if([momentum1m,momentum5m,momentum15m].every(Number.isFinite)){const same=Math.sign(momentum1m)===Math.sign(momentum5m)&&Math.sign(momentum5m)===Math.sign(momentum15m);if(Math.sign(momentum1m)!==Math.sign(momentum15m))momentumState="REVERSING";else if(Math.abs(momentum1m)>Math.abs(momentum5m)/5&&Math.abs(momentum5m)>Math.abs(momentum15m)/3)momentumState="ACCELERATING";else if(Math.abs(momentum1m)<Math.abs(momentum5m)/5*.6)momentumState="FADING";else momentumState=same?"STEADY":"REVERSING";}
  let setupPhase="NO_CLEAR_SETUP";if(advisoryBias==="BULLISH"||advisoryBias==="BEARISH"){if(momentumState==="REVERSING")setupPhase="REVERSAL_RISK";else if((rsi14>70&&advisoryBias==="BULLISH")||(rsi14<30&&advisoryBias==="BEARISH"))setupPhase="EXHAUSTION_RISK";else if(supporting.length>=4)setupPhase="CONFIRMING";else if(supporting.length>=2)setupPhase="EARLY";else setupPhase="MATURE";}
  const reasoning=[];if(Number.isFinite(rsi14))reasoning.push(`RSI ${rsi14.toFixed(1)} (${rsi.classification})`);if(ema.status==="AVAILABLE")reasoning.push(`EMA ${ema.structure}`);if(Number.isFinite(momentum15m))reasoning.push(`15m momentum ${momentum15m>=0?"+":""}${momentum15m.toFixed(2)}%`);if(ma200.status==="AVAILABLE")reasoning.push(`price ${ma200.priceAboveMa200?"above":"below"} MA200`);if(dataStatus!=="READY")reasoning.push("history partial");
  const confluenceCount=[rsi.crossed50Up||rsi.crossed50Down,ema.structure==="BULLISH_STACK"||ema.structure==="BEARISH_STACK",ma200.recentReclaim||ma200.recentLoss,levels.breakoutAboveResistance||levels.breakdownBelowSupport,volatility.rangeExpansion,volume.volumeRatio>1.5].filter(Boolean).length;
  return{asset:history.asset,dataStatus,asOf:last.timestamp,previous15:p15,momentum:{momentum1mPct:round(momentum1m,4),momentum5mPct:round(momentum5m,4),momentum15mPct:round(momentum15m,4)},rsi,ema,ma200,volatility,candles,levels,volume,advisoryBias,advisoryConfidence,trendState,momentumState,setupPhase,supportingSignals:supporting,conflictingSignals:conflicting,watchLevels:[levels.nearestSupport,levels.nearestResistance].filter(Number.isFinite),riskFlags:risk,confluenceCount,reasoningSummary:reasoning.join("; ")+".",direction:directionFromPct(momentum15m),authority:AUTHORITY};
}

function marketContext(assessments){
  const usable=assessments.filter(a=>a.dataStatus!=="UNAVAILABLE"&&a.direction!=="UNKNOWN");
  const up=usable.filter(a=>a.direction==="UP").length,down=usable.filter(a=>a.direction==="DOWN").length,mixed=usable.length-up-down;
  const bull=assessments.filter(a=>a.advisoryBias==="BULLISH").length,bear=assessments.filter(a=>a.advisoryBias==="BEARISH").length;
  const btc=assessments.find(a=>a.asset==="BTC"),eth=assessments.find(a=>a.asset==="ETH");
  let regime="MIXED";if(usable.length){if(up/usable.length>=.67)regime="BROAD_RISK_ON";else if(down/usable.length>=.67)regime="BROAD_RISK_OFF";else if(btc?.direction==="UP"&&up>=down+2)regime="BTC_LED";else if(eth?.direction==="UP"&&up>=down+2)regime="ETH_LED";else if(up+down<=Math.max(2,usable.length*.4))regime="CHOPPY";}
  const breadth={comparableAssets:usable.length,numberAssetsBullish:bull,numberAssetsBearish:bear,numberAssetsMixed:assessments.length-bull-bear,marketBreadthUpPct:usable.length?round(up/usable.length*100,2):null,marketBreadthDownPct:usable.length?round(down/usable.length*100,2):null,btcDirection:btc?.direction||"UNKNOWN",ethDirection:eth?.direction||"UNKNOWN"};
  for(const a of assessments){if(a.direction!=="UNKNOWN"&&usable.length){const majority=up>down?"UP":down>up?"DOWN":"FLAT";a.assetAlignedWithMarket=majority!=="FLAT"&&a.direction===majority;a.assetDivergingFromMarket=majority!=="FLAT"&&a.direction!=="FLAT"&&a.direction!==majority}else{a.assetAlignedWithMarket=null;a.assetDivergingFromMarket=null}}
  return{marketRegime:regime,marketBreadth:breadth};
}

function rank(assessments,bias){return assessments.filter(a=>a.advisoryBias===bias).sort((a,b)=>b.confluenceCount-a.confluenceCount||({HIGH:3,MEDIUM:2,LOW:1}[b.advisoryConfidence]-({HIGH:3,MEDIUM:2,LOW:1}[a.advisoryConfidence]))).map(a=>a.asset)}

await mkdir(fileURLToPath(OUTPUT_DIR),{recursive:true});
const histories=[];for(const asset of ASSETS){histories.push(JSON.parse(await readFile(new URL(`../advisor-history/out/${asset}.json`,import.meta.url),"utf8")))}
const now=Date.now(),currentWindowStart=Math.floor(now/CYCLE)*CYCLE,previousWindowStart=currentWindowStart-CYCLE,previousWindowEnd=currentWindowStart;
const assessments=histories.map(h=>assessAsset(h,previousWindowEnd,previousWindowStart,previousWindowEnd));
const market=marketContext(assessments);
const cycleId=iso(currentWindowStart).replace(/[:.]/g,"-");
const briefingId=`advisor-v1-${cycleId}`;
const majorLevelsInPlay=assessments.flatMap(a=>a.watchLevels.map(level=>({asset:a.asset,level}))).slice(0,18);
const divergences=assessments.filter(a=>a.assetDivergingFromMarket).sort((a,b)=>Math.abs(b.momentum.momentum15mPct||0)-Math.abs(a.momentum.momentum15mPct||0)).map(a=>a.asset);
const briefing=Object.freeze({schema:"NFE_PRE_CYCLE_BRIEFING_V1",immutable:true,briefingId,cycleId,generatedAt:new Date().toISOString(),currentWindowStart:iso(currentWindowStart),previousWindowStart:iso(previousWindowStart),previousWindowEnd:iso(previousWindowEnd),evidenceCutoffExclusive:iso(previousWindowEnd),assetAssessments:assessments,marketRegime:market.marketRegime,marketBreadth:market.marketBreadth,strongestBullishContext:rank(assessments,"BULLISH").slice(0,3),strongestBearishContext:rank(assessments,"BEARISH").slice(0,3),highestConfluenceAssets:[...assessments].sort((a,b)=>b.confluenceCount-a.confluenceCount).slice(0,3).map(a=>a.asset),largestDivergences:divergences.slice(0,3),majorLevelsInPlay,marketRiskFlags:[histories.some(h=>h.status!=="READY")?"PARTIAL_ASSET_HISTORY_PRESENT":null,assessments.some(a=>a.riskFlags.includes("HISTORICAL_GAPS_PRESENT"))?"HISTORICAL_GAPS_PRESENT":null].filter(Boolean),advisorSummary:`${market.marketRegime}; breadth ${market.marketBreadth.marketBreadthUpPct??"—"}% up / ${market.marketBreadth.marketBreadthDownPct??"—"}% down; bullish context ${rank(assessments,"BULLISH").slice(0,3).join(", ")||"none"}; bearish context ${rank(assessments,"BEARISH").slice(0,3).join(", ")||"none"}.`,dataCompleteness:{ready:histories.filter(h=>h.status==="READY").map(h=>h.asset),partial:histories.filter(h=>h.status==="PARTIAL").map(h=>h.asset),unavailable:histories.filter(h=>h.status==="UNAVAILABLE").map(h=>h.asset)},authority:AUTHORITY,safety:SAFETY});

// Current-cycle update is deliberately separate and can use only completed bars from the active cycle.
const currentAssessments=histories.map(h=>assessAsset(h,now,currentWindowStart-CYCLE,currentWindowStart));
const currentMarket=marketContext(currentAssessments);
const changes=[];for(const cur of currentAssessments){const pre=assessments.find(a=>a.asset===cur.asset);if(!pre)continue;if(cur.advisoryBias!==pre.advisoryBias)changes.push({asset:cur.asset,type:cur.advisoryBias==="BULLISH"?"BULLISH_CONFIRMATION":cur.advisoryBias==="BEARISH"?"BEARISH_CONFIRMATION":"DIVERGENCE",from:pre.advisoryBias,to:cur.advisoryBias});if(cur.momentumState==="FADING"&&pre.momentumState!=="FADING")changes.push({asset:cur.asset,type:"MOMENTUM_FADE"});if(cur.setupPhase==="REVERSAL_RISK"&&pre.setupPhase!=="REVERSAL_RISK")changes.push({asset:cur.asset,type:"REVERSAL_RISK"});if(cur.levels.breakoutAboveResistance&&!pre.levels.breakoutAboveResistance)changes.push({asset:cur.asset,type:"BREAKOUT"});}
const update={schema:"NFE_ADVISOR_CURRENT_V1",cycleId,briefingId,generatedAt:new Date().toISOString(),currentWindowStart:iso(currentWindowStart),usesCompletedBarsOnly:true,marketRegime:currentMarket.marketRegime,marketBreadth:currentMarket.marketBreadth,assetAssessments:currentAssessments,materialChanges:changes,attentionRank:[...currentAssessments].sort((a,b)=>b.confluenceCount-a.confluenceCount).map(a=>a.asset),authority:AUTHORITY,safety:SAFETY};

await writeFile(new URL("./out/pre-cycle-briefing.json",import.meta.url),JSON.stringify(briefing,null,2)+"\n","utf8");
await writeFile(new URL("./out/current.json",import.meta.url),JSON.stringify(update,null,2)+"\n","utf8");
await writeFile(new URL("./out/summary.json",import.meta.url),JSON.stringify({briefingId,cycleId,marketRegime:briefing.marketRegime,marketBreadth:briefing.marketBreadth,strongestBullishContext:briefing.strongestBullishContext,strongestBearishContext:briefing.strongestBearishContext,materialChanges:changes,dataCompleteness:briefing.dataCompleteness,authority:AUTHORITY,safety:SAFETY},null,2)+"\n","utf8");

// Zero-money assertions: no previous-window leakage, immutable identity, authority wall.
if(assessments.some(a=>Date.parse(a.asOf||0)>=previousWindowEnd))throw new Error("FUTURE_LEAK_PRE_CYCLE");
if(briefing.evidenceCutoffExclusive!==iso(previousWindowEnd))throw new Error("BRIEFING_CUTOFF_MISMATCH");
if(Object.isFrozen(briefing)!==true)throw new Error("BRIEFING_NOT_FROZEN");
if(Object.values(AUTHORITY).some((v,i)=>i>=5&&v!==false))throw new Error("AUTHORITY_WALL_FAILED");
if(SAFETY.providerTradingWrites!==0||SAFETY.capitalMovedUsd!==0||SAFETY.ordersSubmittedByAdvisor!==0)throw new Error("ZERO_MONEY_FAILED");
console.log("PRE_CYCLE_BRIEFING_CREATED=YES");console.log("briefingId="+briefingId);console.log("cycleId="+cycleId);console.log("NO_FUTURE_LEAK=PROVEN");console.log("BRIEFING_IMMUTABLE=PROVEN");console.log("CURRENT_UPDATE_SEPARATE=PROVEN");console.log("providerTradingWrites=0");console.log("capitalMovedUsd=0");console.log("ordersSubmittedByAdvisor=0");for(const a of assessments)console.log(`ASSET ${a.asset} ${a.dataStatus} ${a.advisoryBias} ${a.advisoryConfidence} RSI=${a.rsi.rsi14??"NA"} EMA=${a.ema.structure??"NA"} MA200=${a.ma200.status==="AVAILABLE"?(a.ma200.priceAboveMa200?"ABOVE":"BELOW"):"NA"}`);
