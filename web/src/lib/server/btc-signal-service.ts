import { fetchCoinbaseCandles, fetchCoinbaseCandlesInRange } from "@/lib/server/coinbase-client";
import { discoverActiveBtcWindow, fetchKalshiWindowByTicker } from "@/lib/server/btc-kalshi-client";
import { buildSignalExplanation } from "@/lib/server/btc-explainer";
import { buildBtcSignalFeatures, buildSignalRecommendation } from "@/lib/server/btc-signal-model";
import {
  appendSignalSnapshot,
  getLatestSignalSnapshot,
  hydrateSignalStore,
  listSignalHistory,
  upsertSignalWindow,
} from "@/lib/server/btc-signal-store";
import { signalConfig } from "@/lib/server/signal-config";
import type {
  Btc15mSignalSnapshot,
  PersistedSignalSnapshot,
  PersistedSignalWindow,
  SignalHistoryEntry,
  SignalRiskLevel,
} from "@/lib/signal-types";

type CachedComputedSnapshot = {
  generatedAt: number;
  snapshot: Btc15mSignalSnapshot;
};

const runtimeStore = globalThis as typeof globalThis & {
  __btcSignalDaemonStarted?: boolean;
  __btcSignalTimer?: NodeJS.Timeout;
  __btcSignalHydrated?: boolean;
  __btcSignalCache?: CachedComputedSnapshot;
};

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function buildProgressLabel(secondsElapsed: number) {
  const minute = Math.floor(secondsElapsed / 60);
  const second = secondsElapsed % 60;
  return `Minute ${Math.min(15, minute + 1)} · ${String(second).padStart(2, "0")}s`;
}

function toSignalRisk(secondsToClose: number): SignalRiskLevel {
  if (secondsToClose <= signalConfig.noBuyCloseSeconds) {
    return "closing";
  }
  if (secondsToClose <= 4 * 60) {
    return "late";
  }
  if (secondsToClose <= 11 * 60) {
    return "developing";
  }
  return "fresh";
}

async function hydrateOnce() {
  if (runtimeStore.__btcSignalHydrated) {
    return;
  }

  runtimeStore.__btcSignalHydrated = true;
  await hydrateSignalStore().catch(() => undefined);
}

function mapHistory(): SignalHistoryEntry[] {
  return listSignalHistory(signalConfig.historyLimit).map((entry) => ({
    windowTicker: entry.marketTicker,
    observedAt: entry.observedAt,
    action: entry.action,
    contractSide: entry.contractSide,
    buyPriceDollars: entry.buyPriceDollars,
    fairValueDollars: entry.fairValueDollars,
    edgeDollars: entry.edgeDollars,
    modelProbability: entry.modelAboveProbability,
    currentPrice: entry.currentPriceDollars,
    outcome: entry.resolutionOutcome,
    outcomeSource: entry.outcomeSource,
  }));
}

async function resolveWindowOutcome(window: PersistedSignalWindow) {
  if (window.status === "resolved" || !window.closeTime || window.strikePriceDollars === null) {
    return window;
  }

  const closeTime = Date.parse(window.closeTime);
  if (!Number.isFinite(closeTime) || Date.now() < closeTime + 60_000) {
    return window;
  }

  const start = new Date(closeTime - 60_000);
  const end = new Date(closeTime + 60_000);
  const candles = await fetchCoinbaseCandlesInRange(start, end).catch(() => []);
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
    resolutionOutcome: settleCandle.close >= window.strikePriceDollars ? "above" : "below",
    settlementProxyPriceDollars: round(settleCandle.close),
    outcomeSource: "coinbase_proxy",
  });
}

async function getWindowAnchor(now: Date) {
  const market = await discoverActiveBtcWindow(now);
  if (!market || !market.closeTime) {
    return { market: null, window: null as PersistedSignalWindow | null };
  }

  const closeTime = Date.parse(market.closeTime);
  const openTime = new Date(closeTime - 15 * 60_000).toISOString();
  const window = await upsertSignalWindow({
    marketTicker: market.ticker,
    marketTitle: market.title,
    openTime,
    closeTime: market.closeTime,
    expirationTime: market.expirationTime,
    strikePriceDollars: market.strikePrice,
    status: "active",
    resolutionOutcome: null,
    settlementProxyPriceDollars: null,
    outcomeSource: null,
  });

  return { market, window };
}

async function computeSnapshot() {
  await hydrateOnce();
  const warnings: string[] = [];
  const now = new Date();
  const { market, window } = await getWindowAnchor(now);

  if (!market || !window || !market.closeTime) {
    const cached = runtimeStore.__btcSignalCache?.snapshot;
    if (cached) {
      return {
        ...cached,
        stale: true,
        warnings: [...cached.warnings, "No active BTC 15-minute Kalshi market is available right now."],
      } satisfies Btc15mSignalSnapshot;
    }

    return {
      generatedAt: now.toISOString(),
      stale: false,
      window: {
        id: null,
        openedAt: null,
        closeTime: null,
        progressLabel: "Waiting for market",
        secondsElapsed: 0,
        secondsToClose: 0,
        riskLevel: "closing",
        market: null,
      },
      features: null,
      recommendation: null,
      explanation: {
        status: "fallback",
        model: null,
        summary: "No active BTC 15-minute Kalshi market is available right now.",
        conviction: [],
        caution: ["The app needs an active KXBTC15M market before it can score a trade."],
      },
      history: mapHistory(),
      warnings: ["No active BTC 15-minute Kalshi market is available right now."],
    } satisfies Btc15mSignalSnapshot;
  }

  const closeTime = Date.parse(market.closeTime);
  const secondsToClose = Math.max(0, Math.round((closeTime - now.getTime()) / 1_000));
  const secondsElapsed = Math.max(0, 15 * 60 - secondsToClose);
  const riskLevel = toSignalRisk(secondsToClose);
  const candles = await fetchCoinbaseCandles().catch((error) => {
    warnings.push(error instanceof Error ? error.message : "Coinbase candle fetch failed.");
    return [];
  });

  if (candles.length < 60) {
    const cached = runtimeStore.__btcSignalCache?.snapshot;
    return cached
      ? {
          ...cached,
          stale: true,
          warnings: [...cached.warnings, ...warnings, "Coinbase returned too few candles for the live engine."],
        }
      : {
          generatedAt: now.toISOString(),
          stale: true,
          window: {
            id: window.id,
            openedAt: window.openTime,
            closeTime: window.closeTime,
            progressLabel: buildProgressLabel(secondsElapsed),
            secondsElapsed,
            secondsToClose,
            riskLevel,
            market,
          },
          features: null,
          recommendation: null,
          explanation: {
            status: "fallback",
            model: null,
            summary: "Coinbase data is not ready, so the engine cannot issue a reliable 15-minute recommendation.",
            conviction: [],
            caution: ["The live BTC feed returned too few candles for the model."],
          },
          history: mapHistory(),
          warnings: [...warnings, "Coinbase returned too few candles for the live engine."],
        };
  }

  const latestMarket = await fetchKalshiWindowByTicker(market.ticker).catch(() => market);
  const { features } = buildBtcSignalFeatures({
    candles,
    market: latestMarket,
    now,
  });
  const recommendation = buildSignalRecommendation({
    market: latestMarket,
    features,
    riskLevel,
  });
  const explanation = await buildSignalExplanation({
    recommendation,
    features,
    market: latestMarket,
  });

  const persistedSnapshot: PersistedSignalSnapshot = {
    id: crypto.randomUUID(),
    windowId: window.id,
    marketTicker: latestMarket.ticker,
    observedAt: now.toISOString(),
    secondsElapsed,
    secondsToClose,
    currentPriceDollars: features.currentPrice,
    modelAboveProbability: features.modelAboveProbability,
    modelBelowProbability: features.modelBelowProbability,
    action: recommendation.action,
    contractSide: recommendation.contractSide,
    buyPriceDollars: recommendation.buyPriceDollars,
    fairValueDollars: recommendation.fairValueDollars,
    edgeDollars: recommendation.edgeDollars,
    confidence: recommendation.confidence,
    suggestedStakeDollars: recommendation.suggestedStakeDollars,
    suggestedContracts: recommendation.suggestedContracts,
    features: {
      currentPrice: features.currentPrice,
      distanceToStrike: features.distanceToStrike,
      distanceToStrikeAtr: features.distanceToStrikeAtr,
      distanceToStrikeBps: features.distanceToStrikeBps,
      ema9: features.ema9,
      ema21: features.ema21,
      ema55: features.ema55,
      rsi14: features.rsi14,
      atr14: features.atr14,
      vwap120: features.vwap120,
      momentum3: features.momentum3,
      momentum5: features.momentum5,
      momentum10: features.momentum10,
      momentum15: features.momentum15,
      trendBias: features.trendBias,
    },
    reasons: recommendation.reasons,
    blockers: recommendation.blockers,
    explanationStatus: explanation.status,
    explanationSummary: explanation.summary,
    resolutionOutcome: null,
    outcomeSource: null,
  };

  await appendSignalSnapshot(persistedSnapshot);
  await resolveWindowOutcome(window).catch(() => undefined);

  const snapshot = {
    generatedAt: now.toISOString(),
    stale: false,
    window: {
      id: window.id,
      openedAt: window.openTime,
      closeTime: window.closeTime,
      progressLabel: buildProgressLabel(secondsElapsed),
      secondsElapsed,
      secondsToClose,
      riskLevel,
      market: latestMarket,
    },
    features,
    recommendation,
    explanation,
    history: mapHistory(),
    warnings,
  } satisfies Btc15mSignalSnapshot;

  runtimeStore.__btcSignalCache = {
    generatedAt: Date.now(),
    snapshot,
  };

  return snapshot;
}

export async function ensureSignalDaemonStarted() {
  if (runtimeStore.__btcSignalDaemonStarted) {
    return;
  }

  runtimeStore.__btcSignalDaemonStarted = true;
  await hydrateOnce();
  void computeSnapshot().catch(() => undefined);

  runtimeStore.__btcSignalTimer = setInterval(() => {
    void computeSnapshot().catch(() => undefined);
  }, signalConfig.signalRefreshMs);
}

export async function getBtc15mSignalSnapshot() {
  await ensureSignalDaemonStarted();

  const cached = runtimeStore.__btcSignalCache;
  if (cached && Date.now() - cached.generatedAt <= signalConfig.staleAfterMs) {
    return cached.snapshot;
  }

  const latestPersisted = getLatestSignalSnapshot();
  if (latestPersisted && cached?.snapshot) {
    return {
      ...cached.snapshot,
      stale: true,
    } satisfies Btc15mSignalSnapshot;
  }

  return computeSnapshot();
}
