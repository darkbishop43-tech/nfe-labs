const finite=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};

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
    checkpointDecision:null
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
    confirmedFillAttaches:Boolean(attached),
    noFillDoesNotAttach:noFill===null,
    continueBounded:continued,
    exit:exited,
    insufficientEvidence:unknown,
    providerWrites:0,
    capitalMovedUsd:0,
    shadowTradingAuthority:false
  };
}
