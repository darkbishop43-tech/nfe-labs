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
  jq -e '
    .realControlSchema=="PAYNE_REAL_CONTROL_V2_PAPER_BRAIN" and
    .armed==false and
    .openPositions==0 and
    .requiredExchangeIndex==2 and
    (.activeThreshold|type=="number" and .>=0.50 and .<=1) and
    (.attemptTarget|type=="number" and .>=1 and .==floor) and
    (.maxEntryDebitUsd|type=="number" and .>0) and
    (.scanEnabled==true)
  ' "$c" >/dev/null || { echo 'BLOCKED: PERSISTED_CONTROL_SAFETY';exit 1; }
  jq -e --slurpfile c "$c" '
    .schema=="PAYNE_REAL_SERIES_V1" and
    .owner=="PAYNE_KALSHI_REAL" and
    .requiredExchangeIndex==2 and
    # Maintenance deployment is NOT permission to enter. Preserve unresolvedEntry.
    # An unresolved terminal historical result is permitted only while DISARMED;
    # active/submitting coordinator obligations retain their separate interlocks.
    (.unresolvedEntry==false or
      (.unresolvedEntry==true and $c[0].armed==false and
       (.currentAttempt.status//""|IN("NO_PROVIDER_EXECUTION","PROVIDER_RECONCILED_NO_EXECUTION")) and
       (.currentAttempt.reconciliationReason//""|IN("PROVIDER_RECONCILED_NO_EXECUTION")))) and
    ((.position // null)==null or
      ((.position.owner//"")=="PAYNE_KALSHI_REAL" and
       (.position.status//""|IN("OPEN","FLAT","CLOSED","SETTLED")))) and
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
    (.configFrozen!=true or
       (.threshold==$c[0].activeThreshold and
        .maxEntryDebitUsd==$c[0].maxEntryDebitUsd and
        .attemptTarget==$c[0].attemptTarget))
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
         then "BLOCKED: FROZEN_FOUNDER_CONFIG_MISMATCH"
      else "BLOCKED: PERSISTED_SERIES_EXPOSURE_OR_CONFIG"
      end
    ' "$s"
    exit 1
  }
  # The live Worker scheduler persists this heartbeat every minute. The
  # existing Paper source cadence is 300000ms, not a new trading value.
  local observed_ms now_ms age_ms
  if ! observed_ms="$(date -u -d "$(jq -r '.at//empty' "$x")" +%s%3N 2>/dev/null)";then echo 'BLOCKED: INVALID_SCAN_TIMESTAMP';exit 1;fi
  now_ms="$(date -u +%s%3N)"
  age_ms="$((now_ms-observed_ms))"
  if [[ "$age_ms" -lt 0 || "$age_ms" -gt 300000 ]];then echo 'BLOCKED: STALE_OR_FUTURE_SCHEDULER_HEARTBEAT';exit 1;fi
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
