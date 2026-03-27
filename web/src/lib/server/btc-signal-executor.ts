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
import { getKalshiBalance, submitKalshiOrder } from "@/lib/server/kalshi-client";
import { hasKalshiTradingCredentials, tradingConfig } from "@/lib/server/trading-config";

const executorState = globalThis as typeof globalThis & {
  __btcSignalExecutorStarted?: boolean;
  __btcSignalExecutorTimer?: NodeJS.Timeout;
  __btcSignalExecutorRunning?: boolean;
  __btcSignalExecutorHydrated?: boolean;
};

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function isInsufficientFundsMessage(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("insufficient") ||
    normalized.includes("out of funds") ||
    normalized.includes("available balance is below")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function parseFilledContracts(order: {
  fill_count_fp?: string | null;
  initial_count_fp?: string | null;
  remaining_count_fp?: string | null;
} | null | undefined) {
  const explicitFillCount = Number(order?.fill_count_fp ?? Number.NaN);
  if (Number.isFinite(explicitFillCount)) {
    return Math.max(0, Math.floor(explicitFillCount));
  }

  const initialCount = Number(order?.initial_count_fp ?? Number.NaN);
  const remainingCount = Number(order?.remaining_count_fp ?? Number.NaN);
  if (Number.isFinite(initialCount) && Number.isFinite(remainingCount)) {
    return Math.max(0, Math.floor(initialCount - remainingCount));
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

function getExecutionSize(
  entryPriceDollars: number,
  targetSpendDollars = signalConfig.executionStakeDollars,
  minimumContracts = 1,
) {
  if (!Number.isFinite(entryPriceDollars) || entryPriceDollars <= 0 || !Number.isFinite(targetSpendDollars)) {
    return {
      submittedContracts: 0,
      maxCostDollars: 0,
    };
  }

  const affordableContracts = Math.floor(targetSpendDollars / entryPriceDollars);
  const submittedContracts = Math.max(minimumContracts, affordableContracts);
  return {
    submittedContracts,
    maxCostDollars: round(submittedContracts * entryPriceDollars, 2),
  };
}

async function submitIocAttempt(input: {
  windowTicker: string;
  side: "yes" | "no";
  entryPriceDollars: number;
  targetSpendDollars?: number;
  minimumContracts?: number;
}) {
  const { submittedContracts, maxCostDollars } = getExecutionSize(
    input.entryPriceDollars,
    input.targetSpendDollars,
    input.minimumContracts,
  );
  if (submittedContracts < 1) {
    return {
      submittedContracts: 0,
      filledContracts: 0,
      maxCostDollars: 0,
      entryPriceDollars: input.entryPriceDollars,
      orderId: null,
      clientOrderId: null,
    };
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

function getRemainingBudget(targetSpendDollars: number, spentDollars: number) {
  return Math.max(0, Number((targetSpendDollars - spentDollars).toFixed(4)));
}

async function hydrateOnce() {
  if (executorState.__btcSignalExecutorHydrated) {
    return;
  }

  executorState.__btcSignalExecutorHydrated = true;
  await Promise.all([
    hydrateSignalExecutions().catch(() => undefined),
    hydrateSignalExecutionControl().catch(() => undefined),
  ]);
}

async function reconcileExecutionOutcomes() {
  const windowsByTicker = new Map(listSignalWindows().map((window) => [window.marketTicker, window]));

  for (const execution of listSignalExecutions()) {
    if (execution.resolutionOutcome || execution.status === "skipped_no_signal" || execution.status === "resolved") {
      continue;
    }

    const window = windowsByTicker.get(execution.windowTicker);
    if (!window?.resolutionOutcome) {
      continue;
    }

    if (execution.status === "waiting") {
      await upsertSignalExecution({
        id: execution.id,
        windowId: execution.windowId,
        windowTicker: execution.windowTicker,
        status: "skipped_no_signal",
        lockedAction: execution.lockedAction,
        lockedSide: execution.lockedSide,
        decisionSnapshotId: execution.decisionSnapshotId,
        decisionObservedAt: execution.decisionObservedAt,
        submittedAt: execution.submittedAt,
        entryPriceDollars: execution.entryPriceDollars,
        submittedContracts: execution.submittedContracts,
        filledContracts: execution.filledContracts,
        maxCostDollars: execution.maxCostDollars,
        orderId: execution.orderId,
        clientOrderId: execution.clientOrderId,
        message: "Window settled before the advisory station produced an actionable buy signal.",
        resolutionOutcome: window.resolutionOutcome,
        realizedPnlDollars: 0,
      });
      continue;
    }

    if (execution.status === "submitted" || execution.status === "partial_fill") {
      const win =
        (execution.lockedAction === "buy_yes" && window.resolutionOutcome === "above") ||
        (execution.lockedAction === "buy_no" && window.resolutionOutcome === "below");
      const perContract = win ? 1 - (execution.entryPriceDollars ?? 0) : -(execution.entryPriceDollars ?? 0);
      const realizedPnlDollars = round(perContract * execution.filledContracts, 2) ?? 0;

      await upsertSignalExecution({
        id: execution.id,
        windowId: execution.windowId,
        windowTicker: execution.windowTicker,
        status: "resolved",
        lockedAction: execution.lockedAction,
        lockedSide: execution.lockedSide,
        decisionSnapshotId: execution.decisionSnapshotId,
        decisionObservedAt: execution.decisionObservedAt,
        submittedAt: execution.submittedAt,
        entryPriceDollars: execution.entryPriceDollars,
        submittedContracts: execution.submittedContracts,
        filledContracts: execution.filledContracts,
        maxCostDollars: execution.maxCostDollars,
        orderId: execution.orderId,
        clientOrderId: execution.clientOrderId,
        message: win
          ? "Held to settlement and finished in the money."
          : "Held to settlement and finished out of the money.",
        resolutionOutcome: window.resolutionOutcome,
        realizedPnlDollars,
      });
      continue;
    }

    if (execution.status === "unfilled" || execution.status === "error") {
      await upsertSignalExecution({
        id: execution.id,
        windowId: execution.windowId,
        windowTicker: execution.windowTicker,
        status: execution.status,
        lockedAction: execution.lockedAction,
        lockedSide: execution.lockedSide,
        decisionSnapshotId: execution.decisionSnapshotId,
        decisionObservedAt: execution.decisionObservedAt,
        submittedAt: execution.submittedAt,
        entryPriceDollars: execution.entryPriceDollars,
        submittedContracts: execution.submittedContracts,
        filledContracts: execution.filledContracts,
        maxCostDollars: execution.maxCostDollars,
        orderId: execution.orderId,
        clientOrderId: execution.clientOrderId,
        message: execution.message,
        resolutionOutcome: window.resolutionOutcome,
        realizedPnlDollars: 0,
      });
    }
  }
}

async function createWaitingExecution(snapshot: Awaited<ReturnType<typeof getBtc15mSignalSnapshot>>) {
  if (!snapshot.window.id || !snapshot.window.market?.ticker) {
    return null;
  }

  const existing = getSignalExecutionByWindowTicker(snapshot.window.market.ticker);
  if (existing) {
    return existing;
  }

  return upsertSignalExecution({
    windowId: snapshot.window.id,
    windowTicker: snapshot.window.market.ticker,
    status: "waiting",
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
    message: "Waiting for the first actionable Buy YES or Buy NO signal in this window.",
    resolutionOutcome: null,
    realizedPnlDollars: null,
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

  const entryPriceDollars = snapshot.recommendation.buyPriceDollars;
  const targetSpendDollars = signalConfig.executionStakeDollars;
  const { submittedContracts, maxCostDollars } = getExecutionSize(entryPriceDollars, targetSpendDollars, 1);

  const balance = await getKalshiBalance().catch(() => null);
  if (
    balance?.availableBalanceDollars !== null &&
    balance?.availableBalanceDollars !== undefined &&
    maxCostDollars !== null &&
    balance.availableBalanceDollars + 0.001 < maxCostDollars
  ) {
    await setSignalExecutionControlState({
      mode: "stopped",
      reason: "insufficient_funds",
      message: "Auto-execution stopped after an out-of-funds check. Add funds, then press Go.",
    });
    await upsertSignalExecution({
      id: execution.id,
      windowId: execution.windowId,
      windowTicker: execution.windowTicker,
      status: "error",
      lockedAction: snapshot.recommendation.action,
      lockedSide: snapshot.recommendation.contractSide,
      decisionSnapshotId: null,
      decisionObservedAt: snapshot.generatedAt,
      submittedAt: null,
      entryPriceDollars,
      submittedContracts,
      filledContracts: 0,
      maxCostDollars,
      orderId: null,
      clientOrderId: null,
      message: "Available balance is below the required max order cost for this signal window.",
      resolutionOutcome: null,
      realizedPnlDollars: null,
    });
    return;
  }

  try {
    let attemptCount = 0;
    let totalSubmittedContracts = 0;
    let totalFilledContracts = 0;
    let totalSpentDollars = 0;
    let weightedFillCostDollars = 0;
    let lastKnownAsk = entryPriceDollars;
    let lastOrderId: string | null = null;
    let lastClientOrderId: string | null = null;
    let terminalError: string | null = null;
    const retryDeadline = Date.now() + Math.max(0, snapshot.window.secondsToClose * 1_000);

    while (Date.now() < retryDeadline) {
      const remainingBudgetDollars = getRemainingBudget(targetSpendDollars, totalSpentDollars);
      const minimumContracts = totalFilledContracts > 0 ? 0 : 1;
      const sizing = getExecutionSize(lastKnownAsk, remainingBudgetDollars, minimumContracts);
      if (sizing.submittedContracts < 1) {
        break;
      }

      try {
        const attempt = await submitIocAttempt({
          windowTicker: snapshot.window.market.ticker,
          side: snapshot.recommendation.contractSide,
          entryPriceDollars: lastKnownAsk,
          targetSpendDollars: remainingBudgetDollars,
          minimumContracts,
        });

        attemptCount += 1;
        totalSubmittedContracts += attempt.submittedContracts;
        lastOrderId = attempt.orderId ?? lastOrderId;
        lastClientOrderId = attempt.clientOrderId ?? lastClientOrderId;

        if (attempt.filledContracts > 0) {
          const fillPriceDollars = attempt.entryPriceDollars ?? lastKnownAsk;
          totalFilledContracts += attempt.filledContracts;
          totalSpentDollars += attempt.filledContracts * fillPriceDollars;
          weightedFillCostDollars += attempt.filledContracts * fillPriceDollars;
        }
      } catch (error) {
        terminalError = error instanceof Error ? error.message : "Signal execution order failed.";
        if (isInsufficientFundsMessage(terminalError)) {
          await setSignalExecutionControlState({
            mode: "stopped",
            reason: "insufficient_funds",
            message: "Auto-execution stopped after an out-of-funds response. Add funds, then press Go.",
          });
        }
        break;
      }

      const refreshedRemainingBudget = getRemainingBudget(targetSpendDollars, totalSpentDollars);
      if (refreshedRemainingBudget <= 0) {
        break;
      }

      if (Date.now() + 1_000 >= retryDeadline) {
        break;
      }

      await sleep(1_000);
      const refreshedMarket = await fetchKalshiWindowByTicker(snapshot.window.market.ticker).catch(() => null);
      const refreshedAsk = getSideAskPrice(refreshedMarket, snapshot.recommendation.contractSide);
      const closeTime = refreshedMarket?.closeTime ?? refreshedMarket?.expirationTime ?? null;
      const closesAt = closeTime ? Date.parse(closeTime) : Number.NaN;

      if (Number.isFinite(closesAt) && closesAt <= Date.now()) {
        break;
      }

      if ((refreshedMarket?.status ?? "").toLowerCase() === "closed") {
        break;
      }

      if (refreshedAsk === null || refreshedAsk <= 0) {
        continue;
      }

      lastKnownAsk = refreshedAsk;
    }

    const averageFillPriceDollars =
      totalFilledContracts > 0 ? round(weightedFillCostDollars / totalFilledContracts, 4) : entryPriceDollars;
    const remainingBudgetDollars = getRemainingBudget(targetSpendDollars, totalSpentDollars);
    const canStillTopUp =
      getExecutionSize(lastKnownAsk, remainingBudgetDollars, totalFilledContracts > 0 ? 0 : 1).submittedContracts > 0;
    let message: string;

    if (totalFilledContracts < 1) {
      message = terminalError
        ? `First actionable signal locked the window, but no contracts filled before execution failed after ${attemptCount} attempts. ${terminalError}`
        : `First actionable signal locked the window, but no IOC attempt filled after ${attemptCount} tries. Last refreshed ask was ${lastKnownAsk.toFixed(2)}.`;
    } else if (terminalError) {
      message = `First actionable signal locked the window and filled ${totalFilledContracts} contracts for ${formatDollarApprox(totalSpentDollars)} before execution stopped. ${terminalError}`;
    } else if (canStillTopUp) {
      message = `First actionable signal locked the window and filled ${totalFilledContracts} contracts for ${formatDollarApprox(totalSpentDollars)} after ${attemptCount} attempts, but the full ${formatDollarApprox(targetSpendDollars)} target was not reached before the window stopped trading.`;
    } else {
      message = `First actionable signal locked the window and filled ${totalFilledContracts} contracts for ${formatDollarApprox(totalSpentDollars)} after ${attemptCount} attempts.`;
    }

    await upsertSignalExecution({
      id: execution.id,
      windowId: execution.windowId,
      windowTicker: execution.windowTicker,
      status:
        totalFilledContracts < 1
          ? "unfilled"
          : canStillTopUp || terminalError
            ? "partial_fill"
            : "submitted",
      lockedAction: snapshot.recommendation.action,
      lockedSide: snapshot.recommendation.contractSide,
      decisionSnapshotId: null,
      decisionObservedAt: snapshot.generatedAt,
      submittedAt: new Date().toISOString(),
      entryPriceDollars: averageFillPriceDollars,
      submittedContracts: totalSubmittedContracts,
      filledContracts: totalFilledContracts,
      maxCostDollars: round(targetSpendDollars, 2),
      orderId: lastOrderId,
      clientOrderId: lastClientOrderId,
      message,
      resolutionOutcome: null,
      realizedPnlDollars: null,
    });
  } catch (error) {
    const clientOrderId = buildClientOrderId(snapshot.window.market.ticker, snapshot.recommendation.contractSide);
    const errorMessage = error instanceof Error ? error.message : "Signal execution order failed.";
    if (isInsufficientFundsMessage(errorMessage)) {
      await setSignalExecutionControlState({
        mode: "stopped",
        reason: "insufficient_funds",
        message: "Auto-execution stopped after an out-of-funds response. Add funds, then press Go.",
      });
    }
    await upsertSignalExecution({
      id: execution.id,
      windowId: execution.windowId,
      windowTicker: execution.windowTicker,
      status: "error",
      lockedAction: snapshot.recommendation.action,
      lockedSide: snapshot.recommendation.contractSide,
      decisionSnapshotId: null,
      decisionObservedAt: snapshot.generatedAt,
      submittedAt: new Date().toISOString(),
      entryPriceDollars,
      submittedContracts,
      filledContracts: 0,
      maxCostDollars,
      orderId: null,
      clientOrderId,
      message: errorMessage,
      resolutionOutcome: null,
      realizedPnlDollars: null,
    });
  }
}

function formatDollarApprox(value: number) {
  return `$${value.toFixed(2)}`;
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
