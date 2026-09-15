// Market Edge sibling cloud worker — PAPER ONLY.
// Separate from the frozen baseline worker and baseline state key.
import { getSiblingState, runAllSiblings } from './sibling-engine.js';

const BASELINE_STATE = 'https://market-edge-lab.darkbishop43.workers.dev/api/state';
const LABS = new Set(['up_down','nfe_reasoning','payne_method']);

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/run') return json(await run(env));
    const m = url.pathname.match(/^\/api\/state\/(up_down|nfe_reasoning|payne_method)$/);
    if (m) return json(await getSiblingState(env, m[1]));
    if (url.pathname === '/api/state') {
      const states = {};
      for (const lab of LABS) states[lab] = await getSiblingState(env, lab);
      return json({ mode:'PAPER_ONLY', labs:states });
    }
    return json({
      name:'NFE-OS Market Edge Sibling Collector', mode:'PAPER_ONLY',
      labs:[...LABS], baseline:'read-only public snapshot',
      note:'No wallet, signing, exchange key, or live order submission exists in this worker.'
    });
  }
};

async function run(env) {
  const r = await fetch(`${BASELINE_STATE}?x=${Date.now()}`, { cache:'no-store' });
  if (!r.ok) throw Error(`Baseline snapshot ${r.status}`);
  const baseline = await r.json();
  return runAllSiblings(env, baseline);
}

function json(v,status=200){return new Response(JSON.stringify(v,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}})}
