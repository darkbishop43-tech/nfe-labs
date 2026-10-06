import { D1ExecutionStore, ExecutionEngine } from "./robinhood-execution-core.js";
import { createRobinhoodExecutionProvider } from "./robinhood-execution-provider.js";
import { readBestBidAsk, readEstimatedPrice, resolveBoundAccount } from "./robinhood-crypto-read.js";

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
  const engine = createDisarmedEngine(env);
  if (request.method === "GET" && action === "state") {
    return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, capitalAuthority: "ZERO", state: publicRow(await engine.state()) } };
  }
  if (request.method !== "POST") return { status: 405, body: { error: "METHOD_NOT_ALLOWED", execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED } };
  const body = await request.json().catch(() => ({}));
  if (action === "arm") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.arm()) } };
  if (action === "disarm") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.disarm()) } };
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
    return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(row) } };
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
    return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(row) } };
  }
  if (action === "approve") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.approve({ specimenFp: body.specimenFp, approvalId: body.approvalId })) } };
  if (action === "submit-entry") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.submitEntry()) } };
  if (action === "submit-exit") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.submitExit(body)) } };
  if (action === "reconcile-entry") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.reconcileEntry(body.authoritative || body)) } };
  if (action === "reconcile-exit") return { status: 200, body: { execution: "DISARMED", liveWritesEnabled: LIVE_WRITES_ENABLED, state: publicRow(await engine.reconcileExit(body.authoritative || body)) } };
  return { status: 404, body: { error: "UNKNOWN_EXECUTION_ACTION", execution: "DISARMED" } };
}
