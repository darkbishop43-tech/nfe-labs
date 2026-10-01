import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIndex3, kalshiGetOnlyHeaders, kalshiReadOnlyProof } from '../src/kalshi-get-only.js';

const secretEnv = {
  KALSHI_EXECUTION_KEY_ID: 'TEST_KEY_ID_SENTINEL',
  KALSHI_EXECUTION_PRIVATE_KEY: 'TEST_PRIVATE_KEY_SENTINEL',
};

test('Index 3 classification is evidence-only', () => {
  assert.equal(classifyIndex3({}), 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT');
  assert.equal(classifyIndex3({balance_breakdown:[{exchange_index:0},{exchange_index:2}]}), 'READ-PROVEN UNAVAILABLE');
  assert.equal(classifyIndex3({balance_breakdown:[{exchange_index:3}]}), 'READ-PROVEN AVAILABLE');
});

test('non-GET signing methods are rejected before credential use', async () => {
  await assert.rejects(
    kalshiGetOnlyHeaders(secretEnv, 'POST', '/trade-api/v2/portfolio/balance'),
    /PAYNE_KALSHI_GET_ONLY_METHOD_REQUIRED/
  );
});

test('proof failure never exposes secret values', async () => {
  const out = await kalshiReadOnlyProof(secretEnv, async () => { throw new Error('provider failure'); });
  const text = JSON.stringify(out);
  assert.equal(out.ok, false);
  assert.equal(out.secretsExposed, false);
  assert.equal(text.includes(secretEnv.KALSHI_EXECUTION_KEY_ID), false);
  assert.equal(text.includes(secretEnv.KALSHI_EXECUTION_PRIVATE_KEY), false);
});

test('proof response classifies balance_breakdown without exposing provider secrets', async () => {
  const fakeEnv = {};
  const fakeResponse = {
    ok:true,
    status:200,
    async json(){ return { balance_breakdown:[{exchange_index:0,balance:100},{exchange_index:2,balance:50}] }; }
  };
  const out = await kalshiReadOnlyProof(fakeEnv, async () => fakeResponse);
  assert.equal(out.ok, false);
  assert.equal(out.index3, 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT');
  assert.equal(out.secretsExposed, false);
});
