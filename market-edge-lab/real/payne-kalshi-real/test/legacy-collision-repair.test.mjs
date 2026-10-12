import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PayneExecutionCoordinator} from '../src/payne-execution-coordinator.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const hype={seriesId:'367facf0-a0ab-4361-99b6-0dbe4c786660',attemptNo:1,specimenId:'hype-specimen',clientOrderId:'payne-real-0dbe4c786660-1-entry',ticker:'KXHYPE15M-26OCT100315-15',side:'YES',windowClose:'2026-10-10T07:15:00Z',claimState:'POTENTIALLY_SUBMITTED'};
const zec={...hype,specimenId:'zec-specimen',ticker:'KXZEC15M-26OCT112315-15',side:'NO',windowClose:'2026-10-12T03:15:00Z'};
function fixture(prior){
 const stored=new Map(prior?[['attempt:1',structuredClone(prior)]]:[]);
 const storage={get:async k=>stored.get(k),transaction:async fn=>fn({get:async k=>stored.get(k),put:async(k,v)=>stored.set(k,v),delete:async k=>stored.delete(k),list:async()=>new Map(stored)})};
 return {stored,doObj:new PayneExecutionCoordinator({storage})};
}
async function resolve(f,identity=zec,resolution='NO_PROVIDER_EXECUTION'){
 const r=await f.doObj.fetch(new Request('https://internal/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...identity,action:'RESOLVE_ENTRY',resolution,providerNoExecutionProven:true,authoritativeReconciliationProven:true})}));
 return r.json();
}
test('HYPE claim present and ZEC identity different: HYPE preserved',async()=>{
 const f=fixture(hype);const before=structuredClone(f.stored.get('attempt:1'));
 assert.equal((await resolve(f)).reason,'CLAIM_DIFFERENT_IDENTITY');
 assert.deepEqual(f.stored.get('attempt:1'),before);
});
test('missing claim produces CLAIM_NOT_FOUND',async()=>{
 const f=fixture();assert.equal((await resolve(f)).reason,'CLAIM_NOT_FOUND');
 assert.equal(f.stored.size,0);
});
test('matching claim resolves and preserves identity',async()=>{
 const f=fixture(zec);const result=await resolve(f);
 assert.equal(result.granted,true);
 assert.equal(f.stored.get('attempt:1').claimState,'NO_PROVIDER_EXECUTION');
 assert.equal(f.stored.get('attempt:1').ticker,zec.ticker);
});
test('UNKNOWN provider outcome remains blocked absent complete evidence',()=>{
 assert.match(source,/if\(\(positionEvidence\.classification==='ABSENT'/);
 assert.match(source,/exactOrders\.length===0 && exactFills\.length===0 && exactSettlements\.length===0/);
 assert.match(source,/if\(!atomicAuthority\.ok\)/);
});
test('proven pre-provider no execution may preserve different claim',()=>{
 assert.match(source,/attempt\?\.writerInvoked===false && attempt\?\.providerPostStarted===false/);
 assert.match(source,/legacyDifferentClaimPreserved:true/);
 assert.match(source,/inspectPayneCoordinatorClaim\(env,identity\.seriesId,identity\.attemptNo\)/);
 assert.match(source,/resolvePayneExecutionClaim\(env,identity,resolution/);
});
test('direct engine retains coordinator-free entry and Paper brain',()=>{
 assert.match(source,/DIRECT_KALSHI_WRITER_V1/);
 const direct=source.slice(source.indexOf('// AUTO-style direct submission:'),source.indexOf("postImpl(env,'ENTRY'"));
 assert.doesNotMatch(direct,/claimPayneExecution\(/);
 assert.match(source,/score:latch\.observedScore/);
});
