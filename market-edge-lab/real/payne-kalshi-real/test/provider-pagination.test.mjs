import test from 'node:test';
import assert from 'node:assert/strict';
import {readKalshiPages} from '../src/provider-pagination.js';
const env={};
const ok=(data)=>({ok:true,status:200,json:async()=>data});
test('exhausts cursor across all pages',async()=>{
  const paths=[];
  const get=async(_env,path)=>{
    paths.push(path);
    return ok(paths.length===1?{orders:[{order_id:'a'}],cursor:'next'}:{orders:[{order_id:'b'}],cursor:''});
  };
  const r=await readKalshiPages(get,env,'/trade-api/v2/portfolio/orders',{collection:'orders',query:{subaccount:0}});
  assert.equal(r.ok,true);assert.equal(r.paginationComplete,true);assert.equal(r.pages,2);
  assert.deepEqual(r.rows.map(x=>x.order_id),['a','b']);
  assert.match(paths[1],/cursor=next/);
});
test('fails closed on HTTP failure after a successful page',async()=>{
  let n=0;
  const r=await readKalshiPages(async()=>++n===1?ok({orders:[{}],cursor:'next'}):{ok:false,status:403},env,'/trade-api/v2/portfolio/orders',{collection:'orders'});
  assert.equal(r.ok,false);assert.equal(r.paginationComplete,false);assert.deepEqual(r.rows,[]);
});
test('fails closed on repeated cursor',async()=>{
  const r=await readKalshiPages(async()=>ok({fills:[{}],cursor:'repeat'}),env,'/trade-api/v2/portfolio/fills',{collection:'fills'});
  assert.equal(r.ok,false);assert.equal(r.reason,'CURSOR_REPEATED');
});
test('fails closed on ambiguous schema',async()=>{
  const r=await readKalshiPages(async()=>ok({orders:{},cursor:''}),env,'/trade-api/v2/portfolio/orders',{collection:'orders'});
  assert.equal(r.ok,false);assert.equal(r.reason,'PROVIDER_SCHEMA_AMBIGUOUS');
});
test('fails closed at safety page limit',async()=>{
  let n=0;
  const r=await readKalshiPages(async()=>ok({orders:[],cursor:'c'+(++n)}),env,'/trade-api/v2/portfolio/orders',{collection:'orders',maxPages:2});
  assert.equal(r.ok,false);assert.equal(r.reason,'PAGINATION_SAFETY_LIMIT');
});
test('never makes writes',async()=>{
  let calls=0;
  await readKalshiPages(async()=>{calls++;return ok({positions:[],cursor:''});},env,'/trade-api/v2/portfolio/positions',{collection:'positions'});
  assert.equal(calls,1);
});
