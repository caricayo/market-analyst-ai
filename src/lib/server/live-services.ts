import OpenAI from "openai";
import {
  aiStockSuggestions,
  newsPanels,
  newsTickerFeed,
  newsTypes,
  weatherCities,
  type NewsCategory,
  type NewsPanel,
  type StockNewsEntry,
  type StockSuggestion,
  type WeatherCity,
} from "@/lib/mock-data";
import type { LiveMarketsResponse, LiveNewsResponse, LiveWeatherResponse } from "@/lib/live-data";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type WeatherApiPayload = {
  timezone?: string;
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    precipitation_probability?: number;
    weather_code?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    sunrise?: string[];
    sunset?: string[];
    uv_index_max?: number[];
  };
};

const openAiKey = process.env.OPENAI_API_KEY;
const openAiClient = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;
const cache = new Map<string, CacheEntry<unknown>>();
const minute = 60_000;
const hour = 60 * minute;
const trustedNewsDomains = [
  "abcnews.go.com",
  "apnews.com",
  "arstechnica.com",
  "axios.com",
  "bbc.com",
  "bloomberg.com",
  "cbsnews.com",
  "cnbc.com",
  "cnn.com",
  "economist.com",
  "engadget.com",
  "fortune.com",
  "ft.com",
  "investopedia.com",
  "marketwatch.com",
  "nbcnews.com",
  "npr.org",
  "nytimes.com",
  "politico.com",
  "reuters.com",
  "semafor.com",
  "techcrunch.com",
  "theatlantic.com",
  "theguardian.com",
  "theinformation.com",
  "theverge.com",
  "washingtonpost.com",
  "wired.com",
  "wsj.com",
] as const;
const topTierNewsDomains = [
  "apnews.com",
  "arstechnica.com",
  "bbc.com",
  "bloomberg.com",
  "cnbc.com",
  "npr.org",
  "politico.com",
  "reuters.com",
  "techcrunch.com",
  "theguardian.com",
  "theverge.com",
] as const;

type LiveNewsDraft = {
  stories?: Array<{
    category?: string;
    headline?: string;
    source?: string;
    summary?: string;
    url?: string;
    publishedAt?: string;
    keyPoints?: string[];
    impact?: string;
  }>;
};

function getCachedValue<T>(key: string) {
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

async function withCache<T>(key: string, ttlMs: number, factory: () => Promise<T>) {
  const cached = getCachedValue<T>(key);
  if (cached) {
    return cached;
  }

  const value = await factory();
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  return value;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function buildHistory(referencePrice: number, seed: string) {
  return Array.from({ length: 10 }, (_, index) => {
    const baseline = referencePrice * (0.91 + index * 0.015);
    const drift = Math.sin(seed.length * 0.7 + index) * 0.018;
    return Number((baseline * (1 + drift)).toFixed(2));
  });
}

function toMood(category: NewsCategory) {
  switch (category) {
    case "Markets":
      return "Tape moving";
    case "Tech":
      return "Build shift";
    case "World":
      return "Global watch";
    case "Culture":
      return "Consumer pulse";
    case "Policy":
      return "Regulation watch";
    default:
      return "Daily brief";
  }
}

function cleanDelimitedField(value: string) {
  const normalized = value
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(CATEGORY|HEADLINE|SOURCE|SUMMARY|URL|PUBLISHED_AT|TONE|TICKER|COMPANY|PRICE|DAY_CHANGE_PERCENT|RATING|THESIS|CATALYST|PRICE_REFERENCE):\s*/i, "")
    .replace(/^\[|\]$/g, "")
    .trim();
  const urlMatch = normalized.match(/https?:\/\/[^\s)]+/);
  return urlMatch?.[0] ?? normalized;
}

function toNumber(value: string) {
  const numeric = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDelimitedRows(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("||").map(cleanDelimitedField))
    .filter((parts) => parts.length >= 2);
}

function getSection(content: string, heading: string) {
  const match = content.match(new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
  return match?.[1]?.trim() ?? "";
}

function fallbackNews(categories: string[], query: string): NewsPanel[] {
  const normalizedQuery = query.trim().toLowerCase();
  return newsPanels
    .filter((item) => {
      const categoryMatch = !categories.length || categories.includes(item.category);
      const queryMatch =
        !normalizedQuery ||
        [item.headline, item.summary, item.source, item.impact].join(" ").toLowerCase().includes(normalizedQuery);
      return categoryMatch && queryMatch;
    })
    .slice(0, 6);
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") {
      return undefined;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeHostname(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isLikelyArticleUrl(value: string | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const segments = path.split("/").filter(Boolean);
    const lastSegment = segments.at(-1) ?? "";

    if (segments.length < 2 || !lastSegment) {
      return false;
    }

    if (/[+]/.test(lastSegment)) {
      return false;
    }

    if (
      /(^|\/)(author|authors|category|categories|live|section|sections|search|tag|tags|topic|topics|video|videos)(\/|$)/.test(
        path,
      )
    ) {
      return false;
    }

    return /[a-z0-9]/.test(lastSegment);
  } catch {
    return false;
  }
}

function hostnameMatchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isTrustedNewsUrl(value: string | undefined) {
  const hostname = normalizeHostname(value);
  return hostname ? trustedNewsDomains.some((domain) => hostnameMatchesDomain(hostname, domain)) : false;
}

function getNewsSourceScore(value: string | undefined) {
  const hostname = normalizeHostname(value);
  if (!hostname) {
    return 0;
  }

  if (topTierNewsDomains.some((domain) => hostnameMatchesDomain(hostname, domain))) {
    return 2;
  }

  return trustedNewsDomains.some((domain) => hostnameMatchesDomain(hostname, domain)) ? 1 : 0;
}

function normalizePublishedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function getFreshnessWindowMs(category: NewsCategory, relaxed = false) {
  if (category === "World" || category === "Policy") {
    return relaxed ? 10 * 24 * hour : 7 * 24 * hour;
  }

  return relaxed ? 7 * 24 * hour : 4 * 24 * hour;
}

function isFreshNewsDate(publishedAt: string | undefined, category: NewsCategory, relaxed = false) {
  if (!publishedAt) {
    return false;
  }

  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) {
    return false;
  }

  const ageMs = Date.now() - publishedTime;
  if (ageMs < 0) {
    return false;
  }

  return ageMs <= getFreshnessWindowMs(category, relaxed);
}

function normalizeKeyPoints(value: unknown, summary: string, impact: string) {
  if (!Array.isArray(value)) {
    return [summary, impact, "Open the source link for the full story."].slice(0, 3);
  }

  const points = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  return points.length ? points : [summary, impact, "Open the source link for the full story."].slice(0, 3);
}

function sanitizeArticle(
  item: Partial<NewsPanel> & { url?: unknown; publishedAt?: unknown },
  index: number,
  categories: string[],
): NewsPanel {
  const category = newsTypes.includes(item.category as NewsCategory)
    ? (item.category as NewsCategory)
    : ((categories[0] as NewsCategory | undefined) ?? "Markets");
  const headline = String(item.headline ?? `Arfor brief ${index + 1}`).trim();
  const summary = String(item.summary ?? "No summary available.").trim();
  const impact = String(item.impact ?? summary).trim();
  const normalizedUrl = normalizeUrl(item.url);
  const normalizedPublishedAt = normalizePublishedAt(item.publishedAt);
  const keyPoints = normalizeKeyPoints(item.keyPoints, summary, impact);

  const article: NewsPanel = {
    id: slugify(String(item.id ?? `${category}-${headline}`)) || `${category.toLowerCase()}-${index + 1}`,
    category,
    headline,
    source: String(item.source ?? "Web search").trim(),
    summary,
    readTime: String(item.readTime ?? "4 min read").trim(),
    mood: String(item.mood ?? toMood(category)).trim(),
    orb: "radial-gradient(circle, rgba(226,187,105,0.24), transparent 68%)",
    keyPoints: keyPoints.length ? keyPoints : [summary, "Watch this story closely.", "Source detail available from the live feed."],
    impact,
    url: normalizedUrl,
    publishedAt: normalizedPublishedAt,
  };

  return article;
}

function sanitizeStockNews(item: Partial<StockNewsEntry>, index: number, ticker: string): StockNewsEntry {
  return {
    headline: String(item.headline ?? `${ticker} update ${index + 1}`).trim(),
    source: String(item.source ?? "Web search").trim(),
    tone: String(item.tone ?? "watch").trim(),
    url: normalizeUrl(item.url),
    publishedAt: normalizePublishedAt(item.publishedAt),
  };
}

function sanitizeSuggestion(
  item: Partial<StockSuggestion> & { priceReference?: unknown },
  index: number,
): StockSuggestion {
  const priceReference =
    typeof item.priceReference === "number" && Number.isFinite(item.priceReference)
      ? item.priceReference
      : 100 + index * 20;
  const ticker = String(item.ticker ?? `IDEA${index + 1}`).trim().toUpperCase();

  return {
    ticker,
    company: String(item.company ?? ticker).trim(),
    rating: String(item.rating ?? "Watch").trim(),
    thesis: String(item.thesis ?? "Live search returned a new name worth watching.").trim(),
    catalyst: String(item.catalyst ?? "Follow the next catalyst window.").trim(),
    seedHistory: buildHistory(priceReference, ticker),
  };
}

function sanitizeQuote(item: { ticker?: unknown; company?: unknown; price?: unknown; dayChange?: unknown }) {
  if (typeof item.ticker !== "string") {
    return null;
  }

  const price = typeof item.price === "number" && Number.isFinite(item.price) ? item.price : 0;
  const dayChange =
    typeof item.dayChange === "number" && Number.isFinite(item.dayChange) ? item.dayChange : 0;

  return {
    ticker: item.ticker.toUpperCase(),
    company: typeof item.company === "string" ? item.company : undefined,
    price: Number(price.toFixed(2)),
    dayChange: Number(dayChange.toFixed(2)),
  };
}

function getArticleFingerprint(article: NewsPanel) {
  const hostname = normalizeHostname(article.url) ?? article.source.toLowerCase();
  return `${slugify(article.headline)}:${hostname}`;
}

function getArticleUrlFingerprint(article: NewsPanel) {
  return article.url ? article.url.toLowerCase() : article.id;
}

function scoreNewsArticle(article: NewsPanel, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const publishedTime = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
  const ageHours = publishedTime > 0 ? Math.max(0, (Date.now() - publishedTime) / hour) : 999;
  const queryMatch =
    normalizedQuery &&
    [article.headline, article.summary, article.source, article.impact]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
      ? 1
      : 0;

  return getNewsSourceScore(article.url) * 100 - ageHours + queryMatch * 25;
}

function balanceNewsArticles(articles: NewsPanel[], categories: NewsCategory[], query: string) {
  const sorted = [...articles].sort((left, right) => scoreNewsArticle(right, query) - scoreNewsArticle(left, query));
  const requestedCategories = categories.length ? categories : newsTypes;
  const broadBrief = !query.trim();
  const selected: NewsPanel[] = [];
  const usedIds = new Set<string>();
  const categoryCounts = new Map<NewsCategory, number>();

  for (const category of requestedCategories) {
    const candidate = sorted.find((article) => article.category === category && !usedIds.has(article.id));
    if (!candidate) {
      continue;
    }

    selected.push(candidate);
    usedIds.add(candidate.id);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  for (const candidate of sorted) {
    if (usedIds.has(candidate.id)) {
      continue;
    }

    const categoryCount = categoryCounts.get(candidate.category) ?? 0;
    if (broadBrief && requestedCategories.length > 1 && categoryCount >= 2) {
      continue;
    }

    selected.push(candidate);
    usedIds.add(candidate.id);
    categoryCounts.set(candidate.category, categoryCount + 1);

    if (selected.length >= 6) {
      break;
    }
  }

  return selected.slice(0, 6);
}

function refineNewsArticles(articles: NewsPanel[], categories: NewsCategory[], query: string) {
  const deduped = articles.filter(
    (article, index, items) =>
      items.findIndex(
        (candidate) =>
          getArticleFingerprint(candidate) === getArticleFingerprint(article) ||
          getArticleUrlFingerprint(candidate) === getArticleUrlFingerprint(article),
      ) === index,
  );

  const strict = deduped.filter(
    (article) =>
      isTrustedNewsUrl(article.url) &&
      isLikelyArticleUrl(article.url) &&
      isFreshNewsDate(article.publishedAt, article.category),
  );
  const relaxed = deduped.filter(
    (article) =>
      isTrustedNewsUrl(article.url) &&
      isLikelyArticleUrl(article.url) &&
      isFreshNewsDate(article.publishedAt, article.category, true),
  );
  const candidates = strict.length >= 3 ? strict : relaxed;
  return balanceNewsArticles(candidates, categories, query);
}

function blendNewsArticles(liveArticles: NewsPanel[], fallbackArticles: NewsPanel[]) {
  const selected = [...liveArticles];
  const usedFingerprints = new Set(liveArticles.map(getArticleFingerprint));
  const usedUrls = new Set(liveArticles.map(getArticleUrlFingerprint));
  const coveredCategories = new Set(liveArticles.map((article) => article.category));

  for (const article of fallbackArticles) {
    if (usedFingerprints.has(getArticleFingerprint(article)) || usedUrls.has(getArticleUrlFingerprint(article))) {
      continue;
    }

    if (!coveredCategories.has(article.category)) {
      selected.push(article);
      usedFingerprints.add(getArticleFingerprint(article));
      usedUrls.add(getArticleUrlFingerprint(article));
      coveredCategories.add(article.category);
    }

    if (selected.length >= 6) {
      return selected.slice(0, 6);
    }
  }

  for (const article of fallbackArticles) {
    if (usedFingerprints.has(getArticleFingerprint(article)) || usedUrls.has(getArticleUrlFingerprint(article))) {
      continue;
    }

    selected.push(article);
    usedFingerprints.add(getArticleFingerprint(article));
    usedUrls.add(getArticleUrlFingerprint(article));

    if (selected.length >= 6) {
      break;
    }
  }

  return selected.slice(0, 6);
}

function formatClock(value: string | undefined) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeWeather(code: number | undefined) {
  switch (code) {
    case 0:
      return "Clear";
    case 1:
    case 2:
    case 3:
      return "Partly cloudy";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
    case 61:
    case 63:
    case 65:
      return "Rain";
    case 71:
    case 73:
    case 75:
      return "Snow";
    case 80:
    case 81:
    case 82:
      return "Showers";
    case 95:
    case 96:
    case 99:
      return "Storms";
    default:
      return "Mixed sky";
  }
}

function describeUv(uv: number | undefined) {
  if (uv === undefined || Number.isNaN(uv)) {
    return "Moderate";
  }

  if (uv < 3) {
    return "Low";
  }
  if (uv < 6) {
    return "Moderate";
  }
  if (uv < 8) {
    return "High";
  }
  if (uv < 11) {
    return "Very high";
  }
  return "Extreme";
}

function buildWeatherSummary(city: string, currentTemp: number, rainChance: number, wind: number, condition: string) {
  const rainRead =
    rainChance >= 50
      ? "Rain risk is high enough to plan around."
      : rainChance >= 25
        ? "There is a decent chance of precipitation later."
        : "Rain risk stays fairly low.";
  const windRead = wind >= 18 ? "Expect a real wind edge." : wind >= 10 ? "Light wind will stay in play." : "Wind stays manageable.";
  return `${city} is sitting near ${Math.round(currentTemp)}F with ${condition.toLowerCase()}. ${rainRead} ${windRead}`;
}

function fallbackWeather(cities: string[]): WeatherCity[] {
  return weatherCities.filter((item) => !cities.length || cities.includes(item.name));
}

async function geocodeCity(city: string) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const response = await fetch(url, { next: { revalidate: 86_400 } });
  if (!response.ok) {
    throw new Error(`Geocoding failed for ${city}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; timezone?: string }>;
  };
  return payload.results?.[0] ?? null;
}

async function fetchWeatherForCity(city: string) {
  const fallback = weatherCities.find((item) => item.name === city);
  const geo = await geocodeCity(city);
  if (!geo) {
    if (!fallback) {
      throw new Error(`No weather match for ${city}`);
    }
    return fallback;
  }

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation_probability,weather_code" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=5";

  const response = await fetch(forecastUrl, { next: { revalidate: 1_800 } });
  if (!response.ok) {
    throw new Error(`Forecast failed for ${city}`);
  }

  const payload = (await response.json()) as WeatherApiPayload;
  const current = payload.current ?? {};
  const hourlyTimes = payload.hourly?.time ?? [];
  const hourlyTemps = payload.hourly?.temperature_2m ?? [];
  const hourlyCodes = payload.hourly?.weather_code ?? [];
  const dailyTimes = payload.daily?.time ?? [];
  const dailyCodes = payload.daily?.weather_code ?? [];
  const dailyHighs = payload.daily?.temperature_2m_max ?? [];
  const dailyLows = payload.daily?.temperature_2m_min ?? [];
  const dailyRain = payload.daily?.precipitation_probability_max ?? [];

  const hourly = hourlyTimes.slice(0, 5).map((time, index) => {
    const date = new Date(time);
    return {
      time:
        index === 0
          ? "Now"
          : date.toLocaleTimeString("en-US", {
              hour: "numeric",
            }),
      tempF: Math.round(hourlyTemps[index] ?? current.temperature_2m ?? 0),
      label: describeWeather(hourlyCodes[index]),
    };
  });

  const daily = dailyTimes.slice(0, 5).map((time, index) => {
    const date = new Date(time);
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      highF: Math.round(dailyHighs[index] ?? current.temperature_2m ?? 0),
      lowF: Math.round(dailyLows[index] ?? current.temperature_2m ?? 0),
      label: describeWeather(dailyCodes[index]),
      rainChance: clamp(Math.round(dailyRain[index] ?? current.precipitation_probability ?? 0), 0, 100),
    };
  });

  const condition = describeWeather(current.weather_code);
  const temp = Math.round(current.temperature_2m ?? fallback?.tempF ?? 0);
  const feelsLike = Math.round(current.apparent_temperature ?? temp);
  const precipitationChance = clamp(Math.round(current.precipitation_probability ?? 0), 0, 100);
  const windMph = Math.round(current.wind_speed_10m ?? 0);

  return {
    name: geo.name,
    region: geo.admin1 ?? fallback?.region ?? "Live forecast",
    condition,
    summary: buildWeatherSummary(geo.name, temp, precipitationChance, windMph, condition),
    tempF: temp,
    feelsLikeF: feelsLike,
    humidity: clamp(Math.round(current.relative_humidity_2m ?? fallback?.humidity ?? 0), 0, 100),
    windMph,
    precipitationChance,
    uv: describeUv(payload.daily?.uv_index_max?.[0]),
    sunrise: formatClock(payload.daily?.sunrise?.[0]),
    sunset: formatClock(payload.daily?.sunset?.[0]),
    hourly: hourly.length ? hourly : fallback?.hourly ?? [],
    daily: daily.length ? daily : fallback?.daily ?? [],
  } satisfies WeatherCity;
}

type LiveNewsOptions = {
  forceRefresh?: boolean;
  localDate?: string;
  timeZone?: string;
};

export async function getLiveNews(
  categories: string[],
  query: string,
  options: LiveNewsOptions = {},
): Promise<LiveNewsResponse> {
  const normalizedCategories = categories.filter((item): item is NewsCategory =>
    newsTypes.includes(item as NewsCategory),
  );
  const broadBrief = !query.trim();
  const promptDate =
    typeof options.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.localDate)
      ? options.localDate
      : new Date().toISOString().slice(0, 10);
  const promptTimeZone = options.timeZone?.trim() || "UTC";
  const cacheKey =
    `news:${normalizedCategories.join(",")}:${query.trim().toLowerCase()}` +
    `:${promptDate}:${promptTimeZone}`;
  const factory = async (): Promise<LiveNewsResponse> => {
    const generatedAt = new Date().toISOString();
    if (!openAiClient) {
      return {
        mode: "fallback",
        generatedAt,
        warning: "OPENAI_API_KEY is missing, so Arfor is using the local fallback brief.",
        articles: fallbackNews(normalizedCategories, query),
      };
    }

    try {
      const response = await openAiClient.chat.completions.create({
        model: "gpt-4o-search-preview",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "arfor_live_news_brief",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                stories: {
                  type: "array",
                  maxItems: 10,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      category: {
                        type: "string",
                        enum: newsTypes,
                      },
                      headline: { type: "string" },
                      source: { type: "string" },
                      summary: { type: "string" },
                      url: { type: "string" },
                      publishedAt: { type: "string" },
                      keyPoints: {
                        type: "array",
                        minItems: 2,
                        maxItems: 3,
                        items: { type: "string" },
                      },
                      impact: { type: "string" },
                    },
                    required: ["category", "headline", "source", "summary", "url", "publishedAt", "keyPoints", "impact"],
                  },
                },
              },
              required: ["stories"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "Use live web search results only. Curate a trustworthy homepage brief from reputable newsrooms. Exclude Wikipedia, aggregators, press releases, investor relations pages, newsletters, sponsored posts, listicles, sports stories unless directly tied to the requested topic, and duplicate rewrites of the same event.",
          },
          {
            role: "user",
            content:
              `Reader local date is ${promptDate}.\n` +
              `Reader time zone is ${promptTimeZone}.\n` +
              `Find up to 10 current stories for these categories: ${normalizedCategories.join(", ") || "Markets"}.\n` +
              `User search term: ${query.trim() || "none"}.\n` +
              `Allowed category labels: ${newsTypes.join(", ")}.\n` +
              `Only use stories from these domains or their subdomains: ${trustedNewsDomains.join(", ")}.\n` +
              (broadBrief
                ? "Return a balanced homepage brief, with at least one strong story for each requested category when credible reporting exists and no more than two stories per category."
                : "Optimize for the user's search term even if the best matches cluster in one category.") +
              "\n" +
              "Every URL must be a direct article page. Never use a home page, section page, tag page, topic page, live blog index, search page, or listing page. Do not repeat a URL or the same event in slightly different wording. Prefer stories published in the last 96 hours; only go older for truly material world or policy developments. Keep summaries concise and factual.",
          },
        ],
      });

      const payload = parseJson<LiveNewsDraft>(response.choices[0]?.message?.content ?? "");
      const articles = refineNewsArticles(
        (payload?.stories ?? []).map((item, index) =>
          sanitizeArticle(
            {
              category: item.category as NewsCategory,
              headline: item.headline,
              source: item.source,
              summary: item.summary,
              url: item.url,
              publishedAt: item.publishedAt,
              keyPoints: item.keyPoints,
              impact: item.impact,
              readTime: "4 min read",
              mood: toMood((item.category as NewsCategory) || "Markets"),
            },
            index,
            normalizedCategories,
          ),
        ),
        normalizedCategories,
        query,
      );

      const fallbackArticles = fallbackNews(normalizedCategories, query);
      const minimumLiveStories = broadBrief ? 2 : 1;
      const useLiveArticles = articles.length >= minimumLiveStories;
      const finalArticles = useLiveArticles ? blendNewsArticles(articles, fallbackArticles) : fallbackArticles;
      const mixedWithFallback = useLiveArticles && finalArticles.length > articles.length;

      return {
        mode: useLiveArticles ? "live" : "fallback",
        generatedAt,
        warning:
          useLiveArticles
            ? mixedWithFallback
              ? "Live search returned only a few high-confidence stories, so Arfor filled the remaining slots with local fallback coverage."
              : undefined
            : "Live search did not return enough recent high-confidence reporting, so Arfor is using the fallback brief.",
        articles: finalArticles,
      };
    } catch (error) {
      return {
        mode: "fallback",
        generatedAt,
        warning:
          error instanceof Error
            ? error.message
            : "Live news search failed, so Arfor is using the local fallback brief.",
        articles: fallbackNews(normalizedCategories, query),
      };
    }
  };

  return options.forceRefresh ? factory() : withCache(cacheKey, 15 * minute, factory);
}

export async function getLiveMarkets(
  focusTicker: string,
  watchlistTickers: string[],
): Promise<LiveMarketsResponse> {
  const normalizedFocus = focusTicker.trim().toUpperCase() || "NVDA";
  const normalizedTickers = Array.from(
    new Set(
      watchlistTickers
        .map((item) => item.trim().toUpperCase())
        .filter((item) => /^[A-Z.\-]{1,10}$/.test(item)),
    ),
  ).slice(0, 8);
  const cacheKey = `markets:${normalizedFocus}:${normalizedTickers.join(",")}`;

  return withCache(cacheKey, 20 * minute, async () => {
    const generatedAt = new Date().toISOString();
    if (!openAiClient) {
      return {
        mode: "fallback",
        generatedAt,
        focusTicker: normalizedFocus,
        warning: "OPENAI_API_KEY is missing, so Arfor is using fallback market intelligence.",
        focusNews: newsTickerFeed[normalizedFocus] ?? newsTickerFeed.NVDA,
        quotes: [],
        suggestions: aiStockSuggestions,
      };
    }

    try {
      const response = await openAiClient.chat.completions.create({
        model: "gpt-4o-search-preview",
        messages: [
          {
            role: "system",
            content:
              "Use live web search results only. Return plain text only with no markdown. Do not invent prices, URLs, or tickers. Avoid Wikipedia and low-signal sources when higher-quality coverage exists.",
          },
          {
            role: "user",
            content:
              `Today's date is ${new Date().toISOString().slice(0, 10)}.\n` +
              `Focus ticker: ${normalizedFocus}. Watchlist: ${normalizedTickers.join(", ") || normalizedFocus}.\n` +
              "Return three sections exactly.\n" +
              "QUOTES:\nTICKER || COMPANY || PRICE || DAY_CHANGE_PERCENT\n" +
              "FOCUS_NEWS:\nHEADLINE || SOURCE || TONE || URL || PUBLISHED_AT\n" +
              "SUGGESTIONS:\nTICKER || COMPANY || RATING || THESIS || CATALYST || PRICE_REFERENCE\n" +
              "Provide 1 line per item under each section. Suggestions must not repeat any watchlist ticker.",
          },
        ],
      });

      const content = response.choices[0]?.message?.content ?? "";
      const quotes = parseDelimitedRows(getSection(content, "QUOTES:"))
        .map((parts) =>
          sanitizeQuote({
            ticker: parts[0],
            company: parts[1],
            price: toNumber(parts[2]),
            dayChange: toNumber(parts[3]),
          }),
        )
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const focusNews = parseDelimitedRows(getSection(content, "FOCUS_NEWS:"))
        .map((parts, index) =>
          sanitizeStockNews(
            {
              headline: parts[0],
              source: parts[1],
              tone: parts[2],
              url: parts[3],
              publishedAt: parts[4],
            },
            index,
            normalizedFocus,
          ),
        )
        .filter((item) => isTrustedNewsUrl(item.url) && isFreshNewsDate(item.publishedAt, "Markets", true))
        .slice(0, 4);

      const suggestions = parseDelimitedRows(getSection(content, "SUGGESTIONS:"))
        .filter((parts) => !normalizedTickers.includes(String(parts[0] ?? "").toUpperCase()))
        .map((parts, index) =>
          sanitizeSuggestion(
            {
              ticker: parts[0],
              company: parts[1],
              rating: parts[2],
              thesis: parts[3],
              catalyst: parts[4],
              priceReference: Number(parts[5]),
            },
            index,
          ),
        )
        .slice(0, 4);

      return {
        mode: quotes.length || focusNews.length || suggestions.length ? "live" : "fallback",
        generatedAt,
        focusTicker: normalizedFocus,
        quotes,
        focusNews: focusNews.length ? focusNews : newsTickerFeed[normalizedFocus] ?? newsTickerFeed.NVDA,
        suggestions: suggestions.length ? suggestions : aiStockSuggestions,
      };
    } catch (error) {
      return {
        mode: "fallback",
        generatedAt,
        focusTicker: normalizedFocus,
        warning:
          error instanceof Error
            ? error.message
            : "Live market intelligence failed, so Arfor is using fallback market intelligence.",
        focusNews: newsTickerFeed[normalizedFocus] ?? newsTickerFeed.NVDA,
        quotes: [],
        suggestions: aiStockSuggestions,
      };
    }
  });
}

export async function getLiveWeather(cities: string[]): Promise<LiveWeatherResponse> {
  const normalizedCities = Array.from(
    new Set(cities.map((item) => item.trim()).filter(Boolean)),
  ).slice(0, 8);
  const cacheKey = `weather:${normalizedCities.join(",")}`;

  return withCache(cacheKey, 30 * minute, async () => {
    const generatedAt = new Date().toISOString();

    try {
      const results = await Promise.all(normalizedCities.map((city) => fetchWeatherForCity(city)));
      return {
        mode: "live",
        generatedAt,
        cities: results,
      };
    } catch (error) {
      return {
        mode: "fallback",
        generatedAt,
        warning:
          error instanceof Error
            ? error.message
            : "Live weather fetch failed, so Arfor is using the local weather fallback.",
        cities: fallbackWeather(normalizedCities),
      };
    }
  });
}
