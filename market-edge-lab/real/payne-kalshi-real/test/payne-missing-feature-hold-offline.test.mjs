import test from 'node:test';
import assert from 'node:assert/strict';
import {payneRealHoldEvidenceDecision as decide} from '../src/index.js';
const base={heldMs:30_000,marketPresent:true,marketStatus:'active',contractCloseTime:'2026-10-15T00:20:00Z',nowMs:Date.parse('2026-10-15T00:10:00Z'),featureAvailable:true,featureFresh:true};
test('valid fresh PULL failure exits as decision_exit',()=>{
 assert.deepEqual(decide({...base,decisionLabel:'RADAR'}),{action:'EXIT',reason:'decision_exit'});
});
test('valid fresh PULL continuation holds',()=>{
 assert.deepEqual(decide({...base,decisionLabel:'PULL TRIGGER'}),{action:'HOLD',reason:'PULL_TRIGGER_REMAINS_QUALIFIED'});
});
test('unavailable features do not masquerade as strategy failure',()=>{
 assert.deepEqual(decide({...base,featureAvailable:false,decisionLabel:'MISSING'}),{action:'HOLD',reason:'FEATURE_UNAVAILABLE'});
});
test('stale features do not masquerade as strategy failure',()=>{
 assert.deepEqual(decide({...base,featureAvailable:false,featureFresh:false,decisionLabel:'MISSING'}),{action:'HOLD',reason:'FEATURE_STALE'});
});
test('five minutes triggers max hold exit even if features unavailable',()=>{
 assert.deepEqual(decide({...base,heldMs:300_000,featureAvailable:false,decisionLabel:'MISSING'}),{action:'EXIT',reason:'max_hold'});
});
test('provider market unknown takes existing market_missing path',()=>{
 assert.deepEqual(decide({...base,marketPresent:false,featureAvailable:false,decisionLabel:'MISSING'}),{action:'RECONCILE',reason:'PROVIDER_MARKET_UNKNOWN'});
});
test('unknown holding clock cannot create unbounded hold',()=>{
 assert.deepEqual(decide({...base,heldMs:NaN,featureAvailable:false}),{action:'RECONCILE',reason:'HOLD_CLOCK_UNKNOWN'});
});

test('two minute hold is eligible but seven and twelve minutes exceed max hold',()=>{
 for(const minutes of [2,7,12]) {
  assert.deepEqual(decide({...base,heldMs:minutes*60_000,decisionLabel:'PULL TRIGGER'}),minutes<5?{action:'HOLD',reason:'PULL_TRIGGER_REMAINS_QUALIFIED'}:{action:'EXIT',reason:'max_hold'});
 }
});
test('contract closure is reconciliation not synthetic provider exit',()=>{
 assert.deepEqual(decide({...base,marketStatus:'closed'}),{action:'RECONCILE',reason:'PROVIDER_CONTRACT_CLOSED'});
 assert.deepEqual(decide({...base,nowMs:Date.parse('2026-10-15T00:20:00Z')}),{action:'RECONCILE',reason:'PROVIDER_CONTRACT_CLOSED'});
});
test('unknown market status and unknown provider close deadline cannot hold without bounds',()=>{
 assert.deepEqual(decide({...base,marketStatus:'unknown'}),{action:'RECONCILE',reason:'PROVIDER_MARKET_STATUS_UNKNOWN'});
 assert.deepEqual(decide({...base,contractCloseTime:null}),{action:'RECONCILE',reason:'PROVIDER_CLOSE_TIME_UNKNOWN'});
});
