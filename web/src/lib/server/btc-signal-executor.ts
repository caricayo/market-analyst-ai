import { getBtc15mSignalSnapshot } from "@/lib/server/btc-signal-service";
import { fetchKalshiWindowByTicker } from "@/lib/server/btc-kalshi-client";
import {
  getSignalExecutionControlState,
  hydrateSignalExecutionControl,
  setSignalExecutionControlState,
} from "@/lib/server/btc-signal-control-store";
import {
  getSignalExecutionByWindowTicker,
  hydrateSignalExecutions,
  listSignalExecutions,
  upsertSignalExecution,
} from "@/lib/server/btc-signal-execution-store";
import { listSignalWindows } from "@/lib/server/btc-signal-store";
import { signalConfig } from "@/lib/server/signal-config";
import {
  cancelKalshiOrder,
  getKalshiBalance,
  getKalshiOrder,
  submitKalshiOrder,
} from "@/lib/server/kalshi-client";
import { hasKalshiTradingCredentials, tradingConfig } from "@/lib/server/trading-config";
import type { PersistedSignalExecution, SignalAction } from "@/lib/signal-types";

const executorState = globalThis as typeof globalThis & {
  __btcSignalExecutorStarted?: boolean;
  __btcSignalExecutorTimer?: NodeJS.Timeout;
  __btcSignalExecutorRunning?: boolean;
  __btcSignalExecutorHydrated?: boolean;
};

type ExecutionProgress = {
  totalSubmittedContracts: number;
  totalFilledContracts: number;
  totalSpentDollars: number;
  weightedFillCostDollars: number;
  makerFilledContracts: number;
  lastKnownAsk: number;
  lastOrderId: string | null;
  lastClientOrderId: string | null;
  submittedAt: string | null;
  makerPlacedAt: string | null;
  makerCanceledAt: string | null;
  fallbackStartedAt: string | null;
  restingOrderId: string | null;
  restingClientOrderId: string | null;
  restingPriceDollars: number | null;
};

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDollarApprox(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatMoneyApprox(value: number | null) {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}

function isInsufficientFundsMessage(message: string | null | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("insufficient") ||
    normalized.includes("out of funds") ||
    normalized.includes("available balance is below")
  );
}

function buildClientOrderId(windowTicker: string, side: "yes" | "no") {
  const compactTicker = windowTicker.replace(/[^A-Za-z0-9]/g, "").slice(-12);
  const compactUuid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `bsig-${compactTicker}-${side[0]}-${compactUuid}`;
}

function getSideAskPrice(
  market: Awaited<ReturnType<typeof fetchKalshiWindowByTicker>> | null | undefined,
  side: "yes" | "no",
) {
  return side === "yes" ? market?.yesAskPrice ?? null : market?.noAskPrice ?? null;
}

function getSideBidPrice(
  market: Awaited<ReturnType<typeof fetchKalshiWindowByTicker>> | null | undefined,
  side: "yes" | "no",
) {
  return side === "yes" ? market?.yesBidPrice ?? null : market?.noBidPrice ?? null;
}

function parseFilledContracts(order: {
  fill_count_fp?: string | null;
  initial_count_fp?: string | null;
  remaining_count_fp?: string | null;
} | null | undefined) {
  const explicitFillCount = Number(order?.fill_count_fp ?? Number.NaN);
  if (Number.isFinite(explicitFillCount)) return Math.max(0, Math.floor(explicitFillCount));
  const initialCount = Number(order?.initial_count_fp ?? Number.NaN);
  const remainingCount = Number(order?.remaining_count_fp ?? Number.NaN);
  if (Number.isFinite(initialCount) && Number.isFinite(remainingCount)) {
    return Math.max(0, Math.floor(initialCount - remainingCount));
  }
  return null;
}

function parseRemainingContracts(order: { remaining_count_fp?: string | null } | null | undefined) {
  const remainingCount = Number(order?.remaining_count_fp ?? Number.NaN);
  return Number.isFinite(remainingCount) ? Math.max(0, Math.floor(remainingCount)) : null;
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
  if (filledContracts > 0 && Number.isFinite(fillCostDollars)) return fillCostDollars / filledContracts;
  const directPrice =
    side === "yes"
      ? Number(order?.yes_price_dollars ?? order?.yes_price ?? Number.NaN)
      : Number(order?.no_price_dollars ?? order?.no_price ?? Number.NaN);
  return Number.isFinite(directPrice) && directPrice > 0 ? directPrice : fallbackPriceDollars;
}

function getExecutionSize(entryPriceDollars: number, targetSpendDollars = signalConfig.executionStakeDollars, minimumContracts = 1) {
  if (!Number.isFinite(entryPriceDollars) || entryPriceDollars <= 0 || !Number.isFinite(targetSpendDollars)) {
    return { submittedContracts: 0, maxCostDollars: 0 };
  }
  const affordableContracts = Math.floor(targetSpendDollars / entryPriceDollars);
  const submittedContracts = Math.max(minimumContracts, affordableContracts);
  return { submittedContracts, maxCostDollars: round(submittedContracts * entryPriceDollars, 2) };
}

function getRemainingBudget(targetSpendDollars: number, spentDollars: number) {
  return Math.max(0, Number((targetSpendDollars - spentDollars).toFixed(4)));
}

function getAverageEntryPrice(progress: ExecutionProgress) {
  return progress.totalFilledContracts > 0
    ? round(progress.weightedFillCostDollars / progress.totalFilledContracts, 4)
    : null;
}

function getMakerRestingPrice(
  market: Awaited<ReturnType<typeof fetchKalshiWindowByTicker>> | null | undefined,
  side: "yes" | "no",
) {
  const ask = getSideAskPrice(market, side);
  const bid = getSideBidPrice(market, side);
  let restingPrice: number | null = null;
  if (bid !== null) restingPrice = bid + 0.01;
  else if (ask !== null) restingPrice = ask - 0.01;
  if (restingPrice === null) return null;
  if (ask !== null && restingPrice >= ask) restingPrice = ask - 0.01;
  restingPrice = Number(restingPrice.toFixed(4));
  return Number.isFinite(restingPrice) && restingPrice >= 0.01 && restingPrice <= 0.99 ? restingPrice : null;
}

function getOrderStatus(order: { status?: string | null } | null | undefined) {
  return (order?.status ?? "").toLowerCase();
}

function updateProgressWithFill(progress: ExecutionProgress, fillContracts: number, fillPriceDollars: number, source: "maker" | "taker") {
  if (fillContracts < 1 || !Number.isFinite(fillPriceDollars) || fillPriceDollars <= 0) return progress;
  return {
    ...progress,
    totalFilledContracts: progress.totalFilledContracts + fillContracts,
    totalSpentDollars: progress.totalSpentDollars + fillContracts * fillPriceDollars,
    weightedFillCostDollars: progress.weightedFillCostDollars + fillContracts * fillPriceDollars,
    makerFilledContracts: source === "maker" ? progress.makerFilledContracts + fillContracts : progress.makerFilledContracts,
  };
}

function getPersistableExecution(execution: PersistedSignalExecution, updates: Partial<PersistedSignalExecution>) {
  return {
    id: execution.id,
    windowId: updates.windowId ?? execution.windowId,
    windowTicker: updates.windowTicker ?? execution.windowTicker,
    status: updates.status ?? execution.status,
    entryMode: updates.entryMode ?? execution.entryMode,
    lockedAction: updates.lockedAction ?? execution.lockedAction,
    lockedSide: updates.lockedSide ?? execution.lockedSide,
    decisionSnapshotId: updates.decisionSnapshotId === undefined ? execution.decisionSnapshotId : updates.decisionSnapshotId,
    decisionObservedAt: updates.decisionObservedAt === undefined ? execution.decisionObservedAt : updates.decisionObservedAt,
    submittedAt: updates.submittedAt === undefined ? execution.submittedAt : updates.submittedAt,
    entryPriceDollars: updates.entryPriceDollars === undefined ? execution.entryPriceDollars : updates.entryPriceDollars,
    submittedContracts: updates.submittedContracts === undefined ? execution.submittedContracts : updates.submittedContracts,
    filledContracts: updates.filledContracts === undefined ? execution.filledContracts : updates.filledContracts,
    maxCostDollars: updates.maxCostDollars === undefined ? execution.maxCostDollars : updates.maxCostDollars,
    orderId: updates.orderId === undefined ? execution.orderId : updates.orderId,
    clientOrderId: updates.clientOrderId === undefined ? execution.clientOrderId : updates.clientOrderId,
    restingOrderId: updates.restingOrderId === undefined ? execution.restingOrderId : updates.restingOrderId,
    restingClientOrderId: updates.restingClientOrderId === undefined ? execution.restingClientOrderId : updates.restingClientOrderId,
    restingPriceDollars: updates.restingPriceDollars === undefined ? execution.restingPriceDollars : updates.restingPriceDollars,
    makerPlacedAt: updates.makerPlacedAt === undefined ? execution.makerPlacedAt : updates.makerPlacedAt,
    makerCanceledAt: updates.makerCanceledAt === undefined ? execution.makerCanceledAt : updates.makerCanceledAt,
    makerFilledContracts: updates.makerFilledContracts === undefined ? execution.makerFilledContracts : updates.makerFilledContracts,
    fallbackStartedAt: updates.fallbackStartedAt === undefined ? execution.fallbackStartedAt : updates.fallbackStartedAt,
    message: updates.message === undefined ? execution.message : updates.message,
    resolutionOutcome: updates.resolutionOutcome === undefined ? execution.resolutionOutcome : updates.resolutionOutcome,
    realizedPnlDollars: updates.realizedPnlDollars === undefined ? execution.realizedPnlDollars : updates.realizedPnlDollars,
  };
}

async function persistExecution(execution: PersistedSignalExecution, updates: Partial<PersistedSignalExecution>) {
  return upsertSignalExecution(getPersistableExecution(execution, updates));
}

async function submitIocAttempt(input: {
  windowTicker: string;
  side: "yes" | "no";
  entryPriceDollars: number;
  targetSpendDollars?: number;
  minimumContracts?: number;
}) {
  const { submittedContracts, maxCostDollars } = getExecutionSize(input.entryPriceDollars, input.targetSpendDollars, input.minimumContracts);
  if (submittedContracts < 1) {
    return { submittedContracts: 0, filledContracts: 0, maxCostDollars: 0, entryPriceDollars: input.entryPriceDollars, orderId: null, clientOrderId: null };
  }
  const clientOrderId = buildClientOrderId(input.windowTicker, input.side);
  const response = await submitKalshiOrder({
    action: "buy",
    ticker: input.windowTicker,
    side: input.side,
    contracts: submittedContracts,
    limitPriceCents: Math.max(1, Math.min(99, Math.round(input.entryPriceDollars * 100))),
    clientOrderId,
    timeInForce: "immediate_or_cancel",
  });
  const filledContracts = Math.max(0, parseFilledContracts(response.order) ?? submittedContracts);
  const averageFillPrice = round(
    parseAverageFillPriceDollars(response.order, input.side, input.entryPriceDollars, Math.max(1, filledContracts)),
    4,
  );
  return {
    submittedContracts,
    filledContracts,
    maxCostDollars,
    entryPriceDollars: filledContracts > 0 ? averageFillPrice : input.entryPriceDollars,
    orderId: response.order?.order_id ?? null,
    clientOrderId: response.order?.client_order_id ?? clientOrderId,
  };
}

async function hydrateOnce() {
  if (executorState.__btcSignalExecutorHydrated) return;
  executorState.__btcSignalExecutorHydrated = true;
  await Promise.all([
    hydrateSignalExecutions().catch(() => undefined),
    hydrateSignalExecutionControl().catch(() => undefined),
  ]);
}

async function reconcileExecutionOutcomes() {
  const windowsByTicker = new Map(listSignalWindows().map((window) => [window.marketTicker, window]));
  for (const execution of listSignalExecutions()) {
    if (execution.resolutionOutcome || execution.status === "skipped_no_signal" || execution.status === "resolved") continue;
    const window = windowsByTicker.get(execution.windowTicker);
    if (!window?.resolutionOutcome) continue;

    if (execution.status === "waiting") {
      await persistExecution(execution, {
        status: "skipped_no_signal",
        message: "Window settled before the advisory station produced an actionable buy signal.",
        resolutionOutcome: window.resolutionOutcome,
        realizedPnlDollars: 0,
      });
      continue;
    }

    if (["submitted", "partial_fill", "maker_resting", "maker_partial"].includes(execution.status)) {
      if (execution.filledContracts > 0) {
        const win =
          (execution.lockedAction === "buy_yes" && window.resolutionOutcome === "above") ||
          (execution.lockedAction === "buy_no" && window.resolutionOutcome === "below");
        const perContract = win ? 1 - (execution.entryPriceDollars ?? 0) : -(execution.entryPriceDollars ?? 0);
        await persistExecution(execution, {
          status: "resolved",
          message: win ? "Held to settlement and finished in the money." : "Held to settlement and finished out of the money.",
          resolutionOutcome: window.resolutionOutcome,
          realizedPnlDollars: round(perContract * execution.filledContracts, 2) ?? 0,
          restingOrderId: null,
          restingClientOrderId: null,
          restingPriceDollars: null,
        });
      } else {
        await persistExecution(execution, {
          status: "unfilled",
          message: "The maker-first entry never filled before the window settled.",
          resolutionOutcome: window.resolutionOutcome,
          realizedPnlDollars: 0,
          restingOrderId: null,
          restingClientOrderId: null,
          restingPriceDollars: null,
        });
      }
      continue;
    }

    if (execution.status === "unfilled" || execution.status === "error") {
      await persistExecution(execution, {
        resolutionOutcome: window.resolutionOutcome,
        realizedPnlDollars: 0,
      });
    }
  }
}

async function createWaitingExecution(snapshot: Awaited<ReturnType<typeof getBtc15mSignalSnapshot>>) {
  if (!snapshot.window.id || !snapshot.window.market?.ticker) return null;
  const existing = getSignalExecutionByWindowTicker(snapshot.window.market.ticker);
  if (existing) return existing;
  return upsertSignalExecution({
    windowId: snapshot.window.id,
    windowTicker: snapshot.window.market.ticker,
    status: "waiting",
    entryMode: null,
    lockedAction: null,
    lockedSide: null,
    decisionSnapshotId: null,
    decisionObservedAt: null,
    submittedAt: null,
    entryPriceDollars: null,
    submittedContracts: 0,
    filledContracts: 0,
    maxCostDollars: null,
    orderId: null,
    clientOrderId: null,
    restingOrderId: null,
    restingClientOrderId: null,
    restingPriceDollars: null,
    makerPlacedAt: null,
    makerCanceledAt: null,
    makerFilledContracts: 0,
    fallbackStartedAt: null,
    message: "Waiting for the first actionable Buy YES or Buy NO signal in this window.",
    resolutionOutcome: null,
    realizedPnlDollars: null,
  });
}

async function stopForInsufficientFunds(execution: PersistedSignalExecution, message: string) {
  await setSignalExecutionControlState({
    mode: "stopped",
    reason: "insufficient_funds",
    message: "Auto-execution stopped after an out-of-funds response. Add funds, then press Go.",
  });
  await persistExecution(execution, { status: "error", message });
}

async function runTakerFallback(input: {
  execution: PersistedSignalExecution;
  windowTicker: string;
  side: "yes" | "no";
  progress: ExecutionProgress;
  targetSpendDollars: number;
  retryDeadline: number;
}) {
  let execution = input.execution;
  let progress: ExecutionProgress = {
    ...input.progress,
    fallbackStartedAt: input.progress.fallbackStartedAt ?? new Date().toISOString(),
    restingOrderId: null,
    restingClientOrderId: null,
    restingPriceDollars: null,
  };
  let attemptCount = 0;
  let terminalError: string | null = null;

  execution = await persistExecution(execution, {
    entryMode: "taker_fallback",
    fallbackStartedAt: progress.fallbackStartedAt,
    restingOrderId: null,
    restingClientOrderId: null,
    restingPriceDollars: null,
    makerCanceledAt: progress.makerCanceledAt ?? new Date().toISOString(),
    makerFilledContracts: progress.makerFilledContracts,
    submittedAt: progress.submittedAt,
    entryPriceDollars: getAverageEntryPrice(progress),
    submittedContracts: progress.totalSubmittedContracts,
    filledContracts: progress.totalFilledContracts,
    message:
      progress.totalFilledContracts > 0
        ? `Maker phase partially filled ${progress.totalFilledContracts} contracts. Falling back to taker for the remainder.`
        : "Maker phase timed out. Falling back to taker entry for the locked side.",
  });

  while (Date.now() < input.retryDeadline) {
    const remainingBudgetDollars = getRemainingBudget(input.targetSpendDollars, progress.totalSpentDollars);
    const minimumContracts = progress.totalFilledContracts > 0 ? 0 : 1;
    const sizing = getExecutionSize(progress.lastKnownAsk, remainingBudgetDollars, minimumContracts);
    if (sizing.submittedContracts < 1) break;

    try {
      const attempt = await submitIocAttempt({
        windowTicker: input.windowTicker,
        side: input.side,
        entryPriceDollars: progress.lastKnownAsk,
        targetSpendDollars: remainingBudgetDollars,
        minimumContracts,
      });

      attemptCount += 1;
      progress.totalSubmittedContracts += attempt.submittedContracts;
      progress.lastOrderId = attempt.orderId ?? progress.lastOrderId;
      progress.lastClientOrderId = attempt.clientOrderId ?? progress.lastClientOrderId;
      progress.submittedAt = progress.submittedAt ?? new Date().toISOString();

      if (attempt.filledContracts > 0) {
        progress = updateProgressWithFill(progress, attempt.filledContracts, attempt.entryPriceDollars ?? progress.lastKnownAsk, "taker");
      }
    } catch (error) {
      terminalError = error instanceof Error ? error.message : "Signal execution order failed.";
      if (isInsufficientFundsMessage(terminalError)) {
        await stopForInsufficientFunds(execution, `The taker fallback could not complete because funds were insufficient. ${terminalError}`);
        return { execution, progress, terminalError, stoppedForFunds: true, attemptCount };
      }
      break;
    }

    const refreshedRemainingBudget = getRemainingBudget(input.targetSpendDollars, progress.totalSpentDollars);
    if (refreshedRemainingBudget <= 0) break;
    if (Date.now() + signalConfig.executionMakerPollMs >= input.retryDeadline) break;

    await sleep(signalConfig.executionMakerPollMs);
    const refreshedMarket = await fetchKalshiWindowByTicker(input.windowTicker).catch(() => null);
    const refreshedAsk = getSideAskPrice(refreshedMarket, input.side);
    const closeTime = refreshedMarket?.closeTime ?? refreshedMarket?.expirationTime ?? null;
    const closesAt = closeTime ? Date.parse(closeTime) : Number.NaN;

    if (Number.isFinite(closesAt) && closesAt <= Date.now()) break;
    if ((refreshedMarket?.status ?? "").toLowerCase() === "closed") break;
    if (refreshedAsk !== null && refreshedAsk > 0) progress.lastKnownAsk = refreshedAsk;
  }

  return { execution, progress, terminalError, stoppedForFunds: false, attemptCount };
}

async function runMakerFirstEntry(input: { snapshot: Awaited<ReturnType<typeof getBtc15mSignalSnapshot>>; execution: PersistedSignalExecution; }) {
  const { snapshot } = input;
  let execution = input.execution;
  const action = snapshot.recommendation?.action as Exclude<SignalAction, "no_buy">;
  const side = snapshot.recommendation?.contractSide;
  if (!side || !snapshot.window.market?.ticker || !snapshot.window.id) return;

  let market = await fetchKalshiWindowByTicker(snapshot.window.market.ticker).catch(() => snapshot.window.market);
  const targetSpendDollars = signalConfig.executionStakeDollars;
  const retryDeadline = Date.now() + Math.max(0, snapshot.window.secondsToClose * 1_000);
  const makerDeadline = Math.min(retryDeadline, Date.now() + Math.max(0, signalConfig.executionMakerWindowSeconds * 1_000));
  const lastKnownAsk = getSideAskPrice(market, side) ?? snapshot.recommendation?.buyPriceDollars ?? 0;
  const preCheckPrice = lastKnownAsk > 0 ? lastKnownAsk : snapshot.recommendation?.buyPriceDollars ?? 0;
  const preCheckSizing = getExecutionSize(preCheckPrice, targetSpendDollars, 1);
  const balance = await getKalshiBalance().catch(() => null);

  if (
    balance?.availableBalanceDollars !== null &&
    balance?.availableBalanceDollars !== undefined &&
    preCheckSizing.maxCostDollars !== null &&
    balance.availableBalanceDollars + 0.001 < preCheckSizing.maxCostDollars
  ) {
    await setSignalExecutionControlState({
      mode: "stopped",
      reason: "insufficient_funds",
      message: "Auto-execution stopped after an out-of-funds check. Add funds, then press Go.",
    });
    await persistExecution(execution, {
      status: "error",
      entryMode: "maker_first",
      lockedAction: action,
      lockedSide: side,
      decisionObservedAt: snapshot.generatedAt,
      entryPriceDollars: preCheckPrice,
      submittedContracts: preCheckSizing.submittedContracts,
      maxCostDollars: preCheckSizing.maxCostDollars,
      message: "Available balance is below the required max order cost for this signal window.",
    });
    return;
  }

  let progress: ExecutionProgress = {
    totalSubmittedContracts: 0,
    totalFilledContracts: 0,
    totalSpentDollars: 0,
    weightedFillCostDollars: 0,
    makerFilledContracts: 0,
    lastKnownAsk,
    lastOrderId: null,
    lastClientOrderId: null,
    submittedAt: null,
    makerPlacedAt: null,
    makerCanceledAt: null,
    fallbackStartedAt: null,
    restingOrderId: null,
    restingClientOrderId: null,
    restingPriceDollars: null,
  };
  let currentRestingFilledContracts = 0;
  let terminalMessage: string | null = null;

  execution = await persistExecution(execution, {
    status: "maker_resting",
    entryMode: "maker_first",
    lockedAction: action,
    lockedSide: side,
    decisionObservedAt: snapshot.generatedAt,
    maxCostDollars: round(targetSpendDollars, 2),
    message: "First actionable signal locked the window. Working a maker-first resting order.",
  });

  while (Date.now() < makerDeadline && Date.now() < retryDeadline) {
    const liveSnapshot = await getBtc15mSignalSnapshot().catch(() => null);
    if (liveSnapshot?.window.market?.ticker !== execution.windowTicker) break;

    market = await fetchKalshiWindowByTicker(execution.windowTicker).catch(() => market);
    const refreshedAsk = getSideAskPrice(market, side);
    if (refreshedAsk !== null && refreshedAsk > 0) progress.lastKnownAsk = refreshedAsk;

    const remainingBudgetDollars = getRemainingBudget(targetSpendDollars, progress.totalSpentDollars);
    if (remainingBudgetDollars <= 0) break;
    const desiredPrice = getMakerRestingPrice(market, side);
    const minimumContracts = progress.totalFilledContracts > 0 ? 0 : 1;
    const sizing = desiredPrice !== null ? getExecutionSize(desiredPrice, remainingBudgetDollars, minimumContracts) : { submittedContracts: 0, maxCostDollars: 0 };

    if (progress.restingOrderId) {
      try {
        const order = await getKalshiOrder(progress.restingOrderId);
        const totalOrderFillCount = parseFilledContracts(order.order) ?? currentRestingFilledContracts;
        const deltaFilledContracts = Math.max(0, totalOrderFillCount - currentRestingFilledContracts);
        if (deltaFilledContracts > 0) {
          const fillPrice = parseAverageFillPriceDollars(order.order, side, progress.restingPriceDollars ?? progress.lastKnownAsk, Math.max(1, totalOrderFillCount));
          progress = updateProgressWithFill(progress, deltaFilledContracts, fillPrice, "maker");
          currentRestingFilledContracts = totalOrderFillCount;
        }

        const remainingContracts = parseRemainingContracts(order.order);
        const status = getOrderStatus(order.order);
        const priceMoved = desiredPrice !== null && progress.restingPriceDollars !== null &&
          Math.abs(Math.round((desiredPrice - progress.restingPriceDollars) * 100)) >= signalConfig.executionMakerRepriceCents;

        if (remainingContracts !== null && remainingContracts < 1) {
          progress.restingOrderId = null;
          progress.restingClientOrderId = null;
          progress.restingPriceDollars = null;
          currentRestingFilledContracts = 0;
        } else if (priceMoved && status === "resting") {
          const restingOrderId = progress.restingOrderId;
          if (restingOrderId) {
            await cancelKalshiOrder(restingOrderId).catch(() => undefined);
          }
          progress.makerCanceledAt = new Date().toISOString();
          progress.restingOrderId = null;
          progress.restingClientOrderId = null;
          progress.restingPriceDollars = null;
          currentRestingFilledContracts = 0;
        } else if (status && status !== "resting" && status !== "partially_filled") {
          progress.restingOrderId = null;
          progress.restingClientOrderId = null;
          progress.restingPriceDollars = null;
          currentRestingFilledContracts = 0;
        }
      } catch (error) {
        terminalMessage = error instanceof Error ? error.message : "Unable to refresh the resting order.";
        if (isInsufficientFundsMessage(terminalMessage)) {
          await stopForInsufficientFunds(execution, terminalMessage);
          return;
        }
      }
    }

    if (!progress.restingOrderId && desiredPrice !== null && sizing.submittedContracts > 0) {
      try {
        const response = await submitKalshiOrder({
          action: "buy",
          ticker: execution.windowTicker,
          side,
          contracts: sizing.submittedContracts,
          limitPriceCents: Math.max(1, Math.min(99, Math.round(desiredPrice * 100))),
          clientOrderId: buildClientOrderId(execution.windowTicker, side),
          timeInForce: "good_till_canceled",
          postOnly: true,
        });

        progress.totalSubmittedContracts += sizing.submittedContracts;
        progress.submittedAt = progress.submittedAt ?? new Date().toISOString();
        progress.makerPlacedAt = progress.makerPlacedAt ?? progress.submittedAt;
        progress.lastOrderId = response.order?.order_id ?? progress.lastOrderId;
        progress.lastClientOrderId = response.order?.client_order_id ?? progress.lastClientOrderId;
        progress.restingOrderId = response.order?.order_id ?? null;
        progress.restingClientOrderId = response.order?.client_order_id ?? null;
        progress.restingPriceDollars = desiredPrice;
        currentRestingFilledContracts = parseFilledContracts(response.order) ?? 0;

        if (currentRestingFilledContracts > 0) {
          const fillPrice = parseAverageFillPriceDollars(response.order, side, desiredPrice, currentRestingFilledContracts);
          progress = updateProgressWithFill(progress, currentRestingFilledContracts, fillPrice, "maker");
        }

        execution = await persistExecution(execution, {
          status: progress.totalFilledContracts > 0 ? "maker_partial" : "maker_resting",
          entryMode: "maker_first",
          orderId: progress.lastOrderId,
          clientOrderId: progress.lastClientOrderId,
          restingOrderId: progress.restingOrderId,
          restingClientOrderId: progress.restingClientOrderId,
          restingPriceDollars: progress.restingPriceDollars,
          makerPlacedAt: progress.makerPlacedAt,
          makerCanceledAt: progress.makerCanceledAt,
          makerFilledContracts: progress.makerFilledContracts,
          submittedAt: progress.submittedAt,
          entryPriceDollars: getAverageEntryPrice(progress),
          submittedContracts: progress.totalSubmittedContracts,
          filledContracts: progress.totalFilledContracts,
          message:
            progress.totalFilledContracts > 0
              ? `Maker order is resting at ${formatMoneyApprox(progress.restingPriceDollars)} with ${progress.totalFilledContracts} contracts already filled.`
              : `Maker order is resting at ${formatMoneyApprox(progress.restingPriceDollars)} while the executor waits for a fill.`,
        });
      } catch (error) {
        terminalMessage = error instanceof Error ? error.message : "Unable to place the maker-first order.";
        if (isInsufficientFundsMessage(terminalMessage)) {
          await stopForInsufficientFunds(execution, terminalMessage);
          return;
        }
      }
    }

    if (getRemainingBudget(targetSpendDollars, progress.totalSpentDollars) <= 0) break;
    if (Date.now() + signalConfig.executionMakerPollMs >= makerDeadline) break;
    await sleep(signalConfig.executionMakerPollMs);
  }

  if (progress.restingOrderId) {
    const restingOrderId = progress.restingOrderId;
    await cancelKalshiOrder(restingOrderId).catch(() => undefined);
    progress.makerCanceledAt = new Date().toISOString();
    progress.restingOrderId = null;
    progress.restingClientOrderId = null;
    progress.restingPriceDollars = null;
  }

  const remainingBudgetDollars = getRemainingBudget(targetSpendDollars, progress.totalSpentDollars);
  const fallbackSizing = getExecutionSize(progress.lastKnownAsk, remainingBudgetDollars, progress.totalFilledContracts > 0 ? 0 : 1);
  if (fallbackSizing.submittedContracts < 1) {
    await persistExecution(execution, {
      status: progress.totalFilledContracts > 0 ? "submitted" : "unfilled",
      entryMode: "maker_first",
      orderId: progress.lastOrderId,
      clientOrderId: progress.lastClientOrderId,
      restingOrderId: null,
      restingClientOrderId: null,
      restingPriceDollars: null,
      makerPlacedAt: progress.makerPlacedAt,
      makerCanceledAt: progress.makerCanceledAt,
      makerFilledContracts: progress.makerFilledContracts,
      submittedAt: progress.submittedAt,
      entryPriceDollars: getAverageEntryPrice(progress),
      submittedContracts: progress.totalSubmittedContracts,
      filledContracts: progress.totalFilledContracts,
      message:
        progress.totalFilledContracts > 0
          ? `Maker-first entry filled ${progress.totalFilledContracts} contracts for ${formatDollarApprox(progress.totalSpentDollars)} without needing taker fallback.`
          : terminalMessage ?? "The maker-first order never received a fill before the fallback window expired.",
    });
    return;
  }

  const fallbackResult = await runTakerFallback({
    execution,
    windowTicker: execution.windowTicker,
    side,
    progress,
    targetSpendDollars,
    retryDeadline,
  });
  if (fallbackResult.stoppedForFunds) return;

  progress = fallbackResult.progress;
  const averageFillPriceDollars = getAverageEntryPrice(progress);
  const finalRemainingBudget = getRemainingBudget(targetSpendDollars, progress.totalSpentDollars);
  const canStillTopUp = getExecutionSize(progress.lastKnownAsk, finalRemainingBudget, progress.totalFilledContracts > 0 ? 0 : 1).submittedContracts > 0;

  let message: string;
  if (progress.totalFilledContracts < 1) {
    message = fallbackResult.terminalError
      ? `Maker-first entry exhausted the maker and taker path without a fill. ${fallbackResult.terminalError}`
      : "Maker-first entry exhausted the maker and taker path without a fill.";
  } else if (fallbackResult.terminalError) {
    message = `Maker-first entry filled ${progress.totalFilledContracts} contracts for ${formatDollarApprox(progress.totalSpentDollars)} before the taker fallback stopped. ${fallbackResult.terminalError}`;
  } else if (canStillTopUp) {
    message = `Maker-first entry filled ${progress.totalFilledContracts} contracts for ${formatDollarApprox(progress.totalSpentDollars)} after the taker fallback, but the full ${formatDollarApprox(targetSpendDollars)} target was not reached before the window stopped trading.`;
  } else {
    message = `Maker-first entry reached ${progress.totalFilledContracts} contracts for ${formatDollarApprox(progress.totalSpentDollars)} after working a resting order and taker fallback.`;
  }

  await persistExecution(execution, {
    status: progress.totalFilledContracts < 1 ? "unfilled" : canStillTopUp || fallbackResult.terminalError ? "partial_fill" : "submitted",
    entryMode: "taker_fallback",
    orderId: progress.lastOrderId,
    clientOrderId: progress.lastClientOrderId,
    restingOrderId: null,
    restingClientOrderId: null,
    restingPriceDollars: null,
    makerPlacedAt: progress.makerPlacedAt,
    makerCanceledAt: progress.makerCanceledAt,
    makerFilledContracts: progress.makerFilledContracts,
    fallbackStartedAt: progress.fallbackStartedAt,
    submittedAt: progress.submittedAt,
    entryPriceDollars: averageFillPriceDollars,
    submittedContracts: progress.totalSubmittedContracts,
    filledContracts: progress.totalFilledContracts,
    message,
  });
}

async function maybeExecuteWindow(snapshot: Awaited<ReturnType<typeof getBtc15mSignalSnapshot>>) {
  if (!signalConfig.executionEnabled || !tradingConfig.autoTradeEnabled || !hasKalshiTradingCredentials()) {
    return;
  }
  if (getSignalExecutionControlState().mode !== "running") {
    return;
  }

  if (!snapshot.window.id || !snapshot.window.market?.ticker || !snapshot.recommendation) {
    return;
  }

  const execution =
    (await createWaitingExecution(snapshot)) ?? getSignalExecutionByWindowTicker(snapshot.window.market.ticker);
  if (!execution || execution.status !== "waiting") {
    return;
  }

  if (
    snapshot.recommendation.action === "no_buy" ||
    !snapshot.recommendation.contractSide ||
    !snapshot.recommendation.buyPriceDollars
  ) {
    return;
  }

  await runMakerFirstEntry({ snapshot, execution });
}

export async function processSignalExecutionCycle() {
  if (executorState.__btcSignalExecutorRunning) {
    return;
  }

  executorState.__btcSignalExecutorRunning = true;
  try {
    await hydrateOnce();
    const snapshot = await getBtc15mSignalSnapshot();
    await reconcileExecutionOutcomes();
    await maybeExecuteWindow(snapshot);
  } finally {
    executorState.__btcSignalExecutorRunning = false;
  }
}

export async function ensureSignalExecutionManagerStarted() {
  if (executorState.__btcSignalExecutorStarted) {
    return;
  }

  executorState.__btcSignalExecutorStarted = true;
  await hydrateOnce();
  void processSignalExecutionCycle().catch(() => undefined);
  executorState.__btcSignalExecutorTimer = setInterval(() => {
    void processSignalExecutionCycle().catch(() => undefined);
  }, signalConfig.signalRefreshMs);
}
