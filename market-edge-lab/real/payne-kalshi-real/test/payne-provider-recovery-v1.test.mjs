import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProviderTerminalExit,readRecoveryPages} from '../src/payne-provider-recovery-v1.js';
import {recoverPayneProviderConfirmedExits} from '../src/payne-recovery-orchestrator.js';

const c={kind:'EXIT',seriesId:'s1',attemptNo:1,specimenId:'s1-intent-1',
 clientOrderId:'payne-real-s1-1-exit1',ticker:'KXNEAR15M-TEST',side:'YES',claimState:'POTENTIALLY_SUBMITTED'};
const p={owner:'PAYNE_KALSHI_REAL',seriesId:'s1',attemptNo:1,attemptId:'s1-intent-1',
 exitClientOrderId:c.clientOrderId,marketTicker:c.ticker,outcomeSide:c.side,status:'RECONCILIATION_UNKNOWN',
 reconciliationState:'UNKNOWN',entryOrderId:'entry-1'};
const evidence={ok:true,complete:true,status:'PROVIDER_VERIFIED_TERMINAL',resolution:'CLOSED',
 providerOrderId:'exit-order-1',evidenceId:'proof-1',executedFills:1};
function fakeProvider({missing=false,open=false,position=0,zeroFill=false,badCursor=false}={}){
 return async (_env,path)=>{
  const json=(field,rows)=>new Response(JSON.stringify({[field]:rows,cursor:badCursor?null:''}),{status:200});
  if(path.includes('portfolio/orders'))return json('orders',missing?[]:[{
   order_id:'exit-order-1',client_order_id:c.clientOrderId,ticker:c.ticker,side:'yes',
   action:'sell',status:open?'resting':'executed',fill_count:zeroFill?0:1}]);
  if(path.includes('historical/orders'))return json('orders',[]);
  if(path.includes('portfolio/fills'))return json('fills',zeroFill?[]:[{
   fill_id:'fill-1',order_id:'exit-order-1',ticker:c.ticker,side:'yes',count:1}]);
  if(path.includes('historical/fills'))return json('fills',[]);
  if(path.includes('portfolio/positions'))return json('market_positions',[{ticker:c.ticker,position}]);
  if(path.includes('portfolio/settlements'))return json('settlements',[{ticker:c.ticker}]);
  throw new Error('UNEXPECTED_GET');
 };
}
function recoveryFixture({crashOnce=false,wrongPosition=false}={}){
 let stored={seriesId:'s1',position:{...p},positions:[wrongPosition?{...p,marketTicker:'KXZEC'}:{...p}],
  fireLatch:{specimenId:'unrelated-intent-3',state:'LATCHED'}};
 let commits=0,puts=0,records=0,crashed=false;
 const claim={...c};
 const deps={
  loadControl:async()=>({armed:false}),
  loadSeries:async()=>structuredClone(stored),
  saveSeries:async(_env,next)=>{puts++;if(crashOnce&&!crashed){crashed=true;throw Error('CRASH_AFTER_DO_BEFORE_KV');}stored=structuredClone(next);},
  recordRecoveryLedger:async()=>{records++;},
  inspectSeries:async()=>({ok:true,complete:true,claims:[{...c,state:'POTENTIALLY_SUBMITTED'}]}),
  inspectExit:async()=>({ok:true,status:'FOUND',claim}),
  verifyProvider:async()=>({...evidence}),
  resolveExit:async(_env,_identity,_proof,opts={})=>{
   if(!opts.markProjected)commits++;
   return {granted:true,reason:opts.markProjected?'RECOVERY_PROJECTION_APPLIED':'PROVIDER_TERMINAL_EXIT_PERSISTED'};
  }
 };
 return {deps,stats:()=>({commits,puts,records,stored})};
}
test('1 exact provider exit order, fills, and flat position returns CLOSED',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get:fakeProvider()});
 assert.equal(proof.ok,true);assert.equal(proof.executedFills,1);assert.equal(proof.resolution,'CLOSED');
});
test('2 wrong contract identity is never joined',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:{...p,marketTicker:'KXZEC'},get:fakeProvider()});
 assert.equal(proof.status,'UNKNOWN');
});
test('3 missing exact order cannot prove flat',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get:fakeProvider({missing:true})});
 assert.equal(proof.status,'UNKNOWN');
});
test('4 nonterminal provider order retains unknown',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get:fakeProvider({open:true})});
 assert.equal(proof.status,'UNKNOWN');
});
test('5 zero fill without provider flat cannot resolve exposure',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get:fakeProvider({zeroFill:true,position:1})});
 assert.equal(proof.status,'UNKNOWN');
});
test('6 verified terminal zero-fill plus flat position is separately classified',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get:fakeProvider({zeroFill:true})});
 assert.equal(proof.resolution,'NO_PROVIDER_EXECUTION');
});
test('7 malformed pagination is never complete',async()=>{
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get:fakeProvider({badCursor:true})});
 assert.equal(proof.status,'UNKNOWN');
});
test('8 exact provider proof applies retained position and never touches unrelated latch',async()=>{
 const f=recoveryFixture(),res=await recoverPayneProviderConfirmedExits({},f.deps);
 assert.equal(res.ok,true);assert.equal(f.stats().stored.positions[0].status,'CLOSED');
 assert.equal(f.stats().stored.fireLatch.state,'LATCHED');
});
test('9 interrupted KV projection can retry without requiring new provider order',async()=>{
 const f=recoveryFixture({crashOnce:true});
 await assert.rejects(recoverPayneProviderConfirmedExits({},f.deps),/CRASH_AFTER_DO_BEFORE_KV/);
 const result=await recoverPayneProviderConfirmedExits({},f.deps);
 assert.equal(result.ok,true);assert.equal(f.stats().stored.positions[0].reconciliationState,'FLAT');
});
test('10 mismatched retained position blocks DO commit',async()=>{
 const f=recoveryFixture({wrongPosition:true}),res=await recoverPayneProviderConfirmedExits({},f.deps);
 assert.equal(res.ok,false);assert.equal(f.stats().commits,0);
});

test('11 pre-KV crash retains exact deterministic exit ownership without stored exit client ID',async()=>{
 const f=recoveryFixture();
 const original=f.deps.loadSeries;
 f.deps.loadSeries=async env=>{
  const state=await original(env);
  delete state.position.exitClientOrderId;
  delete state.positions[0].exitClientOrderId;
  return state;
 };
 const result=await recoverPayneProviderConfirmedExits({},f.deps);
 assert.equal(result.ok,true);
 assert.equal(f.stats().stored.positions[0].status,'CLOSED');
});

test('12 ZEC-like exact executed exit survives paginated orders and deduplicated fills',async()=>{
 const ticker='KXZEC15M-26OCT210030-30',clientId='payne-real-ea08ebab63a3-1-exit1';
 const claim={...c,seriesId:'zec-series',specimenId:'zec-series-intent-2',ticker,clientOrderId:clientId,side:'NO'};
 const pos={...p,seriesId:'zec-series',attemptId:claim.specimenId,ticker,marketTicker:ticker,outcomeSide:'NO',exitClientOrderId:clientId};
 const order={order_id:'01a15cb8-5250-7d03-b3fd-2577e000c60c',client_order_id:clientId,ticker,side:'no',action:'sell',status:'executed',fill_count:1};
 const fill={fill_id:'zec-fill-1',order_id:order.order_id,client_order_id:clientId,ticker,side:'no',count:1};
 const get=async (_env,path)=>{
  let field,rows=[],cursor='';
  if(path.includes('/portfolio/orders')){field='orders';if(!path.includes('&cursor='))cursor='next';else rows=[order];}
  else if(path.includes('/historical/orders')){field='orders';rows=[order];}
  else if(path.includes('/portfolio/fills')){field='fills';rows=[fill];}
  else if(path.includes('/historical/fills')){field='fills';rows=[fill];}
  else if(path.includes('/portfolio/positions')){field='market_positions';rows=[];}
  else if(path.includes('/portfolio/settlements')){field='settlements';rows=[{ticker}];}
  return new Response(JSON.stringify({[field]:rows,cursor}),{status:200});
 };
 const proof=await verifyProviderTerminalExit({}, {claim,position:pos,get});
 assert.equal(proof.ok,true);assert.equal(proof.providerOrderId,order.order_id);
 assert.equal(proof.executedFills,1);assert.equal(proof.settlementMatched,true);
});
test('13 incomplete provider cursor fails closed',async()=>{
 const get=async()=>new Response(JSON.stringify({orders:[],cursor:'still-more'}),{status:200});
 const r=await readRecoveryPages({},'/trade-api/v2/portfolio/orders','orders',{get,maxPages:2});
 assert.equal(r.ok,false);assert.equal(r.reason,'PROVIDER_CURSOR_REPEATED');
});
test('14 conflicting duplicate fill IDs fail closed',async()=>{
 const get=async (_env,path)=>{
  const field=path.includes('orders')?'orders':path.includes('fills')?'fills':path.includes('positions')?'market_positions':'settlements';
  const rows=field==='orders'?(path.includes('historical')?[]:[{order_id:'exit-order-1',client_order_id:c.clientOrderId,ticker:c.ticker,side:'yes',action:'sell',status:'executed',fill_count:1}]):field==='fills'?[{fill_id:'reused',order_id:'exit-order-1',ticker:c.ticker,side:'yes',count:path.includes('historical')?2:1}]:field==='market_positions'?[{ticker:c.ticker,position:0}]:[{ticker:c.ticker}];
  return new Response(JSON.stringify({[field]:rows,cursor:''}),{status:200});
 };
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get});
 assert.equal(proof.status,'UNKNOWN');assert.equal(proof.reason,'FILL_DUPLICATE_ID_CONFLICT');
});
test('15 wrong provider order cannot satisfy exact exit proof',async()=>{
 const get=async (_env,path)=>{
  const field=path.includes('orders')?'orders':path.includes('fills')?'fills':path.includes('positions')?'market_positions':'settlements';
  const rows=field==='orders'?(path.includes('historical')?[]:[{order_id:'other-order',client_order_id:'other-client',ticker:c.ticker,side:'yes',status:'executed',fill_count:1}]):field==='market_positions'?[]:field==='settlements'?[{ticker:c.ticker}]:[];
  return new Response(JSON.stringify({[field]:rows,cursor:''}),{status:200});
 };
 const proof=await verifyProviderTerminalExit({}, {claim:c,position:p,get});
 assert.equal(proof.ok,false);assert.equal(proof.reason,'EXACT_EXIT_ORDER_NOT_ESTABLISHED');
});
