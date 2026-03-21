import { tradingConfig } from "@/lib/server/trading-config";
import { getActiveStrategyProfile, type StrategyProfile } from "@/lib/server/strategy-profiles";
import type {
  IndicatorSnapshot,
  KalshiMarketSnapshot,
  TimingRiskLevel,
  TradingDecision,
} from "@/lib/trading-types";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function deriveOutcomeMapping(market: KalshiMarketSnapshot | null, call: TradingDecision["call"]) {
  if (!market || call === "no_trade") {
    return {
      derivedSide: null,
      derivedOutcome: null,
    };
  }

  return {
    derivedSide: call === "above" ? market.mapping.aboveSide : market.mapping.belowSide,
    derivedOutcome: call,
  };
}

function getDirectionalAskPrice(
  market: KalshiMarketSnapshot | null,
  call: "above" | "below",
) {
  if (!market) {
    return null;
  }

  const side = call === "above" ? market.mapping.aboveSide : market.mapping.belowSide;
  return side === "yes" ? market.yesAskPrice : market.noAskPrice;
}

function describeTimingContext(timingRisk: TimingRiskLevel) {
  switch (timingRisk) {
    case "high-risk-open":
      return "Open-window tape is being used as context only, not as a hard trade blocker.";
    case "late-window":
      return "Late-window tape is being handled like a fast intraday scalp, not a no-trade zone.";
    case "blocked-close":
      return "Very late tape is still being scored, but confidence must carry the decision.";
    default:
      return "Core trade-window tape is being scored as a short intraday scalp.";
  }
}

function buildScalpScore(indicators: IndicatorSnapshot) {
  const distanceScore =
    indicators.distanceToStrike !== null
      ? clamp(
          (indicators.distanceToStrike / Math.max(indicators.atr14 ?? 40, 25)) * 18,
          -22,
          22,
        )
      : 0;
  const momentumComposite =
    (indicators.momentum5 ?? 0) * 0.55 +
    (indicators.momentum15 ?? 0) * 0.35 +
    (indicators.momentum30 ?? 0) * 0.1;
  const momentumScore = clamp(momentumComposite / 2.6, -18, 18);
  const emaScore =
    (indicators.ema9 !== null
      ? indicators.currentPrice >= indicators.ema9
        ? 4
        : -4
      : 0) +
    (indicators.ema9 !== null && indicators.ema21 !== null
      ? indicators.ema9 >= indicators.ema21
        ? 4
        : -4
      : 0) +
    (indicators.ema21 !== null && indicators.ema55 !== null
      ? indicators.ema21 >= indicators.ema55
        ? 3
        : -3
      : 0);
  const vwapScore =
    indicators.vwap === null ? 0 : indicators.currentPrice >= indicators.vwap ? 3 : -3;
  const rsiScore =
    indicators.rsi14 === null ? 0 : clamp((indicators.rsi14 - 50) / 2.4, -10, 10);
  const edgeScore = clamp(indicators.deterministicEdge * 18, -24, 24);

  return {
    rawScore: distanceScore + momentumScore + emaScore + vwapScore + rsiScore + edgeScore,
    distanceScore,
    momentumScore,
    emaScore,
    vwapScore,
    rsiScore,
    edgeScore,
  };
}

function buildReasoning(
  indicators: IndicatorSnapshot,
  call: "above" | "below",
  timingRisk: TimingRiskLevel,
  score: ReturnType<typeof buildScalpScore>,
) {
  const directionLabel = call.toUpperCase();
  const reasoning: string[] = [
    `Scalp ${directionLabel} is driven by a composite intraday score of ${score.rawScore.toFixed(2)} built from distance-to-strike, momentum, EMA structure, VWAP, RSI, and deterministic edge.`,
    `Distance to strike is ${indicators.distanceToStrike?.toFixed(2) ?? "n/a"} with ATR14 at ${indicators.atr14?.toFixed(2) ?? "n/a"}, which gives the move context relative to current volatility.`,
    `Momentum stack is 5m ${indicators.momentum5?.toFixed(2) ?? "n/a"}, 15m ${indicators.momentum15?.toFixed(2) ?? "n/a"}, 30m ${indicators.momentum30?.toFixed(2) ?? "n/a"}.`,
    `EMA / VWAP structure is being treated as tape confirmation, with EMA9 ${indicators.ema9?.toFixed(2) ?? "n/a"}, EMA21 ${indicators.ema21?.toFixed(2) ?? "n/a"}, EMA55 ${indicators.ema55?.toFixed(2) ?? "n/a"}, and VWAP ${indicators.vwap?.toFixed(2) ?? "n/a"}.`,
    describeTimingContext(timingRisk),
  ];

  const gateReasons = [
    score.distanceScore >= 0 === (call === "above")
      ? `Distance-to-strike pressure favors ${directionLabel}.`
      : `Distance-to-strike pressure is mixed, but the rest of the tape still favors ${directionLabel}.`,
    score.momentumScore >= 0 === (call === "above")
      ? `Short momentum stack favors ${directionLabel}.`
      : `Short momentum is mixed, but price structure still leans ${directionLabel}.`,
    score.emaScore >= 0 === (call === "above")
      ? `EMA structure favors ${directionLabel}.`
      : `EMA structure is mixed, but the composite score still favors ${directionLabel}.`,
    score.vwapScore >= 0 === (call === "above")
      ? `Price vs VWAP favors ${directionLabel}.`
      : `VWAP is not fully aligned, but it was not strong enough to flip the direction.`,
    `Deterministic edge is ${indicators.deterministicEdge.toFixed(3)} and contributes to the ${directionLabel} read.`,
  ];

  return {
    reasoning,
    gateReasons: uniqueStrings(gateReasons),
  };
}

export async function buildTradingDecisionForProfile(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  warnings: string[];
  profile: StrategyProfile;
}) {
  const blockers = [...input.warnings];

  if (!input.market) {
    blockers.push("No active Kalshi BTC market is available.");
  }

  if (input.market?.strikePrice === null) {
    blockers.push("The active Kalshi market did not expose a usable strike price.");
  }

  if (input.indicators.currentPrice <= 0) {
    blockers.push("Coinbase did not return a usable BTC price.");
  }

  if (blockers.length) {
    const mapping = deriveOutcomeMapping(input.market, "no_trade");
    return {
      call: "no_trade",
      confidence: 50,
      deterministicConfidence: 50,
      summary: "No trade because core market data was missing.",
      reasoning: [
        "The bot now trades a single scalp playbook from confidence direction only.",
        "This cycle was skipped because a required market or price input was missing.",
      ],
      setupType: "none",
      candidateSide: null,
      timingRisk: input.timingRisk,
      shouldTrade: false,
      aiVetoed: false,
      derivedSide: mapping.derivedSide,
      derivedOutcome: mapping.derivedOutcome,
      gateReasons: [],
      blockers: uniqueStrings(blockers),
    } satisfies TradingDecision;
  }

  const score = buildScalpScore(input.indicators);
  const call: "above" | "below" = score.rawScore >= 0 ? "above" : "below";
  const directionalAskPrice = getDirectionalAskPrice(input.market, call);
  const openWindowConvictionTriggered =
    input.minuteInWindow >= 1 &&
    input.minuteInWindow <= 3 &&
    directionalAskPrice !== null &&
    directionalAskPrice >= 0.6 &&
    Math.abs(score.rawScore) >= 10;
  const confidence = clamp(
    Math.round(52 + Math.abs(score.rawScore) * 0.9 + (openWindowConvictionTriggered ? 8 : 0)),
    52,
    95,
  );
  const requiredConfidence = Math.min(tradingConfig.confidenceThreshold, 58);
  const meetsConfidence = confidence >= requiredConfidence;
  const mapping = deriveOutcomeMapping(input.market, meetsConfidence ? call : "no_trade");
  const { reasoning, gateReasons } = buildReasoning(input.indicators, call, input.timingRisk, score);

  if (openWindowConvictionTriggered) {
    reasoning.push(
      `Open-window conviction trigger fired: minute ${input.minuteInWindow} is early, but the ${call.toUpperCase()} side is already trading ${directionalAskPrice?.toFixed(2)} with strong directional score support.`,
    );
    gateReasons.push(
      `Open-window conviction rule passed because the chosen side is already priced at ${directionalAskPrice?.toFixed(2)} with strong directional support.`,
    );
  }

  if (!meetsConfidence) {
    blockers.push(
      `Scalp confidence ${confidence} is below the live trigger threshold of ${requiredConfidence}.`,
    );
  }

  return {
    call: meetsConfidence ? call : "no_trade",
    confidence,
    deterministicConfidence: confidence,
    summary: meetsConfidence
      ? `Scalp ${call.toUpperCase()} setup based on intraday tape pressure and short-term directional confidence.`
      : `No trade because the intraday scalp confidence only reached ${confidence}.`,
    reasoning,
    setupType: meetsConfidence ? "scalp" : "none",
    candidateSide: call,
    timingRisk: input.timingRisk,
    shouldTrade: meetsConfidence && Boolean(mapping.derivedSide),
    aiVetoed: false,
    derivedSide: mapping.derivedSide,
    derivedOutcome: mapping.derivedOutcome,
    gateReasons,
    blockers: uniqueStrings(blockers),
  } satisfies TradingDecision;
}

export async function buildChampionTradingDecision(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  warnings: string[];
}) {
  const profile = await getActiveStrategyProfile();
  return buildTradingDecisionForProfile({
    ...input,
    profile,
  });
}
