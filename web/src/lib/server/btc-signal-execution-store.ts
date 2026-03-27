import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { PersistedSignalExecution, SignalExecutionStatus } from "@/lib/signal-types";

type SignalExecutionRow = {
  id: string;
  created_at: string;
  updated_at: string;
  window_id: string;
  window_ticker: string;
  status: SignalExecutionStatus;
  entry_mode: PersistedSignalExecution["entryMode"];
  locked_action: PersistedSignalExecution["lockedAction"];
  locked_side: PersistedSignalExecution["lockedSide"];
  decision_snapshot_id: string | null;
  decision_observed_at: string | null;
  submitted_at: string | null;
  entry_price_dollars: number | string | null;
  submitted_contracts: number;
  filled_contracts: number;
  max_cost_dollars: number | string | null;
  order_id: string | null;
  client_order_id: string | null;
  resting_order_id: string | null;
  resting_client_order_id: string | null;
  resting_price_dollars: number | string | null;
  maker_placed_at: string | null;
  maker_canceled_at: string | null;
  maker_filled_contracts: number;
  fallback_started_at: string | null;
  message: string;
  resolution_outcome: "above" | "below" | null;
  realized_pnl_dollars: number | string | null;
};

const executionStore = globalThis as typeof globalThis & {
  __btcSignalExecutions?: PersistedSignalExecution[];
};

function parseNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getExecutionStore() {
  if (!executionStore.__btcSignalExecutions) {
    executionStore.__btcSignalExecutions = [];
  }
  return executionStore.__btcSignalExecutions;
}

function toExecution(row: SignalExecutionRow): PersistedSignalExecution {
  return {
    id: row.id,
    windowId: row.window_id,
    windowTicker: row.window_ticker,
    status: row.status,
    entryMode: row.entry_mode,
    lockedAction: row.locked_action,
    lockedSide: row.locked_side,
    decisionSnapshotId: row.decision_snapshot_id,
    decisionObservedAt: row.decision_observed_at,
    submittedAt: row.submitted_at,
    entryPriceDollars: parseNumber(row.entry_price_dollars),
    submittedContracts: row.submitted_contracts,
    filledContracts: row.filled_contracts,
    maxCostDollars: parseNumber(row.max_cost_dollars),
    orderId: row.order_id,
    clientOrderId: row.client_order_id,
    restingOrderId: row.resting_order_id,
    restingClientOrderId: row.resting_client_order_id,
    restingPriceDollars: parseNumber(row.resting_price_dollars),
    makerPlacedAt: row.maker_placed_at,
    makerCanceledAt: row.maker_canceled_at,
    makerFilledContracts: row.maker_filled_contracts,
    fallbackStartedAt: row.fallback_started_at,
    message: row.message,
    resolutionOutcome: row.resolution_outcome,
    realizedPnlDollars: parseNumber(row.realized_pnl_dollars),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExecutionRow(execution: PersistedSignalExecution): SignalExecutionRow {
  return {
    id: execution.id,
    created_at: execution.createdAt,
    updated_at: execution.updatedAt,
    window_id: execution.windowId,
    window_ticker: execution.windowTicker,
    status: execution.status,
    entry_mode: execution.entryMode,
    locked_action: execution.lockedAction,
    locked_side: execution.lockedSide,
    decision_snapshot_id: execution.decisionSnapshotId,
    decision_observed_at: execution.decisionObservedAt,
    submitted_at: execution.submittedAt,
    entry_price_dollars: execution.entryPriceDollars,
    submitted_contracts: execution.submittedContracts,
    filled_contracts: execution.filledContracts,
    max_cost_dollars: execution.maxCostDollars,
    order_id: execution.orderId,
    client_order_id: execution.clientOrderId,
    resting_order_id: execution.restingOrderId,
    resting_client_order_id: execution.restingClientOrderId,
    resting_price_dollars: execution.restingPriceDollars,
    maker_placed_at: execution.makerPlacedAt,
    maker_canceled_at: execution.makerCanceledAt,
    maker_filled_contracts: execution.makerFilledContracts,
    fallback_started_at: execution.fallbackStartedAt,
    message: execution.message,
    resolution_outcome: execution.resolutionOutcome,
    realized_pnl_dollars: execution.realizedPnlDollars,
  };
}

async function persistExecution(execution: PersistedSignalExecution) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("btc_signal_executions")
    .upsert(toExecutionRow(execution), { onConflict: "window_ticker" });

  if (error) {
    throw error;
  }
}

export async function upsertSignalExecution(
  input: Omit<PersistedSignalExecution, "id" | "createdAt" | "updatedAt"> & { id?: string | null },
) {
  const now = new Date().toISOString();
  const existing = getExecutionStore().find((entry) => entry.windowTicker === input.windowTicker) ?? null;
  const execution: PersistedSignalExecution = {
    id: input.id ?? existing?.id ?? crypto.randomUUID(),
    windowId: input.windowId,
    windowTicker: input.windowTicker,
    status: input.status,
    entryMode: input.entryMode,
    lockedAction: input.lockedAction,
    lockedSide: input.lockedSide,
    decisionSnapshotId: input.decisionSnapshotId,
    decisionObservedAt: input.decisionObservedAt,
    submittedAt: input.submittedAt,
    entryPriceDollars: input.entryPriceDollars,
    submittedContracts: input.submittedContracts,
    filledContracts: input.filledContracts,
    maxCostDollars: input.maxCostDollars,
    orderId: input.orderId,
    clientOrderId: input.clientOrderId,
    restingOrderId: input.restingOrderId,
    restingClientOrderId: input.restingClientOrderId,
    restingPriceDollars: input.restingPriceDollars,
    makerPlacedAt: input.makerPlacedAt,
    makerCanceledAt: input.makerCanceledAt,
    makerFilledContracts: input.makerFilledContracts,
    fallbackStartedAt: input.fallbackStartedAt,
    message: input.message,
    resolutionOutcome: input.resolutionOutcome,
    realizedPnlDollars: input.realizedPnlDollars,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  executionStore.__btcSignalExecutions = [
    execution,
    ...getExecutionStore().filter((entry) => entry.windowTicker !== execution.windowTicker),
  ].slice(0, 160);

  await persistExecution(execution).catch(() => undefined);
  return execution;
}

export function getSignalExecutionByWindowTicker(windowTicker: string) {
  return getExecutionStore().find((entry) => entry.windowTicker === windowTicker) ?? null;
}

export function listSignalExecutions(limit?: number) {
  const executions = getExecutionStore();
  return typeof limit === "number" ? executions.slice(0, limit) : [...executions];
}

export async function hydrateSignalExecutions(limit = 80) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { data } = await supabase
    .from("btc_signal_executions")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  executionStore.__btcSignalExecutions = ((data ?? []) as SignalExecutionRow[]).map(toExecution);
}
