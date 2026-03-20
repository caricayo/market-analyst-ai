export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const [{ ensureAutoEntryManagerStarted }, { ensureManagedTradeManagerStarted }] = await Promise.all([
    import("@/lib/server/auto-entry-manager"),
    import("@/lib/server/managed-trade-manager"),
  ]);

  ensureManagedTradeManagerStarted();
  ensureAutoEntryManagerStarted();
}
