const money=(n,d=2)=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d});
const num=(n,d=2)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=n=>`${Number(n)>=0?'+':''}${Number(n).toFixed(2)}%`;
const el=(id)=>document.getElementById(id);
let D, selected='SPY';
fetch('./data/snapshot.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`snapshot ${r.status}`);return r.json()}).then(d=>{D=d;render()}).catch(e=>{document.body.innerHTML=`<main><div class="panel"><h2 class="error">🔴 SNAPSHOT LOAD ERROR</h2><p>No values were fabricated.</p><code>${String(e.message)}</code></div></main>`});
function render(){el('capturedAt').textContent=new Date(D.meta.capturedAt).toLocaleString();renderAccount();renderMarkets();renderResearchLanes();renderDetail();renderOptions();renderExisting();renderCrypto();renderEvidence();document.querySelectorAll('[data-symbol]').forEach(b=>b.onclick=()=>{selected=b.dataset.symbol;document.querySelectorAll('[data-symbol]').forEach(x=>x.classList.toggle('active',x===b));renderDetail()})}
function renderAccount(){const a=D.account;const cards=[['Cash',money(a.cash)],['Buying power',money(a.buyingPower)],['Portfolio value',money(a.portfolioValue)],['Positions',`${a.positionCounts.equity+a.positionCounts.crypto+a.positionCounts.option} open`]];el('account').innerHTML=cards.map(([k,v],i)=>`<article class="card"><h3>${k}</h3><div class="value">${v}</div><div class="sub">${i===3?`Equity ${a.positionCounts.equity} · Crypto ${a.positionCounts.crypto} · Options ${a.positionCounts.option}`:`Agentic ${a.maskedId}`}</div></article>`).join('')}
function marketCard(sym,m){const p=m.assetClass==='crypto'?m.mark:m.price;const ts=m.providerTimestamp;const freshness=m.freshness||'UNKNOWN';return `<article class="card"><h3>${sym}</h3><div class="value">${money(p,p>1000?2:2)}</div><div class="sub">${m.assetClass==='crypto'?'Mark':'Most recent available price'}</div><div class="kv"><span>Bid</span><b>${money(m.bid)}</b><span>Ask</span><b>${money(m.ask)}</b><span>Spread <em class="calc">NFE</em></span><b>${money(m.spread)}</b><span>Change <em class="calc">NFE</em></span><b>${pct(m.changePct)}</b></div><div class="state ${freshness.includes('CURRENT')?'current':'stale'}">${freshness}</div><div class="sub">${new Date(ts).toLocaleString()}</div></article>`}
function renderMarkets(){el('markets').innerHTML=['SPY','QQQ','BTC','ETH'].map(s=>marketCard(s,D.markets[s])).join('')}
function renderDetail(){const h=D.historicalSamples[selected]||[];drawChart(h);const b=D.priceBooks[selected];el('book').innerHTML=`<div class="kv"><span>Updated</span><b>${new Date(b.updatedAt).toLocaleTimeString()}</b><span>Bid levels</span><b>${b.bids.length}</b><span>Ask levels</span><b>${b.asks.length}</b></div><p class="state stale">${b.status}</p>`;const t=D.technicals[selected];if(!t){el('technicals').innerHTML='<p>UNKNOWN / NOT EXPOSED IN THIS SNAPSHOT</p>'}else{let rows=`<span>Interval</span><b>${t.interval}</b>`;for(const [k,v] of Object.entries(t)){if(['tool','interval','asOf'].includes(k))continue;rows+=`<span>${k}</span><b>${typeof v==='object'?Object.entries(v).map(([a,b])=>`${a} ${num(b,3)}`).join(' · '):num(v,3)}</b>`}el('technicals').innerHTML=`<div class="kv">${rows}</div><div class="sub">Provider calculation · as of ${new Date(t.asOf).toLocaleString()}</div>`}el('intervals').innerHTML=D.historicalSupport.verifiedSpecimenIntervals.map(x=>`<span class="chip">✓ ${x}</span>`).join('')+`<span class="chip">15m: NOT NATIVE</span>`}
function drawChart(points){const c=el('chart'),ctx=c.getContext('2d');const w=c.width,h=c.height;ctx.clearRect(0,0,w,h);if(!points.length)return;const vals=points.map(p=>p.c),lo=Math.min(...vals),hi=Math.max(...vals),pad=28,span=hi-lo||1;ctx.strokeStyle='#223038';ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad+(h-pad*2)*i/3;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke()}ctx.strokeStyle='#66e3a4';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>{const x=pad+(w-pad*2)*(i/(points.length-1||1)),y=h-pad-(p.c-lo)/span*(h-pad*2);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle='#8da09a';ctx.font='20px system-ui';ctx.fillText(`${selected} · provider OHLCV sample`,pad,22)}
function renderOptions(){const rows=D.options.contracts.map(o=>`<tr><td>${o.underlying}</td><td>${o.type.toUpperCase()}</td><td>${o.strike}</td><td>${money(o.bid)}</td><td>${money(o.ask)}</td><td>${money(o.spread)}</td><td>${money(o.mark)}</td><td>${(o.iv*100).toFixed(2)}%</td><td>${o.delta.toFixed(3)}</td><td>${o.gamma.toFixed(3)}</td><td>${o.theta.toFixed(3)}</td><td>${o.vega.toFixed(3)}</td><td>${o.rho.toFixed(3)}</td><td>${o.openInterest.toLocaleString()}</td><td>${o.volume.toLocaleString()}</td><td>${new Date(o.updatedAt).toLocaleString()}</td></tr>`).join('');el('options').innerHTML=`<table><thead><tr><th>Underlying</th><th>Type</th><th>Strike</th><th>Bid</th><th>Ask</th><th>Spread*</th><th>Mark</th><th>IV</th><th>Δ</th><th>Γ</th><th>Θ</th><th>Vega</th><th>Rho</th><th>OI</th><th>Volume</th><th>Provider time</th></tr></thead><tbody>${rows}</tbody></table><div class="sub" style="padding:9px">* Spread is NFE-calculated from provider bid/ask. All Greeks, IV, OI and volume shown are Robinhood provider fields. Snapshot only.</div>`}
function renderExisting(){const x=D.existingOptions;el('existingOptions').innerHTML=`<p><strong>${x.status}</strong></p><div class="chips">${x.accountsChecked.map(a=>`<span class="chip">${a} checked</span>`).join('')}</div><p class="sub">No exercise, close, roll, preview, order, or cancel action exists in this site.</p>`}
function renderCrypto(){el('crypto').innerHTML=['BTC','ETH'].map(s=>marketCard(s,D.markets[s])).join('')}
function renderEvidence(){el('evidence').innerHTML=`<div class="evidence-row"><b>Tool</b><b>Status</b><b>Mode</b></div>`+D.evidence.map(x=>`<div class="evidence-row"><span>${x.tool}</span><span class="ok">${x.status}</span><span>🔒 ${x.mode}</span></div>`).join('')+`<p class="sub">No OAuth tokens, cookies, session material, raw account numbers, or Robinhood write credentials are included in this deployment.</p>`}

function renderResearchLanes(){
  const lanes=D.researchLanes||{};
  const c=lanes.crypto||{};
  const cq=c.candidate||{};
  const p=c.preview||{};
  el('cryptoLane').innerHTML=`
    <div class="chips"><span class="chip">${c.state||'UNKNOWN'}</span><span class="chip">Position: ${c.positionState||'UNKNOWN'}</span><span class="chip">${c.lifecycle||'UNKNOWN'}</span></div>
    <div class="kv">
      <span>Discovered pairs</span><b>${c.catalogCount??'UNKNOWN'}</b>
      <span>Currently eligible</span><b>${c.eligibleCount??'UNKNOWN'}</b>
      <span>Candidate</span><b>${cq.symbol||'UNKNOWN'}</b>
      <span>Bid</span><b>${cq.bid!=null?money(cq.bid):'UNKNOWN'}</b>
      <span>Ask</span><b>${cq.ask!=null?money(cq.ask):'UNKNOWN'}</b>
      <span>Mark</span><b>${cq.mark!=null?money(cq.mark):'UNKNOWN'}</b>
      <span>Spread <em class="calc">NFE</em></span><b>${cq.spread!=null?money(cq.spread):'UNKNOWN'}</b>
      <span>Move vs local-day reference <em class="calc">NFE</em></span><b>${cq.changePct!=null?pct(cq.changePct):'UNKNOWN'}</b>
    </div>
    <p class="sub">${c.selectionReason||''}</p>
    <p><strong>PREVIEW ONLY — NO ORDER PLACED</strong></p>
    <div class="kv">
      <span>Proposed amount</span><b>${p.dollarAmount!=null?money(p.dollarAmount):'UNKNOWN'}</b>
      <span>Order type</span><b>${p.orderType||'UNKNOWN'}</b>
      <span>Estimated BTC amount</span><b>${p.quantity||'UNKNOWN'}</b>
      <span>Preview unit price</span><b>${p.price!=null?money(p.price,2):'UNKNOWN'}</b>
      <span>Estimated fee</span><b>${p.estimatedFee!=null?money(p.estimatedFee):'UNKNOWN'}</b>
      <span>Estimated total</span><b>${p.estimatedTotal!=null?money(p.estimatedTotal):'UNKNOWN'}</b>
      <span>Routing</span><b>${p.routing||'UNKNOWN'}</b>
    </div>
    <p class="sub">${c.management||''}</p>`;

  const e=lanes.equities||{};
  const rows=(e.specimens||[]).map(x=>`<div class="evidence-row"><span>${x.symbol}</span><span>${x.price!=null?money(x.price):'UNKNOWN'}</span><span>${x.changePct!=null?pct(x.changePct):'UNKNOWN'}</span></div>`).join('');
  el('equityLane').innerHTML=`
    <div class="chips"><span class="chip">${e.state||'UNKNOWN'}</span><span class="chip">${e.session||'UNKNOWN'}</span></div>
    <p class="sub">Discovery source: ${e.discoverySource||'UNKNOWN'}. This is a provider-curated capture, not a fixed strategy watchlist.</p>
    <div class="evidence-row"><b>Symbol</b><b>Price</b><b>Move*</b></div>${rows}
    <p class="sub">* NFE-calculated from provider price vs adjusted previous close. No equity order is authorized.</p>`;

  const o=lanes.options||{};
  el('optionsLane').innerHTML=`
    <div class="chips"><span class="chip">${o.state||'UNKNOWN'}</span><span class="chip">Execution: ${o.execution||'DISABLED'}</span></div>
    <div class="kv">
      <span>Current specimen contracts</span><b>${o.contractCount??'UNKNOWN'}</b>
      <span>Research states</span><b>${(o.researchStates||[]).join(' → ')||'UNKNOWN'}</b>
      <span>Fields</span><b>${(o.fields||[]).join(', ')||'UNKNOWN'}</b>
    </div>
    <p class="sub">${o.note||''}</p>`;

  const pr=D.predictionMarkets||{};
  el('predictionLane').innerHTML=`
    <p><strong>${pr.status||'UNKNOWN'}</strong></p>
    <p class="sub">${pr.note||''}</p>`;
}
