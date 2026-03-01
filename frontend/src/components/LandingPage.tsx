"use client";

import { useRef, useState } from "react";
import { AuthForm } from "@/components/AuthGate";
import ReportView from "@/components/ReportView";
import PipelineTracker from "@/components/PipelineTracker";
import TickerInput from "@/components/TickerInput";
import { SAMPLE_REPORT } from "@/data/sample-report";
import { useAnalysis } from "@/hooks/useAnalysis";

export default function LandingPage() {
  const sampleRef = useRef<HTMLDivElement>(null);
  const authRef = useRef<HTMLDivElement>(null);
  const demoRef = useRef<HTMLDivElement>(null);

  const {
    phase,
    stages,
    result,
    error,
    ticker,
    partialSections,
    startDemo,
    cancel,
    reset,
  } = useAnalysis();

  const [demoUsed, setDemoUsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("arfour_demo_used") === "1";
  });

  const scrollToSample = () =>
    sampleRef.current?.scrollIntoView({ behavior: "smooth" });
  const scrollToAuth = () =>
    authRef.current?.scrollIntoView({ behavior: "smooth" });
  const scrollToDemo = () =>
    demoRef.current?.scrollIntoView({ behavior: "smooth" });

  const handleDemoStart = (t: string) => {
    localStorage.setItem("arfour_demo_used", "1");
    setDemoUsed(true);
    startDemo(t);
  };

  const handleDemoReset = () => {
    reset();
  };

  // Demo is currently running or complete
  const demoActive = phase === "running" || phase === "complete" || phase === "error";

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Hero ── */}
      <section className="flex flex-col items-center justify-center min-h-[70vh] px-6 py-20">
        <h1 className="text-4xl sm:text-5xl font-bold text-t-green glow-green tracking-wider mb-2">
          arfour
        </h1>
        <p className="text-xs sm:text-sm text-t-amber tracking-widest uppercase mb-8">
          multi-perspective investment intelligence
        </p>

        <div className="max-w-lg text-center space-y-3 mb-10">
          <p className="text-sm text-t-text leading-relaxed">
            Institutional-quality equity analysis powered by three AI analyst
            personas. Deep fundamentals, macro context, and value assessment
            &mdash; synthesized into one actionable report.
          </p>
          <p className="text-xs text-t-dim">
            Type a ticker. Get a full research report. That&apos;s it.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={scrollToSample}
            className="px-6 py-2.5 border border-t-green text-t-green text-xs uppercase tracking-wider hover:bg-t-green/10 transition-colors"
          >
            See Sample Report
          </button>
          {!demoUsed && (
            <button
              onClick={scrollToDemo}
              className="px-6 py-2.5 border border-t-amber text-t-amber text-xs uppercase tracking-wider hover:bg-t-amber/10 transition-colors"
            >
              Try Free Analysis
            </button>
          )}
          <button
            onClick={scrollToAuth}
            className="px-6 py-2.5 border border-t-border text-t-text text-xs uppercase tracking-wider hover:border-t-amber hover:text-t-amber transition-colors"
          >
            Sign In
          </button>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="max-w-4xl mx-auto w-full px-6 py-16">
        <h2 className="text-xs text-t-dim uppercase tracking-widest mb-6 text-center">
          How It Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          {[
            { n: "01", label: "Intake", desc: "Validate ticker, gather metadata" },
            { n: "02", label: "Deep Dive", desc: "6-lane parallel research + 14-section analysis" },
            { n: "03", label: "Perspectives", desc: "3 analyst personas evaluate independently" },
            { n: "04", label: "Synthesis", desc: "Cross-perspective consensus & conflicts" },
            { n: "05", label: "Assembly", desc: "Final report compilation & delivery" },
          ].map((s) => (
            <div
              key={s.n}
              className="border border-t-border bg-t-dark p-3 text-center"
            >
              <div className="text-t-green text-lg font-bold mb-1">{s.n}</div>
              <div className="text-xs text-t-text font-bold uppercase tracking-wider mb-1">
                {s.label}
              </div>
              <div className="text-[10px] text-t-dim leading-relaxed">
                {s.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample Report ── */}
      <section ref={sampleRef} className="max-w-6xl mx-auto w-full px-6 py-16">
        <h2 className="text-xs text-t-dim uppercase tracking-widest mb-2 text-center">
          Sample Report
        </h2>
        <p className="text-xs text-t-border text-center mb-6">
          Real AAPL analysis (truncated) &mdash; every report follows this format
        </p>

        <div className="border border-t-border bg-t-dark overflow-hidden">
          <div className="px-4 py-2 border-b border-t-border">
            <span className="text-xs text-t-green font-bold uppercase tracking-wider">
              Report: AAPL
            </span>
          </div>
          <ReportView result={SAMPLE_REPORT} />
        </div>
      </section>

      {/* ── Try Free Analysis ── */}
      <section ref={demoRef} className="max-w-4xl mx-auto w-full px-6 py-16">
        <h2 className="text-xs text-t-dim uppercase tracking-widest mb-2 text-center">
          Try It Free
        </h2>
        <p className="text-xs text-t-border text-center mb-6">
          Run one full analysis &mdash; no account needed
        </p>

        {!demoActive && (
          <div className="max-w-md mx-auto">
            <TickerInput
              disabled={false}
              onSubmit={handleDemoStart}
              onCancel={() => {}}
              isRunning={false}
            />
          </div>
        )}

        {/* Demo running */}
        {phase === "running" && (
          <>
            <div className="border border-t-border bg-t-dark p-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-t-amber font-bold uppercase tracking-wider">
                  Analyzing {ticker}
                </span>
                <div className="w-2 h-2 bg-t-green animate-pulse" />
              </div>
              <PipelineTracker stages={stages} />
              <button
                onClick={cancel}
                className="mt-3 text-xs text-t-dim hover:text-t-red transition-colors"
              >
                CANCEL
              </button>
            </div>

            {/* Partial results streaming */}
            {(partialSections.deep_dive || partialSections.perspectives || partialSections.synthesis) && (
              <div className="border border-t-border bg-t-dark mt-2 overflow-hidden">
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

        {/* Demo error */}
        {phase === "error" && (
          <div className="border border-t-red bg-t-red/5 p-4 mt-4">
            <p className="text-xs text-t-red mb-3">{error}</p>
            <button
              onClick={handleDemoReset}
              className="px-4 py-1.5 border border-t-green text-t-green text-xs hover:bg-t-green/10 transition-colors"
            >
              TRY AGAIN
            </button>
          </div>
        )}

        {/* Demo complete */}
        {phase === "complete" && result && (
          <div className="mt-4">
            <div className="border border-t-border bg-t-dark overflow-hidden">
              <div className="px-4 py-2 border-b border-t-border flex items-center justify-between">
                <span className="text-xs text-t-green font-bold uppercase tracking-wider">
                  Report: {result.ticker}
                </span>
                <button
                  onClick={handleDemoReset}
                  className="text-xs text-t-dim hover:text-t-text transition-colors"
                >
                  DONE
                </button>
              </div>
              <ReportView result={result} />
            </div>
            <div className="border border-t-amber bg-t-amber/5 p-4 mt-4 text-center">
              <p className="text-xs text-t-amber mb-2">
                Sign up to save this report and get 3 free analyses per week.
              </p>
              <button
                onClick={scrollToAuth}
                className="px-6 py-2 border border-t-green text-t-green text-xs uppercase tracking-wider hover:bg-t-green/10 transition-colors"
              >
                Create Free Account
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Pricing ── */}
      <section className="max-w-4xl mx-auto w-full px-6 py-16">
        <h2 className="text-xs text-t-dim uppercase tracking-widest mb-6 text-center">
          Pricing
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="border border-t-border bg-t-dark p-5 text-center">
            <div className="text-xs text-t-amber uppercase tracking-wider mb-2">
              Free Tier
            </div>
            <div className="text-2xl font-bold text-t-green mb-1">$0</div>
            <div className="text-xs text-t-text mb-3">3 analyses / week</div>
            <div className="text-[10px] text-t-dim">
              Full reports, all 3 perspectives, synthesis
            </div>
          </div>

          <div className="border border-t-green bg-t-dark p-5 text-center">
            <div className="text-xs text-t-amber uppercase tracking-wider mb-2">
              Starter Pack
            </div>
            <div className="text-2xl font-bold text-t-green mb-1">$4.99</div>
            <div className="text-xs text-t-text mb-3">10 credits</div>
            <div className="text-[10px] text-t-dim">
              $0.50 per analysis
            </div>
          </div>

          <div className="border border-t-border bg-t-dark p-5 text-center">
            <div className="text-xs text-t-amber uppercase tracking-wider mb-2">
              Pro Pack
            </div>
            <div className="text-2xl font-bold text-t-green mb-1">$19.99</div>
            <div className="text-xs text-t-text mb-3">50 credits</div>
            <div className="text-[10px] text-t-dim">
              $0.40 per analysis
            </div>
          </div>
        </div>

        {/* Business philosophy */}
        <div className="border border-t-border bg-t-dark px-6 py-4 text-center">
          <p className="text-xs text-t-text leading-relaxed">
            &ldquo;We charge only what it costs to run &mdash; API calls,
            hosting, and a small margin. No venture-backed markup. Good analysis
            tools should be accessible to everyone.&rdquo;
          </p>
        </div>
      </section>

      {/* ── Coming Soon ── */}
      <section className="max-w-4xl mx-auto w-full px-6 py-12">
        <div className="border border-t-border bg-t-dark p-6 text-center">
          <h2 className="text-xs text-t-amber uppercase tracking-widest mb-3">
            Coming Soon
          </h2>
          <p className="text-sm text-t-text mb-1">
            Ask AI about your analysis results.
          </p>
          <p className="text-xs text-t-dim">
            Drill into specific findings. Challenge assumptions. Get deeper
            answers.
          </p>
        </div>
      </section>

      {/* ── Auth ── */}
      <section
        ref={authRef}
        className="flex flex-col items-center px-6 py-16"
      >
        <h2 className="text-xs text-t-dim uppercase tracking-widest mb-2">
          Get Started
        </h2>
        <p className="text-xs text-t-border mb-6">
          Create a free account &mdash; 3 analyses per week, no credit card
          required
        </p>
        <AuthForm />
      </section>

      {/* Footer */}
      <footer className="border-t border-t-border py-4 px-6 text-center">
        <p className="text-[10px] text-t-dim">
          AI-generated reports are for informational purposes only and do not
          constitute investment advice.{" "}
          <a href="/terms" className="text-t-amber hover:underline">
            Terms
          </a>{" "}
          &middot;{" "}
          <a href="/privacy" className="text-t-amber hover:underline">
            Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}
