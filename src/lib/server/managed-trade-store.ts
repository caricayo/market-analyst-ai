import type {
  ExitReason,
  ManagedTrade,
  ManagedTradeStatus,
} from "@/lib/trading-types";
import { tradingConfig } from "@/lib/server/trading-config";

const managedTradeStore = globalThis as typeof globalThis & {
  __btcManagedTrades?: ManagedTrade[];
};

function getDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tradingConfig.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function getStore() {
  if (!managedTradeStore.__btcManagedTrades) {
    managedTradeStore.__btcManagedTrades = [];
  }

  return managedTradeStore.__btcManagedTrades;
}

function pruneStore() {
  const todayKey = getDateKey(new Date().toISOString());
  const store = getStore()
    .filter(
      (trade) =>
        trade.status !== "closed" ||
        getDateKey(trade.updatedAt || trade.createdAt) === todayKey,
    )
    .slice(-50);
  managedTradeStore.__btcManagedTrades = store;
  return store;
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

export function createManagedTrade(input: Omit<ManagedTrade, "id" | "createdAt" | "updatedAt">) {
  const timestamp = new Date().toISOString();
  const trade: ManagedTrade = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const store = pruneStore();
  store.unshift(trade);
  managedTradeStore.__btcManagedTrades = store.slice(0, 50);
  return trade;
}

export function patchManagedTrade(id: string, patch: Partial<ManagedTrade>) {
  const store = pruneStore();
  const nextStore = store.map((trade) =>
    trade.id === id
      ? {
          ...trade,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
      : trade,
  );
  managedTradeStore.__btcManagedTrades = nextStore;
  return nextStore.find((trade) => trade.id === id) ?? null;
}

export function closeManagedTrade(input: {
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
