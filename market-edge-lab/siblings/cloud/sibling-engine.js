// NFE-OS Market Edge sibling autonomous paper engine
// PAPER ONLY. No wallet, signing, exchange keys, or live order submission.
// Designed to be imported by the existing Cloudflare Worker without changing baseline state.

const SIBLING_CONFIG = {
  startingBalance: 100,
  maxStake: 5,
  maxHoldMs: 5 * 60 * 1000,
  maxLedger: 2000,
};

const LABS = ['up_down', 'nfe_reasoning', 'payne_method'];
const keyFor = (lab) => `market-edge-sibling-${lab}-v1`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export async function getSiblingState(env, lab) {
  assertLab(lab);
  return load(env, lab);
}

export async function runAllSiblings(env, baselineState) {
  const now = Date.now();
  const universe = await buildUniverse(baselineState);
  const results = {};
  for (const lab of LABS) results[lab] = await runOne(env, lab, universe, now);
  return { mode: 'PAPER_ONLY', runAt: new Date(now).toISOString(), universe: universe.length, labs: results };
}

async function runOne(env, lab, universe, now) {
  const state = await load(env, lab);
  const decisions = universe.map((o) => ({ opportunity: o, decision: decide(lab, o, universe) }));

  // Common experiment exit boundary: at most five minutes. A method losing its entry condition
  // may exit earlier. This is paper accounting only and is identical across sibling infrastructure.
  for (const p of [...state.positions]) {
    const row = decisions.find((x) => oppKey(x.opportunity) === p.oppKey);
    const age = now - p.openedAt;
    const stillEnter = row ? row.decision.enter === true : false;
    if (age < SIBLING_CONFIG.maxHoldMs && stillEnter) continue;
    const current = row?.opportunity;
    if (!current || !Number.isFinite(price(current)) || price(current) <= 0) continue;
    const exit = price(current);
    const value = p.shares * exit;
    const pnl = value - p.stake;
    state.balance += value;
    state.realizedPnl += pnl;
    state.trades += 1;
    state.positions = state.positions.filter((x) => x.oppKey !== p.oppKey);
    add(state, 'PAPER_EXIT', {
      marketId: p.marketId, oppKey: p.oppKey, question: p.question, asset: p.asset,
      side: p.side, positionOutcome: p.positionOutcome, entry: p.entry, exit, stake: p.stake,
      pnl, entryTs: p.entryTs, heldMs: age, reason: age >= SIBLING_CONFIG.maxHoldMs ? 'max_hold' : 'method_invalidation',
      entryScore: p.entryScore, entryEdge: p.entryEdge, entryDecision: p.entryDecision,
    });
  }

  // Record every method decision before any new paper entry so rejected/watched candidates remain evidence.
  state.lastDecisions = decisions.slice(0, 50).map(({ opportunity:o, decision:d }) => ({
    ts: new Date(now).toISOString(), marketId: marketId(o), oppKey: oppKey(o), question: question(o),
    asset: asset(o), side: side(o), positionOutcome: o.positionOutcome || 'YES', quote: price(o),
    score: score(o), edge: edge(o), move: move(o), label: d.label, enter: d.enter, reason: d.reason,
  }));

  for (const { opportunity:o, decision:d } of decisions.slice(0, 50)) {
    if (!d.enter) continue;
    const k = oppKey(o);
    if (state.positions.some((p) => p.oppKey === k)) continue;
    if (state.balance < 1 || !Number.isFinite(price(o)) || price(o) <= 0) continue;
    const stake = Math.min(SIBLING_CONFIG.maxStake, state.balance);
    const shares = stake / price(o);
    state.balance -= stake;
    state.positions.push({
      marketId: marketId(o), oppKey: k, question: question(o), asset: asset(o), side: side(o),
      positionOutcome: o.positionOutcome || 'YES', entry: price(o), shares, stake, openedAt: now,
      entryTs: new Date(now).toISOString(), entryScore: score(o), entryEdge: edge(o), entryDecision: d.label,
    });
    add(state, 'PAPER_ENTRY', {
      marketId: marketId(o), oppKey: k, question: question(o), asset: asset(o), side: side(o),
      positionOutcome: o.positionOutcome || 'YES', entry: price(o), stake, score: score(o), edge: edge(o),
      move: move(o), decision: d.label, reason: d.reason,
    });
  }

  state.lastRunAt = new Date(now).toISOString();
  state.updatedAt = new Date().toISOString();
  state.status = 'LIVE_PAPER_ONLY';
  state.universeCount = universe.length;
  await env.MARKET_EDGE_STATE.put(keyFor(lab), JSON.stringify(state));
  return summary(state);
}

function decide(lab, o, universe) {
  const sc = score(o), ed = edge(o), mv = move(o);
  if (lab === 'up_down') {
    const enter = sc >= .80 && ed > 0;
    return { label: enter ? 'ENTER' : sc >= .65 ? 'WATCH' : 'OBSERVE', enter, reason: enter ? 'score>=0.80 and positive edge' : 'entry threshold not met' };
  }
  if (lab === 'payne_method') {
    const radar = sc >= .50;
    const lock = radar && sc >= .65 && ed > 0;
    const pull = lock && sc >= .80 && Math.abs(mv) >= .002;
    return { label: pull ? 'PULL TRIGGER' : lock ? 'LOCK IN' : radar ? 'RADAR' : 'PASS', enter: pull, reason: `radar=${radar}; lock=${lock}; pull=${pull}` };
  }
  // Mirrors the current deterministic NFE sibling contract.
  const a = asset(o), sd = side(o);
  const peers = universe.filter((x) => asset(x) === a && side(x) === sd).sort((x,y) => score(y)-score(x));
  const rank = Math.max(1, peers.findIndex((x) => oppKey(x) === oppKey(o)) + 1);
  const opposite = universe.filter((x) => asset(x) === a && side(x) !== sd).sort((x,y) => score(y)-score(x))[0];
  const oppScore = opposite ? score(opposite) : null;
  const enter = sc >= .80 && ed > 0 && rank === 1 && (oppScore == null || sc >= oppScore + .05);
  const label = enter ? 'ENTER' : (sc >= .65 || rank === 1) ? 'WATCH' : 'REJECT';
  return { label, enter, reason: `rank=${rank}; opposite=${oppScore == null ? 'missing' : oppScore.toFixed(3)}; score=${sc.toFixed(3)}; edge=${ed.toFixed(6)}` };
}

async function buildUniverse(baseline) {
  const moves = baseline?.moves || {};
  const map = new Map();
  for (const o of rawOpps(baseline)) {
    const n = { ...o, side: side(o), positionOutcome: o.positionOutcome || 'YES', source: o.source || 'BASELINE_FEED' };
    map.set(oppKey(n), n);
  }
  const queries = ['bitcoin below','bitcoin down','bitcoin under','What price will Bitcoin hit','ethereum below','ethereum down','ethereum under','What price will Ethereum hit'];
  const groups = await Promise.all(queries.map(discoverQuery));
  for (const ev of groups.flat()) {
    for (const m of (ev.markets || [])) {
      const q = [ev.title,m.question,m.groupItemTitle,m.slug].filter(Boolean).join(' — ');
      const dir = inferDirection(q), p = parsePrices(m);
      if (!dir || dir.side !== 'BELOW' || !p || !eligibleMarket(m,ev,p)) continue;
      const id = String(m.id || m.conditionId || m.slug), mv = Number(moves[dir.asset] || 0);
      const o = scored('BELOW',p.yes,mv,{id,question:q,asset:dir.asset,positionOutcome:'YES',yes:p.yes,no:p.no,source:'EXPLICIT_BELOW_CONTRACT',volume:Number(m.volumeNum||m.volume||0),liquidity:Number(m.liquidityNum||m.liquidity||0),endDate:m.endDate||ev.endDate||null});
      map.set(oppKey(o),o);
    }
  }
  return [...map.values()].sort((a,b) => score(b)-score(a));
}

async function discoverQuery(q) {
  const s = await gammaJson(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}`);
  const evs = (s.events || []).slice(0,14);
  const ds = await Promise.all(evs.map(async (e) => { try { return await gammaJson(`https://gamma-api.polymarket.com/events/${e.id}`); } catch { return null; } }));
  return ds.filter(Boolean);
}
async function gammaJson(url) { const r = await fetch(url,{cache:'no-store'}); if(!r.ok) throw Error(`Gamma ${r.status}`); return r.json(); }
function arr(v){ try{return typeof v==='string'?JSON.parse(v):v}catch{return null} }
function parsePrices(m){ const p=arr(m.outcomePrices),outs=arr(m.outcomes); if(!Array.isArray(p)||p.length<2)return null; let yi=0,ni=1; if(Array.isArray(outs)){const y=outs.findIndex(x=>String(x).toLowerCase()==='yes'),n=outs.findIndex(x=>String(x).toLowerCase()==='no');if(y>=0&&n>=0){yi=y;ni=n}} const yes=Number(p[yi]),no=Number(p[ni]); return Number.isFinite(yes)&&Number.isFinite(no)?{yes,no}:null; }
function eligibleMarket(m,ev,p){ if(m.closed===true||ev?.closed===true||m.active===false||ev?.active===false||m.acceptingOrders===false)return false; const end=m.endDate||m.endDateIso||ev?.endDate||ev?.endDateIso; if(end){const x=Date.parse(end);if(Number.isFinite(x)&&x<=Date.now())return false} return !(p.yes<=.01||p.yes>=.99||p.no<=.01||p.no>=.99); }
function inferDirection(q){ q=String(q||'').toLowerCase(); const a=q.includes('bitcoin')||/\bbtc\b/.test(q)?'BTC':q.includes('ethereum')||/\beth\b/.test(q)?'ETH':null; if(!a)return null; const dn=/\b(below|lower|under|down|fall|drop|decrease|dip)\b/.test(q)||q.includes('↓'),up=/\b(above|higher|over|up|rise|gain|increase)\b/.test(q)||q.includes('↑'); if(dn===up)return null; return{asset:a,side:dn?'BELOW':'ABOVE'}; }
function scored(dir,p,mv,base){ const dm=dir==='BELOW'?-mv:mv,fair=clamp(p+dm*18,.02,.98),ed=fair-p,sc=clamp(.5+ed*4,0,1); return{...base,side:dir,bear:dir==='BELOW',move:mv,positionPrice:p,fair,edge:ed,score:sc}; }
function rawOpps(s){const a=s?.opportunities||s?.eligible||s?.candidates||[];return Array.isArray(a)?a:[]}
function question(o){return o.question||o.title||o.marketQuestion||o.slug||'Unknown market'}
function asset(o){return o.asset||(/ethereum|\beth\b/i.test(question(o))?'ETH':'BTC')}
function marketId(o){return String(o.id??o.marketId??o.conditionId??o.slug??question(o))}
function side(o){if(o.side)return o.side;if(o.bear===true)return'BELOW';const q=question(o).toLowerCase(),dn=/\b(below|lower|under|down|fall|drop|decrease|dip)\b/.test(q)||q.includes('↓'),up=/\b(above|higher|over|up|rise|gain|increase)\b/.test(q)||q.includes('↑');return dn&&!up?'BELOW':up&&!dn?'ABOVE':'UNKNOWN'}
function oppKey(o){return marketId(o)+':'+(o.positionOutcome||'YES')+':'+side(o)}
function score(o){return Number(o.score??o.signalScore??0)} function edge(o){return Number(o.edge??0)} function move(o){return Number(o.move??o.assetMove??o.btcMove??o.ethMove??0)} function price(o){return Number(o.positionPrice??o.yesPrice??o.yes??o.price??0)}
function assertLab(lab){if(!LABS.includes(lab))throw Error('Unknown sibling lab')}
async function load(env,lab){ const raw=await env.MARKET_EDGE_STATE.get(keyFor(lab)); if(raw){try{return normalize(lab,JSON.parse(raw))}catch{}} return normalize(lab,{}); }
function normalize(lab,s){return{mode:'PAPER_ONLY',lab,balance:Number.isFinite(s.balance)?s.balance:SIBLING_CONFIG.startingBalance,realizedPnl:Number.isFinite(s.realizedPnl)?s.realizedPnl:0,trades:Number.isFinite(s.trades)?s.trades:0,positions:Array.isArray(s.positions)?s.positions:[],ledger:Array.isArray(s.ledger)?s.ledger:[],lastDecisions:Array.isArray(s.lastDecisions)?s.lastDecisions:[],lastRunAt:s.lastRunAt||null,updatedAt:s.updatedAt||null,status:s.status||'INITIALIZING',universeCount:s.universeCount||0}}
function add(s,type,p={}){s.ledger.unshift({ts:new Date().toISOString(),type,...p});s.ledger=s.ledger.slice(0,SIBLING_CONFIG.maxLedger)}
function summary(s){return{lab:s.lab,mode:s.mode,status:s.status,balance:s.balance,realizedPnl:s.realizedPnl,trades:s.trades,openPositions:s.positions.length,lastRunAt:s.lastRunAt,universeCount:s.universeCount}}
