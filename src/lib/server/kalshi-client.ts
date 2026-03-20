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

type KalshiPositionApi = {
  ticker?: string;
  position_fp?: string | null;
  realized_pnl_dollars?: string | null;
};

type PositionsResponse = {
  market_positions?: KalshiPositionApi[];
};

type KalshiFillApi = {
  order_id?: string | null;
  market_ticker?: string | null;
  ticker?: string | null;
  side?: "yes" | "no" | null;
  action?: "buy" | "sell" | null;
  count_fp?: string | null;
  yes_price_dollars?: string | null;
  no_price_dollars?: string | null;
  client_order_id?: string | null;
  created_time?: string | null;
};

type FillsResponse = {
  fills?: KalshiFillApi[];
  cursor?: string | null;
};

type OrderResponse = {
  order?: {
    order_id?: string;
    client_order_id?: string;
    status?: string | null;
    action?: string | null;
    yes_price_dollars?: string | null;
    no_price_dollars?: string | null;
    yes_price?: number | null;
    no_price?: number | null;
  };
};

export type KalshiPositionSnapshot = {
  ticker: string;
  contracts: number;
  realizedPnlDollars: number | null;
};

export type KalshiFillSnapshot = {
  marketTicker: string;
  orderId: string | null;
  clientOrderId: string | null;
  side: "yes" | "no";
  action: "buy" | "sell";
  contracts: number;
  priceDollars: number | null;
  createdAt: string | null;
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

export async function fetchKalshiMarketByTicker(ticker: string) {
  const response = await fetch(`${tradingConfig.kalshiBaseUrl}/markets/${ticker}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "btc-kalshi-bot/1.0",
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

export async function listKalshiPositions(ticker?: string) {
  if (!hasKalshiTradingCredentials()) {
    return [];
  }

  const path = `/portfolio/positions${ticker ? `?count_filter=position&ticker=${encodeURIComponent(ticker)}` : "?count_filter=position"}`;
  const requestUrl = `${tradingConfig.kalshiBaseUrl}${path}`;
  let response = await fetch(requestUrl, {
    headers: buildKalshiHeaders("GET", path, false),
    cache: "no-store",
  });

  if (response.status === 401) {
    response = await fetch(requestUrl, {
      headers: buildKalshiHeaders("GET", path, true),
      cache: "no-store",
    });
  }

  if (!response.ok) {
    throw new Error(`Kalshi positions lookup failed with ${response.status}.`);
  }

  const payload = (await response.json()) as PositionsResponse;
  return (payload.market_positions ?? []).map((position) => ({
    ticker: position.ticker ?? "unknown",
    contracts: Number(position.position_fp ?? 0),
    realizedPnlDollars: parsePrice(position.realized_pnl_dollars),
  })) satisfies KalshiPositionSnapshot[];
}

export async function listKalshiFills(ticker?: string, limit = 50) {
  if (!hasKalshiTradingCredentials()) {
    return [];
  }

  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(200, limit))),
  });
  if (ticker) {
    params.set("ticker", ticker);
  }

  const path = `/portfolio/fills?${params.toString()}`;
  const requestUrl = `${tradingConfig.kalshiBaseUrl}${path}`;
  let response = await fetch(requestUrl, {
    headers: buildKalshiHeaders("GET", path, false),
    cache: "no-store",
  });

  if (response.status === 401) {
    response = await fetch(requestUrl, {
      headers: buildKalshiHeaders("GET", path, true),
      cache: "no-store",
    });
  }

  if (!response.ok) {
    throw new Error(`Kalshi fills lookup failed with ${response.status}.`);
  }

  const payload = (await response.json()) as FillsResponse;
  return (payload.fills ?? []).map((fill) => ({
    marketTicker: fill.market_ticker ?? fill.ticker ?? "unknown",
    orderId: fill.order_id ?? null,
    clientOrderId: fill.client_order_id ?? null,
    side: fill.side === "no" ? "no" : "yes",
    action: fill.action === "sell" ? "sell" : "buy",
    contracts: Number(fill.count_fp ?? 0),
    priceDollars:
      fill.side === "no"
        ? parsePrice(fill.no_price_dollars)
        : parsePrice(fill.yes_price_dollars),
    createdAt: fill.created_time ?? null,
  })) satisfies KalshiFillSnapshot[];
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
  action?: "buy" | "sell";
  ticker: string;
  side: "yes" | "no";
  contracts: number;
  limitPriceCents: number;
  clientOrderId: string;
  reduceOnly?: boolean;
}) {
  if (!hasKalshiTradingCredentials()) {
    throw new Error("Kalshi trading credentials are missing.");
  }

  const path = "/portfolio/orders";
  const action = input.action ?? "buy";
  const totalCostCents = input.contracts * input.limitPriceCents;
  const timeInForce =
    action === "sell" && input.reduceOnly ? "immediate_or_cancel" : "fill_or_kill";
  const body = JSON.stringify({
    ticker: input.ticker,
    action,
    side: input.side,
    type: "limit",
    time_in_force: timeInForce,
    count: input.contracts,
    client_order_id: input.clientOrderId,
    ...(action === "buy" ? { buy_max_cost: totalCostCents } : {}),
    ...(input.reduceOnly ? { reduce_only: true } : {}),
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
