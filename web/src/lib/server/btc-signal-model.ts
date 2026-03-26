import type { Candle } from "@/lib/server/coinbase-client";
import { signalConfig } from "@/lib/server/signal-config";
import type {
  BtcSignalFeatures,
  KalshiBtcWindowSnapshot,
  SignalRecommendation,
  SignalRiskLevel,
  TrendBias,
} from "@/lib/signal-types";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ema(candles: Candle[], period: number) {
  if (candles.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  let current = candles[0]?.close ?? 0;

  for (const candle of candles.slice(1)) {
    current = candle.close * multiplier + current * (1 - multiplier);
  }

  return current;
}

function rsi(candles: Candle[], period: number) {
  if (candles.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function atr(candles: Candle[], period: number) {
  if (candles.length <= period) {
    return null;
  }

  const ranges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }

  return average(ranges);
}

function vwap(candles: Candle[]) {
  let volumeSum = 0;
  let weightedSum = 0;
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    volumeSum += candle.volume;
    weightedSum += typicalPrice * candle.volume;
  }
  if (!volumeSum) {
    return null;
  }
  return weightedSum / volumeSum;
}

function momentum(candles: Candle[], lookback: number) {
  if (candles.length <= lookback) {
    return null;
  }
  const latest = candles.at(-1)?.close ?? 0;
  const base = candles.at(-1 - lookback)?.close ?? 0;
  if (!base) {
    return null;
  }
  return ((latest - base) / base) * 100;
}

function realizedVolatility(candles: Candle[], lookback: number) {
  if (candles.length <= lookback) {
    return null;
  }

  const returns: number[] = [];
  for (let index = candles.length - lookback; index < candles.length; index += 1) {
    const current = candles[index]?.close ?? 0;
    const previous = candles[index - 1]?.close ?? 0;
    if (current <= 0 || previous <= 0) {
      continue;
    }
    returns.push(Math.log(current / previous));
  }

  const mean = average(returns);
  if (mean === null || returns.length < 2) {
    return null;
  }

  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance);
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function detectTrendBias(ema9: number | null, ema21: number | null, ema55: number | null): TrendBias {
  if (ema9 === null || ema21 === null || ema55 === null) {
    return "neutral";
  }
  if (ema9 > ema21 && ema21 > ema55) {
    return "bullish";
  }
  if (ema9 < ema21 && ema21 < ema55) {
    return "bearish";
  }
  return "neutral";
}

function toPercentCents(value: number | null) {
  return value === null ? null : value * 100;
}

function topReasons(
  factorScores: Record<string, number>,
  features: BtcSignalFeatures,
  market: KalshiBtcWindowSnapshot | null,
) {
  const yesAsk = market?.yesAskPrice;
  const noAsk = market?.noAskPrice;

  const reasons: Array<{ label: string; score: number }> = [
    {
      label:
        features.distanceToStrike !== null
          ? `BTC is ${Math.abs(features.distanceToStrike).toFixed(0)} away from the Kalshi strike.`
          : "Strike distance is unavailable.",
      score: Math.abs(factorScores.strikePressure ?? 0),
    },
    {
      label: `Short-term momentum is ${features.momentum5?.toFixed(2) ?? "0.00"}% over 5 minutes.`,
      score: Math.abs(factorScores.momentum5 ?? 0),
    },
    {
      label: `Fifteen-minute momentum is ${features.momentum15?.toFixed(2) ?? "0.00"}% across the window horizon.`,
      score: Math.abs(factorScores.momentum15 ?? 0),
    },
    {
      label:
        features.vwap120 !== null
          ? `Price is ${(features.currentPrice - features.vwap120).toFixed(0)} away from session VWAP.`
          : "VWAP context is unavailable.",
      score: Math.abs(factorScores.vwapDislocation ?? 0),
    },
    {
      label: `EMA stack reads ${features.trendBias}.`,
      score: Math.abs(factorScores.emaStack ?? 0),
    },
    {
      label:
        yesAsk !== null && yesAsk !== undefined && noAsk !== null && noAsk !== undefined
          ? `Kalshi is offering YES at ${yesAsk.toFixed(2)} and NO at ${noAsk.toFixed(2)}.`
          : "Kalshi ask prices are missing.",
      score: 0.15,
    },
  ];

  return reasons
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.label);
}

export function buildBtcSignalFeatures(input: {
  candles: Candle[];
  market: KalshiBtcWindowSnapshot | null;
  now: Date;
}): { features: BtcSignalFeatures; riskLevel: SignalRiskLevel } {
  const { candles, market, now } = input;
  const currentPrice = candles.at(-1)?.close ?? 0;
  const fifteenMinuteSlice = candles.slice(-15);
  const windowOpenPrice = fifteenMinuteSlice[0]?.open ?? candles.at(-15)?.open ?? currentPrice;
  const ema9 = ema(candles, 9);
  const ema21 = ema(candles, 21);
  const ema55 = ema(candles, 55);
  const rsi14Value = rsi(candles, 14);
  const atr14Value = atr(candles, 14);
  const vwap120 = vwap(candles.slice(-120));
  const momentum3 = momentum(candles, 3);
  const momentum5 = momentum(candles, 5);
  const momentum10 = momentum(candles, 10);
  const momentum15 = momentum(candles, 15);
  const realizedVolatility15 = realizedVolatility(candles, 15);
  const high15 = fifteenMinuteSlice.length ? Math.max(...fifteenMinuteSlice.map((candle) => candle.high)) : null;
  const low15 = fifteenMinuteSlice.length ? Math.min(...fifteenMinuteSlice.map((candle) => candle.low)) : null;
  const trendBias = detectTrendBias(ema9, ema21, ema55);
  const candleBodyBias =
    fifteenMinuteSlice.length < 2
      ? null
      : clamp(((currentPrice - windowOpenPrice) / windowOpenPrice) * 100, -2.5, 2.5);
  const rangeCompression15 =
    high15 !== null && low15 !== null && currentPrice > 0 ? (high15 - low15) / currentPrice : null;
  const distanceToStrike =
    market?.strikePrice !== null && market?.strikePrice !== undefined ? currentPrice - market.strikePrice : null;
  const distanceToStrikeBps =
    market?.strikePrice && distanceToStrike !== null ? (distanceToStrike / market.strikePrice) * 10_000 : null;
  const distanceToStrikeAtr =
    distanceToStrike !== null && atr14Value !== null && atr14Value > 0 ? distanceToStrike / atr14Value : null;

  const closeTime = market?.closeTime ? Date.parse(market.closeTime) : Number.NaN;
  const secondsToClose = Number.isFinite(closeTime)
    ? Math.max(0, Math.round((closeTime - now.getTime()) / 1_000))
    : 15 * 60;
  const secondsElapsed = Math.max(0, 15 * 60 - secondsToClose);
  const progressRatio = clamp(secondsElapsed / (15 * 60), 0, 1);
  const riskLevel =
    secondsToClose <= signalConfig.noBuyCloseSeconds
      ? "closing"
      : secondsToClose <= 4 * 60
        ? "late"
        : secondsToClose <= 11 * 60
          ? "developing"
          : "fresh";

  const factorScores = {
    strikePressure: clamp((distanceToStrikeAtr ?? 0) * (1.15 + progressRatio * 0.9), -2.8, 2.8),
    momentum5: clamp((momentum5 ?? 0) * 2.9, -1.8, 1.8),
    momentum15: clamp((momentum15 ?? 0) * 1.9, -1.6, 1.6),
    emaStack: trendBias === "bullish" ? 0.55 : trendBias === "bearish" ? -0.55 : 0,
    vwapDislocation:
      vwap120 !== null && currentPrice > 0 ? clamp(((currentPrice - vwap120) / currentPrice) * 18, -0.95, 0.95) : 0,
    rsiLean: rsi14Value === null ? 0 : clamp((rsi14Value - 50) / 18, -0.9, 0.9),
    candleBody: candleBodyBias === null ? 0 : clamp(candleBodyBias / 1.4, -0.8, 0.8),
    volatilityTax: realizedVolatility15 === null ? 0 : clamp(-realizedVolatility15 * 42 + 0.08, -0.7, 0.35),
  };

  const rawScore =
    factorScores.strikePressure +
    factorScores.momentum5 +
    factorScores.momentum15 +
    factorScores.emaStack +
    factorScores.vwapDislocation +
    factorScores.rsiLean +
    factorScores.candleBody +
    factorScores.volatilityTax;

  const modelAboveProbability = clamp(sigmoid(rawScore), 0.02, 0.98);
  const modelBelowProbability = Number((1 - modelAboveProbability).toFixed(4));
  const modelConfidence = Math.round(50 + Math.abs(modelAboveProbability - 0.5) * 100);

  return {
    riskLevel,
    features: {
      currentPrice: round(currentPrice) ?? 0,
      windowOpenPrice: round(windowOpenPrice) ?? 0,
      high15: round(high15),
      low15: round(low15),
      vwap120: round(vwap120),
      ema9: round(ema9),
      ema21: round(ema21),
      ema55: round(ema55),
      rsi14: round(rsi14Value),
      atr14: round(atr14Value),
      realizedVolatility15: round(toPercentCents(realizedVolatility15), 4),
      momentum3: round(momentum3, 3),
      momentum5: round(momentum5, 3),
      momentum10: round(momentum10, 3),
      momentum15: round(momentum15, 3),
      rangeCompression15: round(toPercentCents(rangeCompression15), 3),
      candleBodyBias: round(candleBodyBias, 3),
      distanceToStrike: round(distanceToStrike),
      distanceToStrikeBps: round(distanceToStrikeBps, 2),
      distanceToStrikeAtr: round(distanceToStrikeAtr, 3),
      trendBias,
      modelAboveProbability: Number(modelAboveProbability.toFixed(4)),
      modelBelowProbability,
      modelConfidence,
      factorScores: Object.fromEntries(
        Object.entries(factorScores).map(([key, value]) => [key, Number(value.toFixed(4))]),
      ),
    },
  };
}

export function buildSignalRecommendation(input: {
  market: KalshiBtcWindowSnapshot | null;
  features: BtcSignalFeatures;
  riskLevel: SignalRiskLevel;
}): SignalRecommendation {
  const { market, features, riskLevel } = input;
  const minimumEdge = signalConfig.minimumEdgeCents / 100;
  const reasons = topReasons(features.factorScores, features, market);
  const blockers: string[] = [];

  const yesAsk = market?.yesAskPrice ?? null;
  const noAsk = market?.noAskPrice ?? null;
  const yesEdge = yesAsk === null ? null : features.modelAboveProbability - yesAsk;
  const noEdge = noAsk === null ? null : features.modelBelowProbability - noAsk;

  if (riskLevel === "closing") {
    blockers.push(`New buys are suppressed inside the last ${signalConfig.noBuyCloseSeconds} seconds of the window.`);
  }

  if (features.modelConfidence < signalConfig.minimumConfidence) {
    blockers.push(`Model confidence is ${features.modelConfidence}, below the required ${signalConfig.minimumConfidence}.`);
  }

  if (market?.strikePrice === null || market?.strikePrice === undefined) {
    blockers.push("Kalshi did not return a usable BTC strike for this window.");
  }

  const bestSide =
    yesEdge !== null && noEdge !== null
      ? yesEdge >= noEdge
        ? "yes"
        : "no"
      : yesEdge !== null
        ? "yes"
        : noEdge !== null
          ? "no"
          : null;

  const bestEdge = bestSide === "yes" ? yesEdge : bestSide === "no" ? noEdge : null;
  const bestAsk = bestSide === "yes" ? yesAsk : bestSide === "no" ? noAsk : null;
  const fairValue =
    bestSide === "yes" ? features.modelAboveProbability : bestSide === "no" ? features.modelBelowProbability : null;

  if (bestEdge === null || bestEdge < minimumEdge) {
    blockers.push(`Model edge does not clear the ${signalConfig.minimumEdgeCents}c minimum.`);
  }

  const stakeMultiplier =
    bestEdge === null
      ? 0
      : clamp(0.55 + (bestEdge * 100) / 18 + (features.modelConfidence - 50) / 100, 0.35, 1);
  const suggestedStakeDollars = Number((signalConfig.stakeDollars * stakeMultiplier).toFixed(2));
  const suggestedContracts =
    bestAsk && bestAsk > 0 ? Math.max(0, Math.floor(suggestedStakeDollars / bestAsk)) : 0;

  const actionable =
    blockers.length === 0 &&
    bestSide !== null &&
    bestAsk !== null &&
    fairValue !== null &&
    suggestedContracts > 0;

  return {
    action: actionable ? (bestSide === "yes" ? "buy_yes" : "buy_no") : "no_buy",
    contractSide: actionable ? bestSide : null,
    label: actionable ? (bestSide === "yes" ? "Buy YES" : "Buy NO") : "No Buy",
    buyPriceDollars: actionable ? bestAsk : null,
    fairValueDollars: actionable ? Number(fairValue.toFixed(4)) : null,
    edgeDollars: actionable && bestEdge !== null ? Number(bestEdge.toFixed(4)) : null,
    edgePct:
      actionable && fairValue !== null && bestAsk !== null && bestAsk > 0
        ? Number((((fairValue - bestAsk) / bestAsk) * 100).toFixed(2))
        : null,
    modelProbability: actionable && fairValue !== null ? Number((fairValue * 100).toFixed(2)) : null,
    confidence: features.modelConfidence,
    suggestedStakeDollars: actionable ? suggestedStakeDollars : 0,
    suggestedContracts: actionable ? suggestedContracts : 0,
    reasons,
    blockers,
  };
}
