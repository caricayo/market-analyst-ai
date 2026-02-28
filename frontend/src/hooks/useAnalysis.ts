"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisPhase,
  AnalysisResult,
  SSEEvent,
  StageState,
} from "@/lib/types";
import { createInitialStages } from "@/lib/constants";
import { startAnalysis, cancelAnalysis, fetchProfile, getBackendUrl } from "@/lib/api";

export function useAnalysis() {
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [stages, setStages] = useState<StageState[]>(createInitialStages());
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [ticker, setTicker] = useState<string>("");
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);

  // Load credit balance on mount
  useEffect(() => {
    fetchProfile()
      .then((p) => setCreditsRemaining(p.credits_remaining))
      .catch(() => {});
  }, []);

  function updateStage(stageId: string, updates: Partial<StageState>) {
    setStages((prev) =>
      prev.map((s) => (s.id === stageId ? { ...s, ...updates } : s))
    );
  }

  function handleSSEEvent(event: SSEEvent) {
    if (event.event_type === "keepalive") return;

    if (event.event_type === "stage_update" && event.stage) {
      const now = Date.now() / 1000;
      if (event.status === "running") {
        updateStage(event.stage, {
          status: "running",
          detail: event.detail || "",
          startedAt: now,
        });
      } else if (event.status === "complete") {
        updateStage(event.stage, {
          status: "complete",
          detail: event.detail || "",
          completedAt: now,
        });
      } else if (event.status === "error") {
        updateStage(event.stage, {
          status: "error",
          detail: event.detail || "",
        });
      }
    } else if (event.event_type === "analysis_complete" && event.data) {
      setResult(event.data);
      setPhase("complete");
      // Refresh credit balance after completed analysis
      fetchProfile()
        .then((p) => setCreditsRemaining(p.credits_remaining))
        .catch(() => {});
      closeEventSource();
    } else if (event.event_type === "analysis_error") {
      setError(event.detail || "Analysis failed");
      setPhase("error");
      closeEventSource();
    }
  }

  function closeEventSource() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function connectToStream(id: string) {
    closeEventSource();
    retryCountRef.current = 0;

    const backendUrl = getBackendUrl();
    const es = new EventSource(`${backendUrl}/api/analyze/${id}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        handleSSEEvent(data);
        retryCountRef.current = 0;
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      retryCountRef.current++;
      if (retryCountRef.current >= 5) {
        setError("Lost connection to server after 5 retries");
        setPhase("error");
        closeEventSource();
      }
      // EventSource will auto-reconnect
    };
  }

  const start = useCallback(
    async (tickerInput: string) => {
      setPhase("running");
      setStages(createInitialStages());
      setResult(null);
      setError(null);
      setTicker(tickerInput);

      try {
        const response = await startAnalysis(tickerInput);
        setAnalysisId(response.analysis_id);
        if (response.credits_remaining !== undefined) {
          setCreditsRemaining(response.credits_remaining);
        }
        connectToStream(response.analysis_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start analysis");
        setPhase("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const cancel = useCallback(async () => {
    if (analysisId) {
      await cancelAnalysis(analysisId);
    }
    closeEventSource();
    setPhase("idle");
    setStages(createInitialStages());
    setAnalysisId(null);
    setError(null);
  }, [analysisId]);

  const reset = useCallback(() => {
    closeEventSource();
    setPhase("idle");
    setStages(createInitialStages());
    setResult(null);
    setError(null);
    setAnalysisId(null);
    setTicker("");
  }, []);

  /** Re-fetch profile to update credit balance (e.g. after purchase) */
  const refreshCredits = useCallback(async () => {
    try {
      const p = await fetchProfile();
      setCreditsRemaining(p.credits_remaining);
      return p;
    } catch {
      return null;
    }
  }, []);

  /** Load a saved analysis result directly (from history) */
  const loadSavedResult = useCallback((savedResult: AnalysisResult) => {
    setResult(savedResult);
    setTicker(savedResult.ticker);
    setPhase("complete");
    setStages(
      createInitialStages().map((s) => ({
        ...s,
        status: "complete" as const,
      }))
    );
  }, []);

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => closeEventSource();
  }, []);

  return {
    phase,
    stages,
    result,
    error,
    ticker,
    creditsRemaining,
    start,
    cancel,
    reset,
    loadSavedResult,
    refreshCredits,
  };
}
