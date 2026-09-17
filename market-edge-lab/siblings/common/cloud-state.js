// Sibling cloud-state reader V2 — authoritative display state, PAPER ONLY.
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
  const when = v => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

  function paint(state) {
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
      pos.innerHTML = ps.length ? ps.map(p => `<div class="trade"><div><div class="trade-title"><span class="sideBadge ${p.side === 'BELOW' ? 'below' : 'above'}">${esc(p.side || '—')}</span>${esc(p.question)}</div><div class="trade-meta">${esc(p.asset)} · entry ${cent(p.entry)} · ${when(p.entryTs || p.ts)}</div></div><div class="pnl">OPEN</div></div>`).join('') : '<div class="empty">None</div>';
    }

    if (trades) {
      const xs = (state.ledger || []).filter(x => x.type === 'PAPER_EXIT').slice().reverse();
      trades.innerHTML = xs.length ? xs.map(x => `<div class="trade"><div><div class="trade-title"><span class="sideBadge ${x.side === 'BELOW' ? 'below' : 'above'}">${esc(x.side || '—')}</span>${esc(x.question)}</div><div class="trade-meta">${when(x.ts)} · ${esc(x.reason || 'exit')}</div></div><div class="pnl ${Number(x.pnl) >= 0 ? 'good' : 'bad'}">${Number(x.pnl) >= 0 ? '+' : ''}${money(x.pnl)}</div></div>`).join('') : '<div class="empty">No closed sibling cloud paper trades yet.</div>';
    }

    if (cloud) cloud.innerHTML = `<b class="good">${label} CLOUD EXECUTOR · LIVE PERSISTENT STATE · PAPER ONLY</b>`;
    if (run) run.textContent = `Cloud executor last run: ${when(state.lastRunAt)} · shared snapshot: ${when(state.sharedSnapshotAt)}`;
    if (dot) dot.className = 'dot';
  }

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
      console.error('Sibling cloud-state V2 sync failed:', err);
    }
  }

  syncCloudState();
  setInterval(syncCloudState, 5000);
})();
