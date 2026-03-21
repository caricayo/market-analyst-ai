"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BotStatusSnapshot } from "@/lib/trading-types";

type LoadState = {
  data: BotStatusSnapshot | null;
  loading: boolean;
  error: string | null;
};

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

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatContracts(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
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
    second: "2-digit",
  });
}

function cardClass(signal: "above" | "below" | "no_trade") {
  switch (signal) {
    case "above":
      return "border-emerald-300/35 bg-emerald-400/12 text-emerald-50";
    case "below":
      return "border-rose-300/35 bg-rose-400/12 text-rose-50";
    default:
      return "border-amber-300/30 bg-amber-300/10 text-amber-50";
  }
}

function glowClass(signal: "above" | "below" | "no_trade") {
  switch (signal) {
    case "above":
      return "bg-[radial-gradient(circle,rgba(16,185,129,0.65)_0%,rgba(16,185,129,0.14)_38%,transparent_70%)]";
    case "below":
      return "bg-[radial-gradient(circle,rgba(244,63,94,0.65)_0%,rgba(244,63,94,0.14)_38%,transparent_70%)]";
    default:
      return "bg-[radial-gradient(circle,rgba(245,158,11,0.55)_0%,rgba(245,158,11,0.12)_38%,transparent_70%)]";
  }
}

function pulseClass(signal: "above" | "below" | "no_trade") {
  switch (signal) {
    case "above":
      return "border-emerald-300/45 bg-emerald-400/15 shadow-[0_0_80px_rgba(16,185,129,0.35)]";
    case "below":
      return "border-rose-300/45 bg-rose-400/15 shadow-[0_0_80px_rgba(244,63,94,0.35)]";
    default:
      return "border-amber-300/40 bg-amber-300/12 shadow-[0_0_80px_rgba(245,158,11,0.25)]";
  }
}

async function parseResponse(response: Response) {
  const payload = (await response.json()) as BotStatusSnapshot | { error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Request failed.");
  }
  return payload as BotStatusSnapshot;
}

function Metric({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

export function TradingBotDashboard() {
  const [state, setState] = useState<LoadState>({
    data: null,
    loading: true,
    error: null,
  });
  const [pollingActive, setPollingActive] = useState(true);
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
        error: error instanceof Error ? error.message : "Unable to load the signal monitor.",
      }));
    } finally {
      requestInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    if (!pollingActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pollingActive]);

  const snapshot = state.data;
  const signal = snapshot?.decision?.call ?? "no_trade";
  const selectedAsk = useMemo(() => {
    if (!snapshot?.market || !snapshot?.decision?.derivedSide) {
      return null;
    }

    return snapshot.decision.derivedSide === "yes"
      ? snapshot.market.yesAskPrice
      : snapshot.market.noAskPrice;
  }, [snapshot]);

  const recommendation = useMemo(() => {
    const availableStake = Math.max(
      0,
      Math.min(snapshot?.stakeDollars ?? 0, snapshot?.availableBalanceDollars ?? snapshot?.stakeDollars ?? 0),
    );

    if (
      !snapshot?.decision?.shouldTrade ||
      !selectedAsk ||
      !Number.isFinite(selectedAsk) ||
      selectedAsk <= 0 ||
      availableStake <= 0
    ) {
      return {
        contracts: 0,
        spendDollars: 0,
      };
    }

    const contracts = Math.max(0, Math.floor(availableStake / selectedAsk));
    return {
      contracts,
      spendDollars: Number((contracts * selectedAsk).toFixed(2)),
    };
  }, [selectedAsk, snapshot]);

  const confidenceTone =
    signal === "above" ? "text-emerald-100" : signal === "below" ? "text-rose-100" : "text-amber-100";

  return (
    <main className="min-h-screen overflow-hidden bg-[#060b12] px-4 py-4 text-slate-100 sm:px-6 lg:px-8">
      <div className={`pointer-events-none absolute inset-0 opacity-90 ${glowClass(signal)}`} />
      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col gap-4">
        <section
          className={`rounded-[32px] border px-5 py-6 backdrop-blur-xl sm:px-8 sm:py-8 ${cardClass(signal)}`}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.34em] text-white/65">BTC 15M Signal Monitor</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Manual-only tape reader for the active Kalshi contract.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75 sm:text-base">
                This page no longer trades. It polls Kalshi and Coinbase every second, scores the
                15-minute Bitcoin market, and shows direction, confidence, and suggested size.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="rounded-[28px] border border-white/10 bg-black/20 px-5 py-4 text-sm text-white/80">
                <p>Last refresh: {formatTimestamp(snapshot?.generatedAt, snapshot?.timeZone ?? "Pacific/Honolulu")}</p>
                <p className="mt-1">Market: {snapshot?.market?.ticker ?? "loading"}</p>
                <p className="mt-1">Window: {snapshot?.currentWindowLabel ?? "loading"}</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPollingActive(true)}
                  disabled={pollingActive}
                  className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-5 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Go
                </button>
                <button
                  type="button"
                  onClick={() => setPollingActive(false)}
                  disabled={!pollingActive}
                  className="rounded-full border border-rose-300/30 bg-rose-400/15 px-5 py-3 text-sm font-semibold text-rose-50 transition hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className={`rounded-[30px] border px-5 py-6 text-center animate-pulse ${pulseClass(signal)}`}>
              <p className="text-xs uppercase tracking-[0.4em] text-white/65">Live Signal</p>
              <p className={`mt-4 text-6xl font-black tracking-[0.18em] sm:text-8xl ${confidenceTone}`}>
                {signal === "above" ? "GREEN" : signal === "below" ? "RED" : "WAIT"}
              </p>
              <p className="mt-4 text-lg font-medium text-white/90">
                {signal === "above"
                  ? "Bias is ABOVE"
                  : signal === "below"
                    ? "Bias is BELOW"
                    : "No trade-quality directional read"}
              </p>
              <p className="mt-2 text-sm text-white/70">{snapshot?.decision?.summary ?? "Loading current tape read..."}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Confidence" value={`${snapshot?.decision?.confidence ?? 0}`} tone={confidenceTone} />
              <Metric
                label="Recommended Buy"
                value={
                  snapshot?.decision?.shouldTrade && recommendation.contracts > 0
                    ? `${formatContracts(recommendation.contracts)} ${snapshot?.decision?.derivedSide?.toUpperCase() ?? ""}`
                    : "No buy"
                }
                tone={confidenceTone}
              />
              <Metric label="Suggested Spend" value={formatMoney(recommendation.spendDollars)} />
              <Metric label="Selected Ask" value={formatMoney(selectedAsk)} />
              <Metric label="BTC Spot" value={formatMoney(snapshot?.indicators?.currentPrice)} />
              <Metric label="Kalshi Strike" value={formatMoney(snapshot?.market?.strikePrice)} />
              <Metric label="YES Ask / Bid" value={`${formatMoney(snapshot?.market?.yesAskPrice)} / ${formatMoney(snapshot?.market?.yesBidPrice)}`} />
              <Metric label="NO Ask / Bid" value={`${formatMoney(snapshot?.market?.noAskPrice)} / ${formatMoney(snapshot?.market?.noBidPrice)}`} />
            </div>
          </div>
        </section>

        {state.error ? (
          <section className="rounded-[28px] border border-rose-400/30 bg-rose-400/12 px-5 py-4 text-sm text-rose-100">
            {state.error}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Signal Details</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="Trend Bias" value={snapshot?.indicators?.trendBias ?? "n/a"} />
              <Metric label="Deterministic Edge" value={formatNumber(snapshot?.indicators?.deterministicEdge, 3)} />
              <Metric label="Distance To Strike" value={formatMoney(snapshot?.indicators?.distanceToStrike)} />
              <Metric label="ATR14" value={formatNumber(snapshot?.indicators?.atr14)} />
              <Metric label="RSI14" value={formatNumber(snapshot?.indicators?.rsi14)} />
              <Metric label="Momentum 5m" value={formatNumber(snapshot?.indicators?.momentum5)} />
              <Metric label="Momentum 15m" value={formatNumber(snapshot?.indicators?.momentum15)} />
              <Metric label="Momentum 30m" value={formatNumber(snapshot?.indicators?.momentum30)} />
              <Metric label="EMA9 / EMA21" value={`${formatNumber(snapshot?.indicators?.ema9)} / ${formatNumber(snapshot?.indicators?.ema21)}`} />
              <Metric label="EMA55 / VWAP" value={`${formatNumber(snapshot?.indicators?.ema55)} / ${formatNumber(snapshot?.indicators?.vwap)}`} />
              <Metric label="Minute In Window" value={`${snapshot?.minuteInWindow ?? "--"}`} />
              <Metric label="Timing Context" value={snapshot?.timingRisk ?? "n/a"} />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Reasoning</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Why This Read</p>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                  {snapshot?.decision?.reasoning?.length ? (
                    snapshot.decision.reasoning.map((reason) => <p key={reason}>{reason}</p>)
                  ) : (
                    <p>Loading reasoning…</p>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Conviction Drivers</p>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                  {snapshot?.decision?.gateReasons?.length ? (
                    snapshot.decision.gateReasons.map((reason) => <p key={reason}>{reason}</p>)
                  ) : (
                    <p>No conviction drivers yet.</p>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-[#0c1420] p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Current Blockers</p>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
                  {snapshot?.decision?.blockers?.length ? (
                    snapshot.decision.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)
                  ) : (
                    <p>No active blockers.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
