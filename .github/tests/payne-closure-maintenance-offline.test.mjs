import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePayneClosureMaintenance as check} from '../scripts/payne-closure-maintenance-offline.mjs';
const blob='76c6ff7a2f7f6967def859012b2fcf3b66f7b2f9';
function fixture(){
 const position={owner:'PAYNE_KALSHI_REAL',status:'OPEN',exchangeIndex:2,seriesId:'s',attemptId:'a',attemptNo:2,
 entryOrderId:'o',entryClientOrderId:'c',marketTicker:'NEAR-EXACT',outcomeSide:'NO',reconciliationState:'OPEN'};
 return {sourceBlob:blob,expectedBlob:blob,control:{armed:false,openPositions:1},
 series:{schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'s',unresolvedEntry:false,
 position,positions:[{...position}],currentAttempt:{executionHandoff:'DIRECT_KALSHI_WRITER_V1',attemptId:'a',attemptNo:2,providerOrderId:'o',clientOrderId:'c'}},
 provider:{authenticated:true,complete:true,ticker:'NEAR-EXACT',side:'NO',entryOrderId:'o',entryClientOrderId:'c',
 positionReadOk:true,positionQuantity:0,ordersReadOk:true,ordersComplete:true,orders:[],otherUnresolvedExposure:false}};
}
const cases=[
 ['exact authenticated flat allows one-time maintenance', x=>x, true],
 ['open provider position blocks', x=>(x.provider.positionQuantity=1), false],
 ['unknown provider response blocks', x=>(x.provider.positionReadOk=false),false],
 ['outstanding order blocks', x=>(x.provider.orders=[{ticker:'NEAR-EXACT',status:'resting'}]),false],
 ['wrong order identity blocks',x=>(x.provider.entryOrderId='wrong'),false],
 ['other unresolved exposure blocks',x=>(x.provider.otherUnresolvedExposure=true),false],
 ['Founder armed blocks',x=>(x.control.armed=true),false],
 ['unrelated source blocks',x=>(x.sourceBlob='wrong'),false],
 ['normal disarmed zero-slot case does not use exception',x=>(x.control.openPositions=0),false],
 ['provider order pagination incomplete blocks',x=>(x.provider.ordersComplete=false),false],
 ['unknown order status blocks',x=>(x.provider.orders=[{ticker:'NEAR-EXACT',status:'unknown'}]),false],
 ['other active PAYNE position blocks',x=>(x.series.positions.push({...x.series.position,attemptId:'other'})),false],
 ['missing authenticated evidence blocks',x=>(x.provider.authenticated=false),false],
 ['mismatched direct attempt blocks',x=>(x.series.currentAttempt.executionHandoff='LEGACY'),false]
];
for(const [name,change,allowed] of cases) test(name,()=>{
 const f=fixture();change(f);assert.equal(check(f).allowed,allowed,name);
});
