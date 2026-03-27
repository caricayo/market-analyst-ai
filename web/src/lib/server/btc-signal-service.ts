import { fetchCoinbaseCandles, fetchCoinbaseCandlesInRange } from "@/lib/server/coinbase-client";
import { discoverActiveBtcWindow, fetchKalshiWindowByTicker } from "@/lib/server/btc-kalshi-client";
import { buildSignalExplanation } from "@/lib/server/btc-explainer";
import {
  getSignalExecutionByWindowTicker,
  hydrateSignalExecutions,
  listSignalExecutions,
} from "@/lib/server/btc-signal-execution-store";
import { buildBtcSignalFeatures, buildReversalSignal, buildSignalRecommendation } from "@/lib/server/btc-signal-model";
import {
  appendSignalSnapshot,
  getLatestSignalSnapshot,
  hydrateSignalStore,
  listSignalSnapshots,
  listSignalWindows,
  updateResolvedSnapshotsForWindow,
  upsertSignalWindow,
} from "@/lib/server/btc-signal-store";
import { signalConfig } from "@/lib/server/signal-config";
import type {
  BtcReversalSignal,
  Btc15mSignalSnapshot,
  BtcSignalExecution,
  KalshiBtcWindowSnapshot,
  PersistedSignalExecution,
  PersistedSignalSnapshot,
  PersistedSignalWindow,
  SignalHistoryEntry,
  SignalOutcome,
  SignalPerformanceMetrics,
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
  return `Minute ${Math.min(15, minute + 1)} - ${String(second).padStart(2, "0")}s`;
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
  await Promise.all([
    hydrateSignalStore().catch(() => undefined),
    hydrateSignalExecutions().catch(() => undefined),
  ]);
}

type WindowSnapshotSeries = {
  windowId: string;
  first: PersistedSignalSnapshot;
  latest: PersistedSignalSnapshot;
  snapshots: PersistedSignalSnapshot[];
};

function getWindowSnapshotSeries(limit?: number) {
  const seriesByWindow = new Map<string, PersistedSignalSnapshot[]>();

  for (const snapshot of listSignalSnapshots()) {
    const series = seriesByWindow.get(snapshot.windowId);
    if (series) {
      series.push(snapshot);
    } else {
      seriesByWindow.set(snapshot.windowId, [snapshot]);
    }
  }

  const series = Array.from(seriesByWindow.entries())
    .map(([windowId, snapshots]) => ({
      windowId,
      first: snapshots.at(-1) ?? snapshots[0],
      latest: snapshots[0],
      snapshots,
    }))
    .filter(
      (entry): entry is WindowSnapshotSeries =>
        Boolean(entry.first) && Boolean(entry.latest) && entry.snapshots.length > 0,
    )
    .sort((left, right) => right.first.observedAt.localeCompare(left.first.observedAt));

  return typeof limit === "number" ? series.slice(0, limit) : series;
}

function getPredictedDirection(snapshot: PersistedSignalSnapshot) {
  return (snapshot.modelAboveProbability ?? 0) >= (snapshot.modelBelowProbability ?? 0)
    ? "above"
    : "below";
}

function getPredictedProbability(snapshot: PersistedSignalSnapshot) {
  return getPredictedDirection(snapshot) === "above"
    ? snapshot.modelAboveProbability
    : snapshot.modelBelowProbability;
}

function hasDecisionFlip(series: PersistedSignalSnapshot[]) {
  if (series.length <= 1) {
    return false;
  }

  const openingAction = series.at(-1)?.action ?? series[0]?.action;
  return series.some((snapshot) => snapshot.action !== openingAction);
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asFactorScores(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === "number" && Number.isFinite(entry)),
  );
}

function extractPersistedReversal(snapshot: PersistedSignalSnapshot): BtcReversalSignal | null {
  const raw = snapshot.features.reversal;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const watchStatus = record.watchStatus;
  const activeStatus = record.activeStatus;
  const direction = record.direction;

  if (
    (watchStatus !== "none" && watchStatus !== "building" && watchStatus !== "soon") ||
    (activeStatus !== "none" && activeStatus !== "starting" && activeStatus !== "active") ||
    (direction !== "bullish" && direction !== "bearish" && direction !== "neutral")
  ) {
    return null;
  }

  return {
    watchStatus,
    activeStatus,
    direction,
    confidence: asNumber(record.confidence) ?? 50,
    score: asNumber(record.score) ?? 0,
    reasons: asStringArray(record.reasons),
    riskFlags: asStringArray(record.riskFlags),
    triggerLevel: asNumber(record.triggerLevel),
    invalidatesBelow: asNumber(record.invalidatesBelow),
    invalidatesAbove: asNumber(record.invalidatesAbove),
    estimatedWindow: asString(record.estimatedWindow),
    factorScores: asFactorScores(record.factorScores),
  };
}

function getOutcomeResult(snapshot: PersistedSignalSnapshot): SignalOutcome | null {
  if (!snapshot.resolutionOutcome) {
    return null;
  }

  if (snapshot.action === "no_buy") {
    return "skipped";
  }

  const expectedOutcome = snapshot.action === "buy_yes" ? "above" : "below";
  return expectedOutcome === snapshot.resolutionOutcome ? "win" : "loss";
}

function getSuggestedPnl(snapshot: PersistedSignalSnapshot) {
  if (
    snapshot.action === "no_buy" ||
    snapshot.buyPriceDollars === null ||
    snapshot.suggestedContracts <= 0 ||
    !snapshot.resolutionOutcome
  ) {
    return null;
  }

  const win =
    (snapshot.action === "buy_yes" && snapshot.resolutionOutcome === "above") ||
    (snapshot.action === "buy_no" && snapshot.resolutionOutcome === "below");
  const perContract = win ? 1 - snapshot.buyPriceDollars : -snapshot.buyPriceDollars;
  return round(perContract * snapshot.suggestedContracts, 2);
}

function mapHistory(): SignalHistoryEntry[] {
  return getWindowSnapshotSeries(signalConfig.historyLimit).map((entry) => ({
    windowTicker: entry.first.marketTicker,
    observedAt: entry.first.observedAt,
    action: entry.first.action,
    contractSide: entry.first.contractSide,
    finalAction: entry.latest.action,
    finalContractSide: entry.latest.contractSide,
    flippedAfterOpen: hasDecisionFlip(entry.snapshots),
    predictedDirection: getPredictedDirection(entry.first),
    finalPredictedDirection: getPredictedDirection(entry.latest),
    buyPriceDollars: entry.first.buyPriceDollars,
    fairValueDollars: entry.first.fairValueDollars,
    edgeDollars: entry.first.edgeDollars,
    modelProbability: getPredictedProbability(entry.first),
    currentPrice: entry.first.currentPriceDollars,
    reversalDirection: extractPersistedReversal(entry.first)?.direction ?? "neutral",
    reversalWatchStatus: extractPersistedReversal(entry.first)?.watchStatus ?? "none",
    reversalActiveStatus: extractPersistedReversal(entry.first)?.activeStatus ?? "none",
    reversalConfidence: extractPersistedReversal(entry.first)?.confidence ?? null,
    outcome: entry.first.resolutionOutcome,
    outcomeResult: getOutcomeResult(entry.first),
    suggestedPnlDollars: getSuggestedPnl(entry.first),
    outcomeSource: entry.first.outcomeSource,
  }));
}

function toPublicExecutionStatus(execution: PersistedSignalExecution | null): BtcSignalExecution | null {
  if (!execution) {
    return null;
  }

  return {
    windowId: execution.windowId,
    windowTicker: execution.windowTicker,
    status: execution.status,
    lockedAction: execution.lockedAction,
    lockedSide: execution.lockedSide,
    decisionObservedAt: execution.decisionObservedAt,
    submittedAt: execution.submittedAt,
    entryPriceDollars: execution.entryPriceDollars,
    submittedContracts: execution.submittedContracts,
    filledContracts: execution.filledContracts,
    maxCostDollars: execution.maxCostDollars,
    orderId: execution.orderId,
    clientOrderId: execution.clientOrderId,
    message: execution.message,
    resolutionOutcome: execution.resolutionOutcome,
    realizedPnlDollars: execution.realizedPnlDollars,
    updatedAt: execution.updatedAt,
  };
}

function listRecentExecutionStatuses(limit = 8) {
  return listSignalExecutions(limit).map((execution) => toPublicExecutionStatus(execution)).filter(Boolean) as BtcSignalExecution[];
}

function buildCalibrationBuckets(snapshots: PersistedSignalSnapshot[]) {
  const ranges = [
    { label: "50-54%", min: 0.5, max: 0.55 },
    { label: "55-59%", min: 0.55, max: 0.6 },
    { label: "60-64%", min: 0.6, max: 0.65 },
    { label: "65-69%", min: 0.65, max: 0.7 },
    { label: "70-79%", min: 0.7, max: 0.8 },
    { label: "80%+", min: 0.8, max: 1.01 },
  ];

  return ranges.map((range) => {
    const bucketSnapshots = snapshots.filter((snapshot) => {
      const predictedProbability = getPredictedProbability(snapshot) ?? 0;
      return predictedProbability >= range.min && predictedProbability < range.max;
    });
    const hits = bucketSnapshots.filter(
      (snapshot) => snapshot.resolutionOutcome === getPredictedDirection(snapshot),
    ).length;
    const avgPredictedProbability =
      bucketSnapshots.length > 0
        ? bucketSnapshots.reduce((sum, snapshot) => sum + (getPredictedProbability(snapshot) ?? 0), 0) /
          bucketSnapshots.length
        : null;

    return {
      label: range.label,
      samples: bucketSnapshots.length,
      hits,
      accuracyPct: bucketSnapshots.length ? round((hits / bucketSnapshots.length) * 100, 1) : null,
      avgPredictedProbabilityPct:
        avgPredictedProbability !== null ? round(avgPredictedProbability * 100, 1) : null,
    };
  });
}

function buildPerformanceMetrics(): SignalPerformanceMetrics {
  const resolvedWindowIds = new Set(
    listSignalWindows()
      .filter((window) => window.status === "resolved" && window.resolutionOutcome)
      .map((window) => window.id),
  );
  const resolvedSeries = getWindowSnapshotSeries().filter((entry) =>
    resolvedWindowIds.has(entry.windowId),
  );
  const openingSnapshots = resolvedSeries.map((entry) => entry.first);
  const latestSnapshots = resolvedSeries.map((entry) => entry.latest);
  const actionableSnapshots = openingSnapshots.filter(
    (snapshot) => snapshot.action !== "no_buy" && snapshot.buyPriceDollars !== null,
  );
  const openingHits = openingSnapshots.filter(
    (snapshot) => snapshot.resolutionOutcome === getPredictedDirection(snapshot),
  ).length;
  const finalHits = latestSnapshots.filter(
    (snapshot) => snapshot.resolutionOutcome === getPredictedDirection(snapshot),
  ).length;
  const actionableHits = actionableSnapshots.filter(
    (snapshot) => getOutcomeResult(snapshot) === "win",
  ).length;
  const noBuyWindows = openingSnapshots.filter((snapshot) => snapshot.action === "no_buy").length;
  const flipWindows = resolvedSeries.filter((entry) => hasDecisionFlip(entry.snapshots)).length;
  const totalSuggestedPnl = actionableSnapshots.reduce(
    (sum, snapshot) => sum + (getSuggestedPnl(snapshot) ?? 0),
    0,
  );
  const avgEdgeCents =
    actionableSnapshots.length > 0
      ? actionableSnapshots.reduce((sum, snapshot) => sum + ((snapshot.edgeDollars ?? 0) * 100), 0) /
        actionableSnapshots.length
      : null;

  return {
    resolvedWindows: resolvedWindowIds.size,
    openingSuggestionWindows: openingSnapshots.length,
    openingSuggestionAccuracyPct:
      openingSnapshots.length > 0 ? round((openingHits / openingSnapshots.length) * 100, 1) : null,
    openingActionableWindows: actionableSnapshots.length,
    openingActionableAccuracyPct:
      actionableSnapshots.length > 0 ? round((actionableHits / actionableSnapshots.length) * 100, 1) : null,
    finalSnapshotAccuracyPct:
      latestSnapshots.length > 0 ? round((finalHits / latestSnapshots.length) * 100, 1) : null,
    flipWindows,
    flipRatePct:
      resolvedSeries.length > 0 ? round((flipWindows / resolvedSeries.length) * 100, 1) : null,
    noBuyWindows,
    noBuyRatePct: openingSnapshots.length > 0 ? round((noBuyWindows / openingSnapshots.length) * 100, 1) : null,
    avgEdgeCents: avgEdgeCents !== null ? round(avgEdgeCents, 2) : null,
    totalSuggestedPnlDollars: round(totalSuggestedPnl, 2) ?? 0,
    avgSuggestedPnlDollars:
      actionableSnapshots.length > 0 ? round(totalSuggestedPnl / actionableSnapshots.length, 2) : null,
    calibration: buildCalibrationBuckets(openingSnapshots),
  };
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

  const resolvedWindow = await upsertSignalWindow({
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

  if (resolvedWindow.resolutionOutcome) {
    await updateResolvedSnapshotsForWindow({
      windowId: resolvedWindow.id,
      resolutionOutcome: resolvedWindow.resolutionOutcome,
      outcomeSource: "coinbase_proxy",
    }).catch(() => undefined);
  }

  return resolvedWindow;
}

async function resolveOverdueWindows() {
  const activeWindows = listSignalWindows().filter((window) => window.status === "active" && window.closeTime);

  for (const window of activeWindows) {
    await resolveWindowOutcome(window).catch(() => undefined);
  }
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

function hydrateMarketStrike(market: KalshiBtcWindowSnapshot, window: PersistedSignalWindow): KalshiBtcWindowSnapshot {
  return {
    ...market,
    strikePrice: market.strikePrice ?? window.strikePriceDollars,
  };
}

async function computeSnapshot() {
  await hydrateOnce();
  await resolveOverdueWindows();
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
      reversal: null,
      recommendation: null,
      execution: null,
      recentExecutions: listRecentExecutionStatuses(),
      explanation: {
        status: "fallback",
        model: null,
        summary: "No active BTC 15-minute Kalshi market is available right now.",
        conviction: [],
        caution: ["The app needs an active KXBTC15M market before it can score a trade."],
      },
      metrics: buildPerformanceMetrics(),
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
          reversal: null,
          recommendation: null,
          execution: market?.ticker ? toPublicExecutionStatus(getSignalExecutionByWindowTicker(market.ticker)) : null,
          recentExecutions: listRecentExecutionStatuses(),
          explanation: {
            status: "fallback",
            model: null,
            summary: "Coinbase data is not ready, so the engine cannot issue a reliable 15-minute recommendation.",
            conviction: [],
            caution: ["The live BTC feed returned too few candles for the model."],
          },
          metrics: buildPerformanceMetrics(),
          history: mapHistory(),
          warnings: [...warnings, "Coinbase returned too few candles for the live engine."],
        };
  }

  const fetchedMarket = await fetchKalshiWindowByTicker(market.ticker).catch(() => market);
  const latestMarket = hydrateMarketStrike(fetchedMarket, window);
  const { features } = buildBtcSignalFeatures({
    candles,
    market: latestMarket,
    now,
  });
  const reversal = buildReversalSignal({
    candles,
    features,
    market: latestMarket,
    riskLevel,
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
      reversal,
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
    reversal,
    recommendation,
    execution: toPublicExecutionStatus(getSignalExecutionByWindowTicker(latestMarket.ticker)),
    recentExecutions: listRecentExecutionStatuses(),
    explanation,
    metrics: buildPerformanceMetrics(),
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
