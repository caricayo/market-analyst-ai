import type { Candle } from "@/lib/server/coinbase-client";
import type { IndicatorSnapshot, TimingRiskLevel } from "@/lib/trading-types";

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(decimals));
}

function ema(candles: Candle[], period: number) {
  if (candles.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  let current = candles[0].close;
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

function momentum(candles: Candle[], lookback: number) {
  if (candles.length <= lookback) {
    return null;
  }
  const latest = candles.at(-1)?.close ?? 0;
  const base = candles.at(-1 - lookback)?.close ?? 0;
  if (!base) {
    return null;
  }
  return ((latest - base) / base) * 10_000;
}

function rangeSize(candles: Candle[], lookback: number) {
  if (candles.length < lookback) {
    return null;
  }
  const slice = candles.slice(-lookback);
  const highs = slice.map((candle) => candle.high);
  const lows = slice.map((candle) => candle.low);
  return Math.max(...highs) - Math.min(...lows);
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

export function getMinuteInWindow(date = new Date()) {
  return (date.getUTCMinutes() % 15) + 1;
}

export function classifyTimingRisk(minuteInWindow: number): TimingRiskLevel {
  if (minuteInWindow <= 3) {
    return "high-risk-open";
  }
  if (minuteInWindow >= 9) {
    return "late-window";
  }
  return "trade-window";
}

export function buildIndicatorSnapshot(candles: Candle[], strikePrice: number | null): IndicatorSnapshot {
  const currentPrice = candles.at(-1)?.close ?? 0;
  const ema9 = ema(candles, 9);
  const ema21 = ema(candles, 21);
  const ema55 = ema(candles, 55);
  const rsi14 = rsi(candles, 14);
  const atr14 = atr(candles, 14);
  const vwapValue = vwap(candles.slice(-120));
  const momentum5 = momentum(candles, 5);
  const momentum15 = momentum(candles, 15);
  const momentum30 = momentum(candles, 30);
  const range15 = rangeSize(candles, 15);
  const range60 = rangeSize(candles, 60);
  const distanceToStrike = strikePrice === null ? null : currentPrice - strikePrice;
  const distanceToStrikeBps =
    strikePrice && strikePrice !== 0 && distanceToStrike !== null
      ? (distanceToStrike / strikePrice) * 10_000
      : null;
  const emaBias =
    ema9 !== null && ema21 !== null && ema55 !== null
      ? ema9 > ema21 && ema21 > ema55
        ? 1
        : ema9 < ema21 && ema21 < ema55
          ? -1
          : 0
      : 0;
  const rsiBias =
    rsi14 === null ? 0 : rsi14 >= 58 ? 0.45 : rsi14 <= 42 ? -0.45 : 0;
  const strikeBias =
    distanceToStrike === null || atr14 === null || atr14 === 0 ? 0 : Math.max(-1.2, Math.min(1.2, distanceToStrike / atr14));
  const momentumBias = ((momentum5 ?? 0) * 0.25 + (momentum15 ?? 0) * 0.45 + (momentum30 ?? 0) * 0.3) / 100;
  const deterministicEdge = Number((emaBias * 0.45 + rsiBias + strikeBias * 0.9 + momentumBias).toFixed(3));
  const trendBias =
    deterministicEdge > 0.25 ? "bullish" : deterministicEdge < -0.25 ? "bearish" : "neutral";

  return {
    currentPrice: round(currentPrice) ?? 0,
    strikePrice: round(strikePrice),
    distanceToStrike: round(distanceToStrike),
    distanceToStrikeBps: round(distanceToStrikeBps),
    ema9: round(ema9),
    ema21: round(ema21),
    ema55: round(ema55),
    rsi14: round(rsi14),
    atr14: round(atr14),
    vwap: round(vwapValue),
    momentum5: round(momentum5),
    momentum15: round(momentum15),
    momentum30: round(momentum30),
    range15: round(range15),
    range60: round(range60),
    trendBias,
    deterministicEdge,
  };
}
