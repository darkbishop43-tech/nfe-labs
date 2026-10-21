#!/usr/bin/env bash
# Existing PAYNE Cloudflare KV namespace — authoritative GET-only deployment gate.
# Does not call public Worker HTTPS, Kalshi, any control endpoint, or KV writes.
set -euo pipefail
mode="${1:-}"
if [[ "$mode" != pre && "$mode" != post ]]; then echo 'USAGE: payne-kv-deployment-safety.sh pre|post';exit 2;fi
: "${CLOUDFLARE_API_TOKEN:?MISSING_CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?MISSING_CLOUDFLARE_ACCOUNT_ID}"
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
  local emptyProof="${PAYNE_EMPTY_SERIES_EVIDENCE_FILE:-/tmp/payne-kv-gate/empty-series-evidence.json}"
  if [[ ! -f "$emptyProof" ]];then printf '%s\n' '{"allowed":false}' > "$emptyProof";fi
  local evidenceAuthority="${PAYNE_EMPTY_SERIES_EVIDENCE_AUTHORITY:-UNVERIFIED}"
  # Defensive helpers: never index a non-object currentAttempt or position.
  # ca_status = currentAttempt.status if object, else ""
  # pos_rec_state / pos_rec_reason similarly
  jq -e --slurpfile c "$c" --slurpfile maintenance "$proof" --slurpfile empty "$emptyProof" --arg evidenceAuthority "$evidenceAuthority" '
    def ca_status: if (.currentAttempt|type)=="object" then .currentAttempt.status // "" else "" end;
    def ca_reason: if (.currentAttempt|type)=="object" then .currentAttempt.reconciliationReason // "" else "" end;
    def ca_post: if (.currentAttempt|type)=="object" then .currentAttempt.providerPostStarted else false end;
    def pos_rec_state: if (.position|type)=="object" then .position.reconciliationState // "" else "" end;
    def pos_rec_reason: if (.position|type)=="object" then .position.reconciliationReason // "" else "" end;
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
    (.unresolvedEntry==false or
      (.unresolvedEntry==true and $c[0].armed==false and
       (ca_status|IN("NO_PROVIDER_EXECUTION","PROVIDER_RECONCILED_NO_EXECUTION")) and
       (ca_reason|IN("PROVIDER_RECONCILED_NO_EXECUTION")))) and
    ((.position // null)==null or
      ((.position.owner//"")=="PAYNE_KALSHI_REAL" and
       ((.position.status//""|IN("OPEN","FLAT","CLOSED","SETTLED")) or
         ((.position.status//"")=="RECONCILIATION_UNKNOWN" and
          $maintenance[0].allowed==true and $c[0].armed==false)))) and
    # Narrow SOFTWARE-only exception for terminal NO_FILL + settlement-confirmed FLAT.
    ((.fireLatch.state // "NONE") |
      (IN("LATCHED","PROVIDER_POST_UNKNOWN")|not) or
      ($c[0].armed==false and
       ca_status=="NO_FILL" and
       pos_rec_state=="FLAT" and
       pos_rec_reason=="EXACT_TICKER_SETTLEMENT_CONFIRMED")) and
    ((.fireLatch.state // "NONE")!="PRE_PROVIDER_VALIDATION" or
      ($c[0].armed==false and .unresolvedEntry==true and
       ca_status=="NO_PROVIDER_EXECUTION" and
       ca_reason=="PROVIDER_RECONCILED_NO_EXECUTION" and
       ca_post!=true and
       (.fireLatch.providerPost//"NOT_STARTED")=="NOT_STARTED")) and
    (ca_post!=true or
      (ca_status|IN("NO_FILL","FILLED","CLOSED","SETTLED","NO_PROVIDER_EXECUTION"))) and
    # Frozen config: allow mismatch for SOFTWARE deployment of terminal NO_FILL + FLAT settlement.
    (.configFrozen!=true or
       (.threshold==$c[0].activeThreshold and
        .maxEntryDebitUsd==$c[0].maxEntryDebitUsd and
        .attemptTarget==$c[0].attemptTarget) or
       ($c[0].armed==false and
        ca_status=="NO_FILL" and
        pos_rec_state=="FLAT" and
        pos_rec_reason=="EXACT_TICKER_SETTLEMENT_CONFIRMED") or
       ($c[0].armed==false and .unresolvedEntry==true and
        ca_status=="NO_PROVIDER_EXECUTION" and
        ca_reason=="PROVIDER_RECONCILED_NO_EXECUTION" and
        ca_post!=true and
        (.fireLatch.state//"NONE")=="PRE_PROVIDER_VALIDATION" and
        (.fireLatch.providerPost//"NOT_STARTED")=="NOT_STARTED") or
       ($c[0].armed==false and .unresolvedEntry==false and
        (.position//null)==null and
        ca_status=="NO_PROVIDER_EXECUTION" and
        ca_reason=="PROVIDER_RECONCILED_NO_EXECUTION" and
        (.fireLatch.state//"NONE")=="INVALIDATED_BEFORE_POST" and
        .fireLatch.finalResult=="NO_PROVIDER_EXECUTION") or
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
        ((has("providerPostStarted")|not) or .providerPostStarted==false) and
        ((has("unknownProviderObligations")|not) or .unknownProviderObligations==0) and
        ((has("providerOpenOrders")|not) or .providerOpenOrders==0) and
        ((has("providerOpenPositions")|not) or .providerOpenPositions==0) and
        ((has("coordinatorActiveClaims")|not) or .coordinatorActiveClaims==0) and
        ((has("providerExposureStatus")|not) or .providerExposureStatus!="UNKNOWN") and
        ((has("providerReconciliationStatus")|not) or .providerReconciliationStatus!="UNKNOWN")) or
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
    jq -r --slurpfile c "$c" --slurpfile maintenance "$proof" '
      def ca_status: if (.currentAttempt|type)=="object" then .currentAttempt.status // "" else "" end;
      def ca_reason: if (.currentAttempt|type)=="object" then .currentAttempt.reconciliationReason // "" else "" end;
      def ca_post: if (.currentAttempt|type)=="object" then .currentAttempt.providerPostStarted else false end;
      def pos_rec_state: if (.position|type)=="object" then .position.reconciliationState // "" else "" end;
      def pos_rec_reason: if (.position|type)=="object" then .position.reconciliationReason // "" else "" end;
      if .schema!="PAYNE_REAL_SERIES_V1" then "BLOCKED: SERIES_SCHEMA"
      elif .owner!="PAYNE_KALSHI_REAL" then "BLOCKED: SERIES_OWNER"
      elif .requiredExchangeIndex!=2 then "BLOCKED: SERIES_FUNDING_INDEX"
      elif (.unresolvedEntry==true and
          ((ca_status|IN("NO_PROVIDER_EXECUTION","PROVIDER_RECONCILED_NO_EXECUTION")|not) or
           ca_reason!="PROVIDER_RECONCILED_NO_EXECUTION"))
         then "BLOCKED: HISTORICAL_UNRESOLVED_RESULT_NOT_TERMINAL"
      elif ((.position//null)!=null and
          ((.position.owner//"")!="PAYNE_KALSHI_REAL" or
           ((.position.status//""|IN("OPEN","FLAT","CLOSED","SETTLED")|not) and
            ((.position.status//"")!="RECONCILIATION_UNKNOWN" or
             $maintenance[0].allowed!=true or $c[0].armed!=false))))
         then "BLOCKED: POSITION_OWNERSHIP_OR_STATUS"
      elif (.fireLatch.state//"NONE"|IN("LATCHED","PROVIDER_POST_UNKNOWN")) and
          ($c[0].armed!=false or
           ca_status!="NO_FILL" or
           pos_rec_state!="FLAT" or
           pos_rec_reason!="EXACT_TICKER_SETTLEMENT_CONFIRMED")
         then "BLOCKED: ACTIVE_FIRE_LATCH"
      elif (.fireLatch.state//"NONE")=="PRE_PROVIDER_VALIDATION" and
          ($c[0].armed!=false or .unresolvedEntry!=true or
           ca_status!="NO_PROVIDER_EXECUTION" or
           ca_reason!="PROVIDER_RECONCILED_NO_EXECUTION" or
           ca_post==true or
           (.fireLatch.providerPost//"NOT_STARTED")!="NOT_STARTED")
         then "BLOCKED: PRE_PROVIDER_LATCH_NOT_PROVEN_MAINTENANCE_SAFE"
      elif (ca_post==true and
            (ca_status|IN("NO_FILL","FILLED","CLOSED","SETTLED","NO_PROVIDER_EXECUTION")|not))
         then "BLOCKED: PROVIDER_SUBMISSION_UNKNOWN"
      elif (.configFrozen==true and
           (.threshold!=$c[0].activeThreshold or
            .maxEntryDebitUsd!=$c[0].maxEntryDebitUsd or
            .attemptTarget!=$c[0].attemptTarget) and
           ($c[0].armed!=false or
            ca_status!="NO_FILL" or
            pos_rec_state!="FLAT" or
            pos_rec_reason!="EXACT_TICKER_SETTLEMENT_CONFIRMED"))
         then "BLOCKED: FROZEN_FOUNDER_CONFIG_MISMATCH"
      else "BLOCKED: PERSISTED_SERIES_EXPOSURE_OR_CONFIG"
      end
    ' "$s"
    exit 1
  }
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
