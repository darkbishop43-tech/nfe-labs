import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  COCKPIT_REFRESH_MS,
  providerMarketSnapshot,
  discoverCockpitMarkets,
  readAuthoritativePayneFeatures,
  buildCockpitData,
  defaultControlState,
} from '../src/index.js';
import { cockpitHtml } from '../src/cockpit-html.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryKV {
  constructor() { this.store=new Map([['payne-kalshi:control:v1',JSON.stringify(defaultControlState())]]); }
  async get(key){ return this.store.has(key)?this.store.get(key):null; }
  async put(key,value){ this.store.set(key,value); }
  async list({prefix=''}={}){ return {keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))}; }
}

async function authEnv(){
  const pair=await crypto.subtle.generateKey(
    {name:'RSA-PSS',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']
  );
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  let binary=''; for(const b of der) binary+=String.fromCharCode(b);
  const base64=btoa(binary).match(/.{1,64}/g).join('\n');
  return {
    PAYNE_KALSHI_STATE:new MemoryKV(),
    KALSHI_EXECUTION_KEY_ID:'TEST_KEY_ID_SENTINEL',
    KALSHI_EXECUTION_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
  };
}

function jsonResponse(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}

function providerMarket(asset,ticker,series,yesBid='0.47',yesAsk='0.49'){
  return {
    ticker,
    series_ticker:series,
    title:asset+' up in next 15 minutes?',
    status:'open',
    open_time:'2026-10-02T06:00:00Z',
    close_time:'2026-10-02T06:15:00Z',
    yes_bid_dollars:yesBid,
    yes_ask_dollars:yesAsk,
    no_bid_dollars:String((1-Number(yesAsk)).toFixed(2)),
    no_ask_dollars:String((1-Number(yesBid)).toFixed(2)),
  };
}

test('provider snapshot preserves authentic live contract evidence',()=>{
  const now=Date.parse('2026-10-02T06:00:00Z');
  const snap=providerMarketSnapshot(providerMarket('BTC','KXBTC15M-TEST','KXBTC15M'),now,'BTC','2026-10-02T06:00:01Z');
  assert.equal(snap.asset,'BTC');
  assert.equal(snap.ticker,'KXBTC15M-TEST');
  assert.equal(snap.yesAsk,.49);
  assert.equal(snap.noBid,.51);
  assert.equal(snap.timeRemainingMs,15*60_000);
  assert.equal(snap.source,'LIVE_PROVIDER_DATA');
  assert.equal(snap.providerReadAt,'2026-10-02T06:00:01Z');
});

test('series-scoped discovery uses the proven Baseline series universe instead of first-five-page broad scan',async()=>{
  const env=await authEnv();
  const urls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options={})=>{
    urls.push(String(url));
    const u=String(url);
    if(u.includes('series_ticker=KXBTC15M')) return jsonResponse({markets:[providerMarket('BTC','KXBTC15M-TEST','KXBTC15M')]});
    if(u.includes('series_ticker=KXETH15M')) return jsonResponse({markets:[providerMarket('ETH','KXETH15M-TEST','KXETH15M')]});
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    throw new Error('unexpected URL '+u);
  };
  try{
    const out=await discoverCockpitMarkets(env,{nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.ok,true);
    assert.equal(out.providerGets,9);
    assert.deepEqual(out.markets.map(x=>x.asset).sort(),['BTC','ETH']);
    assert.equal(urls.length,9);
    assert.equal(urls.every(u=>u.includes('series_ticker=')),true);
    assert.equal(urls.some(u=>u.includes('cursor=')),false);
  } finally { globalThis.fetch=original; }
});

test('authoritative Payne features come from exact Baseline shadow ticker and side',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options={})=>{
    assert.equal(options.method,'GET');
    assert.match(String(url),/market-edge-baseline-real.*\/shadow-state/);
    return jsonResponse({
      mode:'REAL_KALSHI_SHADOW',
      status:'LIVE_KALSHI_SHADOW',
      lastRunAt:'2026-10-02T06:04:30Z',
      priceSources:{BTC:'COINBASE'},
      opportunities:[{
        marketTicker:'KXBTC15M-TEST',
        outcomeSide:'YES',
        direction:'UP',
        move:.003,
        fair:.554,
        edge:.054,
        score:.716,
      }],
    });
  };
  try{
    const out=await readAuthoritativePayneFeatures(Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.ok,true);
    assert.equal(out.fresh,true);
    assert.equal(out.opportunities[0].score,.716);
    assert.equal(out.priceSources.BTC,'COINBASE');
  } finally { globalThis.fetch=original; }
});

test('cockpit performs authenticated series discovery, exact rereads, authentic Payne qualification, and zero-money IOC preview',async()=>{
  const env=await authEnv();
  const methods=[];
  const urls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options={})=>{
    methods.push(options.method||'GET');
    urls.push(String(url));
    const u=String(url);

    if(u.includes('market-edge-baseline-real') && u.includes('/shadow-state')) return jsonResponse({
      mode:'REAL_KALSHI_SHADOW',
      status:'LIVE_KALSHI_SHADOW',
      lastRunAt:'2026-10-02T06:04:30Z',
      priceSources:{BTC:'COINBASE',ETH:'COINBASE'},
      opportunities:[
        {marketTicker:'KXBTC15M-TEST',outcomeSide:'YES',direction:'UP',move:.003,fair:.554,edge:.054,score:.716},
        {marketTicker:'KXBTC15M-TEST',outcomeSide:'NO',direction:'DOWN',move:.003,fair:.446,edge:-.054,score:.284},
        {marketTicker:'KXETH15M-TEST',outcomeSide:'YES',direction:'UP',move:.001,fair:.508,edge:.018,score:.572},
      ],
    });

    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[
      {exchange_index:0,balance:0},
      {exchange_index:2,balance:11.41},
      {exchange_index:3,balance:7.25},
    ]});

    if(u.includes('series_ticker=KXBTC15M')) return jsonResponse({markets:[providerMarket('BTC','KXBTC15M-TEST','KXBTC15M')]});
    if(u.includes('series_ticker=KXETH15M')) return jsonResponse({markets:[providerMarket('ETH','KXETH15M-TEST','KXETH15M','0.45','0.47')]});
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});

    if(u.includes('/markets/KXBTC15M-TEST')) return jsonResponse({market:providerMarket('BTC','KXBTC15M-TEST','KXBTC15M','0.48','0.50')});

    throw new Error('unexpected URL '+u);
  };
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.ok,true);
    assert.equal(out.authentication,'PROVEN');
    assert.equal(out.providerGets,12);
    assert.equal(out.baselineReads,1);
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
    assert.equal(out.index3.status,'READ-PROVEN AVAILABLE');
    assert.equal(out.index3.balance,7.25);
    assert.deepEqual(out.markets.map(x=>x.asset).sort(),['BTC','ETH']);
    assert.equal(out.selected.ticker,'KXBTC15M-TEST');
    assert.equal(out.selected.outcomeSide,'YES');
    assert.equal(out.payne.source,'BASELINE_REAL_SHADOW_READ_ONLY');
    assert.equal(out.payne.score,.716);
    assert.equal(out.payne.state,'PULL_TRIGGER');
    assert.equal(out.pipeline.radar,'PASS');
    assert.equal(out.pipeline.lockIn,'PASS');
    assert.equal(out.pipeline.pullTrigger,'PASS');
    assert.equal(out.pipeline.timeGate6_5m,'PASS');
    assert.equal(out.pipeline.freshLock,'PROVEN');
    assert.equal(out.pipeline.preSubmit,'PROVEN');
    assert.equal(out.pipeline.tickerConsistent,true);
    assert.equal(out.pipeline.sideConsistent,true);
    assert.equal(out.zeroMoneyPreview.status,'PREVIEW_READY');
    assert.equal(out.zeroMoneyPreview.timeInForce,'immediate_or_cancel');
    assert.equal(out.zeroMoneyPreview.postOnly,false);
    assert.equal(out.zeroMoneyPreview.reduceOnly,false);
    assert.equal(out.zeroMoneyPreview.providerPost,'STEP1_PROVIDER_POST_HARD_DISABLED');
    assert.equal(out.zeroMoneyPreview.providerWrites,0);
    assert.equal(out.zeroMoneyPreview.orders,0);
    assert.equal(out.zeroMoneyPreview.capitalMovedUsd,0);
    assert.equal(methods.every(x=>x==='GET'),true);
    assert.equal(urls.filter(x=>x.includes('/markets/KXBTC15M-TEST')).length,2);
  } finally { globalThis.fetch=original; }
});

test('stale Baseline feature observation stays UNKNOWN and cannot produce preview',async()=>{
  const env=await authEnv();
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options={})=>{
    const u=String(url);
    if(u.includes('market-edge-baseline-real')) return jsonResponse({
      mode:'REAL_KALSHI_SHADOW',
      status:'LIVE_KALSHI_SHADOW',
      lastRunAt:'2026-10-02T05:00:00Z',
      opportunities:[{marketTicker:'KXBTC15M-TEST',outcomeSide:'YES',move:.01,fair:.9,edge:.4,score:1}],
    });
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[{exchange_index:3,balance:7.25}]});
    if(u.includes('series_ticker=KXBTC15M')) return jsonResponse({markets:[providerMarket('BTC','KXBTC15M-TEST','KXBTC15M')]});
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    if(u.includes('/markets/KXBTC15M-TEST')) return jsonResponse({market:providerMarket('BTC','KXBTC15M-TEST','KXBTC15M')});
    throw new Error('unexpected URL '+u);
  };
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.payne.available,false);
    assert.equal(out.payne.state,'UNKNOWN / UNAVAILABLE');
    assert.equal(out.pipeline.pullTrigger,'UNKNOWN / UNAVAILABLE');
    assert.equal(out.zeroMoneyPreview.status,'NOT_REACHED');
    assert.equal(out.providerWrites,0);
  } finally { globalThis.fetch=original; }
});

test('cockpit HTML exposes functional observability without execution controls',()=>{
  const html=cockpitHtml();
  assert.equal(COCKPIT_REFRESH_MS,60_000);
  assert.match(html,/CURRENT KALSHI 15-MINUTE UNIVERSE/);
  assert.match(html,/PAYNE FEATURE EVIDENCE/);
  assert.match(html,/MOVE:/);
  assert.match(html,/RADAR ≥ \.50/);
  assert.match(html,/PULL ≥ \.70/);
  assert.match(html,/FRESH LOCK \/ PRE-SUBMIT/);
  assert.match(html,/ZERO-MONEY FIRE BOUNDARY/);
  assert.match(html,/PROVIDER POST: HARD DISABLED/);
  assert.match(html,/setInterval\(load,60000\)/);
  assert.doesNotMatch(html,/PLACE ORDER/i);
  assert.doesNotMatch(html,/SUBMIT ORDER/i);
  assert.doesNotMatch(html,/method=["']post["']/i);
});
