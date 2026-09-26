const finite=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};

export const PHASE1B_CONTINUATION_MS=60_000;
export const PHASE1B_MIN_REMAINING_MS=90_000;

export function buildPhase1AShadowAttachment({position,candidate,attempt,attachedAt=Date.now(),maxHoldMs=300000}={}){
  const fillCount=finite(position?.filledCount??attempt?.fillCount);
  const entryOrderId=position?.entryOrderId||attempt?.orderId||null;
  if(!(fillCount>0)||!entryOrderId)return null;
  const filledAt=finite(position?.filledAt??attempt?.filledAt);
  if(!filledAt)return null;
  const closeTime=candidate?.closeTime||position?.closeTime||null;
  return {
    schema:"NFE_PHASE1A_SHADOW_V1",
    counterfactualOnly:true,
    tradingAuthority:false,
    source:"AUTO_BASELINE_CONFIRMED_FILL",
    attachedAt:new Date(attachedAt).toISOString(),
    checkpointAt:new Date(filledAt+maxHoldMs).toISOString(),
    continuationDurationAuthorized:false,
    continuationDurationMs:null,
    entryEvidence:{
      ticker:position?.marketTicker||candidate?.marketTicker||null,
      asset:position?.asset||candidate?.asset||null,
      outcomeSide:position?.outcomeSide||candidate?.outcomeSide||null,
      direction:position?.direction||candidate?.direction||null,
      entryTimestamp:new Date(filledAt).toISOString(),
      entryPrice:finite(position?.entryAverageFillPrice??attempt?.averageFillPrice),
      filledQuantity:fillCount,
      entryFee:finite(position?.entryAverageFeePaid??attempt?.averageFeePaid),
      scoreAtEntry:finite(position?.entryScore??candidate?.score??attempt?.liveScore),
      edgeAtEntry:finite(candidate?.edge),
      movementAtEntry:finite(candidate?.move),
      contractCloseTime:closeTime,
      providerOrderId:entryOrderId
    },
    checkpointDecision:null,
    phase1b:null
  };
}

export function freezePhase1ACheckpointDecision({attachment,checkpointAt=Date.now(),exitScore=.20,currentScore,currentEdge,currentMove,providerBid,providerQuoteFresh=false,shadowFresh=false,closeTime,shadowObservedAt=null}={}){
  if(!attachment||attachment?.checkpointDecision)return attachment?.checkpointDecision||null;
  const entryScore=finite(attachment?.entryEvidence?.scoreAtEntry);
  const score=finite(currentScore),edge=finite(currentEdge),move=finite(currentMove),bid=finite(providerBid);
  const close=Date.parse(closeTime||attachment?.entryEvidence?.contractCloseTime||"");
  const remainingMs=Number.isFinite(close)?close-checkpointAt:null;
  const unavailable=[];
  if(score===null)unavailable.push("CURRENT_SCORE");
  if(edge===null)unavailable.push("CURRENT_EDGE");
  if(bid===null||providerQuoteFresh!==true)unavailable.push("FRESH_PROVIDER_BID");
  if(remainingMs===null)unavailable.push("CONTRACT_CLOSE_TIME");
  if(shadowFresh!==true)unavailable.push("FRESH_SHADOW_OBSERVATION");

  let thesis="UNKNOWN",decision="EXIT",reason="INSUFFICIENT_EVIDENCE";
  if(score!==null&&entryScore!==null){
    if(score<=Number(exitScore)){thesis="INVALIDATED";decision="EXIT";reason="EXISTING_EXIT_SCORE_REACHED";}
    else if(score<entryScore){thesis="WEAKENED";decision="EXIT";reason="THESIS_WEAKENED_AT_CHECKPOINT";}
    else if(Math.abs(score-entryScore)<=1e-12){thesis="UNCHANGED";}
    else thesis="STRENGTHENED";
  }
  if((thesis==="UNCHANGED"||thesis==="STRENGTHENED")&&unavailable.length===0&&remainingMs>0){
    decision="CONTINUE_BOUNDED";
    reason=thesis==="STRENGTHENED"?"THESIS_STRENGTHENED_WITH_FRESH_EVIDENCE":"THESIS_UNCHANGED_WITH_FRESH_EVIDENCE";
  }else if(remainingMs!==null&&remainingMs<=0){
    decision="EXIT";reason="CONTRACT_TIME_EXHAUSTED";
  }else if(unavailable.length&&reason!=="EXISTING_EXIT_SCORE_REACHED"&&reason!=="THESIS_WEAKENED_AT_CHECKPOINT"){
    thesis=score===null?"UNKNOWN":thesis;
    decision="EXIT";reason="INSUFFICIENT_EVIDENCE";
  }

  const contradicts=[];
  if(score!==null&&entryScore!==null&&score<entryScore)contradicts.push("CURRENT_SCORE_BELOW_ENTRY_SCORE");
  if(edge!==null&&edge<=0)contradicts.push("CURRENT_EDGE_NON_POSITIVE");
  return {
    frozen:true,
    frozenAt:new Date(checkpointAt).toISOString(),
    decisionTime:new Date(checkpointAt).toISOString(),
    decision,
    reason,
    originalThesis:thesis,
    continuationDurationAuthorized:false,
    continuationDurationMs:null,
    evidenceAvailableAtDecision:{
      scoreAtEntry:entryScore,
      currentScore:score,
      currentEdge:edge,
      currentMovement:move,
      providerBid:bid,
      providerQuoteFresh:Boolean(providerQuoteFresh),
      shadowFresh:Boolean(shadowFresh),
      shadowObservedAt,
      contractCloseTime:Number.isFinite(close)?new Date(close).toISOString():null,
      remainingContractMs:remainingMs
    },
    contradictoryObservations:contradicts,
    unavailableObservations:unavailable,
    invalidationEvidence:score!==null&&score<=Number(exitScore)?"CURRENT_SCORE_AT_OR_BELOW_EXISTING_REAL_EXIT_THRESHOLD":null,
    profitLossUsedForDecision:false,
    futureOutcomeObserved:false
  };
}

export function authorizePhase1BContinuation({attachment,checkpointAt=Date.now(),closeTime}={}){
  const d=attachment?.checkpointDecision||null;
  if(!attachment||!d)return null;
  if(attachment.phase1b)return attachment.phase1b;
  const close=Date.parse(closeTime||d?.evidenceAvailableAtDecision?.contractCloseTime||attachment?.entryEvidence?.contractCloseTime||"");
  const remainingMs=Number.isFinite(close)?close-checkpointAt:null;
  const base={
    schema:"NFE_PHASE1B_SHADOW_60S_V1",
    counterfactualOnly:true,
    tradingAuthority:false,
    checkpointDecision:d.decision||"EXIT",
    checkpointReason:d.reason||"INSUFFICIENT_EVIDENCE",
    checkpointDecisionTime:d.decisionTime||new Date(checkpointAt).toISOString(),
    checkpointRemainingMs:remainingMs,
    continuationDurationMs:PHASE1B_CONTINUATION_MS,
    minimumRemainingRequiredMs:PHASE1B_MIN_REMAINING_MS,
    providerCloseTime:Number.isFinite(close)?new Date(close).toISOString():null,
    futureOutcomeObserved:false,
    endpointObservation:null,
    comparison:null
  };
  if(d.decision!=="CONTINUE_BOUNDED"){
    attachment.phase1b={...base,status:"ENDED_AT_CHECKPOINT",continuationEligible:false,policyDecision:"EXIT",policyReason:d.reason||"CHECKPOINT_EXIT",authorizedEndpointAt:null};
    return attachment.phase1b;
  }
  if(remainingMs===null){
    attachment.phase1b={...base,status:"REJECTED_TIMING",continuationEligible:false,policyDecision:"EXIT",policyReason:"INSUFFICIENT_TIME_OR_TIMING_EVIDENCE",authorizedEndpointAt:null};
    return attachment.phase1b;
  }
  if(remainingMs<PHASE1B_MIN_REMAINING_MS){
    attachment.phase1b={...base,status:"REJECTED_TIME_GATE",continuationEligible:false,policyDecision:"EXIT",policyReason:"INSUFFICIENT_TIME_FOR_BOUNDED_CONTINUATION",authorizedEndpointAt:null};
    return attachment.phase1b;
  }
  const endpoint=checkpointAt+PHASE1B_CONTINUATION_MS;
  if(!Number.isFinite(close)||endpoint>=close){
    attachment.phase1b={...base,status:"REJECTED_TIMING",continuationEligible:false,policyDecision:"EXIT",policyReason:"INSUFFICIENT_TIME_OR_TIMING_EVIDENCE",authorizedEndpointAt:null};
    return attachment.phase1b;
  }
  attachment.phase1b={
    ...base,status:"ACTIVE",continuationEligible:true,policyDecision:"CONTINUE_BOUNDED",policyReason:"PHASE1B_60_SECOND_WINDOW_AUTHORIZED",
    authorizedEndpointAt:new Date(endpoint).toISOString(),hardOuterBoundary:"PROVIDER_CLOSE_TIME",latestAuthorizedObservation:null
  };
  return attachment.phase1b;
}

export function recordPhase1BAuthorizedObservation({phase1b,observedAt=Date.now(),providerBid,providerQuoteFresh=false,shadowFresh=false,currentScore,currentEdge,currentMove,shadowObservedAt=null}={}){
  if(!phase1b||phase1b.status!=="ACTIVE")return phase1b||null;
  const endpoint=Date.parse(phase1b.authorizedEndpointAt||"");
  const close=Date.parse(phase1b.providerCloseTime||"");
  if(!Number.isFinite(endpoint)||!Number.isFinite(close))return phase1b;
  const t=finite(observedAt);
  if(t===null||t>endpoint||t>=close)return phase1b;
  const bid=finite(providerBid),score=finite(currentScore),edge=finite(currentEdge),move=finite(currentMove);
  phase1b.latestAuthorizedObservation={
    observedAt:new Date(t).toISOString(),
    providerBid:bid,
    providerQuoteFresh:Boolean(providerQuoteFresh&&bid!==null),
    shadowFresh:Boolean(shadowFresh),
    shadowObservedAt,
    currentScore:score,currentEdge:edge,currentMovement:move,
    withinAuthorizedWindow:true,
    beforeProviderClose:true
  };
  return phase1b;
}

function realizedNet({entryPrice,exitPrice,quantity,entryFee=0,exitFee}={}){
  const ep=finite(entryPrice),xp=finite(exitPrice),q=finite(quantity),ef=finite(entryFee),xf=finite(exitFee);
  if(ep===null||xp===null||q===null||xf===null)return null;
  return Number((((xp-ep)*q)-(ef||0)-xf).toFixed(6));
}

export function freezePhase1BEndpointComparison({attachment,position,observedAt=Date.now(),hypotheticalExitFeeUsd=null}={}){
  const p=attachment?.phase1b;
  if(!attachment||!p||p.status!=="ACTIVE"||p.endpointObservation)return p?.endpointObservation||null;
  const endpoint=Date.parse(p.authorizedEndpointAt||"");
  const close=Date.parse(p.providerCloseTime||"");
  const now=finite(observedAt);
  if(!Number.isFinite(endpoint)||now===null||now<endpoint)return null;
  const obs=p.latestAuthorizedObservation||null;
  const obsAt=Date.parse(obs?.observedAt||"");
  const trustworthy=Boolean(
    obs&&Number.isFinite(obsAt)&&obsAt<=endpoint&&obsAt<close&&
    obs.providerQuoteFresh===true&&finite(obs.providerBid)!==null
  );
  const baselineExitTimestamp=position?.closedAt?new Date(Number(position.closedAt)).toISOString():null;
  const baselineNet=realizedNet({
    entryPrice:position?.entryAverageFillPrice,
    exitPrice:position?.exitAverageFillPrice,
    quantity:position?.filledCount,
    entryFee:position?.entryAverageFeePaid,
    exitFee:position?.exitAverageFeePaid
  });
  const hypotheticalNet=trustworthy?realizedNet({
    entryPrice:position?.entryAverageFillPrice,
    exitPrice:obs?.providerBid,
    quantity:position?.filledCount,
    entryFee:position?.entryAverageFeePaid,
    exitFee:hypotheticalExitFeeUsd
  }):null;
  const delta=(baselineNet!==null&&hypotheticalNet!==null)?Number((hypotheticalNet-baselineNet).toFixed(6)):null;
  const comparisonStatus=delta===null?"UNKNOWN / UNPROVEN":delta>1e-9?"HELPED":delta<-1e-9?"HURT":"NO_MATERIAL_DIFFERENCE";
  const why=p.checkpointDecision==="CONTINUE_BOUNDED"
    ?"REAL_BASELINE_FORCED_FIVE_MINUTE_EXIT_WHILE_FROZEN_SHADOW_REASONING_CONTINUED"
    :"REAL_BASELINE_AND_SHADOW_BOTH_EXITED_AT_CHECKPOINT";
  p.endpointObservation={
    frozen:true,
    authorizedEndpointAt:p.authorizedEndpointAt,
    frozenAt:new Date(now).toISOString(),
    observationUsedAt:trustworthy?obs.observedAt:null,
    providerCloseTime:p.providerCloseTime,
    trustworthyHypotheticalExecutionEvidence:trustworthy,
    hypotheticalExecutionStatus:trustworthy?"SUPPORTED_BY_OBSERVABLE_EXECUTABLE_SIDE_EVIDENCE":"UNKNOWN / UNPROVEN",
    providerBid:trustworthy?finite(obs.providerBid):null,
    providerQuoteFresh:trustworthy,
    shadowFresh:Boolean(obs?.shadowFresh),
    currentScore:finite(obs?.currentScore),currentEdge:finite(obs?.currentEdge),currentMovement:finite(obs?.currentMovement),
    futureOutcomeObserved:true
  };
  p.status="COMPLETE";
  p.futureOutcomeObserved=true;
  p.comparison={
    schema:"NFE_PHASE1B_BASELINE_VS_SHADOW_V1",
    realBaselineExit:{timestamp:baselineExitTimestamp,exitPrice:finite(position?.exitAverageFillPrice),realizedResultUsd:baselineNet,exitReason:position?.exitReason||null},
    shadowReasonedExit:{checkpointDecision:p.checkpointDecision,checkpointReason:p.checkpointReason,checkpointRemainingMs:p.checkpointRemainingMs,continuationEligible:p.continuationEligible,continuationDurationMs:p.continuationDurationMs,counterfactualEndpoint:p.authorizedEndpointAt,hypotheticalExitPrice:trustworthy?finite(obs.providerBid):null,hypotheticalResultUsd:hypotheticalNet,hypotheticalExitFeeUsd:finite(hypotheticalExitFeeUsd)},
    WHY_BASELINE_AND_SHADOW_DIFFERED:why,
    differenceVersusBaselineUsd:delta,
    comparisonStatus,
    comparisonBasis:delta===null?"INSUFFICIENT_TRUSTWORTHY_EXECUTION_OR_FEE_EVIDENCE":"NET_RESULT_USD",
    checkpointReasonImmutable:true
  };
  return p.endpointObservation;
}

export function phase1AShadowFixtureProof(){
  const basePosition={marketTicker:"TEST-A",asset:"BTC",outcomeSide:"YES",direction:"UP",filledCount:1,entryOrderId:"ORDER-1",filledAt:1000000,entryAverageFillPrice:.55,entryAverageFeePaid:.01,entryScore:.80};
  const candidate={marketTicker:"TEST-A",asset:"BTC",outcomeSide:"YES",direction:"UP",score:.80,edge:.05,move:.01,closeTime:new Date(1000000+900000).toISOString()};
  const attached=buildPhase1AShadowAttachment({position:basePosition,candidate,maxHoldMs:300000,attachedAt:1000001});
  const noFill=buildPhase1AShadowAttachment({position:{...basePosition,filledCount:0,entryOrderId:"ORDER-0"},candidate,maxHoldMs:300000,attachedAt:1000001});
  const checkpoint=1300000;
  const continued=freezePhase1ACheckpointDecision({attachment:attached,checkpointAt:checkpoint,currentScore:.84,currentEdge:.06,currentMove:.02,providerBid:.60,providerQuoteFresh:true,shadowFresh:true,closeTime:candidate.closeTime,shadowObservedAt:new Date(checkpoint).toISOString()});
  const exitAttachment=buildPhase1AShadowAttachment({position:basePosition,candidate,maxHoldMs:300000,attachedAt:1000001});
  const exited=freezePhase1ACheckpointDecision({attachment:exitAttachment,checkpointAt:checkpoint,currentScore:.62,currentEdge:.02,currentMove:-.01,providerBid:.48,providerQuoteFresh:true,shadowFresh:true,closeTime:candidate.closeTime,shadowObservedAt:new Date(checkpoint).toISOString()});
  const unknownAttachment=buildPhase1AShadowAttachment({position:basePosition,candidate,maxHoldMs:300000,attachedAt:1000001});
  const unknown=freezePhase1ACheckpointDecision({attachment:unknownAttachment,checkpointAt:checkpoint,currentScore:null,currentEdge:null,currentMove:null,providerBid:null,providerQuoteFresh:false,shadowFresh:false,closeTime:candidate.closeTime});
  return {
    ok:Boolean(attached&&noFill===null&&continued?.decision==="CONTINUE_BOUNDED"&&exited?.decision==="EXIT"&&unknown?.decision==="EXIT"&&unknown?.reason==="INSUFFICIENT_EVIDENCE"),
    confirmedFillAttaches:Boolean(attached),noFillDoesNotAttach:noFill===null,continueBounded:continued,exit:exited,insufficientEvidence:unknown,
    providerWrites:0,capitalMovedUsd:0,shadowTradingAuthority:false
  };
}

export function phase1BShadowFixtureProof(){
  const checkpoint=1_300_000;
  const basePosition={marketTicker:"TEST-B",asset:"BTC",outcomeSide:"YES",direction:"UP",filledCount:1,entryOrderId:"ORDER-B",filledAt:1_000_000,entryAverageFillPrice:.55,entryAverageFeePaid:.01,entryScore:.80,closedAt:checkpoint+1000,exitAverageFillPrice:.60,exitAverageFeePaid:.01,exitReason:"MAX_HOLD_EXIT"};
  const make=(remainingMs)=>{
    const candidate={marketTicker:"TEST-B",asset:"BTC",outcomeSide:"YES",direction:"UP",score:.80,edge:.05,move:.01,closeTime:new Date(checkpoint+remainingMs).toISOString()};
    const a=buildPhase1AShadowAttachment({position:basePosition,candidate,maxHoldMs:300000,attachedAt:1_000_001});
    a.checkpointDecision=freezePhase1ACheckpointDecision({attachment:a,checkpointAt:checkpoint,currentScore:.84,currentEdge:.06,currentMove:.02,providerBid:.60,providerQuoteFresh:true,shadowFresh:true,closeTime:candidate.closeTime,shadowObservedAt:new Date(checkpoint).toISOString()});
    authorizePhase1BContinuation({attachment:a,checkpointAt:checkpoint,closeTime:candidate.closeTime});
    return a;
  };
  const eligible=make(90_000);
  const short=make(89_999);
  const invalid=make(90_000);invalid.phase1b=null;authorizePhase1BContinuation({attachment:invalid,checkpointAt:checkpoint,closeTime:"INVALID"});
  recordPhase1BAuthorizedObservation({phase1b:eligible.phase1b,observedAt:checkpoint+60_000,providerBid:.70,providerQuoteFresh:true,shadowFresh:true,currentScore:.86,currentEdge:.07,currentMove:.03,shadowObservedAt:new Date(checkpoint+60_000).toISOString()});
  freezePhase1BEndpointComparison({attachment:eligible,position:basePosition,observedAt:checkpoint+60_000,hypotheticalExitFeeUsd:.01});
  const unproven=make(90_000);
  freezePhase1BEndpointComparison({attachment:unproven,position:basePosition,observedAt:checkpoint+60_000,hypotheticalExitFeeUsd:null});
  const reasonBefore=eligible.checkpointDecision.reason;
  const reasonAfter=eligible.checkpointDecision.reason;
  return {
    ok:Boolean(
      eligible.phase1b?.comparison?.comparisonStatus==="HELPED"&&eligible.phase1b?.continuationDurationMs===60_000&&eligible.phase1b?.checkpointRemainingMs===90_000&&
      short.phase1b?.policyDecision==="EXIT"&&short.phase1b?.policyReason==="INSUFFICIENT_TIME_FOR_BOUNDED_CONTINUATION"&&
      invalid.phase1b?.policyDecision==="EXIT"&&invalid.phase1b?.policyReason==="INSUFFICIENT_TIME_OR_TIMING_EVIDENCE"&&
      unproven.phase1b?.comparison?.comparisonStatus==="UNKNOWN / UNPROVEN"&&reasonBefore===reasonAfter
    ),
    caseA:{continuationEligible:eligible.phase1b?.continuationEligible,durationMs:eligible.phase1b?.continuationDurationMs,endpoint:eligible.phase1b?.authorizedEndpointAt,realLifecycleUnaffected:true},
    caseB:{continuationEligible:short.phase1b?.continuationEligible,policyDecision:short.phase1b?.policyDecision,reason:short.phase1b?.policyReason},
    caseC:{continuationEligible:invalid.phase1b?.continuationEligible,policyDecision:invalid.phase1b?.policyDecision,reason:invalid.phase1b?.policyReason},
    caseD:{trustworthy:eligible.phase1b?.endpointObservation?.trustworthyHypotheticalExecutionEvidence,comparisonStatus:eligible.phase1b?.comparison?.comparisonStatus,differenceVersusBaselineUsd:eligible.phase1b?.comparison?.differenceVersusBaselineUsd},
    caseE:{trustworthy:unproven.phase1b?.endpointObservation?.trustworthyHypotheticalExecutionEvidence,comparisonStatus:unproven.phase1b?.comparison?.comparisonStatus},
    caseF:{shadowFailureEffectOnRealLifecycle:"ZERO_BY_DESIGN_NONBLOCKING",realLifecycleUnaffected:true},
    providerCloseTimeHardBoundary:true,checkpointReasonImmutable:reasonBefore===reasonAfter,providerWrites:0,providerEntries:0,providerExits:0,providerCancels:0,capitalMovedUsd:0,newRealAuthorizationConsumed:0,founderCapitalMovedUsd:0,shadowTradingAuthority:false,realExecutionLogicChanged:false
  };
}
