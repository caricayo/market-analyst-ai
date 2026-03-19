"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { LiveMarketsResponse, LiveNewsResponse } from "@/lib/live-data";
import { aiStockSuggestions, newsPanels, newsTickerFeed, type WatchlistItem } from "@/lib/mock-data";

type LiveState<T> = {
  data: T;
  loading: boolean;
  mode: "live" | "fallback";
  warning: string | null;
  generatedAt: string | null;
};

function buildInitialNewsState(): LiveState<LiveNewsResponse["articles"]> {
  return {
    data: newsPanels,
    loading: false,
    mode: "fallback",
    warning: null,
    generatedAt: null,
  };
}

function buildInitialMarketsState(ticker: string): LiveState<{
  quotes: LiveMarketsResponse["quotes"];
  focusNews: LiveMarketsResponse["focusNews"];
  suggestions: LiveMarketsResponse["suggestions"];
}> {
  return {
    data: {
      quotes: [],
      focusNews: newsTickerFeed[ticker] ?? newsTickerFeed.NVDA,
      suggestions: aiStockSuggestions,
    },
    loading: false,
    mode: "fallback",
    warning: null,
    generatedAt: null,
  };
}

export function useDashboardLiveData(filters: string[], query: string, watchlist: WatchlistItem[], focusTicker: string) {
  const [newsState, setNewsState] = useState(buildInitialNewsState);
  const [marketState, setMarketState] = useState(() => buildInitialMarketsState(focusTicker));
  const [newsRefreshKey, setNewsRefreshKey] = useState(0);
  const [marketRefreshKey, setMarketRefreshKey] = useState(0);

  const watchlistKey = useMemo(
    () => watchlist.map((item) => item.ticker.toUpperCase()).sort().join(","),
    [watchlist],
  );

  const loadNews = useEffectEvent(async (controller: AbortController) => {
    setNewsState((current) => ({ ...current, loading: true, warning: null }));

    try {
      const now = new Date();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const year = parts.find((part) => part.type === "year")?.value ?? "1970";
      const month = parts.find((part) => part.type === "month")?.value ?? "01";
      const day = parts.find((part) => part.type === "day")?.value ?? "01";
      const params = new URLSearchParams({
        categories: filters.join(","),
        query,
        date: `${year}-${month}-${day}`,
        timezone: timeZone,
        refresh: "1",
      });

      const url = `/api/news?${params.toString()}`;
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load live news right now.");
      }

      const payload = (await response.json()) as LiveNewsResponse;
      if (controller.signal.aborted) {
        return;
      }

      setNewsState({
        data: payload.articles.length ? payload.articles : newsPanels,
        loading: false,
        mode: payload.mode,
        warning: payload.warning ?? null,
        generatedAt: payload.generatedAt,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }

      setNewsState({
        data: newsPanels,
        loading: false,
        mode: "fallback",
        warning: error instanceof Error ? error.message : "Unable to load live news right now.",
        generatedAt: null,
      });
    }
  });

  useEffect(() => {
    if (newsRefreshKey === 0) {
      return;
    }

    const controller = new AbortController();
    void loadNews(controller);

    return () => controller.abort();
  }, [newsRefreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMarkets = async () => {
      setMarketState((current) => ({ ...current, loading: true, warning: null }));

      try {
        const url =
          `/api/markets?focusTicker=${encodeURIComponent(focusTicker)}` +
          `&tickers=${encodeURIComponent(watchlistKey)}`;

        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load live market intelligence right now.");
        }

        const payload = (await response.json()) as LiveMarketsResponse;
        if (controller.signal.aborted) {
          return;
        }

        setMarketState({
          data: {
            quotes: payload.quotes,
            focusNews: payload.focusNews.length
              ? payload.focusNews
              : newsTickerFeed[focusTicker] ?? newsTickerFeed.NVDA,
            suggestions: payload.suggestions.length ? payload.suggestions : aiStockSuggestions,
          },
          loading: false,
          mode: payload.mode,
          warning: payload.warning ?? null,
          generatedAt: payload.generatedAt,
        });
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }

        setMarketState({
          data: {
            quotes: [],
            focusNews: newsTickerFeed[focusTicker] ?? newsTickerFeed.NVDA,
            suggestions: aiStockSuggestions,
          },
          loading: false,
          mode: "fallback",
          warning:
            error instanceof Error ? error.message : "Unable to load live market intelligence right now.",
          generatedAt: null,
        });
      }
    };

    void loadMarkets();

    return () => controller.abort();
  }, [focusTicker, marketRefreshKey, watchlistKey]);

  return {
    liveNews: newsState.data,
    newsMode: newsState.mode,
    newsLoading: newsState.loading,
    newsWarning: newsState.warning,
    newsGeneratedAt: newsState.generatedAt,
    refreshNews: () => setNewsRefreshKey((current) => current + 1),
    marketQuotes: marketState.data.quotes,
    liveFocusNews: marketState.data.focusNews,
    liveSuggestions: marketState.data.suggestions,
    marketMode: marketState.mode,
    marketLoading: marketState.loading,
    marketWarning: marketState.warning,
    marketGeneratedAt: marketState.generatedAt,
    refreshMarkets: () => setMarketRefreshKey((current) => current + 1),
  };
}
