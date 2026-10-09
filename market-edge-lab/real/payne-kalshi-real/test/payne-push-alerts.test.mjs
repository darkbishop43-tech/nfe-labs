import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPayneRealAlert,dedupePayneAlert} from '../src/payne-push-alerts.js';
const base={seriesId:'SERIES-REAL-1',attemptId:'ATT-1',ticker:'KXBTC15M-EXAMPLE',asset:'BTC',direction:'UP',at:'2026-10-09T10:00:00Z'};
test('PAYNE notifications require authoritative persisted event classifications',()=>{
  assert.equal(classifyPayneRealAlert({...base,type:'FIRE_SPECIMEN_LATCHED'}),null);
  assert.equal(classifyPayneRealAlert({...base,type:'ENTRY_PRE_SUBMIT_LATCHED'}),null);
  assert.equal(classifyPayneRealAlert({...base,type:'EXIT_PRE_SUBMIT_LATCHED'}),null);
  assert.equal(classifyPayneRealAlert({...base,type:'ENTRY_PROVIDER_POST_STARTED'}).category,'ORDER_SUBMITTED');
  assert.equal(classifyPayneRealAlert({...base,type:'ENTRY_NO_FILL'}).category,'NO_FILL');
  assert.equal(classifyPayneRealAlert({...base,type:'ENTRY_WRITE_ERROR_UNKNOWN'}).category,'CHECK_KALSHI');
  assert.equal(classifyPayneRealAlert({...base,type:'POSITION_OWNERSHIP_ESTABLISHED'}),null);
  assert.equal(classifyPayneRealAlert({...base,type:'POSITION_OWNERSHIP_ESTABLISHED',entryOrderId:'PROVIDER-1'}).category,'FILLED');
  assert.equal(classifyPayneRealAlert({...base,type:'PAYNE_PAPER_BRAIN_EXIT_CLOSED'}),null);
  assert.equal(classifyPayneRealAlert({...base,type:'PAYNE_PAPER_BRAIN_EXIT_CLOSED',status:'CLOSED'}).category,'CLOSED');
  assert.equal(classifyPayneRealAlert({...base,type:'EXIT_PROVIDER_RESULT',result:{state:'UNKNOWN'}}),null);
  assert.equal(classifyPayneRealAlert({...base,type:'EXIT_PROVIDER_RESULT',result:{orderId:'EXIT-1'}}).category,'EXIT_SUBMITTED');
});
test('dedupe is identity-based; notifications carry no trading or personal account data',()=>{
  const alert=classifyPayneRealAlert({...base,type:'ENTRY_NO_FILL'});
  assert.match(alert.title,/PAYNE REAL/);
  assert.match(alert.source,/PAYNE_REAL/);
  assert.equal(dedupePayneAlert(alert,new Set()),true);
  assert.equal(dedupePayneAlert(alert,new Set([alert.id])),false);
  assert.equal(alert.url,'/');
  assert.doesNotMatch(JSON.stringify(alert),/secret|api.key|balance|funding/i);
});
