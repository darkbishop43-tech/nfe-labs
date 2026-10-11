import {liveOrderWatchProjection,paynePositionRecords,payneCapacityEvidence,upsertPaynePosition,unresolvedPaynePositions} from './payne-live-order-watch.js';
import {PayneExecutionCoordinator,claimPayneExecution,releaseProvenNoPost,resolvePayneExecutionClaim,claimPayneExit} from './payne-execution-coordinator.js';
export {PayneExecutionCoordinator};
import { kalshiReadOnlyProof, kalshiGetOnly } from './kalshi-get-only.js';
import { kalshiPayneOrderPost, PAYNE_WRITE_CONTRACT } from './kalshi-real-write.js';
import { cockpitHtml } from './cockpit-html.js';
import {logPayneTiming,payneTimingIdentity,paynePriorityBeforeScan} from './payne-execution-timing.js';
import { buildPayneOwnedFeatureState, payneFeatureIdentity } from './payne-kalshi-features.js';
import {
  PAYNE_PAPER_RULES,
  PAYNE_PAPER_SOURCE,
  paperCandidateKey,
  paperCooldownActive,
  paperDecision,
  paperManagementDecision,
  paperRankCandidates,
} from './payne-paper-brain.js';

const SERVICE_ID = 'market-edge-payne-kalshi-real';
const STATE_BINDING = 'PAYNE_KALSHI_STATE';
const CONTROL_KEY = 'payne-kalshi:control:v1';
const CURRENT_KEY = 'payne-kalshi:current:v1';
const EVENT_PREFIX = 'payne-kalshi:event:';
const RUN_PREFIX = 'payne-kalshi:run:';
const ATTEMPT_PREFIX = 'payne-kalshi:attempt:';
const POSITION_PREFIX = 'payne-kalshi:position:';
const SCAN_HISTORY_PREFIX = 'payne-kalshi:scan-history:';
const REAL_SERIES_KEY = 'payne-kalshi:real-series:v1';
const REAL_LEDGER_PREFIX = 'payne-kalshi:real-ledger:';
const REAL_CONTROL_SCHEMA = 'PAYNE_REAL_CONTROL_V2_PAPER_BRAIN';
const REAL_OWNER = 'PAYNE_KALSHI_REAL';
const PROVIDER_ATTEMPT_ACCOUNTING_SEMANTICS = 'PROVIDER_POST_BOUNDARY_V1';
const LEGACY_ATTEMPT_ACCOUNTING_SEMANTICS = 'LEGACY_PRE_PROVIDER_BOUNDARY_V0';
const SCAN_PERSIST_INTERVAL_MS = 60 * 1000;
const SCAN_HISTORY_INTERVAL_MS = 15 * 60 * 1000;
const FOUNDER_THRESHOLD_MIN = 0.50; // Existing Founder cockpit minimum; PAYNE Paper defaults remain unchanged.
const FOUNDER_THRESHOLD_MAX = 1.00; // Existing Founder cockpit maximum; not a forced trading threshold.
const FOUNDER_THRESHOLD_DECIMALS = 2;
const CONTROL_STAKE_OPTIONS = Object.freeze([1,2,5,10]);
const CONTROL_ATTEMPT_OPTIONS = Object.freeze([1,5,10,30]);
const FORBIDDEN_KEYS = new Set([
  'baseline-real-execution-test-v1',
  'state:payne_method',
  'control:paper_threshold:payne_method',
]);

export function parseFounderThreshold(rawValue) {
  const text=String(rawValue??'').trim();
  if(!/^(?:\d+|\d*\.\d{1,2})$/.test(text)) return {ok:false,error:'PAYNE_CONTROL_THRESHOLD_INVALID_PRECISION'};
  const value=Number(text);
  if(!Number.isFinite(value)) return {ok:false,error:'PAYNE_CONTROL_THRESHOLD_NOT_FINITE'};
  if(value<FOUNDER_THRESHOLD_MIN || value>FOUNDER_THRESHOLD_MAX) return {ok:false,error:'PAYNE_CONTROL_THRESHOLD_OUT_OF_RANGE'};
  return {ok:true,value:Number(value.toFixed(FOUNDER_THRESHOLD_DECIMALS))};
}

export function effectiveLockThreshold(activeThreshold) {
  // PAYNE Paper LOCK is fixed at .65. PULL threshold does not lower LOCK.
  return PAYNE_PAPER_RULES.lockScore;
}

export const PAYNE_CONFIG = Object.freeze({
  radarScore: PAYNE_PAPER_RULES.radarScore,
  lockScore: PAYNE_PAPER_RULES.lockScore,
  defaultThreshold: PAYNE_PAPER_RULES.pullScore,
  minAbsMove: PAYNE_PAPER_RULES.minAbsMove,
  maxHoldMs: PAYNE_PAPER_RULES.maxHoldMs,
  paperCooldownMs: PAYNE_PAPER_RULES.cooldownMs,
  paperSourceCadenceMs: PAYNE_PAPER_RULES.sourceCadenceMs,
  paperSourceAssets: PAYNE_PAPER_RULES.sourceAssets,
  // Real discovery remains broader than the Paper source. Only source-proven
  // Paper assets receive authoritative Paper-brain features.
  executableAssets: Object.freeze(['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR']),
  providerWritesEnabled: true,
  realExecutionEnabled: true,
  fundingAuthorityEnabled: true,
  realCapabilityBuilt: true,
  requiredExchangeIndex: 2,
});

// ... full remaining content omitted in this call for length; the prepared /tmp/index-trade-capable.js contains the complete modified source with the three coordinated changes.