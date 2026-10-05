import assert from "node:assert/strict";
import {
  CONTROL_EXIT_SCORE,
  CONTROL_MAX_HOLD_MS,
  archiveKeyFor,
  dynamicManagementStep,
  finalizeExperimentalExit,
  initialDynamicManagementState,
  loadCompletedLifecycle,
  persistCompletedLifecycle,
} from "./dynamic-management-zero-money.js";

class MockKV {
  constructor(){ this.map=new Map(); }
  async put(k,v){ this.map.set(k,v); }
  async get(k){ return this.map.has(k) ? this.map.get(k) : null; }
}

const identity={
  seriesId:"SERIES-1",attemptId:"ATTEMPT-1",ticker:"TEST-TICKER",
  asset:"BTC",direction:"UP",side:"YES",entryAt:"T0",entryPrice:0.60,
  entryScore:0.80,entryFees:0.01,quantity:1
};

assert.equal(CONTROL_EXIT_SCORE,0.20);
assert.equal(CONTROL_MAX_HOLD_MS,300000);

// > .20 survives the 5-minute checkpoint in experiment.
let s=initialDynamicManagementState(identity);
s=dynamicManagementStep(s,{
  at:"T+5:00",ageMs:300000,isFiveMinuteCheckpoint:true,score:0.70,
  bid:0.72,ask:0.73,thesisState:"UNCHANGED",providerState:"OPEN",
  reconciliationState:"OPEN",contractIdentityOk:true,sideIdentityOk:true,
  requiredManagementEvidenceAvailable:true
});
assert.equal(s.state,"CONTINUE");
assert.equal(s.fiveMinuteCheckpoint.controlWould,"MAX_HOLD_EXIT");
assert.equal(s.fiveMinuteCheckpoint.experimentWould,"CONTINUE");

// Existing .20 score exit remains authoritative after five minutes.
s=dynamicManagementStep(s,{
  at:"T+7:00",ageMs:420000,score:0.20,bid:0.48,ask:0.49,
  thesisState:"INVALIDATED",providerState:"OPEN",reconciliationState:"OPEN",
  contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:true
});
assert.equal(s.state,"EXIT_DECISION_RECORDED");
assert.equal(s.exitClass,"SCORE_EXIT");

// MFE / MAE observations.
let e=initialDynamicManagementState(identity);
e=dynamicManagementStep(e,{at:"T+2",ageMs:120000,score:0.81,bid:0.80,ask:0.81,thesisState:"STRENGTHENED",providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:true});
e=dynamicManagementStep(e,{at:"T+4",ageMs:240000,score:0.75,bid:0.50,ask:0.51,thesisState:"WEAKENED",providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:true});
assert.equal(e.mfe,0.20);
assert.equal(e.mae,-0.10);
assert.equal(e.mfeAt,"T+2");
assert.equal(e.maeAt,"T+4");

// No economic-exit authority: favorable economics do not exit.
e=dynamicManagementStep(e,{at:"T+6",ageMs:360000,score:0.90,bid:0.95,ask:0.96,thesisState:"STRENGTHENED",providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:true});
assert.equal(e.state,"CONTINUE");
assert.equal(e.exitClass,undefined);

// Settlement path.
e=dynamicManagementStep(e,{at:"EXPIRY",ageMs:800000,score:0.88,bid:1,ask:1,thesisState:"STRENGTHENED",providerState:"OPEN",reconciliationState:"SETTLED",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:true,contractExpired:true,settlementValue:1,realizedPnl:0.39});
assert.equal(e.state,"SETTLEMENT_HOLD");
assert.equal(e.settlementValue,1);
assert.equal(e.realizedPnl,0.39);

// Fail closed BEFORE five minutes returns to control without inventing an exit.
let f1=initialDynamicManagementState(identity);
f1=dynamicManagementStep(f1,{at:"T+3",ageMs:180000,score:0.65,bid:0.61,ask:0.62,thesisState:"UNKNOWN",providerState:"UNKNOWN",reconciliationState:"UNKNOWN",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:false});
assert.equal(f1.state,"FAIL_CLOSED_TO_CONTROL");
assert.equal(f1.controlFallback.maxHoldSatisfied,false);
assert.equal(f1.controlFallback.behavior,"CONTROL_MANAGEMENT_RESUMES");
assert.equal(f1.controlFallback.eligibleExitReason,null);

// Fail closed AFTER five minutes returns to control where MAX_HOLD is already satisfied.
let f2=initialDynamicManagementState(identity);
f2=dynamicManagementStep(f2,{at:"T+6",ageMs:360000,score:0.65,bid:0.61,ask:0.62,thesisState:"UNKNOWN",providerState:"UNKNOWN",reconciliationState:"UNKNOWN",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:false});
assert.equal(f2.state,"FAIL_CLOSED_TO_CONTROL");
assert.equal(f2.controlFallback.maxHoldSatisfied,true);
assert.equal(f2.controlFallback.eligibleExitReason,"MAX_HOLD_EXIT");
assert.equal(f2.controlFallback.behavior,"CONTROL_GOVERNED_EXIT_ELIGIBLE");

// Durable lifecycle survives rolling/current-series replacement.
const kv=new MockKV();
let complete=finalizeExperimentalExit(e,{exitOrderAt:null,exitOrderId:null,exitFillAt:null,exitFillPrice:null,exitFees:0,exitUnfilled:false,settlementValue:1,realizedPnl:0.39,reconciliationPath:["SETTLED","RECONCILED"]});
const key=archiveKeyFor(complete);
await persistCompletedLifecycle(kv,complete);

// Simulate rolling current state being replaced by a later series.
let current=initialDynamicManagementState({...identity,seriesId:"SERIES-2",attemptId:"ATTEMPT-1"});
current=dynamicManagementStep(current,{at:"NEW-T+1",ageMs:60000,score:0.77,bid:0.70,ask:0.71,thesisState:"UNCHANGED",providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,sideIdentityOk:true,requiredManagementEvidenceAvailable:true});
assert.equal(current.seriesId,"SERIES-2");

const recovered=await loadCompletedLifecycle(kv,key);
assert.equal(recovered.completed,true);
assert.equal(recovered.evidence.seriesId,"SERIES-1");
assert.equal(recovered.evidence.fiveMinuteCheckpoint?.controlWould ?? "MAX_HOLD_EXIT","MAX_HOLD_EXIT");
assert.equal(recovered.evidence.mfe,0.40);
assert.equal(recovered.evidence.mae,-0.10);
assert.equal(recovered.evidence.settlementValue,1);
assert.equal(recovered.evidence.realizedPnl,0.39);
assert.deepEqual(recovered.evidence.reconciliationPath,["SETTLED","SETTLED","RECONCILED"]);

for (const x of [s,e,f1,f2,complete,current]) {
  assert.equal(x.experimentAuthority,"ZERO");
  assert.equal(x.providerWrites,0);
  assert.equal(x.orders,0);
  assert.equal(x.capitalMovedUsd,0);
}

console.log(JSON.stringify({
  ok:true,
  state:"AUTO_EXPERIMENT_V1_ZERO_MONEY_RETENTION_PROOF",
  scoreExitPreserved:true,
  beyondFiveContinue:true,
  economicExitAuthority:false,
  mfeMaeObserved:true,
  settlementSupported:true,
  failClosedBeforeFive:"CONTROL_MANAGEMENT_RESUMES",
  failClosedAfterFive:"MAX_HOLD_EXIT_ELIGIBLE",
  completedLifecycleSurvivesLaterSeriesReplacement:true,
  providerWrites:0,
  orders:0,
  capitalMovedUsd:0
}));
