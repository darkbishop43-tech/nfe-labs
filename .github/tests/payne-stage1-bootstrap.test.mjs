import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import worker from '../../market-edge-lab/real/payne-kalshi-real/src/index.js';
const source=readFileSync('market-edge-lab/real/payne-kalshi-real/src/index.js','utf8');
const base=process.env.PAYNE_BASE_SOURCE_TEXT;
test('Stage 1 contains protected read-only route and does not embed closure state writer',()=>{
 assert.match(source,/internal\/closure-maintenance-evidence/);
 assert.match(source,/payneClosureEvidence/);
 assert.doesNotMatch(source,/maintenance-proof\.json|evaluatePayneClosureMaintenance/);
});
const position={owner:'PAYNE_KALSHI_REAL',status:'OPEN',exchangeIndex:2,seriesId:'s',attemptId:'a',attemptNo:2,
 entryOrderId:'o',entryClientOrderId:'c',marketTicker:'NEAR-TEST',outcomeSide:'NO',reconciliationState:'OPEN'};
const control={realControlSchema:'PAYNE_REAL_CONTROL_V2_PAPER_BRAIN',armed:false,openPositions:1,
 requiredExchangeIndex:2,activeThreshold:0.6,attemptTarget:5,maxEntryDebitUsd:1,scanEnabled:true};
const series={schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'s',requiredExchangeIndex:2,
 position,positions:[position],currentAttempt:{executionHandoff:'DIRECT_KALSHI_WRITER_V1',
 attemptId:'a',attemptNo:2,providerOrderId:'o',clientOrderId:'c'}};
function env(){
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const values=new Map([['payne-kalshi:control:v1',JSON.stringify(control)],['payne-kalshi:real-series:v1',JSON.stringify(series)]]);
 return {PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN:'x'.repeat(40),KALSHI_EXECUTION_KEY_ID:'offline',
 KALSHI_EXECUTION_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}),
 PAYNE_KALSHI_STATE:{get:async k=>values.get(k)||null,put:async()=>{throw Error('NO_KV_WRITES')},list:async()=>({keys:[],list_complete:true})}};
}
test('unauthorized GET blocks before provider access',{concurrency:false},async()=>{
 const before=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NO_UNAUTHORIZED_PROVIDER_READ')};
 try{const r=await worker.fetch(new Request('https://offline/internal/closure-maintenance-evidence'),env());
 assert.equal(r.status,403);assert.equal((await r.json()).reason,'UNAUTHORIZED');}
 finally{globalThis.fetch=before;}
});
for(const [kind,code] of [['FLAT',200],['OPEN',409],['UNKNOWN',409]]){
 test('authorized mocked provider '+kind+' GET evidence',{concurrency:false},async()=>{
 const old=globalThis.fetch;let gets=0;
 globalThis.fetch=async(url,init)=>{
  assert.equal(init.method,'GET');gets++;
  if(kind==='UNKNOWN')return new Response('{}',{status:503});
  if(String(url).includes('/portfolio/positions'))return Response.json({market_positions:[{ticker:'NEAR-TEST',position_fp:kind==='OPEN'?'1':'0'}],cursor:''});
  if(String(url).includes('/portfolio/orders'))return Response.json({orders:[{order_id:'o',client_order_id:'c',ticker:'NEAR-TEST',side:'no',status:'executed'}],cursor:''});
  throw Error('UNMOCKED');
 };
 try{const r=await worker.fetch(new Request('https://offline/internal/closure-maintenance-evidence',
 {headers:{'x-payne-diagnostic-token':'x'.repeat(40)}}),env());
 assert.equal(r.status,code);const b=await r.json();assert.equal(b.ok,kind==='FLAT');assert.ok(gets>=1);
 if(kind==='FLAT'){assert.equal(b.complete,true);assert.equal(b.provider.positionQuantity,0);}
 else assert.equal(b.complete,false);}
 finally{globalThis.fetch=old;}
 });
}
test('bootstrap gate leaves original safety checks and requires exact bootstrap SHA',()=>{
 const script=readFileSync('.github/scripts/payne-kv-stage1-bootstrap-safety.sh','utf8');
 assert.match(script,/PERSISTED_CONTROL_SAFETY/);
 assert.match(script,/PERSISTED_SERIES_EXPOSURE_OR_CONFIG/);
 assert.match(script,/STALE_OR_FUTURE_SCHEDULER_HEARTBEAT/);
 assert.match(script,/PAYNE_BOOTSTRAP_APPROVED_SOURCE_BLOB/);
 assert.match(script,/bcea107f1bbe4ef4e5e8b6ef0591fee63978e510/);
});
test('bootstrap workflow is Founder-authorized and scoped to Stage 1 branch',()=>{
 const w=readFileSync('.github/workflows/payne-stage1-bootstrap-manual.yml','utf8');
 assert.match(w,/workflow_dispatch/);assert.match(w,/branches: \[payne-closure-bootstrap-stage1-offline-20261013\]/);
 assert.match(w,/payne-kv-stage1-bootstrap-safety.sh pre/);
 assert.match(w,/payne-kv-stage1-bootstrap-safety.sh post/);
 assert.match(w,/armed==false/);
});
