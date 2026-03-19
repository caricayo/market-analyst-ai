import type { NewsPanel, StockNewsEntry, StockSuggestion, WeatherCity } from "@/lib/mock-data";

export type LiveMode = "live" | "fallback";

export type FeedMeta = {
  generatedAt: string;
  mode: LiveMode;
  warning?: string;
};

export type LiveNewsResponse = FeedMeta & {
  articles: NewsPanel[];
};

export type LiveMarketQuote = {
  ticker: string;
  company?: string;
  price: number;
  dayChange: number;
};

export type LiveMarketsResponse = FeedMeta & {
  focusTicker: string;
  focusNews: StockNewsEntry[];
  quotes: LiveMarketQuote[];
  suggestions: StockSuggestion[];
};

export type LiveWeatherResponse = FeedMeta & {
  cities: WeatherCity[];
};
