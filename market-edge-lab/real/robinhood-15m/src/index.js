const RH_CRYPTO_URL = "https://robinhood.com/us/en/prediction-markets/crypto/";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: HEADERS });
}

function cleanText(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFifteenMinuteLinks(html) {
  const links = [];
  const re = /href=["']([^"']*\/prediction-markets\/crypto\/events\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].startsWith("http") ? m[1] : "https://robinhood.com" + m[1];
    const text = cleanText(m[2]);
    const hay = (href + " " + text).toLowerCase();
    if (!/btc|bitcoin|eth|ethereum/.test(hay)) continue;
    if (!/15[ -]?min|15-min|15-minutes/.test(hay)) continue;
    links.push({ href, text });
  }
  return [...new Map(links.map(x => [x.href, x])).values()];
}

function parseEventPage(html, url) {
  const text = cleanText(html);
  const asset = /\beth\b|ethereum/i.test(text) ? "ETH" : /\bbtc\b|bitcoin/i.test(text) ? "BTC" : null;
  const title = text.match(/(BTC|ETH) 15 min[^$]{0,80}/i)?.[0]?.trim() || null;
  const targetRaw = text.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)\s+or above/i)?.[1] || null;
  const bidRaw = text.match(/Bid\s+([0-9]+(?:\.[0-9]+)?)¢/i)?.[1] || null;
  const askRaw = text.match(/Ask\s+([0-9]+(?:\.[0-9]+)?)¢/i)?.[1] || null;
  const live = /\bLIVE\b/i.test(text) && !/closed and no longer tradable/i.test(text);
  const target = targetRaw ? Number(targetRaw.replace(/,/g, "")) : null;
  return {
    asset,
    title,
    target,
    bidCents: bidRaw ? Number(bidRaw) : null,
    askCents: askRaw ? Number(askRaw) : null,
    live,
    url,
    source: "ROBINHOOD_PUBLIC_EVENT_PAGE",
    execution: "OBSERVE_ONLY",
  };
}

async function discover() {
  const indexRes = await fetch(RH_CRYPTO_URL, {
    headers: { accept: "text/html", "user-agent": "NFE-Market-Edge-15m-Observer/1.0" },
    cf: { cacheTtl: 0 },
  });
  if (!indexRes.ok) throw new Error("ROBINHOOD_CRYPTO_INDEX_" + indexRes.status);
  const indexHtml = await indexRes.text();
  const links = extractFifteenMinuteLinks(indexHtml);

  const rows = [];
  for (const link of links.slice(0, 12)) {
    try {
      const r = await fetch(link.href, {
        headers: { accept: "text/html", "user-agent": "NFE-Market-Edge-15m-Observer/1.0" },
        cf: { cacheTtl: 0 },
      });
      if (!r.ok) continue;
      const row = parseEventPage(await r.text(), link.href);
      if (row.asset && row.title) rows.push(row);
    } catch {}
  }

  const btc = rows.filter(x => x.asset === "BTC" && x.live);
  const eth = rows.filter(x => x.asset === "ETH" && x.live);
  return {
    ok: true,
    experiment: "MARKET EDGE — 15 MIN REAL OBSERVER",
    mode: "READ_ONLY",
    source: "ROBINHOOD_PUBLIC_WEB",
    targetInstrument: "BTC_ETH_15_MINUTE_EVENT_CONTRACTS",
    strategyHoldHorizon: "MAX_5_MINUTES",
    orderSubmission: "DISABLED",
    moneyMovement: "DISABLED",
    discoveredLinks: links.length,
    liveCoverage: { BTC: btc.length, ETH: eth.length },
    events: [...btc, ...eth],
    caveat: "Public-page observation only. Robinhood settlement uses CF Benchmarks RTI; Coinbase spot is not the settlement benchmark.",
    observedAt: new Date().toISOString(),
  };
}

function page() {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Market Edge — 15 Min Observer</title>
<style>body{font-family:system-ui;background:#07111d;color:#eaf2ff;margin:0;padding:18px}.wrap{max-width:900px;margin:auto}.card{background:#0d1b2a;border:1px solid #24405c;border-radius:14px;padding:14px;margin:12px 0}.good{color:#5cf2a0}.warn{color:#ffd36a}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.event{background:#0a1624;border:1px solid #203a54;border-radius:12px;padding:12px}.big{font-size:1.4rem;font-weight:800}a{color:#8fc7ff}small{color:#9bb0c5}</style>
<div class="wrap"><h1>Market Edge — 15 Min Real Observer</h1><div class="card"><b class="good">OBSERVE ONLY · NO ORDERS · NO MONEY MOVEMENT</b><p>Target: real Robinhood BTC/ETH 15-minute event contracts. Existing experiments remain untouched.</p><small>5-minute maximum strategy horizon. Contract settlement benchmark is CF Benchmarks RTI, not Coinbase spot.</small></div><div id="s" class="card">Loading live public observation…</div><div id="g" class="grid"></div></div>
<script>
async function load(){const s=document.getElementById('s'),g=document.getElementById('g');try{const r=await fetch('/proof',{cache:'no-store'}),d=await r.json();s.innerHTML='<b>Coverage:</b> BTC '+d.liveCoverage.BTC+' · ETH '+d.liveCoverage.ETH+'<br><small>Observed '+new Date(d.observedAt).toLocaleString()+'</small>';g.innerHTML=(d.events||[]).map(x=>'<div class="event"><div class="big">'+x.asset+' · 15 MIN</div><div>'+String(x.title||'')+'</div><p>Target: '+(x.target?'$'+x.target.toLocaleString():'—')+'<br>Bid: '+(x.bidCents??'—')+'¢ · Ask: '+(x.askCents??'—')+'¢</p><b class="good">LIVE · OBSERVE ONLY</b><br><a href="'+x.url+'" target="_blank">View Robinhood event</a></div>').join('')||'<div class="card warn">No live BTC/ETH 15-minute contracts were discoverable from the public crypto page on this refresh. No fallback contract will be substituted.</div>'}catch(e){s.innerHTML='<b class="warn">PUBLIC OBSERVATION UNAVAILABLE</b><br>No trade action permitted.'}}</script><script>load();setInterval(load,15000)</script>`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ ok:false, error:"READ_ONLY" },405);
    if (url.pathname === "/") return new Response(page(), { headers: { "content-type":"text/html; charset=utf-8","cache-control":"no-store" } });
    if (url.pathname === "/health") return json({ ok:true, service:"market-edge-15m-observer", mode:"READ_ONLY", orderSubmission:"DISABLED" });
    if (url.pathname === "/proof") {
      try { return json(await discover()); }
      catch { return json({ ok:false, state:"PUBLIC_OBSERVATION_FAILED", orderSubmission:"DISABLED", moneyMovement:"DISABLED" },502); }
    }
    return json({ ok:false,error:"NOT_FOUND" },404);
  }
};
