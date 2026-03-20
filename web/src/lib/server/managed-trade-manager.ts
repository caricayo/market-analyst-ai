import {
  fetchKalshiMarketByTicker,
  listKalshiFills,
  listKalshiPositions,
  submitKalshiOrder,
} from "@/lib/server/kalshi-client";
import {
  createManagedTrade,
  closeManagedTrade,
  hydrateManagedTradesFromPersistence,
  listOpenManagedTrades,
  patchManagedTrade,
} from "@/lib/server/managed-trade-store";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";
import type { ExitReason, LivePositionSnapshot, ManagedTrade } from "@/lib/trading-types";
import { getMinuteInWindow } from "@/lib/server/indicator-engine";

const managerState = globalThis as typeof globalThis & {
  __btcManagedTradeManagerStarted?: boolean;
  __btcManagedTradeManagerTimeout?: NodeJS.Timeout;
  __btcManagedTradeManagerRunning?: boolean;
};

function scheduleNextManagedTradeCycle(delayMs: number) {
  if (managerState.__btcManagedTradeManagerTimeout) {
    clearTimeout(managerState.__btcManagedTradeManagerTimeout);
  }

  managerState.__btcManagedTradeManagerTimeout = setTimeout(() => {
    void processManagedTrades();
  }, delayMs);
}

function roundMoney(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function roundPrice(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function buildBotClientOrderId(setupType: ManagedTrade["setupType"], action: "buy" | "sell") {
  return `btcbot-${setupType}-${action}-${crypto.randomUUID()}`;
}

function isHighRiskOpenMinute(minuteInWindow: number) {
  return minuteInWindow >= 1 && minuteInWindow <= 3;
}

function isOpenWindowTrade(trade: ManagedTrade) {
  return isHighRiskOpenMinute(getMinuteInWindow(new Date(trade.createdAt)));
}

function getManagedTradeSettings(
  setupType: ManagedTrade["setupType"],
  entryPriceDollars: number,
  closeTime: string | null,
  createdAt?: string | null,
) {
  const profitTargetCents =
    setupType === "trend"
      ? tradingConfig.trendProfitTargetCents
      : setupType === "reversal"
        ? tradingConfig.reversalProfitTargetCents
        : tradingConfig.scalpProfitTargetCents;
  const baseStopLossCents =
    setupType === "trend"
      ? tradingConfig.trendStopLossCents
      : setupType === "reversal"
        ? tradingConfig.reversalStopLossCents
        : tradingConfig.scalpStopLossCents;
  const minuteInWindow = createdAt ? getMinuteInWindow(new Date(createdAt)) : null;
  const stopLossCents =
    minuteInWindow !== null && isHighRiskOpenMinute(minuteInWindow)
      ? Math.min(baseStopLossCents, tradingConfig.openWindowStopLossCents)
      : baseStopLossCents;
  const forcedExitLeadSeconds =
    setupType === "trend"
      ? tradingConfig.trendForcedExitLeadSeconds
      : setupType === "reversal"
        ? tradingConfig.reversalForcedExitLeadSeconds
        : tradingConfig.scalpForcedExitLeadSeconds;

  return {
    targetPriceDollars: Math.min(0.99, roundPrice(entryPriceDollars + profitTargetCents / 100, 2) ?? 0.99),
    stopPriceDollars: Math.max(0.01, roundPrice(entryPriceDollars - stopLossCents / 100, 2) ?? 0.01),
    forcedExitAt: new Date(
      Math.max(
        Date.now(),
        Date.parse(closeTime ?? new Date().toISOString()) - forcedExitLeadSeconds * 1_000,
      ),
    ).toISOString(),
  };
}

function inferSetupTypeFromClientOrderId(clientOrderId: string | null, createdAt: string | null) {
  if (clientOrderId?.includes("-reversal-")) {
    return "reversal" as const;
  }

  if (clientOrderId?.includes("-scalp-")) {
    return "scalp" as const;
  }

  if (clientOrderId?.includes("-trend-")) {
    return "trend" as const;
  }

  if (createdAt) {
    const minuteInWindow = getMinuteInWindow(new Date(createdAt));
    if (minuteInWindow >= 9 && minuteInWindow <= 12) {
      return "reversal" as const;
    }
  }

  return "reversal" as const;
}

function clampPrice(value: number) {
  return Math.max(0.01, Math.min(0.99, roundPrice(value, 2) ?? value));
}

function getTrendStopState(trade: ManagedTrade, now: Date, peakPriceDollars: number) {
  const armThresholdPrice =
    trade.entryPriceDollars + tradingConfig.trendBreakevenTriggerCents / 100;
  const trailThresholdPrice =
    trade.entryPriceDollars + tradingConfig.trendTrailTriggerCents / 100;
  const elapsedMs = now.getTime() - Date.parse(trade.createdAt);
  const shouldArmByTime = elapsedMs >= tradingConfig.trendStopArmSeconds * 1_000;
  const shouldArmByProfit = peakPriceDollars >= armThresholdPrice;
  const stopArmedAt = trade.stopArmedAt ?? (shouldArmByTime || shouldArmByProfit ? now.toISOString() : null);

  let stopPriceDollars = trade.stopPriceDollars;
  if (peakPriceDollars >= armThresholdPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clampPrice(trade.entryPriceDollars + tradingConfig.trendBreakevenLockCents / 100),
    );
  }

  if (peakPriceDollars >= trailThresholdPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clampPrice(peakPriceDollars - tradingConfig.trendTrailOffsetCents / 100),
    );
  }

  return {
    stopArmedAt,
    stopPriceDollars: clampPrice(stopPriceDollars),
    stopActive: Boolean(stopArmedAt),
  };
}

function getScalpStopState(trade: ManagedTrade, now: Date, peakPriceDollars: number) {
  let stopPriceDollars = trade.stopPriceDollars;
  let stopArmedAt = trade.stopArmedAt ?? now.toISOString();
  const breakevenTriggerPrice =
    trade.entryPriceDollars + tradingConfig.scalpBreakevenTriggerCents / 100;
  const trailTriggerPrice =
    trade.entryPriceDollars + tradingConfig.scalpTrailTriggerCents / 100;

  if (peakPriceDollars >= breakevenTriggerPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clampPrice(trade.entryPriceDollars + tradingConfig.scalpBreakevenLockCents / 100),
    );
  }

  if (peakPriceDollars >= trailTriggerPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clampPrice(peakPriceDollars - tradingConfig.scalpTrailOffsetCents / 100),
    );
  }

  return {
    stopArmedAt,
    stopPriceDollars: clampPrice(stopPriceDollars),
    stopActive: true,
  };
}

function getTrackedContractsForTicker(ticker: string) {
  return listOpenManagedTrades()
    .filter((trade) => trade.marketTicker === ticker)
    .reduce((sum, trade) => sum + Math.max(0, trade.contracts), 0);
}

async function closeStaleManagedTrades(liveTickers: Set<string>) {
  for (const trade of listOpenManagedTrades()) {
    if (liveTickers.has(trade.marketTicker)) {
      continue;
    }

    await closeManagedTrade({
      id: trade.id,
      exitReason: trade.exitReason ?? "manual-sync",
      exitPriceDollars: trade.exitPriceDollars,
      realizedPnlDollars: trade.realizedPnlDollars ?? getRealizedPnl(trade, trade.exitPriceDollars),
      exitOrderId: trade.exitOrderId,
      exitClientOrderId: trade.exitClientOrderId,
    });
  }
}

async function recoverManagedTradesFromPositions(positions: Awaited<ReturnType<typeof listKalshiPositions>>) {
  const driftWarnings: string[] = [];

  for (const position of positions) {
    const liveContracts = Math.abs(position.contracts);
    if (liveContracts < 0.01) {
      continue;
    }

    const trackedContracts = getTrackedContractsForTicker(position.ticker);
    if (trackedContracts >= liveContracts - 0.01) {
      continue;
    }

    const missingContracts = Math.max(1, Math.round(liveContracts - trackedContracts));

    const fills = await listKalshiFills(position.ticker, 100).catch(() => []);
    const botBuyFills = fills
      .filter((fill) => fill.action === "buy" && fill.clientOrderId?.startsWith("btcbot-"))
      .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));

    const latestBotFill = botBuyFills[0];
    if (!latestBotFill) {
      driftWarnings.push(
        `Live position ${position.ticker} is open on Kalshi but no bot buy fill was available to rebuild managed exits.`,
      );
      continue;
    }

    const fillGroup = botBuyFills.filter((fill) =>
      latestBotFill.clientOrderId
        ? fill.clientOrderId === latestBotFill.clientOrderId
        : fill.orderId === latestBotFill.orderId,
    );
    const weightedContracts = fillGroup.reduce((sum, fill) => sum + Math.max(0, fill.contracts), 0);
    const weightedPrice =
      weightedContracts > 0
        ? fillGroup.reduce(
            (sum, fill) => sum + Math.max(0, fill.contracts) * (fill.priceDollars ?? 0),
            0,
          ) / weightedContracts
        : latestBotFill.priceDollars;
    const market = await fetchKalshiMarketByTicker(position.ticker).catch(() => null);
    const setupType = inferSetupTypeFromClientOrderId(latestBotFill.clientOrderId, latestBotFill.createdAt);
    const entryPriceDollars = roundPrice(weightedPrice, 2) ?? 0.5;
    const settings = getManagedTradeSettings(
      setupType,
      entryPriceDollars,
      market?.closeTime ?? null,
      latestBotFill.createdAt,
    );

    await createManagedTrade({
      marketTicker: position.ticker,
      marketTitle: market?.title ?? null,
      closeTime: market?.closeTime ?? null,
      setupType,
      entrySide: latestBotFill.side,
      entryOutcome: latestBotFill.side === (market?.mapping.aboveSide ?? "yes") ? "above" : "below",
      contracts: missingContracts,
      entryOrderId: latestBotFill.orderId,
      entryClientOrderId: latestBotFill.clientOrderId,
      entryPriceDollars,
      targetPriceDollars: settings.targetPriceDollars,
      stopPriceDollars: settings.stopPriceDollars,
      forcedExitAt: settings.forcedExitAt,
      status: "open",
      exitReason: null,
      exitOrderId: null,
      exitClientOrderId: null,
      exitPriceDollars: null,
      realizedPnlDollars: null,
      lastSeenBidDollars: null,
      peakPriceDollars: entryPriceDollars,
      lastCheckedAt: null,
      lastExitAttemptAt: null,
      stopArmedAt: null,
      errorMessage:
        trackedContracts > 0
          ? "Recovered additional live contracts for this ticker after local tracker drift."
          : "Recovered managed trade from live Kalshi fills after local tracker reset.",
    });
  }

  return driftWarnings;
}

export async function syncManagedTradesWithPositions() {
  await hydrateManagedTradesFromPersistence();
  const positions = await listKalshiPositions().catch(() => []);
  const openPositions = positions.filter((position) => Math.abs(position.contracts) >= 0.01);
  const liveTickers = new Set(openPositions.map((position) => position.ticker));

  await closeStaleManagedTrades(liveTickers);
  const driftWarnings = await recoverManagedTradesFromPositions(openPositions);
  const activeManagedTrades = listOpenManagedTrades();
  const livePositions: LivePositionSnapshot[] = openPositions.map((position) => {
    const trackedContracts = activeManagedTrades
      .filter((trade) => trade.marketTicker === position.ticker)
      .reduce((sum, trade) => sum + Math.max(0, trade.contracts), 0);

    return {
      ticker: position.ticker,
      contracts: Math.abs(position.contracts),
      realizedPnlDollars: position.realizedPnlDollars,
      trackedContracts,
      trackedByManagedTrade: trackedContracts >= Math.abs(position.contracts) - 0.01,
    };
  });

  return {
    activeManagedTrades,
    driftWarnings,
    livePositions,
  };
}

function getSideBidPrice(trade: ManagedTrade, yesBidPrice: number | null, noBidPrice: number | null) {
  return trade.entrySide === "yes" ? yesBidPrice : noBidPrice;
}

function getExitTrigger(
  trade: ManagedTrade,
  now: Date,
  bidPrice: number | null,
  stopActive = true,
): ExitReason | null {
  if (now.getTime() >= Date.parse(trade.forcedExitAt)) {
    return "time";
  }

  if (bidPrice === null) {
    return null;
  }

  if (bidPrice >= trade.targetPriceDollars) {
    return "target";
  }

  if (stopActive && bidPrice <= trade.stopPriceDollars) {
    return "stop";
  }

  return null;
}

function getManagedExitState(trade: ManagedTrade, now: Date, bidPrice: number | null) {
  const peakPriceDollars = Math.max(trade.peakPriceDollars ?? trade.entryPriceDollars, bidPrice ?? 0);

  if (trade.setupType === "scalp") {
    return {
      peakPriceDollars,
      ...getScalpStopState(trade, now, peakPriceDollars),
    };
  }

  if (trade.setupType !== "trend" || isOpenWindowTrade(trade)) {
    return {
      peakPriceDollars,
      stopPriceDollars: trade.stopPriceDollars,
      stopArmedAt: trade.stopArmedAt ?? now.toISOString(),
      stopActive: true,
    };
  }

  return {
    peakPriceDollars,
    ...getTrendStopState(trade, now, peakPriceDollars),
  };
}

function getRealizedPnl(trade: ManagedTrade, exitPriceDollars: number | null) {
  if (exitPriceDollars === null) {
    return null;
  }

  return roundMoney((exitPriceDollars - trade.entryPriceDollars) * trade.contracts);
}

async function processTrade(trade: ManagedTrade) {
  const positions = await listKalshiPositions(trade.marketTicker).catch(() => []);
  const matchingPosition = positions.find((position) => position.ticker === trade.marketTicker) ?? null;
  const liveContracts = Math.abs(matchingPosition?.contracts ?? 0);
  const now = new Date();

  if (liveContracts < 0.01) {
    await closeManagedTrade({
      id: trade.id,
      exitReason: trade.exitReason ?? "manual-sync",
      exitPriceDollars: trade.exitPriceDollars,
      realizedPnlDollars: trade.realizedPnlDollars ?? getRealizedPnl(trade, trade.exitPriceDollars),
      exitOrderId: trade.exitOrderId,
      exitClientOrderId: trade.exitClientOrderId,
    });
    return;
  }

  const closeTimeTs = trade.closeTime ? Date.parse(trade.closeTime) : Number.NaN;
  if (Number.isFinite(closeTimeTs) && now.getTime() >= closeTimeTs) {
    await closeManagedTrade({
      id: trade.id,
      status: "error",
      exitReason: "expired",
      exitPriceDollars: trade.exitPriceDollars,
      realizedPnlDollars: trade.realizedPnlDollars,
      errorMessage: "Market expired before the managed exit flattened the position.",
      exitOrderId: trade.exitOrderId,
      exitClientOrderId: trade.exitClientOrderId,
    });
    return;
  }

  const market = await fetchKalshiMarketByTicker(trade.marketTicker).catch(() => null);
  const bidPrice = market ? getSideBidPrice(trade, market.yesBidPrice, market.noBidPrice) : null;
  const exitState = getManagedExitState(trade, now, bidPrice);
  await patchManagedTrade(trade.id, {
    lastCheckedAt: now.toISOString(),
    lastSeenBidDollars: bidPrice,
    peakPriceDollars: exitState.peakPriceDollars,
    stopArmedAt: exitState.stopArmedAt,
    stopPriceDollars: exitState.stopPriceDollars,
  });

  const tradeWithDynamicStop: ManagedTrade = {
    ...trade,
    peakPriceDollars: exitState.peakPriceDollars,
    stopArmedAt: exitState.stopArmedAt,
    stopPriceDollars: exitState.stopPriceDollars,
  };
  const exitReason =
    trade.status === "exit-submitted"
      ? trade.exitReason ?? getExitTrigger(tradeWithDynamicStop, now, bidPrice, exitState.stopActive)
      : getExitTrigger(tradeWithDynamicStop, now, bidPrice, exitState.stopActive);
  if (!exitReason) {
    return;
  }

  if (
    trade.status === "exit-submitted" &&
    trade.lastExitAttemptAt &&
    now.getTime() - Date.parse(trade.lastExitAttemptAt) < Math.max(tradingConfig.scalpPollIntervalMs * 2, 10_000)
  ) {
    return;
  }

  if (bidPrice === null || bidPrice <= 0) {
    await patchManagedTrade(trade.id, {
      errorMessage: "Managed exit trigger fired but no usable bid price was available.",
      lastExitAttemptAt: now.toISOString(),
    });
    return;
  }

  const contractsToExit = Math.max(1, Math.min(trade.contracts, Math.round(liveContracts)));
  if (contractsToExit !== trade.contracts) {
    await patchManagedTrade(trade.id, {
      contracts: contractsToExit,
    });
  }

  const limitPriceCents = Math.max(1, Math.min(99, Math.round(bidPrice * 100)));
  const clientOrderId = buildBotClientOrderId(trade.setupType, "sell");

  try {
    const response = await submitKalshiOrder({
      action: "sell",
      ticker: trade.marketTicker,
      side: trade.entrySide,
      contracts: contractsToExit,
      limitPriceCents,
      clientOrderId,
      reduceOnly: true,
    });

    await patchManagedTrade(trade.id, {
      status: "exit-submitted",
      exitReason,
      exitOrderId: response.order?.order_id ?? null,
      exitClientOrderId: response.order?.client_order_id ?? clientOrderId,
      exitPriceDollars: limitPriceCents / 100,
      realizedPnlDollars: roundMoney((limitPriceCents / 100 - trade.entryPriceDollars) * contractsToExit),
      lastExitAttemptAt: now.toISOString(),
      errorMessage: null,
    });
  } catch (error) {
    await patchManagedTrade(trade.id, {
      lastExitAttemptAt: now.toISOString(),
      errorMessage: error instanceof Error ? error.message : "Managed exit submission failed.",
    });
  }
}

export async function processManagedTrades() {
  if (managerState.__btcManagedTradeManagerRunning) {
    return;
  }

  managerState.__btcManagedTradeManagerRunning = true;
  let hasExposure = false;
  try {
    const { activeManagedTrades, livePositions } = await syncManagedTradesWithPositions();
    const trades = activeManagedTrades;
    hasExposure = activeManagedTrades.length > 0 || livePositions.length > 0;
    for (const trade of trades) {
      await processTrade(trade);
    }
  } finally {
    managerState.__btcManagedTradeManagerRunning = false;
    scheduleNextManagedTradeCycle(
      hasExposure ? tradingConfig.scalpPollIntervalMs : tradingConfig.autoEntryPollIntervalMs,
    );
  }
}

export function ensureManagedTradeManagerStarted() {
  if (
    managerState.__btcManagedTradeManagerStarted ||
    !tradingConfig.autoTradeEnabled ||
    !hasKalshiTradingCredentials()
  ) {
    return;
  }

  managerState.__btcManagedTradeManagerStarted = true;
  scheduleNextManagedTradeCycle(0);
}
