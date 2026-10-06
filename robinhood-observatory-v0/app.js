const money=(n,d=2)=>n==null?'N/A':Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d});
const num=(n,d=2)=>n==null?'N/A':Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=n=>n==null?'N/A — NO POSITION':`${Number(n)>=0?'+':''}${Number(n).toFixed(2)}%`;
const el=id=>document.getElementById(id);
const fmtTime=t=>t?new Date(t).toLocaleString():'N/A — NO PROVIDER TIMESTAMP';
let D, selected='SPY', inspectedCrypto=null, radarViewPaused=false, providerScanState='STOPPED';

Promise.all([
  fetch('./data/snapshot.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`snapshot ${r.status}`);return r.json()}),
  fetch('/api/v0a/ledger-status',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
  fetch('/api/robinhood/execution/state',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
])
.then(([d,ledger,execution])=>{D=d;D.liveLedger=ledger;D.executionState=execution;inspectedCrypto=D.operationalCockpit?.lock?.symbol||D.cryptoUniverse?.rows?.[0]?.symbol||null;render()})
.catch(e=>{document.body.innerHTML=`<main><div class="panel"><h2 class="error">🔴 SNAPSHOT LOAD ERROR</h2><p>No values were fabricated.</p><code>${String(e.message)}</code></div></main>`});

function render(){
  el('capturedAt').textContent=fmtTime(D.meta.capturedAt);
  renderAccount();renderSiCrypto();renderV0A();renderOperational();renderCryptoUniverse();renderMarkets();renderResearchLanes();renderDetail();renderOptions();renderExisting();renderCrypto();renderEvidence();
  document.querySelectorAll('[data-symbol]').forEach(b=>b.onclick=()=>{selected=b.dataset.symbol;document.querySelectorAll('[data-symbol]').forEach(x=>x.classList.toggle('active',x===b));renderDetail()});
}


function readTestConfig(){
  try{return JSON.parse(sessionStorage.getItem('nfeSiCryptoTestConfig')||'null')}catch{return null}
}
function writeTestConfig(v){sessionStorage.setItem('nfeSiCryptoTestConfig',JSON.stringify(v))}
function clearTestConfig(){sessionStorage.removeItem('nfeSiCryptoTestConfig')}

function renderSiCrypto(){
 const s=D.siCryptoV0, c=s.components, cfg=readTestConfig(), live=D.liveLedger?.latestObservation||null;
 const liveMap=live?{M:live.m,T:live.t,V:live.v,Q:live.q,F:live.f}:{};
 const liveCore=live?.si_core_v0a??null;
 const nValue=live?.n_v0??null;
 const nParts=live?{N_E:live.n_e,N_Fr:live.n_fr,N_Tr:live.n_tr,N_Tx:live.n_tx,N_A:live.n_a,N_C:live.n_c}:{};
 const nMissing=live?.n_missing_components?(()=>{try{return JSON.parse(live.n_missing_components)}catch{return []}})():[];
 el('siFormula').innerHTML=`
   <div class="formula">${s.coreFormula||D.siCryptoV0A?.coreFormula}</div>
   <div class="chips"><span class="chip">AUTHORITATIVE CURRENT MARKET INTELLIGENCE</span><span class="chip">LIVE QUALIFICATION THRESHOLD: NOT YET FOUNDER APPROVED</span><span class="chip">${live?'D1 LIVE RESEARCH FEED':'D1 FEED UNAVAILABLE'}</span></div>
   <div class="kv"><span>MARKET INTELLIGENCE SCORE</span><b>${liveCore==null?'INCOMPLETE':('SI_CORE_V0A '+num(liveCore,4))}</b><span>Research observation</span><b>${live?.observed_at||'N/A'}</b><span>Research source</span><b>Binance.US public → D1</b><span>Robinhood provider snapshot</span><b>${D.operationalCockpit?.lock?.providerTimestamp||D.meta?.capturedAt||'N/A'}</b></div>
   <p class="sub">SI_CORE_V0A is a normalized composite research score, not probability of profit or directional success. Numeric intelligence does not authorize FIRE.</p>
   <p class="sub">Research freshness and Robinhood provider freshness are separate. Only a fresh Robinhood MCP reread may establish a future LOCK.</p>`;

 el('siComponents').innerHTML=['M','T','V','Q','F'].map(k=>{const x=c[k],lv=liveMap[k],has=Number.isFinite(Number(lv))&&lv!==null;return `
   <article class="panel si-card">
     <div class="si-key">${k}</div><h3>${x.name}</h3>
     <div class="si-value">${has?num(lv,4):'INCOMPLETE'}</div>
     <div class="state ${has?'current':'error'}">${has?'VALID / POPULATED / CALCULATED':'MISSING / NOT YET VALID'}</div>
     <div class="raw-box"><b>Source provenance</b><pre>${escapeHtml(JSON.stringify({researchSource:'Binance.US public',ledger:'nfe-os-robinhood-si-v0a-ledger',robinhoodLockAuthority:'MCP only',observedAt:live?.observed_at||null},null,2))}</pre></div>
   </article>`}).join('');

 el('nResearch').innerHTML=`
   <article class="panel si-card">
     <div class="si-key">N</div><h3>NFE EVIDENCE RESEARCH — N_V0</h3>
     <div class="si-value">${nValue==null?'INCOMPLETE':num(nValue,4)}</div>
     <div class="state ${nValue==null?'error':'current'}">${nValue==null?'RESEARCH / DIAGNOSTIC — UNKNOWN / INCOMPLETE':'RESEARCH / DIAGNOSTIC — CALCULATED'}</div>
     <p class="sub">N_V0 is preserved as an independent NFE/UMEO evidence instrument. It does NOT block or alter SI_CORE_V0A.</p>
     <div class="raw-box"><b>N_V0 subcomponents + provenance</b><pre>${escapeHtml(JSON.stringify({version:live?.n_version||'N_V0',N_V0:nValue,...nParts,missing:nMissing,provenance:live?.n_provenance_json?(()=>{try{return JSON.parse(live.n_provenance_json)}catch{return live.n_provenance_json}})():null,reasons:{N_E:live?.n_e_reason||null,N_Fr:live?.n_fr_reason||null,N_Tr:live?.n_tr_reason||null,N_Tx:live?.n_tx_reason||null,N_A:live?.n_a_reason||null,N_C:live?.n_c_reason||null}},null,2))}</pre></div>
   </article>`;

 el('shadowLane').innerHTML=`
   <div class="hero-symbol">${s.shadow.state}</div>
   <div class="kv"><span>Authority</span><b>${s.shadow.authority}</b><span>Recorded evaluations</span><b>${s.shadow.records.length}</b><span>Current market score</span><b>${liveCore==null?'INCOMPLETE':num(liveCore,4)}</b><span>First-specimen qualification</span><b>${D.liveProviderScan?.candidate?.leader?'READY — CURRENT VALID SI-RANKED LEADER / NO PERMANENT THRESHOLD':'PENDING FRESH PROVIDER SCAN + VALID SI RANK'}</b><span>Outcome horizons</span><b>${s.shadow.horizons.join(' · ')}</b><span>Excursion metrics</span><b>${s.shadow.excursionMetrics.join(' · ')}</b></div>
   <p class="sub">Shadow may observe, score, record, and reconcile outcomes. It has zero real-money authority.</p>`;

 el('liveLane').innerHTML=`
   <div class="hero-symbol">${s.live.state}</div>
   <div class="kv"><span>Authority</span><b>${s.live.authority}</b><span>Execution adapter</span><b>${s.live.executionCapability}</b><span>Positions</span><b>${s.live.providerReconciliation.positions}</b><span>Open orders</span><b>${s.live.providerReconciliation.openOrders}</b><span>Crypto buying power</span><b>${money(s.live.providerReconciliation.cryptoBuyingPower)}</b><span>Last provider requalification</span><b>${fmtTime(s.live.providerReconciliation.lastChecked)}</b></div>
   <p class="sub">FIRE remains blocked. A numeric SI_CORE_V0A is measurement only; fresh Robinhood LOCK, an approved qualification rule, Founder authority, and all existing safety gates are still required.</p>`;

 const frozen=cfg?.frozen===true;
 el('testConfig').innerHTML=`
   <div class="config-grid">
     <label>Live dollar amount / max debit<input id="stakeInput" type="number" min="0.01" step="0.01" placeholder="Founder enters amount" ${frozen?'disabled':''} value="${cfg?.stake??''}"></label>
     <label>Entry order type<select id="entryType" ${frozen?'disabled':''}><option value="">Select</option><option value="market" ${cfg?.entryType==='market'?'selected':''}>Market</option><option value="limit" ${cfg?.entryType==='limit'?'selected':''}>Limit</option><option value="stop" ${cfg?.entryType==='stop'?'selected':''}>Stop order</option><option value="stop_limit" ${cfg?.entryType==='stop_limit'?'selected':''}>Stop limit order</option></select></label>
     <label>Exit condition<select id="exitCondition" ${frozen?'disabled':''}><option value="">Select</option><option value="manual" ${cfg?.exitCondition==='manual'?'selected':''}>Manual Founder exit</option><option value="profit" ${cfg?.exitCondition==='profit'?'selected':''}>Profit / target</option><option value="loss" ${cfg?.exitCondition==='loss'?'selected':''}>Loss / invalidation</option><option value="time" ${cfg?.exitCondition==='time'?'selected':''}>Time / max hold</option><option value="score" ${cfg?.exitCondition==='score'?'selected':''}>Score deterioration</option></select></label>
     <label>Exit value / rule<input id="exitValue" type="text" placeholder="Founder-defined; blank for manual" ${frozen?'disabled':''} value="${cfg?.exitValue??''}"></label>
     <label>Exit order mechanic<select id="exitType" ${frozen?'disabled':''}><option value="">Select</option><option value="market" ${cfg?.exitType==='market'?'selected':''}>Market</option><option value="limit" ${cfg?.exitType==='limit'?'selected':''}>Limit</option><option value="stop" ${cfg?.exitType==='stop'?'selected':''}>Stop order</option><option value="stop_limit" ${cfg?.exitType==='stop_limit'?'selected':''}>Stop limit order</option></select></label>
   </div>
   <div class="controls-inline">
     <button class="control-btn" id="freezeConfig" ${frozen?'disabled':''}>Freeze next-test config</button>
     <button class="control-btn" id="clearConfig" ${frozen?'':'disabled'}>Clear frozen config</button>
   </div>
   <div class="config-proof">${frozen?`<b>FROZEN FOR THIS BROWSER SESSION:</b> stake ${money(cfg.stake)} · entry ${cfg.entryType} · exit ${cfg.exitCondition} · exit mechanic ${cfg.exitType} · rule ${cfg.exitValue||'manual/no numeric value'}`:'No Founder test configuration is frozen.'}</div>`;

 el('freezeConfig').onclick=()=>{
   const stake=Number(el('stakeInput').value),entryType=el('entryType').value,exitCondition=el('exitCondition').value,exitValue=el('exitValue').value.trim(),exitType=el('exitType').value;
   if(!Number.isFinite(stake)||stake<=0)return showConfigStatus('Cannot freeze: enter a positive dollar amount.');
   if(stake>D.account.buyingPower)return showConfigStatus(`Cannot freeze: ${money(stake)} exceeds current captured crypto buying power of ${money(D.account.buyingPower)}.`);
   if(!entryType)return showConfigStatus('Cannot freeze: select an entry order type.');
   if(!exitCondition)return showConfigStatus('Cannot freeze: select an exit condition.');
   if(exitCondition!=='manual'&&!exitValue)return showConfigStatus('Cannot freeze: selected exit condition needs a Founder-defined value/rule.');
   if(!exitType)return showConfigStatus('Cannot freeze: select an exit order mechanic.');
   writeTestConfig({stake,entryType,exitCondition,exitValue,exitType,frozen:true,frozenAt:new Date().toISOString()});
   renderSiCrypto(); showConfigStatus('Test configuration frozen locally. This does NOT arm or submit anything.');
 };
 el('clearConfig').onclick=()=>{clearTestConfig();renderSiCrypto();showConfigStatus('Frozen local test configuration cleared. Execution remains DISARMED.')};
}

function showConfigStatus(msg){el('configStatus').textContent=msg||''}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}


function renderV0A(){
 const v=D.siCryptoV0A, live=D.liveLedger?.latestObservation||null;
 const current={M:live?.m??null,T:live?.t??null,V:live?.v??null,F:live?.f??null,Q:live?.q??null,N:live?.n_v0??null};
 const nMissing=live?.n_missing_components?(()=>{try{return JSON.parse(live.n_missing_components)}catch{return []}})():[];
 el('v0aState').innerHTML=`
   <div class="hero-symbol">HISTORICAL / DIAGNOSTIC INSTRUMENTATION</div>
   <div class="formula">${v.coreFormula}</div>
   <div class="chips"><span class="chip">NOT A SECOND SI BRAIN</span><span class="chip">CURRENT VALUES COME FROM THE SAME D1 OBSERVATION AS THE TOP SI CARDS</span></div>
   <p class="sub">Static V0-A configuration/specimen fields below are retained for provenance only. They do not override the current D1 observation.</p>
   <div class="kv"><span>Current D1 observation</span><b>${live?.observed_at||'UNAVAILABLE'}</b><span>Current Q</span><b>${current.Q==null?'INCOMPLETE':num(current.Q,4)}</b><span>Current N_V0</span><b>${current.N==null?'INCOMPLETE':num(current.N,4)}</b><span>Current SI_CORE_V0A</span><b>${live?.si_core_v0a==null?'INCOMPLETE':num(live.si_core_v0a,4)}</b></div>`;
 el('v0aComponents').innerHTML=['M','T','V','F','Q','N'].map(k=>{const value=current[k],valid=value!==null&&Number.isFinite(Number(value));return `<article class="panel si-card"><div class="si-key">${k}</div><h3>${k}</h3><div class="si-value">${valid?num(value,4):'INCOMPLETE'}</div><div class="state ${valid?'current':'error'}">${valid?'SAME AUTHORITATIVE D1 VALUE AS TOP SI':'FAIL CLOSED / CURRENT D1 INPUT MISSING'}</div><div class="sub">Observation: ${live?.observed_at||'N/A'}${k==='N'&&nMissing.length?' · Missing: '+nMissing.map(x=>x.component).join(', '):''}</div></article>`}).join('');
 const a=v.robinhoodOfficialApi;
 const providerFresh=D.liveProviderScan?.publicWorkerLiveRead===true&&D.liveProviderScan?.providerState==='FRESH';
 el('v0aOfficial').innerHTML=`<div class="kv"><span>Historical OHLCV</span><b>${a.historicalOHLCV?'YES':'NO'}</b><span>Volume</span><b>${a.volume?'YES':'NO'}</b><span>Depth</span><b>${a.depth?'YES':'NO'}</b><span>Bid/ask size</span><b>${a.bidAskSize?'YES':'NO'}</b><span>Robinhood provider snapshot</span><b>${D.operationalCockpit?.lock?.providerTimestamp||D.meta?.capturedAt||'N/A'}</b><span>Fresh live execution connectivity</span><b>${providerFresh?'CONNECTED — FRESH ROBINHOOD READ':'NOT CLAIMED — SNAPSHOT-BACKED'}</b><span>Fresh provider time</span><b>${providerFresh?fmtTime(D.liveProviderScan.freshProviderTimestamp):'N/A — START PROVIDER SCAN'}</b></div><p class="sub">${providerFresh?'Fresh Robinhood provider data is active for scan/LOCK evidence. Execution remains governed separately.':'This panel is diagnostic until a fresh Robinhood provider scan succeeds.'}</p>`;
 const counts=D.liveLedger?.counts||{};
 el('v0aLedger').innerHTML=`<div class="kv"><span>Observations</span><b>${counts.observations??'N/A'}</b><span>Spread samples</span><b>${counts.spreadSamples??'N/A'}</b><span>Outcomes reconciled</span><b>${counts.reconciled??'N/A'}</b><span>Current research symbol</span><b>${live?.research_symbol||'N/A'}</b><span>SI_CORE_V0A</span><b>${live?.si_core_v0a==null?'INCOMPLETE':num(live.si_core_v0a,4)}</b><span>N_V0 research</span><b>${live?.n_v0==null?'INCOMPLETE / NON-BLOCKING':num(live.n_v0,4)}</b></div><p class="sub">Current-state source: dedicated D1 ledger. Historical V0-A snapshot text is diagnostic only.</p>`;
 el('v0aCandidates').innerHTML=`<div class="evidence-row"><span>N_V0 evidence ingestion</span><span class="stale">FAIL-CLOSED</span><span>Existing approved surfaces checked; no current candidate-specific structured NFE/UMEO bundle supplies all E/Fr/Tr/Tx/A/C inputs.</span></div><p class="sub">No new third-party NFE score provider was connected. No missing N evidence was synthesized.</p>`;
}

function renderAccount(){
 const a=D.account;
 const cards=[['Cash',money(a.cash)],['Buying power',money(a.buyingPower)],['Portfolio value',money(a.portfolioValue)],['Positions',`${a.positionCounts.equity+a.positionCounts.crypto+a.positionCounts.option} open`]];
 el('account').innerHTML=cards.map(([k,v],i)=>`<article class="card"><h3>${k}</h3><div class="value">${v}</div><div class="sub">${i===3?`Equity ${a.positionCounts.equity} · Crypto ${a.positionCounts.crypto} · Options ${a.positionCounts.option}`:`Agentic ${a.maskedId}`}</div></article>`).join('');
}

function renderOperational(){
 const o=D.operationalCockpit,r=o.radar,l=o.lock,p=o.position,m=o.manage,live=D.liveLedger?.latestObservation||null,scan=D.liveProviderScan||null;
 const durable=D.executionState?.state||null;
 const durableState=durable?.state||o.execution.state;
 const durableArmed=durable?.armed===true;
 const candidate=scan?.candidate?.leader||null;
 const providerFresh=scan?.publicWorkerLiveRead===true&&scan?.providerState==='FRESH';
 const runtimeSymbol=candidate?.symbol||null;
 const freshQuote=providerFresh&&runtimeSymbol&&scan?.quote?.symbol===runtimeSymbol?scan.quote:null;
 const lockSymbol=runtimeSymbol||durable?.specimen?.symbol||l.symbol||null;
 const snapshotMatchesRuntime=Boolean(runtimeSymbol&&l.symbol===runtimeSymbol);
 const durableSpecimenMatchesRuntime=Boolean(runtimeSymbol&&durable?.specimen?.symbol===runtimeSymbol);
 const activePreview=durableSpecimenMatchesRuntime?durable?.specimen?.previewEvidence:null;
 const lockBid=freshQuote?.bid??(snapshotMatchesRuntime?l.bid:null);
 const lockAsk=freshQuote?.ask??(snapshotMatchesRuntime?l.ask:null);
 const lockMark=freshQuote?.mark??((lockBid!=null&&lockAsk!=null)?(Number(lockBid)+Number(lockAsk))/2:(snapshotMatchesRuntime?l.mark:null));
 const lockSpread=(lockBid!=null&&lockAsk!=null)?Number(lockAsk)-Number(lockBid):(snapshotMatchesRuntime?l.spread:null);
 const lockSpreadPct=(lockMark&&lockSpread!=null)?lockSpread/Number(lockMark):(snapshotMatchesRuntime?l.spreadPct:null);
 const previewState=durableSpecimenMatchesRuntime&&activePreview?'CURRENT SPECIMEN PREVIEW':(snapshotMatchesRuntime?l.previewState:'INVALID — DIFFERENT SPECIMEN');
 const approvalState=durableSpecimenMatchesRuntime&&durable?.approval?.specimenFp===durable?.specimenFp?'BOUND TO CURRENT SPECIMEN':(snapshotMatchesRuntime?l.founderApproval:'INVALID — DIFFERENT SPECIMEN');
 el('quickState').innerHTML=`<div class="kv"><span>Current lifecycle</span><b>${durableState}</b><span>Current candidate</span><b>${candidate?.symbol||r.leader||l.symbol||'NONE'}</b><span>Candidate SI_CORE_V0A</span><b>${candidate?.score==null?'NOT YET RANKED':num(candidate.score,4)}</b><span>Qualification mode</span><b>${candidate?'FIRST SPECIMEN — RANK ONLY / NO PERMANENT THRESHOLD':'START PROVIDER SCAN TO RANK'}</b><span>Robinhood LOCK</span><b>${providerFresh&&lockSymbol?'FRESH · '+lockSymbol:(l.state+' · '+(lockSymbol||'NONE'))}</b><span>Execution authority</span><b>${durableState}</b><span>Armed</span><b>${durableArmed?'YES':'NO'}</b><span>Position state</span><b>${durable?.owned?'OWNED':p.state}</b></div>`;
 el('executionStrip').innerHTML=`
   <div><span>EXECUTION</span><strong class="${durableArmed?'current':'stale'}">${durableState}</strong><small>${providerFresh?'PROVIDER CONNECTED / FRESH':o.execution.reason}</small></div>
   <div><span>RADAR</span><strong class="${providerFresh?'current':'stale'}">${providerFresh?'PROVIDER FRESH':r.state}</strong><small>${r.eligibleCount} eligible of ${r.universeSize} provider pairs · provider scan ${providerScanState}</small></div>
   <div><span>LOCK</span><strong class="${providerFresh&&freshQuote?'current':'stale'}">${providerFresh&&freshQuote?'FRESH PROVIDER EVIDENCE':l.state}</strong><small>${lockSymbol||'NONE'} · ${providerFresh&&freshQuote?fmtTime(scan.freshProviderTimestamp):l.freshness}</small></div>
   <div><span>POSITION</span><strong>${p.state}</strong><small>${p.orderState}</small></div>
   <div><span>MANAGE</span><strong>${m.state}</strong><small>${m.reason}</small></div>`;

 el('radarPanel').innerHTML=`
   <div class="hero-symbol">${candidate?.symbol||r.leader||'NONE'}</div>
   <div class="state ${candidate?'current':'stale'}">${candidate?'FIRST-SPECIMEN SI-RANKED LEADER':'NO VALID SI-RANKED LEADER YET'}</div>
   <p>${candidate?('SI_CORE_V0A '+num(candidate.score,4)+' · rank '+candidate.rank+' · fresh Robinhood tradability required and proven by scan'):r.leaderBasis}</p>
   <div class="kv"><span>Universe</span><b>${r.universeSize}</b><span>Eligible now</span><b>${r.eligibleCount}</b><span>Candidate pool</span><b>${r.candidateCount}</b><span>Last provider capture</span><b>${fmtTime(r.lastProviderUpdate)}</b></div>`;

 el('lockPanel').innerHTML=`
   <div class="hero-symbol">${lockSymbol||'NONE'} · ${durableSpecimenMatchesRuntime?(durable?.specimen?.side||'—'):(snapshotMatchesRuntime?l.side:'—')}</div>
   <div class="kv"><span>Bid</span><b>${money(lockBid,8)}</b><span>Ask</span><b>${money(lockAsk,8)}</b><span>Mark</span><b>${money(lockMark,8)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(lockSpread,8)} · ${lockSpreadPct==null?'N/A':pct(lockSpreadPct)}</b><span>Provider capture</span><b>${fmtTime(providerFresh&&freshQuote?scan.freshProviderTimestamp:(snapshotMatchesRuntime?l.providerTimestamp:null))}</b><span>Provider state</span><b class="${providerFresh&&freshQuote?'current':'stale'}">${providerFresh&&freshQuote?'FRESH / CONNECTED':'FRESH LOCK REQUIRED'}</b><span>Preview</span><b class="${previewState.startsWith('INVALID')?'error':'stale'}">${previewState}</b><span>Founder approval</span><b class="${approvalState.startsWith('INVALID')?'error':'stale'}">${approvalState}</b></div>
   <div class="preview-box"><b>${activePreview?'Current specimen preview':'Preview authority'}</b><span>${activePreview?escapeHtml(JSON.stringify(activePreview)):(snapshotMatchesRuntime?(money(l.previewAmount)+' '+l.previewType+' · '+l.previewQuantity+' · '+money(l.previewPrice,2)+' preview unit price · '+money(l.previewFee)+' estimated fee'):'STALE PREVIEW WITHHELD — RUNTIME SPECIMEN DOES NOT MATCH CAPTURED SPECIMEN')}</span><small>${activePreview?'Bound to durable specimen fingerprint.':(snapshotMatchesRuntime?('Preview captured '+fmtTime(l.previewCapturedAt)+'. Fresh LOCK must still match the current specimen.'):'A preview or approval for another symbol cannot authorize the current runtime candidate.')}</small></div>`;

 el('managePanel').innerHTML=`
   <div class="hero-symbol">${D.executionState?.state?.state||p.state}</div>
   <div class="state">${m.state}</div>
   <div class="kv"><span>Durable control</span><b>${D.executionState?.state?.state||'NOT LOADED'}</b><span>Live writes</span><b>${D.executionState?.liveWritesEnabled===true?'ENABLED — GOVERNED':'DISABLED'}</b><span>Provider surface</span><b>${providerFresh?'CONNECTED / FRESH':'NOT CONNECTED / SNAPSHOT'}</b><span>Owned quantity</span><b>${D.executionState?.state?.owned?.quantity??'0 — NO POSITION'}</b><span>Entry</span><b>${D.executionState?.state?.owned?.entryProviderId||'N/A — NO POSITION'}</b><span>Current bid</span><b>${money(p.currentBid,8)}</b><span>Current ask</span><b>${money(p.currentAsk,8)}</b><span>Current mark</span><b>${money(p.currentMark,8)}</b><span>Position value</span><b>${money(p.currentValue)}</b><span>Unrealized P&L</span><b>${money(p.unrealizedPnlUsd)} · N/A — NO POSITION</b><span>Realized P&L</span><b>N/A — NO COMPLETED LIFECYCLE</b><span>Position age</span><b>N/A — NO POSITION</b><span>Last reconciliation</span><b>${D.executionState?.state?.reconciliation||fmtTime(p.lastProviderReconciliation)}</b><span>Next governed action</span><b>${p.nextGovernedAction}</b><span>Exit authority</span><b>${D.executionState?.state?.owned?'OWNED — SELL REFUSED WHILE DISARMED':p.exitAuthority}</b></div>`;

 el('lifecycle').innerHTML=o.lifecycle.map((x,i)=>`<span class="life-step ${i<o.currentLifecycleIndex?'done':i===o.currentLifecycleIndex?'active':''}">${x}</span>`).join('<span class="life-arrow">→</span>');

 const governed=candidate?.symbol||live?.robinhood_symbol||r.leader||l.symbol||inspectedCrypto||'NONE';
 el('controls').innerHTML=`
   <button class="control-btn" id="inspectLeader">Inspect governed specimen</button>
   <button class="control-btn" id="pauseRadar">${radarViewPaused?'Resume':'Pause'} radar view</button>
   <button class="control-btn" id="viewPreview">View captured preview</button>
   <button class="control-btn blocked" id="armBlocked">ARM — governed</button>
   <button class="control-btn blocked" id="disarmState">DISARM state</button>
   <button class="control-btn blocked" id="startProviderScan">Start provider scan</button>
   <button class="control-btn blocked" id="pauseProviderScan">Pause provider scan</button>
   <button class="control-btn blocked" id="freshPreview">Run fresh order preview</button>
   <button class="control-btn blocked" id="founderApprove">Founder approve order</button>
   <button class="control-btn blocked" id="exitReview">Exit review</button>`;
 el('inspectLeader').onclick=()=>{if(governed!=='NONE')inspectedCrypto=governed;renderCryptoUniverse(true);showControlReason(`Inspecting ${governed} from the current D1 research observation plus last captured Robinhood snapshot. This is not a fresh Robinhood read.`)};
 el('pauseRadar').onclick=()=>{radarViewPaused=!radarViewPaused;renderOperational()};
 el('viewPreview').onclick=()=>{el('lockPanel').scrollIntoView({behavior:'smooth',block:'center'});showControlReason('Showing the latest captured preview evidence only. It is stale until a new governed Robinhood preview is run through a provider-capable path.')};
 el('armBlocked').onclick=async()=>{await postExecution('arm')};
 el('disarmState').onclick=async()=>{await postExecution('disarm')};
 el('startProviderScan').onclick=async()=>{providerScanState='CHECKING';renderOperational();const j=await requestRobinhoodCapability('start_provider_scan');D.liveProviderScan=j||null;providerScanState=j?.publicWorkerLiveRead?'RUNNING':'BLOCKED';await refreshExecutionState();renderOperational();renderV0A();renderCryptoUniverse(true)};
 el('pauseProviderScan').onclick=()=>{providerScanState='STOPPED';showControlReason('Provider scan state is STOPPED. No live Cloudflare Robinhood scan was running.');renderOperational()};
 el('freshPreview').onclick=async()=>{const cfg=readTestConfig();if(!cfg?.frozen)return showControlReason('BLOCKED: freeze an exact Founder-selected dollar amount, entry type, and exit plan first. No default trading value will be invented.');const symbol=D.liveProviderScan?.candidate?.leader?.symbol;if(!symbol)return showControlReason('BLOCKED: run Start provider scan and obtain a valid first-specimen SI-ranked leader first.');const locked=await postExecution('lock',{symbol,side:'buy',type:cfg.entryType,maxDebit:String(cfg.stake),orderConfig:{quote_amount:String(cfg.stake)},frozenConfiguration:cfg});if(!locked)return;await postExecution('preview',{previewEvidence:{nonExecuting:true,source:'founder-frozen-config',maxDebit:String(cfg.stake),symbol,providerTimestamp:D.liveProviderScan?.freshProviderTimestamp||null,quote:D.liveProviderScan?.quote||null,qualification:{mode:'FIRST_SPECIMEN_RANK_ONLY_NO_THRESHOLD',score:D.liveProviderScan?.candidate?.leader?.score??null,rank:D.liveProviderScan?.candidate?.leader?.rank??null}}})};
 el('founderApprove').onclick=async()=>{const st=await refreshExecutionState();const fp=st?.state?.specimenFp;if(!fp)return showControlReason('BLOCKED: no frozen specimen fingerprint is present. Approval cannot be blanket.');await postExecution('approve',{specimenFp:fp})};
 el('exitReview').onclick=async()=>{const st=await refreshExecutionState();if(st?.state?.owned)showControlReason('Owned position is present in durable state. Exit review is available; provider sell remains refused while DISARMED.');else showControlReason('NO POSITION: exit review is not applicable. Durable execution state has no owned position.')};
}

async function refreshExecutionState(){
  try{
    const r=await fetch('/api/robinhood/execution/state',{cache:'no-store'});
    const j=await r.json();
    D.executionState=j;
    return j;
  }catch(e){
    showControlReason('Durable execution state unavailable: '+String(e.message||e));
    return null;
  }
}
async function postExecution(action,body={}){
  try{
    const r=await fetch('/api/robinhood/execution/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    D.executionState=j;
    const st=j.state?.state||j.error||j.status||'UNKNOWN';
    showControlReason(`${action}: ${st}. Durable armed=${j.state?.armed===true?'true':'false'}. Live writes ${j.liveWritesEnabled===true?'enabled / governed':'disabled'}. ${j.reason||j.message||''}`);
    renderOperational();
    return r.ok?j:null;
  }catch(e){
    showControlReason(action+' failed: '+String(e.message||e));
    return null;
  }
}

async function requestRobinhoodCapability(action,targetId='controlReason'){
  const target=el(targetId);
  if(target) target.textContent='Checking Robinhood provider capability…';
  try{
    const r=await fetch('/api/robinhood/provider-capability?action='+encodeURIComponent(action),{cache:'no-store'});
    const j=await r.json();
    const msg=j.publicWorkerLiveRead
      ? `${j.status}: Robinhood provider ${j.providerState||'FRESH'} via ${j.providerPath||j.provider}. ${j.quote?.symbol||j.robinhoodSymbol||'NO SYMBOL'} bid ${j.quote?.bid??'N/A'} ask ${j.quote?.ask??'N/A'} at ${j.freshProviderTimestamp||'N/A'}. Execution ${j.robinhoodExecution||'UNKNOWN'}; armed=${j.armed===true?'true':'false'}.`
      : `${j.status}: ${j.blocker} Last Robinhood provider snapshot: ${j.lastRobinhoodProviderSnapshot||'unavailable'}.`;
    if(target) target.textContent=msg;
    return j;
  }catch(e){
    const msg='Provider capability check failed: '+String(e.message||e);
    if(target) target.textContent=msg;
    return null;
  }
}

function showControlReason(msg){el('controlReason').textContent=msg||''}

function renderCryptoUniverse(keepPosition=false){
 const u=D.cryptoUniverse, live=D.liveLedger?.latestObservation||null, scan=D.liveProviderScan||null, providerFresh=scan?.publicWorkerLiveRead===true&&scan?.providerState==='FRESH', q=(el('cryptoSearch')?.value||'').trim().toLowerCase(), f=el('cryptoFilter')?.value||'all';
 let rows=u.rows.filter(x=>(!q||x.symbol.toLowerCase().includes(q)||x.name.toLowerCase().includes(q))&&(f==='all'||(f==='tradable'&&x.tradable)||(f==='halted'&&!x.tradable)));
 rows.sort((a,b)=>(a.symbol>b.symbol?1:-1));
 el('cryptoUniverseSummary').innerHTML=`<span class="chip">${u.totalPairs} provider pairs in captured universe</span><span class="chip">${u.eligiblePairs} captured tradable</span><span class="chip">${radarViewPaused?'RADAR VIEW PAUSED':'RADAR VIEW ACTIVE'}</span><span class="chip">ROBINHOOD STATE: ${providerFresh?'FRESH / CONNECTED':'STALE / SNAPSHOT-BACKED'}</span><span class="chip">RESEARCH ${live?.observed_at||'UNAVAILABLE'}</span>`;
 const x=u.rows.find(v=>v.symbol===inspectedCrypto);
 const xScore=x&&live?.robinhood_symbol===x.symbol?live.si_core_v0a:null;
 el('cryptoInspect').innerHTML=x?`<div><strong>${x.symbol}</strong> · ${x.name}</div><div class="kv"><span>Captured tradability</span><b>${x.tradable?'TRADABLE':'HALTED / RESTRICTED'}</b><span>SI_CORE_V0A</span><b>${xScore==null?'NOT SCORED IN CURRENT D1 ROW':num(xScore,4)}</b><span>Research time</span><b>${xScore==null?'N/A':live.observed_at}</b><span>Robinhood provider state</span><b>${providerFresh&&scan?.quote?.symbol===x.symbol?'FRESH — CONNECTED':'STALE — SNAPSHOT-BACKED'}</b><span>Bid</span><b>${money(providerFresh&&scan?.quote?.symbol===x.symbol?scan.quote.bid:x.bid,8)}</b><span>Ask</span><b>${money(providerFresh&&scan?.quote?.symbol===x.symbol?scan.quote.ask:x.ask,8)}</b><span>Mark</span><b>${money(providerFresh&&scan?.quote?.symbol===x.symbol?(scan.quote.mark??((Number(scan.quote.bid)+Number(scan.quote.ask))/2)):x.mark,8)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(x.spread,8)} · ${pct(x.spreadPct)}</b><span>Provider time</span><b>${fmtTime(providerFresh&&scan?.quote?.symbol===x.symbol?scan.freshProviderTimestamp:x.providerTimestamp)}</b><span>LOCK state</span><b>${D.operationalCockpit?.lock?.symbol===x.symbol?'STALE SNAPSHOT — FRESH LOCK REQUIRED':'NOT LOCKED'}</b></div>`:''; 
 el('cryptoUniverseTable').innerHTML=`<table><thead><tr><th>Symbol</th><th>Captured state</th><th>SI state</th><th>Research time</th><th>Provider state</th><th>Bid</th><th>Ask</th><th>Mark</th><th>Spread</th><th>Provider time</th><th>LOCK</th><th>Inspect</th></tr></thead><tbody>${rows.map(x=>{const score=live?.robinhood_symbol===x.symbol?live.si_core_v0a:null;return `<tr><td>${x.symbol}</td><td>${x.tradable?'TRADABLE':'HALTED / RESTRICTED'}</td><td>${score==null?'NOT SCORED':num(score,4)}</td><td>${score==null?'N/A':fmtTime(live.observed_at)}</td><td>${providerFresh&&scan?.quote?.symbol===x.symbol?'FRESH / CONNECTED':'STALE / SNAPSHOT'}</td><td>${money(providerFresh&&scan?.quote?.symbol===x.symbol?scan.quote.bid:x.bid,8)}</td><td>${money(providerFresh&&scan?.quote?.symbol===x.symbol?scan.quote.ask:x.ask,8)}</td><td>${money(providerFresh&&scan?.quote?.symbol===x.symbol?(scan.quote.mark??((Number(scan.quote.bid)+Number(scan.quote.ask))/2)):x.mark,8)}</td><td>${pct(x.spreadPct)}</td><td>${fmtTime(providerFresh&&scan?.quote?.symbol===x.symbol?scan.freshProviderTimestamp:x.providerTimestamp)}</td><td>${D.operationalCockpit?.lock?.symbol===x.symbol?'FRESH LOCK REQUIRED':'—'}</td><td><button class="mini-btn" data-inspect="${x.symbol}">Inspect</button></td></tr>`}).join('')}</tbody></table>`;
 el('cryptoSearch').oninput=()=>renderCryptoUniverse();
 el('cryptoFilter').onchange=()=>renderCryptoUniverse();
 document.querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>{inspectedCrypto=b.dataset.inspect;renderCryptoUniverse(true)});
}

function marketCard(sym,m){const p=m.assetClass==='crypto'?m.mark:m.price;const freshness=m.freshness||'UNKNOWN — NO FRESH PROVIDER READ';return `<article class="card"><h3>${sym}</h3><div class="value">${money(p,p>1000?2:2)}</div><div class="sub">${m.assetClass==='crypto'?'Mark':'Most recent available price'}</div><div class="kv"><span>Bid</span><b>${money(m.bid)}</b><span>Ask</span><b>${money(m.ask)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(m.spread)}</b><span>Change <em class="calc">NFE</em></span><b>${pct(m.changePct)}</b></div><div class="state ${freshness.includes('RECENT')?'current':'stale'}">${freshness}</div><div class="sub">${fmtTime(m.providerTimestamp)}</div></article>`}
function renderMarkets(){el('markets').innerHTML=['SPY','QQQ','BTC','ETH'].filter(s=>D.markets[s]).map(s=>marketCard(s,D.markets[s])).join('')}

function renderResearchLanes(){
 const lanes=D.researchLanes||{}, e=lanes.equities||{}, o=lanes.options||{}, pr=D.predictionMarkets||{};
 el('cryptoLane').innerHTML=`<div class="chips"><span class="chip">PRIMARY EXECUTION-RESEARCH LANE</span><span class="chip">FLAT</span></div><p>Operational crypto state is shown above in RADAR → LOCK → MANAGE. Public Worker Robinhood freshness is currently blocked by the missing cloud provider connector.</p>`;
 const erows=(e.specimens||[]).map(x=>`<div class="evidence-row"><span>${x.symbol}</span><span>${money(x.price)}</span><span>${pct(x.changePct)}</span></div>`).join('');
 el('equityLane').innerHTML=`<div class="chips"><span class="chip">${e.state}</span><span class="chip">${e.session}</span><span class="chip">SNAPSHOT-BACKED</span></div><p class="sub">Discovery: ${e.discoverySource}. Provider-curated snapshot, not a fixed strategy list.</p><div class="evidence-row"><b>Symbol</b><b>Price</b><b>Move*</b></div>${erows}<button class="control-btn blocked" id="refreshEquityWatch">Refresh equity WATCH</button><div id="equityWatchStatus" class="control-reason"></div><p class="sub">* NFE calculated. Equity execution remains deferred.</p>`;
 el('optionsLane').innerHTML=`<div class="chips"><span class="chip">${o.state}</span><span class="chip">Execution: ${o.execution}</span><span class="chip">SNAPSHOT-BACKED</span></div><div class="kv"><span>Specimen contracts</span><b>${o.contractCount}</b><span>Research flow</span><b>${o.researchStates.join(' → ')}</b></div><button class="control-btn blocked" id="refreshOptionsWatch">Refresh options WATCH</button><div id="optionsWatchStatus" class="control-reason"></div><p class="sub">${o.note}</p>`;
 el('predictionLane').innerHTML=`<p><strong>${pr.status}</strong></p><p class="sub">${pr.note}</p>`;
 el('refreshEquityWatch').onclick=()=>requestRobinhoodCapability('refresh_equity_watch','equityWatchStatus');
 el('refreshOptionsWatch').onclick=()=>requestRobinhoodCapability('refresh_options_watch','optionsWatchStatus');
}

function renderDetail(){const h=D.historicalSamples[selected]||[];drawChart(h);const b=D.priceBooks[selected];el('book').innerHTML=`<div class="kv"><span>Updated</span><b>${fmtTime(b.updatedAt)}</b><span>Bid levels</span><b>${b.bids.length}</b><span>Ask levels</span><b>${b.asks.length}</b></div><p class="state stale">${b.status}</p>`;const t=D.technicals[selected];if(!t){el('technicals').innerHTML='<p>UNKNOWN — NO TECHNICAL SNAPSHOT FOR THIS SYMBOL</p>'}else{let rows=`<span>Interval</span><b>${t.interval}</b>`;for(const [k,v] of Object.entries(t)){if(['tool','interval','asOf'].includes(k))continue;rows+=`<span>${k}</span><b>${typeof v==='object'?Object.entries(v).map(([a,b])=>`${a} ${num(b,3)}`).join(' · '):num(v,3)}</b>`}el('technicals').innerHTML=`<div class="kv">${rows}</div><div class="sub">Provider calculation · as of ${fmtTime(t.asOf)}</div>`}el('intervals').innerHTML=D.historicalSupport.verifiedSpecimenIntervals.map(x=>`<span class="chip">✓ ${x}</span>`).join('')+`<span class="chip">15m: NOT NATIVE</span>`}
function drawChart(points){const c=el('chart'),ctx=c.getContext('2d');const w=c.width,h=c.height;ctx.clearRect(0,0,w,h);if(!points.length)return;const vals=points.map(p=>p.c),lo=Math.min(...vals),hi=Math.max(...vals),pad=28,span=hi-lo||1;ctx.strokeStyle='#223038';ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad+(h-pad*2)*i/3;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke()}ctx.strokeStyle='#66e3a4';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>{const x=pad+(w-pad*2)*(i/(points.length-1||1)),y=h-pad-(p.c-lo)/span*(h-pad*2);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle='#8da09a';ctx.font='20px system-ui';ctx.fillText(`${selected} · provider OHLCV sample`,pad,22)}

function renderOptions(){const rows=D.options.contracts.map(o=>`<tr><td>${o.underlying}</td><td>${o.type.toUpperCase()}</td><td>${o.strike}</td><td>${money(o.bid)}</td><td>${money(o.ask)}</td><td>${money(o.spread)}</td><td>${money(o.mark)}</td><td>${(o.iv*100).toFixed(2)}%</td><td>${o.delta.toFixed(3)}</td><td>${o.gamma.toFixed(3)}</td><td>${o.theta.toFixed(3)}</td><td>${o.vega.toFixed(3)}</td><td>${o.rho.toFixed(3)}</td><td>${o.openInterest.toLocaleString()}</td><td>${o.volume.toLocaleString()}</td><td>${fmtTime(o.updatedAt)}</td></tr>`).join('');el('options').innerHTML=`<table><thead><tr><th>Underlying</th><th>Type</th><th>Strike</th><th>Bid</th><th>Ask</th><th>Spread*</th><th>Mark</th><th>IV</th><th>Δ</th><th>Γ</th><th>Θ</th><th>Vega</th><th>Rho</th><th>OI</th><th>Volume</th><th>Provider time</th></tr></thead><tbody>${rows}</tbody></table><div class="sub" style="padding:9px">* Spread is NFE-calculated from provider bid/ask. Greeks, IV, OI and volume shown are provider fields. Snapshot only.</div>`}
function renderExisting(){const x=D.existingOptions;el('existingOptions').innerHTML=`<p><strong>${x.status}</strong></p><div class="chips">${x.accountsChecked.map(a=>`<span class="chip">${a} checked</span>`).join('')}</div><p class="sub">No exercise, close, roll, order, or cancel action exists in this site.</p>`}
function renderCrypto(){const syms=['BTC','ETH'].filter(s=>D.markets[s]);el('crypto').innerHTML=syms.map(s=>marketCard(s,D.markets[s])).join('')}

function renderEvidence(){el('evidence').innerHTML=`<div class="evidence-row"><b>Tool</b><b>Status</b><b>Mode</b></div>`+D.evidence.map(x=>`<div class="evidence-row"><span>${x.tool}</span><span class="ok">${x.status}</span><span>🔒 ${x.mode}</span></div>`).join('')+`<p class="sub">No OAuth tokens, cookies, session material, raw account numbers, or Robinhood write credentials are included in this deployment. Public shell mode: SNAPSHOT.</p>`}
