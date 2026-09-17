// Sibling cloud-state reader V3 — authoritative display state, PAPER ONLY.
// Reads only the isolated sibling Worker. No browser-side paper execution.
(() => {
  const cfg = window.SIBLING_CONFIG || {};
  if (!['nfe_reasoning','payne_method'].includes(cfg.key)) return;
  const route = cfg.key === 'payne_method' ? 'payne' : 'nfe';
  const label = cfg.key === 'payne_method' ? 'PAYNE' : 'NFE';
  const api = `https://market-edge-siblings.darkbishop43.workers.dev/api/state/${route}`;
  const money = n => '$' + Number(n || 0).toFixed(2);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const cent = n => (Number(n || 0) * 100).toFixed(1) + '¢';
  const pct = n => (Number(n || 0) * 100).toFixed(3) + '%';
  const when = v => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); };
  const detail = (a,b) => `<div class="detail"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;
  let cloudState = null;

  function show(title, body) {
    const modal = document.getElementById('modal');
    const mt = document.getElementById('modalTitle');
    const mb = document.getElementById('modalBody');
    if (!modal || !mt || !mb) return;
    mt.textContent = title;
    mb.innerHTML = body;
    modal.classList.add('open');
  }

  function paint(state) {
    cloudState = state;
    // dashboard.js owns `local`; align it with persisted cloud truth so its normal
    // renders cannot restore stale browser-local balances.
    try { local = state; } catch (_) {}

    const bal = document.getElementById('bal');
    const pnl = document.getElementById('pnl');
    const closed = document.getElementById('closed');
    const openCount = document.getElementById('openCount');
    const pos = document.getElementById('pos');
    const trades = document.getElementById('trades');
    const cloud = document.getElementById('cloud');
    const run = document.getElementById('run');
    const dot = document.getElementById('dot');

    if (bal) bal.textContent = money(state.balance);
    if (pnl) {
      const p = Number(state.realizedPnl || 0);
      pnl.textContent = (p < 0 ? '-' : '') + money(Math.abs(p));
      pnl.className = 'val ' + (p < 0 ? 'bad' : p > 0 ? 'good' : '');
    }
    if (closed) closed.textContent = Number(state.trades || 0);
    if (openCount) openCount.textContent = (state.positions || []).length;

    if (pos) {
      const ps = state.positions || [];
      pos.innerHTML = ps.length ? ps.map((p,i) => `<div class="trade" data-cloud-pos="${i}" style="cursor:pointer"><div><div class="trade-title"><span class="sideBadge ${p.side === 'BELOW' ? 'below' : 'above'}">${esc(p.side || '—')}</span>${esc(p.question)}</div><div class="trade-meta">${esc(p.asset)} · stake ${money(p.stake)} · entry ${cent(p.entry)} · ${when(p.entryTs || p.ts)}</div></div><div class="pnl">OPEN</div></div>`).join('') : '<div class="empty">None</div>';
    }

    if (trades) {
      const xs = (state.ledger || []).filter(x => x.type === 'PAPER_EXIT').slice().reverse();
      trades.innerHTML = xs.length ? xs.map((x,i) => `<div class="trade" data-cloud-exit="${i}" style="cursor:pointer"><div><div class="trade-title"><span class="sideBadge ${x.side === 'BELOW' ? 'below' : 'above'}">${esc(x.side || '—')}</span>${esc(x.question)}</div><div class="trade-meta">${when(x.ts)} · ${esc(x.reason || 'exit')}</div></div><div class="pnl ${Number(x.pnl) >= 0 ? 'good' : 'bad'}">${Number(x.pnl) >= 0 ? '+' : ''}${money(x.pnl)}</div></div>`).join('') : '<div class="empty">No closed sibling cloud paper trades yet.</div>';
    }

    if (cloud) cloud.innerHTML = `<b class="good">${label} CLOUD EXECUTOR · LIVE PERSISTENT STATE · PAPER ONLY</b>`;
    if (run) run.textContent = `Cloud executor last run: ${when(state.lastRunAt)} · shared snapshot: ${when(state.sharedSnapshotAt)}`;
    if (dot) dot.className = 'dot';
  }

  document.addEventListener('click', ev => {
    const posNode = ev.target.closest?.('[data-cloud-pos]');
    if (posNode && cloudState) {
      const p = (cloudState.positions || [])[Number(posNode.dataset.cloudPos)];
      if (!p) return;
      show('Open Paper Position', `<div class="q">${esc(p.question || 'Open paper position')}</div><div class="detail-grid">${detail('Asset',p.asset || '—')}${detail('Direction',p.side || '—')}${detail('Outcome',p.positionOutcome || 'YES')}${detail('Stake',money(p.stake))}${detail('Entry',cent(p.entry))}${detail('Entry score',Number(p.score || 0).toFixed(3))}${detail('Entry edge',pct(p.edge || 0))}${detail('Decision at entry',p.decision || '—')}${detail('Entry time',when(p.entryTs || p.ts))}${detail('Status','OPEN')}${detail('Market ID',p.marketId || '—')}</div><div class="note">Authoritative sibling cloud paper position. Inspection only; no browser-side execution.</div>`);
      return;
    }

    const exitNode = ev.target.closest?.('[data-cloud-exit]');
    if (exitNode && cloudState) {
      const xs = (cloudState.ledger || []).filter(x => x.type === 'PAPER_EXIT').slice().reverse();
      const x = xs[Number(exitNode.dataset.cloudExit)];
      if (!x) return;
      show('Closed Paper Trade', `<div class="q">${esc(x.question || 'Closed paper trade')}</div><div class="detail-grid">${detail('Asset',x.asset || '—')}${detail('Direction',x.side || '—')}${detail('Outcome',x.positionOutcome || 'YES')}${detail('Stake',money(x.stake))}${detail('Entry',cent(x.entry))}${detail('Exit',cent(x.exit))}${detail('Entry time',when(x.entryTs))}${detail('Exit time',when(x.ts))}${detail('Exit reason',x.reason || '—')}${detail('Realized P/L',(Number(x.pnl) >= 0 ? '+' : '') + money(x.pnl))}${detail('Market ID',x.marketId || '—')}</div>`);
      return;
    }

    const oppNode = ev.target.closest?.('.opp');
    const oppRoot = document.getElementById('opps');
    if (oppNode && oppRoot?.contains(oppNode)) {
      const idx = Number(oppNode.dataset.opp);
      let os = [];
      try { if (typeof opportunities === 'function') os = opportunities(); } catch (_) {}
      const o = os[idx];
      if (!o) return;
      let a = {label:'WATCH',confidence:Math.round(Number(o.score || 0) * 100),html:''};
      try { if (cfg.analyze) a = cfg.analyze(o, os, idx); } catch (_) {}
      let sd = o.side || '—', as = o.asset || '—', pr = Number(o.positionPrice ?? o.yesPrice ?? o.yes ?? o.price ?? 0), qq = o.question || o.title || o.marketQuestion || 'Unknown market';
      try { if (typeof side === 'function') sd = side(o); } catch (_) {}
      try { if (typeof asset === 'function') as = asset(o); } catch (_) {}
      try { if (typeof price === 'function') pr = price(o); } catch (_) {}
      try { if (typeof question === 'function') qq = question(o); } catch (_) {}
      show('Potential Trade Inspection', `<div class="q">${esc(qq)}</div><div class="detail-grid">${detail('Asset',as)}${detail('Direction',sd)}${detail('Outcome',o.positionOutcome || 'YES')}${detail('Current price',cent(pr))}${detail('Score',Number(o.score ?? 0).toFixed(3))}${detail('Edge',pct(o.edge ?? 0))}${detail('Move',pct(o.move ?? o.assetMove ?? o.btcMove ?? o.ethMove ?? 0))}${detail(cfg.decisionLabel || 'Decision',a.label || '—')}${detail('Confidence',a.confidence != null ? a.confidence + '%' : '—')}${detail('Source',o.source || 'shared market feed')}${detail('Market ID',o.id ?? o.marketId ?? o.conditionId ?? '—')}</div>${a.html || ''}<div class="note">Potential-trade inspection only. Clicking this card does not create a paper position.</div>`);
    }
  });

  async function syncCloudState() {
    try {
      const r = await fetch(api, { cache: 'no-store' });
      if (!r.ok) throw new Error(`cloud state ${r.status}`);
      const state = await r.json();
      if (!state || state.mode !== 'PAPER_ONLY' || state.lab !== cfg.key) throw new Error('invalid sibling cloud state');
      paint(state);
    } catch (err) {
      const cloud = document.getElementById('cloud');
      const dot = document.getElementById('dot');
      if (cloud) cloud.innerHTML = `<b class="bad">${label} CLOUD STATE ERROR</b>`;
      if (dot) dot.className = 'dot badDot';
      console.error('Sibling cloud-state V3 sync failed:', err);
    }
  }

  syncCloudState();
  setInterval(syncCloudState, 5000);
})();
