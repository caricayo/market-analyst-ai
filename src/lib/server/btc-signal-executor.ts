import { getBtc15mSignalSnapshot } from "@/lib/server/btc-signal-service";
import { fetchKalshiWindowByTicker } from "@/lib/server/btc-kalshi-client";
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

function getExecutionSize(entryPriceDollars: number) {
  const submittedContracts = Math.max(1, Math.floor(signalConfig.executionStakeDollars / entryPriceDollars));
  return {
    submittedContracts,
    maxCostDollars: round(submittedContracts * entryPriceDollars, 2),
  };
}

async function submitIocAttempt(input: {
  windowTicker: string;
  side: "yes" | "no";
  entryPriceDollars: number;
}) {
  const { submittedContracts, maxCostDollars } = getExecutionSize(input.entryPriceDollars);
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
  if (executorState.__btcSignalExecutorHydrated) {
    return;
  }

  executorState.__btcSignalExecutorHydrated = true;
  await hydrateSignalExecutions().catch(() => undefined);
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
  const { submittedContracts, maxCostDollars } = getExecutionSize(entryPriceDollars);

  const balance = await getKalshiBalance().catch(() => null);
  if (
    balance?.availableBalanceDollars !== null &&
    balance?.availableBalanceDollars !== undefined &&
    maxCostDollars !== null &&
    balance.availableBalanceDollars + 0.001 < maxCostDollars
  ) {
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
    const firstAttempt = await submitIocAttempt({
      windowTicker: snapshot.window.market.ticker,
      side: snapshot.recommendation.contractSide,
      entryPriceDollars,
    });

    let finalAttempt = firstAttempt;
    let message: string;

    if (firstAttempt.filledContracts < 1) {
      const refreshedMarket = await fetchKalshiWindowByTicker(snapshot.window.market.ticker).catch(() => null);
      const refreshedAsk = getSideAskPrice(refreshedMarket, snapshot.recommendation.contractSide);
      const canRetry = refreshedAsk !== null && refreshedAsk > 0;

      if (canRetry) {
        finalAttempt = await submitIocAttempt({
          windowTicker: snapshot.window.market.ticker,
          side: snapshot.recommendation.contractSide,
          entryPriceDollars: refreshedAsk,
        });
        message =
          finalAttempt.filledContracts < 1
            ? `First actionable signal locked the window. Initial IOC missed, retry at ${refreshedAsk.toFixed(2)} also returned no fill.`
            : finalAttempt.filledContracts < finalAttempt.submittedContracts
              ? `First actionable signal locked the window. Initial IOC missed, retry at ${refreshedAsk.toFixed(2)} partially filled ${finalAttempt.filledContracts} contracts.`
              : `First actionable signal locked the window. Initial IOC missed, retry at ${refreshedAsk.toFixed(2)} filled ${finalAttempt.filledContracts} contracts.`;
      } else {
        message = "First actionable signal locked the window, but the IOC order returned no fill and no fresh ask was available for retry.";
      }
    } else {
      message =
        finalAttempt.filledContracts < finalAttempt.submittedContracts
          ? `First actionable signal locked the window and partially filled ${finalAttempt.filledContracts} contracts.`
          : `First actionable signal locked the window and filled ${finalAttempt.filledContracts} contracts.`;
    }

    await upsertSignalExecution({
      id: execution.id,
      windowId: execution.windowId,
      windowTicker: execution.windowTicker,
      status:
        finalAttempt.filledContracts < 1
          ? "unfilled"
          : finalAttempt.filledContracts < finalAttempt.submittedContracts
            ? "partial_fill"
            : "submitted",
      lockedAction: snapshot.recommendation.action,
      lockedSide: snapshot.recommendation.contractSide,
      decisionSnapshotId: null,
      decisionObservedAt: snapshot.generatedAt,
      submittedAt: new Date().toISOString(),
      entryPriceDollars: finalAttempt.entryPriceDollars,
      submittedContracts: finalAttempt.submittedContracts,
      filledContracts: finalAttempt.filledContracts,
      maxCostDollars: finalAttempt.maxCostDollars,
      orderId: finalAttempt.orderId,
      clientOrderId: finalAttempt.clientOrderId,
      message,
      resolutionOutcome: null,
      realizedPnlDollars: null,
    });
  } catch (error) {
    const clientOrderId = buildClientOrderId(snapshot.window.market.ticker, snapshot.recommendation.contractSide);
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
      message: error instanceof Error ? error.message : "Signal execution order failed.",
      resolutionOutcome: null,
      realizedPnlDollars: null,
    });
  }
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
