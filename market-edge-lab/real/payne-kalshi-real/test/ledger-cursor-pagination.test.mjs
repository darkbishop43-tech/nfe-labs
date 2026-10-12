import test from 'node:test';
import assert from 'node:assert/strict';
import {listRealLedgerWithEvidence} from '../src/index.js';
const prefix='payne-kalshi:real-ledger:';
const mk=(n,{repeat=false,bad=false}={})=>{
 const map=new Map(Array.from({length:n},(_,i)=>{
   const at='2026-10-12T'+String(Math.floor(i/60)).padStart(2,'0')+':'+String(i%60).padStart(2,'0')+':00Z';
   return [prefix+at+':'+i,JSON.stringify({at,type:'ENTRY_NO_FILL',recordId:String(i)})];
 }));
 const keys=[...map.keys()].sort();const seen=[];
 const kv={get:async k=>map.get(k),put:async()=>{throw Error('NO_WRITES_ALLOWED')},async list({prefix:p,limit,cursor}){
    assert.equal(p,prefix);assert.ok(limit<=1000);
    const offset=cursor?Number(cursor):0;seen.push(offset);
    const next=Math.min(offset+limit,keys.length);
    if(bad&&offset>0)return {keys:keys.slice(offset,next).map(name=>({name})),list_complete:false};
    return {keys:keys.slice(offset,next).map(name=>({name})),list_complete:next>=keys.length,cursor:next>=keys.length?undefined:(repeat?'0':String(next))};
 }};
 return {env:{PAYNE_KALSHI_STATE:kv},seen};
};
test('multiple KV pages return actual latest records, no first-page loss',async()=>{
 const {env,seen}=mk(1205);
 const result=await listRealLedgerWithEvidence(env,200);
 assert.equal(result.complete,true);assert.equal(result.scannedKeys,1205);assert.equal(result.returnedRows,200);
 assert.equal(result.omittedOlderKeys,1005);assert.equal(result.rows.at(-1).recordId,'1204');
 assert.deepEqual(seen,[0,1000]);
});
test('single page and empty namespace complete',async()=>{
 for(const size of [0,1,199,200]){const {env}=mk(size);const x=await listRealLedgerWithEvidence(env,200);assert.equal(x.returnedRows,size);assert.equal(x.complete,true);}
});
test('incomplete page missing cursor must fail closed',async()=>{
 const {env}=mk(1205,{bad:true});
 await assert.rejects(()=>listRealLedgerWithEvidence(env,200),/CURSOR_INVALID/);
});
test('read-only and preserved original persisted records',async()=>{
 const {env}=mk(1100);const x=await listRealLedgerWithEvidence(env,200);assert.equal(x.scannedKeys,1100);assert.equal(x.rows.length,200);
});
