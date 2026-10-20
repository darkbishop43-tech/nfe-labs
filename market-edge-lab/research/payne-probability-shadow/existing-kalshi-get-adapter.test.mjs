import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {existingAuthenticatedMarketGet,collectUsingExistingKalshiGet} from './existing-kalshi-get-adapter.mjs';
test('rejects all non-market and write-capable paths before provider access',async()=>{
 let requests=0;
 const get=existingAuthenticatedMarketGet({}, {fetchImpl:async()=>{requests++;throw Error('NETWORK_CALLED')}});
 for(const path of ['/trade-api/v2/portfolio/orders','/trade-api/v2/markets/X/orders','/trade-api/v2/markets/../../orders']){
   await assert.rejects(()=>get(path),/RESEARCH_GET_PATH_REJECTED/);
 }
 assert.equal(requests,0);
});
test('missing existing credentials fails closed without contacting provider',async()=>{
 let network=0;
 const result=await collectUsingExistingKalshiGet({env:{},seriesTickers:['KXBTC15M'],fetchImpl:async()=>{network++;throw Error('NETWORK_CALLED')}});
 assert.equal(network,0);assert.equal(result.records[0].status,'UNKNOWN');assert.equal(result.coverage.complete,0);
});
test('reuses existing RSA-signed GET transport with mocked local provider only',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const env={KALSHI_EXECUTION_KEY_ID:'OFFLINE_TEST_ONLY',KALSHI_EXECUTION_PRIVATE_KEY:keys.privateKey};
 let calls=0;
 const fetchImpl=async (url,options)=>{
   calls++;assert.equal(options.method,'GET');assert.ok(url.startsWith('https://external-api.kalshi.com/trade-api/v2/markets'));
   assert.equal(options.headers['KALSHI-ACCESS-KEY'],'OFFLINE_TEST_ONLY');
   const body=url.includes('/orderbook')?{orderbook:{yes:[[0.3,5]],no:[[0.4,3]]}}:
      url.includes('series_ticker=')?{markets:[{ticker:'KXBTC15M-EXAMPLE'}]}:
      {market:{rules_primary:'Mock-only settlement terms',volume:3,expiration_time:'2026-10-20T12:15:00Z'}};
   return {ok:true,status:200,json:async()=>body};
 };
 const out=await collectUsingExistingKalshiGet({env,fetchImpl,seriesTickers:['KXBTC15M'],now:()=> '2026-10-20T12:00:00Z'});
 assert.equal(calls,3);assert.equal(out.records.length,2);assert.equal(out.coverage.complete,0);
 assert.equal(out.records[0].probability.pWin,null);
});
