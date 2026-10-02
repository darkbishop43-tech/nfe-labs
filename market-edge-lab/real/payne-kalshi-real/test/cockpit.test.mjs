import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  COCKPIT_REFRESH_MS,
  providerMarketSnapshot,
  livePayneFeatureState,
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

test('cockpit provider snapshot normalizes live contract fields without inventing Payne features',()=>{
  const now=Date.parse('2026-10-02T06:00:00Z');
  const snap=providerMarketSnapshot({
    ticker:'KXBTC15M-TEST',
    series_ticker:'KXBTC15M',
    title:'Bitcoin up in next 15 minutes?',
    status:'open',
    close_time:'2026-10-02T06:15:00Z',
    yes_bid_dollars:'0.47',
    yes_ask_dollars:'0.49',
    no_bid_dollars:'0.51',
    no_ask_dollars:'0.53',
  },now);
  assert.equal(snap.asset,'BTC');
  assert.equal(snap.ticker,'KXBTC15M-TEST');
  assert.equal(snap.yesAsk,.49);
  assert.equal(snap.noBid,.51);
  assert.equal(snap.timeRemainingMs,15*60_000);
  assert.equal(snap.source,'LIVE_PROVIDER_DATA');
});

test('missing live Payne feature authority is represented as UNKNOWN not fabricated',()=>{
  const p=livePayneFeatureState({ticker:'KXBTC15M-TEST'});
  assert.equal(p.available,false);
  assert.equal(p.state,'UNKNOWN / UNAVAILABLE');
  assert.equal(p.score,null);
  assert.equal(p.reason,'AUTHORITATIVE_LIVE_PAYNE_FEATURE_SOURCE_NOT_WIRED');
});

test('cockpit live data path performs GET-only balance discovery fresh lock and pre-submit reads',async()=>{
  const env=await authEnv();
  const methods=[];
  const urls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options={})=>{
    methods.push(options.method);
    urls.push(String(url));
    const u=String(url);
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[
      {exchange_index:0,balance:0},
      {exchange_index:2,balance:11.41},
      {exchange_index:3,balance:7.25},
    ]});
    if(u.includes('/markets?status=open')) return jsonResponse({
      markets:[{
        ticker:'KXBTC15M-TEST',
        series_ticker:'KXBTC15M',
        title:'Bitcoin up in next 15 minutes?',
        status:'open',
        open_time:'2026-10-02T06:00:00Z',
        close_time:'2026-10-02T06:15:00Z',
        yes_bid_dollars:'0.47',
        yes_ask_dollars:'0.49',
        no_bid_dollars:'0.51',
        no_ask_dollars:'0.53',
      }],
      cursor:'',
    });
    if(u.includes('/markets/KXBTC15M-TEST')) return jsonResponse({market:{
      ticker:'KXBTC15M-TEST',
      series_ticker:'KXBTC15M',
      title:'Bitcoin up in next 15 minutes?',
      status:'open',
      open_time:'2026-10-02T06:00:00Z',
      close_time:'2026-10-02T06:15:00Z',
      yes_bid_dollars:'0.48',
      yes_ask_dollars:'0.50',
      no_bid_dollars:'0.50',
      no_ask_dollars:'0.52',
    }});
    throw new Error('unexpected URL '+u);
  };
  try{
    const out=await buildCockpitData(env,Date.parse('2026-10-02T06:05:00Z'));
    assert.equal(out.ok,true);
    assert.equal(out.authentication,'PROVEN');
    assert.equal(out.providerGets,4);
    assert.equal(out.providerWrites,0);
    assert.equal(out.orders,0);
    assert.equal(out.capitalMovedUsd,0);
    assert.equal(out.index3.status,'READ-PROVEN AVAILABLE');
    assert.equal(out.index3.balance,7.25);
    assert.equal(out.markets[0].ticker,'KXBTC15M-TEST');
    assert.equal(out.pipeline.freshLock,'PROVEN');
    assert.equal(out.pipeline.preSubmit,'PROVEN');
    assert.equal(out.pipeline.tickerConsistent,true);
    assert.equal(out.payne.state,'UNKNOWN / UNAVAILABLE');
    assert.equal(out.pipeline.providerPost,'HARD DISABLED');
    assert.equal(out.zeroMoneyPreview,null);
    assert.equal(methods.every(x=>x==='GET'),true);
    assert.equal(urls.filter(x=>x.includes('/markets/KXBTC15M-TEST')).length,2);
  } finally {
    globalThis.fetch=original;
  }
});

test('cockpit HTML exposes one read-only page with bounded refresh and no submit controls',()=>{
  const html=cockpitHtml();
  assert.equal(COCKPIT_REFRESH_MS,60_000);
  assert.match(html,/PAYNE-KALSHI REAL COCKPIT/);
  assert.match(html,/REFRESH READS/);
  assert.match(html,/PROVIDER POST: HARD DISABLED/);
  assert.match(html,/setInterval\(load,60000\)/);
  assert.doesNotMatch(html,/PLACE ORDER/i);
  assert.doesNotMatch(html,/SUBMIT ORDER/i);
  assert.doesNotMatch(html,/method=["']post["']/i);
});

test('cockpit HTML distinguishes live provider data from derived Payne data',()=>{
  const html=cockpitHtml();
  assert.match(html,/LIVE PROVIDER DATA/);
  assert.match(html,/DERIVED PAYNE DATA/);
  assert.match(html,/ZERO-MONEY FIRE BOUNDARY/);
});
