import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayneOwnedFeatureState,
  payneFeatureIdentity,
  payneFeatureParity,
  payneMoveParity,
} from '../src/payne-kalshi-features.js';

function kvMock(){
  const map=new Map();
  return {
    async get(k){return map.has(k)?map.get(k):null;},
    async put(k,v){map.set(k,v);},
  };
}

function market(ticker,openTime,closeTime,asset='BTC'){
  return {
    ticker,asset,openTime,closeTime,durationMs:900000,
    exchangeIndex:2,executionEligible:true,
    yesAsk:0.40,yesBid:0.39,noAsk:0.61,noBid:0.60,
    providerReadAt:new Date().toISOString(),
  };
}

function fetchSpot(prices,seen=[]){
  return async url=>{
    seen.push(String(url));
    const m=/products\/([^/]+)\/ticker/.exec(String(url));
    if(m){
      const asset=m[1].replace('-USD','');
      const price=prices[asset];
      return {
        ok:Number.isFinite(price),status:Number.isFinite(price)?200:404,
        async json(){return Number.isFinite(price)?{price:String(price)}:{};}
      };
    }
    return {ok:false,status:404,async json(){return {};}};
  };
}

test('strategy parity: MOVE FAIR EDGE SCORE formulas remain frozen',()=>{
  const move=payneMoveParity(100.2,100);
  assert.equal(move,0.0020000000000000282);
  const yes=payneFeatureParity({ask:0.40,move,outcomeSide:'YES'});
  const expectedFair=Math.max(0.02,Math.min(0.98,0.40+move*18));
  const expectedEdge=expectedFair-0.40;
  const expectedScore=Math.max(0,Math.min(1,0.5+expectedEdge*4));
  assert.equal(yes.fair,expectedFair);
  assert.equal(yes.edge,expectedEdge);
  assert.equal(yes.score,expectedScore);

  const no=payneFeatureParity({ask:0.61,move,outcomeSide:'NO'});
  const noFair=Math.max(0.02,Math.min(0.98,0.61-move*18));
  assert.equal(no.fair,noFair);
  assert.equal(no.edge,noFair-0.61);
  assert.equal(no.score,Math.max(0,Math.min(1,0.5+(noFair-0.61)*4)));
});

test('current-window feature state is PAYNE-owned and matches exact provider window',async()=>{
  const now=Date.now();
  const open=new Date(now-60_000).toISOString();
  const close=new Date(now+14*60_000).toISOString();
  const m=market('KXBTC15M-CURRENT',open,close);
  const env={PAYNE_KALSHI_STATE:kvMock()};
  const seen=[];
  const state=await buildPayneOwnedFeatureState(env,[m],now,{fetchImpl:fetchSpot({BTC:100},seen)});
  assert.equal(state.source,'PAYNE_PAPER_BRAIN_ON_KALSHI_REALITY');
  assert.equal(state.transport,'PAYNE_KALSHI_READ');
  assert.equal(state.strategyAuthority,'PAYNE_PAPER');
  assert.equal(state.sourceCadenceMs,300000);
  assert.deepEqual(state.sourceAssets,['BTC','ETH']);
  assert.equal(state.baselineStateRead,false);
  assert.equal(state.fresh,true);
  assert.equal(state.providerWrites,0);
  assert.equal(state.orders,0);
  assert.equal(state.capitalMovedUsd,0);
  assert.ok(seen.every(x=>!x.includes('market-edge-baseline-real')));
  const yes=state.opportunities.find(x=>x.outcomeSide==='YES');
  assert.equal(yes.marketTicker,m.ticker);
  assert.equal(yes.openTime,open);
  assert.equal(yes.closeTime,close);
  assert.equal(payneFeatureIdentity(yes,m,'YES').pass,true);
});

test('window rollover never retains prior-window feature authority',async()=>{
  const env={PAYNE_KALSHI_STATE:kvMock()};
  const now=Date.now();
  const first=market('KXBTC15M-OLD',new Date(now-15*60_000).toISOString(),new Date(now).toISOString());
  const next=market('KXBTC15M-NEW',new Date(now).toISOString(),new Date(now+15*60_000).toISOString());
  await buildPayneOwnedFeatureState(env,[first],now-1_000,{fetchImpl:fetchSpot({BTC:100})});
  const state=await buildPayneOwnedFeatureState(env,[next],now,{fetchImpl:fetchSpot({BTC:101})});
  assert.ok(state.opportunities.length>0);
  assert.ok(state.opportunities.every(x=>x.marketTicker==='KXBTC15M-NEW'));
  assert.ok(state.opportunities.every(x=>x.openTime===next.openTime && x.closeTime===next.closeTime));
  assert.equal(state.opportunities.some(x=>x.marketTicker==='KXBTC15M-OLD'),false);
});

test('exact ticker, side, and window identity fail closed on mismatch',()=>{
  const m=market('KXBTC15M-A','2026-10-06T06:15:00.000Z','2026-10-06T06:30:00.000Z');
  const row={marketTicker:m.ticker,outcomeSide:'YES',openTime:m.openTime,closeTime:m.closeTime};
  assert.equal(payneFeatureIdentity(row,m,'YES').pass,true);
  assert.equal(payneFeatureIdentity({...row,marketTicker:'OTHER'},m,'YES').pass,false);
  assert.equal(payneFeatureIdentity({...row,outcomeSide:'NO'},m,'YES').pass,false);
  assert.equal(payneFeatureIdentity({...row,closeTime:'2026-10-06T06:15:00.000Z'},m,'YES').pass,false);
});

test('unavailable current raw spot input fails closed without reusing old feature authority',async()=>{
  const now=Date.now();
  const m=market('KXBTC15M-STALE',new Date(now-60_000).toISOString(),new Date(now+14*60_000).toISOString());
  const env={PAYNE_KALSHI_STATE:kvMock()};
  const state=await buildPayneOwnedFeatureState(env,[m],now,{fetchImpl:fetchSpot({})});
  assert.equal(state.fresh,false);
  assert.equal(state.ok,false);
  assert.equal(state.error,'PAYNE_PAPER_BRAIN_FEATURE_INPUTS_UNAVAILABLE');
  assert.deepEqual(state.opportunities,[]);
});

test('baseline independence: qualification source does not request Baseline service state',async()=>{
  const now=Date.now();
  const m=market('KXBTC15M-DIRECT',new Date(now).toISOString(),new Date(now+15*60_000).toISOString());
  const env={PAYNE_KALSHI_STATE:kvMock(),BASELINE_REAL_READ:{fetch(){throw new Error('MUST_NOT_BE_CALLED');}}};
  const seen=[];
  const state=await buildPayneOwnedFeatureState(env,[m],now,{fetchImpl:fetchSpot({BTC:100},seen)});
  assert.equal(state.baselineStateRead,false);
  assert.ok(state.opportunities.length===2);
  assert.ok(seen.every(x=>!x.includes('baseline')));
});
