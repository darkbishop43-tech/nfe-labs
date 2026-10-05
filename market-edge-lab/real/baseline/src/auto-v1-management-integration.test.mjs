import assert from "node:assert/strict";
import { applyAutoV1OwnedManagement, AUTO_V1_DORMANT, AUTO_V1_ACTIVE } from "./auto-v1-management-integration.js";
import { persistCompletedLifecycle, loadCompletedLifecycle } from "../experiments/dynamic-management-zero-money.js";

function owned() {
  return {
    id:"REAL-OWNED-1",attemptNo:1,marketTicker:"TEST-TICKER",asset:"BTC",outcomeSide:"YES",
    filledAt:0,fillPrice:0.60,entryScore:0.80,entryFees:0.01,filledCount:1,
    reconciliationClassification:"OPEN",matchedTicker:"TEST-TICKER",status:"OPEN"
  };
}

// Dormant equivalence: CONTROL time exit remains identical.
{
  const p=owned();
  const r=applyAutoV1OwnedManagement({env:{},position:p,seriesId:"SERIES-1",now:300000,ageMs:300000,score:0.80,bid:0.70,exitByTime:true});
  assert.equal(p.autoV1Authority,AUTO_V1_DORMANT);
  assert.equal(r.effectiveExitByTime,true);
  assert.equal(p.autoV1Management,undefined);
}

// Active path: SAME owned object crosses 5:00, records CONTROL would-exit, and continues.
let activePosition=owned();
{
  const before=activePosition;
  const r=applyAutoV1OwnedManagement({
    env:{AUTO_DYNAMIC_MANAGEMENT_V1_AUTHORITY:AUTO_V1_ACTIVE},position:activePosition,
    seriesId:"SERIES-1",now:300000,ageMs:300000,score:0.80,bid:0.72,exitByTime:true
  });
  assert.equal(activePosition,before);
  assert.equal(activePosition.id,"REAL-OWNED-1");
  assert.equal(r.effectiveExitByTime,false);
  assert.equal(r.v1State.fiveMinuteCheckpoint.controlWould,"MAX_HOLD_EXIT");
  assert.equal(r.v1State.fiveMinuteCheckpoint.experimentWould,"CONTINUE");
  assert.equal(r.v1State.state,"CONTINUE");
}

// Score <= .20 remains an exit decision; V1 does not suppress it.
{
  const r=applyAutoV1OwnedManagement({
    env:{AUTO_DYNAMIC_MANAGEMENT_V1_AUTHORITY:AUTO_V1_ACTIVE},position:activePosition,
    seriesId:"SERIES-1",now:330000,ageMs:330000,score:0.20,bid:0.40,exitByTime:true
  });
  assert.equal(r.v1State.state,"EXIT_DECISION_RECORDED");
  assert.equal(r.v1State.exitClass,"SCORE_EXIT");
}

// Evidence failure after 5m fails closed; CONTROL max-hold remains eligible.
{
  const p=owned(); p.reconciliationClassification="UNKNOWN";
  const r=applyAutoV1OwnedManagement({
    env:{AUTO_DYNAMIC_MANAGEMENT_V1_AUTHORITY:AUTO_V1_ACTIVE},position:p,
    seriesId:"SERIES-FC",now:301000,ageMs:301000,score:0.80,bid:0.70,exitByTime:true
  });
  assert.equal(r.v1State.state,"FAIL_CLOSED_TO_CONTROL");
  assert.equal(r.v1State.controlFallback.eligibleExitReason,"MAX_HOLD_EXIT");
  assert.equal(r.effectiveExitByTime,true);
}

// Additive lifecycle retention survives rolling CURRENT replacement.
{
  const map=new Map();
  const kv={put:async(k,v)=>map.set(k,v),get:async(k)=>map.get(k)??null};
  const completed={...activePosition.autoV1Management,state:"RECONCILED",actualExitReason:"SCORE_EXIT",actualHoldDurationMs:330000,realizedPnl:0.10};
  const key=await persistCompletedLifecycle(kv,completed);
  map.set("CURRENT",JSON.stringify({seriesId:"SERIES-1"}));
  map.set("CURRENT",JSON.stringify({seriesId:"SERIES-2"}));
  const archived=await loadCompletedLifecycle(kv,key);
  assert.equal(archived.completed,true);
  assert.equal(archived.evidence.seriesId,"SERIES-1");
  assert.equal(JSON.parse(map.get("CURRENT")).seriesId,"SERIES-2");
}

console.log(JSON.stringify({
  ok:true,
  integration:"ACTUAL_AUTO_MANAGE_GATE",
  dormantControlEquivalent:true,
  sameOwnedPositionCrossesFive:true,
  controlWouldMaxHoldRecorded:true,
  activeTimeOnlyExitSuppressed:true,
  scoreExitPreserved:true,
  failClosedToControl:true,
  durableRetention:true,
  providerWrites:0,
  orders:0,
  capitalMovedUsd:0
}));
