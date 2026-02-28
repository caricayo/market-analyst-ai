"use client";

import type { AnalysisSummary } from "@/hooks/useHistory";

interface AnalysisHistoryProps {
  analyses: AnalysisSummary[];
  loading: boolean;
  onSelect: (id: string) => void;
}

export default function AnalysisHistory({
  analyses,
  loading,
  onSelect,
}: AnalysisHistoryProps) {
  if (loading) {
    return (
      <div className="border border-t-border bg-t-dark p-3">
        <div className="text-xs text-t-dim">Loading history...</div>
      </div>
    );
  }

  if (analyses.length === 0) {
    return null;
  }

  return (
    <div className="border border-t-border bg-t-dark">
      <div className="px-3 py-2 border-b border-t-border">
        <span className="text-xs text-t-dim uppercase tracking-wider">
          Recent Analyses
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {analyses.map((a) => (
          <button
            key={a.id}
            onClick={() => a.status === "complete" && onSelect(a.id)}
            disabled={a.status !== "complete"}
            className="w-full px-3 py-2 flex items-center justify-between border-b border-t-border/50 last:border-0 hover:bg-t-gray/50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 ${
                  a.status === "complete"
                    ? "bg-t-green"
                    : a.status === "error"
                      ? "bg-t-red"
                      : "bg-t-amber"
                }`}
              />
              <span className="text-xs text-t-text font-bold">
                {a.ticker}
              </span>
            </div>
            <span className="text-xs text-t-dim">
              {new Date(a.created_at).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
