import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectPayneCoordinatorSeries} from '../src/payne-execution-coordinator.js';

const seriesId='bd881b11-b130-491f-a75f-a98425b92fd9';
const original=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const match=original.match(/if \(url\.pathname === '\/internal\/series-claims-diagnostic'\) \{([\s\S]*?)\n    \}\n    if \(url\.pathname === '\/internal\/atomic-claim-diagnostic'/);
assert.ok(match,'authenticated parent diagnostic route must be present');
const diagnostic=match[1];

function make({result={ok:true,complete:true,status:'CLEAR',seriesId,claims:[]},code=200,bound=true}={}){
 const calls=[];
 const binding=bound?{
   idFromName:s=>{calls.push(['idFromName',s]);return 'object-'+s},
   get:id=>{calls.push(['get',id]);return {fetch:async(url,options)=>{
     calls.push(['fetch',url,options.method]);
     return {ok:code===200,status:code,json:async()=>result};
   }}}
 }:undefined;
 return {env:{PAYNE_EXECUTION_COORDINATOR:binding},calls};
}
test('right series object and GET request; complete claim response',async()=>{
 const x=make(),out=await inspectPayneCoordinatorSeries(x.env,seriesId);
 assert.equal(out.status,'CLEAR');
 assert.deepEqual(x.calls[0],['idFromName',seriesId]);
 assert.deepEqual(x.calls[1],['get','object-'+seriesId]);
 assert.equal(x.calls[2][2],'GET');
 assert.ok(x.calls[2][1].includes(encodeURIComponent(seriesId)));
});
test('active claim is BLOCKED, not cleared',async()=>{
 const x=make({result:{ok:true,complete:true,status:'BLOCKED',seriesId,claims:[{kind:'ENTRY',state:'OPEN'}]}});
 assert.equal((await inspectPayneCoordinatorSeries(x.env,seriesId)).status,'BLOCKED');
});
test('unknown incomplete response fails closed',async()=>{
 const x=make({result:{ok:false,complete:false,status:'UNKNOWN',seriesId,claims:[]}});
 assert.equal((await inspectPayneCoordinatorSeries(x.env,seriesId)).status,'UNKNOWN');
});
test('wrong returned series fails closed',async()=>{
 const x=make({result:{ok:true,complete:true,status:'CLEAR',seriesId:'wrong',claims:[]}});
 assert.equal((await inspectPayneCoordinatorSeries(x.env,seriesId)).status,'UNKNOWN');
});
test('unbound coordinator fails closed',async()=>{
 const x=make({bound:false});
 assert.equal((await inspectPayneCoordinatorSeries(x.env,seriesId)).status,'UNKNOWN');
});
test('invalid requested series fails closed',async()=>{
 const x=make();assert.equal((await inspectPayneCoordinatorSeries(x.env,'')).status,'UNKNOWN');
 assert.equal(x.calls.length,0);
});
test('coordinator GET failure fails closed',async()=>{
 const x=make({code:500});
 assert.equal((await inspectPayneCoordinatorSeries(x.env,seriesId)).status,'UNKNOWN');
});
test('parent route enforces secret, constant-time comparison, and current series matching',()=>{
 assert.match(diagnostic,/PAYNE_COORDINATOR_DIAGNOSTIC_TOKEN/);
 assert.match(diagnostic,/x-payne-diagnostic-token/);
 assert.match(diagnostic,/crypto\.subtle\.digest/);
 assert.match(diagnostic,/mismatch\|=/);
 assert.match(diagnostic,/loadRealSeriesState\(env\)/);
 assert.match(diagnostic,/requested!==persisted\?\.seriesId/);
 assert.match(diagnostic,/inspectPayneCoordinatorSeries\(env,requested\)/);
});
test('parent diagnostic path contains no write or mutation functions',()=>{
 for(const forbidden of ['updateFounderControl','saveRealSeriesState','kvPutJson','kalshiPayneOrderPost','claimPayneExecution','claimPayneExit','resolvePayneExecutionClaim'])
   assert.ok(!diagnostic.includes(forbidden),forbidden);
});
