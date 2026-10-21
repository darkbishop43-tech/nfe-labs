import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{reconcileUnresolvedEntryFromProvider} from '../src/index.js';
import {payneCapacityEvidence,liveOrderWatchProjection} from '../src/payne-live-order-watch.js';
const PREFIX='payne-kalshi:';
function fixture(){
 const data=new Map(), counts={gets:0,lists:0,puts:0};
 const put=(key,value)=>data.set(key,structuredClone(value));
 const series='5867063c-5a7a-4180-ab22-ea08ebab63a3';
 for(let i=0;i<51;i++){
  const attempt='a-'+i;
  put(PREFIX+'attempt:'+String(i).padStart(4,'0'),{owner:'PAYNE_KALSHI_REAL',seriesId:series,attemptId:attempt,attemptNo:i+1,createdAt:'2026-10-20T23:00:00Z',marketTicker:'KXNEAR15M-26OCT202300-00',outcomeSide:'YES',providerOrderId:'order-'+i,clientOrderId:'client-'+i});
  put(PREFIX+'real-ledger:'+String(i).padStart(4,'0'),{owner:'PAYNE_KALSHI_REAL',seriesId:series,attemptId:attempt,type:'ENTRY_PROVIDER_RESULT',recordId:'event-'+i,at:'2026-10-20T23:00:01Z',providerOrderId:'order-'+i,feeUsd:null,realizedPnlUsd:null});
 }
 put(PREFIX+'real-series:v1',{schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',seriesId:series,unresolvedEntry:false,positions:[],attemptsStarted:51});
 const kv={
  async get(k){counts.gets++;const val=data.get(k);return val===undefined?null:JSON.stringify(val)},
  async put(k,v){counts.puts++;data.set(k,typeof v==='string'?JSON.parse(v):structuredClone(v))},
  async list({prefix='',limit=1000,cursor}){counts.lists++;const keys=[...data.keys()].filter(k=>k.startsWith(prefix)).sort();const n=cursor?Number(cursor):0;const subset=keys.slice(n,n+limit);return {keys:subset.map(name=>({name})),list_complete:n+limit>=keys.length,cursor:n+limit>=keys.length?undefined:String(n+limit)}}
 };
 return {env:{PAYNE_KALSHI_STATE:kv},counts,series};
}
async function collect(env,view,limit){
 let cursor=null,rounds=0,out=[];
 do{
  const query=new URLSearchParams({view,limit:String(limit)});
  if(cursor)query.set('cursor',cursor);
  const res=await worker.fetch(new Request('https://payne.test/real-history?'+query),env);
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.ok,true);
  out.push(...data.rows);
  rounds++;
  if(!data.hasMore){assert.equal(data.nextCursor,null);break;}
  assert.equal(data.complete,false);
  cursor=data.nextCursor;
  assert.ok(rounds<20);
 }while(true);
 return {out,rounds};
}
test('actual PAYNE Worker GET cursor routes recover all 51 attempts and 51 events without duplicates or writes',async()=>{
 const x=fixture(), a=await collect(x.env,'cycles',20), e=await collect(x.env,'events',20);
 assert.equal(a.out.length,51);
 assert.equal(e.out.length,51);
 assert.equal(new Set(a.out.map(r=>r.attemptId)).size,51);
 assert.equal(new Set(e.out.map(r=>r.sourceLedgerKey)).size,51);
 assert.equal(x.counts.puts,0);
});
test('actual PAYNE source clean reconciliation is idempotent and preserves persisted retained closure',async()=>{
 const x=fixture();const before=x.counts.puts;
 const a=await reconcileUnresolvedEntryFromProvider(x.env);
 const b=await reconcileUnresolvedEntryFromProvider(x.env);
 assert.equal(a.reason,'NO_UNRESOLVED_ENTRY');
 assert.equal(b.reason,'NO_UNRESOLVED_ENTRY');
 assert.equal(x.counts.puts,before);
 const near={owner:'PAYNE_KALSHI_REAL',attemptId:'near',status:'CLOSED',reconciliationState:'FLAT',entryOrderId:'01a15c5e-b4e8-7739-a8b6-af44870e873e',marketTicker:'KXNEAR15M-26OCT202300-00'};
 const series={unresolvedEntry:false,positions:[near]};
 assert.equal(payneCapacityEvidence(series,3).occupied,0);
 assert.equal(liveOrderWatchProjection(series).active.length,0);
});
