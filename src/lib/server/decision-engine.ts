import OpenAI from "openai";
import { tradingConfig, hasOpenAiKey } from "@/lib/server/trading-config";
import type { IndicatorSnapshot, KalshiMarketSnapshot, TimingRiskLevel, TradingDecision } from "@/lib/trading-types";

type AiDecisionPayload = {
  call: "above" | "below" | "no_trade";
  confidence: number;
  summary: string;
  reasoning: string[];
};

const openAiClient = hasOpenAiKey() ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function buildDeterministicDecision(
  market: KalshiMarketSnapshot | null,
  indicators: IndicatorSnapshot,
  timingRisk: TimingRiskLevel,
  warnings: string[],
) {
  const blockers = [...warnings];
  let call: TradingDecision["call"] = "no_trade";
  const edge = indicators.deterministicEdge;
  const absoluteEdge = Math.abs(edge);
  let confidence = clamp(54 + absoluteEdge * 18, 50, 90);

  if (timingRisk === "high-risk-open") {
    blockers.push("Minutes 1-3 are hard-blocked as a high-risk open.");
  }

  if (market?.strikePrice === null) {
    blockers.push("The active Kalshi market did not expose a usable strike price.");
  }

  if (timingRisk === "late-window") {
    confidence -= 12;
    blockers.push("Minutes 9-15 are treated as higher-risk late-window entries.");
  }

  if (absoluteEdge >= 0.55 && !blockers.some((item) => item.includes("hard-blocked"))) {
    call = edge > 0 ? "above" : "below";
  }

  if (Math.abs(indicators.distanceToStrikeBps ?? 0) < 8) {
    blockers.push("Spot price is still crowded around the strike.");
    confidence -= 10;
    call = "no_trade";
  }

  if (Math.abs(indicators.momentum5 ?? 0) < 2 && Math.abs(indicators.momentum15 ?? 0) < 3) {
    blockers.push("Momentum is too flat for a clean intraday bias.");
    confidence -= 8;
    call = "no_trade";
  }

  const summary =
    call === "no_trade"
      ? "Deterministic filters do not show enough edge for a clean 15-minute trade."
      : `Deterministic edge leans ${call} with ${indicators.trendBias} tape context.`;

  return {
    call,
    confidence: clamp(Math.round(confidence), 50, 95),
    summary,
    reasoning: [
      `Deterministic edge score: ${indicators.deterministicEdge}.`,
      `Trend bias: ${indicators.trendBias}.`,
      `Distance to strike: ${indicators.distanceToStrike ?? "n/a"} dollars.`,
    ],
    blockers,
  };
}

async function getAiDecision(input: {
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  deterministic: ReturnType<typeof buildDeterministicDecision>;
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
          "You are a constrained BTC intraday market analyst for 15-minute Kalshi contracts. Use only the supplied market snapshot and indicators. Do not invent missing data. Treat minutes 1-3 as hard-risk and minutes 9-15 as elevated-risk. Prefer NO_TRADE when the edge is weak or crowded near strike.",
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

  const baseCall = aiDecision?.call ?? deterministic.call;
  const baseConfidence = clamp(
    Math.round(aiDecision?.confidence ?? deterministic.confidence),
    50,
    99,
  );
  const blockers = [...new Set(deterministic.blockers)];
  let call = baseCall;
  let confidence = baseConfidence;

  if (input.timingRisk === "high-risk-open") {
    call = "no_trade";
    confidence = Math.min(confidence, tradingConfig.confidenceThreshold - 1);
  }

  if (input.timingRisk === "late-window") {
    const strongLateSignal =
      Math.abs(input.indicators.deterministicEdge) >= tradingConfig.lateWindowDeterministicEdge &&
      confidence >= tradingConfig.lateWindowConfidenceThreshold;
    if (!strongLateSignal) {
      call = "no_trade";
      blockers.push("Late-window risk rule blocked execution for minutes 9-15.");
    }
  }

  const meetsConfidence = confidence >= tradingConfig.confidenceThreshold;
  if (call === "no_trade" || !meetsConfidence) {
    if (!meetsConfidence) {
      blockers.push(
        `Confidence ${confidence} is below the required threshold of ${tradingConfig.confidenceThreshold}.`,
      );
    }
  }

  const mapping = deriveOutcomeMapping(input.market, call);
  return {
    call,
    confidence,
    summary: aiDecision?.summary?.trim() || deterministic.summary,
    reasoning: aiDecision?.reasoning?.length ? aiDecision.reasoning : deterministic.reasoning,
    timingRisk: input.timingRisk,
    shouldTrade:
      call !== "no_trade" &&
      meetsConfidence &&
      !(input.timingRisk === "high-risk-open") &&
      Boolean(mapping.derivedSide),
    derivedSide: mapping.derivedSide,
    derivedOutcome: mapping.derivedOutcome,
    blockers: [...new Set(blockers)],
  } satisfies TradingDecision;
}
