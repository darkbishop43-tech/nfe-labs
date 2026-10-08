import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFounderThreshold,effectiveLockThreshold,payneStage} from '../src/index.js';
import {PAYNE_PAPER_RULES,paperDecision,paperFeatureMath} from '../src/payne-paper-brain.js';

test('approved real-experiment PULL thresholds are accepted',()=>{
  for(const value of ['0.60','0.70','0.80']){
    assert.equal(parseFounderThreshold(value).ok,true,value);
    assert.equal(parseFounderThreshold(value).value,Number(value));
  }
});
test('unapproved or malformed thresholds fail closed',()=>{
  for(const value of ['0.50','0.65','0.75','0.90','1.00','0.601','abc','','NaN','Infinity','-0.60']){
    assert.equal(parseFounderThreshold(value).ok,false,value);
  }
});
test('LOCK stays at Paper 0.65 regardless of Founder PULL threshold',()=>{
  assert.equal(PAYNE_PAPER_RULES.lockScore,0.65);
  for(const value of [0.60,0.70,0.80]) assert.equal(effectiveLockThreshold(value),0.65);
  assert.equal(paperDecision({score:0.62,edge:0.03,move:0.003,threshold:0.60}).trigger,false);
  assert.equal(paperDecision({score:0.66,edge:0.03,move:0.003,threshold:0.60}).trigger,true);
  assert.equal(paperDecision({score:0.66,edge:0.03,move:0.003,threshold:0.70}).trigger,false);
  assert.equal(paperDecision({score:0.71,edge:0.03,move:0.003,threshold:0.70}).trigger,true);
  assert.equal(paperDecision({score:0.79,edge:0.03,move:0.003,threshold:0.80}).trigger,false);
});
test('positive edge and minimum MOVE remain mandatory',()=>{
  assert.equal(paperDecision({score:0.9,edge:0,move:0.003,threshold:0.60}).trigger,false);
  assert.equal(paperDecision({score:0.9,edge:0.1,move:0.001,threshold:0.60}).trigger,false);
  assert.equal(PAYNE_PAPER_RULES.minAbsMove,0.002);
});
test('Paper math and original default PULL unchanged',()=>{
  assert.equal(PAYNE_PAPER_RULES.pullScore,0.80);
  const f=paperFeatureMath({marketPrice:0.5,move:0.01,direction:'ABOVE'});
  assert.equal(f.fair,0.68);
  assert.ok(Math.abs(f.edge-0.18)<1e-10);
  assert.equal(f.score,1);
  assert.equal(paperDecision({score:0.79,edge:0.1,move:0.003}).trigger,false);
});
