import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYNE_PAPER_RULES,
  PAYNE_PAPER_SOURCE,
  paperMove,
  paperFeatureMath,
  paperDecision,
  paperRankCandidates,
  paperCandidateKey,
  paperCooldownActive,
  paperManagementDecision,
} from '../src/payne-paper-brain.js';

test('promotion source lineage is frozen to recovered Paper executor and collector',()=>{
  assert.equal(PAYNE_PAPER_SOURCE.executorCommit,'23f7855a7c270c96a7f14ad9f7852ac3462fcf75');
  assert.equal(PAYNE_PAPER_SOURCE.executorBlob,'6db7cde1231cd20d15837474b360f7b370b07b3d');
  assert.equal(PAYNE_PAPER_SOURCE.collectorBlob,'9c49d2d6d7c9856ca923f767761c54d535666f69');
});

test('Paper constants reproduce source-proven strategy values',()=>{
  assert.deepEqual(PAYNE_PAPER_RULES.sourceAssets,['BTC','ETH']);
  assert.equal(PAYNE_PAPER_RULES.radarScore,.50);
  assert.equal(PAYNE_PAPER_RULES.lockScore,.65);
  assert.equal(PAYNE_PAPER_RULES.pullScore,.80);
  assert.equal(PAYNE_PAPER_RULES.minAbsMove,.002);
  assert.equal(PAYNE_PAPER_RULES.maxHoldMs,300000);
  assert.equal(PAYNE_PAPER_RULES.cooldownMs,300000);
  assert.equal(PAYNE_PAPER_RULES.sourceCadenceMs,300000);
});

test('Paper move is current versus prior collector price',()=>{
  assert.equal(paperMove(101,100),.01);
  assert.equal(paperMove(99,100),-.01);
  assert.equal(paperMove(100,0),0);
});

test('Paper ABOVE feature formula reproduces directional move fair edge score',()=>{
  const x=paperFeatureMath({marketPrice:.50,move:.01,direction:'ABOVE'});
  assert.equal(x.directionalMove,.01);
  assert.equal(x.fair,.68);
  assert.equal(x.edge,.18);
  assert.equal(x.score,1);
});

test('Paper BELOW feature formula reverses move without fabricating market price',()=>{
  const x=paperFeatureMath({marketPrice:.40,move:.01,direction:'BELOW'});
  assert.equal(x.directionalMove,-.01);
  assert.equal(x.fair,.22);
  assert.equal(x.edge,-.18);
  assert.ok(Math.abs(x.score-0)<1e-12);
});

test('Paper feature formula clamps fair and score exactly',()=>{
  const hi=paperFeatureMath({marketPrice:.95,move:.10,direction:'ABOVE'});
  const lo=paperFeatureMath({marketPrice:.05,move:.10,direction:'BELOW'});
  assert.equal(hi.fair,.98);
  assert.equal(hi.score,.62);
  assert.equal(lo.fair,.02);
  assert.equal(lo.score,.38);
});

test('Paper decision chain is RADAR .50 LOCK .65 edge positive PULL .80 move .002',()=>{
  assert.equal(paperDecision({score:.49,edge:.2,move:.01}).label,'PASS');
  assert.equal(paperDecision({score:.50,edge:.2,move:.01}).label,'RADAR');
  assert.equal(paperDecision({score:.65,edge:0,move:.01}).label,'RADAR');
  assert.equal(paperDecision({score:.65,edge:.01,move:.01}).label,'LOCK IN');
  assert.equal(paperDecision({score:.79,edge:.01,move:.01}).label,'LOCK IN');
  assert.equal(paperDecision({score:.80,edge:.01,move:.0019}).label,'LOCK IN');
  assert.equal(paperDecision({score:.80,edge:.01,move:.002}).label,'PULL TRIGGER');
});

test('Paper ranking is score descending then edge descending',()=>{
  const rows=[
    {ticker:'A',payne:{score:.80,edge:.03}},
    {ticker:'B',payne:{score:.90,edge:.01}},
    {ticker:'C',payne:{score:.80,edge:.05}},
  ];
  assert.deepEqual(paperRankCandidates(rows).map(x=>x.ticker),['B','C','A']);
});

test('Paper candidate identity is exact ticker outcome direction',()=>{
  assert.equal(paperCandidateKey({ticker:'KXBTC15M-X',outcomeSide:'YES',direction:'UP'}),'KXBTC15M-X:YES:UP');
  assert.equal(paperCandidateKey({marketTicker:'KXBTC15M-X',outcomeSide:'NO',direction:'DOWN'}),'KXBTC15M-X:NO:DOWN');
});

test('Paper cooldown is exact five minutes after exit',()=>{
  const exit='2026-10-07T12:00:00.000Z';
  assert.equal(paperCooldownActive(exit,Date.parse('2026-10-07T12:04:59.999Z')),true);
  assert.equal(paperCooldownActive(exit,Date.parse('2026-10-07T12:05:00.000Z')),false);
});

test('Paper management precedence is max_hold then market_missing then decision_exit then HOLD',()=>{
  assert.deepEqual(
    paperManagementDecision({heldMs:300000,marketPresent:false,decisionLabel:'RADAR',owned:true}),
    {action:'EXIT',reason:'max_hold'}
  );
  assert.deepEqual(
    paperManagementDecision({heldMs:1000,marketPresent:false,decisionLabel:'PULL TRIGGER',owned:true}),
    {action:'EXIT',reason:'market_missing'}
  );
  assert.deepEqual(
    paperManagementDecision({heldMs:1000,marketPresent:true,decisionLabel:'LOCK IN',owned:true}),
    {action:'EXIT',reason:'decision_exit'}
  );
  assert.deepEqual(
    paperManagementDecision({heldMs:1000,marketPresent:true,decisionLabel:'PULL TRIGGER',owned:true}),
    {action:'HOLD',reason:'PULL_TRIGGER_REMAINS_QUALIFIED'}
  );
});

test('Paper brain contains no provider or capital authority surface',()=>{
  for(const fn of [paperMove,paperFeatureMath,paperDecision,paperRankCandidates,paperCandidateKey,paperCooldownActive,paperManagementDecision]){
    const source=String(fn);
    assert.doesNotMatch(source,/fetch\s*\(/);
    assert.doesNotMatch(source,/KALSHI_EXECUTION_PRIVATE_KEY/);
    assert.doesNotMatch(source,/portfolio\/events\/orders/);
  }
});
