// NFE Market Edge Lab — free 24/7 paper collector
// PAPER ONLY: no wallet, keys, signing, or live order submission.

const CONFIG = {
  startingBalance: 100,
  entryScore: 0.80,
  exitScore: 0.20,
  maxStake: 5,
  maxHoldMs: 5 * 60 * 1000,
  maxLedger: 1000,
};

const STATE_KEY = 'market-edge-state-v1';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCollector(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state') {
      const state = await loadState(env);
      return json(state, 200, { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/run') {
      // Manual paper-only refresh for setup/verification. No secret data and no trading action.
      const state = await runCollector(env);
      return json(state, 200, { 'Cache-Control': 'no-store' });
    }

    return new Response(DASHBOARD_HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  },
};

async function runCollector(env) {
  let state = await loadState(env);
  const runStartedAt = Date.now();

  try {
    const [btc, eth] = await Promise.all([
      coinbaseSpot('BTC-USD'),
      coinbaseSpot('ETH-USD'),
    ]);

    const previousPrices = state.prices || {};
    const moves = {
      BTC: previousPrices.BTC ? (btc - previousPrices.BTC) / previousPrices.BTC : 0,
      ETH: previousPrices.ETH ? (eth - previousPrices.ETH) / previousPrices.ETH : 0,
    };

    const discovery = await discoverMarkets();
    const opportunities = discovery.markets
      .map((m) => scoreMarket(m, moves))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // Exit first so released paper balance can be reused on the same run.
    for (const position of [...state.positions]) {
      const current = opportunities.find((o) => o.id === position.marketId);
      if (!current) continue;

      const age = runStartedAt - position.openedAt;
      if (current.score <= CONFIG.exitScore || age >= CONFIG.maxHoldMs) {
        const value = position.shares * current.yes;
        const pnl = value - position.stake;
        state.balance += value;
        state.realizedPnl += pnl;
        state.trades += 1;
        state.positions = state.positions.filter((p) => p.marketId !== position.marketId);
        addLedger(state, 'PAPER_EXIT', {
          marketId: position.marketId,
          question: position.question,
          entry: position.entry,
          exit: current.yes,
          stake: position.stake,
          pnl,
          heldMs: age,
          reason: current.score <= CONFIG.exitScore ? 'score_exit' : 'max_hold',
        });
      }
    }

    for (const o of opportunities.slice(0, 20)) {
      if (state.positions.some((p) => p.marketId === o.id)) continue;
      if (o.score < CONFIG.entryScore || o.edge <= 0 || state.balance < 1) continue;

      const stake = Math.min(CONFIG.maxStake, state.balance);
      const shares = stake / o.yes;
      state.balance -= stake;
      state.positions.push({
        marketId: o.id,
        question: o.question,
        asset: o.asset,
        entry: o.yes,
        shares,
        stake,
        openedAt: runStartedAt,
        entryScore: o.score,
      });

      addLedger(state, 'PAPER_ENTRY', {
        marketId: o.id,
        question: o.question,
        asset: o.asset,
        entry: o.yes,
        stake,
        score: o.score,
        edge: o.edge,
      });
    }

    state.prices = { BTC: btc, ETH: eth };
    state.moves = moves;
    state.eligibleCount = discovery.markets.length;
    state.rejectedCount = discovery.rejected;
    state.seenCount = discovery.seen;
    state.opportunities = opportunities.slice(0, 20);
    state.lastRunAt = new Date(runStartedAt).toISOString();
    state.status = 'LIVE_PAPER_ONLY';
    state.collector = 'cloudflare-worker-kv';

    addLedger(state, 'CLOUD_REFRESH', {
      eligible: discovery.markets.length,
      rejected: discovery.rejected,
      seen: discovery.seen,
      btc,
      eth,
      btcMove: moves.BTC,
      ethMove: moves.ETH,
    });
  } catch (error) {
    state.lastRunAt = new Date(runStartedAt).toISOString();
    state.status = 'ERROR';
    addLedger(state, 'ERROR', {
      source: 'cloud_collector',
      message: String(error?.message || error),
    });
  }

  state.updatedAt = new Date().toISOString();
  await env.MARKET_EDGE_STATE.put(STATE_KEY, JSON.stringify(state));
  return state;
}

async function loadState(env) {
  const raw = await env.MARKET_EDGE_STATE.get(STATE_KEY);
  if (raw) {
    try { return normalizeState(JSON.parse(raw)); } catch {}
  }
  return normalizeState({});
}

function normalizeState(s) {
  return {
    mode: 'PAPER_ONLY',
    balance: Number.isFinite(s.balance) ? s.balance : CONFIG.startingBalance,
    realizedPnl: Number.isFinite(s.realizedPnl) ? s.realizedPnl : 0,
    trades: Number.isFinite(s.trades) ? s.trades : 0,
    positions: Array.isArray(s.positions) ? s.positions : [],
    prices: s.prices || { BTC: null, ETH: null },
    moves: s.moves || { BTC: 0, ETH: 0 },
    eligibleCount: s.eligibleCount || 0,
    rejectedCount: s.rejectedCount || 0,
    seenCount: s.seenCount || 0,
    opportunities: Array.isArray(s.opportunities) ? s.opportunities : [],
    ledger: Array.isArray(s.ledger) ? s.ledger : [],
    lastRunAt: s.lastRunAt || null,
    updatedAt: s.updatedAt || null,
    status: s.status || 'INITIALIZING',
    collector: s.collector || 'cloudflare-worker-kv',
  };
}

function addLedger(state, type, payload = {}) {
  state.ledger.unshift({
    ts: new Date().toISOString(),
    type,
    ...payload,
  });
  state.ledger = state.ledger.slice(0, CONFIG.maxLedger);
}

async function coinbaseSpot(product) {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, {
    headers: { 'User-Agent': 'NFE-Market-Edge-Lab/0.4' },
  });
  if (!r.ok) throw new Error(`Coinbase ${product}: ${r.status}`);
  const data = await r.json();
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid Coinbase ${product} price`);
  return price;
}

async function discoverMarkets() {
  const groups = await Promise.all(['bitcoin', 'BTC', 'ethereum', 'ETH'].map(discoverQuery));
  const map = new Map();
  let seen = 0;
  let rejected = 0;

  for (const ev of groups.flat()) {
    for (const m of (ev.markets || [])) {
      seen += 1;
      const question = [ev.title, m.question, m.slug].filter(Boolean).join(' — ');
      const prices = parsePrices(m);
      const rel = relevant(question);
      if (!prices || !rel || !eligible(m, ev, prices)) {
        rejected += 1;
        continue;
      }

      const id = String(m.id || m.conditionId || m.slug);
      map.set(id, {
        id,
        question,
        asset: rel.asset,
        bear: rel.bear,
        yes: prices.yes,
        no: prices.no,
        volume: Number(m.volumeNum || m.volume || 0),
        liquidity: Number(m.liquidityNum || m.liquidity || 0),
        endDate: m.endDate || ev.endDate || null,
      });
    }
  }

  return { markets: [...map.values()], seen, rejected };
}

async function discoverQuery(q) {
  const search = await fetchJson(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}`);
  const events = (search.events || []).slice(0, 18);
  const details = await Promise.all(events.map(async (e) => {
    try { return await fetchJson(`https://gamma-api.polymarket.com/events/${e.id}`); }
    catch { return null; }
  }));
  return details.filter(Boolean);
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'NFE-Market-Edge-Lab/0.4' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function parsePrices(m) {
  try {
    const p = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
    if (!Array.isArray(p) || p.length < 2) return null;
    const yes = Number(p[0]);
    const no = Number(p[1]);
    if (!Number.isFinite(yes) || !Number.isFinite(no)) return null;
    return { yes, no };
  } catch {
    return null;
  }
}

function relevant(q) {
  q = String(q || '').toLowerCase();
  const asset = q.includes('bitcoin') || /\bbtc\b/.test(q)
    ? 'BTC'
    : q.includes('ethereum') || /\beth\b/.test(q)
      ? 'ETH'
      : null;
  if (!asset) return null;

  const up = /\b(up|above|higher|rise|gain|over|increase)\b/.test(q);
  const down = /\b(down|below|lower|fall|drop|under|decrease)\b/.test(q);
  if (!up && !down) return null;
  return { asset, bear: down && !up };
}

function eligible(m, ev, prices) {
  if (m.closed === true || ev.closed === true) return false;
  if (m.active === false || ev.active === false) return false;
  if (m.acceptingOrders === false) return false;

  const end = m.endDate || m.endDateIso || ev.endDate || ev.endDateIso;
  if (end) {
    const t = Date.parse(end);
    if (Number.isFinite(t) && t <= Date.now()) return false;
  }

  if (prices.yes <= 0.01 || prices.yes >= 0.99 || prices.no <= 0.01 || prices.no >= 0.99) return false;
  return true;
}

function scoreMarket(m, moves) {
  const move = moves[m.asset] || 0;
  const directionalMove = m.bear ? -move : move;
  // Research heuristic only. This is intentionally falsifiable and not certified fair value.
  const fair = clamp(m.yes + directionalMove * 18, 0.02, 0.98);
  const edge = fair - m.yes;
  const score = clamp(0.5 + edge * 4, 0, 1);
  return { ...m, move, fair, edge, score };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    },
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NFE Market Edge Lab Cloud</title>
<style>body{font-family:system-ui;background:#07111f;color:#eef4ff;margin:0;padding:16px}.w{max-width:850px;margin:auto}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.c{background:#101d2d;border:1px solid #213650;border-radius:14px;padding:14px}.wide{grid-column:1/-1}.big{font-size:24px;font-weight:750}.m{color:#91a4bb;font-size:12px}.ok{color:#8ef0ae}.bad{color:#ff9e9e}.r{padding:9px 0;border-bottom:1px solid #20334a;font-size:13px}@media(min-width:700px){.g{grid-template-columns:repeat(4,1fr)}}</style></head>
<body><div class="w"><div class="m">NFE-OS RESEARCH LAB · CLOUD COLLECTOR</div><h2>Market Edge Lab</h2><p class="m">PAPER ONLY — no wallet, no live order submission.</p><div class="g">
<div class="c"><div class="m">Paper Balance</div><div class="big" id="bal">—</div></div><div class="c"><div class="m">Realized P/L</div><div class="big" id="pnl">—</div></div><div class="c"><div class="m">BTC</div><div class="big" id="btc">—</div></div><div class="c"><div class="m">ETH</div><div class="big" id="eth">—</div></div>
<div class="c wide"><div class="m">Cloud Status</div><div class="big" id="status">Loading…</div><div class="m" id="run"></div></div>
<div class="c wide"><b>Testing</b><div id="testing" class="r"></div></div><div class="c wide"><b>Current Opportunities</b><div id="opps"></div></div><div class="c wide"><b>Open Paper Positions</b><div id="pos"></div></div><div class="c wide"><b>Recent Evidence</b><div id="log"></div></div>
</div></div><script>
const money=n=>'$'+Number(n||0).toFixed(2), pct=n=>(Number(n||0)*100).toFixed(3)+'%';
async function load(){try{const r=await fetch('/api/state?x='+Date.now());const s=await r.json();bal.textContent=money(s.balance);pnl.textContent=(s.realizedPnl>=0?'+':'')+money(s.realizedPnl);btc.textContent=s.prices.BTC?money(s.prices.BTC):'—';eth.textContent=s.prices.ETH?money(s.prices.ETH):'—';status.textContent=s.status;status.className='big '+(s.status==='LIVE_PAPER_ONLY'?'ok':'bad');run.textContent='Last cloud run: '+(s.lastRunAt?new Date(s.lastRunAt).toLocaleString():'not yet');testing.textContent=s.eligibleCount+' eligible · '+s.rejectedCount+' rejected · '+s.seenCount+' examined · '+s.trades+' closed trades';opps.innerHTML=(s.opportunities||[]).slice(0,8).map(o=>'<div class="r">'+o.question+'<div class="m">'+o.asset+' move '+pct(o.move)+' · YES '+(o.yes*100).toFixed(1)+'¢ · score '+o.score.toFixed(2)+'</div></div>').join('')||'<div class="r m">None</div>';pos.innerHTML=(s.positions||[]).map(p=>'<div class="r">'+p.question+'<div class="m">'+money(p.stake)+' paper stake @ '+(p.entry*100).toFixed(1)+'¢</div></div>').join('')||'<div class="r m">None</div>';log.innerHTML=(s.ledger||[]).slice(0,20).map(x=>'<div class="r"><b>'+x.type+'</b><div class="m">'+new Date(x.ts).toLocaleString()+' '+(x.question||x.message||'')+'</div></div>').join('')||'<div class="r m">No evidence yet</div>'}catch(e){status.textContent='LOAD ERROR';status.className='big bad';run.textContent=String(e)}}load();setInterval(load,30000);
</script></body></html>`;
