"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, BrainCircuit, CandlestickChart, Clock3, Database, RefreshCcw, ShieldAlert } from "lucide-react";
import type { Btc15mSignalSnapshot, SignalAction } from "@/lib/signal-types";

type LoadState = {
  data: Btc15mSignalSnapshot | null;
  loading: boolean;
  error: string | null;
};

function formatMoney(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function formatContracts(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseResponse(response: Response) {
  return response.json().then((payload) => {
    if (!response.ok) {
      const error =
        typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Request failed.";
      throw new Error(error);
    }

    return payload as Btc15mSignalSnapshot;
  });
}

function actionTone(action: SignalAction) {
  switch (action) {
    case "buy_yes":
      return {
        pill: "border-emerald-300/35 bg-emerald-400/15 text-emerald-50",
        accent: "text-emerald-200",
        glow: "from-emerald-400/18 via-emerald-300/8 to-transparent",
      };
    case "buy_no":
      return {
        pill: "border-rose-300/35 bg-rose-400/15 text-rose-50",
        accent: "text-rose-200",
        glow: "from-rose-400/18 via-rose-300/8 to-transparent",
      };
    default:
      return {
        pill: "border-amber-300/35 bg-amber-300/15 text-amber-50",
        accent: "text-amber-100",
        glow: "from-amber-300/18 via-amber-200/8 to-transparent",
      };
  }
}

function reversalTone(direction: "bullish" | "bearish" | "neutral") {
  switch (direction) {
    case "bullish":
      return {
        pill: "border-emerald-300/35 bg-emerald-400/15 text-emerald-50",
        accent: "text-emerald-200",
      };
    case "bearish":
      return {
        pill: "border-rose-300/35 bg-rose-400/15 text-rose-50",
        accent: "text-rose-200",
      };
    default:
      return {
        pill: "border-slate-300/25 bg-slate-300/10 text-slate-100",
        accent: "text-slate-100",
      };
  }
}

function executionTone(status: Btc15mSignalSnapshot["execution"] extends infer T
  ? T extends { status: infer S }
    ? S
    : never
  : never) {
  switch (status) {
    case "submitted":
    case "partial_fill":
    case "resolved":
      return "border-emerald-300/35 bg-emerald-400/15 text-emerald-50";
    case "error":
    case "unfilled":
      return "border-rose-300/35 bg-rose-400/15 text-rose-50";
    default:
      return "border-amber-300/35 bg-amber-300/15 text-amber-50";
  }
}

function formatAction(action: SignalAction | null | undefined) {
  if (!action) {
    return "n/a";
  }
  return action.replace("_", " ").toUpperCase();
}

function Stat({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      {helper ? <p className="mt-2 text-xs leading-5 text-slate-400">{helper}</p> : null}
    </div>
  );
}

export function TradingBotDashboard() {
  const [state, setState] = useState<LoadState>({
    data: null,
    loading: true,
    error: null,
  });
  const [controlPending, setControlPending] = useState<"start" | "stop" | null>(null);
  const requestInFlightRef = useRef(false);

  async function loadSnapshot() {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    try {
      const response = await fetch("/api/trading/bot", { cache: "no-store" });
      const data = await parseResponse(response);
      setState({
        data,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load the BTC signal station.",
      }));
    } finally {
      requestInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void loadSnapshot();

    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 5_000);

    return () => window.clearInterval(timer);
  }, []);

  async function handleExecutionControl(command: "start" | "stop") {
    setControlPending(command);
    try {
      const response = await fetch("/api/trading/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Unable to update execution control.",
        );
      }
      await loadSnapshot();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unable to update execution control.",
      }));
    } finally {
      setControlPending(null);
    }
  }

  const snapshot = state.data;
  const recommendation = snapshot?.recommendation;
  const testCase = snapshot?.testCase;
  const tone = actionTone(recommendation?.action ?? "no_buy");
  const testCaseTone = actionTone(testCase?.recommendation.action ?? "no_buy");
  const reversal = snapshot?.reversal;
  const reversalSkin = reversalTone(reversal?.direction ?? "neutral");
  const executionControl = snapshot?.executionControl;
  const execution = snapshot?.execution;
  const executionPill = executionTone(execution?.status ?? "waiting");
  const latestWarning = snapshot?.warnings?.[0] ?? null;
  const factorRows = useMemo(() => {
    if (!snapshot?.features) {
      return [];
    }

    return Object.entries(snapshot.features.factorScores)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, 6);
  }, [snapshot]);
  const reversalFactorRows = useMemo(() => {
    if (!reversal?.factorScores) {
      return [];
    }

    return Object.entries(reversal.factorScores)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, 4);
  }, [reversal]);
  const testCaseFactorRows = useMemo(() => {
    if (!testCase?.factorScores) {
      return [];
    }

    return Object.entries(testCase.factorScores)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, 6);
  }, [testCase]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#070c11] px-4 py-4 text-slate-100 sm:px-6 lg:px-8">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.glow}`} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_54%)]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col gap-4">
        <section className="overflow-hidden rounded-[34px] border border-white/10 bg-[rgba(5,10,16,0.92)] shadow-[0_40px_120px_rgba(0,0,0,0.42)]">
          <div className="grid gap-6 px-5 py-6 sm:px-7 sm:py-7 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6">
              <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-white/5 blur-3xl" />
              <p className="text-xs uppercase tracking-[0.34em] text-cyan-100/65">BTC 15M Signal Station</p>
              <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-white sm:text-5xl">
                Independent BTC window calls for Kalshi, priced before the market gets a vote.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                The recommendation comes from Coinbase-led probability modeling. Kalshi is only used
                to discover the live `KXBTC15M` contract, the strike to beat, and the current YES/NO
                prices.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-sm">
                <div className={`rounded-full border px-4 py-2 font-semibold ${tone.pill}`}>
                  {recommendation?.label ?? "No Buy"}
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-200">
                  {snapshot?.window.market?.ticker ?? "Waiting for KXBTC15M"}
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-200">
                  {snapshot?.window.progressLabel ?? "Minute 1"}
                </div>
                {snapshot?.stale ? (
                  <div className="rounded-full border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-amber-50">
                    Stale snapshot
                  </div>
                ) : null}
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <Stat
                  label="What To Buy"
                  value={
                    recommendation?.action === "buy_yes"
                      ? "YES"
                      : recommendation?.action === "buy_no"
                        ? "NO"
                        : "Stand Down"
                  }
                  helper="The deterministic model is authoritative."
                />
                <Stat
                  label="Suggested Size"
                  value={
                    recommendation?.suggestedContracts
                      ? `${formatContracts(recommendation.suggestedContracts)} contracts`
                      : "No size"
                  }
                  helper={recommendation?.suggestedStakeDollars ? formatMoney(recommendation.suggestedStakeDollars) : "No bankroll committed"}
                />
                <Stat
                  label="Why"
                  value={snapshot?.explanation.status === "live" ? "GPT assisted" : "Deterministic fallback"}
                  helper={snapshot?.explanation.model ?? "No model"}
                />
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[30px] border border-white/10 bg-[#0d141c] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">BTC Price To Beat</p>
                    <p className={`mt-3 text-4xl font-black tracking-[0.08em] ${tone.accent}`}>
                      {formatMoney(snapshot?.window.market?.strikePrice)}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      Settlement strike for the active 15-minute Kalshi window.
                    </p>
                  </div>
                  <CandlestickChart className="h-10 w-10 text-white/25" />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Stat
                    label="Selected Contract Ask"
                    value={formatMoney(recommendation?.buyPriceDollars)}
                    helper={
                      recommendation?.action === "buy_yes"
                        ? "Current YES ask for the bot's preferred side"
                        : recommendation?.action === "buy_no"
                          ? "Current NO ask for the bot's preferred side"
                          : "No active buy side right now"
                    }
                  />
                  <Stat
                    label="Model Fair Value"
                    value={formatMoney(recommendation?.fairValueDollars, 4)}
                    helper={`${formatPercent(recommendation?.modelProbability)} implied by the Coinbase-only engine`}
                  />
                  <Stat
                    label="Edge"
                    value={formatMoney(recommendation?.edgeDollars, 4)}
                    helper={recommendation?.edgePct !== null ? `${formatPercent(recommendation?.edgePct)} over ask` : "No edge"}
                  />
                  <Stat
                    label="NO Ask / Bid"
                    value={`${formatMoney(snapshot?.window.market?.noAskPrice)} / ${formatMoney(snapshot?.window.market?.noBidPrice)}`}
                  />
                  <Stat
                    label="YES Ask / Bid"
                    value={`${formatMoney(snapshot?.window.market?.yesAskPrice)} / ${formatMoney(snapshot?.window.market?.yesBidPrice)}`}
                  />
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-[#0d141c] p-6">
                <div className="flex items-center gap-3">
                  <Clock3 className="h-5 w-5 text-slate-400" />
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Window Control</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Stat label="Strike" value={formatMoney(snapshot?.window.market?.strikePrice)} />
                  <Stat label="BTC Spot" value={formatMoney(snapshot?.features?.currentPrice)} />
                  <Stat
                    label="Time Left"
                    value={snapshot ? `${snapshot.window.secondsToClose}s` : "n/a"}
                    helper={`Risk mode: ${snapshot?.window.riskLevel ?? "n/a"}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {state.error ? (
          <section className="rounded-[26px] border border-rose-300/25 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">
            {state.error}
          </section>
        ) : null}

        {latestWarning ? (
          <section className="rounded-[26px] border border-amber-300/25 bg-amber-300/10 px-5 py-4 text-sm text-amber-50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{latestWarning}</p>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
            <div className="flex items-center gap-3">
              <BrainCircuit className="h-5 w-5 text-slate-400" />
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Why The Engine Thinks This</p>
            </div>
            <p className="mt-4 text-lg leading-8 text-white">{snapshot?.explanation.summary ?? "Loading explanation..."}</p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Conviction</p>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                  {snapshot?.explanation.conviction?.length ? (
                    snapshot.explanation.conviction.map((reason) => <p key={reason}>{reason}</p>)
                  ) : (
                    <p>No conviction points yet.</p>
                  )}
                </div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Caution</p>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                  {snapshot?.explanation.caution?.length ? (
                    snapshot.explanation.caution.map((reason) => <p key={reason}>{reason}</p>)
                  ) : (
                    <p>No caution points yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Deterministic Reasons</p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                {recommendation?.reasons?.length ? (
                  recommendation.reasons.map((reason) => <p key={reason}>{reason}</p>)
                ) : (
                  <p>Loading the factor stack...</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
              <div className="flex items-center gap-3">
                <ArrowUpRight className="h-5 w-5 text-slate-400" />
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Independent Model Inputs</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Stat label="Trend Bias" value={snapshot?.features?.trendBias ?? "n/a"} />
                <Stat label="Confidence" value={formatNumber(snapshot?.recommendation?.confidence, 0)} />
                <Stat label="Momentum 5m" value={formatPercent(snapshot?.features?.momentum5, 3)} />
                <Stat label="Momentum 15m" value={formatPercent(snapshot?.features?.momentum15, 3)} />
                <Stat label="RSI 14" value={formatNumber(snapshot?.features?.rsi14)} />
                <Stat label="ATR 14" value={formatNumber(snapshot?.features?.atr14)} />
                <Stat label="Distance To Strike" value={formatMoney(snapshot?.features?.distanceToStrike)} />
                <Stat label="Distance / ATR" value={formatNumber(snapshot?.features?.distanceToStrikeAtr, 3)} />
                <Stat label="VWAP" value={formatMoney(snapshot?.features?.vwap120)} />
                <Stat label="Window Open" value={formatMoney(snapshot?.features?.windowOpenPrice)} />
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-slate-400" />
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Top Factor Scores</p>
              </div>
              <div className="mt-4 grid gap-3">
                {factorRows.length ? (
                  factorRows.map(([label, value]) => (
                    <div key={label} className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className="text-sm font-semibold text-slate-300">{formatNumber(value, 4)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-300">Factor scores will appear once the first live snapshot lands.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[30px] border border-dashed border-cyan-300/25 bg-[rgba(8,18,28,0.92)] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-100/65">Test Case</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Shadow bot only. No execution path. This version adds hourly regime, flip-risk, chop, and candle-structure checks.
                </p>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${testCaseTone.pill}`}>
                {testCase?.recommendation.label ?? "No Buy"}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Stat
                label="What It Buys"
                value={
                  testCase?.recommendation.action === "buy_yes"
                    ? "YES"
                    : testCase?.recommendation.action === "buy_no"
                      ? "NO"
                      : "Stand Down"
                }
                helper="This is logged and scored, but never auto-executed."
              />
              <Stat label="Hourly Regime" value={testCase?.hourlyRegime ?? "n/a"} helper={testCase?.hourlyTilt ?? "neutral"} />
              <Stat label="Alignment" value={testCase?.alignment ?? "n/a"} helper="Whether the 15m call agrees with the last hour." />
              <Stat label="Flip Risk" value={testCase?.flipRisk ?? "n/a"} helper={`Score ${formatNumber(testCase?.flipRiskScore, 2)}`} />
              <Stat label="Range Filter" value={testCase?.rangeFilter ?? "n/a"} helper="Range and chop suppression layer." />
              <Stat label="Structure Bias" value={testCase?.structureBias ?? "n/a"} helper={`Score ${formatNumber(testCase?.structureScore, 2)}`} />
              <Stat label="Buy Accuracy" value={formatPercent(snapshot?.testCaseMetrics.openingActionableAccuracyPct, 1)} helper={`${formatNumber(snapshot?.testCaseMetrics.openingActionableWindows, 0)} resolved first-decision buys`} />
              <Stat label="First Decision Accuracy" value={formatPercent(snapshot?.testCaseMetrics.openingSuggestionAccuracyPct, 1)} helper={`${formatNumber(snapshot?.testCaseMetrics.openingSuggestionWindows, 0)} first-decision calls scored`} />
              <Stat label="Paper PnL" value={formatMoney(snapshot?.testCaseMetrics.totalSuggestedPnlDollars)} helper={snapshot?.testCaseMetrics.avgSuggestedPnlDollars !== null ? `${formatMoney(snapshot?.testCaseMetrics.avgSuggestedPnlDollars)} average per first-decision buy` : "No resolved first-decision buys yet"} />
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Why The Test Case Thinks This</p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                {testCase?.reasons?.length ? (
                  testCase.reasons.map((reason) => <p key={reason}>{reason}</p>)
                ) : (
                  <p>No shadow-only reasons are available yet.</p>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Risk Flags</p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                {testCase?.riskFlags?.length ? (
                  testCase.riskFlags.map((flag) => <p key={flag}>{flag}</p>)
                ) : testCase?.recommendation.blockers?.length ? (
                  testCase.recommendation.blockers.map((flag) => <p key={flag}>{flag}</p>)
                ) : (
                  <p>No extra test-case cautions are active right now.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Test Case Pricing</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Stat label="Selected Ask" value={formatMoney(testCase?.recommendation.buyPriceDollars)} helper="Current ask for the shadow side." />
                <Stat label="Fair Value" value={formatMoney(testCase?.recommendation.fairValueDollars, 4)} helper={`${formatPercent(testCase?.recommendation.modelProbability)} probability after the shadow adjustments`} />
                <Stat label="Edge" value={formatMoney(testCase?.recommendation.edgeDollars, 4)} helper={testCase?.recommendation.edgePct !== null ? `${formatPercent(testCase?.recommendation.edgePct)} over ask` : "No edge"} />
                <Stat label="Confidence" value={formatNumber(testCase?.recommendation.confidence, 0)} helper="Independent from the live bot's execution path." />
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Top Test Case Factors</p>
              <div className="mt-4 grid gap-3">
                {testCaseFactorRows.length ? (
                  testCaseFactorRows.map(([label, value]) => (
                    <div key={label} className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className={`text-sm font-semibold ${testCaseTone.accent}`}>{formatNumber(value, 4)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-300">Test-case factors will appear once the first live shadow snapshot lands.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Signal Execution</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  executionControl?.mode === "running"
                    ? "border-emerald-300/35 bg-emerald-400/15 text-emerald-50"
                    : "border-rose-300/35 bg-rose-400/15 text-rose-50"
                }`}
              >
                {executionControl?.mode ?? "running"}
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${executionPill}`}>
                {execution?.status ?? "waiting"}
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                {formatAction(execution?.lockedAction)}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={controlPending !== null || executionControl?.mode === "running"}
                onClick={() => void handleExecutionControl("start")}
                className="rounded-full border border-emerald-300/30 bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {controlPending === "start" ? "Starting..." : "Go"}
              </button>
              <button
                type="button"
                disabled={controlPending !== null || executionControl?.mode === "stopped"}
                onClick={() => void handleExecutionControl("stop")}
                className="rounded-full border border-rose-300/30 bg-rose-400 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {controlPending === "stop" ? "Stopping..." : "Stop"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Stat
                label="Bot Mode"
                value={executionControl?.mode?.toUpperCase() ?? "RUNNING"}
                helper={executionControl?.updatedAt ? `Updated ${formatTimestamp(executionControl.updatedAt)}` : "Execution control is ready."}
              />
              <Stat
                label="Stop Reason"
                value={executionControl?.reason ? executionControl.reason.replace("_", " ").toUpperCase() : "NONE"}
                helper={executionControl?.updatedBy ?? "No operator recorded"}
              />
              <Stat
                label="Locked Side"
                value={execution?.lockedSide?.toUpperCase() ?? "WAITING"}
                helper="First actionable Buy YES/NO is the only tradable decision for the window."
              />
              <Stat
                label="Stake"
                value={formatMoney(execution?.maxCostDollars)}
                helper={`${formatNumber(execution?.filledContracts, 0)} filled of ${formatNumber(execution?.submittedContracts, 0)} submitted`}
              />
              <Stat
                label="Entry Price"
                value={formatMoney(execution?.entryPriceDollars, 4)}
                helper={execution?.submittedAt ? `Submitted ${formatTimestamp(execution.submittedAt)}` : "No order submitted yet"}
              />
              <Stat
                label="Settlement PnL"
                value={formatMoney(execution?.realizedPnlDollars)}
                helper={execution?.resolutionOutcome ? `Resolved ${execution.resolutionOutcome}` : "Holding to settlement if filled"}
              />
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution Control</p>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                {executionControl?.message ?? "Auto-execution is live."}
              </p>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution Message</p>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                {execution?.message ?? "Waiting for the first actionable Buy YES or Buy NO signal in this window."}
              </p>
            </div>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Recent Executions</p>
            <div className="mt-4 grid gap-3">
              {snapshot?.recentExecutions?.length ? (
                snapshot.recentExecutions.map((entry) => (
                  <div key={`${entry.windowTicker}-${entry.updatedAt}`} className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{entry.windowTicker}</p>
                      <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${executionTone(entry.status)}`}>
                        {entry.status}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                      <p>Action: <span className="font-semibold text-white">{formatAction(entry.lockedAction)}</span></p>
                      <p>Side: <span className="font-semibold uppercase text-white">{entry.lockedSide ?? "n/a"}</span></p>
                      <p>Filled: <span className="font-semibold text-white">{formatNumber(entry.filledContracts, 0)}</span></p>
                      <p>PnL: <span className="font-semibold text-white">{formatMoney(entry.realizedPnlDollars)}</span></p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-300">No signal-following executions have been recorded yet.</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
            <div className="flex items-center gap-3">
              <RefreshCcw className="h-5 w-5 text-slate-400" />
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Reversal Intelligence</p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Direction" value={reversal?.direction ?? "neutral"} />
              <Stat label="Watch Soon" value={reversal?.watchStatus ?? "none"} />
              <Stat label="Happening Now" value={reversal?.activeStatus ?? "none"} />
              <Stat
                label="Confidence"
                value={formatNumber(reversal?.confidence, 0)}
                helper="Informational only. Does not override the main trade call."
              />
              <Stat
                label="Trigger Level"
                value={formatMoney(reversal?.triggerLevel)}
                helper={reversal?.estimatedWindow ?? "No imminent trigger"}
              />
              <Stat
                label="Invalidation"
                value={
                  reversal?.direction === "bullish"
                    ? formatMoney(reversal?.invalidatesBelow)
                    : reversal?.direction === "bearish"
                      ? formatMoney(reversal?.invalidatesAbove)
                      : "n/a"
                }
              />
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current Read</p>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${reversalSkin.pill}`}>
                  {reversal?.direction ?? "neutral"}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                {reversal?.reasons?.length ? (
                  reversal.reasons.map((reason) => <p key={reason}>{reason}</p>)
                ) : (
                  <p>No reversal setup is dominating yet.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Reversal Risk Flags</p>
              <div className="mt-4 grid gap-3">
                {reversal?.riskFlags?.length ? (
                  reversal.riskFlags.map((flag) => (
                    <div key={flag} className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
                      {flag}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-300">No extra reversal cautions right now.</p>
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
              <div className="flex items-center gap-3">
                <ShieldAlert className={`h-5 w-5 ${reversalSkin.accent}`} />
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Top Reversal Factors</p>
              </div>
              <div className="mt-4 grid gap-3">
                {reversalFactorRows.length ? (
                  reversalFactorRows.map(([label, value]) => (
                    <div key={label} className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className={`text-sm font-semibold ${reversalSkin.accent}`}>{formatNumber(value, 4)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-300">Reversal factors will appear once a live setup develops.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-slate-400" />
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Supabase History</p>
            </div>
            <div className="mt-4 grid gap-3">
              {snapshot?.history?.length ? (
                snapshot.history.map((entry) => (
                  <div key={`${entry.windowTicker}-${entry.observedAt}`} className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{entry.windowTicker}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {formatTimestamp(entry.observedAt)}
                        </p>
                      </div>
                      <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${actionTone(entry.action).pill}`}>
                        {entry.action === "buy_yes" ? "BUY YES" : entry.action === "buy_no" ? "BUY NO" : "NO BUY"}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <p className="text-sm text-slate-300">Buy price: <span className="font-semibold text-white">{formatMoney(entry.buyPriceDollars)}</span></p>
                      <p className="text-sm text-slate-300">Fair value: <span className="font-semibold text-white">{formatMoney(entry.fairValueDollars, 4)}</span></p>
                      <p className="text-sm text-slate-300">Edge: <span className="font-semibold text-white">{formatMoney(entry.edgeDollars, 4)}</span></p>
                      <p className="text-sm text-slate-300">Observed spot: <span className="font-semibold text-white">{formatMoney(entry.currentPrice)}</span></p>
                      <p className="text-sm text-slate-300">Opening lean: <span className="font-semibold capitalize text-white">{entry.predictedDirection}</span></p>
                      <p className="text-sm text-slate-300">Final lean: <span className="font-semibold capitalize text-white">{entry.finalPredictedDirection}</span></p>
                      <p className="text-sm text-slate-300">Final action: <span className="font-semibold capitalize text-white">{entry.finalAction.replace("_", " ")}</span></p>
                      <p className="text-sm text-slate-300">Flipped after open: <span className="font-semibold text-white">{entry.flippedAfterOpen ? "Yes" : "No"}</span></p>
                      <p className="text-sm text-slate-300">Reversal watch: <span className="font-semibold capitalize text-white">{entry.reversalWatchStatus}</span></p>
                      <p className="text-sm text-slate-300">Reversal now: <span className="font-semibold capitalize text-white">{entry.reversalActiveStatus}</span></p>
                      <p className="text-sm text-slate-300">Reversal direction: <span className="font-semibold capitalize text-white">{entry.reversalDirection}</span></p>
                      <p className="text-sm text-slate-300">Reversal confidence: <span className="font-semibold text-white">{formatNumber(entry.reversalConfidence, 0)}</span></p>
                      <p className="text-sm text-slate-300">Outcome: <span className="font-semibold capitalize text-white">{entry.outcome ?? "pending"}</span></p>
                      <p className="text-sm text-slate-300">Result: <span className="font-semibold capitalize text-white">{entry.outcomeResult ?? "pending"}</span></p>
                      <p className="text-sm text-slate-300">Paper PnL: <span className="font-semibold text-white">{formatMoney(entry.suggestedPnlDollars)}</span></p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-300">Signal history will populate as fresh 15-minute windows are scored.</p>
              )}
            </div>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-[rgba(10,16,24,0.9)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Tracked Account Record</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Stat
                label="Current Win Rate"
                value={formatPercent(snapshot?.trackedMetrics.winRatePct, 2)}
                helper={`Since ${snapshot?.trackedMetrics.trackingStartLabel ?? "baseline"}`}
              />
              <Stat
                label="Tracked PnL"
                value={formatMoney(snapshot?.trackedMetrics.pnlDollars)}
                helper={`${formatNumber(snapshot?.trackedMetrics.wins, 0)} wins and ${formatNumber(snapshot?.trackedMetrics.losses, 0)} losses`}
              />
              <Stat
                label="Tracked Trades"
                value={formatNumber(snapshot?.trackedMetrics.trackedTrades, 0)}
                helper={`${formatNumber(snapshot?.trackedMetrics.resolvedTrades, 0)} resolved, ${formatNumber(snapshot?.trackedMetrics.openTrades, 0)} open`}
              />
              <Stat
                label="Source Mix"
                value={`${formatNumber(snapshot?.trackedMetrics.autoTrades, 0)} auto / ${formatNumber(snapshot?.trackedMetrics.manualTrades, 0)} manual`}
                helper={`${formatNumber(snapshot?.trackedMetrics.mixedTrades, 0)} mixed windows`}
              />
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Tracked Trade Feed</p>
              <div className="mt-3 grid gap-3">
                {snapshot?.trackedTrades?.length ? (
                  snapshot.trackedTrades.map((trade) => (
                    <div key={`${trade.marketTicker}-${trade.side}`} className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{trade.marketTicker}</p>
                        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${trade.result === "win" ? "border-emerald-300/35 bg-emerald-400/15 text-emerald-50" : trade.result === "loss" ? "border-rose-300/35 bg-rose-400/15 text-rose-50" : "border-amber-300/35 bg-amber-300/15 text-amber-50"}`}>
                          {trade.result}
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                        <p>Side: <span className="font-semibold uppercase text-white">{trade.side}</span></p>
                        <p>Source: <span className="font-semibold capitalize text-white">{trade.source}</span></p>
                        <p>Contracts: <span className="font-semibold text-white">{formatContracts(trade.totalContracts)}</span></p>
                        <p>Avg fill: <span className="font-semibold text-white">{formatMoney(trade.averagePriceDollars, 4)}</span></p>
                        <p>First fill: <span className="font-semibold text-white">{formatTimestamp(trade.firstFillAt)}</span></p>
                        <p>PnL: <span className="font-semibold text-white">{formatMoney(trade.realizedPnlDollars)}</span></p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-300">Tracked Kalshi fills will appear here once the baseline sync completes.</p>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Measured Performance</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Stat
                label="Resolved Windows"
                value={formatNumber(snapshot?.metrics.resolvedWindows, 0)}
                helper="Windows with a resolved first decision"
              />
              <Stat
                label="First Decision Accuracy"
                value={formatPercent(snapshot?.metrics.openingSuggestionAccuracyPct, 1)}
                helper={`${formatNumber(snapshot?.metrics.openingSuggestionWindows, 0)} first-decision calls scored`}
              />
              <Stat
                label="First Buy Accuracy"
                value={formatPercent(snapshot?.metrics.openingActionableAccuracyPct, 1)}
                helper={`${formatNumber(snapshot?.metrics.openingActionableWindows, 0)} first-decision buy windows`}
              />
              <Stat
                label="Final Snapshot Accuracy"
                value={formatPercent(snapshot?.metrics.finalSnapshotAccuracyPct, 1)}
                helper="Diagnostic only after any intrawindow flips"
              />
              <Stat
                label="Flip Rate"
                value={formatPercent(snapshot?.metrics.flipRatePct, 1)}
                helper={`${formatNumber(snapshot?.metrics.flipWindows, 0)} windows changed after the first buy decision`}
              />
              <Stat
                label="Model ABOVE"
                value={formatPercent(
                  snapshot?.features?.modelAboveProbability !== null &&
                    snapshot?.features?.modelAboveProbability !== undefined
                    ? snapshot.features.modelAboveProbability * 100
                    : null,
                )}
                helper="Coinbase-only settlement probability"
              />
              <Stat
                label="Model BELOW"
                value={formatPercent(
                  snapshot?.features?.modelBelowProbability !== null &&
                    snapshot?.features?.modelBelowProbability !== undefined
                    ? snapshot.features.modelBelowProbability * 100
                    : null,
                )}
                helper="Complement probability"
              />
              <Stat
                label="Paper PnL"
                value={formatMoney(snapshot?.metrics.totalSuggestedPnlDollars)}
                helper={snapshot?.metrics.avgSuggestedPnlDollars !== null ? `${formatMoney(snapshot?.metrics.avgSuggestedPnlDollars)} average per first-decision buy` : "No resolved first-decision buys yet"}
              />
              <Stat
                label="GPT Layer"
                value={snapshot?.explanation.status ?? "fallback"}
                helper={snapshot?.explanation.model ?? "No model"}
              />
              <Stat
                label="No-Buy Rate"
                value={formatPercent(snapshot?.metrics.noBuyRatePct, 1)}
                helper={`${formatNumber(snapshot?.metrics.noBuyWindows, 0)} resolved windows skipped`}
              />
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current Blockers</p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                {recommendation?.blockers?.length ? (
                  recommendation.blockers.map((reason) => <p key={reason}>{reason}</p>)
                ) : (
                  <p>No active blockers. The current signal is actionable.</p>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Calibration Buckets</p>
              <div className="mt-3 grid gap-3">
                {snapshot?.metrics.calibration.length ? (
                  snapshot.metrics.calibration.map((bucket) => (
                    <div key={bucket.label} className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{bucket.label}</p>
                        <p className="text-sm text-slate-300">
                          {formatPercent(bucket.accuracyPct, 1)} accuracy on {formatNumber(bucket.samples, 0)} samples
                        </p>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Avg predicted probability: {formatPercent(bucket.avgPredictedProbabilityPct, 1)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-300">Calibration will appear once enough resolved windows accumulate.</p>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Ops</p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                <p>Avg live edge on buys: {formatNumber(snapshot?.metrics.avgEdgeCents, 2)} cents.</p>
                <p>Last refresh: {formatTimestamp(snapshot?.generatedAt)}.</p>
                <p>{state.loading ? "Refreshing..." : "Polling every 5 seconds."}</p>
              </div>
            </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
