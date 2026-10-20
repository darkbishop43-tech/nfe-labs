#!/usr/bin/env bash
# Existing PAYNE Cloudflare KV namespace — authoritative GET-only deployment gate.
# Does not call public Worker HTTPS, Kalshi, any control endpoint, or KV writes.
set -euo pipefail
mode="${1:-}"
if [[ "$mode" != pre && "$mode" != post ]]; then echo 'USAGE: payne-kv-deployment-safety.sh pre|post';exit 2;fi
: "${CLOUDFLARE_API_TOKEN:?MISSING_CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?MISSING_CLOUDFLARE_ACCOUNT_ID}"
# Verified existing wrangler.toml namespace, not a new binding.
namespace="03352b0ccb034f1bb8206f663a04b125"
base="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$namespace/values"
mkdir -p /tmp/payne-kv-gate
read_payne_kv() {
  local key="$1" label="$2" encoded code
  encoded="$(jq -nr --arg value "$key" '$value|@uri')"
  code="$(curl --silent --show-error --max-time 25 --output "/tmp/payne-kv-gate/$label.json" --write-out '%{http_code}' --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$base/$encoded")"
  if [[ "$code" != 200 ]];then echo "BLOCKED: CLOUDFLARE_KV_${label}_HTTP_$code";exit 1;fi
  if ! jq -e 'type=="object"' "/tmp/payne-kv-gate/$label.json" >/dev/null;then echo "BLOCKED: INVALID_KV_${label}";exit 1;fi
}
verify_safety() {
  local c=/tmp/payne-kv-gate/control.json s=/tmp/payne-kv-gate/series.json x=/tmp/payne-kv-gate/current.json
  # Optional one-time maintenance proof file is created only by the authenticated
  # read-only verifier in the approved PAYNE workflow. A missing proof fails closed.
  local proof="${PAYNE_MAINTENANCE_PROOF_FILE:-/tmp/payne-kv-gate/maintenance-proof.json}"
  if [[ ! -f "$proof" ]];then printf '%s\n' '{"allowed":false}' > "$proof";fi
  jq -e --slurpfile maintenance "$proof" '
    .realControlSchema=="PAYNE_REAL_CONTROL_V2_PAPER_BRAIN" and
    .armed==false and
    (.openPositions==0 or
      (.openPositions==1 and $maintenance[0].allowed==true and
       $maintenance[0].reason=="EXACT_PROVIDER_FLAT_MAINTENANCE_ONLY" and
       $maintenance[0].sourceBlob=="76c6ff7a2f7f6967def859012b2fcf3b66f7b2f9")) and
    .requiredExchangeIndex==2 and
    (.activeThreshold|type=="number" and .>=0.50 and .<=1) and
    (.attemptTarget|type=="number" and .>=1 and .==floor) and
    (.maxEntryDebitUsd|type=="number" and .>0) and
    (.scanEnabled==true)
  ' "$c" >/dev/null || { echo 'BLOCKED: PERSISTED_CONTROL_SAFETY';exit 1; }
  # Deployment-only exception: these predicates are necessary but NOT sufficient.
  # Evidence must be created by an authenticated read-only verifier, independent of
  # the candidate series; this gate deliberately rejects missing/unknown coverage.
  # The current production workflow has no complete coordinator/provider verifier,
  # so no valid production proof is presently issued.
  local emptyProof="${PAYNE_EMPTY_SERIES_EVIDENCE_FILE:-/tmp/payne-kv-gate/empty-series-evidence.json}"
  if [[ ! -f "$emptyProof" ]];then printf '%s\n' '{"allowed":false}' > "$emptyProof";fi
  # Never accept a self-attested proof in production. A separate authenticated
  # verifier must create a sealed evidence document and set the validator marker.
  # This marker is supplied only by the verifier, never by KV or human notes.
  local evidenceAuthority="${PAYNE_EMPTY_SERIES_EVIDENCE_AUTHORITY:-UNVERIFIED}"
  jq -e --slurpfile c "$c" --slurpfile maintenance "$proof" --slurpfile empty "$emptyProof" --arg evidenceAuthority "$evidenceAuthority" '
    .schema=="PAYNE_REAL_SERIES_V1" and
    .owner=="PAYNE_KALSHI_REAL" and
    .requiredExchangeIndex==2 and
    ($c[0].openPositions==0 or
      ($maintenance[0].allowed==true and
       .seriesId==$maintenance[0].seriesId and
       .position.attemptId==$maintenance[0].attemptId and
       .position.entryOrderId==$maintenance[0].entryOrderId and
       .position.entryClientOrderId==$maintenance[0].clientOrderId and
       .position.marketTicker==$maintenance[0].ticker and
       .position.outcomeSide==$maintenance[0].side)) and
    # Maintenance deployment is NOT permission to enter. Preserve unresolvedEntry.
    # An unresolved terminal historical result is permitted only while DISARMED;
    # active/submitting coordinator obligations retain their separate interlocks.
    (.unresolvedEntry==false or
      (.unresolvedEntry==true and $c[0].armed==false and
       (.currentAttempt.status//""|IN("NO_PROVIDER_EXECUTION","PROVIDER_RECONCILED_NO_EXECUTION")) and
       (.currentAttempt.reconciliationReason//""|IN("PROVIDER_RECONCILED_NO_EXECUTION")))) and
    ((.position // null)==null or
      ((.position.owner//"")=="PAYNE_KALSHI_REAL" and
       ((.position.status//""|IN("OPEN","FLAT","CLOSED","SETTLED")) or
         ((.position.status//"")=="RECONCILIATION_UNKNOWN" and
          $maintenance[0].allowed==true and $c[0].armed==false)))) and
    ((.fireLatch.state // "NONE") |
      (IN("LATCHED","PROVIDER_POST_UNKNOWN")|not)) and
    # A disarmed terminal historical attempt may retain an obsolete pre-provider
    # latch across SOFTWARE maintenance only. Entry remains blocked by
    # unresolvedEntry and the independent Durable Object coordinator.
    ((.fireLatch.state // "NONE")!="PRE_PROVIDER_VALIDATION" or
      ($c[0].armed==false and .unresolvedEntry==true and
       .currentAttempt.status=="NO_PROVIDER_EXECUTION" and
       .currentAttempt.reconciliationReason=="PROVIDER_RECONCILED_NO_EXECUTION" and
       .currentAttempt.providerPostStarted!=true and
       (.fireLatch.providerPost//"NOT_STARTED")=="NOT_STARTED")) and
    (.currentAttempt.providerPostStarted!=true or
      (.currentAttempt.status|IN("NO_FILL","FILLED","CLOSED","SETTLED","NO_PROVIDER_EXECUTION"))) and
    # Historical frozen-series configuration is not rewritten by a disarmed
    # software-only deployment. ARM keeps its original frozen-config checks.
    (.configFrozen!=true or
       (.threshold==$c[0].activeThreshold and
        .maxEntryDebitUsd==$c[0].maxEntryDebitUsd and
        .attemptTarget==$c[0].attemptTarget) or
       ($c[0].armed==false and .unresolvedEntry==true and
        .currentAttempt.status=="NO_PROVIDER_EXECUTION" and
        .currentAttempt.reconciliationReason=="PROVIDER_RECONCILED_NO_EXECUTION" and
        .currentAttempt.providerPostStarted!=true and
        (.fireLatch.state//"NONE")=="PRE_PROVIDER_VALIDATION" and
        (.fireLatch.providerPost//"NOT_STARTED")=="NOT_STARTED") or
       ($c[0].armed==false and .unresolvedEntry==false and
        (.position//null)==null and
        .currentAttempt.status=="NO_PROVIDER_EXECUTION" and
        .currentAttempt.reconciliationReason=="PROVIDER_RECONCILED_NO_EXECUTION" and
        (.fireLatch.state//"NONE")=="INVALIDATED_BEFORE_POST" and
        .fireLatch.finalResult=="NO_PROVIDER_EXECUTION") or
       # Founder-authorized deployment recovery for this exact historical
       # zero-attempt series. Do not infer provider flatness from these KV fields.
       # Missing provider fields remain UNVERIFIED, not proof of zero. Explicit
       # unknown/open obligations block SOFTWARE maintenance. ARM/provider guards
       # remain enforced by the unchanged live trading engine.
       ($c[0].armed==false and $c[0].openPositions==0 and
        .seriesId=="bd881b11-b130-491f-a75f-a98425b92fd9" and
        .configFrozen==true and
        (.attemptsStarted|type=="number" and .==0) and
        (.executionIntentsStarted|type=="number" and .==0) and
        .unresolvedEntry==false and
        has("currentAttempt") and .currentAttempt==null and
        has("position") and .position==null and
        (.positions|type=="array" and length==0) and
        has("fireLatch") and (.fireLatch==null or .fireLatch.state=="NONE") and
        # PAYNE_REAL_SERIES_V1 legacy records have no top-level providerPostStarted.
        # Absence is permitted for SOFTWARE deployment only, never converted to false.
        # An explicit true, null, or unknown value remains blocking.
        ((has("providerPostStarted")|not) or .providerPostStarted==false) and
        ((has("unknownProviderObligations")|not) or .unknownProviderObligations==0) and
        ((has("providerOpenOrders")|not) or .providerOpenOrders==0) and
        ((has("providerOpenPositions")|not) or .providerOpenPositions==0) and
        ((has("coordinatorActiveClaims")|not) or .coordinatorActiveClaims==0) and
        ((has("providerExposureStatus")|not) or .providerExposureStatus!="UNKNOWN") and
        ((has("providerReconciliationStatus")|not) or .providerReconciliationStatus!="UNKNOWN")) or
       # This is a SOFTWARE DEPLOYMENT policy exception only. It never alters
       # ARM eligibility, persistent series, coordinator claims or provider writes.
       ($evidenceAuthority=="AUTHENTICATED_READONLY_VERIFIER" and
        $empty[0].allowed==true and
        $empty[0].schema=="PAYNE_EMPTY_SERIES_DEPLOYMENT_EVIDENCE_V1" and
        $empty[0].seriesId==.seriesId and
        $empty[0].controlArmed==false and
        $empty[0].source=="AUTHENTICATED_READ_ONLY" and
        $empty[0].providerOrdersComplete==true and
        $empty[0].providerPositionsComplete==true and
        $empty[0].coordinatorClaimsComplete==true and
        $empty[0].reconciliationComplete==true and
        $empty[0].providerOpenOrders==0 and
        $empty[0].providerOpenPositions==0 and
        $empty[0].coordinatorActiveClaims==0 and
        $empty[0].unknownProviderObligations==0 and
        ($empty[0].observedAt|type=="string") and
        (($empty[0].observedAt|fromdateiso8601?) // 0) >= (now-120) and
        (($empty[0].observedAt|fromdateiso8601?) // 0) <= (now+10) and
        $c[0].armed==false and
        $c[0].openPositions==0 and
        .configFrozen==true and
        (.attemptsStarted|type=="number" and .==0) and
        (.executionIntentsStarted|type=="number" and .==0) and
        .unresolvedEntry==false and
        (.currentAttempt//null)==null and
        (.position//null)==null and
        (.positions|type=="array" and length==0) and
        ((.fireLatch//null)==null or
          (.fireLatch|type=="object" and .state=="NONE")) and
        (.providerPostStarted|type=="boolean" and .==false)))
  ' "$s" >/dev/null || {
    # Existing KV data only: identify the failed invariant without changing state.
    jq -r --slurpfile c "$c" '
      if .schema!="PAYNE_REAL_SERIES_V1" then "BLOCKED: SERIES_SCHEMA"
      elif .owner!="PAYNE_KALSHI_REAL" then "BLOCKED: SERIES_OWNER"
      elif .requiredExchangeIndex!=2 then "BLOCKED: SERIES_FUNDING_INDEX"
      elif (.unresolvedEntry==true and
          ((.currentAttempt.status//""|IN("NO_PROVIDER_EXECUTION","PROVIDER_RECONCILED_NO_EXECUTION")|not) or
           (.currentAttempt.reconciliationReason//"")!="PROVIDER_RECONCILED_NO_EXECUTION"))
         then "BLOCKED: HISTORICAL_UNRESOLVED_RESULT_NOT_TERMINAL"
      elif ((.position//null)!=null and
          ((.position.owner//"")!="PAYNE_KALSHI_REAL" or
           (.position.status//""|IN("OPEN","FLAT","CLOSED","SETTLED")|not)))
         then "BLOCKED: POSITION_OWNERSHIP_OR_STATUS"
      elif (.fireLatch.state//"NONE"|IN("LATCHED","PROVIDER_POST_UNKNOWN"))
         then "BLOCKED: ACTIVE_FIRE_LATCH"
      elif (.fireLatch.state//"NONE")=="PRE_PROVIDER_VALIDATION" and
          ($c[0].armed!=false or .unresolvedEntry!=true or
           .currentAttempt.status!="NO_PROVIDER_EXECUTION" or
           .currentAttempt.reconciliationReason!="PROVIDER_RECONCILED_NO_EXECUTION" or
           .currentAttempt.providerPostStarted==true or
           (.fireLatch.providerPost//"NOT_STARTED")!="NOT_STARTED")
         then "BLOCKED: PRE_PROVIDER_LATCH_NOT_PROVEN_MAINTENANCE_SAFE"
      elif (.currentAttempt.providerPostStarted==true and
            (.currentAttempt.status|IN("NO_FILL","FILLED","CLOSED","SETTLED","NO_PROVIDER_EXECUTION")|not))
         then "BLOCKED: PROVIDER_SUBMISSION_UNKNOWN"
      elif (.configFrozen==true and
           (.threshold!=$c[0].activeThreshold or
            .maxEntryDebitUsd!=$c[0].maxEntryDebitUsd or
            .attemptTarget!=$c[0].attemptTarget))
         then
           if ($c[0].armed==false and $c[0].openPositions==0) then
             "BLOCKED: FROZEN_CONFIG_EXCEPTION_NOT_PROVEN__AUTHENTICATED_PROVIDER_AND_COORDINATOR_COVERAGE_MISSING"
           else
             "BLOCKED: FROZEN_FOUNDER_CONFIG_MISMATCH"
           end
      else "BLOCKED: PERSISTED_SERIES_EXPOSURE_OR_CONFIG"
      end
    ' "$s"
    exit 1
  }
  # Promotion must not depend on heartbeat freshness: scan/management scheduling
  # remains in the Worker. Preserve the existing scanner-source authority check.
  jq -e '.source=="SCHEDULED_CRON" and (.at|type=="string")' "$x" >/dev/null || { echo 'BLOCKED: SCANNER_AUTHORITY';exit 1; }
}
read_payne_kv 'payne-kalshi:control:v1' control
read_payne_kv 'payne-kalshi:real-series:v1' series
read_payne_kv 'payne-kalshi:current:v1' current
verify_safety
fingerprint='{
  threshold:.activeThreshold,
  stake:.maxEntryDebitUsd,
  target:.attemptTarget,
  scanEnabled:.scanEnabled,
  index:.requiredExchangeIndex,
  armed:.armed
}'
jq -S -c "$fingerprint" /tmp/payne-kv-gate/control.json > /tmp/payne-kv-gate/fingerprint-current.json
if [[ "$mode" == pre ]];then
  cp /tmp/payne-kv-gate/fingerprint-current.json /tmp/payne-kv-gate/fingerprint-pre.json
  jq -S -c '{seriesId,configFrozen,attemptsStarted,executionIntentsStarted,unresolvedEntry,position,fireLatch,currentAttempt}' /tmp/payne-kv-gate/series.json > /tmp/payne-kv-gate/series-pre.json
  echo 'PAYNE_AUTHORITY=EXISTING_CLOUDFLARE_KV_API_GET'
  echo 'PREDEPLOY_DISARMED_AND_PERSISTENCE_GATE=PASS'
  jq -c '{armed:.armed,threshold:.activeThreshold,stake:.maxEntryDebitUsd,attemptTarget:.attemptTarget,scanEnabled:.scanEnabled}' /tmp/payne-kv-gate/control.json
  jq -c '{seriesId,status,unresolvedEntry,positionStatus:(.position.status//"FLAT"),attemptsStarted,fireLatchState:(.fireLatch.state//"NONE")}' /tmp/payne-kv-gate/series.json
  jq -c '{scanAt:.at,source:.source}' /tmp/payne-kv-gate/current.json
else
  cmp -s /tmp/payne-kv-gate/fingerprint-pre.json /tmp/payne-kv-gate/fingerprint-current.json || { echo 'BLOCKED: FOUNDER_CONTROL_CHANGED';exit 1; }
  jq -S -c '{seriesId,configFrozen,attemptsStarted,executionIntentsStarted,unresolvedEntry,position,fireLatch,currentAttempt}' /tmp/payne-kv-gate/series.json > /tmp/payne-kv-gate/series-post.json
  cmp -s /tmp/payne-kv-gate/series-pre.json /tmp/payne-kv-gate/series-post.json || { echo 'BLOCKED: TRADING_SERIES_CHANGED_ACROSS_DEPLOYMENT';exit 1; }
  echo 'POSTDEPLOY_DISARMED_AND_CONFIG_CONTINUITY=PASS'
fi
echo 'CLOUDFLARE_KV_GET_CAUSED_NO_TRADING_PROVIDER_WRITES'
