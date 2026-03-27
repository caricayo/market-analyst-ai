export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSignalDaemonStarted } = await import("@/lib/server/btc-signal-service");
    const { ensureSignalExecutionManagerStarted } = await import("@/lib/server/btc-signal-executor");
    await ensureSignalDaemonStarted();
    await ensureSignalExecutionManagerStarted();
  }
}
