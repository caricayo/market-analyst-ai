"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisPhase,
  AnalysisResult,
  SSEEvent,
  StageState,
} from "@/lib/types";
import { createInitialStages } from "@/lib/constants";
import { startAnalysis, cancelAnalysis, getAnalysisStatus } from "@/lib/api";

export function useAnalysis() {
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [stages, setStages] = useState<StageState[]>(createInitialStages());
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [ticker, setTicker] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);

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

    // In production, use relative URL (goes through Next.js rewrite proxy).
    // In dev, connect directly to backend to avoid proxy buffering SSE.
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || (
      typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "http://localhost:8000"
        : ""
    );
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
        const { analysis_id } = await startAnalysis(tickerInput);
        setAnalysisId(analysis_id);
        connectToStream(analysis_id);
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

  // Check for in-progress analysis on mount (page refresh reconnection)
  useEffect(() => {
    async function checkExisting() {
      try {
        const status = await getAnalysisStatus();
        if (status.active && status.analysis_id) {
          setPhase("running");
          setAnalysisId(status.analysis_id);
          setTicker(status.ticker || "");
          connectToStream(status.analysis_id);
        }
      } catch {
        // Server not available yet, that's fine
      }
    }
    checkExisting();

    return () => closeEventSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    phase,
    stages,
    result,
    error,
    ticker,
    start,
    cancel,
    reset,
  };
}
