import { PolymarketUS } from "polymarket-us";

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
    accountConnection: "VERIFY_AT_/account",
    accountBalance: "VERIFY_AT_/account",
    evidenceLedger: "NOT_YET_STARTED",
    buildCheckpoint: "2026-09-17T19:27:00-04:00",
  };
}

function safeAccountView(balances) {
  return {
    currentBalance: balances?.currentBalance ?? null,
    currency: balances?.currency ?? null,
    buyingPower: balances?.buyingPower ?? null,
    assetNotional: balances?.assetNotional ?? null,
    assetAvailable: balances?.assetAvailable ?? null,
    openOrders: balances?.openOrders ?? null,
    unsettledFunds: balances?.unsettledFunds ?? null,
    marginRequirement: balances?.marginRequirement ?? null,
    pendingWithdrawals: Array.isArray(balances?.pendingWithdrawals)
      ? balances.pendingWithdrawals.length
      : null,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json({
        ok: false,
        error: "READ_ONLY_BUILD",
        message:
          "Baseline Real currently exposes GET-only validation routes. Live order submission is not implemented.",
      }, 405);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "market-edge-baseline-real",
        mode: "READ_ONLY_ACCOUNT_VERIFICATION",
        liveOrderSubmission: "DISABLED",
      });
    }

    if (url.pathname === "/status") {
      return json(statusPayload(env));
    }

    if (url.pathname === "/account") {
      const credentialsPresent = Boolean(
        env.POLYMARKET_US_KEY_ID && env.POLYMARKET_US_SECRET,
      );

      if (!credentialsPresent) {
        return json({
          ok: false,
          state: "CREDENTIALS_NOT_INSTALLED",
          liveOrderSubmission: "DISABLED",
          valuesExposed: false,
        }, 503);
      }

      try {
        const client = new PolymarketUS({
          keyId: env.POLYMARKET_US_KEY_ID,
          secretKey: env.POLYMARKET_US_SECRET,
        });

        const balances = await client.account.balances();

        return json({
          ok: true,
          state: "AUTHENTICATED_READ_ONLY",
          accountConnection: "VERIFIED",
          account: safeAccountView(balances),
          credentials: {
            installed: true,
            valuesExposed: false,
          },
          fundingAuthorized: false,
          expectedFundingUsd: 0,
          shadowExperimentStarted: false,
          liveOrderSubmission: "DISABLED",
          note:
            "This route performs only an authenticated balance read. No order submission is implemented.",
        });
      } catch (error) {
        return json({
          ok: false,
          state: "AUTHENTICATION_OR_ACCOUNT_READ_FAILED",
          accountConnection: "NOT_VERIFIED",
          errorType: error?.name || "Error",
          message: error?.message || "Polymarket US account read failed.",
          credentials: {
            installed: true,
            valuesExposed: false,
          },
          fundingAuthorized: false,
          liveOrderSubmission: "DISABLED",
        }, 502);
      }
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
