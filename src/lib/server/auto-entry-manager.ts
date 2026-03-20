import { runTradingBotExecution } from "@/lib/server/trading-bot";
import { syncManagedTradesWithPositions } from "@/lib/server/managed-trade-manager";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";

const managerState = globalThis as typeof globalThis & {
  __btcAutoEntryManagerStarted?: boolean;
  __btcAutoEntryManagerTimeout?: NodeJS.Timeout;
  __btcAutoEntryManagerRunning?: boolean;
};

function scheduleNextAutoEntry(delayMs: number) {
  if (managerState.__btcAutoEntryManagerTimeout) {
    clearTimeout(managerState.__btcAutoEntryManagerTimeout);
  }

  managerState.__btcAutoEntryManagerTimeout = setTimeout(() => {
    void processAutoEntryCycle();
  }, delayMs);
}

export async function processAutoEntryCycle() {
  if (managerState.__btcAutoEntryManagerRunning) {
    return;
  }

  managerState.__btcAutoEntryManagerRunning = true;
  let hasExposure = false;
  try {
    await runTradingBotExecution("auto");
    const exposure = await syncManagedTradesWithPositions().catch(() => ({
      activeManagedTrades: [],
      driftWarnings: [],
      livePositions: [],
    }));
    hasExposure = exposure.livePositions.length > 0 || exposure.activeManagedTrades.length > 0;
  } catch {
    // Auto-entry failures are surfaced through snapshot warnings or auto log entries.
  } finally {
    managerState.__btcAutoEntryManagerRunning = false;
    scheduleNextAutoEntry(
      hasExposure ? tradingConfig.scalpPollIntervalMs : tradingConfig.autoEntryPollIntervalMs,
    );
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
  scheduleNextAutoEntry(0);
}
