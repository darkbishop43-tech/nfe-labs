import test from 'node:test';
import assert from 'node:assert/strict';
import {payneRealHoldEvidenceDecision as decide} from '../src/index.js';
const base={heldMs:30_000,marketPresent:true,featureAvailable:true,featureFresh:true};
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
test('five-minute max hold remains authoritative with missing features',()=>{
 assert.deepEqual(decide({...base,heldMs:300_000,featureAvailable:false,decisionLabel:'MISSING'}),{action:'EXIT',reason:'max_hold'});
});
test('provider market unknown takes existing market_missing path',()=>{
 assert.deepEqual(decide({...base,marketPresent:false,featureAvailable:false,decisionLabel:'MISSING'}),{action:'EXIT',reason:'market_missing'});
});
test('unknown holding clock cannot create unbounded hold',()=>{
 assert.deepEqual(decide({...base,heldMs:NaN,featureAvailable:false}),{action:'RECONCILE',reason:'HOLD_AGE_UNKNOWN'});
});
