import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const from=source.indexOf('const DISARM_AUDIT_PREFIX=');
const to=source.indexOf('async function closeRealSeriesControl(',from);
assert.ok(from>0 && to>from);
const body=source.slice(from,to).replace('export async function recoverPayneDisarmAudits','async function recoverPayneDisarmAudits');
function setup(){
 const data=new Map(),fault={putLedger:false,readLedger:false,putPending:false};
 const env={};const logs=[];
 const context={crypto:{randomUUID:()=> 'transition-fixed'},Date,Number,String,Error,
  console:{error:(...args)=>logs.push(args)},
  REAL_LEDGER_PREFIX:'ledger:',REAL_OWNER:'PAYNE_REAL',
  binding:()=>({list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})}),
  kvPutJson:async(_env,key,val)=>{
   if((key.startsWith('ledger:')&&fault.putLedger)||(key.startsWith('payne:disarm-audit:')&&fault.putPending))throw Error('mock write failure');
   data.set(key,structuredClone(val));
  },
  kvGetJson:async(_env,key)=>{
   if(key.startsWith('ledger:')&&fault.readLedger)throw Error('mock read failure');
   return data.get(key);
  }
 };
 vm.createContext(context);
 vm.runInContext(body+';globalThis.api={recordPayneDisarm,recoverPayneDisarmAudits};',context);
 const previous={armed:true};
 const next={armed:false,attempts:2,attemptTarget:5,openPositions:0};
 const series={seriesId:'series-2-of-5',attemptsStarted:2,attemptTarget:5,completedAt:null,unresolvedEntry:false};
 return {data,fault,logs,previous,next,series,...context.api};
}
test('Founder, terminal, fail-closed, frozen, entry-revoked, and UNKNOWN preserve exact classification',async()=>{
 for(const code of ['FOUNDER_DISARM','ATTEMPT_TARGET_COMPLETED','FAIL_CLOSED_MANAGEMENT_RECONCILIATION_UNKNOWN','FAIL_CLOSED_FROZEN_CONFIG_MISMATCH','ENTRY_AUTHORITY_REVOKED_AFTER_LATCH','UNKNOWN']){
  const s=setup();const actor=code==='FOUNDER_DISARM'?'FOUNDER':'SYSTEM';
  const result=await s.recordPayneDisarm({},s.previous,s.next,s.series,{actor,reasonCode:code,triggeringFunction:'test'});
  assert.equal(result.state,'VERIFIED');
  const row=[...s.data.entries()].find(([key])=>key.startsWith('ledger:'))[1];
  assert.equal(row.reasonCode,code);assert.equal(row.actor,actor);assert.equal(row.attemptsStarted,2);assert.equal(row.attemptTarget,5);
  assert.equal(row.previousArmed,true);assert.equal(row.newArmed,false);
 }
});
test('durable readback confirms matching deterministic transition identity',async()=>{
 const s=setup();const result=await s.recordPayneDisarm({},s.previous,s.next,s.series,{reasonCode:'UNKNOWN'});
 assert.equal(result.state,'VERIFIED');assert.equal((await s.recoverPayneDisarmAudits({})).incomplete,0);
 const marker=[...s.data.entries()].find(([k])=>k.startsWith('payne:disarm-audit:'))[1];
 assert.equal(marker.state,'VERIFIED');
});
test('control already disarmed and ledger write failure stays nonblocking and recoverable',async()=>{
 const s=setup();s.fault.putLedger=true;
 const result=await s.recordPayneDisarm({},s.previous,s.next,s.series,{reasonCode:'UNKNOWN'});
 assert.equal(result.state,'INCOMPLETE');
 const pending=[...s.data.values()].find(v=>v.state==='PENDING');
 assert.equal(pending.payload.reasonCode,'UNKNOWN');
 s.fault.putLedger=false;
 const outcome=await s.recoverPayneDisarmAudits({});
 assert.equal(outcome.repaired,1);assert.equal(outcome.incomplete,0);
});
test('ledger success and readback failure repaired after restart; no duplicate',async()=>{
 const s=setup();s.fault.readLedger=true;
 const result=await s.recordPayneDisarm({},s.previous,s.next,s.series,{});
 assert.equal(result.state,'INCOMPLETE');
 assert.equal([...s.data.keys()].filter(k=>k.startsWith('ledger:')).length,1);
 s.fault.readLedger=false;
 const outcome=await s.recoverPayneDisarmAudits({});
 assert.equal(outcome.repaired,1);
 assert.equal([...s.data.keys()].filter(k=>k.startsWith('ledger:')).length,1);
 const again=await s.recoverPayneDisarmAudits({});
 assert.equal(again.repaired,0);
});
test('pending marker write failure is not a new disarm gate',async()=>{
 const s=setup();s.fault.putPending=true;
 const result=await s.recordPayneDisarm({},s.previous,s.next,s.series,{});
 assert.equal(result.state,'VERIFIED');
});
test('no audit executes without an actual armed to disarmed transition',async()=>{
 const s=setup();const result=await s.recordPayneDisarm({},{armed:false},s.next,s.series,{});
 assert.equal(result,null);assert.equal(s.data.size,0);
});
test('audit source adds no ARM, FIRE, deploy or trading gates',()=>{
 const section=source.slice(from,to);
 for(const token of ['PAYNE_REAL_ARM_', 'ACTIVE_FIRE_LATCH','BLOCKED_DEPLOYMENT','kalshiPayneOrderPost'])assert.equal(section.includes(token),false);
});
