import type { KalshiBtcWindowSnapshot } from "@/lib/signal-types";
import { signalConfig } from "@/lib/server/signal-config";

type KalshiMarketApi = {
  ticker?: string;
  title?: string;
  subtitle?: string | null;
  status?: string | null;
  close_time?: string | null;
  expiration_time?: string | null;
  yes_ask_dollars?: string | null;
  no_ask_dollars?: string | null;
  yes_bid_dollars?: string | null;
  no_bid_dollars?: string | null;
  yes_sub_title?: string | null;
  no_sub_title?: string | null;
  floor_strike?: string | number | null;
  cap_strike?: string | number | null;
  custom_strike?: string | number | null;
  functional_strike?: string | number | null;
};

type MarketsResponse = {
  markets?: KalshiMarketApi[];
  cursor?: string | null;
};

type MarketResponse = {
  market?: KalshiMarketApi;
};

const BTC_FIFTEEN_MINUTE_SERIES = "KXBTC15M";

const cacheStore = globalThis as typeof globalThis & {
  __btcSignalKalshiCache?: {
    expiresAt: number;
    market: KalshiBtcWindowSnapshot | null;
  };
};

function parsePrice(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStrike(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const numeric = value.replace(/[^0-9.]/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStrikeFromText(...values: Array<string | null | undefined>) {
  const matches = values
    .filter(Boolean)
    .flatMap((value) => value?.match(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]{4,}(?:\.[0-9]+)?)/g) ?? []);

  const parsed = matches
    .map((value) => Number(value.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);

  return parsed[0] ?? null;
}

function getCloseTimestamp(market: KalshiMarketApi) {
  const closeTime = market.close_time ?? market.expiration_time;
  return closeTime ? Date.parse(closeTime) : Number.NaN;
}

function toSnapshot(market: KalshiMarketApi): KalshiBtcWindowSnapshot {
  const strikePrice =
    parseStrike(market.functional_strike) ??
    parseStrike(market.custom_strike) ??
    parseStrike(market.floor_strike) ??
    parseStrike(market.cap_strike) ??
    parseStrikeFromText(market.title, market.subtitle, market.yes_sub_title, market.no_sub_title);

  return {
    ticker: market.ticker ?? "unknown",
    title: market.title ?? "Unknown market",
    subtitle: market.subtitle ?? null,
    status: market.status ?? null,
    closeTime: market.close_time ?? null,
    expirationTime: market.expiration_time ?? null,
    strikePrice,
    yesAskPrice: parsePrice(market.yes_ask_dollars),
    noAskPrice: parsePrice(market.no_ask_dollars),
    yesBidPrice: parsePrice(market.yes_bid_dollars),
    noBidPrice: parsePrice(market.no_bid_dollars),
  };
}

function isActiveWindow(market: KalshiMarketApi, now: Date) {
  if (!market.ticker?.startsWith(BTC_FIFTEEN_MINUTE_SERIES)) {
    return false;
  }

  if ((market.status ?? "").toLowerCase() !== "active") {
    return false;
  }

  const closeTs = getCloseTimestamp(market);
  const msUntilClose = closeTs - now.getTime();
  return Number.isFinite(closeTs) && msUntilClose > 0 && msUntilClose <= 16 * 60_000;
}

async function fetchMarketPage(status: string | null, cursor?: string | null) {
  const params = new URLSearchParams({
    limit: "100",
    series_ticker: BTC_FIFTEEN_MINUTE_SERIES,
  });
  if (status) {
    params.set("status", status);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(`${signalConfig.kalshiBaseUrl}/markets?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "btc-signal-station/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kalshi market discovery failed with ${response.status}.`);
  }

  return (await response.json()) as MarketsResponse;
}

function getCachedMarket() {
  const cached = cacheStore.__btcSignalKalshiCache;
  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }
  return cached.market;
}

function setCachedMarket(market: KalshiBtcWindowSnapshot | null) {
  cacheStore.__btcSignalKalshiCache = {
    expiresAt: Date.now() + 10_000,
    market,
  };
}

export async function discoverActiveBtcWindow(now = new Date()) {
  const cached = getCachedMarket();
  if (cached) {
    return cached;
  }

  const statuses: Array<string | null> = ["open", null];

  for (const status of statuses) {
    let cursor: string | null | undefined = undefined;
    const candidates: KalshiMarketApi[] = [];

    for (let page = 0; page < 5; page += 1) {
      const payload = await fetchMarketPage(status, cursor);
      const markets = payload.markets ?? [];
      candidates.push(...markets.filter((market) => isActiveWindow(market, now)));
      cursor = payload.cursor;
      if (!cursor) {
        break;
      }
    }

    if (!candidates.length) {
      continue;
    }

    const selected = candidates
      .slice()
      .sort((left, right) => getCloseTimestamp(left) - getCloseTimestamp(right))[0];

    const snapshot = toSnapshot(selected);
    setCachedMarket(snapshot);
    return snapshot;
  }

  setCachedMarket(null);
  return null;
}

export async function fetchKalshiWindowByTicker(ticker: string) {
  const response = await fetch(`${signalConfig.kalshiBaseUrl}/markets/${encodeURIComponent(ticker)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "btc-signal-station/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kalshi market lookup failed with ${response.status}.`);
  }

  const payload = (await response.json()) as MarketResponse;
  if (!payload.market) {
    throw new Error("Kalshi market lookup returned no market payload.");
  }

  return toSnapshot(payload.market);
}
