import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {payneClosureEvidence} from '../../market-edge-lab/real/payne-kalshi-real/src/payne-closure-evidence.js';
import {verifyPayneMaintenanceChain} from '../scripts/payne-maintenance-decision.mjs';
import worker from '../../market-edge-lab/real/payne-kalshi-real/src/index.js';
const blob='76c6ff7a2f7f6967def859012b2fcf3b66f7b2f9';
function setup(){
 const p={schema:'PAYNE_REAL_POSITION_V1',owner:'PAYNE_KALSHI_REAL',status:'OPEN',exchangeIndex:2,
 seriesId:'series-near',attemptId:'intent-2',attemptNo:2,entryOrderId:'provider-entry',entryClientOrderId:'client-entry',
 marketTicker:'KXNEAR-OFFLINE',outcomeSide:'NO',reconciliationState:'OPEN_PENDING_PROVIDER_RECONCILIATION'};
 return {control:{realControlSchema:'PAYNE_REAL_CONTROL_V2_PAPER_BRAIN',armed:false,openPositions:1,
 requiredExchangeIndex:2,activeThreshold:0.6,attemptTarget:5,maxEntryDebitUsd:1,scanEnabled:true},
 series:{schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',requiredExchangeIndex:2,seriesId:'series-near',
 unresolvedEntry:false,attemptsStarted:2,configFrozen:false,position:p,positions:[{...p}],fireLatch:{state:'NONE'},
 currentAttempt:{attemptId:p.attemptId,attemptNo:p.attemptNo,providerOrderId:p.entryOrderId,
 clientOrderId:p.entryClientOrderId,executionHandoff:'DIRECT_KALSHI_WRITER_V1',status:'FILLED',providerPostStarted:true}},
 orders:[{order_id:'provider-entry',client_order_id:'client-entry',ticker:'KXNEAR-OFFLINE',side:'no',status:'executed'}],
 positionQuantity:0};
}
function mockKalshi(f,{unknown=false,pageOpen=false,openOther=false}={}){
 return async (_env,path)=>{
  if(unknown) return new Response('{}',{status:503});
  const cursor=new URL('https://example.test'+path).searchParams.get('cursor');
  if(path.includes('/portfolio/positions'))return Response.json({
    market_positions:[{ticker:f.series.position.marketTicker,position_fp:String(f.positionQuantity)},
    ...(openOther?[{ticker:'OTHER_MARKET',position_fp:'1'}]:[])],cursor:''});
  if(path.includes('/portfolio/orders'))return Response.json(cursor?
    {orders:pageOpen?[{ticker:'KXNEAR-OFFLINE',status:'resting'}]:[],cursor:''}:
    {orders:f.orders,cursor:'page2'});
  if(path.includes('/portfolio/settlements'))return Response.json({settlements:[{ticker:f.series.position.marketTicker}]});
  throw Error('UNMOCKED_PATH');
 };
}
async function decision(f,opts={}){
 const evidence=await payneClosureEvidence({},f.control,f.series,{get:mockKalshi(f,opts)});
 return {evidence,decision:await verifyPayneMaintenanceChain({
  control:f.control,series:f.series,providerResponse:evidence,sourceBlob:blob,expectedBlob:blob})};
}
function runActualGate(f,approved){
 const root=mkdtempSync(join(tmpdir(),'payne-gate-offline-'));const fakebin=join(root,'bin');
 mkdirSync(fakebin);
 for(const [name,body] of [['control',f.control],['series',f.series],['current',{at:new Date().toISOString(),source:'SCHEDULED_CRON'}]])
  writeFileSync(join(root,name+'.json'),JSON.stringify(body));
 const fakeCurl=join(fakebin,'curl');
 writeFileSync(fakeCurl,`#!/bin/bash
out=''
while (( $# ));do
 if [[ "$1" == "--output" ]];then out="$2";shift 2;continue;fi
 shift
done
case "$out" in
 */control.json) cp "$MOCK_DATA/control.json" "$out";;
 */series.json) cp "$MOCK_DATA/series.json" "$out";;
 */current.json) cp "$MOCK_DATA/current.json" "$out";;
 *) exit 1;;
esac
printf 200`);
 chmodSync(fakeCurl,0o755);
 const proof=join(root,'proof.json');if(approved)writeFileSync(proof,JSON.stringify(approved));
 const gate=resolve('.github/scripts/payne-kv-deployment-safety-maintenance.sh');
 const run=spawnSync('bash',[gate,'pre'],{encoding:'utf8',
 env:{...process.env,PATH:fakebin+':'+process.env.PATH,MOCK_DATA:root,
 CLOUDFLARE_API_TOKEN:'offline-fake',CLOUDFLARE_ACCOUNT_ID:'offline-fake',
 PAYNE_MAINTENANCE_PROOF_FILE:proof}});
 rmSync(root,{force:true,recursive:true});return run;
}
test('full chain: provider flat -> protected evidence -> predicate -> actual gate allows',{concurrency:false},async()=>{
 const f=setup(),x=await decision(f);assert.equal(x.evidence.ok,true);assert.equal(x.decision.allowed,true);
 const gate=runActualGate(f,x.decision);assert.equal(gate.status,0,gate.stdout+'\n'+gate.stderr);
 assert.match(gate.stdout,/PREDEPLOY_DISARMED_AND_PERSISTENCE_GATE=PASS/);
});
const cases=[
 ['open provider position',f=>f.positionQuantity=1,{}],
 ['unknown provider read',()=>{}, {unknown:true}],
 ['open order on second page',()=>{}, {pageOpen:true}],
 ['wrong exact entry order identity',f=>f.orders[0].client_order_id='wrong',{}],
 ['Founder armed',f=>f.control.armed=true,{}],
 ['other provider exposure',()=>{}, {openOther:true}],
 ['unknown second PAYNE position',f=>f.series.positions.push({...f.series.position,attemptId:'another'}),{}],
 ['unrelated deployment blob',()=>{}, {},true]
];
for(const [name,mutate,opts,wrongBlob] of cases)test('full chain blocks: '+name,{concurrency:false},async()=>{
 const f=setup();mutate(f);let x=await decision(f,opts);
 if(wrongBlob)x.decision=await verifyPayneMaintenanceChain({
  control:f.control,series:f.series,providerResponse:x.evidence,sourceBlob:'WRONG',expectedBlob:blob});
 assert.equal(x.decision.allowed,false,name);
 const gate=runActualGate(f,null);
 assert.notEqual(gate.status,0,'gate must fail without authorized proof');
});
test('normal non-maintenance gate remains unchanged and passes without proof',{concurrency:false},()=>{
 const f=setup();f.control.openPositions=0;f.series.position=null;f.series.positions=[];
 const result=runActualGate(f,null);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
test('unauthorized worker evidence request blocked without provider read',{concurrency:false},async()=>{
 const res=await worker.fetch(new Request('https://worker.example/internal/closure-maintenance-evidence'),
 {PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN:'x'.repeat(40)});
 assert.equal(res.status,403);assert.equal((await res.json()).reason,'UNAUTHORIZED');
});

test('authorized protected Worker endpoint -> Kalshi GET mocks -> decision -> gate',{concurrency:false},async()=>{
 const f=setup();
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const pem=privateKey.export({type:'pkcs8',format:'pem'});
 const store=new Map([['payne-kalshi:control:v1',JSON.stringify(f.control)],
  ['payne-kalshi:real-series:v1',JSON.stringify(f.series)]]);
 const env={PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN:'x'.repeat(40),
  KALSHI_EXECUTION_KEY_ID:'offline-only',KALSHI_EXECUTION_PRIVATE_KEY:pem,
  PAYNE_KALSHI_STATE:{get:async k=>store.get(k)||null,
   put:async()=>{throw Error('KV_WRITE_PROHIBITED')},
   list:async()=>({keys:[],list_complete:true})}};
 const old=globalThis.fetch;const gets=[];
 globalThis.fetch=async(url,init={})=>{
   assert.equal(init.method,'GET');gets.push(String(url));
   return mockKalshi(f)({},new URL(String(url)).pathname+new URL(String(url)).search);
 };
 try{
   const response=await worker.fetch(new Request('https://worker.example/internal/closure-maintenance-evidence',
    {headers:{'x-payne-diagnostic-token':'x'.repeat(40)}}),env);
   assert.equal(response.status,200);
   const providerResponse=await response.json();
   assert.equal(providerResponse.ok,true);
   const d=await verifyPayneMaintenanceChain({control:f.control,series:f.series,
     providerResponse,sourceBlob:blob,expectedBlob:blob});
   assert.equal(d.allowed,true);
   const gate=runActualGate(f,d);assert.equal(gate.status,0,gate.stdout+'\n'+gate.stderr);
   assert.ok(gets.some(x=>x.includes('/portfolio/positions')));
   assert.ok(gets.some(x=>x.includes('/portfolio/orders')));
 }finally{globalThis.fetch=old;}
});
