import assert from 'node:assert/strict';
import { LIVE_WRITES_ENABLED, handleExecutionRequest } from '../cloudflare/robinhood-execution-routes.js';
import { createRobinhoodExecutionProvider } from '../cloudflare/robinhood-execution-provider.js';

assert.equal(LIVE_WRITES_ENABLED, false);
const provider = createRobinhoodExecutionProvider({});
assert.equal(provider.kind, 'REAL_ROBINHOOD_V2');
const blocked = await handleExecutionRequest(new Request('https://obs.local/api/robinhood/execution/submit-entry', { method: 'POST', body: '{}' }), {});
assert.equal(blocked.status, 403);
assert.equal(blocked.body.error, 'LIVE_WRITES_DISABLED');
assert.equal(blocked.body.capitalMoved, 'USD 0.00');
console.log('PASS integration refuses provider writes while disarmed');
