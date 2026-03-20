import {
  fetchKalshiMarketByTicker,
  listKalshiPositions,
  submitKalshiOrder,
} from "@/lib/server/kalshi-client";
import {
  closeManagedTrade,
  listOpenManagedTrades,
  patchManagedTrade,
} from "@/lib/server/managed-trade-store";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";
import type { ExitReason, ManagedTrade } from "@/lib/trading-types";

const managerState = globalThis as typeof globalThis & {
  __btcManagedTradeManagerStarted?: boolean;
  __btcManagedTradeManagerInterval?: NodeJS.Timeout;
  __btcManagedTradeManagerRunning?: boolean;
};

function roundMoney(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function getSideBidPrice(trade: ManagedTrade, yesBidPrice: number | null, noBidPrice: number | null) {
  return trade.entrySide === "yes" ? yesBidPrice : noBidPrice;
}

function getExitTrigger(trade: ManagedTrade, now: Date, bidPrice: number | null): ExitReason | null {
  if (now.getTime() >= Date.parse(trade.forcedExitAt)) {
    return "time";
  }

  if (bidPrice === null) {
    return null;
  }

  if (bidPrice >= trade.targetPriceDollars) {
    return "target";
  }

  if (bidPrice <= trade.stopPriceDollars) {
    return "stop";
  }

  return null;
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
    closeManagedTrade({
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
    closeManagedTrade({
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
  patchManagedTrade(trade.id, {
    lastCheckedAt: now.toISOString(),
    lastSeenBidDollars: bidPrice,
  });

  const exitReason =
    trade.status === "exit-submitted"
      ? trade.exitReason ?? getExitTrigger(trade, now, bidPrice)
      : getExitTrigger(trade, now, bidPrice);
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
    patchManagedTrade(trade.id, {
      errorMessage: "Managed exit trigger fired but no usable bid price was available.",
      lastExitAttemptAt: now.toISOString(),
    });
    return;
  }

  const limitPriceCents = Math.max(1, Math.min(99, Math.round(bidPrice * 100)));
  const clientOrderId = crypto.randomUUID();

  try {
    const response = await submitKalshiOrder({
      action: "sell",
      ticker: trade.marketTicker,
      side: trade.entrySide,
      contracts: trade.contracts,
      limitPriceCents,
      clientOrderId,
      reduceOnly: true,
    });

    patchManagedTrade(trade.id, {
      status: "exit-submitted",
      exitReason,
      exitOrderId: response.order?.order_id ?? null,
      exitClientOrderId: response.order?.client_order_id ?? clientOrderId,
      exitPriceDollars: limitPriceCents / 100,
      realizedPnlDollars: getRealizedPnl(trade, limitPriceCents / 100),
      lastExitAttemptAt: now.toISOString(),
      errorMessage: null,
    });
  } catch (error) {
    patchManagedTrade(trade.id, {
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
  try {
    const trades = listOpenManagedTrades();
    for (const trade of trades) {
      await processTrade(trade);
    }
  } finally {
    managerState.__btcManagedTradeManagerRunning = false;
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
  managerState.__btcManagedTradeManagerInterval = setInterval(() => {
    void processManagedTrades();
  }, tradingConfig.scalpPollIntervalMs);
  void processManagedTrades();
}
