// PAYNE Real first-pullback shadow: pure observation, never returns trading authority.
// No numeric trend thresholds, synthetic history, or provider ownership inference.
export function firstPullbackShadow({seriesId=null,attemptId=null,ticker=null,side=null,at=null,
 originalScore=null,originalDecision=null,entrySignalAtEntry=null,
 marketPresent=false,featureAvailable=false,featureFresh=false,
 continuationEvidence=null,reversalEvidence=null,actualPayneAction=null,
 actualPayneReason=null,providerOutcome=null}={}){
 const fresh=marketPresent===true&&featureAvailable===true&&featureFresh===true;
 const label=String(originalDecision||'').toUpperCase();
 const score=Number.isFinite(originalScore)?originalScore:null;
 const signalLost=fresh?(label==='PULL TRIGGER'?false:
   label==='MISSING'||label==='UNAVAILABLE'?null:true):null;
 // Explicit independently supplied classification required. We do not convert
 // score decline, lost entry qualification, or a single tick into trend history.
 const continuation=fresh&&continuationEvidence?.verified===true;
 const reversal=fresh&&reversalEvidence?.verified===true;
 const assessment=signalLost===true&&continuation&&!reversal?'PULLBACK':
   signalLost===true&&reversal&&!continuation?'REVERSAL':'UNKNOWN';
 const reason=!fresh?'FRESH_EXACT_MARKET_FEATURE_NOT_AVAILABLE':
   signalLost===null?'ORIGINAL_SIGNAL_STATE_UNKNOWN':
   !continuation&&!reversal?'NO_VERIFIED_DIRECTIONAL_CONTINUATION_OR_REVERSAL':
   continuation&&reversal?'CONFLICTING_DIRECTIONAL_EVIDENCE':
   signalLost===false?'ORIGINAL_PULL_SIGNAL_STILL_QUALIFIED':
   assessment==='PULLBACK'?'VERIFIED_CONTINUATION_AFTER_ENTRY_SIGNAL_LOSS':
   'VERIFIED_REVERSAL_AFTER_ENTRY_SIGNAL_LOSS';
 return Object.freeze({
  schema:'PAYNE_FIRST_PULLBACK_SHADOW_V1',source:'PAYNE_REAL_READ_ONLY_SHADOW',
  seriesId,attemptId,ticker,side,at,originalScore:score,originalDecision:originalDecision??null,
  entrySignalAtEntry:entrySignalAtEntry??null,entrySignalDisappeared:signalLost,
  featureAvailable:featureAvailable===true,featureFresh:featureFresh===true,
  continuationEvidence:continuation?continuationEvidence:null,
  reversalEvidence:reversal?reversalEvidence:null,
  shadowManagement:assessment,reason,
  payneAction:actualPayneAction??null,payneReason:actualPayneReason??null,
  providerOutcome:providerOutcome??null,
  doesNotAuthorizeExecution:true
 });
}
