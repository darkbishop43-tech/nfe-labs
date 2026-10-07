// Authoritative PAYNE Paper strategy brain transplanted into PAYNE-Kalshi Real.
// Strategy lineage:
// - sibling executor commit: 23f7855a7c270c96a7f14ad9f7852ac3462fcf75
// - sibling worker blob: 6db7cde1231cd20d15837474b360f7b370b07b3d
// - upstream collector blob: 9c49d2d6d7c9856ca923f767761c54d535666f69
//
// This module is pure strategy/decision logic. It has no provider authority,
// no signing, no order submission, no capital movement, and no AUTO coupling.

export const PAYNE_PAPER_SOURCE=Object.freeze({
  executorCommit:'23f7855a7c270c96a7f14ad9f7852ac3462fcf75',
  executorBlob:'6db7cde1231cd20d15837474b360f7b370b07b3d',
  collectorBlob:'9c49d2d6d7c9856ca923f767761c54d535666f69',
  executorPath:'market-edge-lab/siblings/cloud/worker.js',
  collectorPath:'market-edge-lab/cloudflare/worker.js',
  sourceBranch:'market-edge-sibling-build',
});

export const PAYNE_PAPER_RULES=Object.freeze({
  radarScore:0.50,
  lockScore:0.65,
  pullScore:0.80,
  minAbsMove:0.002,
  maxHoldMs:5*60*1000,
  cooldownMs:5*60*1000,
  sourceCadenceMs:5*60*1000,
  sourceAssets:Object.freeze(['BTC','ETH']),
});

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

export function paperMove(currentPrice,referencePrice){
  const current=Number(currentPrice),reference=Number(referencePrice);
  return Number.isFinite(current)&&current>0&&Number.isFinite(reference)&&reference>0
    ? (current-reference)/reference
    : 0;
}

export function paperFeatureMath({marketPrice,move,direction,outcomeSide}={}){
  const price=Number(marketPrice),rawMove=Number(move);
  if(!Number.isFinite(price)||!(price>0&&price<1)||!Number.isFinite(rawMove)) return null;
  const d=String(direction||'').toUpperCase();
  const side=String(outcomeSide||'').toUpperCase();
  const below=d==='BELOW'||d==='DOWN'||side==='NO';
  const directionalMove=below?-rawMove:rawMove;
  const fair=clamp(price+directionalMove*18,0.02,0.98);
  const edge=fair-price;
  const score=clamp(0.50+edge*4,0,1);
  return {move:rawMove,directionalMove,fair,edge,score};
}

export function paperDecision({score,edge,move,threshold=PAYNE_PAPER_RULES.pullScore}={}){
  const sc=Number(score),ed=Number(edge),mv=Number(move),pullThreshold=Number(threshold);
  if(![sc,ed,mv,pullThreshold].every(Number.isFinite)){
    return {label:'UNAVAILABLE',radar:false,lock:false,trigger:false,threshold:pullThreshold};
  }
  const radar=sc>=PAYNE_PAPER_RULES.radarScore;
  const lock=radar&&sc>=PAYNE_PAPER_RULES.lockScore&&ed>0;
  const trigger=lock&&sc>=pullThreshold&&Math.abs(mv)>=PAYNE_PAPER_RULES.minAbsMove;
  return {
    label:trigger?'PULL TRIGGER':lock?'LOCK IN':radar?'RADAR':'PASS',
    radar,lock,trigger,threshold:pullThreshold,
  };
}

export function paperRankCandidates(rows=[]){
  return [...rows].sort((a,b)=>{
    const as=Number(a?.payne?.score??a?.score),bs=Number(b?.payne?.score??b?.score);
    if(Number.isFinite(as)&&Number.isFinite(bs)&&as!==bs) return bs-as;
    if(Number.isFinite(bs)&&!Number.isFinite(as)) return 1;
    if(Number.isFinite(as)&&!Number.isFinite(bs)) return -1;
    const ae=Number(a?.payne?.edge??a?.edge),be=Number(b?.payne?.edge??b?.edge);
    if(Number.isFinite(ae)&&Number.isFinite(be)&&ae!==be) return be-ae;
    if(Number.isFinite(be)&&!Number.isFinite(ae)) return 1;
    if(Number.isFinite(ae)&&!Number.isFinite(be)) return -1;
    return String(a?.ticker??a?.marketTicker??'').localeCompare(String(b?.ticker??b?.marketTicker??''));
  });
}

export function paperCandidateKey(candidate={}){
  const ticker=String(candidate?.ticker??candidate?.marketTicker??'').trim();
  const outcomeSide=String(candidate?.outcomeSide??'YES').toUpperCase();
  const direction=String(candidate?.direction??(outcomeSide==='NO'?'DOWN':'UP')).toUpperCase();
  return ticker? `${ticker}:${outcomeSide}:${direction}` : null;
}

export function paperCooldownActive(lastExitAt,nowMs=Date.now()){
  const exitMs=Date.parse(lastExitAt||'');
  return Number.isFinite(exitMs)&&Number(nowMs)-exitMs<PAYNE_PAPER_RULES.cooldownMs;
}

export function paperManagementDecision({
  heldMs,
  marketPresent=true,
  decisionLabel='PULL TRIGGER',
  owned=true,
}={}){
  if(!owned) return {action:'HOLD',reason:'NO_AUTHENTICATED_OWNERSHIP'};
  if(Number(heldMs)>=PAYNE_PAPER_RULES.maxHoldMs) return {action:'EXIT',reason:'max_hold'};
  if(marketPresent!==true) return {action:'EXIT',reason:'market_missing'};
  if(String(decisionLabel)!=='PULL TRIGGER') return {action:'EXIT',reason:'decision_exit'};
  return {action:'HOLD',reason:'PULL_TRIGGER_REMAINS_QUALIFIED'};
}
