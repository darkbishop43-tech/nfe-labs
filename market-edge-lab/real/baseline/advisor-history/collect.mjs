const ASSETS = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  HYPE: "HYPE-USD",
  ZEC: "ZEC-USD",
  DOGE: "DOGE-USD",
  BNB: "BNB-USD",
  NEAR: "NEAR-USD",
};

const SOURCE = "COINBASE_EXCHANGE_HISTORIC_RATES_1M";
const GRANULARITY_SECONDS = 60;
const TARGET_COMPLETED_BARS = 220;
const REQUESTED_MINUTES = 300;
const MAX_RETAINED_BARS = 300;
const OUTPUT_DIR = new URL("./out/", import.meta.url);

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function finite(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function validOhlc(bar) {
  return bar.open !== null && bar.high !== null && bar.low !== null && bar.close !== null &&
    bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0 &&
    bar.high >= bar.open && bar.high >= bar.close &&
    bar.low <= bar.open && bar.low <= bar.close && bar.high >= bar.low;
}

function normalizeRows(rawRows, nowMs, collectedAt) {
  const byTs = new Map();
  let invalidRows = 0;
  let incompleteRows = 0;

  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    if (!Array.isArray(row) || row.length < 5) {
      invalidRows++;
      continue;
    }
    const tsSeconds = finite(row[0]);
    const tsMs = tsSeconds === null ? null : tsSeconds * 1000;
    const bar = {
      timestamp: tsMs === null ? null : new Date(tsMs).toISOString(),
      open: finite(row[3]),
      high: finite(row[2]),
      low: finite(row[1]),
      close: finite(row[4]),
      volume: row.length > 5 ? finite(row[5]) : null,
      source: SOURCE,
      collectedAt,
      complete: tsMs !== null && tsMs + 60_000 <= nowMs,
      gapStatus: "UNASSESSED",
    };

    if (tsMs === null || !validOhlc(bar)) {
      invalidRows++;
      continue;
    }
    if (!bar.complete) {
      incompleteRows++;
      continue;
    }
    byTs.set(tsMs, bar);
  }

  const ordered = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-MAX_RETAINED_BARS);

  let gapCount = 0;
  let missingMinutes = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (i === 0) {
      ordered[i][1].gapStatus = "START";
      continue;
    }
    const delta = ordered[i][0] - ordered[i - 1][0];
    if (delta === 60_000) {
      ordered[i][1].gapStatus = "CONTIGUOUS";
    } else if (delta > 60_000) {
      const missing = Math.max(1, Math.floor(delta / 60_000) - 1);
      gapCount++;
      missingMinutes += missing;
      ordered[i][1].gapStatus = `GAP_${missing}_MINUTES`;
    } else {
      ordered[i][1].gapStatus = "NON_MONOTONIC";
    }
  }

  const bars = ordered.map(([, bar]) => bar);
  const timestamps = ordered.map(([ts]) => ts);
  const uniqueTimestamps = new Set(timestamps).size === timestamps.length;
  const monotonic = timestamps.every((ts, i) => i === 0 || ts > timestamps[i - 1]);
  const noFutureBars = timestamps.every(ts => ts + 60_000 <= nowMs);
  const ohlcValid = bars.every(validOhlc);
  const volumeState = bars.length && bars.every(b => b.volume !== null && b.volume >= 0)
    ? "AVAILABLE"
    : "UNAVAILABLE";

  return {
    bars,
    gapCount,
    missingMinutes,
    invalidRows,
    incompleteRows,
    volumeState,
    quality: {
      timestampsMonotonic: monotonic,
      duplicateBars: timestamps.length - new Set(timestamps).size,
      uniqueTimestamps,
      ohlcFiniteAndConsistent: ohlcValid,
      noFutureBars,
      completedOnly: bars.every(b => b.complete === true),
    },
  };
}

async function fetchAsset(asset, product, nowMs) {
  const collectedAt = new Date().toISOString();
  const completedMinuteStart = Math.floor(nowMs / 60_000) * 60_000;
  const end = new Date(completedMinuteStart).toISOString();
  const start = new Date(completedMinuteStart - REQUESTED_MINUTES * 60_000).toISOString();
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${GRANULARITY_SECONDS}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "NFE-OS-Market-Edge-Advisor-History/1.0",
      },
    });
  } catch (error) {
    return unavailable(asset, product, collectedAt, "NETWORK_READ_FAILED", String(error?.message || error));
  }

  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || !Array.isArray(body)) {
    return unavailable(asset, product, collectedAt, `COINBASE_HTTP_${response.status}`, Array.isArray(body) ? null : "NON_ARRAY_RESPONSE", response.status);
  }

  const normalized = normalizeRows(body, nowMs, collectedAt);
  const completedBars = normalized.bars.length;
  const status = completedBars >= TARGET_COMPLETED_BARS ? "READY" : completedBars > 0 ? "PARTIAL" : "UNAVAILABLE";

  return {
    schema: "NFE_ADVISOR_HISTORY_V1",
    asset,
    product,
    source: SOURCE,
    provider: "COINBASE_EXCHANGE",
    providerHttpStatus: response.status,
    collectedAt,
    requested: {
      granularitySeconds: GRANULARITY_SECONDS,
      requestedMinutes: REQUESTED_MINUTES,
      targetCompletedBars: TARGET_COMPLETED_BARS,
      start,
      end,
    },
    status,
    state: status,
    completedBars,
    firstTimestamp: normalized.bars[0]?.timestamp || null,
    latestCompletedBar: normalized.bars.at(-1)?.timestamp || null,
    gapCount: normalized.gapCount,
    missingMinutes: normalized.missingMinutes,
    invalidRows: normalized.invalidRows,
    incompleteRowsExcluded: normalized.incompleteRows,
    completeness: completedBars >= TARGET_COMPLETED_BARS ? "TARGET_MET" : "TARGET_NOT_MET",
    volumeState: normalized.volumeState,
    quality: normalized.quality,
    bars: normalized.bars,
    authority: {
      canObserve: true,
      canReadHistoricalMarketData: true,
      canPersistAdvisorHistory: true,
      canModifyScore: false,
      canModifyExecution: false,
      canSubmitOrders: false,
      canCancelOrders: false,
      canChangeCapital: false,
      canArm: false,
      canDisarm: false,
      canWriteSeriesState: false,
    },
    safety: {
      providerTradingWrites: 0,
      capitalMovedUsd: 0,
      ordersSubmitted: 0,
      executionStateTouched: false,
      armDisarmTouched: false,
      fabricatedCandles: 0,
      interpolatedCandles: 0,
    },
  };
}

function unavailable(asset, product, collectedAt, reason, detail = null, providerHttpStatus = null) {
  return {
    schema: "NFE_ADVISOR_HISTORY_V1",
    asset,
    product,
    source: SOURCE,
    provider: "COINBASE_EXCHANGE",
    providerHttpStatus,
    collectedAt,
    status: "UNAVAILABLE",
    state: "UNAVAILABLE",
    reason,
    detail,
    completedBars: 0,
    firstTimestamp: null,
    latestCompletedBar: null,
    gapCount: 0,
    missingMinutes: 0,
    completeness: "TARGET_NOT_MET",
    volumeState: "UNAVAILABLE",
    quality: {
      timestampsMonotonic: true,
      duplicateBars: 0,
      uniqueTimestamps: true,
      ohlcFiniteAndConsistent: false,
      noFutureBars: true,
      completedOnly: true,
    },
    bars: [],
    authority: {
      canObserve: true,
      canReadHistoricalMarketData: true,
      canPersistAdvisorHistory: true,
      canModifyScore: false,
      canModifyExecution: false,
      canSubmitOrders: false,
      canCancelOrders: false,
      canChangeCapital: false,
      canArm: false,
      canDisarm: false,
      canWriteSeriesState: false,
    },
    safety: {
      providerTradingWrites: 0,
      capitalMovedUsd: 0,
      ordersSubmitted: 0,
      executionStateTouched: false,
      armDisarmTouched: false,
      fabricatedCandles: 0,
      interpolatedCandles: 0,
    },
  };
}

await mkdir(fileURLToPath(OUTPUT_DIR), { recursive: true });

const nowMs = Date.now();
const results = [];
for (const [asset, product] of Object.entries(ASSETS)) {
  const result = await fetchAsset(asset, product, nowMs);
  results.push(result);
  await writeFile(new URL(`./out/${asset}.json`, import.meta.url), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`${asset}\t${result.source}\t${result.completedBars}\t${result.firstTimestamp || "—"}\t${result.latestCompletedBar || "—"}\t${result.gapCount}\t${result.status}`);
  await new Promise(resolve => setTimeout(resolve, 125));
}

const ready = results.filter(r => r.status === "READY").length;
const partial = results.filter(r => r.status === "PARTIAL").length;
const unavailableCount = results.filter(r => r.status === "UNAVAILABLE").length;
const allQualityValid = results.filter(r => r.completedBars > 0).every(r =>
  r.quality.timestampsMonotonic && r.quality.uniqueTimestamps &&
  r.quality.ohlcFiniteAndConsistent && r.quality.noFutureBars && r.quality.completedOnly
);

const summary = {
  schema: "NFE_ADVISOR_HISTORY_SUMMARY_V1",
  generatedAt: new Date().toISOString(),
  assetsAttempted: results.length,
  targetCompletedBars: TARGET_COMPLETED_BARS,
  ready,
  partial,
  unavailable: unavailableCount,
  allQualityValid,
  results: results.map(r => ({
    asset: r.asset,
    product: r.product,
    source: r.source,
    providerHttpStatus: r.providerHttpStatus,
    barCount: r.completedBars,
    firstBar: r.firstTimestamp,
    latestCompletedBar: r.latestCompletedBar,
    gaps: r.gapCount,
    missingMinutes: r.missingMinutes,
    volumeState: r.volumeState,
    status: r.status,
    reason: r.reason || null,
    quality: r.quality,
  })),
  authority: {
    canObserve: true,
    canReadHistoricalMarketData: true,
    canPersistAdvisorHistory: true,
    canModifyScore: false,
    canModifyExecution: false,
    canSubmitOrders: false,
    canCancelOrders: false,
    canChangeCapital: false,
    canArm: false,
    canDisarm: false,
    canWriteSeriesState: false,
  },
  safety: {
    providerTradingWrites: 0,
    capitalMovedUsd: 0,
    ordersSubmitted: 0,
    executionStateTouched: false,
    armDisarmTouched: false,
    fabricatedCandles: 0,
    interpolatedCandles: 0,
  },
};

await writeFile(new URL("./out/summary.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log("SUMMARY_JSON=" + JSON.stringify(summary));

if (results.length !== Object.keys(ASSETS).length) process.exitCode = 2;
if (!allQualityValid) process.exitCode = 3;
