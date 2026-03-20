import { tradingConfig } from "@/lib/server/trading-config";

type ExecutionState = {
  lastExecutionAt: number;
  executedTickers: string[];
  fundingHalted: boolean;
  fundingHaltReason: string | null;
  fundingHaltedAt: string | null;
};

const executionStateStore = globalThis as typeof globalThis & {
  __btcExecutionState?: ExecutionState;
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
  if (!executionStateStore.__btcExecutionState) {
    executionStateStore.__btcExecutionState = {
      lastExecutionAt: 0,
      executedTickers: [],
      fundingHalted: false,
      fundingHaltReason: null,
      fundingHaltedAt: null,
    };
  }

  return executionStateStore.__btcExecutionState;
}

function pruneStore() {
  const store = getStore();
  const todayKey = getDateKey(new Date().toISOString());
  executionStateStore.__btcExecutionState = {
    lastExecutionAt:
      store.lastExecutionAt && getDateKey(new Date(store.lastExecutionAt).toISOString()) === todayKey
        ? store.lastExecutionAt
        : 0,
    executedTickers: store.executedTickers.slice(-50),
    fundingHalted: store.fundingHalted,
    fundingHaltReason: store.fundingHaltReason,
    fundingHaltedAt: store.fundingHaltedAt,
  };
  return executionStateStore.__btcExecutionState;
}

export function getLastExecutionAt() {
  return pruneStore().lastExecutionAt;
}

export function setLastExecutionAt(timestamp: number) {
  const store = pruneStore();
  executionStateStore.__btcExecutionState = {
    ...store,
    lastExecutionAt: timestamp,
  };
}

export function hasExecutedMarketTicker(ticker: string) {
  return pruneStore().executedTickers.includes(ticker);
}

export function markExecutedMarketTicker(ticker: string) {
  const store = pruneStore();
  executionStateStore.__btcExecutionState = {
    ...store,
    executedTickers: [...new Set([ticker, ...store.executedTickers])].slice(0, 50),
  };
}

export function isFundingHalted() {
  return pruneStore().fundingHalted;
}

export function getFundingHaltReason() {
  return pruneStore().fundingHaltReason;
}

export function haltFunding(reason: string) {
  const store = pruneStore();
  executionStateStore.__btcExecutionState = {
    ...store,
    fundingHalted: true,
    fundingHaltReason: reason,
    fundingHaltedAt: new Date().toISOString(),
  };
}

export function clearFundingHalt() {
  const store = pruneStore();
  executionStateStore.__btcExecutionState = {
    ...store,
    fundingHalted: false,
    fundingHaltReason: null,
    fundingHaltedAt: null,
  };
}
