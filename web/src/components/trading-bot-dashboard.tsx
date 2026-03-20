"use client";

import { useEffect, useState } from "react";
import type { BotStatusSnapshot, SetupType } from "@/lib/trading-types";

type LoadState = {
  data: BotStatusSnapshot | null;
  loading: boolean;
  running: boolean;
  error: string | null;
};

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatTimestamp(value: string | null | undefined, timeZone: string) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function riskTone(risk: BotStatusSnapshot["timingRisk"]) {
  switch (risk) {
    case "high-risk-open":
      return "border-[#ff9f6e]/40 bg-[#ff9f6e]/12 text-[#ffd8bf]";
    case "blocked-close":
      return "border-[#ff7b7b]/35 bg-[#ff7b7b]/12 text-[#ffd6d6]";
    case "late-window":
      return "border-[#f5d76e]/35 bg-[#f5d76e]/12 text-[#fff0bf]";
    default:
      return "border-[#73d9a5]/30 bg-[#73d9a5]/12 text-[#d4ffe5]";
  }
}

function setupTone(setupType: SetupType | undefined) {
  switch (setupType) {
    case "reversal":
      return "border-amber-300/30 bg-amber-300/12 text-amber-50";
    case "scalp":
      return "border-sky-400/30 bg-sky-400/12 text-sky-100";
    case "trend":
      return "border-violet-400/30 bg-violet-400/12 text-violet-100";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

async function parseResponse(response: Response) {
  const payload = (await response.json()) as BotStatusSnapshot | { error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Request failed.");
  }
  return payload as BotStatusSnapshot;
}

export function TradingBotDashboard() {
  const [state, setState] = useState<LoadState>({
    data: null,
    loading: true,
    running: false,
    error: null,
  });

  async function loadSnapshot() {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/trading/bot", { cache: "no-store" });
      const data = await parseResponse(response);
      setState((current) => ({
        ...current,
        data,
        loading: false,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load the trading bot.",
      }));
    }
  }

  useEffect(() => {
    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  async function runBot() {
    setState((current) => ({ ...current, running: true, error: null }));
    try {
      const response = await fetch("/api/trading/bot", {
        method: "POST",
        cache: "no-store",
      });
      const data = await parseResponse(response);
      setState({
        data,
        loading: false,
        running: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : "Unable to execute the trading bot.",
      }));
    }
  }

  const snapshot = state.data;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(36,197,94,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_22%),linear-gradient(135deg,#081019_0%,#0f1723_50%,#101827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[32px] border border-white/10 bg-[rgba(7,12,20,0.76)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-200/70">BTC 15-Minute Bot</p>
              <h1 className="mt-3 max-w-3xl font-display text-4xl text-white sm:text-5xl">
                Kalshi execution with Coinbase tape and deterministic trade calls.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                The bot watches the active Bitcoin 15-minute above/below contract, prioritizes
                trend continuation in the core trade window, and uses stricter reversal or scalp
                entries only when the tape still supports them.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void loadSnapshot()}
                disabled={state.loading || state.running}
                className="rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state.loading ? "Refreshing..." : "Refresh snapshot"}
              </button>
              <button
                type="button"
                onClick={() => void runBot()}
                disabled={state.loading || state.running}
                className="rounded-full border border-emerald-400/25 bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state.running ? "Running and trading..." : "Run once now"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-5">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Window</p>
              <p className="mt-2 text-2xl font-semibold text-white">{snapshot?.currentWindowLabel ?? "Loading..."}</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Minute In Window</p>
              <p className="mt-2 text-2xl font-semibold text-white">{snapshot?.minuteInWindow ?? "--"}</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Timing Risk</p>
              <div
                className={`mt-3 inline-flex rounded-full border px-3 py-2 text-sm font-medium ${snapshot ? riskTone(snapshot.timingRisk) : "border-white/10 bg-white/5 text-slate-200"}`}
              >
                {snapshot?.timingRisk ?? "loading"}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Trading Status</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {snapshot?.tradingEnabled ? "Enabled" : "Analysis only"}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Fixed stake {formatMoney(snapshot?.stakeDollars)} per eligible order.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Available Balance</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {formatMoney(snapshot?.availableBalanceDollars)}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Portfolio {formatMoney(snapshot?.portfolioValueDollars)}
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 lg:col-span-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Automation</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {snapshot?.autoEntryEnabled ? "Auto-entry polling active" : "Auto-entry disabled"}
                  </p>
                </div>
                <div className="text-sm text-slate-300">
                  {snapshot?.fundingHalted ? (
                    <span className="rounded-full border border-rose-400/30 bg-rose-400/12 px-3 py-2 text-rose-100">
                      Funding halt: {snapshot.fundingHaltReason ?? "Kalshi reported insufficient funds."}
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-emerald-50">
                      New windows are scanned automatically without pressing the button.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {state.error ? (
          <div className="mt-5 rounded-[24px] border border-rose-400/30 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">
            {state.error}
          </div>
        ) : null}

        {snapshot?.warnings.length ? (
          <div className="mt-5 rounded-[24px] border border-amber-300/25 bg-amber-300/10 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.25em] text-amber-100/70">Warnings</p>
            <div className="mt-3 grid gap-2 text-sm text-amber-50">
              {snapshot.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        ) : null}

        <section className="mt-5 rounded-[28px] border border-white/10 bg-[rgba(9,15,24,0.78)] p-5 backdrop-blur xl:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Managed Trades</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Automated exit watcher</h2>
            </div>
            <p className="text-sm text-slate-400">
              Server-side poller checks open bot positions every few seconds for target, stop, and time exits.
            </p>
          </div>

          <div className="mt-5 grid gap-3">
            {snapshot?.livePositions.length ? (
              snapshot.livePositions.map((position) => (
                <div key={position.ticker} className="rounded-[22px] border border-white/10 bg-[#0c1420] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold text-white">{position.ticker}</p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          Live {formatNumber(position.contracts)} contracts
                        </span>
                        <span
                          className={`rounded-full border px-3 py-1 text-xs ${position.trackedByManagedTrade ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-50" : "border-amber-300/30 bg-amber-300/12 text-amber-50"}`}
                        >
                          {position.trackedByManagedTrade ? "tracked" : "recovery needed"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-400">
                        Tracker coverage {formatNumber(position.trackedContracts)} / {formatNumber(position.contracts)} |
                        realized PnL {formatMoney(position.realizedPnlDollars)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
                No live Kalshi positions are currently open.
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-3">
            {snapshot?.activeManagedTrades.length ? (
              snapshot.activeManagedTrades.map((trade) => (
                <div key={trade.id} className="rounded-[22px] border border-white/10 bg-[#0c1420] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold text-white">{trade.marketTicker}</p>
                        <span className={`rounded-full border px-3 py-1 text-xs ${setupTone(trade.setupType)}`}>
                          {trade.setupType}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {trade.entrySide.toUpperCase()} {trade.contracts} contracts
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        Entry {formatMoney(trade.entryPriceDollars)} | target {formatMoney(trade.targetPriceDollars)} |
                        stop {formatMoney(trade.stopPriceDollars)}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Last bid {formatMoney(trade.lastSeenBidDollars)} | peak {formatMoney(trade.peakPriceDollars)} |
                        forced exit {formatTimestamp(trade.forcedExitAt, snapshot.timeZone)}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Stop {trade.stopArmedAt ? "armed" : "waiting"} | armed at{" "}
                        {formatTimestamp(trade.stopArmedAt, snapshot.timeZone)}
                      </p>
                      {trade.errorMessage ? (
                        <p className="mt-2 text-sm text-amber-100">{trade.errorMessage}</p>
                      ) : null}
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      Status: {trade.status}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
                No active managed exit trackers.
              </div>
            )}
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[28px] border border-white/10 bg-[rgba(9,15,24,0.78)] p-5 backdrop-blur xl:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Active Contract</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {snapshot?.market?.ticker ?? "No BTC 15-minute market found"}
                </h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
                Close {formatTimestamp(snapshot?.market?.closeTime, snapshot?.timeZone ?? "UTC")}
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-300">
              {snapshot?.market?.title ?? "Waiting for Kalshi market discovery."}
            </p>
            {snapshot?.market?.subtitle ? (
              <p className="mt-2 text-sm text-slate-400">{snapshot.market.subtitle}</p>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Strike</p>
                <p className="mt-2 text-xl font-semibold text-white">{formatMoney(snapshot?.market?.strikePrice)}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">YES Ask</p>
                <p className="mt-2 text-xl font-semibold text-white">{formatMoney(snapshot?.market?.yesAskPrice)}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">NO Ask</p>
                <p className="mt-2 text-xl font-semibold text-white">{formatMoney(snapshot?.market?.noAskPrice)}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">BTC Spot</p>
                <p className="mt-2 text-xl font-semibold text-white">{formatMoney(snapshot?.indicators?.currentPrice)}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Distance To Strike", formatNumber(snapshot?.indicators?.distanceToStrike)],
                ["Distance Bps", formatNumber(snapshot?.indicators?.distanceToStrikeBps)],
                ["RSI 14", formatNumber(snapshot?.indicators?.rsi14)],
                ["ATR 14", formatNumber(snapshot?.indicators?.atr14)],
                ["VWAP", formatNumber(snapshot?.indicators?.vwap)],
                ["Trend Bias", snapshot?.indicators?.trendBias ?? "n/a"],
                ["Momentum 5m", formatNumber(snapshot?.indicators?.momentum5)],
                ["Momentum 15m", formatNumber(snapshot?.indicators?.momentum15)],
                ["Momentum 30m", formatNumber(snapshot?.indicators?.momentum30)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[20px] border border-white/10 bg-[#0c1420] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
                  <p className="mt-2 text-lg font-medium text-white">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[rgba(9,15,24,0.78)] p-5 backdrop-blur xl:p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Decision</p>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-3xl font-semibold text-white">
                  {snapshot?.decision?.call?.toUpperCase() ?? "WAITING"}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] ${setupTone(snapshot?.decision?.setupType)}`}
                  >
                    {snapshot?.decision?.setupType ?? "none"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {snapshot?.decision?.summary ?? "No signal yet."}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Confidence</p>
                <p className="mt-2 text-2xl font-semibold text-white">{snapshot?.decision?.confidence ?? "--"}</p>
                <p className="mt-2 text-xs text-slate-400">
                  Deterministic {snapshot?.decision?.deterministicConfidence ?? "--"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution Mapping</p>
              <p className="mt-2 text-sm text-slate-300">
                Candidate {snapshot?.decision?.candidateSide ?? "n/a"} maps to Kalshi side{" "}
                <span className="font-semibold text-white">{snapshot?.decision?.derivedSide ?? "n/a"}</span>.
              </p>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Reasoning</p>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                {snapshot?.decision?.reasoning?.length ? (
                  snapshot.decision.reasoning.map((reason) => <p key={reason}>{reason}</p>)
                ) : (
                  <p>Signal reasoning will appear after the first analysis.</p>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Gate Reasons</p>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                {snapshot?.decision?.gateReasons?.length ? (
                  snapshot.decision.gateReasons.map((reason) => <p key={reason}>{reason}</p>)
                ) : (
                  <p>No qualifying gate passed yet.</p>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Blockers</p>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                {snapshot?.decision?.blockers?.length ? (
                  snapshot.decision.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)
                ) : (
                  <p>No current blockers.</p>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-emerald-50/70">Timing Rule</p>
              <p className="mt-2 text-sm leading-6 text-emerald-50">
                Minutes 1-3 are blocked. Trend is primary in minutes 4-8, reversal is a stricter
                secondary playbook in minutes 4-12, scalp remains a continuation fallback in
                minutes 4-12, and minutes 13-15 are blocked for new entries.
              </p>
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-[28px] border border-white/10 bg-[rgba(9,15,24,0.78)] p-5 backdrop-blur xl:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Research Lab</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Shadow policy leaderboard</h2>
            </div>
            <p className="text-sm text-slate-400">
              One observation is recorded per market window. Challengers are replayed against the candle path and promotion history is tracked.
            </p>
          </div>

          {snapshot?.research ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Active Tuner</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {snapshot.research.activeTuner.activePolicyName}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {snapshot.research.activeTuner.source} since{" "}
                    {formatTimestamp(snapshot.research.activeTuner.changedAt, snapshot.timeZone)}
                  </p>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Pending Windows</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{snapshot.research.pendingWindows}</p>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Resolved Windows</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{snapshot.research.resolvedWindows}</p>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Latest Window</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {snapshot.research.latestWindow?.marketTicker ?? "No recorded research windows yet"}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Champion then {snapshot.research.latestWindow?.championPolicySlug ?? "--"}.
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Settlement {formatMoney(snapshot.research.latestWindow?.settlementPriceDollars)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {snapshot.research.recentChanges.length ? (
                  <div className="rounded-[22px] border border-white/10 bg-[#0c1420] p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Recent Tuner Changes</p>
                    <div className="mt-3 grid gap-2 text-sm text-slate-300">
                      {snapshot.research.recentChanges.map((change) => (
                        <p key={change.id}>
                          {change.fromPolicyName ?? "none"} {"->"} {change.toPolicyName} ({change.source}) at{" "}
                          {formatTimestamp(change.promotedAt, snapshot.timeZone)}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {snapshot.research.leaderboard.length ? (
                  snapshot.research.leaderboard.map((entry) => (
                    <div key={entry.policySlug} className="rounded-[22px] border border-white/10 bg-[#0c1420] p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-semibold text-white">{entry.policyName}</p>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs ${entry.isChampion ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-50" : "border-white/10 bg-white/5 text-slate-300"}`}
                            >
                              {entry.isChampion ? "champion" : "challenger"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-400">
                            {entry.windows} windows | {entry.trades} paper trades | hit rate {formatNumber(entry.hitRate * 100)}%
                          </p>
                        </div>
                        <div className="grid gap-2 text-right text-sm text-slate-300">
                          <p>Total paper PnL: <span className="font-semibold text-white">{formatMoney(entry.totalPaperPnlDollars)}</span></p>
                          <p>Avg paper PnL: <span className="font-semibold text-white">{formatMoney(entry.avgPaperPnlDollars)}</span></p>
                          <p>Wins / losses: <span className="font-semibold text-white">{entry.wins} / {entry.losses}</span></p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
                    The research engine has not resolved any completed windows yet.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
              Shadow tuners are temporarily paused. The live bot is trading only the active champion profile.
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[28px] border border-white/10 bg-[rgba(9,15,24,0.78)] p-5 backdrop-blur xl:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Same-Day Activity</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Analysis and trade log</h2>
            </div>
            <p className="text-sm text-slate-400">
              Server-side log scoped to the current deployment day in {snapshot?.timeZone ?? "UTC"}.
            </p>
          </div>

          <div className="mt-5 grid gap-3">
            {snapshot?.log.length ? (
              snapshot.log.map((entry) => (
                <div key={entry.id} className="rounded-[22px] border border-white/10 bg-[#0c1420] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold text-white">{entry.call.toUpperCase()}</p>
                        <span className={`rounded-full border px-3 py-1 text-xs ${riskTone(entry.timingRisk)}`}>
                          {entry.timingRisk}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs ${setupTone(entry.setupType)}`}>
                          {entry.setupType}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {entry.source}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {entry.confidence} confidence
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{entry.summary}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {entry.marketTicker ?? "No market"} | strike {formatMoney(entry.strikePrice)} |
                        spot {formatMoney(entry.currentPrice)} | minute {entry.minuteInWindow}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        YES ask {formatMoney(entry.yesAskPrice)} | NO ask {formatMoney(entry.noAskPrice)} |
                        edge {formatNumber(entry.deterministicEdge, 3)}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      {formatTimestamp(entry.createdAt, snapshot.timeZone)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Reasoning</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        {entry.reasoning.map((reason) => (
                          <p key={reason}>{reason}</p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Gate Reasons</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        {entry.gateReasons.length ? (
                          entry.gateReasons.map((reason) => <p key={reason}>{reason}</p>)
                        ) : (
                          <p>No gate reasons recorded.</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Market Snapshot</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        <p>Balance: {formatMoney(entry.availableBalanceDollars)}</p>
                        <p>Portfolio: {formatMoney(entry.portfolioValueDollars)}</p>
                        <p>Distance: {formatNumber(entry.distanceToStrike)}</p>
                        <p>ATR14: {formatNumber(entry.atr14)}</p>
                        <p>RSI14: {formatNumber(entry.rsi14)}</p>
                        <p>Momentum 5m: {formatNumber(entry.momentum5)}</p>
                        <p>Momentum 15m: {formatNumber(entry.momentum15)}</p>
                        <p>YES bid/ask: {formatMoney(entry.yesBidPrice)} / {formatMoney(entry.yesAskPrice)}</p>
                        <p>NO bid/ask: {formatMoney(entry.noBidPrice)} / {formatMoney(entry.noAskPrice)}</p>
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        <p>Status: {entry.execution.status}</p>
                        <p>Outcome: {entry.execution.outcome ?? "n/a"}</p>
                        <p>Candidate: {entry.candidateSide ?? "n/a"}</p>
                        <p>Side: {entry.execution.side ?? "n/a"}</p>
                        <p>Contracts: {entry.execution.contracts ?? "n/a"}</p>
                        <p>Managed trade: {entry.execution.managedTradeId ?? "n/a"}</p>
                        <p>Entry price: {formatMoney(entry.execution.entryPriceDollars)}</p>
                        <p>Target: {formatMoney(entry.execution.targetPriceDollars)}</p>
                        <p>Stop: {formatMoney(entry.execution.stopPriceDollars)}</p>
                        <p>Deterministic confidence: {entry.deterministicConfidence}</p>
                        <p>Max cost: {formatMoney(entry.execution.maxCostDollars)}</p>
                        <p>{entry.execution.message}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
                No same-day runs yet. Auto-entry will populate this once the bot finds an eligible market.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
