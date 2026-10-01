import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { classifyIndex3, kalshiGetOnlyHeaders, kalshiReadOnlyProof } from '../src/kalshi-get-only.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

async function testEnv() {
  const pair = await crypto.subtle.generateKey(
    { name:'RSA-PSS', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' },
    true,
    ['sign','verify']
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let binary=''; for (const b of der) binary += String.fromCharCode(b);
  const base64 = btoa(binary).match(/.{1,64}/g).join('\n');
  return {
    KALSHI_EXECUTION_KEY_ID:'TEST_KEY_ID_SENTINEL',
    KALSHI_EXECUTION_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
  };
}

test('Index 3 classification is evidence-only', () => {
  assert.equal(classifyIndex3({}), 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT');
  assert.equal(classifyIndex3({balance_breakdown:[{exchange_index:0},{exchange_index:2}]}), 'READ-PROVEN UNAVAILABLE');
  assert.equal(classifyIndex3({balance_breakdown:[{exchange_index:3}]}), 'READ-PROVEN AVAILABLE');
});

test('non-GET signing methods are impossible', async () => {
  const env = await testEnv();
  await assert.rejects(
    kalshiGetOnlyHeaders(env, 'POST', '/trade-api/v2/portfolio/balance'),
    /PAYNE_KALSHI_GET_ONLY_METHOD_REQUIRED/
  );
});

test('GET signing consumes expected secret bindings without returning private key', async () => {
  const env = await testEnv();
  const headers = await kalshiGetOnlyHeaders(env, 'GET', '/trade-api/v2/portfolio/balance');
  assert.equal(headers['KALSHI-ACCESS-KEY'], env.KALSHI_EXECUTION_KEY_ID);
  assert.ok(headers['KALSHI-ACCESS-SIGNATURE']);
  assert.ok(headers['KALSHI-ACCESS-TIMESTAMP']);
  assert.equal(JSON.stringify(headers).includes(env.KALSHI_EXECUTION_PRIVATE_KEY), false);
});

test('GET-only proof performs balance, market, fresh lock, and pre-submit reads', async () => {
  const env = await testEnv();
  const calls=[];
  const fetchImpl = async (url, options) => {
    calls.push({url,method:options?.method});
    assert.equal(options?.method, 'GET');
    if (url.includes('/portfolio/balance')) {
      return {ok:true,status:200,json:async()=>({balance_breakdown:[{exchange_index:0},{exchange_index:2}]})};
    }
    if (url.includes('/markets?')) {
      return {ok:true,status:200,json:async()=>({markets:[{ticker:'KXTEST-1'}]})};
    }
    return {ok:true,status:200,json:async()=>({ticker:'KXTEST-1'})};
  };
  const out = await kalshiReadOnlyProof(env, fetchImpl);
  assert.equal(out.ok,true);
  assert.equal(out.authentication,'PROVEN');
  assert.equal(out.authenticatedGet,'PROVEN');
  assert.equal(out.providerGets,4);
  assert.equal(out.accountBalanceGet,'PROVEN');
  assert.equal(out.liveMarketGet,'PROVEN');
  assert.equal(out.freshLockGet,'PROVEN');
  assert.equal(out.preSubmitGet,'PROVEN');
  assert.equal(out.index3,'READ-PROVEN UNAVAILABLE');
  assert.equal(out.providerWrites,0);
  assert.equal(out.secretsExposed,false);
  assert.equal(calls.every(c=>c.method==='GET'),true);
});

test('proof failure suppresses secret material', async () => {
  const env = await testEnv();
  const out = await kalshiReadOnlyProof(env, async () => { throw new Error('provider failure'); });
  const text = JSON.stringify(out);
  assert.equal(out.ok,false);
  assert.equal(out.secretsExposed,false);
  assert.equal(text.includes(env.KALSHI_EXECUTION_KEY_ID),false);
  assert.equal(text.includes(env.KALSHI_EXECUTION_PRIVATE_KEY),false);
});
