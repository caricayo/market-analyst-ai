const DEFAULT_TIME_ZONE = "Pacific/Honolulu";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const signalConfig = {
  timeZone: process.env.BOT_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE,
  coinbaseProductId: process.env.COINBASE_PRODUCT_ID?.trim() || "BTC-USD",
  kalshiBaseUrl: process.env.KALSHI_API_BASE_URL?.trim() || "https://api.elections.kalshi.com/trade-api/v2",
  stakeDollars: Math.max(1, parseNumber(process.env.BOT_FIXED_STAKE_DOLLARS, 10)),
  lookbackCandles: Math.max(120, Math.min(480, parseNumber(process.env.BOT_LOOKBACK_CANDLES, 360))),
  signalRefreshMs: Math.max(5_000, Math.min(60_000, parseNumber(process.env.BTC_SIGNAL_REFRESH_MS, 15_000))),
  staleAfterMs: Math.max(10_000, Math.min(180_000, parseNumber(process.env.BTC_SIGNAL_STALE_AFTER_MS, 30_000))),
  noBuyCloseSeconds: Math.max(15, Math.min(180, parseNumber(process.env.BTC_SIGNAL_NO_BUY_CLOSE_SECONDS, 60))),
  minimumEdgeCents: Math.max(1, Math.min(25, parseNumber(process.env.BTC_SIGNAL_MIN_EDGE_CENTS, 4))),
  minimumConfidence: Math.max(50, Math.min(98, parseNumber(process.env.BTC_SIGNAL_MIN_CONFIDENCE, 59))),
  historyLimit: Math.max(4, Math.min(24, Math.round(parseNumber(process.env.BTC_SIGNAL_HISTORY_LIMIT, 8)))),
  executionEnabled: parseBoolean(process.env.BTC_SIGNAL_AUTO_EXECUTE_ENABLED, false),
  executionStakeDollars: Math.max(1, parseNumber(process.env.BTC_SIGNAL_EXECUTION_STAKE_DOLLARS, 5)),
  explanationEnabled: parseBoolean(process.env.BTC_SIGNAL_EXPLANATION_ENABLED, true),
  explanationModel: process.env.OPENAI_SIGNAL_MODEL?.trim() || "gpt-5-mini",
  openAiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
};
