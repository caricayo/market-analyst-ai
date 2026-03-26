import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  PersistedSignalSnapshot,
  PersistedSignalWindow,
  SignalAction,
} from "@/lib/signal-types";

type SignalWindowRow = {
  id: string;
  market_ticker: string;
  market_title: string | null;
  open_time: string;
  close_time: string | null;
  expiration_time: string | null;
  strike_price_dollars: number | string | null;
  status: "active" | "resolved";
  resolution_outcome: "above" | "below" | null;
  settlement_proxy_price_dollars: number | string | null;
  outcome_source: "coinbase_proxy" | null;
  created_at: string;
  updated_at: string;
};

type SignalSnapshotRow = {
  id: string;
  window_id: string;
  market_ticker: string;
  observed_at: string;
  seconds_elapsed: number;
  seconds_to_close: number;
  current_price_dollars: number | string | null;
  model_above_probability: number | string | null;
  model_below_probability: number | string | null;
  action: SignalAction;
  contract_side: "yes" | "no" | null;
  buy_price_dollars: number | string | null;
  fair_value_dollars: number | string | null;
  edge_dollars: number | string | null;
  confidence: number;
  suggested_stake_dollars: number | string;
  suggested_contracts: number;
  features: Record<string, unknown>;
  reasons: string[];
  blockers: string[];
  explanation_status: PersistedSignalSnapshot["explanationStatus"];
  explanation_summary: string | null;
  resolution_outcome: "above" | "below" | null;
  outcome_source: "coinbase_proxy" | null;
};

const signalStore = globalThis as typeof globalThis & {
  __btcSignalWindows?: PersistedSignalWindow[];
  __btcSignalSnapshots?: PersistedSignalSnapshot[];
};

function parseNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getWindowsStore() {
  if (!signalStore.__btcSignalWindows) {
    signalStore.__btcSignalWindows = [];
  }
  return signalStore.__btcSignalWindows;
}

function getSnapshotsStore() {
  if (!signalStore.__btcSignalSnapshots) {
    signalStore.__btcSignalSnapshots = [];
  }
  return signalStore.__btcSignalSnapshots;
}

function toWindow(row: SignalWindowRow): PersistedSignalWindow {
  return {
    id: row.id,
    marketTicker: row.market_ticker,
    marketTitle: row.market_title,
    openTime: row.open_time,
    closeTime: row.close_time,
    expirationTime: row.expiration_time,
    strikePriceDollars: parseNumber(row.strike_price_dollars),
    status: row.status,
    resolutionOutcome: row.resolution_outcome,
    settlementProxyPriceDollars: parseNumber(row.settlement_proxy_price_dollars),
    outcomeSource: row.outcome_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSnapshot(row: SignalSnapshotRow): PersistedSignalSnapshot {
  return {
    id: row.id,
    windowId: row.window_id,
    marketTicker: row.market_ticker,
    observedAt: row.observed_at,
    secondsElapsed: row.seconds_elapsed,
    secondsToClose: row.seconds_to_close,
    currentPriceDollars: parseNumber(row.current_price_dollars),
    modelAboveProbability: parseNumber(row.model_above_probability),
    modelBelowProbability: parseNumber(row.model_below_probability),
    action: row.action,
    contractSide: row.contract_side,
    buyPriceDollars: parseNumber(row.buy_price_dollars),
    fairValueDollars: parseNumber(row.fair_value_dollars),
    edgeDollars: parseNumber(row.edge_dollars),
    confidence: row.confidence,
    suggestedStakeDollars: parseNumber(row.suggested_stake_dollars) ?? 0,
    suggestedContracts: row.suggested_contracts,
    features: row.features,
    reasons: row.reasons ?? [],
    blockers: row.blockers ?? [],
    explanationStatus: row.explanation_status,
    explanationSummary: row.explanation_summary,
    resolutionOutcome: row.resolution_outcome,
    outcomeSource: row.outcome_source,
  };
}

function toWindowRow(window: PersistedSignalWindow): SignalWindowRow {
  return {
    id: window.id,
    market_ticker: window.marketTicker,
    market_title: window.marketTitle,
    open_time: window.openTime,
    close_time: window.closeTime,
    expiration_time: window.expirationTime,
    strike_price_dollars: window.strikePriceDollars,
    status: window.status,
    resolution_outcome: window.resolutionOutcome,
    settlement_proxy_price_dollars: window.settlementProxyPriceDollars,
    outcome_source: window.outcomeSource,
    created_at: window.createdAt,
    updated_at: window.updatedAt,
  };
}

function toSnapshotRow(snapshot: PersistedSignalSnapshot): SignalSnapshotRow {
  return {
    id: snapshot.id,
    window_id: snapshot.windowId,
    market_ticker: snapshot.marketTicker,
    observed_at: snapshot.observedAt,
    seconds_elapsed: snapshot.secondsElapsed,
    seconds_to_close: snapshot.secondsToClose,
    current_price_dollars: snapshot.currentPriceDollars,
    model_above_probability: snapshot.modelAboveProbability,
    model_below_probability: snapshot.modelBelowProbability,
    action: snapshot.action,
    contract_side: snapshot.contractSide,
    buy_price_dollars: snapshot.buyPriceDollars,
    fair_value_dollars: snapshot.fairValueDollars,
    edge_dollars: snapshot.edgeDollars,
    confidence: snapshot.confidence,
    suggested_stake_dollars: snapshot.suggestedStakeDollars,
    suggested_contracts: snapshot.suggestedContracts,
    features: snapshot.features,
    reasons: snapshot.reasons,
    blockers: snapshot.blockers,
    explanation_status: snapshot.explanationStatus,
    explanation_summary: snapshot.explanationSummary,
    resolution_outcome: snapshot.resolutionOutcome,
    outcome_source: snapshot.outcomeSource,
  };
}

async function persistWindow(window: PersistedSignalWindow) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("btc_signal_windows")
    .upsert(toWindowRow(window), { onConflict: "market_ticker" });

  if (error) {
    throw error;
  }
}

async function persistSnapshot(snapshot: PersistedSignalSnapshot) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("btc_signal_snapshots")
    .upsert(toSnapshotRow(snapshot), { onConflict: "id" });

  if (error) {
    throw error;
  }
}

export async function upsertSignalWindow(
  input: Omit<PersistedSignalWindow, "id" | "createdAt" | "updatedAt"> & { id?: string | null },
) {
  const now = new Date().toISOString();
  const existing = getWindowsStore().find((window) => window.marketTicker === input.marketTicker) ?? null;
  const window: PersistedSignalWindow = {
    id: input.id ?? existing?.id ?? crypto.randomUUID(),
    marketTicker: input.marketTicker,
    marketTitle: input.marketTitle,
    openTime: input.openTime,
    closeTime: input.closeTime,
    expirationTime: input.expirationTime,
    strikePriceDollars: input.strikePriceDollars,
    status: input.status,
    resolutionOutcome: input.resolutionOutcome,
    settlementProxyPriceDollars: input.settlementProxyPriceDollars,
    outcomeSource: input.outcomeSource,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  signalStore.__btcSignalWindows = [
    window,
    ...getWindowsStore().filter((entry) => entry.marketTicker !== window.marketTicker),
  ].slice(0, 40);

  await persistWindow(window).catch(() => undefined);
  return window;
}

export async function appendSignalSnapshot(snapshot: PersistedSignalSnapshot) {
  signalStore.__btcSignalSnapshots = [snapshot, ...getSnapshotsStore()].slice(0, 300);
  await persistSnapshot(snapshot).catch(() => undefined);
  return snapshot;
}

export async function updateResolvedSnapshotsForWindow(input: {
  windowId: string;
  resolutionOutcome: "above" | "below";
  outcomeSource: "coinbase_proxy";
}) {
  signalStore.__btcSignalSnapshots = getSnapshotsStore().map((snapshot) =>
    snapshot.windowId === input.windowId
      ? {
          ...snapshot,
          resolutionOutcome: input.resolutionOutcome,
          outcomeSource: input.outcomeSource,
        }
      : snapshot,
  );

  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("btc_signal_snapshots")
    .update({
      resolution_outcome: input.resolutionOutcome,
      outcome_source: input.outcomeSource,
    })
    .eq("window_id", input.windowId);
}

export function getLatestSignalSnapshot() {
  return getSnapshotsStore()[0] ?? null;
}

export function listSignalHistory(limit = 8) {
  return getSnapshotsStore().slice(0, limit);
}

export function listSignalSnapshots(limit?: number) {
  const snapshots = getSnapshotsStore();
  return typeof limit === "number" ? snapshots.slice(0, limit) : [...snapshots];
}

export function listSignalWindows(limit?: number) {
  const windows = getWindowsStore();
  return typeof limit === "number" ? windows.slice(0, limit) : [...windows];
}

export async function hydrateSignalStore(limit = 40) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const [{ data: windowsData }, { data: snapshotsData }] = await Promise.all([
    supabase.from("btc_signal_windows").select("*").order("updated_at", { ascending: false }).limit(limit),
    supabase.from("btc_signal_snapshots").select("*").order("observed_at", { ascending: false }).limit(300),
  ]);

  signalStore.__btcSignalWindows = ((windowsData ?? []) as SignalWindowRow[]).map(toWindow);
  signalStore.__btcSignalSnapshots = ((snapshotsData ?? []) as SignalSnapshotRow[]).map(toSnapshot);
}
