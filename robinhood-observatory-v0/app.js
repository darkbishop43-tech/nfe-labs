const money=(n,d=2)=>n==null?'N/A':Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d});
const num=(n,d=2)=>n==null?'N/A':Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=n=>n==null?'N/A — NO POSITION':`${Number(n)>=0?'+':''}${Number(n).toFixed(2)}%`;
const el=id=>document.getElementById(id);
const fmtTime=t=>t?new Date(t).toLocaleString():'N/A — NO PROVIDER TIMESTAMP';
let D, selected='SPY', inspectedCrypto=null, radarViewPaused=false;

Promise.all([
  fetch('./data/snapshot.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`snapshot ${r.status}`);return r.json()}),
  fetch('/api/v0a/ledger-status',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
])
.then(([d,ledger])=>{D=d;D.liveLedger=ledger;inspectedCrypto=D.operationalCockpit?.lock?.symbol||D.cryptoUniverse?.rows?.[0]?.symbol||null;render()})
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
 const liveMap=live?{M:live.m,T:live.t,V:live.v,Q:live.q,F:live.f,N:null}:{};
 const liveCore=live?.si_core_v0a??null;
 el('siFormula').innerHTML=`
   <div class="formula">${s.formula}</div>
   <div class="chips"><span class="chip">${s.hypothesis}</span><span class="chip">Qualification threshold: NOT SET</span><span class="chip">${live?'D1 LIVE RESEARCH FEED':'D1 FEED UNAVAILABLE'}</span></div>
   <div class="kv"><span>SI_CORE_V0A</span><b>${liveCore==null?'INCOMPLETE':num(liveCore,4)}</b><span>Full SI</span><b>INCOMPLETE — N RESEARCH_ONLY</b><span>Observation</span><b>${live?.observed_at||'N/A'}</b></div>
   <p class="sub">${s.scoreValidityRule}</p>
   <p class="sub">Research feed: Binance.US public → D1. LOCK / execution truth remains Robinhood MCP only.</p>`;

 el('siComponents').innerHTML=['M','T','V','Q','F','N'].map(k=>{const x=c[k],lv=liveMap[k],has=Number.isFinite(Number(lv))&&lv!==null;return `
   <article class="panel si-card">
     <div class="si-key">${k}</div><h3>${x.name}</h3>
     <div class="si-value">${k==='N'?'RESEARCH_ONLY':has?num(lv,4):'INCOMPLETE'}</div>
     <div class="state ${has?'current':'error'}">${k==='N'?'N SUBCOMPONENTS NOT VALID FOR FIRE':has?'VALIDATED D1 RESEARCH VALUE':'MISSING / NOT YET VALID'}</div>
     <div class="raw-box"><b>Source provenance</b><pre>${escapeHtml(JSON.stringify(k==='N'?{source:'NFE/UMEO research only',E:null,Fr:null,Tr:null,Tx:null,A:null,C:null}:{researchSource:'Binance.US public',ledger:'nfe-os-robinhood-si-v0a-ledger',robinhoodLockAuthority:'MCP only',observedAt:live?.observed_at||null},null,2))}</pre></div>
   </article>`}).join('');

 el('shadowLane').innerHTML=`
   <div class="hero-symbol">${s.shadow.state}</div>
   <div class="kv"><span>Authority</span><b>${s.shadow.authority}</b><span>Recorded evaluations</span><b>${s.shadow.records.length}</b><span>Would-fire</span><b>BLOCKED — NO VALID SI SCORE</b><span>Outcome horizons</span><b>${s.shadow.horizons.join(' · ')}</b><span>Excursion metrics</span><b>${s.shadow.excursionMetrics.join(' · ')}</b></div>
   <p class="sub">${s.shadow.automationGap}</p>`;

 el('liveLane').innerHTML=`
   <div class="hero-symbol">${s.live.state}</div>
   <div class="kv"><span>Authority</span><b>${s.live.authority}</b><span>Execution adapter</span><b>${s.live.executionCapability}</b><span>Positions</span><b>${s.live.providerReconciliation.positions}</b><span>Open orders</span><b>${s.live.providerReconciliation.openOrders}</b><span>Crypto buying power</span><b>${money(s.live.providerReconciliation.cryptoBuyingPower)}</b><span>Last provider requalification</span><b>${fmtTime(s.live.providerReconciliation.lastChecked)}</b></div>
   <p class="sub">FIRE requirements: ${s.live.fireRequirements.join(' → ')}</p>`;

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
 const v=D.siCryptoV0A;
 el('v0aState').innerHTML=`
   <div class="hero-symbol">${v.status}</div>
   <div class="formula">${v.coreFormula}</div>
   <div class="chips"><span class="chip">FULL: ${v.formula}</span><span class="chip error">${v.scores.coreState}</span><span class="chip error">${v.scores.fullSIState}</span></div>
   <p class="sub">Authorized V0-A parameters are visible/versioned research settings, not production trading truth.</p>
   <div class="chips"><span class="chip">BINANCE.US PUBLIC: ${v.binanceUsPublicData?.connected?'CONNECTED':'NOT CONNECTED'}</span><span class="chip">Credential: ${v.binanceUsPublicData?.credential||'NONE'}</span><span class="chip">${v.binanceUsPublicData?.mapping?.mapped??0}/${v.binanceUsPublicData?.mapping?.robinhoodPairs??0} mapped</span></div>
   <div class="kv"><span>M sample</span><b>${num(v.binanceUsPublicData?.sample?.M,4)}</b><span>T sample</span><b>${num(v.binanceUsPublicData?.sample?.T,4)}</b><span>V sample</span><b>${num(v.binanceUsPublicData?.sample?.V,4)}</b><span>F sample</span><b>${num(v.binanceUsPublicData?.sample?.F,4)}</b><span>Q</span><b>INCOMPLETE — SPREAD HISTORY REQUIRED</b><span>SI_CORE_V0A</span><b>INCOMPLETE</b></div>`;
 el('v0aComponents').innerHTML=['M','T','V','F','Q','N'].map(k=>{const x=v.components[k];return `<article class="panel si-card"><div class="si-key">${k}</div><h3>${k}</h3><div class="si-value">${x.state}</div><div class="value">${x.sampleValue==null?'—':num(x.sampleValue,4)}</div><div class="sub">${x.source?('Source: '+x.source+' · '):''}${x.reason||''}</div>${x.subcomponents?`<div class="raw-box"><pre>${escapeHtml(JSON.stringify(x.subcomponents,null,2))}</pre></div>`:''}</article>`}).join('');
 const a=v.robinhoodOfficialApi;
 el('v0aOfficial').innerHTML=`<div class="kv"><span>Historical OHLCV</span><b>${a.historicalOHLCV?'YES':'NO'}</b><span>Volume</span><b>${a.volume?'YES':'NO'}</b><span>Depth</span><b>${a.depth?'YES':'NO'}</b><span>Bid/ask size</span><b>${a.bidAskSize?'YES':'NO'}</b><span>Read-only action selection</span><b>${a.readOnlyActionsSelectable?'DOCUMENTED':'NOT PROVEN'}</b><span>Credential created</span><b>NO</b></div><p class="sub">Auth if later approved: ${a.auth}</p><div class="chips">${a.documentedEndpoints.map(x=>`<span class="chip">${x}</span>`).join('')}</div>`;
 const l=v.instrumentationLedger;
 el('v0aLedger').innerHTML=`<div class="kv"><span>Observations</span><b>${l.observationsRecorded}</b><span>Research symbol</span><b>${l.observation.researchSymbol||'N/A'}</b><span>SI_CORE_V0A</span><b>INCOMPLETE — Q</b><span>Forward outcomes</span><b>${l.forwardOutcomeEngine}</b><span>MFE / MAE</span><b>${l.MFE_MAE}</b></div><p class="sub">Missing: ${l.observation.missing.join(' · ')}</p>`;
 el('v0aCandidates').innerHTML=v.thirdPartyCandidates.map(x=>`<div class="evidence-row"><span>${x.name}</span><span class="stale">${x.status}</span><span>${x.capabilities}</span></div>`).join('')+`<p class="sub">No third-party source is connected or authorized. Founder selection is required before implementation.</p>`;
}

function renderAccount(){
 const a=D.account;
 const cards=[['Cash',money(a.cash)],['Buying power',money(a.buyingPower)],['Portfolio value',money(a.portfolioValue)],['Positions',`${a.positionCounts.equity+a.positionCounts.crypto+a.positionCounts.option} open`]];
 el('account').innerHTML=cards.map(([k,v],i)=>`<article class="card"><h3>${k}</h3><div class="value">${v}</div><div class="sub">${i===3?`Equity ${a.positionCounts.equity} · Crypto ${a.positionCounts.crypto} · Options ${a.positionCounts.option}`:`Agentic ${a.maskedId}`}</div></article>`).join('');
}

function renderOperational(){
 const o=D.operationalCockpit,r=o.radar,l=o.lock,p=o.position,m=o.manage;
 el('executionStrip').innerHTML=`
   <div><span>EXECUTION</span><strong class="stale">${o.execution.state}</strong><small>${o.execution.reason}</small></div>
   <div><span>RADAR</span><strong class="stale">${r.state}</strong><small>${r.eligibleCount} eligible of ${r.universeSize} provider pairs</small></div>
   <div><span>LOCK</span><strong class="stale">${l.state}</strong><small>${l.symbol} · ${l.freshness}</small></div>
   <div><span>POSITION</span><strong>${p.state}</strong><small>${p.orderState}</small></div>
   <div><span>MANAGE</span><strong>${m.state}</strong><small>${m.reason}</small></div>`;

 el('radarPanel').innerHTML=`
   <div class="hero-symbol">${r.leader}</div>
   <div class="state stale">NO SI-RANKED LEADER</div>
   <p>${r.leaderBasis}</p>
   <div class="kv"><span>Universe</span><b>${r.universeSize}</b><span>Eligible now</span><b>${r.eligibleCount}</b><span>Candidate pool</span><b>${r.candidateCount}</b><span>Last provider capture</span><b>${fmtTime(r.lastProviderUpdate)}</b></div>`;

 el('lockPanel').innerHTML=`
   <div class="hero-symbol">${l.symbol} · ${l.side}</div>
   <div class="kv"><span>Bid</span><b>${money(l.bid,8)}</b><span>Ask</span><b>${money(l.ask,8)}</b><span>Mark</span><b>${money(l.mark,8)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(l.spread,8)} · ${pct(l.spreadPct)}</b><span>Move vs provider reference <em class="calc">NFE</em></span><b>${pct(l.changePct)}</b><span>Provider capture</span><b>${fmtTime(l.providerTimestamp)}</b><span>Preview</span><b class="stale">${l.previewState}</b><span>Founder approval</span><b class="stale">${l.founderApproval}</b></div>
   <div class="preview-box"><b>Captured preview</b><span>${money(l.previewAmount)} ${l.previewType} · ${l.previewQuantity} · ${money(l.previewPrice,2)} preview unit price · ${money(l.previewFee)} estimated fee</span><small>Preview captured ${fmtTime(l.previewCapturedAt)}. Fresh LOCK quote is newer.</small></div>`;

 el('managePanel').innerHTML=`
   <div class="hero-symbol">${p.state}</div>
   <div class="state">${m.state}</div>
   <div class="kv"><span>Owned quantity</span><b>0 — NO POSITION</b><span>Entry</span><b>N/A — NO POSITION</b><span>Current bid</span><b>${money(p.currentBid,8)}</b><span>Current ask</span><b>${money(p.currentAsk,8)}</b><span>Current mark</span><b>${money(p.currentMark,8)}</b><span>Position value</span><b>${money(p.currentValue)}</b><span>Unrealized P&L</span><b>${money(p.unrealizedPnlUsd)} · N/A — NO POSITION</b><span>Realized P&L</span><b>N/A — NO COMPLETED LIFECYCLE</b><span>Position age</span><b>N/A — NO POSITION</b><span>Last reconciliation</span><b>${fmtTime(p.lastProviderReconciliation)}</b><span>Next governed action</span><b>${p.nextGovernedAction}</b><span>Exit authority</span><b>${p.exitAuthority}</b></div>`;

 el('lifecycle').innerHTML=o.lifecycle.map((x,i)=>`<span class="life-step ${i<o.currentLifecycleIndex?'done':i===o.currentLifecycleIndex?'active':''}">${x}</span>`).join('<span class="life-arrow">→</span>');

 el('controls').innerHTML=`
   <button class="control-btn" id="inspectLeader">Inspect BTC governed specimen</button>
   <button class="control-btn" id="pauseRadar">${radarViewPaused?'Resume':'Pause'} radar view</button>
   <button class="control-btn" id="viewPreview">View captured preview</button>
   <button class="control-btn disabled" disabled title="Execution is disarmed and the public shell has no approved order-submission bridge.">ARM</button>
   <button class="control-btn disabled" disabled title="Execution is already disarmed.">DISARM</button>
   <button class="control-btn disabled" disabled title="The public snapshot shell cannot request a new Robinhood provider scan without a separately approved live bridge.">Start provider scan</button>
   <button class="control-btn disabled" disabled title="No live provider scan is running in the public snapshot shell.">Pause provider scan</button>
   <button class="control-btn disabled" disabled title="A fresh order preview requires the governed Robinhood MCP path; it is not wired into the public shell.">Run fresh order preview</button>
   <button class="control-btn disabled" disabled title="Founder approval is not accepted through this static public shell.">Founder approve order</button>
   <button class="control-btn disabled" disabled title="No position exists, so there is nothing to manage or exit.">Exit review</button>`;
 el('inspectLeader').onclick=()=>{inspectedCrypto='BTC-USD';renderCryptoUniverse(true)};
 el('pauseRadar').onclick=()=>{radarViewPaused=!radarViewPaused;renderOperational()};
 el('viewPreview').onclick=()=>{el('lockPanel').scrollIntoView({behavior:'smooth',block:'center'});showControlReason('Captured preview is evidence only. It does not submit an order.')};
 document.querySelectorAll('.control-btn.disabled').forEach(b=>b.onclick=()=>showControlReason(b.title));
}

function showControlReason(msg){el('controlReason').textContent=msg||''}

function renderCryptoUniverse(keepPosition=false){
 const u=D.cryptoUniverse, q=(el('cryptoSearch')?.value||'').trim().toLowerCase(), f=el('cryptoFilter')?.value||'all';
 let rows=u.rows.filter(x=>(!q||x.symbol.toLowerCase().includes(q)||x.name.toLowerCase().includes(q))&&(f==='all'||(f==='tradable'&&x.tradable)||(f==='halted'&&!x.tradable)));
 rows.sort((a,b)=>(a.symbol>b.symbol?1:-1));
 el('cryptoUniverseSummary').innerHTML=`<span class="chip">${u.totalPairs} provider pairs</span><span class="chip">${u.eligiblePairs} tradable now</span><span class="chip">${radarViewPaused?'RADAR VIEW PAUSED':'RADAR VIEW ACTIVE'}</span><span class="chip">CAPTURE ${fmtTime(u.capturedAt)}</span>`;
 const x=u.rows.find(v=>v.symbol===inspectedCrypto);
 el('cryptoInspect').innerHTML=x?`<div><strong>${x.symbol}</strong> · ${x.name}</div><div class="kv"><span>State</span><b>${x.tradable?'TRADABLE':'HALTED / RESTRICTED'}</b><span>Bid</span><b>${money(x.bid,8)}</b><span>Ask</span><b>${money(x.ask,8)}</b><span>Mark</span><b>${money(x.mark,8)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(x.spread,8)} · ${pct(x.spreadPct)}</b><span>Change <em class="calc">NFE</em></span><b>${pct(x.changePct)}</b><span>Provider time</span><b>${fmtTime(x.providerTimestamp)}</b></div>`:''; 
 el('cryptoUniverseTable').innerHTML=`<table><thead><tr><th>Symbol</th><th>State</th><th>Bid</th><th>Ask</th><th>Mark</th><th>Spread</th><th>Rel spread</th><th>Change</th><th>SI Score</th><th>Provider time</th><th>Inspect</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.symbol}</td><td>${x.tradable?'TRADABLE':'HALTED / RESTRICTED'}</td><td>${money(x.bid,8)}</td><td>${money(x.ask,8)}</td><td>${money(x.mark,8)}</td><td>${money(x.spread,8)}</td><td>${pct(x.spreadPct)}</td><td>${pct(x.changePct)}</td><td>INCOMPLETE</td><td>${fmtTime(x.providerTimestamp)}</td><td><button class="mini-btn" data-inspect="${x.symbol}">Inspect</button></td></tr>`).join('')}</tbody></table>`;
 el('cryptoSearch').oninput=()=>renderCryptoUniverse();
 el('cryptoFilter').onchange=()=>renderCryptoUniverse();
 document.querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>{inspectedCrypto=b.dataset.inspect;renderCryptoUniverse(true)});
}

function marketCard(sym,m){const p=m.assetClass==='crypto'?m.mark:m.price;const freshness=m.freshness||'UNKNOWN — NO FRESH PROVIDER READ';return `<article class="card"><h3>${sym}</h3><div class="value">${money(p,p>1000?2:2)}</div><div class="sub">${m.assetClass==='crypto'?'Mark':'Most recent available price'}</div><div class="kv"><span>Bid</span><b>${money(m.bid)}</b><span>Ask</span><b>${money(m.ask)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(m.spread)}</b><span>Change <em class="calc">NFE</em></span><b>${pct(m.changePct)}</b></div><div class="state ${freshness.includes('RECENT')?'current':'stale'}">${freshness}</div><div class="sub">${fmtTime(m.providerTimestamp)}</div></article>`}
function renderMarkets(){el('markets').innerHTML=['SPY','QQQ','BTC','ETH'].filter(s=>D.markets[s]).map(s=>marketCard(s,D.markets[s])).join('')}

function renderResearchLanes(){
 const lanes=D.researchLanes||{}, e=lanes.equities||{}, o=lanes.options||{}, pr=D.predictionMarkets||{};
 el('cryptoLane').innerHTML=`<div class="chips"><span class="chip">PRIMARY EXECUTION-RESEARCH LANE</span><span class="chip">FLAT</span></div><p>Operational crypto state is shown above in RADAR → LOCK → MANAGE. The full dynamic provider universe is searchable below.</p>`;
 const erows=(e.specimens||[]).map(x=>`<div class="evidence-row"><span>${x.symbol}</span><span>${money(x.price)}</span><span>${pct(x.changePct)}</span></div>`).join('');
 el('equityLane').innerHTML=`<div class="chips"><span class="chip">${e.state}</span><span class="chip">${e.session}</span></div><p class="sub">Discovery: ${e.discoverySource}. Provider-curated snapshot, not a fixed strategy list.</p><div class="evidence-row"><b>Symbol</b><b>Price</b><b>Move*</b></div>${erows}<p class="sub">* NFE calculated. Equity execution remains deferred.</p>`;
 el('optionsLane').innerHTML=`<div class="chips"><span class="chip">${o.state}</span><span class="chip">Execution: ${o.execution}</span></div><div class="kv"><span>Specimen contracts</span><b>${o.contractCount}</b><span>Research flow</span><b>${o.researchStates.join(' → ')}</b></div><p class="sub">${o.note}</p>`;
 el('predictionLane').innerHTML=`<p><strong>${pr.status}</strong></p><p class="sub">${pr.note}</p>`;
}

function renderDetail(){const h=D.historicalSamples[selected]||[];drawChart(h);const b=D.priceBooks[selected];el('book').innerHTML=`<div class="kv"><span>Updated</span><b>${fmtTime(b.updatedAt)}</b><span>Bid levels</span><b>${b.bids.length}</b><span>Ask levels</span><b>${b.asks.length}</b></div><p class="state stale">${b.status}</p>`;const t=D.technicals[selected];if(!t){el('technicals').innerHTML='<p>UNKNOWN — NO TECHNICAL SNAPSHOT FOR THIS SYMBOL</p>'}else{let rows=`<span>Interval</span><b>${t.interval}</b>`;for(const [k,v] of Object.entries(t)){if(['tool','interval','asOf'].includes(k))continue;rows+=`<span>${k}</span><b>${typeof v==='object'?Object.entries(v).map(([a,b])=>`${a} ${num(b,3)}`).join(' · '):num(v,3)}</b>`}el('technicals').innerHTML=`<div class="kv">${rows}</div><div class="sub">Provider calculation · as of ${fmtTime(t.asOf)}</div>`}el('intervals').innerHTML=D.historicalSupport.verifiedSpecimenIntervals.map(x=>`<span class="chip">✓ ${x}</span>`).join('')+`<span class="chip">15m: NOT NATIVE</span>`}
function drawChart(points){const c=el('chart'),ctx=c.getContext('2d');const w=c.width,h=c.height;ctx.clearRect(0,0,w,h);if(!points.length)return;const vals=points.map(p=>p.c),lo=Math.min(...vals),hi=Math.max(...vals),pad=28,span=hi-lo||1;ctx.strokeStyle='#223038';ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad+(h-pad*2)*i/3;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke()}ctx.strokeStyle='#66e3a4';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>{const x=pad+(w-pad*2)*(i/(points.length-1||1)),y=h-pad-(p.c-lo)/span*(h-pad*2);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle='#8da09a';ctx.font='20px system-ui';ctx.fillText(`${selected} · provider OHLCV sample`,pad,22)}

function renderOptions(){const rows=D.options.contracts.map(o=>`<tr><td>${o.underlying}</td><td>${o.type.toUpperCase()}</td><td>${o.strike}</td><td>${money(o.bid)}</td><td>${money(o.ask)}</td><td>${money(o.spread)}</td><td>${money(o.mark)}</td><td>${(o.iv*100).toFixed(2)}%</td><td>${o.delta.toFixed(3)}</td><td>${o.gamma.toFixed(3)}</td><td>${o.theta.toFixed(3)}</td><td>${o.vega.toFixed(3)}</td><td>${o.rho.toFixed(3)}</td><td>${o.openInterest.toLocaleString()}</td><td>${o.volume.toLocaleString()}</td><td>${fmtTime(o.updatedAt)}</td></tr>`).join('');el('options').innerHTML=`<table><thead><tr><th>Underlying</th><th>Type</th><th>Strike</th><th>Bid</th><th>Ask</th><th>Spread*</th><th>Mark</th><th>IV</th><th>Δ</th><th>Γ</th><th>Θ</th><th>Vega</th><th>Rho</th><th>OI</th><th>Volume</th><th>Provider time</th></tr></thead><tbody>${rows}</tbody></table><div class="sub" style="padding:9px">* Spread is NFE-calculated from provider bid/ask. Greeks, IV, OI and volume shown are provider fields. Snapshot only.</div>`}
function renderExisting(){const x=D.existingOptions;el('existingOptions').innerHTML=`<p><strong>${x.status}</strong></p><div class="chips">${x.accountsChecked.map(a=>`<span class="chip">${a} checked</span>`).join('')}</div><p class="sub">No exercise, close, roll, order, or cancel action exists in this site.</p>`}
function renderCrypto(){const syms=['BTC','ETH'].filter(s=>D.markets[s]);el('crypto').innerHTML=syms.map(s=>marketCard(s,D.markets[s])).join('')}

function renderEvidence(){el('evidence').innerHTML=`<div class="evidence-row"><b>Tool</b><b>Status</b><b>Mode</b></div>`+D.evidence.map(x=>`<div class="evidence-row"><span>${x.tool}</span><span class="ok">${x.status}</span><span>🔒 ${x.mode}</span></div>`).join('')+`<p class="sub">No OAuth tokens, cookies, session material, raw account numbers, or Robinhood write credentials are included in this deployment. Public shell mode: SNAPSHOT.</p>`}
