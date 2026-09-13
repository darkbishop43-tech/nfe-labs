import express from 'express';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const STARTING_BALANCE = Number(process.env.PAPER_BALANCE || 100);
const POLL_MS = Number(process.env.POLYMARKET_POLL_MS || 15000);
const ENTRY_SCORE = Number(process.env.ENTRY_SCORE || 0.80);
const EXIT_SCORE = Number(process.env.EXIT_SCORE || 0.20);
const MAX_STAKE = Number(process.env.MAX_STAKE || 5);
const MAX_HOLD_MS = Number(process.env.MAX_HOLD_MS || 5 * 60 * 1000);

const app = express();
app.use(express.json());
app.use(express.static(new URL('../public', import.meta.url).pathname));

const state = {
  startedAt: new Date().toISOString(),
  mode: 'PAPER_ONLY',
  balance: STARTING_BALANCE,
  realizedPnl: 0,
  crypto: {
    'BTC-USD': { price: null, updatedAt: null, history: [] },
    'ETH-USD': { price: null, updatedAt: null, history: [] }
  },
  markets: [],
  opportunities: [],
  positions: [],
  ledger: []
};

const clients = new Set();
const dataDir = new URL('../data', import.meta.url).pathname;
fs.mkdirSync(dataDir, { recursive: true });
const ledgerPath = path.join(dataDir, 'evidence-ledger.jsonl');

function nowIso() { return new Date().toISOString(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pctMove(history, ms = 60000) {
  if (!history.length) return 0;
  const cutoff = Date.now() - ms;
  const latest = history.at(-1)?.price;
  const older = history.find(x => x.ts >= cutoff)?.price ?? history[0]?.price;
  if (!latest || !older) return 0;
  return (latest - older) / older;
}
function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(payload);
}
function snapshot() {
  return {
    ...state,
    crypto: Object.fromEntries(Object.entries(state.crypto).map(([k, v]) => [k, {
      price: v.price,
      updatedAt: v.updatedAt,
      move60s: pctMove(v.history)
    }]))
  };
}
function record(type, payload) {
  const row = { id: crypto.randomUUID(), ts: nowIso(), type, ...payload };
  state.ledger.unshift(row);
  state.ledger = state.ledger.slice(0, 500);
  fs.appendFileSync(ledgerPath, JSON.stringify(row) + '\n');
  return row;
}

function connectCoinbase() {
  const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD', 'ETH-USD'], channels: ['ticker'] }));
    record('SYSTEM', { message: 'Coinbase ticker connected' });
    broadcast();
  });
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'ticker' || !state.crypto[msg.product_id]) return;
      const price = Number(msg.price);
      if (!Number.isFinite(price)) return;
      const c = state.crypto[msg.product_id];
      c.price = price;
      c.updatedAt = msg.time || nowIso();
      c.history.push({ ts: Date.now(), price });
      const cutoff = Date.now() - 10 * 60 * 1000;
      while (c.history.length && c.history[0].ts < cutoff) c.history.shift();
      evaluate();
      broadcast();
    } catch {}
  });
  ws.on('close', () => setTimeout(connectCoinbase, 3000));
  ws.on('error', () => ws.close());
}

function directionForQuestion(q = '') {
  const s = q.toLowerCase();
  if (!/(bitcoin|btc|ethereum|eth)/.test(s)) return null;
  if (/(up|above|higher|increase|rise|reach)/.test(s)) return 'BULLISH_YES';
  if (/(down|below|lower|decrease|fall|drop)/.test(s)) return 'BEARISH_YES';
  return null;
}

async function refreshPolymarket() {
  try {
    const url = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume&ascending=false';
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Gamma ${res.status}`);
    const rows = await res.json();
    const cryptoRows = rows.filter(m => directionForQuestion(m.question));
    const normalized = [];
    for (const m of cryptoRows.slice(0, 20)) {
      let outcomes = [];
      let prices = [];
      let tokenIds = [];
      try { outcomes = JSON.parse(m.outcomes || '[]'); } catch {}
      try { prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch {}
      try { tokenIds = JSON.parse(m.clobTokenIds || '[]'); } catch {}
      const yesIndex = outcomes.findIndex(x => String(x).toLowerCase() === 'yes');
      if (yesIndex < 0 || !Number.isFinite(prices[yesIndex])) continue;
      let bestBid = null, bestAsk = null;
      const tokenId = tokenIds[yesIndex];
      if (tokenId) {
        try {
          const bookRes = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`);
          if (bookRes.ok) {
            const book = await bookRes.json();
            bestBid = Number(book.bids?.at(-1)?.price ?? book.bids?.[0]?.price ?? NaN);
            bestAsk = Number(book.asks?.at(-1)?.price ?? book.asks?.[0]?.price ?? NaN);
            if (!Number.isFinite(bestBid)) bestBid = null;
            if (!Number.isFinite(bestAsk)) bestAsk = null;
          }
        } catch {}
      }
      normalized.push({
        id: String(m.id),
        question: m.question,
        direction: directionForQuestion(m.question),
        yesPrice: prices[yesIndex],
        bestBid,
        bestAsk,
        spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
        liquidity: Number(m.liquidityNum ?? m.liquidity ?? 0),
        volume: Number(m.volumeNum ?? m.volume ?? 0),
        tokenId,
        updatedAt: nowIso(),
        url: m.slug ? `https://polymarket.com/event/${m.slug}` : null
      });
    }
    state.markets = normalized;
    record('MARKET_REFRESH', { marketsTracked: normalized.length });
    evaluate();
    broadcast();
  } catch (error) {
    record('ERROR', { source: 'polymarket', message: String(error.message || error) });
    broadcast();
  }
}

function scoreMarket(m) {
  const product = /ethereum|\beth\b/i.test(m.question) ? 'ETH-USD' : 'BTC-USD';
  const move = pctMove(state.crypto[product].history);
  const signedMove = m.direction === 'BEARISH_YES' ? -move : move;
  // V0 heuristic only: a 0.15% 60-second move is treated as a strong lead signal.
  const momentumScore = clamp(Math.abs(signedMove) / 0.0015, 0, 1);
  const directionScore = signedMove > 0 ? momentumScore : -momentumScore;
  const marketPrice = m.bestAsk ?? m.yesPrice;
  const expectedShift = clamp(directionScore * 0.12, -0.12, 0.12);
  const reference = clamp(m.yesPrice + expectedShift, 0.01, 0.99);
  const edge = reference - marketPrice;
  const spreadPenalty = m.spread == null ? 0.02 : Math.max(0, m.spread);
  const netEdge = edge - spreadPenalty;
  const score = clamp((netEdge / 0.08 + 1) / 2, 0, 1);
  return { product, move60s: move, marketPrice, reference, edge, netEdge, score };
}

function evaluate() {
  const opportunities = state.markets.map(m => ({ ...m, ...scoreMarket(m) }))
    .filter(o => Number.isFinite(o.marketPrice))
    .sort((a, b) => b.score - a.score);
  state.opportunities = opportunities.slice(0, 25);

  for (const o of opportunities) {
    const existing = state.positions.find(p => p.marketId === o.id && p.status === 'OPEN');
    if (!existing && o.score >= ENTRY_SCORE && o.netEdge > 0 && state.balance >= 1) {
      const stake = Math.min(MAX_STAKE, state.balance);
      const shares = stake / o.marketPrice;
      const p = {
        id: crypto.randomUUID(), marketId: o.id, question: o.question, product: o.product,
        side: 'YES', entryPrice: o.marketPrice, shares, stake,
        openedAt: nowIso(), openedMs: Date.now(), status: 'OPEN', entryScore: o.score
      };
      state.positions.unshift(p);
      state.balance -= stake;
      record('PAPER_ENTRY', { positionId: p.id, marketId: p.marketId, question: p.question, stake, entryPrice: p.entryPrice, score: o.score, netEdge: o.netEdge });
    }
    if (existing) {
      const shouldExit = o.score <= EXIT_SCORE || Date.now() - existing.openedMs >= MAX_HOLD_MS;
      if (shouldExit) closePosition(existing, o.marketPrice, o.score, 'signal_or_time');
    }
  }
}

function closePosition(p, exitPrice, score, reason) {
  if (p.status !== 'OPEN') return;
  const proceeds = p.shares * exitPrice;
  const pnl = proceeds - p.stake;
  p.status = 'CLOSED';
  p.closedAt = nowIso();
  p.exitPrice = exitPrice;
  p.pnl = pnl;
  p.exitScore = score;
  state.balance += proceeds;
  state.realizedPnl += pnl;
  record('PAPER_EXIT', { positionId: p.id, marketId: p.marketId, question: p.question, exitPrice, pnl, score, reason });
}

app.get('/api/state', (_req, res) => res.json(snapshot()));
app.get('/api/ledger', (_req, res) => res.json(state.ledger));
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: state.mode, startedAt: state.startedAt }));
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  req.on('close', () => clients.delete(res));
});

app.listen(PORT, () => {
  console.log(`Market Edge Lab PAPER_ONLY listening on http://localhost:${PORT}`);
  connectCoinbase();
  refreshPolymarket();
  setInterval(refreshPolymarket, POLL_MS);
});
