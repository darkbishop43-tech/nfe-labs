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
const proof={allowed:true,schema:'PAYNE_EMPTY_SERIES_DEPLOYMENT_EVIDENCE_V1',seriesId:series.seriesId,controlArmed:false,source:'AUTHENTICATED_READ_ONLY',providerOrdersComplete:true,providerPositionsComplete:true,coordinatorClaimsComplete:true,reconciliationComplete:true,providerOpenOrders:0,providerOpenPositions:0,coordinatorActiveClaims:0,unknownProviderObligations:0,observedAt:'2026-10-18T12:00:00Z'};
function evaluate({c={},s={},p={},authority='AUTHENTICATED_READONLY_VERIFIER'}={}){
 const dir=mkdtempSync(join(tmpdir(),'payne-gate-offline-'));
 try{
  for(const [name,v] of Object.entries({control:{...control,...c},series:{...series,...s},proof:{...proof,...p},maintenance:{allowed:false}}))writeFileSync(join(dir,name+'.json'),JSON.stringify(v));
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
 ['proof timestamp missing',{p:{observedAt:null}}]
];
for(const [name,args] of negative)test('fails closed: '+name,()=>{const r=evaluate(args);assert.equal(r.ok,false,r.stdout)});
test('normal matching config remains eligible without special proof',()=>{const r=evaluate({s:{threshold:0.65,attemptTarget:5},authority:'UNVERIFIED',p:{allowed:false}});assert.equal(r.ok,true,r.error)});
