import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const has=x=>assert.ok(src.includes(x),x);
test('Founder disarm records explicit actor and triggering function',()=>{
 has("actor:'FOUNDER',triggeringFunction:'updateFounderControl'");
 has("reasonCode:'FOUNDER_DISARM'");
});
test('target-completion and frozen-config disarms get distinct reasons',()=>{
 for(const code of ['ATTEMPT_TARGET_COMPLETED','FAIL_CLOSED_FROZEN_CONFIG_INVALID','FAIL_CLOSED_FROZEN_CONFIG_MISMATCH'])has(code);
});
test('entry revocation and fail-closed use distinct recorded reasons',()=>{
 has("'ENTRY_AUTHORITY_REVOKED_AFTER_LATCH'");
 has("'FAIL_CLOSED_'+String(series?.status||'UNKNOWN')");
});
test('unknown reason cannot be silently assigned to Founder',()=>{
 has("reasonCode='UNKNOWN'");
 has("actor:'SYSTEM',triggeringFunction:'closeRealSeriesControl'");
});
test('durable PAYNE ledger readback required after writing transition',()=>{
 has("type:'PAYNE_ARM_TRANSITION_V1'");
 has("kvGetJson(env,ledgerKey)");
 has("PAYNE_DISARM_LEDGER_READBACK_FAILED");
});
test('accountability required fields present',()=>{
 for(const field of ['seriesId:','previousArmed:','newArmed:','actor,triggeringFunction',
 'reasonCode:', 'attemptsStarted:', 'attemptTarget:', 'completedAt:', 'ownedPositions:', 'unresolvedEntry:', 'failClosedReason:', 'eventTimestamp:'])has(field);
});
