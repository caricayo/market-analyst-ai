import { tradingConfig } from "@/lib/server/trading-config";
import { getActiveStrategyProfile, type StrategyProfile } from "@/lib/server/strategy-profiles";
import type {
  IndicatorSnapshot,
  KalshiMarketSnapshot,
  TimingRiskLevel,
  TapePattern,
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

function classifyTapePattern(
  indicators: IndicatorSnapshot,
  call: "above" | "below",
  score: ReturnType<typeof buildScalpScore>,
): TapePattern {
  const distance = indicators.distanceToStrike ?? 0;
  const momentum5 = indicators.momentum5 ?? 0;
  const momentum15 = indicators.momentum15 ?? 0;
  const rsi = indicators.rsi14 ?? 50;
  const alignedMomentum =
    call === "above" ? momentum5 >= 0 && momentum15 >= 0 : momentum5 <= 0 && momentum15 <= 0;
  const fadingMomentum =
    call === "above" ? momentum5 > 0 && momentum15 < 0 : momentum5 < 0 && momentum15 > 0;
  const stretchedAgainstSignal =
    call === "above"
      ? distance < 0 && Math.abs(distance) >= Math.max(indicators.atr14 ?? 20, 20) * 0.35
      : distance > 0 && Math.abs(distance) >= Math.max(indicators.atr14 ?? 20, 20) * 0.35;
  const exhaustionRsi =
    call === "above" ? rsi <= 42 : rsi >= 58;

  if (Math.abs(score.rawScore) < 8 || Math.abs(momentum5) < 1.5) {
    return "chop";
  }

  if (fadingMomentum && stretchedAgainstSignal && exhaustionRsi) {
    return "possible_reversal";
  }

  if (alignedMomentum && Math.abs(score.rawScore) >= 12) {
    return "continuation";
  }

  return "chop";
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

function buildPredictiveScore(indicators: IndicatorSnapshot) {
  const atr = Math.max(indicators.atr14 ?? 40, 25);
  const distanceToStrike = indicators.distanceToStrike ?? 0;
  const momentum5 = indicators.momentum5 ?? 0;
  const momentum15 = indicators.momentum15 ?? 0;
  const momentum30 = indicators.momentum30 ?? 0;
  const rsi = indicators.rsi14 ?? 50;
  const currentPrice = indicators.currentPrice;
  const ema9 = indicators.ema9;
  const vwap = indicators.vwap;
  const range15 = indicators.range15 ?? atr * 1.1;
  const range60 = indicators.range60 ?? range15 * 2.5;

  const strikePersistenceScore = clamp((distanceToStrike / atr) * 16, -20, 20);
  const momentumPersistenceScore = clamp(
    (momentum5 * 0.45 + momentum15 * 0.4 + momentum30 * 0.15) / 2.2,
    -22,
    22,
  );
  const accelerationScore = clamp((momentum5 - momentum15 * 0.65) / 1.9, -12, 12);
  const microStructureScore =
    (ema9 === null ? 0 : currentPrice >= ema9 ? 5 : -5) +
    (vwap === null ? 0 : currentPrice >= vwap ? 4 : -4);
  const trendStackScore =
    ema9 !== null && indicators.ema21 !== null && indicators.ema55 !== null
      ? ema9 >= indicators.ema21 && indicators.ema21 >= indicators.ema55
        ? 8
        : ema9 <= indicators.ema21 && indicators.ema21 <= indicators.ema55
          ? -8
          : 0
      : 0;
  const volatilityRegimeScore = clamp(((range15 / Math.max(range60, 1)) - 0.24) * 28, -8, 8);
  const exhaustionPenalty =
    distanceToStrike >= 0
      ? clamp((rsi - 68) * 0.55, 0, 10)
      : clamp((32 - rsi) * 0.55, 0, 10);
  const edgeCarryScore = clamp(indicators.deterministicEdge * 10, -12, 12);

  return {
    rawScore:
      strikePersistenceScore +
      momentumPersistenceScore +
      accelerationScore * 0.7 +
      microStructureScore +
      trendStackScore +
      volatilityRegimeScore +
      edgeCarryScore -
      exhaustionPenalty * Math.sign(distanceToStrike || 1),
    strikePersistenceScore,
    momentumPersistenceScore,
    accelerationScore,
    microStructureScore,
    trendStackScore,
    volatilityRegimeScore,
    exhaustionPenalty,
    edgeCarryScore,
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

function buildPredictiveReasoning(
  indicators: IndicatorSnapshot,
  call: "above" | "below",
  timingRisk: TimingRiskLevel,
  predictiveScore: ReturnType<typeof buildPredictiveScore>,
  confirmedCall: "above" | "below",
) {
  const directionLabel = call.toUpperCase();
  const confirmedLabel = confirmedCall.toUpperCase();
  const reasoning: string[] = [
    `Minute-14 forecast ${directionLabel} is trying to estimate where this 15-minute contract is likely to stand near the end of the window, not just what the tape is confirming right now.`,
    `Forecast score is ${predictiveScore.rawScore.toFixed(2)} from strike persistence ${predictiveScore.strikePersistenceScore.toFixed(2)}, momentum persistence ${predictiveScore.momentumPersistenceScore.toFixed(2)}, acceleration ${predictiveScore.accelerationScore.toFixed(2)}, trend stack ${predictiveScore.trendStackScore.toFixed(2)}, micro-structure ${predictiveScore.microStructureScore.toFixed(2)}, volatility regime ${predictiveScore.volatilityRegimeScore.toFixed(2)}, and edge carry ${predictiveScore.edgeCarryScore.toFixed(2)}.`,
    `This read treats distance to strike and the 5m / 15m / 30m momentum stack as persistence signals, then discounts that move when RSI and extension suggest exhaustion before minute 14.`,
    `RSI14 is ${indicators.rsi14?.toFixed(2) ?? "n/a"}, distance to strike is ${indicators.distanceToStrike?.toFixed(2) ?? "n/a"} against ATR14 ${indicators.atr14?.toFixed(2) ?? "n/a"}, and the 15m/60m range regime is ${indicators.range15?.toFixed(2) ?? "n/a"} / ${indicators.range60?.toFixed(2) ?? "n/a"}.`,
    confirmedCall === call
      ? `This forecast agrees with the confirmed ${confirmedLabel} tape and is effectively saying the current move still has enough persistence to survive toward minute 14.`
      : `This forecast disagrees with the confirmed ${confirmedLabel} tape and is saying the current move may not survive to minute 14 even if it still looks strong right now.`,
    describeTimingContext(timingRisk),
  ];

  const gateReasons = uniqueStrings([
    predictiveScore.strikePersistenceScore >= 0 === (call === "above")
      ? `Distance from strike still statistically favors ${directionLabel} by minute 14.`
      : `Distance from strike is mixed, but the rest of the forecast still favors ${directionLabel}.`,
    predictiveScore.momentumPersistenceScore >= 0 === (call === "above")
      ? `The multi-horizon momentum stack favors ${directionLabel}.`
      : `Momentum persistence is mixed, but not enough to flip the minute-14 forecast.`,
    predictiveScore.trendStackScore >= 0 === (call === "above")
      ? `EMA trend stack favors ${directionLabel}.`
      : `EMA trend stack is mixed, but price structure still leans ${directionLabel}.`,
    predictiveScore.microStructureScore >= 0 === (call === "above")
      ? `EMA9 / VWAP micro-structure favors ${directionLabel}.`
      : `EMA9 / VWAP micro-structure is mixed, but the forecast score still favors ${directionLabel}.`,
    predictiveScore.exhaustionPenalty > 0
      ? `Exhaustion risk is elevated, so the forecast is discounting some of the current move.`
      : `Exhaustion risk is not yet elevated enough to materially discount the move.`,
  ]);

  return {
    reasoning,
    gateReasons,
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
      tapePattern: "chop",
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
  const tapePattern = classifyTapePattern(input.indicators, call, score);

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
    tapePattern,
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

export async function buildPredictiveChampionTradingDecision(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  warnings: string[];
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
      summary: "Minute-14 forecast is unavailable because core market data was missing.",
      reasoning: [
        "The minute-14 forecast needs the same Kalshi and Coinbase inputs as the confirmed indicator.",
        "This cycle was skipped because one or more required inputs were missing.",
      ],
      tapePattern: "chop",
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

  const confirmedScore = buildScalpScore(input.indicators);
  const confirmedCall: "above" | "below" = confirmedScore.rawScore >= 0 ? "above" : "below";
  const predictiveScore = buildPredictiveScore(input.indicators);
  const call: "above" | "below" = predictiveScore.rawScore >= 0 ? "above" : "below";
  const confidence = clamp(Math.round(50 + Math.abs(predictiveScore.rawScore) * 1.05), 50, 96);
  const requiredConfidence = Math.max(54, Math.min(tradingConfig.confidenceThreshold - 4, 60));
  const meetsConfidence = confidence >= requiredConfidence;
  const mapping = deriveOutcomeMapping(input.market, meetsConfidence ? call : "no_trade");
  const { reasoning, gateReasons } = buildPredictiveReasoning(
    input.indicators,
    call,
    input.timingRisk,
    predictiveScore,
    confirmedCall,
  );
  const tapePattern =
    confirmedCall !== call
      ? "possible_reversal"
      : Math.abs(predictiveScore.rawScore) >= 14
        ? "continuation"
        : "chop";

  if (!meetsConfidence) {
    blockers.push(
      `Minute-14 forecast confidence ${confidence} is below the forecast threshold of ${requiredConfidence}.`,
    );
  }

  return {
    call: meetsConfidence ? call : "no_trade",
    confidence,
    deterministicConfidence: confidence,
    summary: meetsConfidence
      ? confirmedCall === call
        ? `Forecast ${call.toUpperCase()} expects the current direction to still be favored by minute 14 of this 15-minute window.`
        : `Forecast ${call.toUpperCase()} expects the contract to lean the other way by minute 14 even though the confirmed tape still favors ${confirmedCall.toUpperCase()}.`
      : `No minute-14 forecast because confidence only reached ${confidence}.`,
    reasoning,
    tapePattern,
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
