import { fetchCoinbaseCandlesInRange, type Candle } from "@/lib/server/coinbase-client";
import { buildTradingDecisionForProfile } from "@/lib/server/decision-engine";
import {
  getRecentStrategyChanges,
  getResearchStrategyProfiles,
  getStrategyProfileBySlug,
  getStrategyState,
  setActiveStrategyProfile,
} from "@/lib/server/strategy-profiles";
import { tradingConfig } from "@/lib/server/trading-config";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  BotStatusSnapshot,
  ExitReason,
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
  timing_risk: BotStatusSnapshot["timingRisk"];
  indicators: IndicatorSnapshot | null;
  status: "pending" | "resolved";
  champion_policy_slug: string;
  champion_policy_name: string | null;
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
  replay_mode: "resolution" | "candle_replay" | null;
  exit_reason: ExitReason | null;
  exit_price_dollars: number | string | null;
  exit_at: string | null;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
    replayMode: "resolution",
    exitReason: null,
    exitPriceDollars: null,
    exitAt: null,
    createdAt: input.createdAt,
    resolvedAt: null,
  } satisfies ResearchPolicyResult;
}

function getSettlementPriceFromCandles(candles: Candle[], closeTime: string) {
  const closeUnix = Math.floor(Date.parse(closeTime) / 1000);
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

function getSignedDistance(outcome: "above" | "below", price: number, strikePrice: number) {
  return outcome === "above" ? price - strikePrice : strikePrice - price;
}

function getReplayTradeSettings(
  setupType: Exclude<ResearchPolicyResult["setupType"], "none">,
  entryPriceDollars: number,
  closeTime: string | null,
  minuteInWindow: number,
) {
  const profitTargetCents =
    setupType === "trend"
      ? tradingConfig.trendProfitTargetCents
      : setupType === "reversal"
        ? tradingConfig.reversalProfitTargetCents
        : tradingConfig.scalpProfitTargetCents;
  const baseStopLossCents =
    setupType === "trend"
      ? tradingConfig.trendStopLossCents
      : setupType === "reversal"
        ? tradingConfig.reversalStopLossCents
        : tradingConfig.scalpStopLossCents;
  const effectiveStopLossCents =
    minuteInWindow >= 1 && minuteInWindow <= 3
      ? Math.min(baseStopLossCents, tradingConfig.openWindowStopLossCents)
      : baseStopLossCents;
  const forcedExitLeadSeconds =
    setupType === "trend"
      ? tradingConfig.trendForcedExitLeadSeconds
      : setupType === "reversal"
        ? tradingConfig.reversalForcedExitLeadSeconds
        : tradingConfig.scalpForcedExitLeadSeconds;

  return {
    targetPriceDollars: clamp(round(entryPriceDollars + profitTargetCents / 100, 2) ?? 0.99, 0.01, 0.99),
    stopPriceDollars: clamp(round(entryPriceDollars - effectiveStopLossCents / 100, 2) ?? 0.01, 0.01, 0.99),
    forcedExitAtMs: Math.max(
      Date.now(),
      Date.parse(closeTime ?? new Date().toISOString()) - forcedExitLeadSeconds * 1_000,
    ),
  };
}

function getTrendReplayStop(
  entryPriceDollars: number,
  baseStopPriceDollars: number,
  peakPriceDollars: number,
  entryTimeMs: number,
  currentTimeMs: number,
) {
  let stopPriceDollars = baseStopPriceDollars;
  const armThresholdPrice =
    entryPriceDollars + tradingConfig.trendBreakevenTriggerCents / 100;
  const trailThresholdPrice =
    entryPriceDollars + tradingConfig.trendTrailTriggerCents / 100;
  const shouldArmByTime = currentTimeMs - entryTimeMs >= tradingConfig.trendStopArmSeconds * 1_000;
  const shouldArmByProfit = peakPriceDollars >= armThresholdPrice;
  const stopActive = shouldArmByTime || shouldArmByProfit;

  if (peakPriceDollars >= armThresholdPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clamp(entryPriceDollars + tradingConfig.trendBreakevenLockCents / 100, 0.01, 0.99),
    );
  }

  if (peakPriceDollars >= trailThresholdPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clamp(peakPriceDollars - tradingConfig.trendTrailOffsetCents / 100, 0.01, 0.99),
    );
  }

  return {
    stopActive,
    stopPriceDollars: clamp(stopPriceDollars, 0.01, 0.99),
  };
}

function getScalpReplayStop(
  entryPriceDollars: number,
  baseStopPriceDollars: number,
  peakPriceDollars: number,
) {
  let stopPriceDollars = baseStopPriceDollars;
  const breakevenTriggerPrice =
    entryPriceDollars + tradingConfig.scalpBreakevenTriggerCents / 100;
  const trailTriggerPrice =
    entryPriceDollars + tradingConfig.scalpTrailTriggerCents / 100;

  if (peakPriceDollars >= breakevenTriggerPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clamp(entryPriceDollars + tradingConfig.scalpBreakevenLockCents / 100, 0.01, 0.99),
    );
  }

  if (peakPriceDollars >= trailTriggerPrice) {
    stopPriceDollars = Math.max(
      stopPriceDollars,
      clamp(peakPriceDollars - tradingConfig.scalpTrailOffsetCents / 100, 0.01, 0.99),
    );
  }

  return {
    stopActive: true,
    stopPriceDollars: clamp(stopPriceDollars, 0.01, 0.99),
  };
}

function getProxyContractPrice(input: {
  outcome: "above" | "below";
  currentPrice: number;
  strikePrice: number;
  entryPriceDollars: number;
  entryCurrentPrice: number;
  atr14: number | null;
}) {
  const scale = Math.max(input.atr14 ?? 0, 25);
  const baseDistance = getSignedDistance(input.outcome, input.entryCurrentPrice, input.strikePrice);
  const currentDistance = getSignedDistance(input.outcome, input.currentPrice, input.strikePrice);
  const baseSignal = Math.tanh(baseDistance / scale);
  const currentSignal = Math.tanh(currentDistance / scale);
  return clamp(round(input.entryPriceDollars + 0.48 * (currentSignal - baseSignal), 2) ?? input.entryPriceDollars, 0.01, 0.99);
}

function replayPolicyEvaluation(input: {
  result: ResearchPolicyResult;
  window: ResearchWindowRow;
  candles: Candle[];
  settlementPriceDollars: number | null;
  resolutionOutcome: "above" | "below" | null;
}) {
  const result = input.result;
  const strikePrice = parseNumber(input.window.strike_price_dollars);
  const currentPrice = parseNumber(input.window.current_price_dollars);
  const atr14 = input.window.indicators?.atr14 ?? null;
  if (
    !result.shouldTrade ||
    result.setupType === "none" ||
    result.candidateSide === null ||
    result.entryPriceDollars === null ||
    result.contracts === null ||
    strikePrice === null ||
    currentPrice === null
  ) {
    return {
      replayMode: "candle_replay" as const,
      exitReason: null,
      exitPriceDollars: null,
      exitAt: null,
      paperPnlDollars: null,
    };
  }

  const settings = getReplayTradeSettings(
    result.setupType,
    result.entryPriceDollars,
    input.window.close_time,
    input.window.minute_in_window,
  );
  const entryTimeMs = Date.parse(input.window.observed_at);
  let peakPriceDollars = result.entryPriceDollars;
  let dynamicStopPriceDollars = settings.stopPriceDollars;

  const replayCandles = [...input.candles]
    .filter((candle) => candle.start * 1000 >= entryTimeMs)
    .sort((left, right) => left.start - right.start);

  for (const candle of replayCandles) {
    const candleTimeMs = candle.start * 1000;
    const proxyPrice = getProxyContractPrice({
      outcome: result.candidateSide,
      currentPrice: candle.close,
      strikePrice,
      entryPriceDollars: result.entryPriceDollars,
      entryCurrentPrice: currentPrice,
      atr14,
    });
    peakPriceDollars = Math.max(peakPriceDollars, proxyPrice);

    const stopState =
      result.setupType === "trend" && !(input.window.minute_in_window >= 1 && input.window.minute_in_window <= 3)
        ? getTrendReplayStop(
            result.entryPriceDollars,
            settings.stopPriceDollars,
            peakPriceDollars,
            entryTimeMs,
            candleTimeMs,
          )
        : result.setupType === "scalp"
          ? getScalpReplayStop(result.entryPriceDollars, settings.stopPriceDollars, peakPriceDollars)
          : {
              stopActive: true,
              stopPriceDollars: settings.stopPriceDollars,
            };

    dynamicStopPriceDollars = stopState.stopPriceDollars;

    if (candleTimeMs >= settings.forcedExitAtMs) {
      return {
        replayMode: "candle_replay" as const,
        exitReason: "time" as const,
        exitPriceDollars: proxyPrice,
        exitAt: new Date(candleTimeMs).toISOString(),
        paperPnlDollars: round((proxyPrice - result.entryPriceDollars) * result.contracts, 4),
      };
    }

    if (proxyPrice >= settings.targetPriceDollars) {
      return {
        replayMode: "candle_replay" as const,
        exitReason: "target" as const,
        exitPriceDollars: proxyPrice,
        exitAt: new Date(candleTimeMs).toISOString(),
        paperPnlDollars: round((proxyPrice - result.entryPriceDollars) * result.contracts, 4),
      };
    }

    if (stopState.stopActive && proxyPrice <= dynamicStopPriceDollars) {
      return {
        replayMode: "candle_replay" as const,
        exitReason: "stop" as const,
        exitPriceDollars: proxyPrice,
        exitAt: new Date(candleTimeMs).toISOString(),
        paperPnlDollars: round((proxyPrice - result.entryPriceDollars) * result.contracts, 4),
      };
    }
  }

  const fallbackOutcomeWon = input.resolutionOutcome !== null && result.candidateSide === input.resolutionOutcome;
  const fallbackExitPriceDollars =
    input.settlementPriceDollars === null
      ? null
      : fallbackOutcomeWon
        ? 0.99
        : 0.01;

  return {
    replayMode: "candle_replay" as const,
    exitReason: fallbackExitPriceDollars === null ? null : ("expired" as const),
    exitPriceDollars: fallbackExitPriceDollars,
    exitAt: input.window.close_time,
    paperPnlDollars:
      fallbackExitPriceDollars === null
        ? null
        : round((fallbackExitPriceDollars - result.entryPriceDollars) * result.contracts, 4),
  };
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
      replayMode: policyRow.replay_mode ?? "resolution",
      exitReason: policyRow.exit_reason,
      exitPriceDollars: parseNumber(policyRow.exit_price_dollars),
      exitAt: policyRow.exit_at,
      createdAt: policyRow.created_at,
      resolvedAt: policyRow.resolved_at,
    })),
  };
}

function buildLeaderboard(policyRows: PolicyEvaluationRow[], activePolicySlug: string): PolicyLeaderboardEntry[] {
  const grouped = new Map<string, PolicyLeaderboardEntry>();

  for (const row of policyRows) {
    const key = row.policy_slug;
    const current =
      grouped.get(key) ??
      {
        policySlug: row.policy_slug,
        policyName: row.policy_name,
        isChampion: row.policy_slug === activePolicySlug,
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
      isChampion: entry.policySlug === activePolicySlug,
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

async function resolveWindowEvaluations(
  supabase: NonNullable<ReturnType<typeof createAdminSupabaseClient>>,
  row: ResearchWindowRow,
  resolvedAtOverride?: string,
) {
  if (!row.close_time) {
    return;
  }

  const candlePath = await fetchCoinbaseCandlesInRange(
    new Date(Date.parse(row.observed_at) - 60_000),
    new Date(Date.parse(row.close_time) + 2 * 60_000),
  ).catch(() => []);
  const settlementPriceDollars = getSettlementPriceFromCandles(candlePath, row.close_time);
  const resolutionOutcome = getResolutionOutcome(
    settlementPriceDollars,
    parseNumber(row.strike_price_dollars),
  );
  const resolvedAt = resolvedAtOverride ?? row.resolved_at ?? new Date().toISOString();

  await supabase
    .from("bot_research_windows")
    .update({
      status: "resolved",
      settlement_price_dollars: settlementPriceDollars,
      resolution_outcome: resolutionOutcome,
      resolved_at: resolvedAt,
      updated_at: new Date().toISOString(),
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
      replayMode: "resolution",
      exitReason: null,
      exitPriceDollars: null,
      exitAt: null,
      createdAt: evalRow.created_at,
      resolvedAt: null,
    } satisfies ResearchPolicyResult;

    const replay = replayPolicyEvaluation({
      result,
      window: row,
      candles: candlePath,
      settlementPriceDollars,
      resolutionOutcome,
    });

    await supabase
      .from("bot_policy_evaluations")
      .update({
        status: result.shouldTrade ? "resolved" : "skipped",
        resolution_outcome: resolutionOutcome,
        settlement_price_dollars: settlementPriceDollars,
        paper_pnl_dollars: replay.paperPnlDollars,
        replay_mode: replay.replayMode,
        exit_reason: replay.exitReason,
        exit_price_dollars: replay.exitPriceDollars,
        exit_at: replay.exitAt,
        resolved_at: resolvedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", evalRow.id);
  }
}

async function maybePromoteBestPolicy(policyRows: PolicyEvaluationRow[]) {
  if (!tradingConfig.researchAutoPromoteEnabled) {
    return null;
  }

  const activeState = await getStrategyState();
  const leaderboard = buildLeaderboard(policyRows, activeState.activePolicySlug);
  const activeEntry = leaderboard.find((entry) => entry.policySlug === activeState.activePolicySlug);
  if (!activeEntry) {
    return null;
  }

  const challenger = leaderboard.find(
    (entry) =>
      entry.policySlug !== activeState.activePolicySlug &&
      entry.windows >= tradingConfig.researchPromotionMinWindows &&
      entry.trades >= tradingConfig.researchPromotionMinTrades &&
      entry.totalPaperPnlDollars >=
        activeEntry.totalPaperPnlDollars + tradingConfig.researchPromotionMinPnlLiftDollars &&
      entry.hitRate + tradingConfig.researchPromotionMaxHitRateRegression >= activeEntry.hitRate,
  );

  if (!challenger) {
    return null;
  }

  const reason =
    `${challenger.policyName} cleared promotion thresholds over ${challenger.windows} resolved windows ` +
    `with paper P&L ${challenger.totalPaperPnlDollars.toFixed(2)} vs ${activeEntry.totalPaperPnlDollars.toFixed(2)} ` +
    `for ${activeEntry.policyName}.`;

  return setActiveStrategyProfile({
    toPolicySlug: challenger.policySlug,
    source: "auto-promotion",
    reason,
  });
}

export async function recordResearchWindow(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot | null;
  minuteInWindow: number;
  timingRisk: BotStatusSnapshot["timingRisk"];
  recordPolicyEvaluations?: boolean;
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
  const shouldRecordPolicies = input.recordPolicyEvaluations ?? true;
  const activeState = await getStrategyState();
  const champion = getStrategyProfileBySlug(activeState.activePolicySlug, activeState.activePolicySlug);
  const windowId = crypto.randomUUID();
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
    champion_policy_name: champion.name,
    status: "pending",
  });

  if (windowError) {
    throw windowError;
  }

  if (!shouldRecordPolicies) {
    return;
  }

  const profiles = await getResearchStrategyProfiles();
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
      replay_mode: result.replayMode,
      exit_reason: result.exitReason,
      exit_price_dollars: result.exitPriceDollars,
      exit_at: result.exitAt,
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
    const resolvedAt = new Date().toISOString();
    await resolveWindowEvaluations(supabase, row, resolvedAt);
  }

  const { data: backfillWindows } = await supabase
    .from("bot_research_windows")
    .select("*")
    .eq("status", "resolved")
    .order("close_time", { ascending: false })
    .limit(20);

  for (const row of (backfillWindows ?? []) as ResearchWindowRow[]) {
    const { count } = await supabase
      .from("bot_policy_evaluations")
      .select("*", { count: "exact", head: true })
      .eq("window_id", row.id)
      .or("replay_mode.is.null,replay_mode.eq.resolution");

    if ((count ?? 0) > 0) {
      await resolveWindowEvaluations(supabase, row, row.resolved_at ?? undefined);
    }
  }

  const { data: resolvedEvals } = await supabase
    .from("bot_policy_evaluations")
    .select("*")
    .eq("status", "resolved")
    .eq("replay_mode", "candle_replay")
    .order("resolved_at", { ascending: false })
    .limit(tradingConfig.researchLeaderboardResolvedLimit);

  await maybePromoteBestPolicy((resolvedEvals ?? []) as PolicyEvaluationRow[]);
}

export async function getResearchSnapshot() {
  const supabase = createAdminSupabaseClient();
  const activeState = await getStrategyState();
  const recentChanges = await getRecentStrategyChanges();
  if (!supabase) {
    return {
      pendingWindows: 0,
      resolvedWindows: 0,
      activeTuner: activeState,
      recentChanges,
      latestWindow: null,
      leaderboard: [],
    } satisfies ResearchSnapshot;
  }

  const [{ data: windows }, { data: resolvedEvals }, { data: recentEvals }] = await Promise.all([
    supabase.from("bot_research_windows").select("*").order("observed_at", { ascending: false }).limit(50),
    supabase
      .from("bot_policy_evaluations")
      .select("*")
      .neq("status", "pending")
      .eq("replay_mode", "candle_replay")
      .order("resolved_at", { ascending: false })
      .limit(tradingConfig.researchLeaderboardResolvedLimit),
    supabase
      .from("bot_policy_evaluations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const typedWindows = (windows ?? []) as ResearchWindowRow[];
  const typedResolvedEvals = (resolvedEvals ?? []) as PolicyEvaluationRow[];
  const typedRecentEvals = (recentEvals ?? []) as PolicyEvaluationRow[];
  const latestWindow = typedWindows[0]
    ? mapWindow(
        typedWindows[0],
        typedRecentEvals.filter((evaluation) => evaluation.window_id === typedWindows[0].id),
      )
    : null;

  return {
    pendingWindows: typedWindows.filter((window) => window.status === "pending").length,
    resolvedWindows: typedWindows.filter((window) => window.status === "resolved").length,
    activeTuner: activeState,
    recentChanges,
    latestWindow,
    leaderboard: buildLeaderboard(typedResolvedEvals, activeState.activePolicySlug),
  } satisfies ResearchSnapshot;
}
