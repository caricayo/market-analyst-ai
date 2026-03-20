import { fetchCoinbaseCandles } from "@/lib/server/coinbase-client";
import { buildTradingDecision } from "@/lib/server/decision-engine";
import {
  clearFundingHalt,
  getFundingHaltReason,
  getLastExecutionAt,
  haltFunding,
  isFundingHalted,
  setLastExecutionAt,
} from "@/lib/server/execution-state";
import { buildIndicatorSnapshot, classifyTimingRisk, getMinuteInWindow } from "@/lib/server/indicator-engine";
import {
  discoverActiveBtcMarket,
  getKalshiBalance,
  submitKalshiOrder,
} from "@/lib/server/kalshi-client";
import {
  ensureManagedTradeManagerStarted,
  syncManagedTradesWithPositions,
} from "@/lib/server/managed-trade-manager";
import { createManagedTrade } from "@/lib/server/managed-trade-store";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";
import { appendTradingLog, listTradingLog } from "@/lib/server/trading-log";
import type { BotLogEntry, BotStatusSnapshot, SetupType, TradeExecution } from "@/lib/trading-types";

type ExecutionSource = "manual" | "auto";

type SnapshotOptions = {
  executeTrade?: boolean;
  source?: ExecutionSource;
  logRun?: boolean;
  allowFundingResume?: boolean;
};

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

function isFundingErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (isLiquidityErrorMessage(normalized)) {
    return false;
  }

  return [
    "available balance",
    "insufficient balance",
    "insufficient buying power",
    "insufficient funds",
    "not enough balance",
    "not enough funds",
    "out of funds",
    "out of funding",
    "account balance",
  ].some((term) => normalized.includes(term));
}

function isLiquidityErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return [
    "fill_or_kill_insufficient_resting_volume",
    "immediate_or_cancel_insufficient_resting_volume",
    "insufficient resting volume",
    "resting volume",
    "insufficient liquidity",
    "no resting volume",
  ].some((term) => normalized.includes(term));
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
    managedTradeId: null,
    entryPriceDollars: null,
    targetPriceDollars: null,
    stopPriceDollars: null,
    message,
  };
}

function buildBotClientOrderId(setupType: Exclude<SetupType, "none">, action: "buy" | "sell") {
  return `btcbot-${setupType}-${action}-${crypto.randomUUID()}`;
}

function buildEntryAttempt(baseClientOrderId: string, limitPriceCents: number, attemptIndex: number) {
  const limitPriceDollars = limitPriceCents / 100;
  const maxContracts = Math.max(1, Math.floor(tradingConfig.stakeDollars / limitPriceDollars));
  const contracts = Math.max(
    1,
    Math.min(
      maxContracts,
      Math.floor(maxContracts * Math.pow(tradingConfig.entryRetrySizeDecay, attemptIndex)),
    ),
  );
  const maxCostDollars = round(contracts * limitPriceDollars, 2);
  return {
    clientOrderId: `${baseClientOrderId}-p${limitPriceCents}`,
    limitPriceCents,
    limitPriceDollars,
    contracts,
    maxCostDollars,
  };
}

function getMaxEntryPriceCents(setupType: Exclude<SetupType, "none">) {
  switch (setupType) {
    case "reversal":
      return tradingConfig.reversalMaxEntryPriceCents;
    case "scalp":
      return tradingConfig.scalpMaxEntryPriceCents;
    default:
      return tradingConfig.trendMaxEntryPriceCents;
  }
}

function getManagedTradeSettings(setupType: Exclude<SetupType, "none">, entryPriceDollars: number, closeTime: string | null) {
  const profitTargetCents =
    setupType === "trend"
      ? tradingConfig.trendProfitTargetCents
      : setupType === "reversal"
        ? tradingConfig.reversalProfitTargetCents
        : tradingConfig.scalpProfitTargetCents;
  const stopLossCents =
    setupType === "trend"
      ? tradingConfig.trendStopLossCents
      : setupType === "reversal"
        ? tradingConfig.reversalStopLossCents
        : tradingConfig.scalpStopLossCents;
  const forcedExitLeadSeconds =
    setupType === "trend"
      ? tradingConfig.trendForcedExitLeadSeconds
      : setupType === "reversal"
        ? tradingConfig.reversalForcedExitLeadSeconds
        : tradingConfig.scalpForcedExitLeadSeconds;

  return {
    targetPriceDollars: Math.min(0.99, round(entryPriceDollars + profitTargetCents / 100, 2) ?? 0.99),
    stopPriceDollars: Math.max(0.01, round(entryPriceDollars - stopLossCents / 100, 2) ?? 0.01),
    forcedExitAt: new Date(
      Math.max(
        Date.now(),
        Date.parse(closeTime ?? new Date().toISOString()) - forcedExitLeadSeconds * 1_000,
      ),
    ).toISOString(),
  };
}

function getEntryPriceQualityBlocker(
  setupType: Exclude<SetupType, "none">,
  entryPriceDollars: number,
  managedSettings: ReturnType<typeof getManagedTradeSettings>,
) {
  const maxEntryPriceDollars = getMaxEntryPriceCents(setupType) / 100;
  if (entryPriceDollars > maxEntryPriceDollars) {
    return `${setupType} entry skipped because ${entryPriceDollars.toFixed(2)} exceeds the max entry price of ${maxEntryPriceDollars.toFixed(2)}.`;
  }

  const rewardDollars = Math.max(0, managedSettings.targetPriceDollars - entryPriceDollars);
  const riskDollars = Math.max(0.01, entryPriceDollars - managedSettings.stopPriceDollars);
  const remainingUpsideDollars = Math.max(0, 0.99 - entryPriceDollars);
  const minUpsideRequired = rewardDollars + tradingConfig.entryMinUpsideBufferCents / 100;

  if (remainingUpsideDollars + 0.0001 < minUpsideRequired) {
    return `${setupType} entry skipped because only ${remainingUpsideDollars.toFixed(2)} of upside remains to 0.99, below the required ${minUpsideRequired.toFixed(2)}.`;
  }

  if (rewardDollars / riskDollars < tradingConfig.entryMinRewardRiskRatio) {
    return `${setupType} entry skipped because the reward/risk ratio is ${(rewardDollars / riskDollars).toFixed(2)}, below the required ${tradingConfig.entryMinRewardRiskRatio.toFixed(2)}.`;
  }

  return null;
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

  if (isFundingHalted()) {
    const reason = getFundingHaltReason() ?? "Funding halt is active.";
    return buildExecutionDisabled(`Funding halt active. ${reason}`);
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
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
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
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      message: "The active Kalshi market did not return a usable ask price for the selected side.",
    } satisfies TradeExecution;
  }

  const limitPriceCents = Math.max(1, Math.min(99, Math.round(price * 100)));
  const setupType = input.decision.setupType === "none" ? "trend" : input.decision.setupType;
  const baseClientOrderId = buildBotClientOrderId(setupType, "buy");
  const entryAttempts = Array.from({ length: tradingConfig.entryRetryAttempts }, (_, index) =>
    buildEntryAttempt(
      baseClientOrderId,
      Math.max(1, Math.min(99, limitPriceCents + index * tradingConfig.entryRetryStepCents)),
      index,
    ),
  ).filter(
    (attempt, index, attempts) =>
      attempts.findIndex(
        (candidate) =>
          candidate.limitPriceCents === attempt.limitPriceCents &&
          candidate.contracts === attempt.contracts,
      ) === index,
  );
  const firstAttempt = entryAttempts[0];
  const [balance, exposure] = await Promise.all([
    getKalshiBalance(),
    syncManagedTradesWithPositions().catch(() => ({
      activeManagedTrades: [],
      driftWarnings: [],
      livePositions: [],
    })),
  ]);
  const hasLivePosition = exposure.livePositions.length > 0;

  if (hasLivePosition || exposure.activeManagedTrades.length > 0) {
    return {
      status: "skipped",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: null,
      maxCostDollars: firstAttempt.maxCostDollars,
      orderId: null,
      clientOrderId: baseClientOrderId,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      message: "Trade skipped because another position is still open. The bot will only re-enter after the account is flat.",
    } satisfies TradeExecution;
  }

  if (
    balance.availableBalanceDollars !== null &&
    firstAttempt.maxCostDollars !== null &&
    balance.availableBalanceDollars + 0.001 < firstAttempt.maxCostDollars
  ) {
    haltFunding(
      `Kalshi balance pre-check failed. Available balance ${balance.availableBalanceDollars.toFixed(2)} is below required max cost ${firstAttempt.maxCostDollars.toFixed(2)}.`,
    );
    return {
      status: "disabled",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: firstAttempt.contracts,
      maxCostDollars: firstAttempt.maxCostDollars,
      orderId: null,
      clientOrderId: baseClientOrderId,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      message: "Bot halted before entry because available balance is below the required order cost. Refill the account, then manually resume once.",
    } satisfies TradeExecution;
  }

  const firstManagedSettings = getManagedTradeSettings(
    setupType,
    firstAttempt.limitPriceDollars,
    input.market.closeTime,
  );
  const firstAttemptPriceBlocker = getEntryPriceQualityBlocker(
    setupType,
    firstAttempt.limitPriceDollars,
    firstManagedSettings,
  );
  if (firstAttemptPriceBlocker) {
    return {
      status: "skipped",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: firstAttempt.contracts,
      maxCostDollars: firstAttempt.maxCostDollars,
      orderId: null,
      clientOrderId: baseClientOrderId,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      message: firstAttemptPriceBlocker,
    } satisfies TradeExecution;
  }

  let lastLiquidityMessage: string | null = null;

  for (let index = 0; index < entryAttempts.length; index += 1) {
    const attempt = entryAttempts[index];
    const managedSettings = getManagedTradeSettings(setupType, attempt.limitPriceDollars, input.market.closeTime);
    const entryPriceBlocker = getEntryPriceQualityBlocker(
      setupType,
      attempt.limitPriceDollars,
      managedSettings,
    );
    if (entryPriceBlocker) {
      return {
        status: "skipped",
        side,
        outcome: input.decision.derivedOutcome,
        contracts: attempt.contracts,
        maxCostDollars: attempt.maxCostDollars,
        orderId: null,
        clientOrderId: attempt.clientOrderId,
        managedTradeId: null,
        entryPriceDollars: null,
        targetPriceDollars: null,
        stopPriceDollars: null,
        message: entryPriceBlocker,
      } satisfies TradeExecution;
    }

    try {
      const response = await submitKalshiOrder({
        action: "buy",
        ticker: input.market.ticker,
        side,
        contracts: attempt.contracts,
        limitPriceCents: attempt.limitPriceCents,
        clientOrderId: attempt.clientOrderId,
      });

      const entryPriceDollars =
        (side === "yes"
          ? Number(response.order?.yes_price_dollars ?? response.order?.yes_price)
          : Number(response.order?.no_price_dollars ?? response.order?.no_price)) || attempt.limitPriceDollars;
      const managedSettings = getManagedTradeSettings(setupType, entryPriceDollars, input.market.closeTime);
      const managedTrade = await createManagedTrade({
        marketTicker: input.market.ticker,
        marketTitle: input.market.title,
        closeTime: input.market.closeTime,
        setupType,
        entrySide: side,
        entryOutcome: input.decision.derivedOutcome,
        contracts: attempt.contracts,
        entryOrderId: response.order?.order_id ?? null,
        entryClientOrderId: response.order?.client_order_id ?? attempt.clientOrderId,
        entryPriceDollars,
        targetPriceDollars: managedSettings.targetPriceDollars,
        stopPriceDollars: managedSettings.stopPriceDollars,
        forcedExitAt: managedSettings.forcedExitAt,
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
        errorMessage: null,
      });

      return {
        status: "submitted",
        side,
        outcome: input.decision.derivedOutcome,
        contracts: attempt.contracts,
        maxCostDollars: attempt.maxCostDollars,
        orderId: response.order?.order_id ?? null,
        clientOrderId: response.order?.client_order_id ?? attempt.clientOrderId,
        managedTradeId: managedTrade?.id ?? null,
        entryPriceDollars,
        targetPriceDollars: managedTrade?.targetPriceDollars ?? null,
        stopPriceDollars: managedTrade?.stopPriceDollars ?? null,
        message:
          index === 0
            ? `Submitted ${attempt.contracts} contract${attempt.contracts === 1 ? "" : "s"} on ${side.toUpperCase()} and started managed ${setupType} exits.`
            : `Submitted ${attempt.contracts} contract${attempt.contracts === 1 ? "" : "s"} on ${side.toUpperCase()} after ${index + 1} ladder attempts and started managed ${setupType} exits.`,
      } satisfies TradeExecution;
    } catch (error) {

      const message = error instanceof Error ? error.message : "Kalshi order submission failed.";
      if (isLiquidityErrorMessage(message)) {
        lastLiquidityMessage = message;
        continue;
      }

      if (isFundingErrorMessage(message)) {
        haltFunding(`Kalshi rejected a buy order for insufficient funds. ${message}`);
        return {
          status: "disabled",
          side,
          outcome: input.decision.derivedOutcome,
          contracts: attempt.contracts,
          maxCostDollars: attempt.maxCostDollars,
          orderId: null,
          clientOrderId: attempt.clientOrderId,
          managedTradeId: null,
          entryPriceDollars: null,
          targetPriceDollars: null,
          stopPriceDollars: null,
          message: "Bot halted after Kalshi reported insufficient funding. Refill the account, then manually resume once.",
        } satisfies TradeExecution;
      }

      return {
        status: "error",
        side,
        outcome: input.decision.derivedOutcome,
        contracts: attempt.contracts,
        maxCostDollars: attempt.maxCostDollars,
        orderId: null,
        clientOrderId: attempt.clientOrderId,
        managedTradeId: null,
        entryPriceDollars: null,
        targetPriceDollars: null,
        stopPriceDollars: null,
        message,
      } satisfies TradeExecution;
    }
  }

  return {
    status: "skipped",
    side,
    outcome: input.decision.derivedOutcome,
    contracts: firstAttempt.contracts,
    maxCostDollars: firstAttempt.maxCostDollars,
    orderId: null,
    clientOrderId: baseClientOrderId,
    managedTradeId: null,
    entryPriceDollars: null,
    targetPriceDollars: null,
    stopPriceDollars: null,
    message:
      entryAttempts.length > 1
        ? `Trade skipped after ${entryAttempts.length} entry ladder attempts because there was not enough resting liquidity to fill even the reduced size ladder.`
        : `Trade skipped because there was not enough resting liquidity to fill the full order at the quoted price.${lastLiquidityMessage ? ` ${lastLiquidityMessage}` : ""}`,
  } satisfies TradeExecution;
}

function buildLogEntry(input: {
  source: ExecutionSource;
  market: BotStatusSnapshot["market"];
  minuteInWindow: number;
  decision: NonNullable<BotStatusSnapshot["decision"]>;
  indicators: BotStatusSnapshot["indicators"];
  execution: TradeExecution;
}): BotLogEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: input.source,
    marketTicker: input.market?.ticker ?? null,
    marketTitle: input.market?.title ?? null,
    strikePrice: input.market?.strikePrice ?? null,
    closeTime: input.market?.closeTime ?? null,
    minuteInWindow: input.minuteInWindow,
    timingRisk: input.decision.timingRisk,
    currentPrice: input.indicators?.currentPrice ?? null,
    confidence: input.decision.confidence,
    deterministicConfidence: input.decision.deterministicConfidence,
    call: input.decision.call,
    setupType: input.decision.setupType,
    candidateSide: input.decision.candidateSide,
    summary: input.decision.summary,
    reasoning: input.decision.reasoning,
    gateReasons: input.decision.gateReasons,
    aiVetoed: input.decision.aiVetoed,
    blockers: input.decision.blockers,
    execution: input.execution,
  };
}

function shouldAppendLog(
  source: ExecutionSource,
  execution: TradeExecution,
  explicitLogRun: boolean,
  shouldTrade: boolean,
) {
  if (explicitLogRun || source === "manual") {
    return true;
  }

  return (
    execution.status === "submitted" ||
    execution.status === "error" ||
    (execution.status === "skipped" && shouldTrade) ||
    (execution.status === "disabled" &&
      execution.message.toLowerCase().startsWith("bot halted after kalshi reported insufficient funding"))
  );
}

export async function getTradingBotSnapshot(options?: SnapshotOptions) {
  ensureManagedTradeManagerStarted();
  const warnings: string[] = [];
  const now = new Date();
  const minuteInWindow = getMinuteInWindow(now);
  const timingRisk = classifyTimingRisk(minuteInWindow);
  const source = options?.source ?? "manual";

  if (options?.allowFundingResume && isFundingHalted()) {
    clearFundingHalt();
  }

  if (isFundingHalted() && isLiquidityErrorMessage(getFundingHaltReason() ?? "")) {
    clearFundingHalt();
  }

  const [marketResult, candles, balance, exposure] = await Promise.all([
    discoverActiveBtcMarket(now).catch((error) => {
      warnings.push(
        error instanceof Error
          ? `Kalshi discovery warning: ${error.message}`
          : "Kalshi discovery warning: market lookup failed.",
      );
      return null;
    }),
    fetchCoinbaseCandles(),
    getKalshiBalance().catch(() => ({
      availableBalanceDollars: null,
      portfolioValueDollars: null,
      updatedAtUnix: null,
    })),
    syncManagedTradesWithPositions().catch(() => ({
      activeManagedTrades: [],
      driftWarnings: ["Live position sync warning: unable to reconcile managed trades with Kalshi positions."],
      livePositions: [],
    })),
  ]);
  const market = marketResult;
  if (!market) {
    warnings.push("No active BTC 15-minute Kalshi market was discovered.");
  }
  if (!hasKalshiTradingCredentials()) {
    warnings.push("Kalshi trading credentials are not fully configured; analysis works but execution is disabled.");
  }
  if (isFundingHalted()) {
    warnings.push(`Bot auto-entry halted for funding: ${getFundingHaltReason() ?? "insufficient funds reported by Kalshi."}`);
  }
  warnings.push(...exposure.driftWarnings);
  if (exposure.livePositions.length > 0 && exposure.activeManagedTrades.length === 0) {
    warnings.push("Live Kalshi exposure exists, but the managed exit tracker is still rebuilding from exchange state.");
  }
  if (exposure.livePositions.some((position) => !position.trackedByManagedTrade)) {
    warnings.push("One or more live positions are not fully tracked by local managed-trade state yet.");
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

  if (
    options?.executeTrade &&
    shouldAppendLog(source, execution, Boolean(options?.logRun), decision.shouldTrade)
  ) {
    appendTradingLog(
      buildLogEntry({
        source,
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
    availableBalanceDollars: balance.availableBalanceDollars,
    portfolioValueDollars: balance.portfolioValueDollars,
    confidenceThreshold: tradingConfig.confidenceThreshold,
    autoEntryEnabled: tradingConfig.autoEntryEnabled,
    fundingHalted: isFundingHalted(),
    fundingHaltReason: getFundingHaltReason(),
    market,
    indicators,
    decision,
    tradingEnabled:
      tradingConfig.autoTradeEnabled &&
      hasKalshiTradingCredentials() &&
      !isFundingHalted(),
    warnings,
    livePositions: exposure.livePositions,
    activeManagedTrades: exposure.activeManagedTrades,
    log: listTradingLog(),
  } satisfies BotStatusSnapshot;
}

export async function runTradingBotExecution(source: ExecutionSource) {
  const now = Date.now();
  const lastExecutionAt = getLastExecutionAt();
  if (now - lastExecutionAt < 5_000) {
    throw new Error("Trading is rate-limited for 5 seconds to reduce duplicate order submissions.");
  }

  setLastExecutionAt(now);
  return getTradingBotSnapshot({
    executeTrade: true,
    source,
    logRun: source === "manual",
    allowFundingResume: source === "manual",
  });
}
