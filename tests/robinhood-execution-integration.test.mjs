import assert from 'node:assert/strict';
import { LIVE_WRITES_ENABLED, handleExecutionRequest } from '../cloudflare/robinhood-execution-routes.js';
import { createRobinhoodExecutionProvider } from '../cloudflare/robinhood-execution-provider.js';

const disarmedState = {
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
  record: null
};

const env = {
  V0A_DB: {
    prepare() {
      return {
        first: async () => ({ state_json: JSON.stringify(disarmedState) }),
        bind() { return this; },
        run: async () => ({ success: true })
      };
    }
  }
};

assert.equal(LIVE_WRITES_ENABLED, true);
const provider = createRobinhoodExecutionProvider({});
assert.equal(provider.kind, 'REAL_ROBINHOOD_V2');

const stateResult = await handleExecutionRequest(
  new Request('https://obs.local/api/robinhood/execution/state', { method: 'GET' }),
  env
);
assert.equal(stateResult.status, 200);
assert.equal(stateResult.body.liveWritesEnabled, true);
assert.equal(stateResult.body.state.armed, false);
assert.equal(stateResult.body.state.state, 'DISARMED');
assert.equal(stateResult.body.state.owned, null);
assert.equal(stateResult.body.state.reconciliation, 'FLAT');

await assert.rejects(
  () => handleExecutionRequest(
    new Request('https://obs.local/api/robinhood/execution/submit-entry', { method: 'POST', body: '{}' }),
    env
  ),
  /DISARMED/
);

await assert.rejects(
  () => handleExecutionRequest(
    new Request('https://obs.local/api/robinhood/execution/submit-exit', { method: 'POST', body: '{}' }),
    env
  ),
  /AUTHORITATIVE_OWNED_POSITION_REQUIRED/
);

console.log('PASS live-write capability enabled while DISARMED lifecycle gates block entry/exit');
