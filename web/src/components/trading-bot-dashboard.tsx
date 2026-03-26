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

  const snapshot = state.data;
  const recommendation = snapshot?.recommendation;
  const tone = actionTone(recommendation?.action ?? "no_buy");
  const reversal = snapshot?.reversal;
  const reversalSkin = reversalTone(reversal?.direction ?? "neutral");
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
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Measured Performance</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Stat
                label="Resolved Windows"
                value={formatNumber(snapshot?.metrics.resolvedWindows, 0)}
                helper="Windows with a resolved opening snapshot"
              />
              <Stat
                label="Opening Accuracy"
                value={formatPercent(snapshot?.metrics.openingSuggestionAccuracyPct, 1)}
                helper={`${formatNumber(snapshot?.metrics.openingSuggestionWindows, 0)} first-window calls scored`}
              />
              <Stat
                label="Opening Buy Accuracy"
                value={formatPercent(snapshot?.metrics.openingActionableAccuracyPct, 1)}
                helper={`${formatNumber(snapshot?.metrics.openingActionableWindows, 0)} first-buy windows`}
              />
              <Stat
                label="Final Snapshot Accuracy"
                value={formatPercent(snapshot?.metrics.finalSnapshotAccuracyPct, 1)}
                helper="Diagnostic only after any intrawindow flips"
              />
              <Stat
                label="Flip Rate"
                value={formatPercent(snapshot?.metrics.flipRatePct, 1)}
                helper={`${formatNumber(snapshot?.metrics.flipWindows, 0)} windows changed action after open`}
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
                helper={snapshot?.metrics.avgSuggestedPnlDollars !== null ? `${formatMoney(snapshot?.metrics.avgSuggestedPnlDollars)} average per opening buy` : "No resolved opening buys yet"}
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
        </section>
      </div>
    </main>
  );
}
