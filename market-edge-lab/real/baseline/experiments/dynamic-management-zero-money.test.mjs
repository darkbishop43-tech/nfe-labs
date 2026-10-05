import assert from "node:assert/strict";
import { dynamicManagementStep, initialDynamicManagementState } from "./dynamic-management-zero-money.js";

const base={seriesId:"S1",attemptId:"A1",ticker:"TEST",asset:"BTC",direction:"UP"};

let s=initialDynamicManagementState(base);
s=dynamicManagementStep(s,{at:"T+5:00",isFiveMinuteCheckpoint:true,score:0.7,marketPrice:0.71,thesisState:"UNCHANGED",remainingMs:540000,providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,controlWouldExitAtFive:true});
assert.equal(s.state,"CONTINUE");
assert.equal(s.fiveMinuteCheckpoint.controlWouldExitAtFive,true);

s=dynamicManagementStep(s,{at:"T+8:03",score:0.64,marketPrice:0.78,thesisState:"WEAKENED",remainingMs:357000,providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,approvedDecision:"THESIS_EXIT"});
assert.equal(s.state,"EXIT_DECISION_RECORDED");
assert.equal(s.exitClass,"THESIS_EXIT");

let h=initialDynamicManagementState(base);
h=dynamicManagementStep(h,{at:"T+5:00",isFiveMinuteCheckpoint:true,score:0.74,marketPrice:0.72,thesisState:"STRENGTHENED",remainingMs:540000,providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,controlWouldExitAtFive:true});
assert.equal(h.state,"CONTINUE");
h=dynamicManagementStep(h,{at:"EXPIRY",score:0.82,marketPrice:1,thesisState:"STRENGTHENED",remainingMs:0,providerState:"OPEN",reconciliationState:"OPEN",contractIdentityOk:true,contractExpired:true});
assert.equal(h.state,"SETTLEMENT_HOLD");

let f=initialDynamicManagementState(base);
f=dynamicManagementStep(f,{at:"T+6:00",providerState:"UNKNOWN",reconciliationState:"UNKNOWN",contractIdentityOk:true});
assert.equal(f.state,"FAIL_CLOSED");

for (const x of [s,h,f]) {
  assert.equal(x.experimentAuthority,"ZERO");
  assert.equal(x.providerWrites,0);
  assert.equal(x.orders,0);
  assert.equal(x.capitalMovedUsd,0);
}

console.log(JSON.stringify({ok:true,state:"DYNAMIC_MANAGEMENT_ZERO_MONEY_PROOF",fiveMinuteDoesNotForceExit:true,laterExplicitDecisionSupported:true,settlementHoldSupported:true,failClosedSupported:true,providerWrites:0,orders:0,capitalMovedUsd:0}));
