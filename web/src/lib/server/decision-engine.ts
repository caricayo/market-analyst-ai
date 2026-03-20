import OpenAI from "openai";
import { tradingConfig, hasOpenAiKey } from "@/lib/server/trading-config";
import type {
  IndicatorSnapshot,
  KalshiMarketSnapshot,
  SetupType,
  TimingRiskLevel,
  TradeCall,
  TradingDecision,
} from "@/lib/trading-types";

type AiDecisionPayload = {
  call: "above" | "below" | "no_trade";
  confidence: number;
  summary: string;
  reasoning: string[];
};

type DeterministicCandidate = {
  setupType: Exclude<SetupType, "none">;
  call: Exclude<TradeCall, "no_trade">;
  confidence: number;
  summary: string;
  reasoning: string[];
  gateReasons: string[];
};

type DeterministicResult = {
  candidate: DeterministicCandidate | null;
  blockers: string[];
};

const openAiClient = hasOpenAiKey() ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const AI_VETO_CONFIDENCE = 85;
const TREND_EDGE_THRESHOLD = 0.6;
const TREND_CONFIDENCE_THRESHOLD = 68;
const SCALP_CONFIDENCE_THRESHOLD = 64;
const LATE_SCALP_CONFIDENCE_THRESHOLD = 72;
const REVERSAL_CONFIDENCE_THRESHOLD = 66;
const LATE_REVERSAL_CONFIDENCE_THRESHOLD = 70;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function safeJsonParse<T>(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function deriveOutcomeMapping(
  market: KalshiMarketSnapshot | null,
  call: "above" | "below" | "no_trade",
) {
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

function getScalpDistanceThreshold(atr14: number | null, timingRisk: TimingRiskLevel) {
  const atrComponent = (atr14 ?? 0) * (timingRisk === "late-window" ? 1.2 : 0.9);
  const hardFloor = timingRisk === "late-window" ? 65 : 35;
  return Math.max(hardFloor, atrComponent);
}

function getScalpConfidenceThreshold(timingRisk: TimingRiskLevel) {
  return timingRisk === "late-window" ? LATE_SCALP_CONFIDENCE_THRESHOLD : SCALP_CONFIDENCE_THRESHOLD;
}

function getReversalDistanceThreshold(atr14: number | null, timingRisk: TimingRiskLevel) {
  const atrComponent =
    (atr14 ?? 0) *
    (timingRisk === "late-window"
      ? tradingConfig.reversalLateAtrMultiplier
      : tradingConfig.reversalPrimaryAtrMultiplier);
  const hardFloor =
    timingRisk === "late-window"
      ? tradingConfig.reversalLateDistanceFloor
      : tradingConfig.reversalPrimaryDistanceFloor;
  return Math.max(hardFloor, atrComponent);
}

function getReversalConfidenceThreshold(timingRisk: TimingRiskLevel) {
  return timingRisk === "late-window"
    ? LATE_REVERSAL_CONFIDENCE_THRESHOLD
    : REVERSAL_CONFIDENCE_THRESHOLD;
}

function getTrendDirection(indicators: IndicatorSnapshot) {
  if (Math.abs(indicators.deterministicEdge) < TREND_EDGE_THRESHOLD) {
    return null;
  }

  return indicators.deterministicEdge > 0 ? "above" : "below";
}

function getEmaTurnBand(atr14: number | null) {
  return Math.max(8, (atr14 ?? 0) * 0.15);
}

function evaluateReversalCandidate(
  side: "above" | "below",
  indicators: IndicatorSnapshot,
  timingRisk: TimingRiskLevel,
): DeterministicResult {
  const blockers: string[] = [];
  const directionLabel = side.toUpperCase();

  if (timingRisk !== "trade-window" && timingRisk !== "late-window") {
    blockers.push(`Reversal ${directionLabel} is only allowed in minutes 4-12.`);
    return { candidate: null, blockers };
  }

  if (
    indicators.strikePrice === null ||
    indicators.distanceToStrike === null ||
    indicators.atr14 === null
  ) {
    blockers.push(`Reversal ${directionLabel} requires strike price and ATR data.`);
    return { candidate: null, blockers };
  }

  const threshold = getReversalDistanceThreshold(indicators.atr14, timingRisk);
  const distance = indicators.distanceToStrike;
  const ema9 = indicators.ema9;
  const rsi14 = indicators.rsi14 ?? 50;
  const momentum5 = indicators.momentum5 ?? 0;
  const momentum15 = indicators.momentum15 ?? 0;
  const momentum30 = indicators.momentum30 ?? 0;
  const turnBand = getEmaTurnBand(indicators.atr14);
  const reclaimingEma =
    ema9 === null
      ? true
      : side === "above"
        ? indicators.currentPrice >= ema9 - turnBand
        : indicators.currentPrice <= ema9 + turnBand;
  const turningMomentum =
    side === "above"
      ? momentum5 >= 1 || momentum5 - momentum15 >= 4
      : momentum5 <= -1 || momentum5 - momentum15 <= -4;
  const exhaustionPresent =
    side === "above"
      ? rsi14 <= 43 || momentum15 <= -4 || momentum30 <= -6
      : rsi14 >= 57 || momentum15 >= 4 || momentum30 >= 6;
  const stillAcceleratingAgainstReversal =
    side === "above"
      ? momentum5 <= -4 && momentum15 <= -2
      : momentum5 >= 4 && momentum15 >= 2;

  if (side === "above" && distance > -threshold) {
    blockers.push(
      `Reversal ABOVE needs at least ${threshold.toFixed(2)} dollars below strike; current distance is ${distance.toFixed(2)}.`,
    );
  }

  if (side === "below" && distance < threshold) {
    blockers.push(
      `Reversal BELOW needs at least ${threshold.toFixed(2)} dollars above strike; current distance is ${distance.toFixed(2)}.`,
    );
  }

  if (!exhaustionPresent) {
    blockers.push(`Reversal ${directionLabel} needs exhaustion context before the snapback entry.`);
  }

  if (!turningMomentum) {
    blockers.push(`Reversal ${directionLabel} needs a short-momentum turn back toward the strike.`);
  }

  if (!reclaimingEma) {
    blockers.push(`Reversal ${directionLabel} needs price to turn back toward EMA9.`);
  }

  if (stillAcceleratingAgainstReversal) {
    blockers.push(`Reversal ${directionLabel} blocked because momentum is still accelerating the wrong way.`);
  }

  if (blockers.length) {
    return { candidate: null, blockers };
  }

  const extension = Math.max(0, Math.abs(distance) - threshold);
  const atrScale = Math.max(indicators.atr14, 20);
  const momentumTurnStrength =
    side === "above"
      ? Math.max(0, momentum5 - Math.min(momentum15, 0))
      : Math.max(0, Math.max(momentum15, 0) - momentum5);
  const confidence = clamp(
    Math.round(
      getReversalConfidenceThreshold(timingRisk) +
        (extension / atrScale) * 10 +
        Math.min(6, momentumTurnStrength) +
        (reclaimingEma ? 3 : 0),
    ),
    getReversalConfidenceThreshold(timingRisk),
    95,
  );

  return {
    candidate: {
      setupType: "reversal",
      call: side,
      confidence,
      summary: `Reversal ${directionLabel} setup detected after an overshoot away from the strike and a short-momentum turn.`,
      reasoning: [
        `Price is ${Math.abs(distance).toFixed(2)} dollars ${side === "above" ? "below" : "above"} strike, beyond the reversal threshold of ${threshold.toFixed(2)}.`,
        `Short momentum has started turning back toward the strike while the broader move still shows exhaustion.`,
        `Price is rotating back toward EMA9 instead of continuing to accelerate away from the strike.`,
      ],
      gateReasons: [
        `Reversal ${directionLabel} displacement threshold passed.`,
        `Reversal ${directionLabel} exhaustion condition passed.`,
        `Reversal ${directionLabel} momentum-turn condition passed.`,
        timingRisk === "late-window"
          ? "Late-window reversal thresholds were satisfied."
          : "Primary reversal window thresholds were satisfied.",
      ],
    },
    blockers: [],
  };
}

function evaluateScalpCandidate(
  side: "above" | "below",
  indicators: IndicatorSnapshot,
  timingRisk: TimingRiskLevel,
): DeterministicResult {
  const blockers: string[] = [];
  const directionLabel = side.toUpperCase();

  if (timingRisk !== "trade-window" && timingRisk !== "late-window") {
    blockers.push(`Scalp ${directionLabel} is only allowed in minutes 4-12.`);
    return { candidate: null, blockers };
  }

  if (
    indicators.strikePrice === null ||
    indicators.distanceToStrike === null ||
    indicators.atr14 === null
  ) {
    blockers.push(`Scalp ${directionLabel} requires strike price and ATR data.`);
    return { candidate: null, blockers };
  }

  const threshold = getScalpDistanceThreshold(indicators.atr14, timingRisk);
  const distance = indicators.distanceToStrike;
  const ema9 = indicators.ema9;
  const ema21 = indicators.ema21;
  const rsi14 = indicators.rsi14 ?? 50;
  const momentum5 = indicators.momentum5 ?? 0;
  const momentum15 = indicators.momentum15 ?? 0;
  const trendAligned =
    side === "above"
      ? indicators.trendBias === "bullish" || (ema9 !== null && ema21 !== null && ema9 >= ema21)
      : indicators.trendBias === "bearish" || (ema9 !== null && ema21 !== null && ema9 <= ema21);
  const priceAligned =
    ema9 === null
      ? true
      : side === "above"
        ? indicators.currentPrice >= ema9
        : indicators.currentPrice <= ema9;

  if (side === "above" && distance < threshold) {
    blockers.push(
      `Scalp ABOVE needs at least ${threshold.toFixed(2)} dollars above strike; current distance is ${distance.toFixed(2)}.`,
    );
  }

  if (side === "below" && distance > -threshold) {
    blockers.push(
      `Scalp BELOW needs at least ${threshold.toFixed(2)} dollars below strike; current distance is ${distance.toFixed(2)}.`,
    );
  }

  if (side === "above" && (momentum5 < -8 || momentum15 < -6)) {
    blockers.push("Scalp ABOVE blocked because short momentum is reversing down too hard.");
  }

  if (side === "below" && (momentum5 > 8 || momentum15 > 6)) {
    blockers.push("Scalp BELOW blocked because short momentum is reversing up too hard.");
  }

  if (side === "above" && ema9 !== null && indicators.currentPrice < ema9 && rsi14 <= 45) {
    blockers.push("Scalp ABOVE blocked because price is below EMA9 with weak RSI.");
  }

  if (side === "below" && ema9 !== null && indicators.currentPrice > ema9 && rsi14 >= 55) {
    blockers.push("Scalp BELOW blocked because price is above EMA9 with strong RSI.");
  }

  if (!trendAligned && !priceAligned) {
    blockers.push(`Scalp ${directionLabel} lacks EMA or trend alignment.`);
  }

  if (blockers.length) {
    return { candidate: null, blockers };
  }

  const extension = Math.max(0, Math.abs(distance) - threshold);
  const atrScale = Math.max(indicators.atr14, 25);
  const confidence = clamp(
    Math.round(
      getScalpConfidenceThreshold(timingRisk) +
        (extension / atrScale) * 12 +
        (trendAligned ? 4 : 0) +
        (priceAligned ? 3 : 0),
    ),
    getScalpConfidenceThreshold(timingRisk),
    94,
  );

  return {
    candidate: {
      setupType: "scalp",
      call: side,
      confidence,
      summary: `Scalp ${directionLabel} setup passed strike-distance and continuation filters.`,
      reasoning: [
        `Price is ${Math.abs(distance).toFixed(2)} dollars ${side === "above" ? "above" : "below"} strike.`,
        `Scalp threshold for this window is ${threshold.toFixed(2)} dollars.`,
        `Short momentum and EMA context still support continuation instead of a reversal.`,
      ],
      gateReasons: [
        `Scalp ${directionLabel} distance threshold passed.`,
        trendAligned ? "Trend context supports the scalp side." : "Price is aligned even without full trend support.",
        timingRisk === "late-window"
          ? "Late-window scalp thresholds were satisfied."
          : "Primary scalp window thresholds were satisfied.",
      ],
    },
    blockers: [],
  };
}

function evaluateTrendCandidate(
  indicators: IndicatorSnapshot,
  timingRisk: TimingRiskLevel,
): DeterministicResult {
  const blockers: string[] = [];

  if (timingRisk !== "trade-window") {
    blockers.push("Trend setups are only allowed in minutes 4-8.");
    return { candidate: null, blockers };
  }

  const direction = getTrendDirection(indicators);
  if (!direction) {
    blockers.push(
      `Trend setup requires |deterministic edge| >= ${TREND_EDGE_THRESHOLD}; current edge is ${indicators.deterministicEdge}.`,
    );
    return { candidate: null, blockers };
  }

  const momentum5 = indicators.momentum5 ?? 0;
  const momentum15 = indicators.momentum15 ?? 0;
  const momentum30 = indicators.momentum30 ?? 0;
  const ema9 = indicators.ema9;
  const trendAligned =
    direction === "above" ? indicators.trendBias === "bullish" : indicators.trendBias === "bearish";
  const priceAligned =
    ema9 === null
      ? true
      : direction === "above"
        ? indicators.currentPrice >= ema9
        : indicators.currentPrice <= ema9;
  const momentumAligned =
    direction === "above"
      ? momentum5 >= 2 && momentum15 >= 3
      : momentum5 <= -2 && momentum15 <= -3;

  if (!trendAligned) {
    blockers.push(`Trend ${direction.toUpperCase()} blocked because trend bias does not align.`);
  }

  if (!momentumAligned) {
    blockers.push(`Trend ${direction.toUpperCase()} blocked because 5m/15m momentum does not align.`);
  }

  if (!priceAligned) {
    blockers.push(`Trend ${direction.toUpperCase()} blocked because price is on the wrong side of EMA9.`);
  }

  if (blockers.length) {
    return { candidate: null, blockers };
  }

  const confidence = clamp(
    Math.round(
      60 +
        Math.abs(indicators.deterministicEdge) * 14 +
        (Math.abs(momentum30) >= 8 ? 4 : 0) +
        (priceAligned ? 2 : 0),
    ),
    TREND_CONFIDENCE_THRESHOLD,
    93,
  );

  return {
    candidate: {
      setupType: "trend",
      call: direction,
      confidence,
      summary: `Trend ${direction.toUpperCase()} setup passed edge, momentum, and EMA alignment checks.`,
      reasoning: [
        `Deterministic edge is ${indicators.deterministicEdge}.`,
        `Momentum alignment supports ${direction.toUpperCase()} on 5m and 15m windows.`,
        `Price is on the correct side of EMA9 with ${indicators.trendBias} tape context.`,
      ],
      gateReasons: [
        "Trend edge threshold passed.",
        "Trend momentum alignment passed.",
        "EMA alignment passed.",
      ],
    },
    blockers: [],
  };
}

function rankFallbackCandidates(candidates: DeterministicCandidate[]) {
  return candidates.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }

    if (left.setupType !== right.setupType) {
      if (left.setupType === "scalp") {
        return -1;
      }
      if (right.setupType === "scalp") {
        return 1;
      }
    }

    return 0;
  });
}

function buildDeterministicDecision(
  market: KalshiMarketSnapshot | null,
  indicators: IndicatorSnapshot,
  timingRisk: TimingRiskLevel,
  warnings: string[],
) {
  const blockers = [...warnings];

  if (timingRisk === "high-risk-open") {
    blockers.push("Minutes 1-3 are hard-blocked as a high-risk open.");
    return {
      candidate: null,
      blockers,
    };
  }

  if (timingRisk === "blocked-close") {
    blockers.push("Minutes 13-15 are blocked for new entries.");
    return {
      candidate: null,
      blockers,
    };
  }

  if (market?.strikePrice === null) {
    blockers.push("The active Kalshi market did not expose a usable strike price.");
  }

  const reversalEvaluations = [
    evaluateReversalCandidate("below", indicators, timingRisk),
    evaluateReversalCandidate("above", indicators, timingRisk),
  ];
  const reversalCandidates = reversalEvaluations
    .map((evaluation) => evaluation.candidate)
    .filter((candidate): candidate is DeterministicCandidate => candidate !== null)
    .sort((left, right) => right.confidence - left.confidence);

  if (reversalCandidates.length) {
    return {
      candidate: reversalCandidates[0],
      blockers: uniqueStrings(blockers),
    };
  }

  const fallbackEvaluations = [
    evaluateScalpCandidate("below", indicators, timingRisk),
    evaluateScalpCandidate("above", indicators, timingRisk),
    evaluateTrendCandidate(indicators, timingRisk),
  ];

  const fallbackCandidates = rankFallbackCandidates(
    fallbackEvaluations
      .map((evaluation) => evaluation.candidate)
      .filter((candidate): candidate is DeterministicCandidate => candidate !== null),
  );

  if (!fallbackCandidates.length) {
    const evaluationBlockers = [
      ...reversalEvaluations.flatMap((evaluation) => evaluation.blockers),
      ...fallbackEvaluations.flatMap((evaluation) => evaluation.blockers),
    ];
    return {
      candidate: null,
      blockers: uniqueStrings([...blockers, ...evaluationBlockers]),
    };
  }

  return {
    candidate: fallbackCandidates[0],
    blockers: uniqueStrings(blockers),
  };
}

async function getAiDecision(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  deterministic: {
    candidate: DeterministicCandidate | null;
    blockers: string[];
  };
}) {
  if (!openAiClient) {
    return null;
  }

  const response = await openAiClient.chat.completions.create({
    model: tradingConfig.openAiModel,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "btc_kalshi_trade_decision",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            call: {
              type: "string",
              enum: ["above", "below", "no_trade"],
            },
            confidence: {
              type: "number",
            },
            summary: {
              type: "string",
            },
            reasoning: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: { type: "string" },
            },
          },
          required: ["call", "confidence", "summary", "reasoning"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You are an advisory BTC intraday analyst for 15-minute Kalshi contracts. Deterministic rules own execution. Reversal is the primary playbook in minutes 4-12. Trend remains a continuation fallback in minutes 4-8. Scalp remains a continuation fallback in minutes 4-12. Minutes 1-3 and 13-15 are blocked. Only return a strong veto when the deterministic candidate is clearly contradicted by the supplied tape.",
      },
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
  });

  return safeJsonParse<AiDecisionPayload>(response.choices[0]?.message?.content);
}

export async function buildTradingDecision(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  warnings: string[];
}) {
  const deterministic = buildDeterministicDecision(
    input.market,
    input.indicators,
    input.timingRisk,
    input.warnings,
  );
  const aiDecision = await getAiDecision({
    market: input.market,
    indicators: input.indicators,
    minuteInWindow: input.minuteInWindow,
    timingRisk: input.timingRisk,
    deterministic,
  }).catch(() => null);

  const candidate = deterministic.candidate;
  const blockers = [...deterministic.blockers];
  const gateReasons = candidate ? [...candidate.gateReasons] : [];
  let call: TradingDecision["call"] = candidate?.call ?? "no_trade";
  const confidence = candidate?.confidence ?? 50;
  const deterministicConfidence = candidate?.confidence ?? 50;
  const setupType: TradingDecision["setupType"] = candidate?.setupType ?? "none";
  const candidateSide: TradingDecision["candidateSide"] = candidate?.call ?? null;
  let aiVetoed = false;

  if (
    candidate &&
    aiDecision &&
    aiDecision.confidence >= AI_VETO_CONFIDENCE &&
    aiDecision.call !== candidate.call
  ) {
    aiVetoed = true;
    call = "no_trade";
    blockers.push(
      `AI vetoed the ${candidate.call.toUpperCase()} ${candidate.setupType} setup with confidence ${Math.round(aiDecision.confidence)}.`,
    );
  }

  const requiredConfidence =
    candidate?.setupType === "reversal"
      ? getReversalConfidenceThreshold(input.timingRisk)
      : candidate?.setupType === "scalp"
        ? getScalpConfidenceThreshold(input.timingRisk)
        : candidate?.setupType === "trend"
          ? TREND_CONFIDENCE_THRESHOLD
          : tradingConfig.confidenceThreshold;
  const meetsConfidence = candidate ? confidence >= requiredConfidence : false;

  if (candidate && !meetsConfidence) {
    blockers.push(
      `${candidate.setupType.toUpperCase()} confidence ${confidence} is below the required threshold of ${requiredConfidence}.`,
    );
    call = "no_trade";
  }

  const mapping = deriveOutcomeMapping(input.market, call);
  const defaultSummary = candidate
    ? candidate.summary
    : "No deterministic reversal, trend, or scalp setup passed the current timing and tape filters.";
  const defaultReasoning = candidate
    ? candidate.reasoning
    : [
        `Timing risk is ${input.timingRisk}.`,
        `Deterministic edge is ${input.indicators.deterministicEdge}.`,
        "No reversal, scalp, or trend candidate satisfied the active gate thresholds.",
      ];

  return {
    call,
    confidence,
    deterministicConfidence,
    summary: aiDecision?.summary?.trim() || defaultSummary,
    reasoning: aiDecision?.reasoning?.length ? aiDecision.reasoning : defaultReasoning,
    setupType,
    candidateSide,
    timingRisk: input.timingRisk,
    shouldTrade:
      Boolean(candidate) &&
      call !== "no_trade" &&
      meetsConfidence &&
      !aiVetoed &&
      Boolean(mapping.derivedSide),
    aiVetoed,
    derivedSide: mapping.derivedSide,
    derivedOutcome: mapping.derivedOutcome,
    gateReasons: uniqueStrings(gateReasons),
    blockers: uniqueStrings(blockers),
  } satisfies TradingDecision;
}
