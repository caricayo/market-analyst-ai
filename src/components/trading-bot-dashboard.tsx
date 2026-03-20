"use client";

import { useEffect, useState } from "react";
import type { BotStatusSnapshot } from "@/lib/trading-types";

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
    case "late-window":
      return "border-[#f5d76e]/35 bg-[#f5d76e]/12 text-[#fff0bf]";
    default:
      return "border-[#73d9a5]/30 bg-[#73d9a5]/12 text-[#d4ffe5]";
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
    }, 20_000);
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
                Kalshi execution with Coinbase tape and AI-constrained trade calls.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                The bot watches the active Bitcoin 15-minute above/below contract, scores the current
                one-minute tape, downgrades risky entry zones, and only submits an order when the
                setup survives the timing and confidence gates.
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
                {state.running ? "Running and trading..." : "Analyze and trade"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-4">
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
              <div className={`mt-3 inline-flex rounded-full border px-3 py-2 text-sm font-medium ${snapshot ? riskTone(snapshot.timingRisk) : "border-white/10 bg-white/5 text-slate-200"}`}>
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
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {snapshot?.decision?.summary ?? "No signal yet."}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Confidence</p>
                <p className="mt-2 text-2xl font-semibold text-white">{snapshot?.decision?.confidence ?? "--"}</p>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution Mapping</p>
              <p className="mt-2 text-sm text-slate-300">
                Outcome {snapshot?.decision?.derivedOutcome ?? "n/a"} maps to Kalshi side{" "}
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
                Minutes 1-3 are hard-blocked. Minutes 4-8 are preferred. Minutes 9-15 require a
                stronger edge to qualify.
              </p>
            </div>
          </section>
        </div>

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
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {entry.confidence} confidence
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{entry.summary}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {entry.marketTicker ?? "No market"} · strike {formatMoney(entry.strikePrice)} ·
                        spot {formatMoney(entry.currentPrice)} · minute {entry.minuteInWindow}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      {formatTimestamp(entry.createdAt, snapshot.timeZone)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Reasoning</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        {entry.reasoning.map((reason) => (
                          <p key={reason}>{reason}</p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        <p>Status: {entry.execution.status}</p>
                        <p>Outcome: {entry.execution.outcome ?? "n/a"}</p>
                        <p>Side: {entry.execution.side ?? "n/a"}</p>
                        <p>Contracts: {entry.execution.contracts ?? "n/a"}</p>
                        <p>Max cost: {formatMoney(entry.execution.maxCostDollars)}</p>
                        <p>{entry.execution.message}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 bg-white/5 px-5 py-6 text-sm text-slate-400">
                No same-day runs yet. Use “Analyze and trade” to generate the first bot entry.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
