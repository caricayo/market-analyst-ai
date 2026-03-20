import { fetchCoinbaseCandlesInRange } from "@/lib/server/coinbase-client";
import { buildTradingDecisionForProfile } from "@/lib/server/decision-engine";
import { getResearchStrategyProfiles } from "@/lib/server/strategy-profiles";
import { tradingConfig } from "@/lib/server/trading-config";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  BotStatusSnapshot,
  IndicatorSnapshot,
  KalshiMarketSnapshot,
  PolicyLeaderboardEntry,
  ResearchPolicyResult,
  ResearchSnapshot,
  ResearchWindowSnapshot,
} from "@/lib/trading-types";

type ResearchWindowRow = {
  id: string;
  market_ticker: string;
  close_time: string | null;
  observed_at: string;
  minute_in_window: number;
  strike_price_dollars: number | string | null;
  current_price_dollars: number | string | null;
  status: "pending" | "resolved";
  champion_policy_slug: string;
  resolution_outcome: "above" | "below" | null;
  settlement_price_dollars: number | string | null;
  resolved_at: string | null;
};

type PolicyEvaluationRow = {
  id: string;
  window_id: string;
  policy_slug: string;
  policy_name: string;
  is_champion: boolean;
  setup_type: string;
  call: string;
  candidate_side: "above" | "below" | null;
  should_trade: boolean;
  confidence: number;
  entry_side: "yes" | "no" | null;
  entry_price_dollars: number | string | null;
  contracts: number | string | null;
  max_cost_dollars: number | string | null;
  gate_reasons: string[] | null;
  blockers: string[] | null;
  status: "pending" | "resolved" | "skipped";
  resolution_outcome: "above" | "below" | null;
  settlement_price_dollars: number | string | null;
  paper_pnl_dollars: number | string | null;
  created_at: string;
  resolved_at: string | null;
};

function parseNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function getEntrySideAndPrice(
  market: KalshiMarketSnapshot | null,
  outcome: "above" | "below" | null,
) {
  if (!market || !outcome) {
    return { entrySide: null, entryPriceDollars: null };
  }

  const side = outcome === "above" ? market.mapping.aboveSide : market.mapping.belowSide;
  return {
    entrySide: side,
    entryPriceDollars: side === "yes" ? market.yesAskPrice : market.noAskPrice,
  };
}

function buildResearchPolicyResult(input: {
  market: KalshiMarketSnapshot | null;
  decision: Awaited<ReturnType<typeof buildTradingDecisionForProfile>>;
  policySlug: string;
  policyName: string;
  isChampion: boolean;
  createdAt: string;
}) {
  const { entrySide, entryPriceDollars } = getEntrySideAndPrice(input.market, input.decision.derivedOutcome);
  const contracts =
    entryPriceDollars && entryPriceDollars > 0
      ? Math.max(1, Math.floor(tradingConfig.stakeDollars / entryPriceDollars))
      : null;
  const maxCostDollars =
    contracts !== null && entryPriceDollars !== null
      ? round(contracts * entryPriceDollars, 2)
      : null;

  return {
    policySlug: input.policySlug,
    policyName: input.policyName,
    isChampion: input.isChampion,
    setupType: input.decision.setupType,
    call: input.decision.call,
    candidateSide: input.decision.candidateSide,
    shouldTrade: input.decision.shouldTrade,
    confidence: input.decision.confidence,
    entrySide,
    entryPriceDollars: round(entryPriceDollars, 2),
    contracts,
    maxCostDollars,
    gateReasons: input.decision.gateReasons,
    blockers: input.decision.blockers,
    status: input.decision.shouldTrade ? "pending" : "skipped",
    resolutionOutcome: null,
    settlementPriceDollars: null,
    paperPnlDollars: null,
    createdAt: input.createdAt,
    resolvedAt: null,
  } satisfies ResearchPolicyResult;
}

async function getSettlementPriceAt(closeTime: string) {
  const closeDate = new Date(closeTime);
  const candles = await fetchCoinbaseCandlesInRange(
    new Date(closeDate.getTime() - 5 * 60_000),
    new Date(closeDate.getTime() + 2 * 60_000),
  );

  const closeUnix = Math.floor(closeDate.getTime() / 1000);
  const candleAtOrBeforeClose =
    [...candles]
      .filter((candle) => candle.start <= closeUnix)
      .sort((left, right) => right.start - left.start)[0] ?? null;
  const nearestCandle =
    candleAtOrBeforeClose ??
    [...candles].sort(
      (left, right) => Math.abs(left.start - closeUnix) - Math.abs(right.start - closeUnix),
    )[0] ??
    null;

  return nearestCandle ? round(nearestCandle.close, 2) : null;
}

function getResolutionOutcome(settlementPriceDollars: number | null, strikePriceDollars: number | null) {
  if (settlementPriceDollars === null || strikePriceDollars === null) {
    return null;
  }

  return settlementPriceDollars >= strikePriceDollars ? "above" : "below";
}

function getPaperPnl(result: ResearchPolicyResult, resolutionOutcome: "above" | "below" | null) {
  if (
    !result.shouldTrade ||
    result.entryPriceDollars === null ||
    result.contracts === null ||
    resolutionOutcome === null ||
    result.candidateSide === null
  ) {
    return null;
  }

  const won = result.candidateSide === resolutionOutcome;
  const settlementValue = won ? 1 : 0;
  return round((settlementValue - result.entryPriceDollars) * result.contracts, 4);
}

function mapWindow(
  row: ResearchWindowRow,
  policyRows: PolicyEvaluationRow[],
): ResearchWindowSnapshot {
  return {
    id: row.id,
    marketTicker: row.market_ticker,
    closeTime: row.close_time,
    observedAt: row.observed_at,
    minuteInWindow: row.minute_in_window,
    strikePrice: parseNumber(row.strike_price_dollars),
    currentPrice: parseNumber(row.current_price_dollars),
    resolutionOutcome: row.resolution_outcome,
    settlementPriceDollars: parseNumber(row.settlement_price_dollars),
    status: row.status,
    championPolicySlug: row.champion_policy_slug,
    policyResults: policyRows.map((policyRow) => ({
      policySlug: policyRow.policy_slug,
      policyName: policyRow.policy_name,
      isChampion: policyRow.is_champion,
      setupType: policyRow.setup_type as ResearchPolicyResult["setupType"],
      call: policyRow.call as ResearchPolicyResult["call"],
      candidateSide: policyRow.candidate_side,
      shouldTrade: policyRow.should_trade,
      confidence: policyRow.confidence,
      entrySide: policyRow.entry_side,
      entryPriceDollars: parseNumber(policyRow.entry_price_dollars),
      contracts: parseNumber(policyRow.contracts),
      maxCostDollars: parseNumber(policyRow.max_cost_dollars),
      gateReasons: policyRow.gate_reasons ?? [],
      blockers: policyRow.blockers ?? [],
      status: policyRow.status,
      resolutionOutcome: policyRow.resolution_outcome,
      settlementPriceDollars: parseNumber(policyRow.settlement_price_dollars),
      paperPnlDollars: parseNumber(policyRow.paper_pnl_dollars),
      createdAt: policyRow.created_at,
      resolvedAt: policyRow.resolved_at,
    })),
  };
}

function buildLeaderboard(policyRows: PolicyEvaluationRow[]): PolicyLeaderboardEntry[] {
  const grouped = new Map<string, PolicyLeaderboardEntry>();

  for (const row of policyRows) {
    const key = row.policy_slug;
    const current =
      grouped.get(key) ??
      {
        policySlug: row.policy_slug,
        policyName: row.policy_name,
        isChampion: row.is_champion,
        windows: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        hitRate: 0,
        totalPaperPnlDollars: 0,
        avgPaperPnlDollars: 0,
      };

    current.windows += 1;
    if (row.should_trade) {
      current.trades += 1;
    }

    const pnl = parseNumber(row.paper_pnl_dollars);
    if (pnl !== null) {
      current.totalPaperPnlDollars = round(current.totalPaperPnlDollars + pnl, 4) ?? current.totalPaperPnlDollars;
      if (pnl > 0) {
        current.wins += 1;
      } else if (pnl < 0) {
        current.losses += 1;
      }
    }

    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      hitRate: entry.trades > 0 ? round(entry.wins / entry.trades, 4) ?? 0 : 0,
      avgPaperPnlDollars: entry.trades > 0 ? round(entry.totalPaperPnlDollars / entry.trades, 4) ?? 0 : 0,
    }))
    .sort((left, right) => {
      if (left.totalPaperPnlDollars !== right.totalPaperPnlDollars) {
        return right.totalPaperPnlDollars - left.totalPaperPnlDollars;
      }
      return right.hitRate - left.hitRate;
    });
}

export async function recordResearchWindow(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot | null;
  minuteInWindow: number;
  timingRisk: BotStatusSnapshot["timingRisk"];
}) {
  const supabase = createAdminSupabaseClient();
  const market = input.market;
  const indicators = input.indicators;
  if (!supabase || !market || !indicators || !market.closeTime) {
    return;
  }

  const existing = await supabase
    .from("bot_research_windows")
    .select("id")
    .eq("market_ticker", market.ticker)
    .maybeSingle();
  if (existing.data?.id) {
    return;
  }

  const createdAt = new Date().toISOString();
  const profiles = getResearchStrategyProfiles();
  const decisions = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      decision: await buildTradingDecisionForProfile({
        market: input.market,
        indicators,
        minuteInWindow: input.minuteInWindow,
        timingRisk: input.timingRisk,
        warnings: [],
        profile,
      }),
    })),
  );

  const windowId = crypto.randomUUID();
  const champion = profiles.find((profile) => profile.isChampion) ?? profiles[0];

  const { error: windowError } = await supabase.from("bot_research_windows").insert({
    id: windowId,
    market_ticker: market.ticker,
    close_time: market.closeTime,
    observed_at: createdAt,
    minute_in_window: input.minuteInWindow,
    strike_price_dollars: market.strikePrice,
    current_price_dollars: indicators.currentPrice,
    yes_ask_price_dollars: market.yesAskPrice,
    no_ask_price_dollars: market.noAskPrice,
    yes_bid_price_dollars: market.yesBidPrice,
    no_bid_price_dollars: market.noBidPrice,
    timing_risk: input.timingRisk,
    indicators,
    champion_policy_slug: champion.slug,
    status: "pending",
  });

  if (windowError) {
    throw windowError;
  }

  const policyRows = decisions.map(({ profile, decision }) => {
    const result = buildResearchPolicyResult({
      market,
      decision,
      policySlug: profile.slug,
      policyName: profile.name,
      isChampion: profile.isChampion,
      createdAt,
    });

    return {
      id: crypto.randomUUID(),
      window_id: windowId,
      market_ticker: market.ticker,
      policy_slug: result.policySlug,
      policy_name: result.policyName,
      is_champion: result.isChampion,
      setup_type: result.setupType,
      call: result.call,
      candidate_side: result.candidateSide,
      should_trade: result.shouldTrade,
      confidence: result.confidence,
      entry_side: result.entrySide,
      entry_price_dollars: result.entryPriceDollars,
      contracts: result.contracts,
      max_cost_dollars: result.maxCostDollars,
      gate_reasons: result.gateReasons,
      blockers: result.blockers,
      status: result.status,
    };
  });

  const { error: policyError } = await supabase.from("bot_policy_evaluations").insert(policyRows);
  if (policyError) {
    throw policyError;
  }
}

export async function resolveResearchWindows() {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { data: windows, error } = await supabase
    .from("bot_research_windows")
    .select("*")
    .eq("status", "pending")
    .lt("close_time", new Date().toISOString())
    .order("close_time", { ascending: true })
    .limit(20);

  if (error) {
    throw error;
  }

  for (const row of (windows ?? []) as ResearchWindowRow[]) {
    if (!row.close_time) {
      continue;
    }

    const settlementPriceDollars = await getSettlementPriceAt(row.close_time).catch(() => null);
    const resolutionOutcome = getResolutionOutcome(
      settlementPriceDollars,
      parseNumber(row.strike_price_dollars),
    );
    const resolvedAt = new Date().toISOString();

    await supabase
      .from("bot_research_windows")
      .update({
        status: "resolved",
        settlement_price_dollars: settlementPriceDollars,
        resolution_outcome: resolutionOutcome,
        resolved_at: resolvedAt,
        updated_at: resolvedAt,
      })
      .eq("id", row.id);

    const { data: evals } = await supabase
      .from("bot_policy_evaluations")
      .select("*")
      .eq("window_id", row.id);

    for (const evalRow of ((evals ?? []) as PolicyEvaluationRow[])) {
      const result = {
        policySlug: evalRow.policy_slug,
        policyName: evalRow.policy_name,
        isChampion: evalRow.is_champion,
        setupType: evalRow.setup_type as ResearchPolicyResult["setupType"],
        call: evalRow.call as ResearchPolicyResult["call"],
        candidateSide: evalRow.candidate_side,
        shouldTrade: evalRow.should_trade,
        confidence: evalRow.confidence,
        entrySide: evalRow.entry_side,
        entryPriceDollars: parseNumber(evalRow.entry_price_dollars),
        contracts: parseNumber(evalRow.contracts),
        maxCostDollars: parseNumber(evalRow.max_cost_dollars),
        gateReasons: evalRow.gate_reasons ?? [],
        blockers: evalRow.blockers ?? [],
        status: evalRow.status,
        resolutionOutcome: null,
        settlementPriceDollars: null,
        paperPnlDollars: null,
        createdAt: evalRow.created_at,
        resolvedAt: null,
      } satisfies ResearchPolicyResult;
      const paperPnlDollars = getPaperPnl(result, resolutionOutcome);

      await supabase
        .from("bot_policy_evaluations")
        .update({
          status: result.shouldTrade ? "resolved" : "skipped",
          resolution_outcome: resolutionOutcome,
          settlement_price_dollars: settlementPriceDollars,
          paper_pnl_dollars: paperPnlDollars,
          resolved_at: resolvedAt,
          updated_at: resolvedAt,
        })
        .eq("id", evalRow.id);
    }
  }
}

export async function getResearchSnapshot() {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return null;
  }

  const [{ data: windows }, { data: evals }] = await Promise.all([
    supabase.from("bot_research_windows").select("*").order("observed_at", { ascending: false }).limit(50),
    supabase.from("bot_policy_evaluations").select("*").order("created_at", { ascending: false }).limit(400),
  ]);

  const typedWindows = (windows ?? []) as ResearchWindowRow[];
  const typedEvals = (evals ?? []) as PolicyEvaluationRow[];
  const latestWindow = typedWindows[0]
    ? mapWindow(
        typedWindows[0],
        typedEvals.filter((evaluation) => evaluation.window_id === typedWindows[0].id),
      )
    : null;

  return {
    pendingWindows: typedWindows.filter((window) => window.status === "pending").length,
    resolvedWindows: typedWindows.filter((window) => window.status === "resolved").length,
    latestWindow,
    leaderboard: buildLeaderboard(typedEvals.filter((evaluation) => evaluation.status !== "pending")),
  } satisfies ResearchSnapshot;
}
