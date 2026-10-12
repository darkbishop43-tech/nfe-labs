// PAYNE audit-only formatting. Never store raw provider bodies or authentication material.
export function sanitizeKalshiError(body, readable=true) {
  if (!readable) return {errorCode:null,errorMessage:null,errorEvidence:'UNREADABLE_RESPONSE'};
  if (!body || typeof body!=='object') return {errorCode:null,errorMessage:null,errorEvidence:'MESSAGE_NOT_RECORDED'};
  const err=body.error && typeof body.error==='object'?body.error:body;
  const safe=x=>typeof x==='string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(x)?x:null;
  const code=safe(err.code);
  const input=typeof err.message==='string'?err.message:null;
  const forbidden=/authorization|bearer|api[_ -]?key|signature|private[_ -]?key|secret|token|password|credential|-----BEGIN|kalshi-access|https?:\/\//i;
  const message=input && input.length<=240 && !forbidden.test(input) && !/[\r\n\x00-\x1f]/.test(input)?input:null;
  return {errorCode:code,errorMessage:message,errorEvidence:message||code?'SANITIZED_ERROR':'MESSAGE_NOT_RECORDED'};
}
export function auditStage(attempt) {
  if(attempt?.providerOrderId && Number(attempt?.providerResult?.fillCount)>0)return 'ORDER_FILLED';
  if(attempt?.providerOrderId)return 'PROVIDER_ORDER_ACCEPTED';
  if(attempt?.providerHttpStatus!=null)return 'HTTP_RESPONSE_RECEIVED';
  if(attempt?.providerPostStarted)return 'PROVIDER_OUTCOME_UNKNOWN';
  return 'LOCAL_ATTEMPT_ONLY';
}
