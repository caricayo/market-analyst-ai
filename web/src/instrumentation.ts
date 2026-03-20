export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const [
    { ensureAutoEntryManagerStarted },
    { ensureManagedTradeManagerStarted },
    { ensureKalshiRealtimeManagerStarted },
  ] = await Promise.all([
    import("@/lib/server/auto-entry-manager"),
    import("@/lib/server/managed-trade-manager"),
    import("@/lib/server/kalshi-realtime-manager"),
  ]);

  ensureManagedTradeManagerStarted();
  ensureAutoEntryManagerStarted();
  ensureKalshiRealtimeManagerStarted();
}
