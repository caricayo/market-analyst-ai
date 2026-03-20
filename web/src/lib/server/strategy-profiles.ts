import { tradingConfig } from "@/lib/server/trading-config";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { StrategyStateSnapshot, TunerChangeRecord } from "@/lib/trading-types";

export type StrategyProfile = {
  slug: string;
  name: string;
  isChampion: boolean;
  allowReversal: boolean;
  blockHighRiskOpen: boolean;
  blockCloseWindow: boolean;
  trendEdgeThreshold: number;
  trendConfidenceThreshold: number;
  scalpPrimaryDistanceFloor: number;
  scalpPrimaryAtrMultiplier: number;
  scalpLateDistanceFloor: number;
  scalpLateAtrMultiplier: number;
  scalpConfidenceThreshold: number;
  scalpLateConfidenceThreshold: number;
  reversalPrimaryDistanceFloor: number;
  reversalPrimaryAtrMultiplier: number;
  reversalLateDistanceFloor: number;
  reversalLateAtrMultiplier: number;
  reversalConfidenceThreshold: number;
  reversalLateConfidenceThreshold: number;
};

type StrategyProfileRecord = Omit<StrategyProfile, "isChampion">;

type StrategyStateRow = {
  scope: string;
  active_policy_slug: string;
  active_policy_name: string;
  source: StrategyStateSnapshot["source"];
  notes: string | null;
  changed_at: string;
};

type StrategyChangeRow = {
  id: string;
  from_policy_slug: string | null;
  from_policy_name: string | null;
  to_policy_slug: string;
  to_policy_name: string;
  source: TunerChangeRecord["source"];
  reason: string | null;
  promoted_at: string;
};

const strategyStateCache = globalThis as typeof globalThis & {
  __btcStrategyState?: StrategyStateSnapshot;
  __btcStrategyStateLoadedAt?: number;
};

const STRATEGY_STATE_SCOPE = "live";
const STRATEGY_STATE_TTL_MS = 15_000;
const DEFAULT_POLICY_SLUG = "champion-live";

function buildStrategyCatalog(): StrategyProfileRecord[] {
  return [
    {
      slug: "champion-live",
      name: "Trend Core v1",
      allowReversal: true,
      blockHighRiskOpen: true,
      blockCloseWindow: true,
      trendEdgeThreshold: 0.6,
      trendConfidenceThreshold: 68,
      scalpPrimaryDistanceFloor: 35,
      scalpPrimaryAtrMultiplier: 0.9,
      scalpLateDistanceFloor: 65,
      scalpLateAtrMultiplier: 1.2,
      scalpConfidenceThreshold: 64,
      scalpLateConfidenceThreshold: 72,
      reversalPrimaryDistanceFloor: tradingConfig.reversalPrimaryDistanceFloor,
      reversalPrimaryAtrMultiplier: tradingConfig.reversalPrimaryAtrMultiplier,
      reversalLateDistanceFloor: tradingConfig.reversalLateDistanceFloor,
      reversalLateAtrMultiplier: tradingConfig.reversalLateAtrMultiplier,
      reversalConfidenceThreshold: 66,
      reversalLateConfidenceThreshold: 70,
    },
    {
      slug: "legacy-dual-playbook",
      name: "Dual Playbook Legacy v1",
      allowReversal: false,
      blockHighRiskOpen: true,
      blockCloseWindow: true,
      trendEdgeThreshold: 0.6,
      trendConfidenceThreshold: 68,
      scalpPrimaryDistanceFloor: 45,
      scalpPrimaryAtrMultiplier: 0.9,
      scalpLateDistanceFloor: 65,
      scalpLateAtrMultiplier: 1.2,
      scalpConfidenceThreshold: 64,
      scalpLateConfidenceThreshold: 72,
      reversalPrimaryDistanceFloor: tradingConfig.reversalPrimaryDistanceFloor,
      reversalPrimaryAtrMultiplier: tradingConfig.reversalPrimaryAtrMultiplier,
      reversalLateDistanceFloor: tradingConfig.reversalLateDistanceFloor,
      reversalLateAtrMultiplier: tradingConfig.reversalLateAtrMultiplier,
      reversalConfidenceThreshold: 66,
      reversalLateConfidenceThreshold: 70,
    },
    {
      slug: "loose-dual-playbook",
      name: "Dual Playbook Loose v2",
      allowReversal: false,
      blockHighRiskOpen: true,
      blockCloseWindow: true,
      trendEdgeThreshold: 0.6,
      trendConfidenceThreshold: 68,
      scalpPrimaryDistanceFloor: 35,
      scalpPrimaryAtrMultiplier: 0.9,
      scalpLateDistanceFloor: 65,
      scalpLateAtrMultiplier: 1.2,
      scalpConfidenceThreshold: 64,
      scalpLateConfidenceThreshold: 72,
      reversalPrimaryDistanceFloor: tradingConfig.reversalPrimaryDistanceFloor,
      reversalPrimaryAtrMultiplier: tradingConfig.reversalPrimaryAtrMultiplier,
      reversalLateDistanceFloor: tradingConfig.reversalLateDistanceFloor,
      reversalLateAtrMultiplier: tradingConfig.reversalLateAtrMultiplier,
      reversalConfidenceThreshold: 66,
      reversalLateConfidenceThreshold: 70,
    },
    {
      slug: "conservative-trend-core",
      name: "Trend Core Conservative v2",
      allowReversal: false,
      blockHighRiskOpen: true,
      blockCloseWindow: true,
      trendEdgeThreshold: 0.7,
      trendConfidenceThreshold: 72,
      scalpPrimaryDistanceFloor: 45,
      scalpPrimaryAtrMultiplier: 0.9,
      scalpLateDistanceFloor: 75,
      scalpLateAtrMultiplier: 1.2,
      scalpConfidenceThreshold: 64,
      scalpLateConfidenceThreshold: 76,
      reversalPrimaryDistanceFloor: tradingConfig.reversalPrimaryDistanceFloor,
      reversalPrimaryAtrMultiplier: tradingConfig.reversalPrimaryAtrMultiplier,
      reversalLateDistanceFloor: tradingConfig.reversalLateDistanceFloor,
      reversalLateAtrMultiplier: tradingConfig.reversalLateAtrMultiplier,
      reversalConfidenceThreshold: 66,
      reversalLateConfidenceThreshold: 70,
    },
  ];
}

function toStrategyStateSnapshot(row: StrategyStateRow | null | undefined): StrategyStateSnapshot {
  if (!row) {
    const fallback = buildStrategyCatalog().find((profile) => profile.slug === DEFAULT_POLICY_SLUG)!;
    return {
      activePolicySlug: fallback.slug,
      activePolicyName: fallback.name,
      changedAt: new Date(0).toISOString(),
      source: "default",
      notes: "Default live tuner.",
    };
  }

  return {
    activePolicySlug: row.active_policy_slug,
    activePolicyName: row.active_policy_name,
    changedAt: row.changed_at,
    source: row.source,
    notes: row.notes,
  };
}

function shouldRefreshCachedState(force = false) {
  if (force) {
    return true;
  }

  const loadedAt = strategyStateCache.__btcStrategyStateLoadedAt ?? 0;
  return Date.now() - loadedAt > STRATEGY_STATE_TTL_MS;
}

function setCachedStrategyState(state: StrategyStateSnapshot) {
  strategyStateCache.__btcStrategyState = state;
  strategyStateCache.__btcStrategyStateLoadedAt = Date.now();
  return state;
}

async function ensureStrategyStateRow() {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return toStrategyStateSnapshot(null);
  }

  const defaultProfile = buildStrategyCatalog().find((profile) => profile.slug === DEFAULT_POLICY_SLUG)!;
  const changedAt = new Date().toISOString();
  const payload = {
    scope: STRATEGY_STATE_SCOPE,
    active_policy_slug: defaultProfile.slug,
    active_policy_name: defaultProfile.name,
    source: "default" as const,
    notes: "Default live tuner.",
    changed_at: changedAt,
  };

  await supabase.from("bot_strategy_state").upsert(payload, { onConflict: "scope" });
  return toStrategyStateSnapshot(payload);
}

export function listStrategyCatalog() {
  return buildStrategyCatalog();
}

export function getStrategyProfileBySlug(slug: string, activePolicySlug = DEFAULT_POLICY_SLUG) {
  const profile =
    buildStrategyCatalog().find((entry) => entry.slug === slug) ??
    buildStrategyCatalog().find((entry) => entry.slug === DEFAULT_POLICY_SLUG)!;

  return {
    ...profile,
    isChampion: profile.slug === activePolicySlug,
  } satisfies StrategyProfile;
}

export async function getStrategyState(force = false) {
  if (!shouldRefreshCachedState(force) && strategyStateCache.__btcStrategyState) {
    return strategyStateCache.__btcStrategyState;
  }

  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return setCachedStrategyState(toStrategyStateSnapshot(null));
  }

  const { data, error } = await supabase
    .from("bot_strategy_state")
    .select("*")
    .eq("scope", STRATEGY_STATE_SCOPE)
    .maybeSingle();

  if (error) {
    return setCachedStrategyState(toStrategyStateSnapshot(null));
  }

  if (!data) {
    return setCachedStrategyState(await ensureStrategyStateRow());
  }

  return setCachedStrategyState(toStrategyStateSnapshot(data as StrategyStateRow));
}

export async function getActiveStrategyProfile() {
  const state = await getStrategyState();
  return getStrategyProfileBySlug(state.activePolicySlug, state.activePolicySlug);
}

export async function getResearchStrategyProfiles() {
  const state = await getStrategyState();
  return buildStrategyCatalog().map((profile) => ({
    ...profile,
    isChampion: profile.slug === state.activePolicySlug,
  })) satisfies StrategyProfile[];
}

export async function getRecentStrategyChanges(limit = 8) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return [] as TunerChangeRecord[];
  }

  const { data } = await supabase
    .from("bot_strategy_changes")
    .select("*")
    .order("promoted_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as StrategyChangeRow[]).map((row) => ({
    id: row.id,
    fromPolicySlug: row.from_policy_slug,
    fromPolicyName: row.from_policy_name,
    toPolicySlug: row.to_policy_slug,
    toPolicyName: row.to_policy_name,
    source: row.source,
    reason: row.reason,
    promotedAt: row.promoted_at,
  }));
}

export async function setActiveStrategyProfile(input: {
  toPolicySlug: string;
  source: TunerChangeRecord["source"];
  reason?: string | null;
}) {
  const supabase = createAdminSupabaseClient();
  const currentState = await getStrategyState(true);
  const nextProfile = getStrategyProfileBySlug(input.toPolicySlug, input.toPolicySlug);
  if (!supabase) {
    return setCachedStrategyState({
      activePolicySlug: nextProfile.slug,
      activePolicyName: nextProfile.name,
      changedAt: new Date().toISOString(),
      source: input.source === "manual" ? "manual" : "auto-promotion",
      notes: input.reason ?? null,
    });
  }

  if (currentState.activePolicySlug === nextProfile.slug) {
    return currentState;
  }

  const changedAt = new Date().toISOString();
  const nextState: StrategyStateSnapshot = {
    activePolicySlug: nextProfile.slug,
    activePolicyName: nextProfile.name,
    changedAt,
    source: input.source === "manual" ? "manual" : "auto-promotion",
    notes: input.reason ?? null,
  };

  await supabase.from("bot_strategy_state").upsert(
    {
      scope: STRATEGY_STATE_SCOPE,
      active_policy_slug: nextState.activePolicySlug,
      active_policy_name: nextState.activePolicyName,
      source: nextState.source,
      notes: nextState.notes,
      changed_at: nextState.changedAt,
    },
    { onConflict: "scope" },
  );

  await supabase.from("bot_strategy_changes").insert({
    id: crypto.randomUUID(),
    from_policy_slug: currentState.activePolicySlug,
    from_policy_name: currentState.activePolicyName,
    to_policy_slug: nextState.activePolicySlug,
    to_policy_name: nextState.activePolicyName,
    source: input.source,
    reason: input.reason ?? null,
    promoted_at: changedAt,
  });

  return setCachedStrategyState(nextState);
}
