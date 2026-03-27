import { fetchCoinbaseCandlesInRange } from "@/lib/server/coinbase-client";
import { fetchKalshiWindowByTicker } from "@/lib/server/btc-kalshi-client";
import {
  hydrateTrackedTrades,
  listTrackedTrades,
  upsertTrackedTrade,
} from "@/lib/server/btc-signal-account-trade-store";
import { listKalshiFills } from "@/lib/server/kalshi-client";
import { signalConfig } from "@/lib/server/signal-config";
import { listSignalWindows, upsertSignalWindow } from "@/lib/server/btc-signal-store";
import type { BtcTrackedTrade, TrackedTradeSource, TrackedWinRateMetrics } from "@/lib/signal-types";

const TRACKED_SERIES_PREFIX = "KXBTC15M";
type KalshiFillList = Awaited<ReturnType<typeof listKalshiFills>>;

const trackerState = globalThis as typeof globalThis & {
  __btcSignalAccountTrackerHydrated?: boolean;
  __btcSignalAccountTrackerRunning?: boolean;
  __btcSignalAccountTrackerLastSyncAt?: number;
};

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function trackingStartDate() {
  const parsed = Date.parse(signalConfig.trackingStartIso);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date("2026-03-25T09:10:00.000Z");
}

function trackingStartLabel() {
  return trackingStartDate().toLocaleString("en-US", {
    timeZone: signalConfig.timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isAutoClientOrderId(clientOrderId: string | null) {
  return Boolean(
    clientOrderId && (clientOrderId.startsWith("bsig-") || clientOrderId.startsWith("btcsignal-")),
  );
}

function classifySource(clientOrderIds: Array<string | null>) {
  const autoCount = clientOrderIds.filter((value) => isAutoClientOrderId(value)).length;
  const knownCount = clientOrderIds.filter(Boolean).length;

  if (autoCount > 0 && autoCount === clientOrderIds.length) {
    return "auto" satisfies TrackedTradeSource;
  }
  if (autoCount > 0 && autoCount < clientOrderIds.length) {
    return "mixed" satisfies TrackedTradeSource;
  }
  if (knownCount === 0 || autoCount === 0) {
    return "manual" satisfies TrackedTradeSource;
  }
  return "unknown" satisfies TrackedTradeSource;
}

async function ensureResolvedWindow(marketTicker: string) {
  const existing = listSignalWindows().find((window) => window.marketTicker === marketTicker) ?? null;
  if (existing?.resolutionOutcome) {
    return existing;
  }

  const market = await fetchKalshiWindowByTicker(marketTicker).catch(() => null);
  if (!market?.closeTime || market.strikePrice === null) {
    return existing;
  }

  const closeTime = Date.parse(market.closeTime);
  const openTime = new Date(closeTime - 15 * 60_000).toISOString();
  const shouldResolve = Number.isFinite(closeTime) && Date.now() >= closeTime + 60_000;

  const window = await upsertSignalWindow({
    id: existing?.id,
    marketTicker: market.ticker,
    marketTitle: market.title,
    openTime,
    closeTime: market.closeTime,
    expirationTime: market.expirationTime,
    strikePriceDollars: market.strikePrice,
    status: shouldResolve ? "resolved" : "active",
    resolutionOutcome: existing?.resolutionOutcome ?? null,
    settlementProxyPriceDollars: existing?.settlementProxyPriceDollars ?? null,
    outcomeSource: existing?.outcomeSource ?? null,
  });

  if (!shouldResolve || window.resolutionOutcome) {
    return window;
  }

  const candles = await fetchCoinbaseCandlesInRange(
    new Date(closeTime - 60_000),
    new Date(closeTime + 60_000),
  ).catch(() => []);
  const settleCandle = candles.find((candle) => candle.start * 1_000 >= closeTime) ?? candles.at(-1);
  if (!settleCandle) {
    return window;
  }

  return upsertSignalWindow({
    id: window.id,
    marketTicker: window.marketTicker,
    marketTitle: window.marketTitle,
    openTime: window.openTime,
    closeTime: window.closeTime,
    expirationTime: window.expirationTime,
    strikePriceDollars: window.strikePriceDollars,
    status: "resolved",
    resolutionOutcome: settleCandle.close >= (window.strikePriceDollars ?? 0) ? "above" : "below",
    settlementProxyPriceDollars: round(settleCandle.close),
    outcomeSource: "coinbase_proxy",
  });
}

async function hydrateOnce() {
  if (trackerState.__btcSignalAccountTrackerHydrated) {
    return;
  }

  trackerState.__btcSignalAccountTrackerHydrated = true;
  await hydrateTrackedTrades().catch(() => undefined);
}

export async function syncTrackedAccountTrades() {
  await hydrateOnce();

  const syncCooldownMs = 15_000;
  if (
    trackerState.__btcSignalAccountTrackerRunning ||
    (trackerState.__btcSignalAccountTrackerLastSyncAt &&
      Date.now() - trackerState.__btcSignalAccountTrackerLastSyncAt < syncCooldownMs)
  ) {
    return;
  }

  trackerState.__btcSignalAccountTrackerRunning = true;
  try {
    const fills = await listKalshiFills(undefined, 200).catch(() => []);
    const start = trackingStartDate().getTime();
    const grouped = new Map<string, KalshiFillList>();

    for (const fill of fills) {
      const createdAt = fill.createdAt ? Date.parse(fill.createdAt) : Number.NaN;
      if (
        fill.action !== "buy" ||
        !fill.marketTicker.startsWith(TRACKED_SERIES_PREFIX) ||
        !Number.isFinite(createdAt) ||
        createdAt < start
      ) {
        continue;
      }

      const key = `${fill.marketTicker}:${fill.side}`;
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(fill);
      } else {
        grouped.set(key, [fill]);
      }
    }

    for (const [key, group] of grouped.entries()) {
      const [marketTicker, side] = key.split(":") as [string, "yes" | "no"];
      const sorted = group
        .slice()
        .filter((fill) => fill.contracts > 0)
        .sort((left, right) => Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? ""));

      if (!sorted.length) {
        continue;
      }

      const totalContracts = sorted.reduce((sum, fill) => sum + Math.max(0, fill.contracts), 0);
      const weightedCost = sorted.reduce(
        (sum, fill) => sum + Math.max(0, fill.contracts) * (fill.priceDollars ?? 0),
        0,
      );
      const averagePriceDollars = totalContracts > 0 ? round(weightedCost / totalContracts, 4) : null;
      const firstFillAt = sorted[0]?.createdAt ?? null;
      const lastFillAt = sorted.at(-1)?.createdAt ?? null;
      const source = classifySource(sorted.map((fill) => fill.clientOrderId));
      const window = await ensureResolvedWindow(marketTicker).catch(() => null);
      const resolutionOutcome = window?.resolutionOutcome ?? null;
      const isWin =
        resolutionOutcome !== null &&
        ((side === "yes" && resolutionOutcome === "above") || (side === "no" && resolutionOutcome === "below"));
      const realizedPnlDollars =
        resolutionOutcome !== null && averagePriceDollars !== null
          ? round((isWin ? 1 - averagePriceDollars : -averagePriceDollars) * totalContracts, 2)
          : null;

      await upsertTrackedTrade({
        marketTicker,
        side,
        source,
        firstFillAt,
        lastFillAt,
        totalContracts,
        averagePriceDollars,
        fillsCount: sorted.length,
        resolutionOutcome,
        result: resolutionOutcome === null ? "open" : isWin ? "win" : "loss",
        realizedPnlDollars,
      });
    }

    trackerState.__btcSignalAccountTrackerLastSyncAt = Date.now();
  } finally {
    trackerState.__btcSignalAccountTrackerRunning = false;
  }
}

export function listPublicTrackedTrades(limit = 12): BtcTrackedTrade[] {
  return listTrackedTrades(limit).map((trade) => ({
    marketTicker: trade.marketTicker,
    side: trade.side,
    source: trade.source,
    firstFillAt: trade.firstFillAt,
    lastFillAt: trade.lastFillAt,
    totalContracts: trade.totalContracts,
    averagePriceDollars: trade.averagePriceDollars,
    fillsCount: trade.fillsCount,
    resolutionOutcome: trade.resolutionOutcome,
    result: trade.result,
    realizedPnlDollars: trade.realizedPnlDollars,
  }));
}

export function buildTrackedMetrics(): TrackedWinRateMetrics {
  const trades = listTrackedTrades().filter((trade) => {
    const firstFillAt = trade.firstFillAt ? Date.parse(trade.firstFillAt) : Number.NaN;
    return Number.isFinite(firstFillAt) && firstFillAt >= trackingStartDate().getTime();
  });
  const resolvedTrades = trades.filter((trade) => trade.result !== "open");
  const wins = resolvedTrades.filter((trade) => trade.result === "win").length;
  const losses = resolvedTrades.filter((trade) => trade.result === "loss").length;
  const autoTrades = trades.filter((trade) => trade.source === "auto").length;
  const manualTrades = trades.filter((trade) => trade.source === "manual").length;
  const mixedTrades = trades.filter((trade) => trade.source === "mixed").length;

  return {
    trackingStartIso: trackingStartDate().toISOString(),
    trackingStartLabel: trackingStartLabel(),
    trackedTrades: trades.length,
    resolvedTrades: resolvedTrades.length,
    openTrades: trades.length - resolvedTrades.length,
    wins,
    losses,
    winRatePct: resolvedTrades.length > 0 ? round((wins / resolvedTrades.length) * 100, 2) : null,
    pnlDollars: round(
      resolvedTrades.reduce((sum, trade) => sum + (trade.realizedPnlDollars ?? 0), 0),
      2,
    ) ?? 0,
    autoTrades,
    manualTrades,
    mixedTrades,
  };
}
