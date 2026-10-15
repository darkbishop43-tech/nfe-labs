import test from 'node:test';
import assert from 'node:assert/strict';
import {readPagedKalshiIdentities,readKalshiIdentityBundle} from '../src/provider-identity-pagination.js';
const response=(rows,cursor='',field='orders',status=200)=>({ok:status===200,status,async json(){return {[field]:rows,cursor}}});
test('complete order history through multiple and empty pages preserves raw IDs',async()=>{
 const read=async url=>{
  const p=new URL(url,'https://kalshi.test'),cursor=p.searchParams.get('cursor')||'';
  assert.equal(p.searchParams.get('ticker'),'KXTEST');
  if(!cursor)return response([{ticker:'KXTEST',order_id:'abc',client_order_id:'nfe-test-legacy',fill_count:2,remaining_count:1}],'next');
  if(cursor==='next')return response([],'end');
  return response([{ticker:'KXTEST',order_id:'xyz',client_order_id:'unknown-manual'}]);
 };
 const r=await readPagedKalshiIdentities(read,'activeOrders',{ticker:'KXTEST'});
 assert.equal(r.complete,true);assert.equal(r.pages,3);assert.equal(r.rows.length,2);
 assert.equal(r.rows[0].fill_count,2);assert.equal(r.rows[0].client_order_id,'nfe-test-legacy');
});
test('repeated cursor fails incomplete',async()=>{
 const r=await readPagedKalshiIdentities(async()=>response([],'loop'),'activeOrders',{ticker:'KXTEST'});
 assert.equal(r.complete,false);assert.equal(r.reason,'PROVIDER_CURSOR_REPEATED');
});
test('HTTP failure and unknown schema fail closed',async()=>{
 const bad=await readPagedKalshiIdentities(async()=>response([],null,'orders',503),'activeOrders',{ticker:'KXTEST'});
 assert.equal(bad.complete,false);
 const schema=await readPagedKalshiIdentities(async()=>({ok:true,status:200,json:async()=>({wrong:[],cursor:''})}),'fills',{ticker:'KXTEST'});
 assert.equal(schema.reason,'PROVIDER_SCHEMA_UNKNOWN');
});
test('page cap prevents falsely complete history',async()=>{
 const r=await readPagedKalshiIdentities(async()=>response([],'next'),'activeOrders',{ticker:'KXTEST',maxPages:1});
 assert.equal(r.complete,false);assert.equal(r.reason,'PROVIDER_PAGE_LIMIT_REACHED');
});
test('bundle merges four separately paginated collections without assigning ownership',async()=>{
 const fn=async url=>response([{ticker:'KXTEST',order_id:'id1',fill_id:'fill1',client_order_id:null}], '',url.includes('fills')?'fills':'orders');
 const b=await readKalshiIdentityBundle(fn,{ticker:'KXTEST'});
 assert.equal(b.complete,true);assert.equal(b.rawOrderCount,2);assert.equal(b.rawFillCount,2);
 assert.equal(b.kinds.historicalFills.rows[0].fill_id,'fill1');
});
test('bundle is incomplete if historical orders unavailable',async()=>{
 const fn=async url=>url.includes('historical/orders')?{ok:false,status:404,json:async()=>({})}:response([], '',url.includes('fills')?'fills':'orders');
 const b=await readKalshiIdentityBundle(fn,{ticker:'KXTEST'});
 assert.equal(b.complete,false);assert.equal(b.kinds.historicalOrders.reason,'PROVIDER_HTTP_FAILURE');
});
