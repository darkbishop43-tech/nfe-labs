import test from 'node:test';import assert from 'node:assert/strict';import {rankVerifiedStaircase} from '../src/staircase-top3-v2.js';
const now=Date.parse('2026-10-15T11:00:00Z');
const mk=(ticker,yesBid)=>({ticker,asset:ticker,status:'open',yesBid,noBid:1-yesBid,closeTime:'2026-10-15T11:15:00Z',providerReadAt:'2026-10-15T11:00:00Z'});
const ob=(ticker,side,bid,seconds)=>({ticker,side,bid,source:'DIRECT_KALSHI_GET',at:new Date(now-1000*seconds).toISOString()});
test('ranks top three distinct contracts by strongest recent verified bid gain',()=>{
 const markets=[mk('BTC',.7),mk('ETH',.5),mk('SOL',.6),mk('XRP',.4)];
 const history=[ob('BTC','YES',.5,10),ob('BTC','YES',.7,0),ob('ETH','YES',.46,10),ob('ETH','YES',.5,0),ob('SOL','YES',.48,10),ob('SOL','YES',.6,0),ob('XRP','YES',.39,10),ob('XRP','YES',.4,0)];
 const ranked=rankVerifiedStaircase(markets,history,now);
 assert.deepEqual(ranked.map(x=>x.ticker),['BTC','SOL','ETH']);
 assert.equal(ranked[0].deltaCents.toFixed(1),'20.0');
});
test('never manufactures movement with one sample',()=>{const r=rankVerifiedStaircase([mk('BTC',.6)],[ob('BTC','YES',.6,0)],now);assert.equal(r[0].deltaCents,null);assert.equal(r[0].status,'INSUFFICIENT_OBSERVATIONS');});
test('expired contracts and unverified samples excluded',()=>{const x=mk('BTC',.6);x.closeTime='2026-10-15T10:00:00Z';assert.deepEqual(rankVerifiedStaircase([x],[ob('BTC','YES',.6,0)],now),[]);assert.equal(rankVerifiedStaircase([mk('ETH',.6)],[{...ob('ETH','YES',.6,0),source:'UNVERIFIED'}],now)[0].observationCount,0);});
