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
  echo "DEBUG_SERIES_ROOT_TYPE=$(jq -r 'type' "$s")"
  echo "DEBUG_CURRENT_ATTEMPT_TYPE=$(jq -r '.currentAttempt|type' "$s" 2>/dev/null || echo FAIL)"
  echo "DEBUG_POSITION_TYPE=$(jq -r '.position|type' "$s" 2>/dev/null || echo FAIL)"
  echo "DEBUG_FIRE_LATCH_TYPE=$(jq -r '.fireLatch|type' "$s" 2>/dev/null || echo FAIL)"
  echo "DEBUG_KEYS=$(jq -c 'keys' "$s")"
  echo "DEBUG_CA_STATUS=$(jq -r 'if (.currentAttempt|type)=="object" then .currentAttempt.status // "NONE" else "NOT_OBJECT" end' "$s" 2>/dev/null || echo FAIL)"
  echo "DEBUG_POS_REC=$(jq -r 'if (.position|type)=="object" then .position.reconciliationState // "NONE" else "NOT_OBJECT" end' "$s" 2>/dev/null || echo FAIL)"
  local proof="${PAYNE_MAINTENANCE_PROOF_FILE:-/tmp/payne-kv-gate/maintenance-proof.json}"
  if [[ ! -f "$proof" ]];then printf '%s\n' '{"allowed":false}' > "$proof";fi
  echo 'DEBUG_DUMP_COMPLETE'
  exit 0
}
read_payne_kv 'payne-kalshi:control:v1' control
read_payne_kv 'payne-kalshi:real-series:v1' series
read_payne_kv 'payne-kalshi:current:v1' current
verify_safety
