import assert from 'node:assert/strict';
import { LIVE_WRITES_ENABLED, handleExecutionRequest } from '../cloudflare/robinhood-execution-routes.js';
import { createRobinhoodExecutionProvider } from '../cloudflare/robinhood-execution-provider.js';

const initialState = {
  armed: false,
  state: 'DISARMED',
  specimen: null,
  specimenFp: null,
  approval: null,
  entryIntent: null,
  provider: null,
  owned: null,
  exitIntent: null,
  reconciliation: 'FLAT',
  record: null,
  runConfig: null,
  run: { targetRuns: null, completedRuns: 0, remainingRuns: 0, runStatus: 'NOT_CONFIGURED' },
  rev: 0
};

let durable = structuredClone(initialState);
const events=[];
const TOKEN = 'f'.repeat(32);
const H = { authorization: 'Bearer ' + TOKEN };
const env = {
  FOUNDER_EXEC_TOKEN: TOKEN,
  V0A_DB: {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args=args; return this; },
        async first() {
          if (sql.includes('SELECT state_json')) return { state_json: JSON.stringify(durable) };
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO robinhood_execution_control')) {
            durable=JSON.parse(this.args[0]);
          } else if (sql.includes('INSERT INTO robinhood_execution_events')) {
            events.push({type:this.args[1],payload:this.args[2]});
          }
          return { success:true, meta:{changes:1} };
        }
      };
    }
  }
};

assert.equal(LIVE_WRITES_ENABLED, true);
const provider = createRobinhoodExecutionProvider({});
assert.equal(provider.kind, 'REAL_ROBINHOOD_V2');

const before = await handleExecutionRequest(
  new Request('https://obs.local/api/robinhood/execution/state', { method: 'GET' }),
  env
);
assert.equal(before.body.execution, 'DISARMED');
assert.equal(before.body.armed, false);
assert.equal(before.body.state.armed, false);
assert.equal(before.body.state.reconciliation, 'FLAT');

const unauth = await handleExecutionRequest(new Request('https://obs.local/api/robinhood/execution/arm', { method: 'POST', body: '{}' }), env);
assert.equal(unauth.status, 401);
const noSecret = await handleExecutionRequest(new Request('https://obs.local/api/robinhood/execution/arm', { method: 'POST', body: '{}', headers: H }), { ...env, FOUNDER_EXEC_TOKEN: undefined });
assert.equal(noSecret.status, 503);
await assert.rejects(() => handleExecutionRequest(new Request('https://obs.local/api/robinhood/execution/arm', { method: 'POST', body: '{}', headers: H }), env), /ARM_REQUIRES_FROZEN_RUN_CONFIG/);
const cfg = await handleExecutionRequest(new Request('https://obs.local/api/robinhood/execution/run-config', { method: 'POST', headers: H, body: JSON.stringify({ targetRuns: 7, stake: 2, entryType: 'market', exitCondition: 'time', exitValue: '30m', exitType: 'market' }) }), env);
assert.equal(cfg.status, 200); assert.equal(cfg.body.run.targetRuns, 7); assert.equal(cfg.body.run.remainingRuns, 7); assert.equal(cfg.body.runConfig.frozen, true);
const armed = await handleExecutionRequest(
  new Request('https://obs.local/api/robinhood/execution/arm', { method: 'POST', body: '{}', headers: H }),
  env
);
assert.equal(armed.status, 200);
assert.equal(armed.body.execution, 'ARMED');
assert.equal(armed.body.armed, true);
assert.equal(armed.body.state.armed, true);
assert.equal(armed.body.state.state, 'ARMED');

const readArmed = await handleExecutionRequest(
  new Request('https://obs.local/api/robinhood/execution/state', { method: 'GET' }),
  env
);
assert.equal(readArmed.body.execution, 'ARMED');
assert.equal(readArmed.body.armed, true);
assert.equal(readArmed.body.state.state, 'ARMED');

const disarmed = await handleExecutionRequest(
  new Request('https://obs.local/api/robinhood/execution/disarm', { method: 'POST', body: '{}', headers: H }),
  env
);
assert.equal(disarmed.status, 200);
assert.equal(disarmed.body.execution, 'DISARMED');
assert.equal(disarmed.body.armed, false);
assert.equal(disarmed.body.state.state, 'DISARMED');

const readDisarmed = await handleExecutionRequest(
  new Request('https://obs.local/api/robinhood/execution/state', { method: 'GET' }),
  env
);
assert.equal(readDisarmed.body.execution, 'DISARMED');
assert.equal(readDisarmed.body.armed, false);
assert.equal(readDisarmed.body.state.owned, null);
assert.equal(readDisarmed.body.state.reconciliation, 'FLAT');
assert.equal(readDisarmed.body.state.entryIntent, null);
assert.equal(readDisarmed.body.state.exitIntent, null);

await assert.rejects(
  () => handleExecutionRequest(
    new Request('https://obs.local/api/robinhood/execution/submit-entry', { method: 'POST', body: '{}', headers: H }),
    env
  ),
  /DISARMED/
);

await assert.rejects(
  () => handleExecutionRequest(
    new Request('https://obs.local/api/robinhood/execution/submit-exit', { method: 'POST', body: '{}', headers: H }),
    env
  ),
  /AUTHORITATIVE_OWNED_POSITION_REQUIRED/
);

assert.equal(events.filter(x=>x.type==='ARMED').length,1);
assert.equal(events.filter(x=>x.type==='DISARMED').length,1);

console.log('PASS ARM persists to D1 readback, DISARM persists, and zero provider orders are created');
