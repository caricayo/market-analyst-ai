"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

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

  const fetchHistory = useCallback(async () => {
    try {
      const sb = createSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;

      const backendUrl =
        process.env.NEXT_PUBLIC_API_URL ||
        (typeof window !== "undefined" && window.location.hostname === "localhost"
          ? "http://localhost:8000"
          : "");

      const res = await fetch(`${backendUrl}/api/user/analyses?limit=50`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setAnalyses(data.analyses);
    } catch {
      // Silently fail — history is non-critical
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
        const sb = createSupabaseClient();
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return null;

        const backendUrl =
          process.env.NEXT_PUBLIC_API_URL ||
          (typeof window !== "undefined" && window.location.hostname === "localhost"
            ? "http://localhost:8000"
            : "");

        const res = await fetch(`${backendUrl}/api/user/analyses/${id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    []
  );

  return { analyses, loading, fetchHistory, loadAnalysis };
}
