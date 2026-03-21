import { fetchCoinbaseCandles } from "@/lib/server/coinbase-client";
import {
  buildPredictiveChampionTradingDecision,
  buildTradingDecision,
} from "@/lib/server/decision-engine";
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
  getKalshiAvailableLiquidityForBuy,
  getKalshiBalance,
  submitKalshiOrder,
} from "@/lib/server/kalshi-client";
import {
  ensureManagedTradeManagerStarted,
  syncManagedTradesWithPositions,
} from "@/lib/server/managed-trade-manager";
import {
  createManagedTrade,
  listRecentClosedManagedTrades,
} from "@/lib/server/managed-trade-store";
import { getResearchSnapshot, recordResearchWindow, resolveResearchWindows } from "@/lib/server/policy-research";
import { buildTradeReviews } from "@/lib/server/trade-review";
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
    plannedContracts: null,
    maxCostDollars: null,
    plannedMaxCostDollars: null,
    orderId: null,
    clientOrderId: null,
    managedTradeId: null,
    entryPriceDollars: null,
    targetPriceDollars: null,
    stopPriceDollars: null,
    liquidityAvailableContracts: null,
    liquidityDepthLevels: null,
    attempts: [],
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

function parseFilledContracts(order: { fill_count_fp?: string | null; initial_count_fp?: string | null; remaining_count_fp?: string | null } | null | undefined) {
  const explicitFillCount = Number(order?.fill_count_fp ?? Number.NaN);
  if (Number.isFinite(explicitFillCount)) {
    return explicitFillCount;
  }

  const initialCount = Number(order?.initial_count_fp ?? Number.NaN);
  const remainingCount = Number(order?.remaining_count_fp ?? Number.NaN);
  if (Number.isFinite(initialCount) && Number.isFinite(remainingCount)) {
    return Math.max(0, initialCount - remainingCount);
  }

  return null;
}

function parseAverageFillPriceDollars(
  order: {
    yes_price_dollars?: string | null;
    no_price_dollars?: string | null;
    yes_price?: number | null;
    no_price?: number | null;
    taker_fill_cost_dollars?: string | null;
    maker_fill_cost_dollars?: string | null;
  } | null | undefined,
  side: "yes" | "no",
  fallbackPriceDollars: number,
  filledContracts: number,
) {
  const fillCostDollars = Number(order?.taker_fill_cost_dollars ?? order?.maker_fill_cost_dollars ?? Number.NaN);
  if (filledContracts > 0 && Number.isFinite(fillCostDollars)) {
    return fillCostDollars / filledContracts;
  }

  const directPrice =
    side === "yes"
      ? Number(order?.yes_price_dollars ?? order?.yes_price ?? Number.NaN)
      : Number(order?.no_price_dollars ?? order?.no_price ?? Number.NaN);

  return Number.isFinite(directPrice) && directPrice > 0 ? directPrice : fallbackPriceDollars;
}

function getEntryAttemptPriceCents(basePriceCents: number, attemptIndex: number) {
  const samePriceAttempts = Math.max(1, tradingConfig.entryRetrySamePriceAttempts);
  const repriceStepIndex = Math.max(0, attemptIndex - (samePriceAttempts - 1));
  return Math.max(1, Math.min(99, basePriceCents + repriceStepIndex * tradingConfig.entryRetryStepCents));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getManagedTradeSettings(
  _setupType: Exclude<SetupType, "none">,
  entryPriceDollars: number,
  closeTime: string | null,
  _minuteInWindow?: number | null,
) {
  const profitTargetCents = tradingConfig.scalpProfitTargetCents;
  const stopLossCents = tradingConfig.scalpStopLossCents;
  const forcedExitLeadSeconds = tradingConfig.scalpForcedExitLeadSeconds;

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

function getProfitRatioBlocker(
  entryPriceDollars: number,
  managedSettings: ReturnType<typeof getManagedTradeSettings>,
) {
  const rewardDollars = Math.max(0, managedSettings.targetPriceDollars - entryPriceDollars);
  const riskDollars = Math.max(0.0001, entryPriceDollars - managedSettings.stopPriceDollars);
  const profitRatio = rewardDollars / riskDollars;

  if (profitRatio + 0.0001 < tradingConfig.entryMinRewardRiskRatio) {
    return `Scalp entry skipped because the profit ratio is only ${profitRatio.toFixed(2)} to 1, below the required 1:${tradingConfig.entryMinRewardRiskRatio.toFixed(2)}.`;
  }

  return null;
}

async function maybeSubmitTrade(input: {
  executeTrade: boolean;
  market: NonNullable<BotStatusSnapshot["market"]> | null;
  decision: NonNullable<BotStatusSnapshot["decision"]>;
}) {
  if (tradingConfig.signalMonitorMode) {
    return buildExecutionDisabled("Signal monitor mode is enabled. No orders are ever sent.");
  }

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
      plannedContracts: null,
      maxCostDollars: null,
      plannedMaxCostDollars: null,
      orderId: null,
      clientOrderId: null,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      liquidityAvailableContracts: null,
      liquidityDepthLevels: null,
      attempts: [],
      message: "Trade skipped because the scalp confidence direction did not clear the live trigger threshold.",
    } satisfies TradeExecution;
  }

  const { side, price } = getLimitPrice(input.decision.derivedOutcome, input.market);
  if (!price || price <= 0) {
    return {
      status: "error",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: null,
      plannedContracts: null,
      maxCostDollars: null,
      plannedMaxCostDollars: null,
      orderId: null,
      clientOrderId: null,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      liquidityAvailableContracts: null,
      liquidityDepthLevels: null,
      attempts: [],
      message: "The active Kalshi market did not return a usable ask price for the selected side.",
    } satisfies TradeExecution;
  }

  const limitPriceCents = Math.max(1, Math.min(99, Math.round(price * 100)));
  const setupType = "scalp" as const;
  const baseClientOrderId = buildBotClientOrderId(setupType, "buy");
  const entryAttempts = Array.from({ length: tradingConfig.entryRetryAttempts }, (_, index) =>
    buildEntryAttempt(
      baseClientOrderId,
      getEntryAttemptPriceCents(limitPriceCents, index),
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
  const executionAttempts: TradeExecution["attempts"] = [];
  const [balance, exposure] = await Promise.all([
    getKalshiBalance(),
    syncManagedTradesWithPositions().catch(() => ({
      activeManagedTrades: [],
      driftWarnings: [],
      livePositions: [],
    })),
  ]);
  const hasLivePosition = exposure.livePositions.length > 0;
  const fundingHaltReason = getFundingHaltReason();
  const fundingHaltActive = isFundingHalted();

  if (hasLivePosition || exposure.activeManagedTrades.length > 0) {
    return {
      status: "skipped",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: null,
      plannedContracts: firstAttempt.contracts,
      maxCostDollars: firstAttempt.maxCostDollars,
      plannedMaxCostDollars: firstAttempt.maxCostDollars,
      orderId: null,
      clientOrderId: baseClientOrderId,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      liquidityAvailableContracts: null,
      liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
      attempts: executionAttempts,
      message: "Trade skipped because another position is still open. The bot will only re-enter after the account is flat.",
    } satisfies TradeExecution;
  }

  if (fundingHaltActive) {
    if (
      balance.availableBalanceDollars !== null &&
      firstAttempt.maxCostDollars !== null &&
      balance.availableBalanceDollars + 0.001 >= firstAttempt.maxCostDollars
    ) {
      clearFundingHalt();
    } else {
      return buildExecutionDisabled(
        `Funding halt active. ${fundingHaltReason ?? "Kalshi previously reported insufficient funds."}`,
      );
    }
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
      plannedContracts: firstAttempt.contracts,
      maxCostDollars: firstAttempt.maxCostDollars,
      plannedMaxCostDollars: firstAttempt.maxCostDollars,
      orderId: null,
      clientOrderId: baseClientOrderId,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      liquidityAvailableContracts: null,
      liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
      attempts: executionAttempts,
      message: "Bot halted before entry because available balance is below the required order cost. Refill the account, then manually resume once.",
    } satisfies TradeExecution;
  }

  const firstManagedSettings = getManagedTradeSettings(
    setupType,
    firstAttempt.limitPriceDollars,
    input.market.closeTime,
    getMinuteInWindow(),
  );
  const firstAttemptProfitRatioBlocker = getProfitRatioBlocker(
    firstAttempt.limitPriceDollars,
    firstManagedSettings,
  );
  if (firstAttemptProfitRatioBlocker) {
    return {
      status: "skipped",
      side,
      outcome: input.decision.derivedOutcome,
      contracts: firstAttempt.contracts,
      plannedContracts: firstAttempt.contracts,
      maxCostDollars: firstAttempt.maxCostDollars,
      plannedMaxCostDollars: firstAttempt.maxCostDollars,
      orderId: null,
      clientOrderId: baseClientOrderId,
      managedTradeId: null,
      entryPriceDollars: null,
      targetPriceDollars: null,
      stopPriceDollars: null,
      liquidityAvailableContracts: null,
      liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
      attempts: executionAttempts,
      message: firstAttemptProfitRatioBlocker,
    } satisfies TradeExecution;
  }

  let lastLiquidityMessage: string | null = null;

  for (let index = 0; index < entryAttempts.length; index += 1) {
    const baseAttempt = entryAttempts[index];
    let attempt = baseAttempt;
    let liquidityContracts: number | null = null;
    const managedSettings = getManagedTradeSettings(
      setupType,
      attempt.limitPriceDollars,
      input.market.closeTime,
      getMinuteInWindow(),
    );
    const profitRatioBlocker = getProfitRatioBlocker(
      attempt.limitPriceDollars,
      managedSettings,
    );
    if (profitRatioBlocker) {
      return {
        status: "skipped",
        side,
        outcome: input.decision.derivedOutcome,
        contracts: attempt.contracts,
        plannedContracts: attempt.contracts,
        maxCostDollars: attempt.maxCostDollars,
        plannedMaxCostDollars: attempt.maxCostDollars,
        orderId: null,
        clientOrderId: attempt.clientOrderId,
        managedTradeId: null,
        entryPriceDollars: null,
        targetPriceDollars: null,
        stopPriceDollars: null,
        liquidityAvailableContracts: null,
        liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
        attempts: executionAttempts,
        message: profitRatioBlocker,
      } satisfies TradeExecution;
    }

    try {
      const liquidity = await getKalshiAvailableLiquidityForBuy({
        ticker: input.market.ticker,
        side,
        limitPriceDollars: attempt.limitPriceDollars,
        depth: tradingConfig.entryLiquidityOrderbookDepth,
      });
      liquidityContracts =
        liquidity.availableContracts !== null ? Math.floor(liquidity.availableContracts) : null;
      if (liquidityContracts !== null) {
        if (liquidityContracts < 1) {
          lastLiquidityMessage =
            `No displayed orderbook depth was available to buy ${side.toUpperCase()} at ${attempt.limitPriceDollars.toFixed(2)}.`;
          executionAttempts.push({
            attemptNumber: index + 1,
            limitPriceDollars: attempt.limitPriceDollars,
            plannedContracts: baseAttempt.contracts,
            submittedContracts: 0,
            maxCostDollars: attempt.maxCostDollars,
            liquidityAvailableContracts: liquidityContracts,
            status: "liquidity-skip",
            message: lastLiquidityMessage,
          });
          if (index < entryAttempts.length - 1) {
            await sleep(tradingConfig.entryRetryDelayMs * (index + 1));
          }
          continue;
        }

        if (liquidityContracts < attempt.contracts) {
          attempt = {
            ...attempt,
            contracts: liquidityContracts,
            maxCostDollars: round(liquidityContracts * attempt.limitPriceDollars, 2),
          };
        }
      }
    } catch (error) {
      lastLiquidityMessage =
        error instanceof Error ? error.message : "Kalshi orderbook depth lookup failed.";
    }

    try {
      const response = await submitKalshiOrder({
        action: "buy",
        ticker: input.market.ticker,
        side,
        contracts: attempt.contracts,
        limitPriceCents: attempt.limitPriceCents,
        clientOrderId: attempt.clientOrderId,
        timeInForce: "immediate_or_cancel",
      });

      const filledContractsRaw = parseFilledContracts(response.order);
      const filledContracts =
        filledContractsRaw !== null ? Math.max(0, Math.floor(filledContractsRaw)) : attempt.contracts;
      if (filledContracts < 1) {
        lastLiquidityMessage =
          `IOC buy at ${attempt.limitPriceDollars.toFixed(2)} returned no fillable contracts.`;
        executionAttempts.push({
          attemptNumber: index + 1,
          limitPriceDollars: attempt.limitPriceDollars,
          plannedContracts: baseAttempt.contracts,
          submittedContracts: attempt.contracts,
          maxCostDollars: attempt.maxCostDollars,
          liquidityAvailableContracts: liquidityContracts,
          status: "zero-fill",
          message: lastLiquidityMessage,
        });
        if (index < entryAttempts.length - 1) {
          await sleep(tradingConfig.entryRetryDelayMs * (index + 1));
        }
        continue;
      }

      const entryPriceDollars =
        parseAverageFillPriceDollars(response.order, side, attempt.limitPriceDollars, filledContracts) ||
        attempt.limitPriceDollars;
      const managedSettings = getManagedTradeSettings(
        setupType,
        entryPriceDollars,
        input.market.closeTime,
        getMinuteInWindow(),
      );
      const managedTrade = await createManagedTrade({
        marketTicker: input.market.ticker,
        marketTitle: input.market.title,
        closeTime: input.market.closeTime,
        setupType,
        entrySide: side,
        entryOutcome: input.decision.derivedOutcome,
        contracts: filledContracts,
        entryOrderId: response.order?.order_id ?? null,
        entryClientOrderId: response.order?.client_order_id ?? attempt.clientOrderId,
        entryPriceDollars,
        targetPriceDollars: managedSettings.targetPriceDollars,
        stopPriceDollars: managedSettings.stopPriceDollars,
        entryTierDollars: null,
        targetTierDollars: null,
        stopTierDollars: null,
        confidenceBand: null,
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
        contracts: filledContracts,
        plannedContracts: baseAttempt.contracts,
        maxCostDollars: round(filledContracts * entryPriceDollars, 2),
        plannedMaxCostDollars: baseAttempt.maxCostDollars,
        orderId: response.order?.order_id ?? null,
        clientOrderId: response.order?.client_order_id ?? attempt.clientOrderId,
        managedTradeId: managedTrade?.id ?? null,
        entryPriceDollars,
        targetPriceDollars: managedTrade?.targetPriceDollars ?? null,
        stopPriceDollars: managedTrade?.stopPriceDollars ?? null,
        entryTierDollars: null,
        targetTierDollars: null,
        stopTierDollars: null,
        confidenceBand: null,
        liquidityAvailableContracts: liquidityContracts,
        liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
        attempts: [
          ...executionAttempts,
          {
            attemptNumber: index + 1,
            limitPriceDollars: attempt.limitPriceDollars,
            plannedContracts: baseAttempt.contracts,
            submittedContracts: filledContracts,
            maxCostDollars: round(filledContracts * entryPriceDollars, 2),
            liquidityAvailableContracts: liquidityContracts,
            status: "submitted",
            message:
              filledContracts < attempt.contracts
                ? `IOC filled ${filledContracts} of ${attempt.contracts} submitted contracts.`
                : `IOC filled ${filledContracts} contracts.`,
          },
        ],
        message:
          index === 0
            ? `Submitted ${filledContracts} contract${filledContracts === 1 ? "" : "s"} on ${side.toUpperCase()} via IOC and started adaptive scalp exits.`
            : `Submitted ${filledContracts} contract${filledContracts === 1 ? "" : "s"} on ${side.toUpperCase()} after ${index + 1} IOC ladder attempts and started adaptive scalp exits.`,
      } satisfies TradeExecution;
    } catch (error) {

      const message = error instanceof Error ? error.message : "Kalshi order submission failed.";
      if (isLiquidityErrorMessage(message)) {
        lastLiquidityMessage = message;
        if (index < entryAttempts.length - 1) {
          await sleep(tradingConfig.entryRetryDelayMs * (index + 1));
        }
        continue;
      }

      if (isFundingErrorMessage(message)) {
        haltFunding(`Kalshi rejected a buy order for insufficient funds. ${message}`);
        return {
          status: "disabled",
          side,
          outcome: input.decision.derivedOutcome,
          contracts: attempt.contracts,
          plannedContracts: baseAttempt.contracts,
          maxCostDollars: attempt.maxCostDollars,
          plannedMaxCostDollars: baseAttempt.maxCostDollars,
          orderId: null,
          clientOrderId: attempt.clientOrderId,
          managedTradeId: null,
          entryPriceDollars: null,
          targetPriceDollars: null,
          stopPriceDollars: null,
          liquidityAvailableContracts: liquidityContracts,
          liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
          attempts: [
            ...executionAttempts,
            {
              attemptNumber: index + 1,
              limitPriceDollars: attempt.limitPriceDollars,
              plannedContracts: baseAttempt.contracts,
              submittedContracts: attempt.contracts,
              maxCostDollars: attempt.maxCostDollars,
              liquidityAvailableContracts: liquidityContracts,
              status: "error",
              message: "Bot halted after Kalshi reported insufficient funding.",
            },
          ],
          message: "Bot halted after Kalshi reported insufficient funding. Refill the account, then manually resume once.",
        } satisfies TradeExecution;
      }

      executionAttempts.push({
        attemptNumber: index + 1,
        limitPriceDollars: attempt.limitPriceDollars,
        plannedContracts: baseAttempt.contracts,
        submittedContracts: attempt.contracts,
        maxCostDollars: attempt.maxCostDollars,
        liquidityAvailableContracts: liquidityContracts,
        status: "error",
        message,
      });
      return {
        status: "error",
        side,
        outcome: input.decision.derivedOutcome,
        contracts: attempt.contracts,
        plannedContracts: baseAttempt.contracts,
        maxCostDollars: attempt.maxCostDollars,
        plannedMaxCostDollars: baseAttempt.maxCostDollars,
        orderId: null,
        clientOrderId: attempt.clientOrderId,
        managedTradeId: null,
        entryPriceDollars: null,
        targetPriceDollars: null,
        stopPriceDollars: null,
        liquidityAvailableContracts: liquidityContracts,
        liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
        attempts: executionAttempts,
        message,
      } satisfies TradeExecution;
    }
  }

  return {
    status: "skipped",
    side,
    outcome: input.decision.derivedOutcome,
    contracts: firstAttempt.contracts,
    plannedContracts: firstAttempt.contracts,
    maxCostDollars: firstAttempt.maxCostDollars,
    plannedMaxCostDollars: firstAttempt.maxCostDollars,
    orderId: null,
    clientOrderId: baseClientOrderId,
    managedTradeId: null,
    entryPriceDollars: null,
    targetPriceDollars: null,
    stopPriceDollars: null,
    liquidityAvailableContracts: null,
    liquidityDepthLevels: tradingConfig.entryLiquidityOrderbookDepth,
    attempts: executionAttempts,
    message:
      entryAttempts.length > 1
        ? `Trade skipped after ${entryAttempts.length} IOC ladder attempts because there was not enough displayed liquidity to fill a valid sized entry.${lastLiquidityMessage ? ` ${lastLiquidityMessage}` : ""}`
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
  availableBalanceDollars: number | null;
  portfolioValueDollars: number | null;
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
    availableBalanceDollars: input.availableBalanceDollars,
    portfolioValueDollars: input.portfolioValueDollars,
    yesAskPrice: input.market?.yesAskPrice ?? null,
    noAskPrice: input.market?.noAskPrice ?? null,
    yesBidPrice: input.market?.yesBidPrice ?? null,
    noBidPrice: input.market?.noBidPrice ?? null,
    distanceToStrike: input.indicators?.distanceToStrike ?? null,
    atr14: input.indicators?.atr14 ?? null,
    rsi14: input.indicators?.rsi14 ?? null,
    momentum5: input.indicators?.momentum5 ?? null,
    momentum15: input.indicators?.momentum15 ?? null,
    deterministicEdge: input.indicators?.deterministicEdge ?? null,
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
  if (!tradingConfig.signalMonitorMode) {
    ensureManagedTradeManagerStarted();
  }
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
  const [decision, predictiveDecision] = await Promise.all([
    buildTradingDecision({
      market,
      indicators,
      minuteInWindow,
      timingRisk,
      warnings,
    }),
    buildPredictiveChampionTradingDecision({
      market,
      indicators,
      minuteInWindow,
      timingRisk,
      warnings,
    }),
  ]);

  const execution = await maybeSubmitTrade({
    executeTrade: Boolean(options?.executeTrade),
    market,
    decision,
  });

  await recordResearchWindow({
    market,
    indicators,
    minuteInWindow,
    timingRisk,
    recordPolicyEvaluations: tradingConfig.researchEnabled,
  }).catch(() => undefined);

  if (tradingConfig.researchEnabled) {
    await resolveResearchWindows().catch(() => undefined);
  }
  const research = tradingConfig.researchEnabled
    ? await getResearchSnapshot().catch(() => null)
    : null;
  const recentTradeReviews = buildTradeReviews(listRecentClosedManagedTrades());

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
        availableBalanceDollars: balance.availableBalanceDollars,
        portfolioValueDollars: balance.portfolioValueDollars,
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
    autoEntryEnabled: false,
    fundingHalted: false,
    fundingHaltReason: null,
    market,
    indicators,
    decision,
    predictiveDecision,
    tradingEnabled: false,
    warnings,
    livePositions: exposure.livePositions,
    activeManagedTrades: exposure.activeManagedTrades,
    recentTradeReviews,
    log: listTradingLog(),
    research,
  } satisfies BotStatusSnapshot;
}

export async function runTradingBotExecution(source: ExecutionSource) {
  if (tradingConfig.signalMonitorMode) {
    return getTradingBotSnapshot({
      executeTrade: false,
      source,
      logRun: false,
      allowFundingResume: false,
    });
  }

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
