import { signalConfig } from "@/lib/server/signal-config";

export type Candle = {
  start: number;
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
};

type CoinbaseCandleResponse = [number, string, string, string, string, string];

async function fetchChunk(start: Date, end: Date) {
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    granularity: "60",
  });
  const url =
    `https://api.exchange.coinbase.com/products/${encodeURIComponent(signalConfig.coinbaseProductId)}/candles?` +
    params.toString();
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "btc-kalshi-bot/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Coinbase candle request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as CoinbaseCandleResponse[];
  return payload
    .map(([startTs, low, high, open, close, volume]) => ({
      start: startTs,
      low: Number(low),
      high: Number(high),
      open: Number(open),
      close: Number(close),
      volume: Number(volume),
    }))
    .filter((candle) =>
      [
        candle.start,
        candle.low,
        candle.high,
        candle.open,
        candle.close,
        candle.volume,
      ].every((value) => Number.isFinite(value)),
    )
    .sort((left, right) => left.start - right.start);
}

export async function fetchCoinbaseCandlesInRange(start: Date, end: Date) {
  return fetchChunk(start, end);
}

export async function fetchCoinbaseCandles() {
  const now = new Date();
  const end = new Date(now.getTime() + 60_000);
  const lookbackMinutes = signalConfig.lookbackCandles;
  const chunkMinutes = 300;
  const chunkCount = Math.ceil(lookbackMinutes / chunkMinutes);
  const chunks: Promise<Candle[]>[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkEnd = new Date(end.getTime() - chunkIndex * chunkMinutes * 60_000);
    const remainingMinutes = lookbackMinutes - chunkIndex * chunkMinutes;
    const currentChunkMinutes = Math.min(chunkMinutes, remainingMinutes);
    const chunkStart = new Date(chunkEnd.getTime() - currentChunkMinutes * 60_000);
    chunks.push(fetchChunk(chunkStart, chunkEnd));
  }

  const candles = (await Promise.all(chunks))
    .flat()
    .filter(
      (candle, index, items) =>
        items.findIndex((candidate) => candidate.start === candle.start) === index,
    )
    .sort((left, right) => left.start - right.start);

  if (candles.length < 60) {
    throw new Error("Coinbase returned too few candles for a reliable 15-minute analysis.");
  }

  return candles;
}
