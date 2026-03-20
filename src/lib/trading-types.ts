export type TimingRiskLevel =
  | "high-risk-open"
  | "trade-window"
  | "late-window"
  | "blocked-close";

export type TradeCall = "above" | "below" | "no_trade";

export type SetupType = "trend" | "scalp" | "none";
export type ExitReason = "target" | "stop" | "time" | "manual-sync" | "expired" | "unknown";
export type ManagedTradeStatus = "open" | "exit-submitted" | "closed" | "error";

export type TradingDecision = {
  call: TradeCall;
  confidence: number;
  deterministicConfidence: number;
  summary: string;
  reasoning: string[];
  setupType: SetupType;
  candidateSide: "above" | "below" | null;
  timingRisk: TimingRiskLevel;
  shouldTrade: boolean;
  aiVetoed: boolean;
  derivedSide: "yes" | "no" | null;
  derivedOutcome: "above" | "below" | null;
  gateReasons: string[];
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
  managedTradeId: string | null;
  entryPriceDollars: number | null;
  targetPriceDollars: number | null;
  stopPriceDollars: number | null;
  message: string;
};

export type ManagedTrade = {
  id: string;
  createdAt: string;
  updatedAt: string;
  marketTicker: string;
  marketTitle: string | null;
  closeTime: string | null;
  setupType: "scalp";
  entrySide: "yes" | "no";
  entryOutcome: "above" | "below";
  contracts: number;
  entryOrderId: string | null;
  entryClientOrderId: string | null;
  entryPriceDollars: number;
  targetPriceDollars: number;
  stopPriceDollars: number;
  forcedExitAt: string;
  status: ManagedTradeStatus;
  exitReason: ExitReason | null;
  exitOrderId: string | null;
  exitClientOrderId: string | null;
  exitPriceDollars: number | null;
  realizedPnlDollars: number | null;
  lastSeenBidDollars: number | null;
  lastCheckedAt: string | null;
  lastExitAttemptAt: string | null;
  errorMessage: string | null;
};

export type BotLogEntry = {
  id: string;
  createdAt: string;
  source: "manual" | "auto";
  marketTicker: string | null;
  marketTitle: string | null;
  strikePrice: number | null;
  closeTime: string | null;
  minuteInWindow: number;
  timingRisk: TimingRiskLevel;
  currentPrice: number | null;
  confidence: number;
  deterministicConfidence: number;
  call: TradeCall;
  setupType: SetupType;
  candidateSide: "above" | "below" | null;
  summary: string;
  reasoning: string[];
  gateReasons: string[];
  aiVetoed: boolean;
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
  autoEntryEnabled: boolean;
  fundingHalted: boolean;
  fundingHaltReason: string | null;
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot | null;
  decision: TradingDecision | null;
  tradingEnabled: boolean;
  warnings: string[];
  activeManagedTrades: ManagedTrade[];
  log: BotLogEntry[];
};
