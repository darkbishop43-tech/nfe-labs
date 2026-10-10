import test from 'node:test';
import assert from 'node:assert/strict';
import {payneTimingIdentity,payneTimingEvent} from '../src/payne-execution-timing.js';
test('correlates exact series/attempt/ticker/side/window without provider credentials',()=>{
 const id=payneTimingIdentity({seriesId:'series-1',attemptsStarted:2},{ticker:'KXETH15M-A',outcomeSide:'NO',marketCloseTime:'2026-10-09T23:15:00Z'});
 assert.deepEqual(id,{seriesId:'series-1',attemptNo:3,ticker:'KXETH15M-A',side:'NO',windowClose:'2026-10-09T23:15:00Z'});
 const evt=payneTimingEvent('FRESH_LOCK_READ',id,100,137,'READ_OK');
 assert.equal(evt.elapsedMs,37);
 assert.equal(evt.stage,'FRESH_LOCK_READ');
 assert.equal(JSON.stringify(evt).includes('PRIVATE_KEY'),false);
});
test('negative clock drift reports zero, invalid stage sanitized',()=>{
 assert.equal(payneTimingEvent('A!?',{},100,50).elapsedMs,0);
 assert.equal(payneTimingEvent('A!?',{},100,50).stage,'A');
});
