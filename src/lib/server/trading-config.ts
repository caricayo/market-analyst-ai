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

export const tradingConfig = {
  coinbaseProductId: process.env.COINBASE_PRODUCT_ID?.trim() || "BTC-USD",
  lookbackCandles: Math.max(120, Math.min(350, parseNumber(process.env.BOT_LOOKBACK_CANDLES, 350))),
  stakeDollars: Math.max(1, parseNumber(process.env.BOT_FIXED_STAKE_DOLLARS, 10)),
  scalpProfitTargetCents: Math.max(2, Math.min(30, parseNumber(process.env.BOT_SCALP_TARGET_CENTS, 12))),
  scalpStopLossCents: Math.max(1, Math.min(20, parseNumber(process.env.BOT_SCALP_STOP_CENTS, 6))),
  scalpBreakevenTriggerCents: Math.max(
    2,
    Math.min(20, parseNumber(process.env.BOT_SCALP_BREAKEVEN_TRIGGER_CENTS, 8)),
  ),
  scalpBreakevenLockCents: Math.max(
    0,
    Math.min(10, parseNumber(process.env.BOT_SCALP_BREAKEVEN_LOCK_CENTS, 1)),
  ),
  scalpTrailTriggerCents: Math.max(
    4,
    Math.min(30, parseNumber(process.env.BOT_SCALP_TRAIL_TRIGGER_CENTS, 10)),
  ),
  scalpTrailOffsetCents: Math.max(
    1,
    Math.min(20, parseNumber(process.env.BOT_SCALP_TRAIL_OFFSET_CENTS, 4)),
  ),
  openWindowStopLossCents: Math.max(1, Math.min(10, parseNumber(process.env.BOT_OPEN_WINDOW_STOP_CENTS, 1))),
  reversalProfitTargetCents: Math.max(4, Math.min(30, parseNumber(process.env.BOT_REVERSAL_TARGET_CENTS, 14))),
  reversalStopLossCents: Math.max(2, Math.min(20, parseNumber(process.env.BOT_REVERSAL_STOP_CENTS, 4))),
  reversalMaxEntryPriceCents: Math.max(
    20,
    Math.min(95, Math.round(parseNumber(process.env.BOT_REVERSAL_MAX_ENTRY_PRICE_CENTS, 78))),
  ),
  trendProfitTargetCents: Math.max(4, Math.min(40, parseNumber(process.env.BOT_TREND_TARGET_CENTS, 18))),
  trendStopLossCents: Math.max(2, Math.min(25, parseNumber(process.env.BOT_TREND_STOP_CENTS, 10))),
  trendMaxEntryPriceCents: Math.max(
    20,
    Math.min(95, Math.round(parseNumber(process.env.BOT_TREND_MAX_ENTRY_PRICE_CENTS, 84))),
  ),
  scalpMaxEntryPriceCents: Math.max(
    20,
    Math.min(95, Math.round(parseNumber(process.env.BOT_SCALP_MAX_ENTRY_PRICE_CENTS, 80))),
  ),
  trendStopArmSeconds: Math.max(
    5,
    Math.min(180, parseNumber(process.env.BOT_TREND_STOP_ARM_SECONDS, 45)),
  ),
  trendBreakevenTriggerCents: Math.max(
    2,
    Math.min(30, parseNumber(process.env.BOT_TREND_BREAKEVEN_TRIGGER_CENTS, 10)),
  ),
  trendBreakevenLockCents: Math.max(
    0,
    Math.min(10, parseNumber(process.env.BOT_TREND_BREAKEVEN_LOCK_CENTS, 1)),
  ),
  trendTrailTriggerCents: Math.max(
    4,
    Math.min(40, parseNumber(process.env.BOT_TREND_TRAIL_TRIGGER_CENTS, 14)),
  ),
  trendTrailOffsetCents: Math.max(
    2,
    Math.min(20, parseNumber(process.env.BOT_TREND_TRAIL_OFFSET_CENTS, 6)),
  ),
  scalpPollIntervalMs: Math.max(
    2_000,
    Math.min(30_000, parseNumber(process.env.BOT_SCALP_POLL_INTERVAL_MS, 5_000)),
  ),
  scalpForcedExitLeadSeconds: Math.max(
    30,
    Math.min(300, parseNumber(process.env.BOT_SCALP_FORCE_EXIT_LEAD_SECONDS, 90)),
  ),
  reversalForcedExitLeadSeconds: Math.max(
    30,
    Math.min(300, parseNumber(process.env.BOT_REVERSAL_FORCE_EXIT_LEAD_SECONDS, 75)),
  ),
  trendForcedExitLeadSeconds: Math.max(
    30,
    Math.min(300, parseNumber(process.env.BOT_TREND_FORCE_EXIT_LEAD_SECONDS, 60)),
  ),
  autoEntryEnabled: parseBoolean(process.env.BOT_AUTO_ENTRY_ENABLED, true),
  autoEntryPollIntervalMs: Math.max(
    5_000,
    Math.min(60_000, parseNumber(process.env.BOT_AUTO_ENTRY_POLL_INTERVAL_MS, 5_000)),
  ),
  confidenceThreshold: Math.max(50, Math.min(95, parseNumber(process.env.BOT_CONFIDENCE_THRESHOLD, 68))),
  reversalPrimaryDistanceFloor: Math.max(
    10,
    Math.min(100, parseNumber(process.env.BOT_REVERSAL_PRIMARY_DISTANCE_FLOOR, 25)),
  ),
  reversalPrimaryAtrMultiplier: Math.max(
    0.2,
    Math.min(2, parseNumber(process.env.BOT_REVERSAL_PRIMARY_ATR_MULTIPLIER, 0.7)),
  ),
  reversalLateDistanceFloor: Math.max(
    15,
    Math.min(120, parseNumber(process.env.BOT_REVERSAL_LATE_DISTANCE_FLOOR, 40)),
  ),
  reversalLateAtrMultiplier: Math.max(
    0.2,
    Math.min(2.5, parseNumber(process.env.BOT_REVERSAL_LATE_ATR_MULTIPLIER, 0.95)),
  ),
  entryRetryAttempts: Math.max(
    1,
    Math.min(4, Math.round(parseNumber(process.env.BOT_ENTRY_RETRY_ATTEMPTS, 3))),
  ),
  entryRetryStepCents: Math.max(
    1,
    Math.min(5, Math.round(parseNumber(process.env.BOT_ENTRY_REPRICE_CENTS, 1))),
  ),
  entryRetrySizeDecay: Math.max(
    0.4,
    Math.min(1, parseNumber(process.env.BOT_ENTRY_RETRY_SIZE_DECAY, 0.85)),
  ),
  entryMinUpsideBufferCents: Math.max(
    0,
    Math.min(20, Math.round(parseNumber(process.env.BOT_ENTRY_MIN_UPSIDE_BUFFER_CENTS, 4))),
  ),
  entryMinRewardRiskRatio: Math.max(
    1,
    Math.min(4, parseNumber(process.env.BOT_ENTRY_MIN_REWARD_RISK_RATIO, 1.5)),
  ),
  timeZone: process.env.BOT_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE,
  kalshiBaseUrl: process.env.KALSHI_API_BASE_URL?.trim() || "https://api.elections.kalshi.com/trade-api/v2",
  kalshiApiKeyId: process.env.KALSHI_API_KEY_ID?.trim() || "",
  kalshiPrivateKeyPem:
    process.env.KALSHI_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n").trim() || "",
  autoTradeEnabled: parseBoolean(process.env.KALSHI_ENABLE_AUTO_TRADE, true),
};

export function hasKalshiTradingCredentials() {
  return Boolean(tradingConfig.kalshiApiKeyId && tradingConfig.kalshiPrivateKeyPem);
}
