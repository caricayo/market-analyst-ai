"use client";

import Header from "@/components/Header";
import Disclaimer from "@/components/Disclaimer";
import TickerInput from "@/components/TickerInput";
import PipelineTracker from "@/components/PipelineTracker";
import ReportView from "@/components/ReportView";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useTickerSearch } from "@/hooks/useTickerSearch";

export default function Home() {
  const { tickers } = useTickerSearch();
  const { phase, stages, result, error, ticker, start, cancel, reset } =
    useAnalysis();

  return (
    <div className="flex flex-col min-h-screen">
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6">
        {/* Ticker Input — always visible */}
        <div className="mb-6">
          <TickerInput
            tickers={tickers}
            disabled={phase === "running"}
            onSubmit={start}
            onCancel={cancel}
            isRunning={phase === "running"}
          />
        </div>

        {/* Running state: show pipeline tracker */}
        {phase === "running" && (
          <div className="border border-t-border bg-t-dark p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-t-amber font-bold uppercase tracking-wider">
                Analyzing {ticker}
              </span>
              <div className="w-2 h-2 bg-t-green animate-pulse" />
            </div>
            <PipelineTracker stages={stages} />
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <div className="border border-t-red bg-t-red/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 16 16" className="text-t-red">
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="square"
                />
              </svg>
              <span className="text-sm font-bold text-t-red">Analysis Failed</span>
            </div>
            <p className="text-xs text-t-text mb-3">{error}</p>
            <button
              onClick={reset}
              className="px-4 py-1.5 border border-t-green text-t-green text-xs hover:bg-t-green/10 transition-colors"
            >
              TRY AGAIN
            </button>
          </div>
        )}

        {/* Complete state: show collapsed tracker + report */}
        {phase === "complete" && result && (
          <div>
            <PipelineTracker stages={stages} collapsed />
            <div className="border border-t-border bg-t-dark mt-2">
              <div className="px-4 py-2 border-b border-t-border flex items-center justify-between">
                <span className="text-xs text-t-green font-bold uppercase tracking-wider">
                  Report: {result.ticker}
                </span>
                <button
                  onClick={reset}
                  className="text-xs text-t-dim hover:text-t-text transition-colors"
                >
                  NEW ANALYSIS
                </button>
              </div>
              <ReportView result={result} />
            </div>
          </div>
        )}

        {/* Idle state: show welcome message */}
        {phase === "idle" && (
          <div className="text-center py-16">
            <div className="text-t-dim text-xs space-y-2">
              <p>Enter a ticker symbol or company name to begin analysis.</p>
              <p>
                The pipeline runs 5 stages: intake, deep dive, persona
                evaluations, synthesis, and assembly.
              </p>
              <p className="text-t-border">
                Typical analysis time: 3-5 minutes
              </p>
            </div>
          </div>
        )}
      </main>

      <Disclaimer />
    </div>
  );
}
