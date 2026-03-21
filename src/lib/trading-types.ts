export type TimingRiskLevel =
  | "high-risk-open"
  | "trade-window"
  | "late-window"
  | "blocked-close";

export type TradeCall = "above" | "below" | "no_trade";

export type SetupType = "trend" | "scalp" | "reversal" | "none";
export type ExitReason = "target" | "stop" | "time" | "manual-sync" | "expired" | "unknown";
export type ManagedTradeStatus = "open" | "exit-submitted" | "closed" | "error";
export type ConfidenceBand = "low" | "mid" | "high";
export type TapePattern = "continuation" | "possible_reversal" | "chop";

export type TradingDecision = {
  call: TradeCall;
  confidence: number;
  deterministicConfidence: number;
  summary: string;
  reasoning: string[];
  tapePattern: TapePattern;
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
  plannedContracts: number | null;
  maxCostDollars: number | null;
  plannedMaxCostDollars: number | null;
  orderId: string | null;
  clientOrderId: string | null;
  managedTradeId: string | null;
  entryPriceDollars: number | null;
  targetPriceDollars: number | null;
  stopPriceDollars: number | null;
  entryTierDollars?: number | null;
  targetTierDollars?: number | null;
  stopTierDollars?: number | null;
  confidenceBand?: ConfidenceBand | null;
  liquidityAvailableContracts: number | null;
  liquidityDepthLevels: number | null;
  attempts: {
    attemptNumber: number;
    limitPriceDollars: number;
    plannedContracts: number;
    submittedContracts: number | null;
    maxCostDollars: number | null;
    liquidityAvailableContracts: number | null;
    status: "planned" | "liquidity-skip" | "submitted" | "zero-fill" | "error";
    message: string;
  }[];
  message: string;
};

export type ManagedTrade = {
  id: string;
  createdAt: string;
  updatedAt: string;
  marketTicker: string;
  marketTitle: string | null;
  closeTime: string | null;
  setupType: Exclude<SetupType, "none">;
  entrySide: "yes" | "no";
  entryOutcome: "above" | "below";
  contracts: number;
  entryOrderId: string | null;
  entryClientOrderId: string | null;
  entryPriceDollars: number;
  targetPriceDollars: number;
  stopPriceDollars: number;
  entryTierDollars: number | null;
  targetTierDollars: number | null;
  stopTierDollars: number | null;
  confidenceBand: ConfidenceBand | null;
  forcedExitAt: string;
  status: ManagedTradeStatus;
  exitReason: ExitReason | null;
  exitOrderId: string | null;
  exitClientOrderId: string | null;
  exitPriceDollars: number | null;
  realizedPnlDollars: number | null;
  lastSeenBidDollars: number | null;
  peakPriceDollars: number | null;
  lastCheckedAt: string | null;
  lastExitAttemptAt: string | null;
  stopArmedAt: string | null;
  errorMessage: string | null;
};

export type LivePositionSnapshot = {
  ticker: string;
  contracts: number;
  realizedPnlDollars: number | null;
  trackedContracts: number;
  trackedByManagedTrade: boolean;
};

export type TradeReview = {
  id: string;
  marketTicker: string;
  marketTitle: string | null;
  setupType: Exclude<SetupType, "none">;
  entryOutcome: "above" | "below";
  createdAt: string;
  closedAt: string;
  contracts: number;
  entryPriceDollars: number;
  exitPriceDollars: number | null;
  targetPriceDollars: number;
  stopPriceDollars: number;
  peakPriceDollars: number | null;
  realizedPnlDollars: number | null;
  exitReason: ExitReason | null;
  result: "win" | "loss" | "flat";
  summary: string;
  happened: string[];
  takeaways: string[];
};

export type PolicyEvaluationStatus = "pending" | "resolved" | "skipped";

export type ResearchPolicyResult = {
  policySlug: string;
  policyName: string;
  isChampion: boolean;
  setupType: SetupType;
  call: TradeCall;
  candidateSide: "above" | "below" | null;
  shouldTrade: boolean;
  confidence: number;
  entrySide: "yes" | "no" | null;
  entryPriceDollars: number | null;
  contracts: number | null;
  maxCostDollars: number | null;
  gateReasons: string[];
  blockers: string[];
  status: PolicyEvaluationStatus;
  resolutionOutcome: "above" | "below" | null;
  settlementPriceDollars: number | null;
  paperPnlDollars: number | null;
  replayMode: "resolution" | "candle_replay";
  exitReason: ExitReason | null;
  exitPriceDollars: number | null;
  exitAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type ResearchWindowSnapshot = {
  id: string;
  marketTicker: string;
  closeTime: string | null;
  observedAt: string;
  minuteInWindow: number;
  strikePrice: number | null;
  currentPrice: number | null;
  resolutionOutcome: "above" | "below" | null;
  settlementPriceDollars: number | null;
  status: "pending" | "resolved";
  championPolicySlug: string;
  policyResults: ResearchPolicyResult[];
};

export type PolicyLeaderboardEntry = {
  policySlug: string;
  policyName: string;
  isChampion: boolean;
  windows: number;
  trades: number;
  wins: number;
  losses: number;
  hitRate: number;
  totalPaperPnlDollars: number;
  avgPaperPnlDollars: number;
};

export type StrategyStateSnapshot = {
  activePolicySlug: string;
  activePolicyName: string;
  changedAt: string;
  source: "default" | "auto-promotion" | "manual";
  notes: string | null;
};

export type TunerChangeRecord = {
  id: string;
  fromPolicySlug: string | null;
  fromPolicyName: string | null;
  toPolicySlug: string;
  toPolicyName: string;
  source: "auto-promotion" | "manual";
  reason: string | null;
  promotedAt: string;
};

export type ResearchSnapshot = {
  pendingWindows: number;
  resolvedWindows: number;
  activeTuner: StrategyStateSnapshot;
  recentChanges: TunerChangeRecord[];
  latestWindow: ResearchWindowSnapshot | null;
  leaderboard: PolicyLeaderboardEntry[];
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
  availableBalanceDollars: number | null;
  portfolioValueDollars: number | null;
  yesAskPrice: number | null;
  noAskPrice: number | null;
  yesBidPrice: number | null;
  noBidPrice: number | null;
  distanceToStrike: number | null;
  atr14: number | null;
  rsi14: number | null;
  momentum5: number | null;
  momentum15: number | null;
  deterministicEdge: number | null;
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
  availableBalanceDollars: number | null;
  portfolioValueDollars: number | null;
  confidenceThreshold: number;
  autoEntryEnabled: boolean;
  fundingHalted: boolean;
  fundingHaltReason: string | null;
  market: KalshiMarketSnapshot | null;
  indicators: IndicatorSnapshot | null;
  decision: TradingDecision | null;
  predictiveDecision: TradingDecision | null;
  tradingEnabled: boolean;
  warnings: string[];
  livePositions: LivePositionSnapshot[];
  activeManagedTrades: ManagedTrade[];
  recentTradeReviews: TradeReview[];
  log: BotLogEntry[];
  research: ResearchSnapshot | null;
};
