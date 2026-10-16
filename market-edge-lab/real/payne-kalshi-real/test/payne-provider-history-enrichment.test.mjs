import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichPayneCycles,readPayneProviderHistory} from '../src/payne-provider-history-enrichment.js';
const base={seriesId:'s',attemptId:'a',ticker:'KXNEAR15M-26OCT151845-45',side:'NO',clientOrderId:'payne-a-1',providerOrderId:'entry-1',realizedPnlUsd:null};
const order={order_id:'entry-1',client_order_id:'payne-a-1',ticker:base.ticker,outcome_side:'no',side:'buy',status:'executed'};
const fill=(id,count,price)=>({fill_id:id,order_id:'entry-1',ticker:base.ticker,outcome_side:'no',count,no_price_dollars:price,fee_cost_dollars:'0.01',created_time:'2026-10-15T22:10:00Z'});
test('strict order identity and partial fill aggregation',()=>{
 const [r]=enrichPayneCycles([base],{orders:[order],fills:[fill('f1',2,'0.65'),fill('f2',1,'0.62')],historicalFills:[fill('f1',2,'0.65')]},{coverage:'PROVIDER_READS_COMPLETE',readAt:'now'});
 assert.equal(r.quantity,3);assert.ok(Math.abs(r.entryPrice-0.64)<1e-9);assert.equal(r.entryFeesUsd,0.02);assert.equal(r.exitPrice,null);assert.equal(r.realizedPnlUsd,null);assert.match(r.coverage,/EXIT_UNMATCHED/);
});
test('rejects same contract but different order / AUTO trade',()=>{
 const [r]=enrichPayneCycles([base],{orders:[{...order,order_id:'auto-1',client_order_id:'auto-other'}],fills:[fill('f1',2,'0.65')]});
 assert.equal(r.entryPrice,undefined);assert.deepEqual(r.missingProviderFields,['ENTRY_ORDER_NOT_FOUND']);
});
test('do not infer value without provider order identity',()=>{
 const [r]=enrichPayneCycles([{...base,clientOrderId:null,providerOrderId:null}],{orders:[order],fills:[fill('f1',1,'0.65')]});
 assert.equal(r.coverage,'MISSING_PAYNE_ORDER_IDENTITY');
});
test('missing fee produces unknown, no fabricated P/L',()=>{
 const f=fill('f1',1,'0.65');delete f.fee_cost_dollars;
 const [r]=enrichPayneCycles([base],{orders:[order],fills:[f]});
 assert.equal(r.entryFeesUsd,null);assert.equal(r.realizedPnlUsd,null);
});
test('provider reads handle pages and missing historical coverage',async()=>{
 const history=[];
 const mock=async p=>{
  history.push(p);
  if(p.includes('/historical/fills'))return {ok:false,status:403};
  const key=p.includes('/orders')?'orders':p.includes('/positions')?'market_positions':'fills';
  const cursor=p.includes('cursor=next');
  return {ok:true,json:async()=>({[key]:[],cursor:key==='orders'&&!cursor?'next':''})};
 };
 const r=await readPayneProviderHistory(mock);
 assert.equal(r.complete,false);assert.match(r.coverage,/historicalFills:HTTP_403/);
 assert.ok(history.some(x=>x.includes('cursor=next')));
});
