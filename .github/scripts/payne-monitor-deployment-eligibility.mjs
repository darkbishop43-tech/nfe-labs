// Display-only deployment gate. Pure, fail-closed; no trading entry changes.
export function evaluateMonitorDeployment({control,series,evidence,source,now=Date.now()}={}) {
  const deny=reason=>({allowed:false,reason});
  if(source?.baseline!=='6b2174211bd7ba4f52c01d5037f9bef46e424f14'||source?.promotion!=='7abf271cbcbb5816459559e9deefb8987e8c31d0'||source?.cockpitBlob!=='810f4d509413e678ab3db638ba5f6dfd8cff4364'||source?.onlyChangedFile!=='market-edge-lab/real/payne-kalshi-real/src/cockpit-html.js') return deny('SOURCE_NOT_EXACTLY_APPROVED');
  if(control?.realControlSchema!=='PAYNE_REAL_CONTROL_V2_PAPER_BRAIN'||control?.armed!==false||control?.openPositions!==0)return deny('CONTROL_NOT_DISARMED_FLAT');
  if(series?.schema!=='PAYNE_REAL_SERIES_V1'||series?.owner!=='PAYNE_KALSHI_REAL'||typeof series?.seriesId!=='string'||!series.seriesId)return deny('SERIES_IDENTITY_UNVERIFIED');
  if(series.unresolvedEntry!==false||series.position!==null||series.currentAttempt!==null||!Array.isArray(series.positions)||series.positions.length!==0)return deny('UNRESOLVED_SERIES_OWNERSHIP');
  if(![null,undefined,'NONE'].includes(series.fireLatch?.state))return deny('EXECUTION_LATCH_ACTIVE_OR_UNKNOWN');
  if(evidence?.authority!=='AUTHENTICATED_READONLY_VERIFIER'||evidence?.source!=='AUTHENTICATED_READ_ONLY'||evidence?.seriesId!==series.seriesId)return deny('AUTHENTICATED_EXPOSURE_COVERAGE_MISSING');
  const stamp=Date.parse(evidence.observedAt??'');
  if(!Number.isFinite(stamp)||stamp>now+10000||now-stamp>120000)return deny('PROVIDER_EVIDENCE_STALE');
  if(evidence.providerOrdersComplete!==true||evidence.providerPositionsComplete!==true||evidence.coordinatorClaimsComplete!==true||evidence.reconciliationComplete!==true)return deny('PROVIDER_OR_COORDINATOR_COVERAGE_INCOMPLETE');
  for(const k of ['providerOpenOrders','providerOpenPositions','coordinatorActiveClaims','unknownProviderObligations'])
    if(typeof evidence[k]!=='number'||!Number.isFinite(evidence[k])||evidence[k]!==0)return deny('ACTIVE_OR_UNKNOWN_EXPOSURE_'+k);
  if(evidence.providerPostUnknown!==false||evidence.unresolvedOwnership!==false)return deny('UNKNOWN_EXECUTION_OR_OWNERSHIP');
  return {allowed:true,reason:'MONITOR_ONLY_SAFE_TO_PROMOTE'};
}
