import test from 'node:test';
import assert from 'node:assert/strict';
import {payneTimingIdentity,payneTimingEvent,paynePriorityBeforeScan} from '../src/payne-execution-timing.js';
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

test('persisted FIRE latch executes ahead of slow scan; incomplete latch waits for scan',()=>{
 const control={armed:true};
 assert.equal(paynePriorityBeforeScan(control,{fireLatch:{state:'LATCHED'}}),true);
 assert.equal(paynePriorityBeforeScan(control,{fireLatch:{state:'PRE_PROVIDER_VALIDATION'}}),false);
 assert.equal(paynePriorityBeforeScan(control,{fireLatch:{state:'LATCHED'},position:null}),true);
 assert.equal(paynePriorityBeforeScan({armed:false},{fireLatch:{state:'LATCHED'}}),false);
});
test('management and unresolved reconciliation get priority irrespective of scan state',()=>{
 assert.equal(paynePriorityBeforeScan({armed:false},{position:{status:'OPEN'}}),true);
 assert.equal(paynePriorityBeforeScan({armed:false},{position:{status:'EXIT_RETRY'}}),true);
 assert.equal(paynePriorityBeforeScan({armed:false},{unresolvedEntry:true}),true);
 assert.equal(paynePriorityBeforeScan({armed:true},{position:{status:'FLAT'},unresolvedEntry:false}),false);
});
