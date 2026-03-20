import type { BotLogEntry } from "@/lib/trading-types";
import { tradingConfig } from "@/lib/server/trading-config";

const globalLogStore = globalThis as typeof globalThis & {
  __btcKalshiLog?: BotLogEntry[];
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
  if (!globalLogStore.__btcKalshiLog) {
    globalLogStore.__btcKalshiLog = [];
  }
  return globalLogStore.__btcKalshiLog;
}

function pruneStore() {
  const store = getStore();
  const todayKey = getDateKey(new Date().toISOString());
  globalLogStore.__btcKalshiLog = store
    .filter((entry) => getDateKey(entry.createdAt) === todayKey)
    .slice(-50);
  return globalLogStore.__btcKalshiLog;
}

export function appendTradingLog(entry: BotLogEntry) {
  const store = pruneStore();
  store.unshift(entry);
  globalLogStore.__btcKalshiLog = store.slice(0, 50);
}

export function listTradingLog() {
  return [...pruneStore()];
}
