import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFounderThreshold, effectiveLockThreshold, payneStage, frozenSeriesConfig, PAYNE_CONFIG } from '../src/index.js';

test('Founder PULL selection accepts existing cockpit range and does not change Paper default', () => {
  for (const threshold of ['0.50','0.60','0.65','0.70','0.75','0.80','0.95','1.00']) {
    assert.equal(parseFounderThreshold(threshold).value, Number(threshold));
  }
  assert.equal(PAYNE_CONFIG.defaultThreshold, 0.80);
  assert.equal(effectiveLockThreshold(0.60), effectiveLockThreshold(0.80));
});
test('invalid Founder thresholds are explicitly rejected', () => {
  for (const v of ['0.49','1.01','0.701','abc','']) assert.equal(parseFounderThreshold(v).ok,false);
});
test('Founder PULL choice reaches the real decision gate while Paper LOCK stays intact', () => {
  const specimen = {score:0.75,edge:0.04,move:0.003};
  const lower=payneStage(specimen,0.70);
  const higher=payneStage(specimen,0.80);
  assert.equal(lower.pullTrigger,true);
  assert.equal(higher.pullTrigger,false);
  assert.equal(lower.effectiveLock,higher.effectiveLock);
});
test('frozen series preserves Founder threshold consistency without changing exposure rules', () => {
  const cfg={configFrozen:true,threshold:0.70,effectiveLockThreshold:effectiveLockThreshold(0.70),attemptTarget:1,maxEntryDebitUsd:1,requiredExchangeIndex:2};
  assert.equal(frozenSeriesConfig(cfg).ok,true);
  assert.equal(frozenSeriesConfig({...cfg,effectiveLockThreshold:0.70}).ok,false);
});
