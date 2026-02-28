"use client";

import { useCallback, useRef, useState } from "react";
import type { TickerInfo } from "@/lib/types";
import { searchTickers } from "@/lib/api";

const DEBOUNCE_MS = 250;

export function useTickerSearch() {
  const [results, setResults] = useState<TickerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    // Clear pending debounce
    if (timerRef.current) clearTimeout(timerRef.current);

    // Cancel in-flight request
    if (abortRef.current) abortRef.current.abort();

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await searchTickers(query.trim(), 8, controller.signal);
        if (!controller.signal.aborted) {
          setResults(data);
          setLoading(false);
        }
      } catch {
        // Aborted requests are expected — only clear loading on real errors
        if (!controller.signal.aborted) {
          setResults([]);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setResults([]);
    setLoading(false);
  }, []);

  return { results, loading, search, clear };
}
