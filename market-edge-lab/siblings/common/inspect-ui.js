// Sibling dashboard inspection UI — display only. No execution.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const cent = (n) => (Number(n || 0) * 100).toFixed(1) + '¢';
  const pct = (n) => (Number(n || 0) * 100).toFixed(3) + '%';
  const t = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString(); };
  const detail = (a,b) => `<div class="detail"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;

  function show(title, body) {
    const modal = $('modal'), mt = $('modalTitle'), mb = $('modalBody');
    if (!modal || !mt || !mb) return;
    mt.textContent = title;
    mb.innerHTML = body;
    modal.classList.add('open');
  }

  document.addEventListener('click', (ev) => {
    const opp = ev.target.closest?.('.opp');
    if (opp && $('opps')?.contains(opp)) {
      const idx = Number(opp.dataset.opp);
      const os = typeof opportunities === 'function' ? opportunities() : [];
      const o = os[idx];
      if (!o) return;
      const analysis = window.SIBLING_CONFIG?.analyze ? window.SIBLING_CONFIG.analyze(o, os, idx) : {label:'WATCH', confidence:Math.round(Number(o.score || 0) * 100)};
      const sd = typeof side === 'function' ? side(o) : (o.side || '—');
      const as = typeof asset === 'function' ? asset(o) : (o.asset || '—');
      const pr = typeof price === 'function' ? price(o) : Number(o.positionPrice ?? o.yesPrice ?? o.price ?? 0);
      const q = typeof question === 'function' ? question(o) : (o.question || o.title || 'Unknown market');
      const body = `<div class="q">${esc(q)}</div><div class="detail-grid">${detail('Asset',as)}${detail('Direction',sd)}${detail('Outcome',o.positionOutcome || 'YES')}${detail('Current price',cent(pr))}${detail('Score',Number(o.score ?? 0).toFixed(3))}${detail('Edge',pct(o.edge ?? 0))}${detail('Move',pct(o.move ?? o.assetMove ?? o.btcMove ?? o.ethMove ?? 0))}${detail(window.SIBLING_CONFIG?.decisionLabel || 'Decision',analysis.label || '—')}${detail('Confidence',analysis.confidence != null ? analysis.confidence + '%' : '—')}${detail('Source',o.source || 'shared market feed')}${detail('Market ID',o.id ?? o.marketId ?? o.conditionId ?? '—')}</div>${analysis.html || ''}<div class="note">Inspection only. This screen does not place or modify paper positions.</div>`;
      show('Potential Trade Inspection', body);
      return;
    }

    const trade = ev.target.closest?.('#pos .trade');
    if (trade) {
      const rows = [...document.querySelectorAll('#pos .trade')];
      const idx = rows.indexOf(trade);
      const ps = (typeof local !== 'undefined' && Array.isArray(local?.positions)) ? local.positions : [];
      const p = ps[idx];
      if (!p) return;
      const body = `<div class="q">${esc(p.question || 'Open paper position')}</div><div class="detail-grid">${detail('Asset',p.asset || '—')}${detail('Direction',p.side || '—')}${detail('Outcome',p.positionOutcome || 'YES')}${detail('Stake',money(p.stake))}${detail('Entry',cent(p.entry))}${detail('Entry score',Number(p.score || 0).toFixed(3))}${detail('Entry edge',pct(p.edge || 0))}${detail('Decision at entry',p.decision || '—')}${detail('Entry time',t(p.entryTs || p.ts))}${detail('Status','OPEN')}${detail('Market ID',p.marketId || '—')}</div><div class="note">Authoritative sibling cloud paper position. Display only; no browser-side execution.</div>`;
      show('Open Paper Position', body);
    }
  });
})();
