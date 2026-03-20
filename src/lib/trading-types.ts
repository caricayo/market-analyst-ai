export type TimingRiskLevel = "high-risk-open" | "trade-window" | "late-window";

export type TradeCall = "above" | "below" | "no_trade";

export type TradingDecision = {
  call: TradeCall;
  confidence: number;
  summary: string;
  reasoning: string[];
  timingRisk: TimingRiskLevel;
  shouldTrade: boolean;
  derivedSide: "yes" | "no" | null;
  derivedOutcome: "above" | "below" | null;
  blockers: string[];
};

export type IndicatorSnapshot = {
  currentPrice: number;
  strikePrice: number | null;
  distanceToStrike: number | null;
  distanceToStrikeBps: number | null;
  ema9: number | null;
  ema21: number | null;
  ema55: number | null;
  rsi14: number | null;
  atr14: number | null;
  vwap: number | null;
  momentum5: number | null;
  momentum15: number | null;
  momentum30: number | null;
  range15: number | null;
  range60: number | null;
  trendBias: "bullish" | "bearish" | "neutral";
  deterministicEdge: number;
};

export type MarketOutcomeMapping = {
  aboveSide: "yes" | "no";
  belowSide: "yes" | "no";
};

export type KalshiMarketSnapshot = {
  ticker: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  closeTime: string | null;
  expirationTime: string | null;
  yesAskPrice: number | null;
  noAskPrice: number | null;
  yesBidPrice: number | null;
  noBidPrice: number | null;
  strikePrice: number | null;
  mapping: MarketOutcomeMapping;
};

export type TradeExecution = {
  status: "submitted" | "skipped" | "disabled" | "error";
  side: "yes" | "no" | null;
  outcome: "above" | "below" | null;
  contracts: number | null;
  maxCostDollars: number | null;
  orderId: string | null;
  clientOrderId: string | null;
  message: string;
};

export type BotLogEntry = {
  id: string;
  createdAt: string;
  marketTicker: string | null;
  marketTitle: string | null;
  strikePrice: number | null;
  closeTime: string | null;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  currentPrice: number | null;
  confidence: number;
  call: TradeCall;
  summary: string;
  reasoning: string[];
  blockers: string[];
  execution: TradeExecution;
};

export type BotStatusSnapshot = {
  generatedAt: string;
  timeZone: string;
  currentWindowLabel: string;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  stakeDollars: number;
  confidenceThreshold: number;
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot | null;
  decision: TradingDecision | null;
  tradingEnabled: boolean;
  warnings: string[];
  log: BotLogEntry[];
};
