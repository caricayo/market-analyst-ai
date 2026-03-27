export type SignalAction = "buy_yes" | "buy_no" | "no_buy";
export type SignalRiskLevel = "fresh" | "developing" | "late" | "closing";
export type TrendBias = "bullish" | "bearish" | "neutral";
export type SignalDirection = "above" | "below";
export type SignalOutcome = "win" | "loss" | "skipped";
export type ReversalWatchStatus = "none" | "building" | "soon";
export type ReversalActiveStatus = "none" | "starting" | "active";
export type ReversalDirection = "bullish" | "bearish" | "neutral";
export type HourlyRegime = "uptrend" | "downtrend" | "range" | "stretched" | "chop";
export type HourlyRegimeTilt = "bullish" | "bearish" | "neutral";
export type TestCaseAlignment = "aligned" | "countertrend" | "neutral";
export type TestCaseFlipRisk = "low" | "medium" | "high";
export type TestCaseRangeFilter = "clean" | "range" | "chop";
export type TestCaseStructureBias = "supports_yes" | "supports_no" | "neutral";
export type SignalExecutionStatus =
  | "waiting"
  | "maker_resting"
  | "maker_partial"
  | "submitted"
  | "partial_fill"
  | "unfilled"
  | "skipped_no_signal"
  | "error"
  | "resolved";
export type SignalExecutionEntryMode = "maker_first" | "taker_fallback" | null;
export type SignalExecutionControlMode = "running" | "stopped";
export type SignalExecutionControlReason = "manual_stop" | "insufficient_funds" | null;
export type TrackedTradeSource = "manual" | "auto" | "mixed" | "unknown";
export type TrackedTradeResult = "win" | "loss" | "open";

export type KalshiBtcWindowSnapshot = {
  ticker: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  closeTime: string | null;
  expirationTime: string | null;
  strikePrice: number | null;
  yesAskPrice: number | null;
  noAskPrice: number | null;
  yesBidPrice: number | null;
  noBidPrice: number | null;
};

export type BtcWindowStatus = {
  id: string | null;
  openedAt: string | null;
  closeTime: string | null;
  progressLabel: string;
  secondsElapsed: number;
  secondsToClose: number;
  riskLevel: SignalRiskLevel;
  market: KalshiBtcWindowSnapshot | null;
};

export type BtcSignalFeatures = {
  currentPrice: number;
  windowOpenPrice: number;
  high15: number | null;
  low15: number | null;
  vwap120: number | null;
  ema9: number | null;
  ema21: number | null;
  ema55: number | null;
  rsi14: number | null;
  atr14: number | null;
  realizedVolatility15: number | null;
  momentum3: number | null;
  momentum5: number | null;
  momentum10: number | null;
  momentum15: number | null;
  rangeCompression15: number | null;
  candleBodyBias: number | null;
  distanceToStrike: number | null;
  distanceToStrikeBps: number | null;
  distanceToStrikeAtr: number | null;
  trendBias: TrendBias;
  modelAboveProbability: number;
  modelBelowProbability: number;
  modelConfidence: number;
  factorScores: Record<string, number>;
};

export type SignalRecommendation = {
  action: SignalAction;
  contractSide: "yes" | "no" | null;
  label: string;
  buyPriceDollars: number | null;
  fairValueDollars: number | null;
  edgeDollars: number | null;
  edgePct: number | null;
  modelProbability: number | null;
  confidence: number;
  suggestedStakeDollars: number;
  suggestedContracts: number;
  reasons: string[];
  blockers: string[];
};

export type ExplanationStatus = "live" | "fallback" | "disabled" | "error";

export type SignalExplanation = {
  status: ExplanationStatus;
  model: string | null;
  summary: string;
  conviction: string[];
  caution: string[];
};

export type BtcReversalSignal = {
  watchStatus: ReversalWatchStatus;
  activeStatus: ReversalActiveStatus;
  direction: ReversalDirection;
  confidence: number;
  score: number;
  reasons: string[];
  riskFlags: string[];
  triggerLevel: number | null;
  invalidatesBelow: number | null;
  invalidatesAbove: number | null;
  estimatedWindow: string | null;
  factorScores: Record<string, number>;
};

export type BtcTestCaseSignal = {
  hourlyRegime: HourlyRegime;
  hourlyTilt: HourlyRegimeTilt;
  alignment: TestCaseAlignment;
  flipRisk: TestCaseFlipRisk;
  flipRiskScore: number;
  rangeFilter: TestCaseRangeFilter;
  structureBias: TestCaseStructureBias;
  structureScore: number;
  modelAboveProbability: number;
  modelBelowProbability: number;
  modelConfidence: number;
  recommendation: SignalRecommendation;
  reasons: string[];
  riskFlags: string[];
  factorScores: Record<string, number>;
};

export type SignalHistoryEntry = {
  windowTicker: string;
  observedAt: string;
  action: SignalAction;
  contractSide: "yes" | "no" | null;
  finalAction: SignalAction;
  finalContractSide: "yes" | "no" | null;
  flippedAfterOpen: boolean;
  predictedDirection: SignalDirection;
  finalPredictedDirection: SignalDirection;
  buyPriceDollars: number | null;
  fairValueDollars: number | null;
  edgeDollars: number | null;
  modelProbability: number | null;
  currentPrice: number | null;
  reversalDirection: ReversalDirection;
  reversalWatchStatus: ReversalWatchStatus;
  reversalActiveStatus: ReversalActiveStatus;
  reversalConfidence: number | null;
  outcome: "above" | "below" | null;
  outcomeResult: SignalOutcome | null;
  suggestedPnlDollars: number | null;
  outcomeSource: "coinbase_proxy" | null;
};

export type SignalCalibrationBucket = {
  label: string;
  samples: number;
  hits: number;
  accuracyPct: number | null;
  avgPredictedProbabilityPct: number | null;
};

export type BtcSignalExecution = {
  windowId: string | null;
  windowTicker: string | null;
  status: SignalExecutionStatus;
  entryMode: SignalExecutionEntryMode;
  lockedAction: SignalAction | null;
  lockedSide: "yes" | "no" | null;
  decisionObservedAt: string | null;
  submittedAt: string | null;
  entryPriceDollars: number | null;
  submittedContracts: number;
  filledContracts: number;
  maxCostDollars: number | null;
  orderId: string | null;
  clientOrderId: string | null;
  restingOrderId: string | null;
  restingClientOrderId: string | null;
  restingPriceDollars: number | null;
  makerPlacedAt: string | null;
  makerCanceledAt: string | null;
  makerFilledContracts: number;
  fallbackStartedAt: string | null;
  message: string;
  resolutionOutcome: "above" | "below" | null;
  realizedPnlDollars: number | null;
  updatedAt: string | null;
};

export type BtcSignalExecutionControl = {
  mode: SignalExecutionControlMode;
  reason: SignalExecutionControlReason;
  message: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type SignalPerformanceMetrics = {
  resolvedWindows: number;
  openingSuggestionWindows: number;
  openingSuggestionAccuracyPct: number | null;
  openingActionableWindows: number;
  openingActionableAccuracyPct: number | null;
  finalSnapshotAccuracyPct: number | null;
  flipWindows: number;
  flipRatePct: number | null;
  noBuyWindows: number;
  noBuyRatePct: number | null;
  avgEdgeCents: number | null;
  totalSuggestedPnlDollars: number;
  avgSuggestedPnlDollars: number | null;
  calibration: SignalCalibrationBucket[];
};

export type BtcTrackedTrade = {
  marketTicker: string;
  side: "yes" | "no";
  source: TrackedTradeSource;
  firstFillAt: string | null;
  lastFillAt: string | null;
  totalContracts: number;
  averagePriceDollars: number | null;
  fillsCount: number;
  resolutionOutcome: "above" | "below" | null;
  result: TrackedTradeResult;
  realizedPnlDollars: number | null;
};

export type TrackedWinRateMetrics = {
  trackingStartIso: string;
  trackingStartLabel: string;
  trackedTrades: number;
  resolvedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  pnlDollars: number;
  autoTrades: number;
  manualTrades: number;
  mixedTrades: number;
};

export type Btc15mSignalSnapshot = {
  generatedAt: string;
  stale: boolean;
  window: BtcWindowStatus;
  features: BtcSignalFeatures | null;
  reversal: BtcReversalSignal | null;
  recommendation: SignalRecommendation | null;
  testCase: BtcTestCaseSignal | null;
  executionControl: BtcSignalExecutionControl;
  execution: BtcSignalExecution | null;
  recentExecutions: BtcSignalExecution[];
  explanation: SignalExplanation;
  metrics: SignalPerformanceMetrics;
  testCaseMetrics: SignalPerformanceMetrics;
  trackedMetrics: TrackedWinRateMetrics;
  trackedTrades: BtcTrackedTrade[];
  history: SignalHistoryEntry[];
  warnings: string[];
};

export type PersistedSignalWindow = {
  id: string;
  marketTicker: string;
  marketTitle: string | null;
  openTime: string;
  closeTime: string | null;
  expirationTime: string | null;
  strikePriceDollars: number | null;
  status: "active" | "resolved";
  resolutionOutcome: "above" | "below" | null;
  settlementProxyPriceDollars: number | null;
  outcomeSource: "coinbase_proxy" | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistedSignalSnapshot = {
  id: string;
  windowId: string;
  marketTicker: string;
  observedAt: string;
  secondsElapsed: number;
  secondsToClose: number;
  currentPriceDollars: number | null;
  modelAboveProbability: number | null;
  modelBelowProbability: number | null;
  action: SignalAction;
  contractSide: "yes" | "no" | null;
  buyPriceDollars: number | null;
  fairValueDollars: number | null;
  edgeDollars: number | null;
  confidence: number;
  suggestedStakeDollars: number;
  suggestedContracts: number;
  features: Record<string, unknown>;
  reasons: string[];
  blockers: string[];
  explanationStatus: ExplanationStatus;
  explanationSummary: string | null;
  resolutionOutcome: "above" | "below" | null;
  outcomeSource: "coinbase_proxy" | null;
};

export type PersistedSignalExecution = {
  id: string;
  windowId: string;
  windowTicker: string;
  status: SignalExecutionStatus;
  entryMode: SignalExecutionEntryMode;
  lockedAction: SignalAction | null;
  lockedSide: "yes" | "no" | null;
  decisionSnapshotId: string | null;
  decisionObservedAt: string | null;
  submittedAt: string | null;
  entryPriceDollars: number | null;
  submittedContracts: number;
  filledContracts: number;
  maxCostDollars: number | null;
  orderId: string | null;
  clientOrderId: string | null;
  restingOrderId: string | null;
  restingClientOrderId: string | null;
  restingPriceDollars: number | null;
  makerPlacedAt: string | null;
  makerCanceledAt: string | null;
  makerFilledContracts: number;
  fallbackStartedAt: string | null;
  message: string;
  resolutionOutcome: "above" | "below" | null;
  realizedPnlDollars: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistedSignalExecutionControl = {
  scope: string;
  mode: SignalExecutionControlMode;
  reason: SignalExecutionControlReason;
  message: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistedTrackedTrade = {
  id: string;
  marketTicker: string;
  side: "yes" | "no";
  source: TrackedTradeSource;
  firstFillAt: string | null;
  lastFillAt: string | null;
  totalContracts: number;
  averagePriceDollars: number | null;
  fillsCount: number;
  resolutionOutcome: "above" | "below" | null;
  result: TrackedTradeResult;
  realizedPnlDollars: number | null;
  createdAt: string;
  updatedAt: string;
};
