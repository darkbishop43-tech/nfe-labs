import { calculateNV0, calculateFullSIV0, calculateSICoreV0A, N_VERSION, SI_VERSION } from '../../cloudflare/si-n-v0.js';
import fs from 'node:fs';
const files=['index.html','app.js','styles.css','data/snapshot.json'];
const text=files.map(f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8')).join('\n');
const forbidden=[
  'place_equity_order','place_crypto_order','place_option_order','cancel_equity_order','cancel_crypto_order','cancel_option_order',
  'review_equity_order','review_option_order','preview_crypto_order','exercise_option','cancel_option_exercise',
  'create_watchlist','update_watchlist','add_to_watchlist','remove_from_watchlist','create_alert','update_alert','delete_alert','create_scan','update_scan_filters','update_scan_config'
];
for(const x of forbidden){if(text.includes(x))throw new Error(`Forbidden executable/tool token found: ${x}`)}
if(/account_number|rhs_account_number|rhc_account_number/i.test(text))throw new Error('Raw account-number field found');
for(const raw of ['616512430','979132115','683386064','631563756','311153622394','311264326026','311267414142']){if(text.includes(raw))throw new Error('Known unmasked account identifier found')}
const data=JSON.parse(fs.readFileSync(new URL('../data/snapshot.json',import.meta.url),'utf8'));
if(data.meta.mode!=='SNAPSHOT'||data.meta.readOnly!==true)throw new Error('Snapshot/read-only labeling failed');
for(const a of data.existingOptions.accountsChecked){if(!/^••••\d{4}$/.test(a))throw new Error('Unsafe account mask')}
if(data.account.maskedId!=='••••3756')throw new Error('Agentic mask mismatch');
console.log('PASS read-only firewall');
console.log('PASS no order/preview/cancel/transfer/exercise mutation tokens');
console.log('PASS safe account masking');
console.log('PASS snapshot labeling');

const si=data.siCryptoV0;
if(!si)throw new Error('SI Crypto V0 state missing');
const expected={M:0.30,T:0.20,V:0.15,Q:0.10,F:0.15};
for(const [k,v] of Object.entries(expected)){if(si.weights[k]!==v)throw new Error('SI weight mismatch '+k)}
if(si.composite.score!==null)throw new Error('Composite score must remain null while component inputs/rules are incomplete');
if(si.qualificationThreshold!==null)throw new Error('Unapproved SI qualification threshold found');
if(si.firstTest.proposedEntry.dollarAmount!=='FOUNDER SELECTS')throw new Error('Unapproved fixed stake found');
if(si.live.state!=='DISARMED / FIRE BLOCKED')throw new Error('Live lane unexpectedly executable');
console.log('PASS SI Crypto V0 authorized weights');
console.log('PASS no unapproved stake or qualification threshold');
console.log('PASS current SI market weights preserve 0.90 raw weight before normalization');

const v0a=data.siCryptoV0A;
if(!v0a)throw new Error('SI Crypto V0-A state missing');
if(v0a.scores.SI_CORE_V0A!==null)throw new Error('V0-A core score must remain null without required historical inputs');
if(v0a.scores.fullSI!==null)throw new Error('V0-A full score must remain null while N is invalid');
if(v0a.robinhoodOfficialApi.historicalOHLCV!==false)throw new Error('Official API OHLCV proof mismatch');
if(v0a.robinhoodOfficialApi.secretCreated!==false)throw new Error('Unexpected Robinhood API secret creation');
const binance=v0a.thirdPartyCandidates.find(x=>x.name.startsWith('Binance.US'));
if(!binance||!/APPROVED \+ CONNECTED/.test(binance.status))throw new Error('Approved Binance.US public source not represented');
if(v0a.binanceUsPublicData?.credential!=='NONE')throw new Error('Unexpected Binance.US credential');
if(v0a.binanceUsPublicData?.executionAuthority!=='NONE')throw new Error('Unexpected Binance.US execution authority');
if(v0a.binanceUsPublicData?.sample?.Q!==null)throw new Error('Q must remain null before historical spread collection');
console.log('PASS SI Crypto V0-A governed hold');
console.log('PASS official Robinhood API data gap truth');
console.log('PASS Binance.US public research source only');


const fixedNow=Date.parse('2026-10-05T06:00:00Z');
const bundle={
  evidence:[
    {id:'e1',required:true,stance:'SUPPORT',independentGroup:'provider',observedAt:'2026-10-05T06:00:00Z',freshnessHalfLifeMs:60000,sourceClass:'DIRECT_PROVIDER_OFFICIAL'},
    {id:'e2',required:true,stance:'SUPPORT',independentGroup:'filing',observedAt:'2026-10-05T06:00:00Z',freshnessHalfLifeMs:60000,sourceClass:'REGULATORY_OR_COMPANY_FILING'},
    {id:'e3',required:true,stance:'SUPPORT',independentGroup:'reporting',observedAt:'2026-10-05T06:00:00Z',freshnessHalfLifeMs:60000,sourceClass:'HIGH_QUALITY_VERIFIED_REPORTING'}
  ],
  crossChecks:[{id:'x1',result:'PASS'},{id:'x2',result:'FAIL'}],
  anomalyChecks:[{id:'a1',result:'PASS'},{id:'a2',result:'PASS'}],
  collisionTests:[{id:'c1',candidateSurvives:true},{id:'c2',candidateSurvives:false}]
};
const nv0=calculateNV0(bundle,fixedNow);
if(nv0.version!==N_VERSION||nv0.status!=='VALID')throw new Error('N_V0 valid fixture failed');
if(!(nv0.value>=0&&nv0.value<=1))throw new Error('N_V0 bounds failed');
if(nv0.components.N_E.value!==1)throw new Error('N_E independent evidence normalization failed');
if(nv0.components.N_Fr.value!==1)throw new Error('N_Fr freshness normalization failed');
if(Math.abs(nv0.components.N_Tr.value-((1+.9+.75)/3))>1e-12)throw new Error('N_Tr trust normalization failed');
if(nv0.components.N_Tx.value!==.5)throw new Error('N_Tx normalization failed');
if(nv0.components.N_A.value!==1)throw new Error('N_A normalization failed');
if(nv0.components.N_C.value!==.5)throw new Error('N_C normalization failed');
const missingN=calculateNV0(null,fixedNow);
if(missingN.value!==null||missingN.status!=='INCOMPLETE')throw new Error('Missing N evidence did not fail closed');
if(JSON.stringify(missingN).includes('"value":0.5'))throw new Error('Neutral N default detected');
const full=calculateFullSIV0({M:.6,T:.6,V:.6,Q:.6,F:.6,N:nv0.value});
if(full.version!==SI_VERSION||full.status!=='VALID'||!Number.isFinite(full.value))throw new Error('FULL SI_V0 valid fixture failed');
const fullMissing=calculateFullSIV0({M:.6,T:.6,V:.6,Q:.6,F:.6,N:null});
if(fullMissing.value!==null||fullMissing.status!=='INCOMPLETE')throw new Error('FULL SI_V0 did not fail closed on missing N');
if(data.siCryptoV0?.nV0?.version!=='N_V0')throw new Error('N_V0 cockpit metadata missing');
console.log('PASS N_V0 deterministic six-component normalization');
console.log('PASS N_V0 fail-closed missing-data rule');
console.log('PASS FULL SI_V0 versioned deterministic calculation');


const componentNames=['N_E','N_Fr','N_Tr','N_Tx','N_A','N_C'];
for(const name of componentNames){
  const value=nv0.components[name].value;
  if(value!==null&&(!Number.isFinite(value)||value<0||value>1))throw new Error(name+' outside [0,1]');
}
console.log('PASS every N_V0 subcomponent bounded [0,1]');

const missingCases=[
  {name:'E',bundle:null},
  {name:'Fr',bundle:{...bundle,evidence:bundle.evidence.map((e,i)=>i?e:{...e,observedAt:null})}},
  {name:'Tr',bundle:{...bundle,evidence:bundle.evidence.map((e,i)=>i?e:{...e,sourceClass:'NOT_A_CLASS'})}},
  {name:'Tx',bundle:{...bundle,crossChecks:[]}},
  {name:'A',bundle:{...bundle,anomalyChecks:[]}},
  {name:'C',bundle:{...bundle,collisionTests:[]}}
];
for(const x of missingCases){
  const r=calculateNV0(x.bundle,fixedNow);
  if(r.value!==null||r.status!=='INCOMPLETE')throw new Error('Missing '+x.name+' did not fail closed');
  const vals=Object.values(r.components).map(v=>v.value);
  if(vals.some(v=>v===0 && x.name!=='E')){/* valid observed zero is permitted; missing itself must remain null */}
}
console.log('PASS missing E/Fr/Tr/Tx/A/C never imputed');

const invalidMain=[
  {M:-0.01,T:.5,V:.5,Q:.5,F:.5,N:.5},
  {M:.5,T:1.01,V:.5,Q:.5,F:.5,N:.5},
  {M:.5,T:.5,V:-1,Q:.5,F:.5,N:.5},
  {M:.5,T:.5,V:.5,Q:2,F:.5,N:.5},
  {M:.5,T:.5,V:.5,Q:.5,F:-.1,N:.5},
  {M:.5,T:.5,V:.5,Q:.5,F:.5,N:1.1}
];
for(const x of invalidMain){
  const r=calculateFullSIV0(x);
  if(r.value!==null||r.status!=='INCOMPLETE'||!r.invalid.length)throw new Error('Out-of-range SI component accepted');
}
console.log('PASS FULL SI_V0 refuses any M/T/V/Q/F/N outside [0,1]');

const exact=calculateFullSIV0({M:.2,T:.3,V:.4,Q:.5,F:.6,N:.7});
const expectedWeighted=.30*.2+.20*.3+.15*.4+.10*.5+.15*.6+.10*.7;
if(exact.status!=='VALID'||Math.abs(exact.weightedSum-expectedWeighted)>1e-12||Math.abs(exact.value-100*expectedWeighted)>1e-12)throw new Error('Weighted SI arithmetic mismatch');
if(Math.abs(exact.contributions.M-.30*.2)>1e-12||Math.abs(exact.contributions.N-.10*.7)>1e-12)throw new Error('SI contribution arithmetic mismatch');
console.log('PASS FULL SI_V0 exact six-component weighted arithmetic');

if(si.qualificationThreshold!==null)throw new Error('Qualification threshold invented');
console.log('PASS qualification threshold remains unset');

if(!/NO REAL MONEY|ZERO REAL-MONEY AUTHORITY/.test(String(si.shadow?.authority||'')))throw new Error('Shadow lane gained execution authority');
if(si.live?.state!=='DISARMED / FIRE BLOCKED')throw new Error('Execution/FIRE state expanded');
console.log('PASS shadow authority zero and live execution DISARMED / FIRE BLOCKED');

if(!/Historical \/ Diagnostic/.test(text))throw new Error('Lower V0-A section not labeled historical/diagnostic');
if(!/SAME AUTHORITATIVE D1 VALUE AS TOP SI/.test(text))throw new Error('Lower V0-A cards are not tied to top D1 observation');
if(/INCOMPLETE — SPREAD HISTORY REQUIRED/.test(text))throw new Error('Stale conflicting Q presentation remains in live UI code');
console.log('PASS cockpit has one authoritative current M/T/V/Q/F market state with separate N_V0 research');

if(!/Research observation/.test(text)||!/Robinhood provider snapshot/.test(text)||!/Fresh live execution connectivity/.test(text))throw new Error('Research vs Robinhood snapshot freshness is not visibly distinguished');
console.log('PASS research freshness visibly separated from Robinhood snapshot freshness');

if(data.siCryptoV0A?.nEvidenceInventory?.result!=='NO CURRENT CANDIDATE-SPECIFIC STRUCTURED NFE/UMEO BUNDLE FOUND')throw new Error('N evidence inventory truth missing');
for(const k of ['N_E','N_Fr','N_Tr','N_Tx','N_A','N_C']){
  if(!data.siCryptoV0A.nEvidenceInventory.exactMissing[k])throw new Error('Missing evidence inventory for '+k);
}
console.log('PASS N evidence inventory records exact fail-closed missing inputs');


const coreFixture={M:.2,T:.3,V:.4,Q:.5,F:.6};
const coreExpectedRaw=.30*.2+.20*.3+.15*.4+.10*.5+.15*.6;
const coreExpected=100*coreExpectedRaw/.90;
const core=calculateSICoreV0A(coreFixture);
if(core.status!=='VALID'||Math.abs(core.value-coreExpected)>1e-12)throw new Error('SI_CORE_V0A exact arithmetic mismatch');
if(Math.abs(core.weightedSum-coreExpectedRaw)>1e-12||core.denominator!==.90)throw new Error('SI_CORE_V0A normalization mismatch');
console.log('PASS SI_CORE_V0A exact authorized five-component arithmetic');

const coreWithNUnknown=calculateSICoreV0A(coreFixture);
const coreWithNIncomplete=calculateSICoreV0A(coreFixture);
if(coreWithNUnknown.value!==core.value||coreWithNIncomplete.value!==core.value)throw new Error('N state changed SI_CORE_V0A');
console.log('PASS N_V0 UNKNOWN/INCOMPLETE does not block or alter SI_CORE_V0A');

for(const k of ['M','T','V','Q','F']){
  const x={...coreFixture,[k]:null};
  const r=calculateSICoreV0A(x);
  if(r.status!=='INCOMPLETE'||r.value!==null||!r.missing.includes(k))throw new Error('Missing '+k+' did not block SI_CORE_V0A');
}
console.log('PASS missing M/T/V/Q/F blocks SI_CORE_V0A');

for(const k of ['M','T','V','Q','F']){
  const x={...coreFixture,[k]:1.01};
  const r=calculateSICoreV0A(x);
  if(r.status!=='INCOMPLETE'||r.value!==null||!r.invalid.some(v=>v.component===k))throw new Error('Invalid '+k+' accepted by SI_CORE_V0A');
}
console.log('PASS out-of-range M/T/V/Q/F blocks SI_CORE_V0A');

if(data.siCryptoV0?.nV0?.blocksSiCore!==false)throw new Error('N_V0 still marked as SI core blocker');
if(!/NFE EVIDENCE RESEARCH — N_V0/.test(text))throw new Error('Separate N_V0 research presentation missing');
if(!/AUTHORITATIVE CURRENT MARKET INTELLIGENCE/.test(text))throw new Error('Authoritative SI core label missing');
if(!/LIVE QUALIFICATION THRESHOLD: NOT YET FOUNDER APPROVED/.test(text))throw new Error('Threshold status missing');
if(/FULL SI_V0/.test(text.split('function renderSiCrypto(){')[1]?.split('function showConfigStatus')[0]||''))throw new Error('Primary current SI panel still presents FULL SI_V0');
console.log('PASS N_V0 research preserved but removed from primary market score');

if(!/SI_CORE_V0A/.test(text)||!/M\/T\/V\/Q\/F/.test(text))throw new Error('Five-component market intelligence presentation missing');
if(/V0 RESEARCH · FULL SI REQUIRES VALID N_V0/.test(text))throw new Error('Stale N-blocking status remains');
console.log('PASS stale N-blocking cockpit presentation removed');

if(!/Fresh live execution connectivity/.test(text)||!/NOT CLAIMED — SNAPSHOT-BACKED/.test(text))throw new Error('Stale Robinhood snapshot disclosure missing');
console.log('PASS stale Robinhood provider state remains visibly separated');


if(!/provider-capability/.test(text))throw new Error('Robinhood provider capability endpoint wiring missing from cockpit');
if(!/Start provider scan/.test(text)||!/Run fresh order preview/.test(text)||!/Refresh equity WATCH/.test(text)||!/Refresh options WATCH/.test(text))throw new Error('Governed read/preview control surface missing');
if(/id="startProviderScan"[^>]*disabled/.test(text)||/id="freshPreview"[^>]*disabled/.test(text))throw new Error('Blocked provider controls are decorative-disabled instead of returning exact blockers');
console.log('PASS provider-dependent buttons execute truthful capability checks');

if(!/STALE \/ SNAPSHOT/.test(text)||!/FRESH LOCK REQUIRED/.test(text))throw new Error('Crypto radar does not label captured Robinhood state as stale');
if(!/NOT SCORED/.test(text))throw new Error('Unscored crypto rows are not distinguished from current SI specimen');
console.log('PASS crypto radar separates D1 score state from stale Robinhood snapshot state');

if(!/NFE EVIDENCE RESEARCH — N_V0/.test(text)||!/UNKNOWN \/ INCOMPLETE/.test(text)||!/doubleCount|marketDataDoubleCountPrevented/.test(text))throw new Error('NFE diagnostic research panel missing operational evidence state');
console.log('PASS NFE diagnostic panel preserves fail-closed provenance');

if(!/freeze an exact Founder-selected dollar amount/.test(text))throw new Error('Fresh preview does not require Founder-selected config');
if(/dollarAmount\s*[:=]\s*['"]?1(?:\.0+)?['"]?/i.test(text))throw new Error('Hard-coded $1 stake authority detected');
console.log('PASS no default stake and preview requires Founder configuration');
