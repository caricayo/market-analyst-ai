"use client";

import { useEffect, useState } from "react";
import type { TickerInfo } from "@/lib/types";
import { fetchTickers } from "@/lib/api";

export function useTickerSearch() {
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchTickers();
        if (!cancelled) {
          setTickers(data);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tickers");
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { tickers, loading, error };
}
