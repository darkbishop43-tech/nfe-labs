import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {runPayneRealExecutionCycle,defaultControlState,defaultRealSeriesState} from '../src/index.js';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const privatePem=privateKey.export({type:'pkcs8',format:'pem'});
const CONTROL='payne-kalshi:control:v1', SERIES='payne-kalshi:real-series:v1';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function fixture({mode='flat',pages=null,orders=[],direct=true,armed=false,attempts=2}={}){
 const seriesId='offline-closure-case',ticker='KXNEAR15M-OFFLINE-CLOSURE',attemptId='offline-intent-2';
 const position={schema:'PAYNE_REAL_POSITION_V1',owner:'PAYNE_KALSHI_REAL',exchangeIndex:2,
  seriesId,attemptId,attemptNo:2,status:'OPEN',marketTicker:ticker,outcomeSide:'NO',
  entryOrderId:'offline-provider-filled',entryClientOrderId:'offline-client-entry',
  entryFireSpecimenId:'offline-fire',marketCloseTime:'2026-10-13T05:00:00Z',
  filledCount:1,entryAverageFillPrice:0.79,entryTime:'2026-10-13T04:00:00Z',
  reconciliationState:'OPEN_PENDING_PROVIDER_RECONCILIATION'};
 const control={...defaultControlState(),armed,attemptTarget:5,attempts,openPositions:1,activeThreshold:.6};
 const series={...defaultRealSeriesState(),seriesId,attemptTarget:5,attemptsStarted:attempts,
  threshold:.6,configFrozen:true,position,positions:[position],status:'MANAGING_POSITION_SERIES_CONTINUES'};
 const attempt={runId:seriesId,intentNo:2,attemptNo:2,attemptId,
  providerOrderId:position.entryOrderId,clientOrderId:position.entryClientOrderId,
  executionHandoff:direct?'DIRECT_KALSHI_WRITER_V1':'LEGACY_COORDINATOR'};
 const state=new Map([[CONTROL,JSON.stringify(control)],[SERIES,JSON.stringify(series)],
  ['payne-kalshi:attempt:'+seriesId+':intent:2',JSON.stringify(attempt)]]);
 const requests=[];
 const provider=async(url,init={})=>{
  const path=new URL(String(url));requests.push({path:path.pathname+path.search,method:init.method||'GET'});
  assert.equal(init.method||'GET','GET','offline closure may not POST');
  if(path.pathname.endsWith('/portfolio/positions')){
   if(mode==='failed')return json({error:'offline failure'},503);
   if(mode==='unknown')return json({unexpected:true});
   if(mode==='absent')return json({market_positions:[],cursor:''});
   return json({market_positions:[{ticker,position_fp:'0'}],cursor:''});
  }
  if(path.pathname.endsWith('/portfolio/settlements'))return json({settlements:[{ticker,settled_time:'2026-10-13T05:00:00Z'}]});
  if(path.pathname.endsWith('/portfolio/orders')){
   if(mode==='orders-failed')return json({error:'offline error'},503);
   const cursor=path.searchParams.get('cursor');
   if(pages)return json(cursor?pages[1]:pages[0]);
   return json({orders,cursor:''});
  }
  throw Error('UNEXPECTED_PROVIDER_READ '+path.pathname);
 };
 const env={KALSHI_EXECUTION_KEY_ID:'offline-only',KALSHI_EXECUTION_PRIVATE_KEY:privatePem,
  PAYNE_KALSHI_STATE:{get:async k=>state.get(k)||null,put:async(k,v)=>state.set(k,String(v)),
    list:async({prefix})=>({keys:[...state.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})}};
 async function run(){
  const original=globalThis.fetch;globalThis.fetch=provider;
  try{return await runPayneRealExecutionCycle(env,{postImpl:async()=>{throw Error('NO_PROVIDER_POST_ALLOWED')}});}
  finally{globalThis.fetch=original;}
 }
 const setCoordinator=value=>{env.PAYNE_EXECUTION_COORDINATOR=value};
 const changePosition=fn=>{const current=JSON.parse(state.get(SERIES));current.position=fn(current.position);current.positions=[current.position];state.set(SERIES,JSON.stringify(current))};
 const read=key=>JSON.parse(state.get(key));
 const ledger=()=>[...state.entries()].filter(([k])=>k.startsWith('payne-kalshi:real-ledger:')).map(([,v])=>JSON.parse(v));
 return {run,read,ledger,requests,position,seriesId,state,ticker,setCoordinator,changePosition};
}
test('A direct writer: exact provider FLAT and empty orders closes and releases slot',{concurrency:false},async()=>{
 const f=fixture();await f.run();const s=f.read(SERIES),c=f.read(CONTROL);
 assert.equal(s.position.status,'CLOSED');assert.equal(s.position.reconciliationState,'FLAT');
 assert.equal(c.openPositions,0);assert.equal(s.attemptsStarted,2);
 assert.equal(s.position.entryOrderId,f.position.entryOrderId);
});
test('B historical filled order is terminal and does not block closure',{concurrency:false},async()=>{
 const f=fixture({orders:[{ticker:'KXNEAR15M-OFFLINE-CLOSURE',status:'executed',order_id:'offline-provider-filled'}]});
 await f.run();assert.equal(f.read(SERIES).position.status,'CLOSED');
});
test('C actual open exit order prevents premature closure',{concurrency:false},async()=>{
 const f=fixture({orders:[{ticker:'KXNEAR15M-OFFLINE-CLOSURE',status:'resting',order_id:'offline-exit'}]});
 await f.run();assert.notEqual(f.read(SERIES).position.status,'CLOSED');assert.equal(f.read(CONTROL).openPositions,1);
});
test('D unknown or failed provider reads protect the position',{concurrency:false},async()=>{
 for(const mode of ['unknown','failed','orders-failed']){
  const f=fixture({mode});await f.run();assert.notEqual(f.read(SERIES).position.status,'CLOSED');
 }
});
test('E every paginated order page is examined',{concurrency:false},async()=>{
 const f=fixture({pages:[{orders:[{ticker:'OTHER',status:'executed'}],cursor:'next'},
  {orders:[{ticker:'KXNEAR15M-OFFLINE-CLOSURE',status:'resting'}],cursor:''}]});
 await f.run();assert.notEqual(f.read(SERIES).position.status,'CLOSED');
 assert.equal(f.requests.filter(r=>r.path.includes('/portfolio/orders')).length,2);
});
test('F legacy coordinator closure is not bypassed',{concurrency:false},async()=>{
 const f=fixture({direct:false});await f.run();
 assert.notEqual(f.read(SERIES).position.status,'CLOSED');
});
test('G repeated reconciliation does not duplicate closure',{concurrency:false},async()=>{
 const f=fixture();await f.run();const count=f.ledger().filter(x=>x.type==='PROVIDER_RECONCILED_FLAT').length;
 await f.run();assert.equal(count,1);
 assert.equal(f.ledger().filter(x=>x.type==='PROVIDER_RECONCILED_FLAT').length,1);
});
test('H Founder disarmed control remains false',{concurrency:false},async()=>{
 const f=fixture({armed:false});await f.run();assert.equal(f.read(CONTROL).armed,false);
});
test('I disarmed management still reconciles existing position',{concurrency:false},async()=>{
 const f=fixture({armed:false});await f.run();assert.equal(f.read(SERIES).position.status,'CLOSED');
});
test('J no entry submission or attempt replay from closure',{concurrency:false},async()=>{
 const f=fixture();await f.run();
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
 assert.equal(f.read(SERIES).attemptsStarted,2);
 assert.equal(f.read(SERIES).position.entryClientOrderId,'offline-client-entry');
});

test('K closed DOGE: failed atomic close remains owned; next verified cycle retries once and closes without provider POST',{concurrency:false},async()=>{
 const f=fixture({direct:false,orders:[{ticker:'KXNEAR15M-OFFLINE-CLOSURE',status:'executed',order_id:'offline-provider-filled',client_order_id:'offline-client-entry'}]});
 let resolveCalls=0;
 const coordinator={
   idFromName:id=>id,
   get:()=>({fetch:async(_url,options)=>{
     assert.equal(options.method,'POST');
     const request=JSON.parse(options.body);
     assert.equal(request.action,'RESOLVE_ENTRY');
     assert.equal(request.resolution,'CLOSED');
     assert.equal(request.seriesId,f.seriesId);
     assert.equal(request.ticker,f.ticker);
     resolveCalls++;
     return json({granted:resolveCalls>1,reason:resolveCalls>1?'ENTRY_RESOLUTION_PERSISTED':'SIMULATED_ATOMIC_RECORD_FAILURE'});
   }})
 };
 const envOriginal=f.read(SERIES);
 // Attach the existing coordinator to the offline fixture without live secrets.
 f.setCoordinator(coordinator);
 await f.run();
 assert.equal(resolveCalls,1);
 assert.equal(f.read(SERIES).position.status,'RECONCILIATION_UNKNOWN');
 assert.equal(f.read(SERIES).status,'ATOMIC_CLOSE_RECORD_PENDING');
 assert.equal(f.read(CONTROL).openPositions,1);
 assert.equal(f.ledger().filter(x=>x.type==='PROVIDER_RECONCILED_FLAT').length,0);
 await f.run();
 assert.equal(resolveCalls,2);
 assert.equal(f.read(SERIES).position.status,'CLOSED');
 assert.equal(f.read(CONTROL).openPositions,0);
 assert.equal(f.ledger().filter(x=>x.type==='PROVIDER_RECONCILED_FLAT').length,1);
 await f.run();
 assert.equal(resolveCalls,2);
 assert.equal(f.ledger().filter(x=>x.type==='PROVIDER_RECONCILED_FLAT').length,1);
 assert.equal(f.requests.some(x=>x.method!=='GET'),false);
});
test('L cross-series position identity does not resolve or release an unrelated owner',{concurrency:false},async()=>{
 const f=fixture({direct:false});
 f.changePosition(p=>({...p,seriesId:'DIFFERENT_SERIES'}));
 await f.run();
 assert.equal(f.read(SERIES).position.status,'RECONCILIATION_UNKNOWN');
 assert.equal(f.read(SERIES).position.reconciliationReason,'CLOSE_IDENTITY_NOT_VERIFIED');
 assert.equal(f.read(CONTROL).openPositions,1);
 assert.equal(f.ledger().filter(x=>x.type==='PROVIDER_RECONCILED_FLAT').length,0);
 assert.equal(f.requests.some(x=>x.method!=='GET'),false);
});
