import test from 'node:test';
import assert from 'node:assert/strict';
import {payneStage,payneFeatureBoundaryEvidence,kalshiCandidateTimeSafe,estimateKalshiFeeSafeSize,payneRealHoldEvidenceDecision} from '../src/index.js';
const strong={available:true,score:0.70,edge:0.05,move:0.003,fair:0.75};
test('authoritative qualified score X crosses LOCK and PULL without hardcoded selected score',()=>{
  const d=payneStage(strong,0.65);
  assert.equal(d.radar,true);assert.equal(d.lockIn,true);assert.equal(d.pullTrigger,true);
  const evidence=payneFeatureBoundaryEvidence(strong,0.65,null,'LOCK');
  assert.equal(evidence.lock,'PASS');assert.equal(evidence.pull,'PASS');
});
test('sub-threshold candidate cannot pass LOCK or PULL',()=>{
  const d=payneStage({...strong,score:0.64,edge:0.035},0.65);
  assert.equal(d.lockIn,false);assert.equal(d.pullTrigger,false);
});
test('qualified score with insufficient movement cannot pass PULL',()=>{
  const d=payneStage({...strong,move:0.001},0.65);
  assert.equal(d.lockIn,true);assert.equal(d.pullTrigger,false);
});
test('Founder threshold remains variable and controls PULL',()=>{
  assert.equal(payneStage(strong,0.65).pullTrigger,true);
  assert.equal(payneStage(strong,0.80).pullTrigger,false);
});
test('last 60 seconds blocked and 61 seconds allowed',()=>{
  const now=Date.parse('2026-10-18T07:00:00Z');
  assert.equal(kalshiCandidateTimeSafe({closeTime:new Date(now+61000).toISOString()},now),true);
  assert.equal(kalshiCandidateTimeSafe({closeTime:new Date(now+60000).toISOString()},now),false);
});
test('five-minute max hold supersedes continuing qualified signal',()=>{
  const now=Date.parse('2026-10-18T07:00:00Z');
  const p={heldMs:300000,marketPresent:true,marketStatus:'active',contractCloseTime:new Date(now+120000).toISOString(),nowMs:now,featureAvailable:true,featureFresh:true,decisionLabel:'PULL TRIGGER'};
  assert.deepEqual(payneRealHoldEvidenceDecision(p),{action:'EXIT',reason:'max_hold'});
  assert.equal(payneRealHoldEvidenceDecision({...p,marketStatus:'closed'}).action,'RECONCILE');
});
