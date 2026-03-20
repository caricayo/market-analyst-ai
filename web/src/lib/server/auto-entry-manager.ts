import { runTradingBotExecution } from "@/lib/server/trading-bot";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";

const managerState = globalThis as typeof globalThis & {
  __btcAutoEntryManagerStarted?: boolean;
  __btcAutoEntryManagerInterval?: NodeJS.Timeout;
  __btcAutoEntryManagerRunning?: boolean;
};

export async function processAutoEntryCycle() {
  if (managerState.__btcAutoEntryManagerRunning) {
    return;
  }

  managerState.__btcAutoEntryManagerRunning = true;
  try {
    await runTradingBotExecution("auto");
  } catch {
    // Auto-entry failures are surfaced through snapshot warnings or auto log entries.
  } finally {
    managerState.__btcAutoEntryManagerRunning = false;
  }
}

export function ensureAutoEntryManagerStarted() {
  if (
    managerState.__btcAutoEntryManagerStarted ||
    !tradingConfig.autoEntryEnabled ||
    !tradingConfig.autoTradeEnabled ||
    !hasKalshiTradingCredentials()
  ) {
    return;
  }

  managerState.__btcAutoEntryManagerStarted = true;
  managerState.__btcAutoEntryManagerInterval = setInterval(() => {
    void processAutoEntryCycle();
  }, tradingConfig.autoEntryPollIntervalMs);
  void processAutoEntryCycle();
}
