import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { PersistedTrackedTrade, TrackedTradeResult, TrackedTradeSource } from "@/lib/signal-types";

type TrackedTradeRow = {
  id: string;
  created_at: string;
  updated_at: string;
  market_ticker: string;
  side: "yes" | "no";
  source: TrackedTradeSource;
  first_fill_at: string | null;
  last_fill_at: string | null;
  total_contracts: number;
  average_price_dollars: number | string | null;
  fills_count: number;
  resolution_outcome: "above" | "below" | null;
  result: TrackedTradeResult;
  realized_pnl_dollars: number | string | null;
};

const trackedTradeStore = globalThis as typeof globalThis & {
  __btcSignalTrackedTrades?: PersistedTrackedTrade[];
};

function parseNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTrackedTradeStore() {
  if (!trackedTradeStore.__btcSignalTrackedTrades) {
    trackedTradeStore.__btcSignalTrackedTrades = [];
  }
  return trackedTradeStore.__btcSignalTrackedTrades;
}

function toTrackedTrade(row: TrackedTradeRow): PersistedTrackedTrade {
  return {
    id: row.id,
    marketTicker: row.market_ticker,
    side: row.side,
    source: row.source,
    firstFillAt: row.first_fill_at,
    lastFillAt: row.last_fill_at,
    totalContracts: row.total_contracts,
    averagePriceDollars: parseNumber(row.average_price_dollars),
    fillsCount: row.fills_count,
    resolutionOutcome: row.resolution_outcome,
    result: row.result,
    realizedPnlDollars: parseNumber(row.realized_pnl_dollars),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTrackedTradeRow(trade: PersistedTrackedTrade): TrackedTradeRow {
  return {
    id: trade.id,
    created_at: trade.createdAt,
    updated_at: trade.updatedAt,
    market_ticker: trade.marketTicker,
    side: trade.side,
    source: trade.source,
    first_fill_at: trade.firstFillAt,
    last_fill_at: trade.lastFillAt,
    total_contracts: trade.totalContracts,
    average_price_dollars: trade.averagePriceDollars,
    fills_count: trade.fillsCount,
    resolution_outcome: trade.resolutionOutcome,
    result: trade.result,
    realized_pnl_dollars: trade.realizedPnlDollars,
  };
}

async function persistTrackedTrade(trade: PersistedTrackedTrade) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("btc_signal_account_trades")
    .upsert(toTrackedTradeRow(trade), { onConflict: "market_ticker,side" });

  if (error) {
    throw error;
  }
}

export async function upsertTrackedTrade(
  input: Omit<PersistedTrackedTrade, "id" | "createdAt" | "updatedAt"> & { id?: string | null },
) {
  const now = new Date().toISOString();
  const existing =
    getTrackedTradeStore().find((entry) => entry.marketTicker === input.marketTicker && entry.side === input.side) ??
    null;

  const trade: PersistedTrackedTrade = {
    id: input.id ?? existing?.id ?? crypto.randomUUID(),
    marketTicker: input.marketTicker,
    side: input.side,
    source: input.source,
    firstFillAt: input.firstFillAt,
    lastFillAt: input.lastFillAt,
    totalContracts: input.totalContracts,
    averagePriceDollars: input.averagePriceDollars,
    fillsCount: input.fillsCount,
    resolutionOutcome: input.resolutionOutcome,
    result: input.result,
    realizedPnlDollars: input.realizedPnlDollars,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  trackedTradeStore.__btcSignalTrackedTrades = [
    trade,
    ...getTrackedTradeStore().filter(
      (entry) => !(entry.marketTicker === trade.marketTicker && entry.side === trade.side),
    ),
  ].slice(0, 320);

  await persistTrackedTrade(trade).catch(() => undefined);
  return trade;
}

export function listTrackedTrades(limit?: number) {
  const trades = getTrackedTradeStore();
  return typeof limit === "number" ? trades.slice(0, limit) : [...trades];
}

export async function hydrateTrackedTrades(limit = 160) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { data } = await supabase
    .from("btc_signal_account_trades")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  trackedTradeStore.__btcSignalTrackedTrades = ((data ?? []) as TrackedTradeRow[]).map(toTrackedTrade);
}
