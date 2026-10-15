import test from 'node:test';import assert from 'node:assert/strict';
import {firstPullbackShadow} from '../src/first-pullback-shadow.js';
test('missing evidence stays UNKNOWN and does not fabricate outcomes',()=>{
 const x=firstPullbackShadow({originalScore:0.81,originalDecision:'MISSING',actualPayneAction:'HOLD'});
 assert.equal(x.shadowManagement,'UNKNOWN');assert.equal(x.providerOutcome,null);
 assert.equal(x.payneAction,'HOLD');assert.equal(x.entrySignalDisappeared,null);
 assert.equal(x.doesNotAuthorizeExecution,true);
});
test('fresh current score below entry qualification alone never proves reversal',()=>{
 const x=firstPullbackShadow({originalScore:0.55,originalDecision:'WAIT',marketPresent:true,featureAvailable:true,featureFresh:true,actualPayneAction:'EXIT'});
 assert.equal(x.entrySignalDisappeared,true);assert.equal(x.shadowManagement,'UNKNOWN');
 assert.equal(x.payneAction,'EXIT');
});
test('explicit independently verified continuation can label pullback',()=>{
 const x=firstPullbackShadow({originalScore:0.63,originalDecision:'WAIT',marketPresent:true,featureAvailable:true,featureFresh:true,continuationEvidence:{verified:true,source:'OBSERVED_PROVIDER_HISTORY'}});
 assert.equal(x.shadowManagement,'PULLBACK');
});
test('explicit verified reversal can label reversal',()=>{
 const x=firstPullbackShadow({originalScore:0.63,originalDecision:'WAIT',marketPresent:true,featureAvailable:true,featureFresh:true,reversalEvidence:{verified:true,source:'OBSERVED_PROVIDER_HISTORY'}});
 assert.equal(x.shadowManagement,'REVERSAL');
});
test('conflicting evidence is UNKNOWN',()=>{
 const x=firstPullbackShadow({originalDecision:'WAIT',marketPresent:true,featureAvailable:true,featureFresh:true,continuationEvidence:{verified:true},reversalEvidence:{verified:true}});
 assert.equal(x.shadowManagement,'UNKNOWN');
});
test('original qualified signal alone does not count as a pullback',()=>{
 const x=firstPullbackShadow({originalDecision:'PULL TRIGGER',marketPresent:true,featureAvailable:true,featureFresh:true,continuationEvidence:{verified:true}});
 assert.equal(x.shadowManagement,'UNKNOWN');
 assert.equal(x.entrySignalDisappeared,false);
});
