const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function statusPayload(env) {
  return {
    ok: true,
    experiment: env.EXPERIMENT_NAME || "MARKET EDGE — BASELINE REAL",
    isolation: "DEDICATED_WORKER",
    marketScope: env.MARKET_SCOPE || "BTC_ETH_ONLY",
    executionMode: env.EXECUTION_MODE || "LOCKED",
    liveOrderSubmission: "DISABLED",
    fundingAuthorized: false,
    expectedFundingUsd: 0,
    shadowExperimentStarted: false,
    credentials: {
      keyIdInstalled: Boolean(env.POLYMARKET_US_KEY_ID),
      secretInstalled: Boolean(env.POLYMARKET_US_SECRET),
      valuesExposed: false,
    },
    accountConnection: "NOT_YET_VERIFIED",
    accountBalance: "NOT_YET_VERIFIED",
    evidenceLedger: "NOT_YET_STARTED",
    buildCheckpoint: "2026-09-17T01:51:00-04:00",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json({
        ok: false,
        error: "READ_ONLY_BUILD",
        message: "Baseline Real currently exposes GET-only validation routes. Live order submission is not implemented.",
      }, 405);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "market-edge-baseline-real",
        mode: "READ_ONLY_BOOTSTRAP",
        liveOrderSubmission: "DISABLED",
      });
    }

    if (url.pathname === "/status") {
      return json(statusPayload(env));
    }

    if (url.pathname === "/account") {
      const credentialsPresent = Boolean(env.POLYMARKET_US_KEY_ID && env.POLYMARKET_US_SECRET);
      return json({
        ok: false,
        state: credentialsPresent ? "AUTH_CONTRACT_NOT_YET_VERIFIED" : "CREDENTIALS_NOT_INSTALLED",
        balance: "NOT_YET_VERIFIED",
        liveOrderSubmission: "DISABLED",
        message: credentialsPresent
          ? "Credentials are installed server-side, but this build intentionally will not transmit them until the current official Polymarket US authentication contract is verified."
          : "Install credentials only as encrypted Worker secrets after deployment. Do not place them in GitHub or client-side code.",
      }, credentialsPresent ? 501 : 503);
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
