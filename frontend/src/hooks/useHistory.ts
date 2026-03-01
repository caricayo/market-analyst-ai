"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAnalysesList, fetchAnalysisById } from "@/lib/api";

export interface AnalysisSummary {
  id: string;
  ticker: string;
  status: string;
  cost_usd: number | null;
  created_at: string;
}

export interface AnalysisFull extends AnalysisSummary {
  user_id: string;
  result: {
    ticker: string;
    filepath: string;
    sections: {
      deep_dive: string;
      perspectives: string;
      synthesis: string;
    };
    persona_verdicts: Array<{
      persona_id: string;
      persona_name: string;
      persona_label: string;
      rating: string;
      confidence: number;
      time_horizon: string;
      position_size: string;
      available: boolean;
    }>;
  } | null;
}

export function useHistory() {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchHistory = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setError(null);
      const data = await fetchAnalysesList(50, controller.signal);
      setAnalyses(data.analyses);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Failed to load history";
      setError(msg);
      console.warn("History fetch failed:", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const loadAnalysis = useCallback(
    async (id: string): Promise<AnalysisFull | null> => {
      try {
        const data = await fetchAnalysisById(id);
        return data as AnalysisFull | null;
      } catch (e) {
        console.warn("Failed to load analysis:", e);
        return null;
      }
    },
    []
  );

  return { analyses, loading, error, fetchHistory, loadAnalysis };
}
