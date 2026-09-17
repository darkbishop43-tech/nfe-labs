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

function normalizeSecretKey(raw) {
  const trimmed = String(raw || "").trim();

  if (!trimmed) {
    return { ok: false, reason: "EMPTY_SECRET" };
  }

  if (trimmed.includes("-----BEGIN")) {
    return { ok: false, reason: "PEM_FORMAT_NOT_EXPECTED" };
  }

  let value = trimmed;
  let detected = "BASE64_STANDARD";

  if (/^[A-Za-z0-9_-]+={0,2}$/.test(value) && /[-_]/.test(value)) {
    detected = "BASE64URL";
    value = value.replace(/-/g, "+").replace(/_/g, "/");
  } else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return { ok: false, reason: "UNRECOGNIZED_SECRET_ENCODING" };
  }

  while (value.length % 4 !== 0) value += "=";

  try {
    const binary = atob(value);
    const byteLength = binary.length;

    if (byteLength !== 32 && byteLength !== 64) {
      return {
        ok: false,
        reason: "UNEXPECTED_ED25519_KEY_LENGTH",
        detected,
        byteLength,
      };
    }

    return {
      ok: true,
      normalized: value,
      detected,
      byteLength,
    };
  } catch {
    return { ok: false, reason: "BASE64_DECODE_FAILED", detected };
  }
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
    buildCheckpoint: "2026-09-17T19:40:00-04:00",
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

      const secret = normalizeSecretKey(env.POLYMARKET_US_SECRET);

      if (!secret.ok) {
        return json({
          ok: false,
          state: "SECRET_FORMAT_INVALID",
          accountConnection: "NOT_VERIFIED",
          credentialDiagnostics: {
            secretFormatReason: secret.reason,
            detectedEncoding: secret.detected ?? null,
            decodedByteLength: secret.byteLength ?? null,
            valuesExposed: false,
          },
          fundingAuthorized: false,
          liveOrderSubmission: "DISABLED",
        }, 422);
      }

      try {
        const client = new PolymarketUS({
          keyId: String(env.POLYMARKET_US_KEY_ID).trim(),
          secretKey: secret.normalized,
        });

        const balances = await client.account.balances();

        return json({
          ok: true,
          state: "AUTHENTICATED_READ_ONLY",
          accountConnection: "VERIFIED",
          account: safeAccountView(balances),
          credentialDiagnostics: {
            detectedEncoding: secret.detected,
            decodedByteLength: secret.byteLength,
            valuesExposed: false,
          },
          fundingAuthorized: false,
          expectedFundingUsd: 0,
          shadowExperimentStarted: false,
          liveOrderSubmission: "DISABLED",
          note:
            "Authenticated balance read only. No order submission is implemented.",
        });
      } catch (error) {
        return json({
          ok: false,
          state: "AUTHENTICATION_OR_ACCOUNT_READ_FAILED",
          accountConnection: "NOT_VERIFIED",
          errorType: error?.name || "Error",
          message: error?.message || "Polymarket US account read failed.",
          credentialDiagnostics: {
            detectedEncoding: secret.detected,
            decodedByteLength: secret.byteLength,
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
