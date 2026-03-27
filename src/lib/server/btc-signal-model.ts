import type { Candle } from "@/lib/server/coinbase-client";
import { signalConfig } from "@/lib/server/signal-config";
import type {
  BtcReversalSignal,
  BtcSignalFeatures,
  BtcTestCaseSignal,
  HourlyRegime,
  HourlyRegimeTilt,
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

function buildRsiSeries(candles: Candle[], period: number) {
  return candles.map((_, index) => {
    if (index < period) {
      return null;
    }

    let gains = 0;
    let losses = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const change = candles[cursor].close - candles[cursor - 1].close;
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
  });
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

function logit(value: number) {
  const bounded = clamp(value, 0.02, 0.98);
  return Math.log(bounded / (1 - bounded));
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

function sign(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function latestDirectionChanges(candles: Candle[], lookback: number) {
  const slice = candles.slice(-lookback);
  if (slice.length < 3) {
    return 0;
  }

  let changes = 0;
  let previousDirection = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const direction = sign(slice[index].close - slice[index - 1].close);
    if (direction === 0) {
      continue;
    }
    if (previousDirection !== 0 && direction !== previousDirection) {
      changes += 1;
    }
    previousDirection = direction;
  }

  return changes;
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

function averageVolume(candles: Candle[], lookback: number) {
  return average(candles.slice(-lookback).map((candle) => candle.volume));
}

function buildRecommendationFromProbabilities(input: {
  market: KalshiBtcWindowSnapshot | null;
  riskLevel: SignalRiskLevel;
  modelAboveProbability: number;
  modelBelowProbability: number;
  modelConfidence: number;
  reasons: string[];
  extraBlockers?: string[];
}) {
  const { market, riskLevel, modelAboveProbability, modelBelowProbability, modelConfidence, reasons, extraBlockers = [] } = input;
  const minimumEdge = signalConfig.minimumEdgeCents / 100;
  const blockers = [...extraBlockers];
  const yesAsk = market?.yesAskPrice ?? null;
  const noAsk = market?.noAskPrice ?? null;
  const yesEdge = yesAsk === null ? null : modelAboveProbability - yesAsk;
  const noEdge = noAsk === null ? null : modelBelowProbability - noAsk;

  if (riskLevel === "closing") {
    blockers.push(`New buys are suppressed inside the last ${signalConfig.noBuyCloseSeconds} seconds of the window.`);
  }

  if (modelConfidence < signalConfig.minimumConfidence) {
    blockers.push(`Model confidence is ${modelConfidence}, below the required ${signalConfig.minimumConfidence}.`);
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
    bestSide === "yes" ? modelAboveProbability : bestSide === "no" ? modelBelowProbability : null;

  if (bestEdge === null || bestEdge < minimumEdge) {
    blockers.push(`Model edge does not clear the ${signalConfig.minimumEdgeCents}c minimum.`);
  }

  const stakeMultiplier =
    bestEdge === null
      ? 0
      : clamp(0.55 + (bestEdge * 100) / 18 + (modelConfidence - 50) / 100, 0.35, 1);
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
    confidence: modelConfidence,
    suggestedStakeDollars: actionable ? suggestedStakeDollars : 0,
    suggestedContracts: actionable ? suggestedContracts : 0,
    reasons,
    blockers,
  } satisfies SignalRecommendation;
}

function findExtreme(
  candles: Candle[],
  startIndex: number,
  endIndex: number,
  type: "high" | "low",
) {
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  let bestIndex = startIndex;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    if (type === "high" ? candles[index].high > candles[bestIndex].high : candles[index].low < candles[bestIndex].low) {
      bestIndex = index;
    }
  }

  return { index: bestIndex, candle: candles[bestIndex] };
}

function nearestLevelDistance(price: number, levels: Array<number | null | undefined>) {
  const numericLevels = levels.filter((level): level is number => typeof level === "number" && Number.isFinite(level));
  if (!numericLevels.length) {
    return null;
  }

  return Math.min(...numericLevels.map((level) => Math.abs(price - level)));
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

export function buildReversalSignal(input: {
  candles: Candle[];
  features: BtcSignalFeatures;
  market: KalshiBtcWindowSnapshot | null;
  riskLevel: SignalRiskLevel;
}): BtcReversalSignal {
  const { candles, features, market, riskLevel } = input;
  const current = candles.at(-1);
  const previous = candles.at(-2);

  if (!current || !previous) {
    return {
      watchStatus: "none",
      activeStatus: "none",
      direction: "neutral",
      confidence: 50,
      score: 0,
      reasons: [],
      riskFlags: ["Not enough candle history for reversal detection."],
      triggerLevel: null,
      invalidatesBelow: null,
      invalidatesAbove: null,
      estimatedWindow: null,
      factorScores: {},
    };
  }

  const rsiValues = buildRsiSeries(candles, 14);
  const avgVol10 = averageVolume(candles.slice(0, -1), 10);
  const volumeBoost = avgVol10 && avgVol10 > 0 ? current.volume / avgVol10 : 1;
  const atr14 = features.atr14 ?? 0;
  const tolerance = Math.max(atr14 * 0.18, features.currentPrice * 0.00045, 12);
  const currentBody = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const recentHigh = Math.max(...candles.slice(-6, -1).map((candle) => candle.high));
  const recentLow = Math.min(...candles.slice(-6, -1).map((candle) => candle.low));
  const closeToResistance =
    nearestLevelDistance(current.high, [market?.strikePrice ?? null, features.high15, features.vwap120, recentHigh]) ?? Infinity;
  const closeToSupport =
    nearestLevelDistance(current.low, [market?.strikePrice ?? null, features.low15, features.vwap120, recentLow]) ?? Infinity;
  const volumeConfirmed = volumeBoost >= 1.18;
  const directionalFactors: Record<string, number> = {};
  const bullReasons: Array<{ label: string; score: number }> = [];
  const bearReasons: Array<{ label: string; score: number }> = [];
  const riskFlags: string[] = [];
  let bullWatchScore = 0;
  let bearWatchScore = 0;
  let bullActiveScore = 0;
  let bearActiveScore = 0;
  let bullishTriggerLevel: number | null = recentHigh;
  let bearishTriggerLevel: number | null = recentLow;
  let bullishInvalidation: number | null = Math.min(current.low, recentLow);
  let bearishInvalidation: number | null = Math.max(current.high, recentHigh);

  const recentHighExtreme = findExtreme(candles, Math.max(0, candles.length - 6), candles.length - 1, "high");
  const priorHighExtreme = findExtreme(candles, Math.max(0, candles.length - 12), Math.max(0, candles.length - 6), "high");
  const recentLowExtreme = findExtreme(candles, Math.max(0, candles.length - 6), candles.length - 1, "low");
  const priorLowExtreme = findExtreme(candles, Math.max(0, candles.length - 12), Math.max(0, candles.length - 6), "low");

  if (
    recentHighExtreme &&
    priorHighExtreme &&
    recentHighExtreme.candle.high > priorHighExtreme.candle.high &&
    (rsiValues[recentHighExtreme.index] ?? 50) + 2.5 < (rsiValues[priorHighExtreme.index] ?? 50)
  ) {
    directionalFactors.rsiDivergence = -1.35;
    bearWatchScore += 1.35;
    bearReasons.push({
      label: "Price made a higher high while RSI failed to confirm it.",
      score: 1.35,
    });
    bearishInvalidation = Math.max(bearishInvalidation ?? recentHighExtreme.candle.high, recentHighExtreme.candle.high);
  }

  if (
    recentLowExtreme &&
    priorLowExtreme &&
    recentLowExtreme.candle.low < priorLowExtreme.candle.low &&
    (rsiValues[recentLowExtreme.index] ?? 50) > (rsiValues[priorLowExtreme.index] ?? 50) + 2.5
  ) {
    directionalFactors.rsiDivergence = 1.35;
    bullWatchScore += 1.35;
    bullReasons.push({
      label: "Price made a lower low while RSI held a higher low.",
      score: 1.35,
    });
    bullishInvalidation = Math.min(bullishInvalidation ?? recentLowExtreme.candle.low, recentLowExtreme.candle.low);
  }

  const bearishFailureSwing =
    features.rsi14 !== null &&
    features.rsi14 > 62 &&
    (features.momentum3 ?? 0) < 0 &&
    current.close < previous.close &&
    current.close < current.open;
  if (bearishFailureSwing) {
    directionalFactors.failureSwing = -0.9;
    bearWatchScore += 0.9;
    bearReasons.push({
      label: "RSI is rolling lower after an overbought push.",
      score: 0.9,
    });
  }

  const bullishFailureSwing =
    features.rsi14 !== null &&
    features.rsi14 < 38 &&
    (features.momentum3 ?? 0) > 0 &&
    current.close > previous.close &&
    current.close > current.open;
  if (bullishFailureSwing) {
    directionalFactors.failureSwing = 0.9;
    bullWatchScore += 0.9;
    bullReasons.push({
      label: "RSI is lifting after an oversold washout.",
      score: 0.9,
    });
  }

  const bearishRejection =
    closeToResistance <= tolerance &&
    upperWick > currentBody * 1.3 &&
    current.close < current.open;
  if (bearishRejection) {
    directionalFactors.levelRejection = -1.1;
    bearWatchScore += 1.1;
    bearReasons.push({
      label: "Upper-wick rejection formed near resistance or the Kalshi strike.",
      score: 1.1,
    });
  }

  const bullishRejection =
    closeToSupport <= tolerance &&
    lowerWick > currentBody * 1.3 &&
    current.close > current.open;
  if (bullishRejection) {
    directionalFactors.levelRejection = 1.1;
    bullWatchScore += 1.1;
    bullReasons.push({
      label: "Lower-wick rejection formed near support or the Kalshi strike.",
      score: 1.1,
    });
  }

  const bearishStretch =
    features.trendBias === "bullish" &&
    features.rsi14 !== null &&
    features.rsi14 > 66 &&
    features.vwap120 !== null &&
    atr14 > 0 &&
    features.currentPrice > features.vwap120 + atr14 * 0.55 &&
    (features.momentum3 ?? 0) < (features.momentum10 ?? 0);
  if (bearishStretch) {
    directionalFactors.stretch = -0.85;
    bearWatchScore += 0.85;
    bearReasons.push({
      label: "BTC is extended above VWAP and momentum is cooling.",
      score: 0.85,
    });
  }

  const bullishStretch =
    features.trendBias === "bearish" &&
    features.rsi14 !== null &&
    features.rsi14 < 34 &&
    features.vwap120 !== null &&
    atr14 > 0 &&
    features.currentPrice < features.vwap120 - atr14 * 0.55 &&
    (features.momentum3 ?? 0) > (features.momentum10 ?? 0);
  if (bullishStretch) {
    directionalFactors.stretch = 0.85;
    bullWatchScore += 0.85;
    bullReasons.push({
      label: "BTC is stretched below VWAP and downside momentum is fading.",
      score: 0.85,
    });
  }

  const bearishFalseBreak = current.high > recentHigh + tolerance * 0.15 && current.close < recentHigh;
  if (bearishFalseBreak) {
    directionalFactors.falseBreak = -1.05;
    bearWatchScore += 1.05;
    bearReasons.push({
      label: "Price broke above the recent high and fell back inside the range.",
      score: 1.05,
    });
    bearishTriggerLevel = recentLow;
    bearishInvalidation = Math.max(bearishInvalidation ?? current.high, current.high);
  }

  const bullishFalseBreak = current.low < recentLow - tolerance * 0.15 && current.close > recentLow;
  if (bullishFalseBreak) {
    directionalFactors.falseBreak = 1.05;
    bullWatchScore += 1.05;
    bullReasons.push({
      label: "Price broke below the recent low and reclaimed the range.",
      score: 1.05,
    });
    bullishTriggerLevel = recentHigh;
    bullishInvalidation = Math.min(bullishInvalidation ?? current.low, current.low);
  }

  const bearishStructureBreak =
    features.trendBias !== "bearish" &&
    current.close < recentLow &&
    current.close < (features.ema9 ?? current.close) &&
    (features.momentum3 ?? 0) < 0;
  if (bearishStructureBreak) {
    directionalFactors.structureBreak = -1.55;
    bearActiveScore += 1.55;
    bearReasons.push({
      label: "Price lost the recent 1-minute swing low and slipped under the fast trend.",
      score: 1.55,
    });
  }

  const bullishStructureBreak =
    features.trendBias !== "bullish" &&
    current.close > recentHigh &&
    current.close > (features.ema9 ?? current.close) &&
    (features.momentum3 ?? 0) > 0;
  if (bullishStructureBreak) {
    directionalFactors.structureBreak = 1.55;
    bullActiveScore += 1.55;
    bullReasons.push({
      label: "Price reclaimed the recent 1-minute swing high and pushed back above fast trend.",
      score: 1.55,
    });
  }

  const bearishTrendTurn =
    features.trendBias === "bullish" &&
    current.close < (features.ema9 ?? current.close) &&
    previous.close > (features.ema9 ?? previous.close) &&
    (features.momentum3 ?? 0) < 0;
  if (bearishTrendTurn) {
    directionalFactors.emaInflection = -0.9;
    bearActiveScore += 0.9;
    bearReasons.push({
      label: "Fast trend support just gave way after a prior upside run.",
      score: 0.9,
    });
  }

  const bullishTrendTurn =
    features.trendBias === "bearish" &&
    current.close > (features.ema9 ?? current.close) &&
    previous.close < (features.ema9 ?? previous.close) &&
    (features.momentum3 ?? 0) > 0;
  if (bullishTrendTurn) {
    directionalFactors.emaInflection = 0.9;
    bullActiveScore += 0.9;
    bullReasons.push({
      label: "Fast trend resistance just gave way after a prior downside run.",
      score: 0.9,
    });
  }

  if (volumeConfirmed) {
    if (bearWatchScore + bearActiveScore > bullWatchScore + bullActiveScore) {
      directionalFactors.volumeConfirmation = -0.45;
      bearWatchScore += 0.2;
      bearActiveScore += 0.25;
      bearReasons.push({
        label: "The rejection is arriving with above-average volume.",
        score: 0.45,
      });
    } else if (bullWatchScore + bullActiveScore > bearWatchScore + bearActiveScore) {
      directionalFactors.volumeConfirmation = 0.45;
      bullWatchScore += 0.2;
      bullActiveScore += 0.25;
      bullReasons.push({
        label: "The reclaim is arriving with above-average volume.",
        score: 0.45,
      });
    }
  } else {
    riskFlags.push("Volume confirmation is still light.");
  }

  const bullTotal = bullWatchScore + bullActiveScore * 1.15;
  const bearTotal = bearWatchScore + bearActiveScore * 1.15;
  const dominantStrength = Math.max(bullTotal, bearTotal);
  const balanceGap = Math.abs(bullTotal - bearTotal);
  const direction =
    dominantStrength < 1.25 || balanceGap < 0.35
      ? "neutral"
      : bullTotal > bearTotal
        ? "bullish"
        : "bearish";
  const dominantWatchScore = direction === "bullish" ? bullWatchScore : direction === "bearish" ? bearWatchScore : 0;
  const dominantActiveScore = direction === "bullish" ? bullActiveScore : direction === "bearish" ? bearActiveScore : 0;
  const watchStatus =
    direction === "neutral"
      ? "none"
      : dominantWatchScore >= 2.75
        ? "soon"
        : dominantWatchScore >= 1.6
          ? "building"
          : "none";
  const activeStatus =
    direction === "neutral"
      ? "none"
      : dominantActiveScore >= 2.7
        ? "active"
        : dominantActiveScore >= 1.45
          ? "starting"
          : "none";
  const confidence =
    direction === "neutral"
      ? 50
      : Math.round(clamp(50 + dominantStrength * 11 + balanceGap * 8, 52, 94));
  const score = round(direction === "bullish" ? bullTotal : direction === "bearish" ? bearTotal : dominantStrength, 3) ?? 0;

  if (direction === "neutral") {
    riskFlags.push("Bullish and bearish reversal signals are still too balanced.");
  } else if (watchStatus !== "none" && activeStatus === "none") {
    riskFlags.push("Structure has not fully broken yet, so this remains a watch signal.");
  }

  if (riskLevel === "closing") {
    riskFlags.push("Late-window noise is elevated near settlement.");
  }

  const directionalReasons = direction === "bullish" ? bullReasons : direction === "bearish" ? bearReasons : [];
  const reasons =
    direction === "neutral"
      ? ["No clean reversal setup is dominating yet."]
      : directionalReasons
          .sort((left, right) => right.score - left.score)
          .slice(0, 4)
          .map((entry) => entry.label);

  return {
    watchStatus,
    activeStatus,
    direction,
    confidence,
    score,
    reasons,
    riskFlags: Array.from(new Set(riskFlags)),
    triggerLevel:
      direction === "bullish"
        ? round(bullishTriggerLevel)
        : direction === "bearish"
          ? round(bearishTriggerLevel)
          : null,
    invalidatesBelow: direction === "bullish" ? round(bullishInvalidation) : null,
    invalidatesAbove: direction === "bearish" ? round(bearishInvalidation) : null,
    estimatedWindow:
      watchStatus === "soon" ? "next 1-3 candles" : watchStatus === "building" ? "next 3-5 candles" : null,
    factorScores: Object.fromEntries(
      Object.entries(directionalFactors).map(([key, value]) => [key, Number(value.toFixed(4))]),
    ),
  };
}

export function buildSignalRecommendation(input: {
  market: KalshiBtcWindowSnapshot | null;
  features: BtcSignalFeatures;
  riskLevel: SignalRiskLevel;
}): SignalRecommendation {
  const { market, features, riskLevel } = input;
  const reasons = topReasons(features.factorScores, features, market);
  return buildRecommendationFromProbabilities({
    market,
    riskLevel,
    modelAboveProbability: features.modelAboveProbability,
    modelBelowProbability: features.modelBelowProbability,
    modelConfidence: features.modelConfidence,
    reasons,
  });
}

export function buildTestCaseSignal(input: {
  candles: Candle[];
  features: BtcSignalFeatures;
  market: KalshiBtcWindowSnapshot | null;
  riskLevel: SignalRiskLevel;
  reversal: BtcReversalSignal;
}): BtcTestCaseSignal {
  const { candles, features, market, riskLevel, reversal } = input;
  const hourlySlice = candles.slice(-60);
  const hourlyHigh = hourlySlice.length ? Math.max(...hourlySlice.map((candle) => candle.high)) : features.currentPrice;
  const hourlyLow = hourlySlice.length ? Math.min(...hourlySlice.map((candle) => candle.low)) : features.currentPrice;
  const hourlyRangePct =
    hourlySlice.length && features.currentPrice > 0 ? ((hourlyHigh - hourlyLow) / features.currentPrice) * 100 : 0;
  const hourlyMomentum = momentum(candles, 60) ?? momentum(candles, 30) ?? 0;
  const hourlyVwap = vwap(hourlySlice);
  const hourlyVwapDistanceAtr =
    hourlyVwap !== null && (features.atr14 ?? 0) > 0 ? (features.currentPrice - hourlyVwap) / (features.atr14 ?? 1) : 0;
  const alternationRatio =
    hourlySlice.length >= 8 ? latestDirectionChanges(hourlySlice, Math.min(14, hourlySlice.length)) / Math.max(1, Math.min(14, hourlySlice.length) - 2) : 0;
  const close = candles.at(-1);
  const recentHigh = Math.max(...candles.slice(-6, -1).map((candle) => candle.high));
  const recentLow = Math.min(...candles.slice(-6, -1).map((candle) => candle.low));
  const currentBody = close ? Math.abs(close.close - close.open) : 0;
  const upperWick = close ? close.high - Math.max(close.open, close.close) : 0;
  const lowerWick = close ? Math.min(close.open, close.close) - close.low : 0;
  const strikePrice = market?.strikePrice ?? null;
  const strikeTolerance = Math.max((features.atr14 ?? 0) * 0.22, features.currentPrice * 0.00045, 10);

  let hourlyRegime: HourlyRegime = "range";
  let hourlyTilt: HourlyRegimeTilt = "neutral";

  if (alternationRatio >= 0.58 && Math.abs(hourlyMomentum) < 0.25) {
    hourlyRegime = "chop";
  } else if (
    Math.abs(hourlyVwapDistanceAtr) >= 1.15 &&
    Math.abs(hourlyMomentum) >= 0.42 &&
    (features.trendBias === "bullish" || features.trendBias === "bearish")
  ) {
    hourlyRegime = "stretched";
    hourlyTilt = features.trendBias;
  } else if (
    hourlyMomentum >= 0.34 &&
    features.trendBias === "bullish" &&
    (hourlyVwap === null || features.currentPrice >= hourlyVwap)
  ) {
    hourlyRegime = "uptrend";
    hourlyTilt = "bullish";
  } else if (
    hourlyMomentum <= -0.34 &&
    features.trendBias === "bearish" &&
    (hourlyVwap === null || features.currentPrice <= hourlyVwap)
  ) {
    hourlyRegime = "downtrend";
    hourlyTilt = "bearish";
  } else if (hourlyRangePct <= 0.95 || Math.abs(hourlyMomentum) < 0.18) {
    hourlyRegime = "range";
  }

  const modelDirection = features.modelAboveProbability >= features.modelBelowProbability ? "above" : "below";
  const directionSign = modelDirection === "above" ? 1 : -1;
  const distanceSign = sign(features.distanceToStrike);
  const reversalSign =
    reversal.direction === "bullish" ? 1 : reversal.direction === "bearish" ? -1 : 0;
  const momentumDisagreement =
    sign(features.momentum5) !== 0 &&
    sign(features.momentum15) !== 0 &&
    sign(features.momentum5) !== sign(features.momentum15);
  const strikeDisagreement = distanceSign !== 0 && distanceSign !== directionSign;
  const reversalDisagreement = reversalSign !== 0 && reversalSign !== directionSign;
  const nearStrike = Math.abs(features.distanceToStrikeAtr ?? 0) <= 0.3;
  const failureToHoldAbove =
    close !== undefined &&
    strikePrice !== null &&
    close.high > strikePrice + strikeTolerance * 0.15 &&
    close.close < strikePrice;
  const failureToHoldBelow =
    close !== undefined &&
    strikePrice !== null &&
    close.low < strikePrice - strikeTolerance * 0.15 &&
    close.close > strikePrice;
  const wickImbalance =
    currentBody > 0
      ? (lowerWick - upperWick) / Math.max(currentBody, strikeTolerance * 0.08)
      : 0;

  let flipRiskScore = 0;
  const factorScores: Record<string, number> = {};
  const reasons: Array<{ label: string; score: number }> = [];
  const riskFlags: string[] = [];

  if (hourlyRegime === "uptrend") {
    factorScores.hourlyRegime = 1.05;
    reasons.push({ label: "The last hour is trending higher, so aligned upside continuations deserve more trust.", score: 1.05 });
  } else if (hourlyRegime === "downtrend") {
    factorScores.hourlyRegime = -1.05;
    reasons.push({ label: "The last hour is trending lower, so aligned downside continuations deserve more trust.", score: 1.05 });
  } else if (hourlyRegime === "stretched") {
    factorScores.hourlyRegime = hourlyTilt === "bullish" ? -0.8 : hourlyTilt === "bearish" ? 0.8 : 0;
    reasons.push({
      label:
        hourlyTilt === "bullish"
          ? "The last hour is stretched up, which can trap late YES entries."
          : hourlyTilt === "bearish"
            ? "The last hour is stretched down, which can trap late NO entries."
            : "The last hour is stretched without a clean directional read.",
      score: 0.8,
    });
  } else if (hourlyRegime === "chop") {
    factorScores.hourlyRegime = 0;
    riskFlags.push("Hourly tape is choppy, so first-decision entries are more likely to flip.");
  }

  if (momentumDisagreement) {
    flipRiskScore += 1.05;
    factorScores.momentumConflict = -1.05 * directionSign;
    riskFlags.push("5-minute and 15-minute momentum are disagreeing.");
  }
  if (strikeDisagreement) {
    flipRiskScore += 1.2;
    factorScores.strikeConflict = -1.2 * directionSign;
    riskFlags.push("BTC is on the wrong side of the strike for the current live lean.");
  }
  if (reversalDisagreement) {
    const reversalWeight = reversal.activeStatus === "active" ? 1.35 : reversal.watchStatus === "soon" ? 1.15 : 0.7;
    flipRiskScore += reversalWeight;
    factorScores.reversalConflict = -reversalWeight * directionSign;
    riskFlags.push("The reversal layer is leaning against the live directional call.");
  }
  if (nearStrike) {
    flipRiskScore += 0.7;
    factorScores.strikePinning = -0.55 * directionSign;
    riskFlags.push("Price is still hugging the strike, so late tape can easily flip the outcome.");
  }
  if (hourlyRegime === "chop" || alternationRatio >= 0.58) {
    flipRiskScore += 0.85;
    factorScores.chopTax = -0.85 * directionSign;
  }

  const flipRisk =
    flipRiskScore >= 3.1 ? "high" : flipRiskScore >= 1.7 ? "medium" : "low";

  const rangeFilter =
    hourlyRegime === "chop" || alternationRatio >= 0.58
      ? "chop"
      : hourlyRegime === "range" || (hourlyRangePct <= 1.1 && Math.abs(hourlyMomentum) < 0.24)
        ? "range"
        : "clean";

  const supportsYes =
    distanceSign >= 0 &&
    (wickImbalance > 0.45 || failureToHoldBelow || (close ? close.close > recentHigh : false));
  const supportsNo =
    distanceSign <= 0 &&
    (wickImbalance < -0.45 || failureToHoldAbove || (close ? close.close < recentLow : false));
  const structureBias =
    supportsYes && !supportsNo ? "supports_yes" : supportsNo && !supportsYes ? "supports_no" : "neutral";
  const structureScore = round(
    structureBias === "supports_yes" ? Math.max(0.4, wickImbalance) : structureBias === "supports_no" ? Math.max(0.4, -wickImbalance) : 0,
    3,
  ) ?? 0;

  if (structureBias === "supports_yes") {
    factorScores.structure = 0.95;
    reasons.push({ label: "Recent candle structure is holding above nearby support instead of failing the move.", score: 0.95 });
  } else if (structureBias === "supports_no") {
    factorScores.structure = -0.95;
    reasons.push({ label: "Recent candle structure is failing rallies and leaning toward downside follow-through.", score: 0.95 });
  } else {
    riskFlags.push("Candle structure is mixed, with no clean hold or rejection sequence yet.");
  }

  const alignment =
    hourlyTilt === "neutral"
      ? "neutral"
      : (hourlyTilt === "bullish" && modelDirection === "above") || (hourlyTilt === "bearish" && modelDirection === "below")
        ? "aligned"
        : "countertrend";

  if (alignment === "aligned") {
    factorScores.alignment = directionSign * 0.8;
    reasons.push({ label: "The hourly regime agrees with the live 15-minute direction.", score: 0.8 });
  } else if (alignment === "countertrend") {
    factorScores.alignment = -directionSign * 0.95;
    riskFlags.push("The live 15-minute call is fighting the larger one-hour regime.");
  }

  let adjustedRaw = logit(features.modelAboveProbability);
  adjustedRaw += Object.values(factorScores).reduce((sum, value) => sum + value, 0) * 0.34;
  adjustedRaw +=
    hourlyRegime === "stretched" && hourlyTilt === "bullish"
      ? -0.24
      : hourlyRegime === "stretched" && hourlyTilt === "bearish"
        ? 0.24
        : 0;
  adjustedRaw += structureBias === "supports_yes" ? 0.16 : structureBias === "supports_no" ? -0.16 : 0;
  adjustedRaw += rangeFilter === "chop" ? -0.08 * directionSign : 0;

  let adjustedAboveProbability = clamp(sigmoid(adjustedRaw), 0.02, 0.98);
  if (rangeFilter !== "clean" || flipRisk !== "low") {
    const shrink = flipRisk === "high" ? 0.32 : flipRisk === "medium" ? 0.2 : 0.1;
    adjustedAboveProbability = clamp(0.5 + (adjustedAboveProbability - 0.5) * (1 - shrink), 0.02, 0.98);
  }
  const adjustedBelowProbability = Number((1 - adjustedAboveProbability).toFixed(4));
  const testCaseConfidence = Math.round(
    clamp(
      50 +
        Math.abs(adjustedAboveProbability - 0.5) * 100 -
        flipRiskScore * 6 -
        (rangeFilter === "chop" ? 7 : rangeFilter === "range" ? 3 : 0) +
        (alignment === "aligned" ? 5 : alignment === "countertrend" ? -6 : 0),
      50,
      95,
    ),
  );

  const blockers: string[] = [];
  if (alignment === "countertrend") {
    blockers.push("Hourly regime is countertrend to the live 15-minute direction.");
  }
  if (flipRisk === "high") {
    blockers.push("Flip-risk is high because the signal stack is internally unstable.");
  }
  if (rangeFilter === "chop") {
    blockers.push("BTC is oscillating in chop rather than showing clean persistence.");
  }

  const orderedReasons = reasons
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.label);

  const recommendation = buildRecommendationFromProbabilities({
    market,
    riskLevel,
    modelAboveProbability: Number(adjustedAboveProbability.toFixed(4)),
    modelBelowProbability: adjustedBelowProbability,
    modelConfidence: testCaseConfidence,
    reasons: orderedReasons.length
      ? orderedReasons
      : ["The test case still falls back to the base 15-minute model because no extra regime edge is clear."],
    extraBlockers: blockers,
  });

  return {
    hourlyRegime,
    hourlyTilt,
    alignment,
    flipRisk,
    flipRiskScore: round(flipRiskScore, 3) ?? 0,
    rangeFilter,
    structureBias,
    structureScore,
    modelAboveProbability: Number(adjustedAboveProbability.toFixed(4)),
    modelBelowProbability: adjustedBelowProbability,
    modelConfidence: testCaseConfidence,
    recommendation,
    reasons:
      orderedReasons.length > 0
        ? orderedReasons
        : ["The test case does not yet see a stronger alternative edge than the base model."],
    riskFlags: Array.from(new Set(riskFlags)),
    factorScores: Object.fromEntries(
      Object.entries({
        ...factorScores,
        hourlyMomentum,
        alternationRatio,
      }).map(([key, value]) => [key, Number(value.toFixed(4))]),
    ),
  };
}
