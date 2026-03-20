import type {
  ExitReason,
  ManagedTrade,
  ManagedTradeStatus,
} from "@/lib/trading-types";
import { tradingConfig } from "@/lib/server/trading-config";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type ManagedTradeRow = {
  id: string;
  created_at: string;
  updated_at: string;
  market_ticker: string;
  market_title: string | null;
  close_time: string | null;
  setup_type: ManagedTrade["setupType"];
  entry_side: ManagedTrade["entrySide"];
  entry_outcome: ManagedTrade["entryOutcome"];
  contracts: number | string;
  entry_order_id: string | null;
  entry_client_order_id: string | null;
  entry_price_dollars: number | string;
  target_price_dollars: number | string;
  stop_price_dollars: number | string;
  forced_exit_at: string;
  status: ManagedTradeStatus;
  exit_reason: ExitReason | null;
  exit_order_id: string | null;
  exit_client_order_id: string | null;
  exit_price_dollars: number | string | null;
  realized_pnl_dollars: number | string | null;
  last_seen_bid_dollars: number | string | null;
  peak_price_dollars: number | string | null;
  last_checked_at: string | null;
  last_exit_attempt_at: string | null;
  stop_armed_at: string | null;
  error_message: string | null;
};

const managedTradeStore = globalThis as typeof globalThis & {
  __btcManagedTrades?: ManagedTrade[];
  __btcManagedTradesHydratedAt?: number;
};

function getDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tradingConfig.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function parseNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getStore() {
  if (!managedTradeStore.__btcManagedTrades) {
    managedTradeStore.__btcManagedTrades = [];
  }

  return managedTradeStore.__btcManagedTrades;
}

function setStore(trades: ManagedTrade[]) {
  managedTradeStore.__btcManagedTrades = trades;
  managedTradeStore.__btcManagedTradesHydratedAt = Date.now();
  return managedTradeStore.__btcManagedTrades;
}

function pruneStore() {
  const todayKey = getDateKey(new Date().toISOString());
  const store = getStore()
    .filter(
      (trade) =>
        trade.status === "open" ||
        trade.status === "exit-submitted" ||
        getDateKey(trade.updatedAt || trade.createdAt) === todayKey,
    )
    .slice(-100);
  return setStore(store);
}

function toManagedTrade(row: ManagedTradeRow): ManagedTrade {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    marketTicker: row.market_ticker,
    marketTitle: row.market_title,
    closeTime: row.close_time,
    setupType: row.setup_type,
    entrySide: row.entry_side,
    entryOutcome: row.entry_outcome,
    contracts: parseNumber(row.contracts) ?? 0,
    entryOrderId: row.entry_order_id,
    entryClientOrderId: row.entry_client_order_id,
    entryPriceDollars: parseNumber(row.entry_price_dollars) ?? 0,
    targetPriceDollars: parseNumber(row.target_price_dollars) ?? 0,
    stopPriceDollars: parseNumber(row.stop_price_dollars) ?? 0,
    forcedExitAt: row.forced_exit_at,
    status: row.status,
    exitReason: row.exit_reason,
    exitOrderId: row.exit_order_id,
    exitClientOrderId: row.exit_client_order_id,
    exitPriceDollars: parseNumber(row.exit_price_dollars),
    realizedPnlDollars: parseNumber(row.realized_pnl_dollars),
    lastSeenBidDollars: parseNumber(row.last_seen_bid_dollars),
    peakPriceDollars: parseNumber(row.peak_price_dollars),
    lastCheckedAt: row.last_checked_at,
    lastExitAttemptAt: row.last_exit_attempt_at,
    stopArmedAt: row.stop_armed_at,
    errorMessage: row.error_message,
  };
}

function toManagedTradeRow(trade: ManagedTrade): ManagedTradeRow {
  return {
    id: trade.id,
    created_at: trade.createdAt,
    updated_at: trade.updatedAt,
    market_ticker: trade.marketTicker,
    market_title: trade.marketTitle,
    close_time: trade.closeTime,
    setup_type: trade.setupType,
    entry_side: trade.entrySide,
    entry_outcome: trade.entryOutcome,
    contracts: trade.contracts,
    entry_order_id: trade.entryOrderId,
    entry_client_order_id: trade.entryClientOrderId,
    entry_price_dollars: trade.entryPriceDollars,
    target_price_dollars: trade.targetPriceDollars,
    stop_price_dollars: trade.stopPriceDollars,
    forced_exit_at: trade.forcedExitAt,
    status: trade.status,
    exit_reason: trade.exitReason,
    exit_order_id: trade.exitOrderId,
    exit_client_order_id: trade.exitClientOrderId,
    exit_price_dollars: trade.exitPriceDollars,
    realized_pnl_dollars: trade.realizedPnlDollars,
    last_seen_bid_dollars: trade.lastSeenBidDollars,
    peak_price_dollars: trade.peakPriceDollars,
    last_checked_at: trade.lastCheckedAt,
    last_exit_attempt_at: trade.lastExitAttemptAt,
    stop_armed_at: trade.stopArmedAt,
    error_message: trade.errorMessage,
  };
}

function shouldHydrate(force = false) {
  if (force) {
    return true;
  }

  const hydratedAt = managedTradeStore.__btcManagedTradesHydratedAt ?? 0;
  return Date.now() - hydratedAt > 5_000;
}

async function loadManagedTradesFromPersistence() {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return null;
  }

  const todayKey = getDateKey(new Date().toISOString());
  const { data, error } = await supabase
    .from("bot_managed_trades")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ManagedTradeRow[];
  return rows
    .map(toManagedTrade)
    .filter(
      (trade) =>
        trade.status === "open" ||
        trade.status === "exit-submitted" ||
        getDateKey(trade.updatedAt || trade.createdAt) === todayKey,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function persistManagedTrade(trade: ManagedTrade) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("bot_managed_trades")
    .upsert(toManagedTradeRow(trade), { onConflict: "id" });

  if (error) {
    throw error;
  }
}

export async function hydrateManagedTradesFromPersistence(force = false) {
  if (!shouldHydrate(force)) {
    return listManagedTrades();
  }

  try {
    const persistedTrades = await loadManagedTradesFromPersistence();
    if (persistedTrades) {
      setStore(persistedTrades.slice(0, 100));
    }
  } catch {
    pruneStore();
  }

  return listManagedTrades();
}

export function listManagedTrades() {
  return [...pruneStore()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listOpenManagedTrades() {
  return listManagedTrades().filter((trade) => trade.status === "open" || trade.status === "exit-submitted");
}

export function findOpenManagedTradeByTicker(ticker: string) {
  return listOpenManagedTrades().find((trade) => trade.marketTicker === ticker) ?? null;
}

export async function findLatestClosedManagedTradeByTicker(ticker: string) {
  const localTrade =
    listManagedTrades()
      .filter((trade) => trade.marketTicker === ticker && (trade.status === "closed" || trade.status === "error"))
      .sort((left, right) => (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt))[0] ??
    null;

  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return localTrade;
  }

  try {
    const { data, error } = await supabase
      .from("bot_managed_trades")
      .select("*")
      .eq("market_ticker", ticker)
      .in("status", ["closed", "error"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return localTrade;
    }

    return toManagedTrade(data as ManagedTradeRow);
  } catch {
    return localTrade;
  }
}

export async function createManagedTrade(input: Omit<ManagedTrade, "id" | "createdAt" | "updatedAt">) {
  const timestamp = new Date().toISOString();
  const trade: ManagedTrade = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const store = pruneStore();
  store.unshift(trade);
  setStore(store.slice(0, 100));
  await persistManagedTrade(trade).catch(() => undefined);
  return trade;
}

export async function patchManagedTrade(id: string, patch: Partial<ManagedTrade>) {
  const store = pruneStore();
  const updatedAt = new Date().toISOString();
  const nextStore = store.map((trade) =>
    trade.id === id
      ? {
          ...trade,
          ...patch,
          updatedAt,
        }
      : trade,
  );
  setStore(nextStore);
  const nextTrade = nextStore.find((trade) => trade.id === id) ?? null;
  if (nextTrade) {
    await persistManagedTrade(nextTrade).catch(() => undefined);
  }
  return nextTrade;
}

export async function closeManagedTrade(input: {
  id: string;
  status?: Extract<ManagedTradeStatus, "closed" | "error">;
  exitReason: ExitReason;
  exitPriceDollars?: number | null;
  realizedPnlDollars?: number | null;
  errorMessage?: string | null;
  exitOrderId?: string | null;
  exitClientOrderId?: string | null;
}) {
  return patchManagedTrade(input.id, {
    status: input.status ?? "closed",
    exitReason: input.exitReason,
    exitPriceDollars: input.exitPriceDollars ?? null,
    realizedPnlDollars: input.realizedPnlDollars ?? null,
    errorMessage: input.errorMessage ?? null,
    exitOrderId: input.exitOrderId ?? null,
    exitClientOrderId: input.exitClientOrderId ?? null,
    lastCheckedAt: new Date().toISOString(),
  });
}
