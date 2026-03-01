"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import Header from "@/components/Header";
import CreditStore from "@/components/CreditStore";
import Disclaimer from "@/components/Disclaimer";
import TickerInput from "@/components/TickerInput";
import PipelineTracker from "@/components/PipelineTracker";
import ReportView from "@/components/ReportView";
import AnalysisHistory from "@/components/AnalysisHistory";
import LandingPage from "@/components/LandingPage";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useHistory } from "@/hooks/useHistory";
import { fetchProfile } from "@/lib/api";
import type { AnalysisResult } from "@/lib/types";

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="text-t-dim text-xs">Loading...</div></div>}>
      <AuthGate>
        {(user, _session) =>
          user ? <AppContent userEmail={user.email} /> : <LandingPage />
        }
      </AuthGate>
    </Suspense>
  );
}

function AppContent({ userEmail }: { userEmail?: string }) {
  const {
    phase,
    stages,
    result,
    error,
    ticker,
    creditsRemaining,
    partialSections,
    start,
    cancel,
    reset,
    loadSavedResult,
    refreshCredits,
  } = useAnalysis();
  const { analyses, loading: historyLoading, loadAnalysis, fetchHistory } = useHistory();

  const [showStore, setShowStore] = useState(false);
  const [nextReset, setNextReset] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // Fetch next_reset on mount
  useEffect(() => {
    fetchProfile()
      .then((p) => setNextReset(p.next_reset))
      .catch(() => {});
  }, []);

  // Handle checkout return query params
  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (!checkout) return;

    // Clean URL
    router.replace("/", { scroll: false });

    if (checkout === "success") {
      // Poll for updated credits — webhook may arrive with slight delay.
      // Exponential backoff: 1s, 2s, 4s, 5s, 5s, 5s (~22s total) + jitter.
      const pollCredits = async () => {
        const initialProfile = await refreshCredits();
        const initialCredits = initialProfile?.credits_remaining ?? 0;
        const delays = [1000, 2000, 4000, 5000, 5000, 5000];

        for (const delay of delays) {
          const jitter = Math.random() * 300;
          await new Promise((r) => setTimeout(r, delay + jitter));
          const p = await refreshCredits();
          if (p) {
            setNextReset(p.next_reset);
            if (p.credits_remaining > initialCredits) break;
          }
        }
      };
      pollCredits();
      setToast("Credits added successfully!");
      setTimeout(() => setToast(null), 4000);
    }
    // cancelled — silently clean URL (already done above)
  }, [searchParams, router, refreshCredits]);

  const handleLoadSaved = async (id: string) => {
    const full = await loadAnalysis(id);
    if (full?.result) {
      loadSavedResult(full.result as AnalysisResult);
    }
  };

  // Refresh history after a completed analysis
  const handleReset = () => {
    reset();
    fetchHistory();
  };

  const formatResetDate = (iso: string | null) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header
        userEmail={userEmail}
        creditsRemaining={creditsRemaining}
        onOpenStore={() => setShowStore(true)}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 border border-t-green bg-t-dark px-4 py-2 animate-pulse">
          <p className="text-xs text-t-green">{toast}</p>
        </div>
      )}

      <CreditStore open={showStore} onClose={() => setShowStore(false)} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6">
        {/* Ticker Input — always visible */}
        <div className="mb-6">
          <TickerInput
            disabled={phase === "running"}
            onSubmit={start}
            onCancel={cancel}
            isRunning={phase === "running"}
          />
          {/* Credit warning — friendly weekly reset message */}
          {creditsRemaining !== null && creditsRemaining === 0 && phase === "idle" && (
            <div className="mt-2 border border-t-amber bg-t-amber/5 px-3 py-2">
              <p className="text-xs text-t-amber">
                You&apos;ve used your free credits this week.
                {nextReset && (
                  <> They&apos;ll refresh on {formatResetDate(nextReset)}.</>
                )}
              </p>
              <button
                onClick={() => setShowStore(true)}
                className="mt-1 text-xs text-t-cyan hover:text-t-cyan/80 transition-colors uppercase tracking-wider"
              >
                Get More Credits
              </button>
            </div>
          )}
        </div>

        {/* Analysis History — show when idle */}
        {phase === "idle" && (
          <div className="mb-6">
            <AnalysisHistory
              analyses={analyses}
              loading={historyLoading}
              onSelect={handleLoadSaved}
            />
          </div>
        )}

        {/* Running state: show pipeline tracker + partial results */}
        {phase === "running" && (
          <>
            <div className="border border-t-border bg-t-dark p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-t-amber font-bold uppercase tracking-wider">
                  Analyzing {ticker}
                </span>
                <div className="w-2 h-2 bg-t-green animate-pulse" />
              </div>
              <PipelineTracker stages={stages} />
            </div>

            {/* Show partial report as sections stream in */}
            {(partialSections.deep_dive || partialSections.perspectives || partialSections.synthesis) && (
              <div className="border border-t-border bg-t-dark mt-2 overflow-hidden min-w-0">
                <div className="px-4 py-2 border-b border-t-border">
                  <span className="text-xs text-t-green font-bold uppercase tracking-wider">
                    Report Preview: {ticker}
                  </span>
                  <span className="text-xs text-t-dim ml-2">
                    (streaming&hellip;)
                  </span>
                </div>
                <ReportView
                  result={{
                    ticker,
                    filepath: "",
                    sections: {
                      deep_dive: partialSections.deep_dive,
                      perspectives: partialSections.perspectives,
                      synthesis: partialSections.synthesis,
                    },
                    persona_verdicts: [],
                  }}
                />
              </div>
            )}
          </>
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
              onClick={handleReset}
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
            <div className="border border-t-border bg-t-dark mt-2 overflow-hidden min-w-0">
              <div className="px-4 py-2 border-b border-t-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReset}
                    className="text-xs text-t-dim hover:text-t-green transition-colors"
                    title="Back to history"
                  >
                    &larr; BACK
                  </button>
                  <span className="text-xs text-t-green font-bold uppercase tracking-wider">
                    Report: {result.ticker}
                  </span>
                </div>
                <button
                  onClick={handleReset}
                  className="text-xs text-t-dim hover:text-t-text transition-colors"
                >
                  NEW ANALYSIS
                </button>
              </div>
              <ReportView result={result} />
            </div>
          </div>
        )}

        {/* Idle state: show first-run quick start */}
        {phase === "idle" && analyses.length === 0 && !historyLoading && (
          <div className="text-center py-16">
            <div className="text-t-dim text-xs space-y-4">
              <p>Welcome to arfour. Try analyzing a popular stock:</p>
              <div className="flex items-center justify-center gap-3">
                {["NVDA", "AAPL", "MSFT", "TSLA"].map((t) => (
                  <button
                    key={t}
                    onClick={() => start(t)}
                    className="px-4 py-2 border border-t-border text-t-green text-xs hover:border-t-green hover:bg-t-green/5 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="text-t-border">
                Or type any ticker above. Typical analysis: 3-5 minutes.
              </p>
            </div>
          </div>
        )}
      </main>

      <Disclaimer />
    </div>
  );
}
