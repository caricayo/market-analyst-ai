import { createPrivateKey, sign as signWithKey, constants } from "node:crypto";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";
import type { KalshiMarketSnapshot } from "@/lib/trading-types";

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
  event_ticker?: string | null;
  strike_type?: string | null;
  floor_strike?: string | null;
  cap_strike?: string | null;
  custom_strike?: string | null;
  functional_strike?: string | null;
};

type MarketsResponse = {
  markets?: KalshiMarketApi[];
  cursor?: string | null;
};

type OrderResponse = {
  order?: {
    order_id?: string;
    client_order_id?: string;
  };
};

type CachedMarketEntry = {
  expiresAt: number;
  market: KalshiMarketSnapshot | null;
};

const BTC_FIFTEEN_MINUTE_SERIES = "KXBTC15M";

const cacheStore = globalThis as typeof globalThis & {
  __btcKalshiMarketCache?: CachedMarketEntry;
};

function parsePrice(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStrike(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const numeric = value.replace(/[^0-9.]/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStrikeFromText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const match = value.match(/([0-9]{2,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/);
    if (!match) {
      continue;
    }

    const parsed = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function inferMapping(market: KalshiMarketApi) {
  const combined = [
    market.title,
    market.subtitle,
    market.yes_sub_title,
    market.no_sub_title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (combined.includes("below") || combined.includes("under")) {
    return {
      aboveSide: "no" as const,
      belowSide: "yes" as const,
    };
  }

  return {
    aboveSide: "yes" as const,
    belowSide: "no" as const,
  };
}

function getCloseTimestamp(market: KalshiMarketApi) {
  const closeTime = market.close_time ?? market.expiration_time;
  return closeTime ? Date.parse(closeTime) : Number.NaN;
}

function isActiveBtcFifteenMinuteMarket(market: KalshiMarketApi, now: Date) {
  if (!market.ticker?.startsWith(BTC_FIFTEEN_MINUTE_SERIES)) {
    return false;
  }

  const closeTs = getCloseTimestamp(market);
  const msUntilClose = closeTs - now.getTime();
  return Number.isFinite(closeTs) && msUntilClose > 0 && msUntilClose <= 16 * 60_000;
}

function toSnapshot(market: KalshiMarketApi): KalshiMarketSnapshot {
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
    yesAskPrice: parsePrice(market.yes_ask_dollars),
    noAskPrice: parsePrice(market.no_ask_dollars),
    yesBidPrice: parsePrice(market.yes_bid_dollars),
    noBidPrice: parsePrice(market.no_bid_dollars),
    strikePrice,
    mapping: inferMapping(market),
  };
}

function getCachedMarket() {
  const cached = cacheStore.__btcKalshiMarketCache;
  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }
  return cached.market;
}

function setCachedMarket(market: KalshiMarketSnapshot | null) {
  cacheStore.__btcKalshiMarketCache = {
    expiresAt: Date.now() + 15_000,
    market,
  };
}

async function fetchMarketPage(
  status: string | null,
  cursor?: string | null,
  seriesTicker = BTC_FIFTEEN_MINUTE_SERIES,
) {
  const params = new URLSearchParams({ limit: "100" });
  if (status) {
    params.set("status", status);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  if (seriesTicker) {
    params.set("series_ticker", seriesTicker);
  }

  const response = await fetch(`${tradingConfig.kalshiBaseUrl}/markets?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "btc-kalshi-bot/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kalshi market discovery failed with ${response.status}.`);
  }

  return (await response.json()) as MarketsResponse;
}

export async function discoverActiveBtcMarket(now = new Date()) {
  const cached = getCachedMarket();
  if (cached) {
    return cached;
  }

  const statuses: Array<string | null> = ["open", null];

  try {
    for (const status of statuses) {
      let cursor: string | null | undefined = undefined;
      const candidates: KalshiMarketApi[] = [];

      for (let page = 0; page < 5; page += 1) {
        const payload = await fetchMarketPage(status, cursor);
        const markets = payload.markets ?? [];
        candidates.push(...markets.filter((market) => isActiveBtcFifteenMinuteMarket(market, now)));
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
        .sort((left, right) => {
          const leftStatusScore = left.status === "active" ? 0 : 1;
          const rightStatusScore = right.status === "active" ? 0 : 1;
          if (leftStatusScore !== rightStatusScore) {
            return leftStatusScore - rightStatusScore;
          }

          const leftTs = getCloseTimestamp(left);
          const rightTs = getCloseTimestamp(right);
          return leftTs - rightTs;
        })[0];

      const snapshot = toSnapshot(selected);
      setCachedMarket(snapshot);
      return snapshot;
    }

    setCachedMarket(null);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("429")) {
      return getCachedMarket();
    }
    throw error;
  }
}

function buildKalshiHeaders(method: string, path: string, useFullApiPath: boolean) {
  const privateKey = createPrivateKey(tradingConfig.kalshiPrivateKeyPem);
  const timestamp = String(Date.now());
  const signedPath = useFullApiPath ? new URL(`${tradingConfig.kalshiBaseUrl}${path}`).pathname : path;
  const payload = `${timestamp}${method.toUpperCase()}${signedPath}`;
  const signature = signWithKey("sha256", Buffer.from(payload), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");

  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "btc-kalshi-bot/1.0",
    "KALSHI-ACCESS-KEY": tradingConfig.kalshiApiKeyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

export async function submitKalshiOrder(input: {
  ticker: string;
  side: "yes" | "no";
  contracts: number;
  limitPriceCents: number;
  clientOrderId: string;
}) {
  if (!hasKalshiTradingCredentials()) {
    throw new Error("Kalshi trading credentials are missing.");
  }

  const path = "/portfolio/orders";
  const totalCostCents = input.contracts * input.limitPriceCents;
  const body = JSON.stringify({
    ticker: input.ticker,
    action: "buy",
    side: input.side,
    type: "limit",
    time_in_force: "fill_or_kill",
    count: input.contracts,
    buy_max_cost: totalCostCents,
    client_order_id: input.clientOrderId,
    ...(input.side === "yes"
      ? { yes_price: input.limitPriceCents }
      : { no_price: input.limitPriceCents }),
  });

  const requestUrl = `${tradingConfig.kalshiBaseUrl}${path}`;
  let response = await fetch(requestUrl, {
    method: "POST",
    headers: buildKalshiHeaders("POST", path, false),
    body,
    cache: "no-store",
  });

  if (response.status === 401) {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: buildKalshiHeaders("POST", path, true),
      body,
      cache: "no-store",
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kalshi order failed with ${response.status}: ${errorText}`);
  }

  return (await response.json()) as OrderResponse;
}
