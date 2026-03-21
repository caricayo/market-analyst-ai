"use client";

import { useEffect, useState, type ReactNode } from "react";
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

function formatContracts(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
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

function reviewTone(result: "win" | "loss" | "flat") {
  switch (result) {
    case "win":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-50";
    case "loss":
      return "border-rose-400/30 bg-rose-400/12 text-rose-100";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

function MetricGrid({
  items,
  columns = "sm:grid-cols-2",
}: {
  items: Array<{ label: string; value: ReactNode; tone?: string }>;
  columns?: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{item.label}</p>
          <p className={`mt-2 text-sm font-medium ${item.tone ?? "text-white"}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[18px] border border-white/10 bg-white/5 p-4 open:bg-[#111c2b]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-white marker:content-none">
        <span>{title}</span>
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500 transition group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
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
        <section className="rounded-[28px] border border-white/10 bg-[rgba(7,12,20,0.82)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:rounded-[32px] sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-200/70">BTC 15-Minute Bot</p>
              <h1 className="mt-3 max-w-3xl font-display text-3xl leading-tight text-white sm:text-5xl">
                Kalshi execution with Coinbase tape and deterministic trade calls.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                The bot trades a single intraday scalp playbook on the active Bitcoin 15-minute
                contract, using directional confidence from tape pressure, momentum, EMA
                structure, VWAP, RSI, and strike displacement.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void loadSnapshot()}
                disabled={state.loading || state.running}
                className="w-full rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {state.loading ? "Refreshing..." : "Refresh snapshot"}
              </button>
              <button
                type="button"
                onClick={() => void runBot()}
                disabled={state.loading || state.running}
                className="w-full rounded-full border border-emerald-400/25 bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {state.running ? "Running and trading..." : "Run once now"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
                      <div className="mt-3">
                        <MetricGrid
                          items={[
                            { label: "Entry", value: formatMoney(trade.entryPriceDollars) },
                            { label: "Target", value: formatMoney(trade.targetPriceDollars) },
                            { label: "Stop", value: formatMoney(trade.stopPriceDollars) },
                            { label: "Last Bid", value: formatMoney(trade.lastSeenBidDollars) },
                            { label: "Peak", value: formatMoney(trade.peakPriceDollars) },
                            { label: "Stop State", value: trade.stopArmedAt ? "Armed" : "Waiting" },
                          ]}
                        />
                      </div>
                      {trade.errorMessage ? (
                        <p className="mt-2 text-sm text-amber-100">{trade.errorMessage}</p>
                      ) : null}
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      Status: {trade.status}
                    </div>
                  </div>
                  <div className="mt-4">
                    <Disclosure title="Managed trade details">
                      <MetricGrid
                        columns="sm:grid-cols-2 xl:grid-cols-4"
                        items={[
                          { label: "Entry Tier", value: formatMoney(trade.entryTierDollars) },
                          { label: "Target Tier", value: formatMoney(trade.targetTierDollars) },
                          { label: "Stop Tier", value: formatMoney(trade.stopTierDollars) },
                          { label: "Band", value: trade.confidenceBand ?? "n/a" },
                          { label: "Forced Exit", value: formatTimestamp(trade.forcedExitAt, snapshot.timeZone) },
                          { label: "Armed At", value: formatTimestamp(trade.stopArmedAt, snapshot.timeZone) },
                        ]}
                      />
                    </Disclosure>
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

            <div className="mt-4">
              <MetricGrid
                items={[
                  {
                    label: "Execution Map",
                    value: `${snapshot?.decision?.candidateSide ?? "n/a"} -> ${snapshot?.decision?.derivedSide ?? "n/a"}`,
                  },
                  {
                    label: "Gate Count",
                    value: snapshot?.decision?.gateReasons?.length ?? 0,
                  },
                  {
                    label: "Blockers",
                    value: snapshot?.decision?.blockers?.length ?? 0,
                  },
                  {
                    label: "Confidence",
                    value: snapshot?.decision?.confidence ?? "--",
                  },
                ]}
              />
            </div>

            <div className="mt-4 grid gap-3">
              <Disclosure title="Reasoning" defaultOpen>
                <div className="grid gap-2 text-sm text-slate-300">
                  {snapshot?.decision?.reasoning?.length ? (
                    snapshot.decision.reasoning.map((reason) => <p key={reason}>{reason}</p>)
                  ) : (
                    <p>Signal reasoning will appear after the first analysis.</p>
                  )}
                </div>
              </Disclosure>

              <Disclosure title="Gate reasons">
                <div className="grid gap-2 text-sm text-slate-300">
                  {snapshot?.decision?.gateReasons?.length ? (
                    snapshot.decision.gateReasons.map((reason) => <p key={reason}>{reason}</p>)
                  ) : (
                    <p>No qualifying gate passed yet.</p>
                  )}
                </div>
              </Disclosure>

              <Disclosure title="Blockers">
                <div className="grid gap-2 text-sm text-slate-300">
                  {snapshot?.decision?.blockers?.length ? (
                    snapshot.decision.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)
                  ) : (
                    <p>No current blockers.</p>
                  )}
                </div>
              </Disclosure>
            </div>

            <div className="mt-4 rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-emerald-50/70">Timing Rule</p>
              <p className="mt-2 text-sm leading-6 text-emerald-50">
                There are no hard timing gates. The bot always scores the current window and uses
                timing only as context inside the scalp confidence model.
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
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Trade Reviews</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Why trades won or lost</h2>
            </div>
            <p className="text-sm text-slate-400">
              Closed managed trades are summarized so losers and winners leave a usable trail.
            </p>
          </div>

          <div className="mt-5 grid gap-3">
            {snapshot?.recentTradeReviews.length ? (
              snapshot.recentTradeReviews.map((review) => (
                <div key={review.id} className="rounded-[22px] border border-white/10 bg-[#0c1420] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold text-white">{review.marketTicker}</p>
                        <span className={`rounded-full border px-3 py-1 text-xs ${setupTone(review.setupType)}`}>
                          {review.setupType}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs ${reviewTone(review.result)}`}>
                          {review.result}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {review.exitReason ?? "unknown"} exit
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{review.summary}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {review.entryOutcome.toUpperCase()} | entry {formatMoney(review.entryPriceDollars)} | exit{" "}
                        {formatMoney(review.exitPriceDollars)} | peak {formatMoney(review.peakPriceDollars)} | PnL{" "}
                        {formatMoney(review.realizedPnlDollars)}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      {formatTimestamp(review.closedAt, snapshot.timeZone)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">What Happened</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        {review.happened.map((item) => (
                          <p key={`${review.id}-happened-${item}`}>{item}</p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">What To Learn From It</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        {review.takeaways.map((item) => (
                          <p key={`${review.id}-takeaway-${item}`}>{item}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
                No closed managed trades are available for same-day review yet.
              </div>
            )}
          </div>
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
                      <div className="mt-3">
                        <MetricGrid
                          items={[
                            { label: "Market", value: entry.marketTicker ?? "No market" },
                            { label: "Minute", value: entry.minuteInWindow },
                            { label: "Strike", value: formatMoney(entry.strikePrice) },
                            { label: "Spot", value: formatMoney(entry.currentPrice) },
                            { label: "YES / NO Ask", value: `${formatMoney(entry.yesAskPrice)} / ${formatMoney(entry.noAskPrice)}` },
                            { label: "Edge", value: formatNumber(entry.deterministicEdge, 3) },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      {formatTimestamp(entry.createdAt, snapshot.timeZone)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <MetricGrid
                      columns="sm:grid-cols-2 xl:grid-cols-4"
                      items={[
                        { label: "Status", value: entry.execution.status },
                        { label: "Outcome", value: entry.execution.outcome ?? "n/a" },
                        { label: "Candidate", value: entry.candidateSide ?? "n/a" },
                        { label: "Side", value: entry.execution.side ?? "n/a" },
                        { label: "Filled Contracts", value: formatContracts(entry.execution.contracts) },
                        { label: "Planned Contracts", value: formatContracts(entry.execution.plannedContracts) },
                        { label: "Entry", value: formatMoney(entry.execution.entryPriceDollars) },
                        { label: "Target / Stop", value: `${formatMoney(entry.execution.targetPriceDollars)} / ${formatMoney(entry.execution.stopPriceDollars)}` },
                      ]}
                    />

                    <Disclosure title="Reasoning" defaultOpen>
                      <div className="grid gap-2 text-sm text-slate-300">
                        {entry.reasoning.map((reason) => (
                          <p key={reason}>{reason}</p>
                        ))}
                      </div>
                    </Disclosure>

                    <Disclosure title="Gate reasons and blockers">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Gate Reasons</p>
                          {entry.gateReasons.length ? (
                            entry.gateReasons.map((reason) => <p key={reason}>{reason}</p>)
                          ) : (
                            <p>No gate reasons recorded.</p>
                          )}
                        </div>
                        <div className="grid gap-2 text-sm text-slate-300">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Blockers</p>
                          {entry.blockers.length ? (
                            entry.blockers.map((reason) => <p key={reason}>{reason}</p>)
                          ) : (
                            <p>No blockers recorded.</p>
                          )}
                        </div>
                      </div>
                    </Disclosure>

                    <Disclosure title="Market snapshot">
                      <MetricGrid
                        columns="sm:grid-cols-2 xl:grid-cols-4"
                        items={[
                          { label: "Balance", value: formatMoney(entry.availableBalanceDollars) },
                          { label: "Portfolio", value: formatMoney(entry.portfolioValueDollars) },
                          { label: "Distance", value: formatNumber(entry.distanceToStrike) },
                          { label: "ATR14", value: formatNumber(entry.atr14) },
                          { label: "RSI14", value: formatNumber(entry.rsi14) },
                          { label: "Momentum 5m", value: formatNumber(entry.momentum5) },
                          { label: "Momentum 15m", value: formatNumber(entry.momentum15) },
                          { label: "YES bid / ask", value: `${formatMoney(entry.yesBidPrice)} / ${formatMoney(entry.yesAskPrice)}` },
                          { label: "NO bid / ask", value: `${formatMoney(entry.noBidPrice)} / ${formatMoney(entry.noAskPrice)}` },
                        ]}
                      />
                    </Disclosure>

                    <Disclosure title="Execution details">
                      <MetricGrid
                        columns="sm:grid-cols-2 xl:grid-cols-4"
                        items={[
                          { label: "Managed Trade", value: entry.execution.managedTradeId ?? "n/a" },
                          { label: "Entry Tier", value: formatMoney(entry.execution.entryTierDollars) },
                          { label: "Target Tier", value: formatMoney(entry.execution.targetTierDollars) },
                          { label: "Stop Tier", value: formatMoney(entry.execution.stopTierDollars) },
                          { label: "Band", value: entry.execution.confidenceBand ?? "n/a" },
                          { label: "Deterministic Confidence", value: entry.deterministicConfidence },
                          { label: "Filled Max Cost", value: formatMoney(entry.execution.maxCostDollars) },
                          { label: "Planned Max Cost", value: formatMoney(entry.execution.plannedMaxCostDollars) },
                          { label: "Visible Liquidity", value: formatContracts(entry.execution.liquidityAvailableContracts) },
                          { label: "Orderbook Depth", value: `${entry.execution.liquidityDepthLevels ?? "n/a"} levels` },
                          { label: "Execution Note", value: entry.execution.message, tone: "text-slate-300" },
                        ]}
                      />
                    </Disclosure>

                    <Disclosure title={`Execution attempts (${entry.execution.attempts.length})`}>
                      <div className="grid gap-2 text-sm text-slate-300">
                        {entry.execution.attempts.length ? (
                          entry.execution.attempts.map((attempt) => (
                            <p key={`${entry.id}-attempt-${attempt.attemptNumber}`}>
                              Attempt {attempt.attemptNumber}: {formatMoney(attempt.limitPriceDollars)} | planned {formatContracts(attempt.plannedContracts)} | submitted {formatContracts(attempt.submittedContracts)} | visible liquidity {formatContracts(attempt.liquidityAvailableContracts)} | {attempt.status} | {attempt.message}
                            </p>
                          ))
                        ) : (
                          <p>No execution attempts were made for this run.</p>
                        )}
                      </div>
                    </Disclosure>
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
