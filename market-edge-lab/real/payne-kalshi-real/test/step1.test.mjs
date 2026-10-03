import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYNE_CONFIG, defaultControlState, payneStage, initializeDisarmed, loadControl,
  evaluateZeroMoneyCandidate, reconcileFixture, managementDecision, fundingGate,
  persistRun, persistAttempt, persistPosition, listEvents, recordManagementObservation,
  recordReconciliationEvidence, step1Status
} from '../src/index.js';

class MemoryKV {
  constructor(store = new Map()) { this.store = store; }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async list({prefix='' }={}) { return { keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})) }; }
}
const env = (store = new Map()) => ({ PAYNE_KALSHI_STATE:new MemoryKV(store) });
const futureClose = (minutes=15)=>new Date(Date.now()+minutes*60_000).toISOString();
const qualifying = () => ({ marketTicker:'KXTEST-1', asset:'BTC', direction:'UP', score:.72, edge:.04, move:.003, executionEligible:true, closeTime:futureClose(), observedPrice:.61 });

test('default state is disarmed and zero authority', ()=>{
  const s=defaultControlState();
  assert.equal(s.armed,false); assert.equal(s.attempts,0); assert.equal(s.openPositions,0);
  assert.equal(s.providerWriteAuthority,'BUILT_INACTIVE_DISARMED'); assert.equal(s.realExecution,'BUILT_INACTIVE_DISARMED'); assert.equal(s.fundingAuthority,'INDEX3_ONLY_INACTIVE_DISARMED'); assert.equal(s.requiredExchangeIndex,3); assert.equal(s.attemptTarget,1); assert.equal(s.maxEntryDebitUsd,1);
});

test('Payne gate fixtures deterministic', ()=>{
  assert.equal(payneStage({score:.49,edge:.1,move:.01}).stage,'NO_ACTION');
  assert.equal(payneStage({score:.50,edge:.1,move:.01}).stage,'RADAR');
  assert.equal(payneStage({score:.65,edge:.01,move:.001}).stage,'LOCK_IN');
  assert.equal(payneStage({score:.70,edge:.01,move:.002},.70).stage,'PULL_TRIGGER');
  assert.equal(payneStage({score:.70,edge:0,move:.01},.70).pullTrigger,false);
});

test('qualifying candidate reaches fresh lock twice then stops before POST', async ()=>{
  const e=env(); await initializeDisarmed(e); let gets=0;
  const providerGet=async ticker=>{ gets++; return {ok:true,marketTicker:ticker,yesAsk:.60,yesBid:.59,noAsk:.41,noBid:.40}; };
  const out=await evaluateZeroMoneyCandidate(e,qualifying(),{providerGet});
  assert.equal(out.gate.stage,'PULL_TRIGGER'); assert.equal(gets,2); assert.equal(out.stopReason,'STEP1_PROVIDER_POST_HARD_DISABLED'); assert.equal(out.fired,false);
  assert.equal(out.funding.failClosed,true); assert.equal(out.funding.authorityDisabled,true); assert.equal(out.funding.indexUnproven,false);
});

test('non-pull candidate cannot reach provider GET or fire', async ()=>{
  const e=env(); await initializeDisarmed(e); let gets=0;
  const c={...qualifying(),score:.69};
  const out=await evaluateZeroMoneyCandidate(e,c,{providerGet:async()=>{gets++; return {ok:true};}});
  assert.equal(gets,0); assert.equal(out.fired,false); assert.equal(out.stopReason,'NON_PULL_CANDIDATE');
});

test('real eligibility/time gate blocks unsafe candidate before provider read', async ()=>{
  const e=env(); await initializeDisarmed(e); let gets=0;
  const c={...qualifying(),closeTime:futureClose(5)};
  const out=await evaluateZeroMoneyCandidate(e,c,{providerGet:async()=>{gets++; return {ok:true};}});
  assert.equal(gets,0); assert.equal(out.stopReason,'REAL_ELIGIBILITY_GATE'); assert.equal(out.eligibility.timeSafe,false);
});

test('funding gate remains fail-closed in Step 1', ()=>{
  const f=fundingGate(defaultControlState());
  assert.equal(f.ok,false); assert.equal(f.failClosed,true); assert.equal(f.authorityDisabled,true); assert.equal(f.indexUnproven,false);
});

test('OPEN / FLAT / UNKNOWN reconciliation fixtures', ()=>{
  assert.equal(reconcileFixture({providerContextComplete:false,ownedPosition:false}),'UNKNOWN');
  assert.equal(reconcileFixture({providerContextComplete:true,ownedPosition:true}),'OPEN');
  assert.equal(reconcileFixture({providerContextComplete:true,ownedPosition:false,settlementEvidence:true}),'FLAT');
});

test('.20 score exit and 5-minute max hold fixtures', ()=>{
  assert.deepEqual(managementDecision({score:.20,heldMs:10_000,owned:true}),{action:'EXIT',reason:'SCORE_EXIT'});
  assert.deepEqual(managementDecision({score:.60,heldMs:300_000,owned:true}),{action:'EXIT',reason:'MAX_HOLD_EXIT'});
  assert.equal(managementDecision({score:.60,heldMs:299_999,owned:true}).action,'HOLD');
});

test('durable event ledger survives reload and is not rolling-state-only', async ()=>{
  const store=new Map(); const e1=env(store); await initializeDisarmed(e1);
  await persistRun(e1,{runId:'r1',status:'ZERO_MONEY'});
  await persistAttempt(e1,{runId:'r1',attemptId:'a1',attemptNo:1,ticker:'KXTEST-1',asset:'BTC',direction:'UP',payneScore:.72,payneEdge:.04,payneMove:.003,payneStage:'PULL_TRIGGER',payneThreshold:.70,result:'ZERO_MONEY'});
  await persistPosition(e1,{positionId:'p1',status:'FIXTURE_ONLY',position_fp:'fp1'});
  await recordManagementObservation(e1,{positionId:'p1',score:.6,heldMs:1000});
  await recordReconciliationEvidence(e1,{positionId:'p1',state:'OPEN',position_fp:'fp1'});
  const before=await listEvents(e1);
  const e2=env(store); const after=await listEvents(e2); const control=await loadControl(e2);
  assert.equal(after.length,before.length); assert.ok(after.length>=6); assert.equal(control.armed,false);
  assert.ok([...store.keys()].some(k=>k.startsWith('payne-kalshi:attempt:')));
  assert.ok([...store.keys()].some(k=>k.startsWith('payne-kalshi:event:')));
});

test('no forbidden baseline or Payne Paper keys are used', async ()=>{
  const store=new Map(); const e=env(store); await initializeDisarmed(e);
  await evaluateZeroMoneyCandidate(e,{...qualifying(),score:.60},{providerGet:async()=>{throw new Error('should not read');}});
  for (const k of store.keys()) {
    assert.notEqual(k,'baseline-real-execution-test-v1'); assert.notEqual(k,'state:payne_method'); assert.notEqual(k,'control:paper_threshold:payne_method');
    assert.ok(k.startsWith('payne-kalshi:'));
  }
});

test('status freezes Step 1 authority', ()=>{
  const s=step1Status(); assert.equal(PAYNE_CONFIG.providerWritesEnabled,false); assert.equal(PAYNE_CONFIG.realExecutionEnabled,false);
  assert.equal(PAYNE_CONFIG.realCapabilityBuilt,true); assert.equal(s.providerWrites,0); assert.equal(s.requiredExchangeIndex,3); assert.equal(s.index3,'READ_REQUIRED_BEFORE_ENTRY'); assert.equal(s.secondIoc,'HOLD_UNCHANGED');
});
