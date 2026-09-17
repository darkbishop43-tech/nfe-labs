// Sibling cloud-state reader — display only. No browser-side paper execution.
(() => {
  const cfg = window.SIBLING_CONFIG || {};
  const route = cfg.key === 'payne_method' ? 'payne' : 'nfe';
  const api = `https://market-edge-siblings.darkbishop43.workers.dev/api/state/${route}`;

  async function syncCloudState() {
    try {
      const r = await fetch(api, { cache: 'no-store' });
      if (!r.ok) throw new Error(`cloud state ${r.status}`);
      const state = await r.json();
      if (!state || state.mode !== 'PAPER_ONLY') throw new Error('invalid cloud paper state');

      // dashboard.js owns these bindings/functions. This reader only replaces the
      // displayed sibling state with the authoritative persisted cloud ledger.
      local = state;
      render();

      const cloud = document.getElementById('cloud');
      if (cloud) {
        const label = cfg.key === 'payne_method' ? 'PAYNE' : 'NFE';
        cloud.innerHTML = `<b class="good">${label} CLOUD EXECUTOR · LIVE PERSISTENT STATE · PAPER ONLY</b>`;
      }
      const run = document.getElementById('run');
      if (run) run.textContent = `Cloud executor last run: ${state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'waiting for first scheduled run'}`;
    } catch (err) {
      const cloud = document.getElementById('cloud');
      if (cloud) cloud.innerHTML = `<b class="bad">SIBLING CLOUD STATE ERROR</b>`;
      console.error('Sibling cloud-state sync failed:', err);
    }
  }

  syncCloudState();
  setInterval(syncCloudState, 15000);
})();
