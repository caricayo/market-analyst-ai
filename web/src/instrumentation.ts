export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSignalDaemonStarted } = await import("@/lib/server/btc-signal-service");
    await ensureSignalDaemonStarted();
  }
}
