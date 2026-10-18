import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const gate=readFileSync(new URL('../../../../.github/scripts/payne-kv-deployment-safety-maintenance.sh',import.meta.url),'utf8');
const match=gate.match(/jq -e --slurpfile c "\$c" --slurpfile maintenance "\$proof" --slurpfile empty "\$emptyProof" --arg evidenceAuthority "\$evidenceAuthority" '([\s\S]*?)' "\$s"/);
assert.ok(match,'actual deployment gate policy jq expression must exist');
const expr=match[1];
const control={realControlSchema:'PAYNE_REAL_CONTROL_V2_PAPER_BRAIN',armed:false,openPositions:0,requiredExchangeIndex:2,activeThreshold:0.65,attemptTarget:5,maxEntryDebitUsd:1,scanEnabled:true};
const series={schema:'PAYNE_REAL_SERIES_V1',owner:'PAYNE_KALSHI_REAL',requiredExchangeIndex:2,seriesId:'bd881b11-b130-491f-a75f-a98425b92fd9',status:'ARMED_FISHING',configFrozen:true,threshold:0.55,attemptTarget:1,maxEntryDebitUsd:1,attemptsStarted:0,executionIntentsStarted:0,unresolvedEntry:false,currentAttempt:null,position:null,positions:[],fireLatch:null,providerPostStarted:false};
const proof={allowed:true,schema:'PAYNE_EMPTY_SERIES_DEPLOYMENT_EVIDENCE_V1',seriesId:series.seriesId,controlArmed:false,source:'AUTHENTICATED_READ_ONLY',providerOrdersComplete:true,providerPositionsComplete:true,coordinatorClaimsComplete:true,reconciliationComplete:true,providerOpenOrders:0,providerOpenPositions:0,coordinatorActiveClaims:0,unknownProviderObligations:0,observedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};
function evaluate({c={},s={},p={},omitSeriesFields=[],authority='AUTHENTICATED_READONLY_VERIFIER'}={}){
 const dir=mkdtempSync(join(tmpdir(),'payne-gate-offline-'));
 try{
  const legacySeries={...series,...s};for(const f of omitSeriesFields)delete legacySeries[f];
  for(const [name,v] of Object.entries({control:{...control,...c},series:legacySeries,proof:{...proof,...p},maintenance:{allowed:false}}))writeFileSync(join(dir,name+'.json'),JSON.stringify(v));
  const out=spawnSync('jq',['-e','--slurpfile','c',join(dir,'control.json'),'--slurpfile','maintenance',join(dir,'maintenance.json'),'--slurpfile','empty',join(dir,'proof.json'),'--arg','evidenceAuthority',authority,expr,join(dir,'series.json')],{encoding:'utf8'});
  return {ok:out.status===0,error:out.stderr,stdout:out.stdout};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('offline mock full proof allows only the narrow disarmed frozen mismatch',()=>{const r=evaluate();assert.equal(r.ok,true,r.error)});
const negative=[
 ['verifier missing',{authority:'UNVERIFIED'}],
 ['no proof',{p:{allowed:false}}],
 ['armed',{c:{armed:true}}],
 ['open position control',{c:{openPositions:1}}],
 ['missing attempts',{s:{attemptsStarted:null}}],
 ['attempts nonzero',{s:{attemptsStarted:1}}],
 ['missing intents',{s:{executionIntentsStarted:null}}],
 ['intents nonzero',{s:{executionIntentsStarted:1}}],
 ['current attempt',{s:{currentAttempt:{status:'UNKNOWN'}}}],
 ['position',{s:{position:{status:'OPEN'}}}],
 ['positions array',{s:{positions:[{status:'OPEN'}]}}],
 ['positions array missing',{s:{positions:null}}],
 ['unresolved',{s:{unresolvedEntry:true}}],
 ['latched',{s:{fireLatch:{state:'LATCHED'}}}],
 ['latch unknown',{s:{fireLatch:{state:'UNKNOWN'}}}],
 ['provider post',{s:{providerPostStarted:true}}],
 ['provider post missing',{s:{providerPostStarted:null}}],
 ['claim incomplete',{p:{coordinatorClaimsComplete:false}}],
 ['claim active',{p:{coordinatorActiveClaims:1}}],
 ['orders incomplete',{p:{providerOrdersComplete:false}}],
 ['orders open',{p:{providerOpenOrders:1}}],
 ['positions incomplete',{p:{providerPositionsComplete:false}}],
 ['provider positions open',{p:{providerOpenPositions:1}}],
 ['reconciliation incomplete',{p:{reconciliationComplete:false}}],
 ['unknown exposure',{p:{unknownProviderObligations:1}}],
 ['identity mismatch',{p:{seriesId:'other'}}],
 ['schema mismatch',{s:{schema:'wrong'}}],
 ['index mismatch',{s:{requiredExchangeIndex:3}}],
 ['proof source missing',{p:{source:null}}],
 ['proof timestamp missing',{p:{observedAt:null}}],
 ['stale evidence',{p:{observedAt:'2020-01-01T00:00:00Z'}}],
 ['future evidence',{p:{observedAt:'2030-01-01T00:00:00Z'}}]
];
for(const [name,args] of negative)test('fails closed: '+name,()=>{const r=evaluate({...args,s:{seriesId:'other-historical-series',...args.s},p:{seriesId:'other-historical-series',...args.p}});assert.equal(r.ok,false,r.stdout)});
test('normal matching config remains eligible without special proof',()=>{const r=evaluate({s:{threshold:0.65,attemptTarget:5},authority:'UNVERIFIED',p:{allowed:false}});assert.equal(r.ok,true,r.error)});

test('Founder disarmed zero-attempt frozen mismatch permits SOFTWARE recovery without undeployed diagnostics',()=>{
 const r=evaluate({authority:'UNVERIFIED',p:{allowed:false}});
 assert.equal(r.ok,true,r.error);
});
const founderRecoveryNegative=[
 ['Founder armed',{c:{armed:true}}],
 ['active claim marker',{s:{coordinatorActiveClaims:1}}],
 ['unknown provider exposure',{s:{providerExposureStatus:'UNKNOWN'}}],
 ['unknown reconciliation',{s:{providerReconciliationStatus:'UNKNOWN'}}],
 ['unknown obligations',{s:{unknownProviderObligations:1}}],
 ['open provider orders',{s:{providerOpenOrders:1}}],
 ['open provider positions',{s:{providerOpenPositions:1}}],
 ['persisted position',{s:{positions:[{status:'OPEN'}]}}],
 ['missing positions',{s:{positions:null}}],
 ['missing attempts',{s:{attemptsStarted:null}}],
 ['nonzero attempts',{s:{attemptsStarted:1}}],
 ['nonzero intents',{s:{executionIntentsStarted:1}}],
 ['unknown current attempt',{s:{currentAttempt:{status:'UNKNOWN'}}}],
 ['provider submit marker',{s:{providerPostStarted:true}}],
 ['provider post marker missing',{s:{providerPostStarted:null}}],
 ['series mismatch',{s:{seriesId:'different'}}],
 ['active latch',{s:{fireLatch:{state:'LATCHED'}}}],
 ['unknown latch',{s:{fireLatch:{state:'UNKNOWN'}}}],
 ['unresolved entry',{s:{unresolvedEntry:true}}],
 ['control position',{c:{openPositions:1}}]
];
for(const [name,values] of founderRecoveryNegative)
 test('Founder software recovery rejects: '+name,()=>{
   const r=evaluate({...values,authority:'UNVERIFIED',p:{allowed:false}});
   assert.equal(r.ok,false,r.stdout);
 });

test('exact PAYNE_REAL_SERIES_V1 no providerPostStarted: disarmed legacy software recovery passes',()=>{
 const r=evaluate({authority:'UNVERIFIED',p:{allowed:false},omitSeriesFields:['providerPostStarted']});assert.equal(r.ok,true,r.error);
});
for(const [label,args] of [
 ['armed',{c:{armed:true}}],
 ['wrong series',{s:{seriesId:'another-series'}}],
 ['missing attempts',{omitSeriesFields:['attemptsStarted']}],
 ['nonzero attempts',{s:{attemptsStarted:1}}],
 ['missing execution intents',{omitSeriesFields:['executionIntentsStarted']}],
 ['nonzero execution intents',{s:{executionIntentsStarted:1}}],
 ['current attempt',{s:{currentAttempt:{status:'UNKNOWN'}}}],
 ['active latch',{s:{fireLatch:{state:'LATCHED'}}}],
 ['unknown latch',{s:{fireLatch:{state:'UNKNOWN'}}}],
 ['position',{s:{positions:[{status:'OPEN'}]}}],
 ['unknown exposure',{s:{providerExposureStatus:'UNKNOWN'}}],
 ['unknown obligations',{s:{unknownProviderObligations:1}}],
 ['open orders',{s:{providerOpenOrders:1}}],
 ['open provider positions',{s:{providerOpenPositions:1}}],
 ['active coordinator',{s:{coordinatorActiveClaims:1}}],
 ['explicit post true',{s:{providerPostStarted:true}}],
 ['explicit post null',{s:{providerPostStarted:null}}],
 ['missing currentAttempt',{omitSeriesFields:['currentAttempt']}],
 ['missing fireLatch',{omitSeriesFields:['fireLatch']}],
 ['missing position',{omitSeriesFields:['position']}]
])test('exact legacy absent marker rejects: '+label,()=>{
 const r=evaluate({authority:'UNVERIFIED',p:{allowed:false},c:args.c,s:args.s,omitSeriesFields:['providerPostStarted',...(args.omitSeriesFields||[])]});
 assert.equal(r.ok,false,r.stdout);
});
