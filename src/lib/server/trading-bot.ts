import { fetchCoinbaseCandles } from "@/lib/server/coinbase-client";
import { buildTradingDecision } from "@/lib/server/decision-engine";
import { buildIndicatorSnapshot, classifyTimingRisk, getMinuteInWindow } from "@/lib/server/indicator-engine";
import { discoverActiveBtcMarket, submitKalshiOrder } from "@/lib/server/kalshi-client";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";
import { appendTradingLog, listTradingLog } from "@/lib/server/trading-log";
import type { BotLogEntry, BotStatusSnapshot, TradeExecution } from "@/lib/trading-types";

function formatWindowLabel(date: Date, timeZone: string) {
  return date.toLocaleString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function round(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(decimals));
}

function getLimitPrice(outcome: "above" | "below", market: NonNullable<BotStatusSnapshot["market"]>) {
  const side = outcome === "above" ? market.mapping.aboveSide : market.mapping.belowSide;
  const price = side === "yes" ? market.yesAskPrice : market.noAskPrice;
  return { side, price };
}

function buildExecutionDisabled(message: string): TradeExecution {
  return {
    status: "disabled",
    side: null,
    outcome: null,
    contracts: null,
    maxCostDollars: null,
    orderId: null,
    clientOrderId: null,
    message,
  };
}

async function maybeSubmitTrade(input: {
  executeTrade: boolean;
  market: NonNullable<BotStatusSnapshot["market"]> | null;
  decision: NonNullable<BotStatusSnapshot["decision"]>;
}) {
  if (!input.executeTrade) {
    return buildExecutionDisabled("Analysis completed. No order was requested.");
  }

  if (!tradingConfig.autoTradeEnabled) {
    return buildExecutionDisabled("Auto-trading is disabled by `KALSHI_ENABLE_AUTO_TRADE`.");
  }

  if (!hasKalshiTradingCredentials()) {
    return buildExecutionDisabled("Kalshi trading credentials are incomplete, so execution is disabled.");
  }

  if (!input.market || !input.decision.shouldTrade || !input.decision.derivedOutcome) {
    return {
      status: "skipped",
      side: input.decision.derivedSide,
      outcome: input.decision.derivedOutcome,
      contracts: null,
      maxCostDollars: null,
      orderId: null,
      clientOrderId: null,
      message: "Trade skipped because the signal did not pass execution gates.",
    } satisfies TradeExecution;
  }

  const { side, price } = getLimitPrice(input.decision.derivedOutcome, input.market);
  if (!price || price <= 0) {
    return {
      status: "error",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: null,
      maxCostDollars: null,
      orderId: null,
      clientOrderId: null,
      message: "The active Kalshi market did not return a usable ask price for the selected side.",
    } satisfies TradeExecution;
  }

  const limitPriceCents = Math.max(1, Math.round(price * 100));
  const limitPriceDollars = limitPriceCents / 100;
  const contracts = Math.max(1, Math.floor(tradingConfig.stakeDollars / limitPriceDollars));
  const maxCostDollars = round(contracts * limitPriceDollars, 2);
  const clientOrderId = crypto.randomUUID();

  try {
    const response = await submitKalshiOrder({
      ticker: input.market.ticker,
      side,
      contracts,
      limitPriceCents,
      clientOrderId,
    });

    return {
      status: "submitted",
      side,
      outcome: input.decision.derivedOutcome,
      contracts,
      maxCostDollars,
      orderId: response.order?.order_id ?? null,
      clientOrderId: response.order?.client_order_id ?? clientOrderId,
      message: `Submitted ${contracts} contract${contracts === 1 ? "" : "s"} on ${side.toUpperCase()}.`,
    } satisfies TradeExecution;
  } catch (error) {
    return {
      status: "error",
      side,
      outcome: input.decision.derivedOutcome,
      contracts,
      maxCostDollars,
      orderId: null,
      clientOrderId,
      message: error instanceof Error ? error.message : "Kalshi order submission failed.",
    } satisfies TradeExecution;
  }
}

function buildLogEntry(input: {
  market: BotStatusSnapshot["market"];
  minuteInWindow: number;
  decision: NonNullable<BotStatusSnapshot["decision"]>;
  indicators: BotStatusSnapshot["indicators"];
  execution: TradeExecution;
}): BotLogEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    marketTicker: input.market?.ticker ?? null,
    marketTitle: input.market?.title ?? null,
    strikePrice: input.market?.strikePrice ?? null,
    closeTime: input.market?.closeTime ?? null,
    minuteInWindow: input.minuteInWindow,
    timingRisk: input.decision.timingRisk,
    currentPrice: input.indicators?.currentPrice ?? null,
    confidence: input.decision.confidence,
    call: input.decision.call,
    summary: input.decision.summary,
    reasoning: input.decision.reasoning,
    blockers: input.decision.blockers,
    execution: input.execution,
  };
}

export async function getTradingBotSnapshot(options?: { executeTrade?: boolean }) {
  const warnings: string[] = [];
  const now = new Date();
  const minuteInWindow = getMinuteInWindow(now);
  const timingRisk = classifyTimingRisk(minuteInWindow);

  const [market, candles] = await Promise.all([discoverActiveBtcMarket(now), fetchCoinbaseCandles()]);
  if (!market) {
    warnings.push("No active BTC 15-minute Kalshi market was discovered.");
  }
  if (!hasKalshiTradingCredentials()) {
    warnings.push("Kalshi trading credentials are not fully configured; analysis works but execution is disabled.");
  }

  const indicators = buildIndicatorSnapshot(candles, market?.strikePrice ?? null);
  const decision = await buildTradingDecision({
    market,
    indicators,
    minuteInWindow,
    timingRisk,
    warnings,
  });

  const execution = await maybeSubmitTrade({
    executeTrade: Boolean(options?.executeTrade),
    market,
    decision,
  });

  if (options?.executeTrade) {
    appendTradingLog(
      buildLogEntry({
        market,
        minuteInWindow,
        decision,
        indicators,
        execution,
      }),
    );
  }

  return {
    generatedAt: now.toISOString(),
    timeZone: tradingConfig.timeZone,
    currentWindowLabel: formatWindowLabel(now, tradingConfig.timeZone),
    minuteInWindow,
    timingRisk,
    stakeDollars: tradingConfig.stakeDollars,
    confidenceThreshold: tradingConfig.confidenceThreshold,
    market,
    indicators,
    decision,
    tradingEnabled: tradingConfig.autoTradeEnabled && hasKalshiTradingCredentials(),
    warnings,
    log: listTradingLog(),
  } satisfies BotStatusSnapshot;
}
