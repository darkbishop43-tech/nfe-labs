import { D1ExecutionStore, ExecutionEngine, executeCycle, deriveRunStatus } from "./robinhood-execution-core.js";
import { createRobinhoodExecutionProvider } from "./robinhood-execution-provider.js";
import { readBestBidAsk, readEstimatedPrice, resolveBoundAccount, readPairs, readBoundHoldings } from "./robinhood-crypto-read.js";

export const LIVE_WRITES_ENABLED = true;

function maskAccount(v){
  const s = String(v || "");
  return s ? "••••" + s.slice(-4) : null;
}
function publicRow(row){
  const out = structuredClone(row);
  if (out.specimen?.accountNumber) out.specimen.accountNumber = maskAccount(out.specimen.accountNumber);
  if (out.owned?.accountNumber) out.owned.accountNumber = maskAccount(out.owned.accountNumber);
  if (out.exitIntent?.specimen?.accountNumber) out.exitIntent.specimen.accountNumber = maskAccount(out.exitIntent.specimen.accountNumber);
  return out;
}
function constantTimeEqual(a,b){
  const enc=new TextEncoder(), x=enc.encode(String(a)), y=enc.encode(String(b));
  let diff=x.length^y.length; const n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++) diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
// Every state-changing execution route is Founder-only. Fails closed if the secret is not configured.
export function requireFounder(request, env){
  const token=env.FOUNDER_EXEC_TOKEN;
  if(!token||String(token).length<24) return {ok:false,status:503,body:{error:"FOUNDER_EXEC_TOKEN_NOT_CONFIGURED",reason:"State-changing execution routes are disabled until the FOUNDER_EXEC_TOKEN Worker secret (>=24 chars) exists."}};
  const m=(request.headers.get("authorization")||"").match(/^Bearer (.+)$/);
  if(!m||!constantTimeEqual(m[1],token)) return {ok:false,status:401,body:{error:"FOUNDER_AUTH_REQUIRED"}};
  return {ok:true};
}
function stateBody(row, extra={}){
  const state=publicRow(row);
  state.runStatus=deriveRunStatus(row);
  return {
    run:{targetRuns:row.run?.targetRuns??null,completedRuns:row.run?.completedRuns??0,remainingRuns:row.run?.remainingRuns??0,runStatus:state.runStatus,haltReason:row.run?.haltReason??null},
    runConfig:row.runConfig??null,
    execution:state.state,
    armed:state.armed===true,
    liveWritesEnabled:LIVE_WRITES_ENABLED,
    capitalAuthority:state.armed===true?"FOUNDER_GOVERNED":"ZERO",
    state,
    ...extra
  };
}
export function createDisarmedEngine(env){
  if (!env.V0A_DB) throw new Error("EXECUTION_DB_BINDING_MISSING");
  return new ExecutionEngine({
    store: new D1ExecutionStore(env.V0A_DB),
    provider: createRobinhoodExecutionProvider(env),
    liveWritesEnabled: LIVE_WRITES_ENABLED
  });
}
async function boundAccount(env){
  const account = await resolveBoundAccount(env, "crypto");
  if (!account?.account_number) throw new Error("ROBINHOOD_AUTHORIZED_ACCOUNT_BINDING_NOT_PROVEN");
  return account;
}
export async function handleExecutionRequest(request, env){
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/robinhood/execution/")) return null;
  const action = url.pathname.slice("/api/robinhood/execution/".length);
  if (!LIVE_WRITES_ENABLED && request.method === "POST" && (action === "submit-entry" || action === "submit-exit")) {
    return { status: 403, body: { error: "LIVE_WRITES_DISABLED", execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, capitalMoved: "USD 0.00", reason: "Live-write capability is disabled." } };
  }
  if (request.method === "POST") {
    const auth = requireFounder(request, env);
    if (!auth.ok) return { status: auth.status, body: { ...auth.body, execution: "UNCHANGED", capitalMoved: "USD 0.00" } };
  }
  const engine = createDisarmedEngine(env);
  if (request.method === "GET" && action === "state") {
    return { status: 200, body: stateBody(await engine.state()) };
  }
  if (request.method !== "POST") return { status: 405, body: { error: "METHOD_NOT_ALLOWED", execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED } };
  const body = await request.json().catch(() => ({}));
  if (action === "run-config") return { status: 200, body: stateBody(await engine.setRunConfig(body)) };
  if (action === "run-config-clear") return { status: 200, body: stateBody(await engine.clearRunConfig()) };
  if (action === "arm") return { status: 200, body: stateBody(await engine.arm()) };
  if (action === "disarm") return { status: 200, body: stateBody(await engine.disarm()) };
  if (action === "lock") {
    const account = await boundAccount(env);
    if (body.accountNumber && !String(account.account_number).endsWith(String(body.accountNumber).slice(-4))) {
      return { status: 409, body: { error: "ACCOUNT_BINDING_MISMATCH", execution: "DISARMED" } };
    }
    const quote = body.symbol ? await readBestBidAsk(env, [body.symbol]) : null;
    const row = await engine.lock({
      accountNumber: account.account_number,
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      orderConfig: body.orderConfig,
      maxDebit: body.maxDebit,
      lockedProviderEvidence: { quote, providerTimestamp: new Date().toISOString() },
      previewEvidence: null,
      frozenConfiguration: body.frozenConfiguration
    });
    return { status: 200, body: stateBody(row) };
  }
  if (action === "preview") {
    const current = await engine.state();
    if (!current.specimen) throw new Error("LOCK_REQUIRED");
    let previewEvidence = body.previewEvidence ?? null;
    if (!previewEvidence && body.quantity) {
      previewEvidence = await readEstimatedPrice(env, { symbol: current.specimen.symbol, side: body.side || "ask", quantity: body.quantity });
    }
    if (!previewEvidence) return { status: 409, body: { error: "PREVIEW_EVIDENCE_REQUIRED", execution: "DISARMED", reason: "No quantity was invented. Supply authoritative quantity or prior non-executing estimate evidence." } };
    const row = await engine.preview(previewEvidence);
    return { status: 200, body: stateBody(row) };
  }
  if (action === "approve") return { status: 200, body: stateBody(await engine.approve({ specimenFp: body.specimenFp, approvalId: body.approvalId })) };
  if (action === "submit-entry") return { status: 200, body: stateBody(await engine.submitEntry()) };
  if (action === "submit-exit") return { status: 200, body: stateBody(await engine.submitExit(body)) };
  if (action === "reconcile-entry") return { status: 200, body: stateBody(await engine.reconcileEntry(body.authoritative || body)) };
  if (action === "reconcile-exit") return { status: 200, body: stateBody(await engine.reconcileExit(body.authoritative || body)) };
  return { status: 404, body: { error: "UNKNOWN_EXECUTION_ACTION", execution: "DISARMED" } };
}

// ONE orchestration entry point for the existing scheduled() invocation. Advances at most one safe lifecycle step.
export async function runRobinhoodExecutionCycle(env, hooks = {}){
  if (!env.V0A_DB) return { step: "SKIPPED_NO_DB" };
  const engine = createDisarmedEngine(env);
  const provider = engine.provider;
  const deps = {
    rankCandidate: hooks.rankCandidate,
    currentScore: hooks.currentScore || (async () => NaN),
    readAccount: () => boundAccount(env),
    readPair: async symbol => ((await readPairs(env, [symbol])).results || []).find(p => p.symbol === symbol) || null,
    readQuote: async symbol => ((await readBestBidAsk(env, [symbol])).results || []).find(q => q.symbol === symbol) || null,
    readEstimate: (symbol, side, quantity) => readEstimatedPrice(env, { symbol, side, quantity }),
    readHoldings: async assetCode => (await readBoundHoldings(env, [assetCode])).results || [],
    getOrder: input => provider.getOrder(input)
  };
  try { return await executeCycle({ engine, deps, nowMs: Date.now() }); }
  catch (e) {
    try { await engine.store.event("CYCLE_ERROR", { message: String(e?.message || e) }); } catch {}
    return { step: "CYCLE_ERROR", message: String(e?.message || e) };
  }
}
