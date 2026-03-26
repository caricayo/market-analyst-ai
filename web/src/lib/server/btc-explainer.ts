import OpenAI from "openai";
import { signalConfig } from "@/lib/server/signal-config";
import type {
  BtcSignalFeatures,
  KalshiBtcWindowSnapshot,
  SignalExplanation,
  SignalRecommendation,
} from "@/lib/signal-types";

type ExplanationDraft = {
  summary?: string;
  conviction?: string[];
  caution?: string[];
};

const openAiClient = signalConfig.openAiApiKey
  ? new OpenAI({ apiKey: signalConfig.openAiApiKey })
  : null;

function parseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function buildFallbackExplanation(recommendation: SignalRecommendation): SignalExplanation {
  if (recommendation.action === "no_buy") {
    return {
      status: signalConfig.explanationEnabled ? "fallback" : "disabled",
      model: signalConfig.explanationEnabled ? signalConfig.explanationModel : null,
      summary:
        recommendation.blockers[0] ??
        "The engine does not see enough independent edge to justify a BTC 15-minute Kalshi buy right now.",
      conviction: recommendation.reasons.slice(0, 3),
      caution: recommendation.blockers.slice(0, 3),
    };
  }

  return {
    status: signalConfig.explanationEnabled ? "fallback" : "disabled",
    model: signalConfig.explanationEnabled ? signalConfig.explanationModel : null,
    summary: `${recommendation.label} because fair value is ahead of the current Kalshi ask and the Coinbase-only factor stack is aligned.`,
    conviction: recommendation.reasons.slice(0, 3),
    caution: recommendation.blockers.length
      ? recommendation.blockers.slice(0, 3)
      : ["This is still a 15-minute event market, so timing noise can erase edge quickly."],
  };
}

export async function buildSignalExplanation(input: {
  recommendation: SignalRecommendation;
  features: BtcSignalFeatures;
  market: KalshiBtcWindowSnapshot | null;
}) {
  const fallback = buildFallbackExplanation(input.recommendation);

  if (!signalConfig.explanationEnabled || !openAiClient) {
    return fallback;
  }

  try {
    const response = await openAiClient.chat.completions.create({
      model: signalConfig.explanationModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are writing a short operator explanation for a BTC 15-minute Kalshi advisory screen. The deterministic model is authoritative. Never invent data, never mention hidden information, and never claim Kalshi odds caused the trade idea. Return strict JSON with keys summary, conviction, caution.",
        },
        {
          role: "user",
          content: JSON.stringify({
            action: input.recommendation.action,
            label: input.recommendation.label,
            contractSide: input.recommendation.contractSide,
            buyPriceDollars: input.recommendation.buyPriceDollars,
            fairValueDollars: input.recommendation.fairValueDollars,
            edgeDollars: input.recommendation.edgeDollars,
            modelProbability: input.recommendation.modelProbability,
            confidence: input.recommendation.confidence,
            reasons: input.recommendation.reasons,
            blockers: input.recommendation.blockers,
            strikePrice: input.market?.strikePrice,
            yesAskPrice: input.market?.yesAskPrice,
            noAskPrice: input.market?.noAskPrice,
            features: {
              currentPrice: input.features.currentPrice,
              distanceToStrike: input.features.distanceToStrike,
              distanceToStrikeAtr: input.features.distanceToStrikeAtr,
              trendBias: input.features.trendBias,
              momentum5: input.features.momentum5,
              momentum15: input.features.momentum15,
              rsi14: input.features.rsi14,
              atr14: input.features.atr14,
              vwap120: input.features.vwap120,
            },
          }),
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    const draft = parseJson<ExplanationDraft>(content);
    if (!draft?.summary) {
      return fallback;
    }

    return {
      status: "live",
      model: signalConfig.explanationModel,
      summary: draft.summary,
      conviction: Array.isArray(draft.conviction) ? draft.conviction.slice(0, 3) : fallback.conviction,
      caution: Array.isArray(draft.caution) ? draft.caution.slice(0, 3) : fallback.caution,
    } satisfies SignalExplanation;
  } catch {
    return {
      ...fallback,
      status: "error",
    } satisfies SignalExplanation;
  }
}
