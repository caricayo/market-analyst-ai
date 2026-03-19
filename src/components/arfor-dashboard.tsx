"use client";

import { type ChangeEvent, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CloudSun,
  Compass,
  Download,
  ExternalLink,
  Gamepad2,
  Newspaper,
  RefreshCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { useDashboardLiveData } from "@/hooks/use-dashboard-live-data";
import { useLiveWeather } from "@/hooks/use-live-weather";
import {
  addMonths,
  formatCadence,
  formatDateTime,
  formatShortDate,
  formatTemp,
  getBillOccurrenceKey,
  getCalendarDays,
  getConflictCount,
  getStockSnapshot,
  getUpcomingBillOccurrences,
  getWeatherSnapshot,
  isoDate,
  seededNumber,
  startOfMonth,
  type DashboardBill,
  type DashboardEvent,
  type StockRange,
} from "@/lib/arfor-utils";
import {
  defaultBills,
  defaultEvents,
  defaultWatchlist,
  games,
  newsPanels,
  newsTickerFeed,
  newsTypes,
  weatherCities,
  type WatchlistItem,
} from "@/lib/mock-data";
import { cn, currency, percent } from "@/lib/utils";

type PersistedState = {
  version: number;
  filters: string[];
  newsSearch: string;
  savedOnly: boolean;
  savedArticles: string[];
  readArticles: string[];
  activeArticleId: string;
  events: DashboardEvent[];
  bills: DashboardBill[];
  paidBillCycles: string[];
  watchlist: WatchlistItem[];
  ticker: string;
  stockRange: StockRange;
  alertTargets: Record<string, number>;
  selectedCity: string;
  compareCity: string;
  selectedDay: string;
};

const storageKey = "arfor-local-state-v4";
const today = new Date();
const todayTimestamp = today.getTime();
const dayKey = isoDate(today);
const eventCategories = ["Work", "Finance", "Health", "Personal", "Travel"];
const billCadenceOptions = [1, 3, 12];
const starterEventIds = new Set(["evt-1", "evt-2", "evt-3"]);
const starterBillIds = new Set(["bill-1", "bill-2", "bill-3"]);

function buildHistoryFromPrice(basePrice: number, seed: string) {
  return Array.from({ length: 10 }, (_, index) => {
    const baseline = basePrice * (0.93 + index * 0.012);
    const drift = seededNumber(`${seed}-${index}`, -0.025, 0.025);
    return Number((baseline * (1 + drift)).toFixed(2));
  });
}

function migrateEvents(version: number | undefined, events: DashboardEvent[]) {
  if (version !== undefined && version >= 5) {
    return events;
  }

  const looksLikeStarterPack =
    events.length === starterEventIds.size && events.every((event) => starterEventIds.has(event.id));
  return looksLikeStarterPack ? defaultEvents : events;
}

function migrateBills(version: number | undefined, bills: DashboardBill[]) {
  if (version !== undefined && version >= 5) {
    return bills;
  }

  const looksLikeStarterPack =
    bills.length === starterBillIds.size && bills.every((bill) => starterBillIds.has(bill.id));
  return looksLikeStarterPack ? defaultBills : bills;
}

function normalizePersistedState(saved: Partial<PersistedState>) {
  return {
    filters: Array.isArray(saved.filters) ? saved.filters : ["Markets", "Tech", "World"],
    newsSearch: typeof saved.newsSearch === "string" ? saved.newsSearch : "",
    savedOnly: Boolean(saved.savedOnly),
    savedArticles: Array.isArray(saved.savedArticles) ? saved.savedArticles : [],
    readArticles: Array.isArray(saved.readArticles) ? saved.readArticles : [],
    activeArticleId:
      typeof saved.activeArticleId === "string" ? saved.activeArticleId : newsPanels[0].id,
    events: Array.isArray(saved.events)
      ? migrateEvents(saved.version, saved.events as DashboardEvent[])
      : defaultEvents,
    bills: Array.isArray(saved.bills)
      ? migrateBills(saved.version, saved.bills as DashboardBill[])
      : defaultBills,
    paidBillCycles: Array.isArray(saved.paidBillCycles) ? saved.paidBillCycles : [],
    watchlist:
      Array.isArray(saved.watchlist) && saved.watchlist.length ? saved.watchlist : defaultWatchlist,
    ticker: typeof saved.ticker === "string" ? saved.ticker : defaultWatchlist[0].ticker,
    stockRange:
      saved.stockRange === "1W" || saved.stockRange === "1M" || saved.stockRange === "3M"
        ? saved.stockRange
        : "1M",
    alertTargets:
      saved.alertTargets && typeof saved.alertTargets === "object" ? saved.alertTargets : {},
    selectedCity:
      typeof saved.selectedCity === "string" ? saved.selectedCity : weatherCities[0].name,
    compareCity:
      typeof saved.compareCity === "string" ? saved.compareCity : weatherCities[1].name,
    selectedDay:
      typeof saved.selectedDay === "string" ? saved.selectedDay : isoDate(new Date()),
  };
}

export function ArforDashboard() {
  const [pending, startTransition] = useTransition();
  const importInputRef = useRef<HTMLInputElement>(null);

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [filters, setFilters] = useState<string[]>(["Markets", "Tech", "World"]);
  const [newsSearch, setNewsSearch] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedArticles, setSavedArticles] = useState<string[]>([]);
  const [readArticles, setReadArticles] = useState<string[]>([]);
  const [activeArticleId, setActiveArticleId] = useState(newsPanels[0].id);
  const [events, setEvents] = useState<DashboardEvent[]>(defaultEvents);
  const [bills, setBills] = useState<DashboardBill[]>(defaultBills);
  const [paidBillCycles, setPaidBillCycles] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(defaultWatchlist);
  const [ticker, setTicker] = useState(defaultWatchlist[0].ticker);
  const [stockRange, setStockRange] = useState<StockRange>("1M");
  const [alertTargets, setAlertTargets] = useState<Record<string, number>>({});
  const [selectedCity, setSelectedCity] = useState(weatherCities[0].name);
  const [compareCity, setCompareCity] = useState(weatherCities[1].name);
  const [selectedDay, setSelectedDay] = useState(() => isoDate(new Date()));
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const [eventDraft, setEventDraft] = useState({
    title: "",
    date: isoDate(new Date()),
    time: "09:00",
    reminderMinutes: "30",
    category: "Work",
    notes: "",
  });
  const [billDraft, setBillDraft] = useState({
    name: "",
    amount: "120",
    dueDay: "5",
    cadence: "1",
    startsAt: isoDate(new Date()),
    account: "Checking",
    category: "Utilities",
    autopay: true,
  });
  const [stockDraft, setStockDraft] = useState({
    ticker: "",
    company: "",
    thesis: "",
    basePrice: "100",
  });
  const [alertDraft, setAlertDraft] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }

    try {
      const saved = JSON.parse(raw) as Partial<PersistedState>;
      const next = normalizePersistedState(saved);
      /* eslint-disable react-hooks/set-state-in-effect -- this effect restores a persisted dashboard snapshot from local storage. */
      setFilters(next.filters);
      setNewsSearch(next.newsSearch);
      setSavedOnly(next.savedOnly);
      setSavedArticles(next.savedArticles);
      setReadArticles(next.readArticles);
      setActiveArticleId(next.activeArticleId);
      setEvents(next.events);
      setBills(next.bills);
      setPaidBillCycles(next.paidBillCycles);
      setWatchlist(next.watchlist);
      setTicker(next.ticker);
      setStockRange(next.stockRange);
      setAlertTargets(next.alertTargets);
      setSelectedCity(next.selectedCity);
      setCompareCity(next.compareCity);
      setSelectedDay(next.selectedDay);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  const activeTicker = useDeferredValue(ticker);
  const deferredNewsSearch = useDeferredValue(newsSearch);
  const selectedWeatherCities = useMemo(() => [selectedCity, compareCity], [compareCity, selectedCity]);
  const normalizedQuery = deferredNewsSearch.trim().toLowerCase();
  const {
    liveNews,
    newsMode,
    newsLoading,
    newsWarning,
    newsGeneratedAt,
    refreshNews,
    marketQuotes,
    liveFocusNews,
    liveSuggestions,
    marketMode,
    marketLoading,
    marketWarning,
    marketGeneratedAt,
    refreshMarkets,
  } = useDashboardLiveData(filters, deferredNewsSearch.trim(), watchlist, activeTicker);
  const {
    weatherCities: liveWeatherCities,
    weatherMode,
    weatherLoading,
    weatherWarning,
    weatherGeneratedAt,
    refreshWeather,
  } = useLiveWeather(selectedWeatherCities);
  const newsFeed = liveNews.length ? liveNews : newsPanels;
  const filteredNews = useMemo(
    () =>
      newsFeed.filter((item) => {
        const matchesCategory = filters.includes(item.category);
        const matchesQuery =
          !normalizedQuery ||
          [item.headline, item.summary, item.source, item.mood, item.impact]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        const matchesSaved = !savedOnly || savedArticles.includes(item.id);
        return matchesCategory && matchesQuery && matchesSaved;
      }),
    [filters, newsFeed, normalizedQuery, savedArticles, savedOnly],
  );
  const resolvedActiveArticleId =
    newsFeed.find((item) => item.id === activeArticleId)?.id ??
    filteredNews[0]?.id ??
    newsFeed[0]?.id ??
    newsPanels[0].id;
  const effectiveReadArticles = useMemo(
    () =>
      readArticles.includes(resolvedActiveArticleId)
        ? readArticles
        : [...readArticles, resolvedActiveArticleId],
    [readArticles, resolvedActiveArticleId],
  );

  const activeArticle =
    newsFeed.find((item) => item.id === resolvedActiveArticleId) ??
    filteredNews[0] ??
    newsFeed[0] ??
    newsPanels[0];

  useEffect(() => {
    const payload: PersistedState = {
      version: 5,
      filters,
      newsSearch,
      savedOnly,
      savedArticles,
      readArticles: effectiveReadArticles,
      activeArticleId: resolvedActiveArticleId,
      events,
      bills,
      paidBillCycles,
      watchlist,
      ticker,
      stockRange,
      alertTargets,
      selectedCity,
      compareCity,
      selectedDay,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [
    alertTargets,
    bills,
    compareCity,
    effectiveReadArticles,
    events,
    filters,
    newsSearch,
    paidBillCycles,
    resolvedActiveArticleId,
    savedArticles,
    savedOnly,
    selectedCity,
    selectedDay,
    stockRange,
    ticker,
    watchlist,
  ]);

  const hydratedWatchlist = useMemo(
    () =>
      watchlist.map((item) => {
        const quote = marketQuotes.find((candidate) => candidate.ticker === item.ticker);
        const quoteLooksReasonable =
          quote &&
          quote.price > 0 &&
          quote.price >= item.price * 0.5 &&
          quote.price <= item.price * 1.5 &&
          Math.abs(quote.dayChange) <= 25;
        if (!quoteLooksReasonable || !quote) {
          return item;
        }

        return {
          ...item,
          company: quote.company ?? item.company,
          price: quote.price,
          dayChange: quote.dayChange,
          history: buildHistoryFromPrice(quote.price, item.ticker),
        };
      }),
    [marketQuotes, watchlist],
  );

  const stock = hydratedWatchlist.find((item) => item.ticker === activeTicker) ?? hydratedWatchlist[0];
  const stockSnapshot = useMemo(
    () => getStockSnapshot(stock, stockRange, dayKey),
    [stock, stockRange],
  );
  const stockNews = useMemo(() => {
    if (liveFocusNews.length) {
      return liveFocusNews;
    }

    const feed = newsTickerFeed[stock.ticker] ?? [];
    const offset = Math.round(seededNumber(`${stock.ticker}-${dayKey}-feed`, 0, 2));
    return [...feed.slice(offset), ...feed.slice(0, offset)].slice(0, 3);
  }, [liveFocusNews, stock]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the alert input mirrors the selected ticker's saved target. */
    setAlertDraft(alertTargets[stock.ticker] ? String(alertTargets[stock.ticker]) : "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [alertTargets, stock.ticker]);

  const calendarDays = useMemo(
    () => getCalendarDays(month, events, bills, paidBillCycles),
    [month, events, bills, paidBillCycles],
  );

  const selectedDayCell =
    calendarDays.find((day) => day.dateIso === selectedDay) ??
    calendarDays.find((day) => day.inMonth) ??
    calendarDays[0];

  const selectedDayBills = selectedDayCell.dueBills.map((bill) => {
    const dueDate = new Date(`${selectedDayCell.dateIso}T00:00:00`);
    const key = getBillOccurrenceKey(bill.id, dueDate);
    return {
      bill,
      dueDate,
      key,
      paid: paidBillCycles.includes(key),
    };
  });

  const selectedDayEvents = [...selectedDayCell.events].sort((left, right) =>
    left.time.localeCompare(right.time),
  );

  const upcomingEvents = useMemo(
    () =>
      [...events]
        .filter((event) => new Date(`${event.date}T${event.time}:00`).getTime() >= todayTimestamp - 86400000)
        .sort(
          (left, right) =>
            new Date(`${left.date}T${left.time}:00`).getTime() -
            new Date(`${right.date}T${right.time}:00`).getTime(),
        )
        .slice(0, 6),
    [events],
  );

  const billOccurrences = useMemo(
    () => getUpcomingBillOccurrences(bills, new Date(), paidBillCycles, 8),
    [bills, paidBillCycles],
  );

  const dueSoonCount = billOccurrences.filter((item) => item.status === "due-soon").length;
  const overdueCount = billOccurrences.filter((item) => item.status === "overdue").length;
  const monthlyOutflow = bills.reduce(
    (sum, bill) => sum + bill.amount / Math.max(bill.cadenceMonths, 1),
    0,
  );

  const weatherFeed = liveWeatherCities.length
    ? liveWeatherCities
    : weatherCities.filter((city) => [selectedCity, compareCity].includes(city.name));
  const selectedWeather =
    weatherFeed.find((city) => city.name === selectedCity) ??
    weatherCities.find((city) => city.name === selectedCity) ??
    weatherCities[0];
  const compareWeather =
    weatherFeed.find((city) => city.name === compareCity) ??
    weatherCities.find((city) => city.name === compareCity) ??
    weatherCities[1];
  const activeWeather = getWeatherSnapshot(selectedWeather, dayKey);
  const compareWeatherSnapshot = getWeatherSnapshot(compareWeather, dayKey);

  const articleStats = [
    { label: "Visible stories", value: filteredNews.length },
    { label: "Saved", value: savedArticles.length },
    { label: "Feed mode", value: newsMode === "live" ? "Live" : "Fallback" },
  ];

  const eventConflictCount = getConflictCount(events, eventDraft.date, eventDraft.time);
  const alertTarget = alertTargets[stock.ticker];
  const alertGap = alertTarget
    ? Number((((alertTarget - stockSnapshot.currentPrice) / alertTarget) * 100).toFixed(2))
    : null;

  const quickResetText = pending
    ? "Updating dashboard state..."
    : `Refreshed for ${today.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}. Local backup and restore are ready.`;

  function toggleArticleSaved(articleId: string) {
    startTransition(() =>
      setSavedArticles((current) =>
        current.includes(articleId)
          ? current.filter((value) => value !== articleId)
          : [...current, articleId],
      ),
    );
  }

  function addEvent() {
    if (!eventDraft.title.trim()) {
      return;
    }

    const nextEvent: DashboardEvent = {
      id: crypto.randomUUID(),
      title: eventDraft.title.trim(),
      date: eventDraft.date,
      time: eventDraft.time,
      reminderMinutes: Number(eventDraft.reminderMinutes),
      category: eventDraft.category,
      notes: eventDraft.notes.trim() || "No extra notes yet.",
    };

    startTransition(() => {
      setEvents((current) => [...current, nextEvent]);
      setSelectedDay(eventDraft.date);
      setEventDraft((current) => ({ ...current, title: "", notes: "" }));
    });
  }

  function addBill() {
    if (!billDraft.name.trim()) {
      return;
    }

    const nextBill: DashboardBill = {
      id: crypto.randomUUID(),
      name: billDraft.name.trim(),
      amount: Number(billDraft.amount),
      dueDay: Math.min(Math.max(Number(billDraft.dueDay), 1), 28),
      cadenceMonths: Number(billDraft.cadence),
      startsAt: billDraft.startsAt,
      autopay: billDraft.autopay,
      category: billDraft.category.trim(),
      account: billDraft.account.trim(),
    };

    startTransition(() => {
      setBills((current) => [...current, nextBill]);
      setBillDraft((current) => ({ ...current, name: "" }));
    });
  }

  function addCustomTicker() {
    const tickerValue = stockDraft.ticker.trim().toUpperCase();
    if (!tickerValue || !stockDraft.company.trim()) {
      return;
    }

    if (watchlist.some((item) => item.ticker === tickerValue)) {
      setTicker(tickerValue);
      return;
    }

    const basePrice = Math.max(Number(stockDraft.basePrice), 5);
    const nextStock: WatchlistItem = {
      ticker: tickerValue,
      company: stockDraft.company.trim(),
      price: basePrice,
      dayChange: 0,
      history: buildHistoryFromPrice(basePrice, tickerValue),
      thesis: stockDraft.thesis.trim() || "Custom watch item added for manual tracking.",
      rating: "Custom lane",
      sectors: ["Custom"],
      conviction: 70,
      userAdded: true,
    };

    startTransition(() => {
      setWatchlist((current) => [...current, nextStock]);
      setTicker(tickerValue);
      setStockDraft({ ticker: "", company: "", thesis: "", basePrice: "100" });
    });
  }

  function exportWorkspace() {
    const payload = window.localStorage.getItem(storageKey);
    if (!payload) {
      return;
    }

    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `arfor-backup-${dayKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setImportMessage("Workspace backup downloaded.");
  }

  function onImportWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const saved = JSON.parse(String(reader.result)) as Partial<PersistedState>;
        const next = normalizePersistedState(saved);
        setFilters(next.filters);
        setNewsSearch(next.newsSearch);
        setSavedOnly(next.savedOnly);
        setSavedArticles(next.savedArticles);
        setReadArticles(next.readArticles);
        setActiveArticleId(next.activeArticleId);
        setEvents(next.events);
        setBills(next.bills);
        setPaidBillCycles(next.paidBillCycles);
        setWatchlist(next.watchlist);
        setTicker(next.ticker);
        setStockRange(next.stockRange);
        setAlertTargets(next.alertTargets);
        setSelectedCity(next.selectedCity);
        setCompareCity(next.compareCity);
        setSelectedDay(next.selectedDay);
        setImportMessage("Workspace backup restored.");
      } catch {
        setImportMessage("That file was not a valid Arfor backup.");
      }
    };
    reader.readAsText(file);
  }

  function resetWorkspace() {
    window.localStorage.removeItem(storageKey);
    window.location.reload();
  }

  return (
    <ArforFrame
      activePath="/"
      eyebrow="Command Center"
      title="One place to read the day, plan the week, and keep the essentials moving."
      description="Arfor combines a live-or-local brief, planning, bills, markets, weather, and a small arcade inside a workspace that stays usable even when external services are unavailable."
    >
      <div className="grid gap-6 2xl:grid-cols-[1.24fr_0.96fr]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6">
          <GlassCard id="news" className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Newspaper className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Daily brief</h2>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sand)]">
                  Search, save, and revisit the stories that matter. When live search is
                  available, this board pulls current reporting. When it is not, Arfor falls back
                  to a clearly local operating brief instead of pretending stale content is live.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {articleStats.map((item) => (
                  <div key={item.label} className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">{item.label}</p>
                    <p className="mt-2 font-display text-2xl text-[var(--cream)]">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.25em] text-[var(--sand)]">
                {newsMode === "live" ? "Live web search" : "Fallback brief"}
              </span>
              {newsGeneratedAt ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[var(--muted)]">
                  Updated {new Date(newsGeneratedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              ) : null}
              <button
                type="button"
                onClick={refreshNews}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]"
              >
                <RefreshCcw className={cn("h-4 w-4", newsLoading && "animate-spin")} />
                Refresh feed
              </button>
              {newsWarning ? <p className="text-sm text-[var(--sand)]">{newsWarning}</p> : null}
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_220px]">
              <div className="flex flex-wrap gap-2">
                {newsTypes.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() =>
                      startTransition(() =>
                        setFilters((current) =>
                          current.includes(item)
                            ? current.filter((value) => value !== item)
                            : [...current, item],
                        ),
                      )
                    }
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm transition-colors",
                      filters.includes(item)
                        ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black"
                        : "border-white/10 bg-white/5 text-[var(--cream)]",
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
                <Search className="h-4 w-4 text-[var(--muted)]" />
                <input
                  value={newsSearch}
                  onChange={(event) => setNewsSearch(event.target.value)}
                  placeholder="Search stories"
                  aria-label="Search stories"
                  className="w-full bg-transparent text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSavedOnly((current) => !current)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm",
                  savedOnly
                    ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black"
                    : "border-white/10 bg-white/5 text-[var(--cream)]",
                )}
              >
                {savedOnly ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                Saved only
              </button>
              <p className="text-sm text-[var(--sand)]">
                {filteredNews.length
                  ? `${filteredNews.length} stories in view`
                  : "No stories match that filter mix"}
              </p>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
              <div className="grid gap-4">
                {filteredNews.length ? (
                  filteredNews.map((item, index) => {
                    const isActive = item.id === activeArticle.id;
                    const isSaved = savedArticles.includes(item.id);
                    const isRead = effectiveReadArticles.includes(item.id);
                    return (
                      <article
                        key={item.id}
                        className={cn(
                          "rounded-[28px] border p-5 transition-all",
                          isActive
                            ? "border-[var(--gold-soft)] bg-black/25"
                            : "border-white/8 bg-black/18",
                          index === 0 && "shadow-[0_0_0_1px_rgba(226,187,105,0.08)]",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                            {item.category} · {item.source}
                          </p>
                          <div className="flex items-center gap-2">
                            {item.publishedAt ? (
                              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--muted)]">
                                {new Date(item.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            ) : null}
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--sand)]">
                              {item.readTime}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleArticleSaved(item.id)}
                              aria-label={isSaved ? "Remove saved story" : "Save story"}
                              className="rounded-full border border-white/10 bg-white/5 p-2 text-[var(--cream)]"
                            >
                              {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveArticleId(item.id)}
                          className="mt-4 text-left"
                        >
                          <h3 className="font-display text-2xl text-[var(--cream)]">{item.headline}</h3>
                          <p className="mt-3 text-sm leading-6 text-[var(--sand)]">{item.summary}</p>
                        </button>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                            {item.mood}
                          </span>
                          {isRead ? (
                            <span className="rounded-full border border-[var(--gold-soft)] bg-[var(--gold-soft)] px-3 py-1 text-xs text-[var(--cream)]">
                              Read
                            </span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="rounded-[28px] border border-dashed border-white/10 bg-black/15 p-6 text-sm text-[var(--sand)]">
                    Try adding a category back or clearing the search term. Saved mode only shows
                    articles you have bookmarked.
                  </div>
                )}
              </div>

              <div className="rounded-[28px] border border-white/8 bg-black/18 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    Active story
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleArticleSaved(activeArticle.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]"
                  >
                    {savedArticles.includes(activeArticle.id) ? (
                      <BookmarkCheck className="h-4 w-4" />
                    ) : (
                      <Bookmark className="h-4 w-4" />
                    )}
                    {savedArticles.includes(activeArticle.id) ? "Saved" : "Save"}
                  </button>
                </div>
                <h3 className="mt-4 font-display text-3xl text-[var(--cream)]">{activeArticle.headline}</h3>
                <p className="mt-3 text-sm leading-6 text-[var(--sand)]">{activeArticle.summary}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {activeArticle.publishedAt ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-[var(--muted)]">
                      {new Date(activeArticle.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  ) : null}
                  {activeArticle.url ? (
                    <a
                      href={activeArticle.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]"
                    >
                      Read source
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
                <div className="mt-5 rounded-[24px] border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Key points</p>
                  <div className="mt-3 space-y-3">
                    {activeArticle.keyPoints.map((point) => (
                      <div key={point} className="flex gap-3 text-sm text-[var(--sand)]">
                        <span className="mt-1 h-2 w-2 rounded-full bg-[var(--gold)]" />
                        <p>{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 rounded-[24px] border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Why it matters</p>
                  <p className="mt-3 text-sm leading-6 text-[var(--sand)]">{activeArticle.impact}</p>
                </div>
              </div>
            </div>
          </GlassCard>
          <GlassCard id="stocks" className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Compass className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Markets</h2>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sand)]">
                  Your watchlist keeps local notes, alerts, and reference ranges. Live mode can
                  refresh quotes and ticker-specific headlines without replacing the rest of your
                  workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["1W", "1M", "3M"] as StockRange[]).map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setStockRange(range)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm",
                      range === stockRange
                        ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black"
                        : "border-white/10 bg-white/5 text-[var(--cream)]",
                    )}
                  >
                    {range}
                  </button>
                ))}
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--sand)]">
                  {marketMode === "live" ? "Live market brief" : "Fallback market brief"}
                </div>
                <button
                  type="button"
                  onClick={refreshMarkets}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]"
                >
                  <RefreshCcw className={cn("h-4 w-4", marketLoading && "animate-spin")} />
                  Refresh
                </button>
              </div>
            </div>
            {marketWarning ? (
              <p className="mt-3 text-sm text-[var(--sand)]">{marketWarning}</p>
            ) : marketGeneratedAt ? (
              <p className="mt-3 text-sm text-[var(--sand)]">
                Updated {new Date(marketGeneratedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
            ) : null}

            <div className="mt-5 grid gap-5 xl:grid-cols-[0.88fr_1.12fr]">
              <div className="grid gap-4">
                <div className="grid gap-3">
                  {hydratedWatchlist.map((item) => {
                    const snapshot = getStockSnapshot(item, stockRange, dayKey);
                    return (
                      <button
                        key={item.ticker}
                        type="button"
                        onClick={() => setTicker(item.ticker)}
                        className={cn(
                          "w-full rounded-[24px] border p-4 text-left transition-all",
                          ticker === item.ticker
                            ? "border-[var(--gold-soft)] bg-white/10"
                            : "border-white/8 bg-black/12",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display text-2xl text-[var(--cream)]">{item.ticker}</p>
                            <p className="text-sm text-[var(--sand)]">{item.company}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold text-[var(--cream)]">
                              {currency(snapshot.currentPrice)}
                            </p>
                            <p
                              className={cn(
                                "text-sm",
                                snapshot.dayChange >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]",
                              )}
                            >
                              {percent(snapshot.dayChange)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.sectors.map((sector) => (
                            <span key={sector} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--muted)]">
                              {sector}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add custom ticker</p>
                    <span className="text-xs text-[var(--sand)]">Manual lane</span>
                  </div>
                  <div className="mt-3 grid gap-3">
                    <input
                      value={stockDraft.ticker}
                      onChange={(event) =>
                        setStockDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))
                      }
                      placeholder="Ticker"
                      aria-label="Custom ticker symbol"
                      className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]"
                    />
                    <input
                      value={stockDraft.company}
                      onChange={(event) =>
                        setStockDraft((current) => ({ ...current, company: event.target.value }))
                      }
                      placeholder="Company"
                      aria-label="Custom ticker company"
                      className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]"
                    />
                    <input
                      value={stockDraft.basePrice}
                      type="number"
                      onChange={(event) =>
                        setStockDraft((current) => ({ ...current, basePrice: event.target.value }))
                      }
                      placeholder="Base price"
                      aria-label="Custom ticker base price"
                      className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]"
                    />
                    <textarea
                      value={stockDraft.thesis}
                      onChange={(event) =>
                        setStockDraft((current) => ({ ...current, thesis: event.target.value }))
                      }
                      placeholder="Why are you watching it?"
                      aria-label="Custom ticker thesis"
                      rows={3}
                      className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]"
                    />
                    <button
                      type="button"
                      onClick={addCustomTicker}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black"
                    >
                      <CirclePlus className="h-4 w-4" />
                      Add to watchlist
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[28px] border border-white/8 bg-black/18 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="font-display text-4xl text-[var(--cream)]">{stock.ticker}</h3>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                          {stock.rating}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--sand)]">{stock.company}</p>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sand)]">{stock.thesis}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-4xl font-semibold text-[var(--cream)]">
                        {currency(stockSnapshot.currentPrice)}
                      </p>
                      <p
                        className={cn(
                          "mt-2 text-sm",
                          stockSnapshot.dayChange >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]",
                        )}
                      >
                        {percent(stockSnapshot.dayChange)}
                      </p>
                      <p className="mt-2 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                        Conviction {stock.conviction}/100
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex h-36 items-end gap-2 rounded-[24px] bg-white/5 px-4 pb-4 pt-8">
                    {stockSnapshot.history.map((point, index, history) => {
                      const min = Math.min(...history);
                      const max = Math.max(...history);
                      return (
                        <div
                          key={`${stock.ticker}-${stockRange}-${index}`}
                          className="w-full rounded-full bg-[var(--gold)]/80"
                          style={{ height: ((point - min) / Math.max(max - min, 1)) * 82 + 18 }}
                        />
                      );
                    })}
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Alert target</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input
                          value={alertDraft}
                          type="number"
                          onChange={(event) => setAlertDraft(event.target.value)}
                          placeholder="Set price target"
                          aria-label="Set stock alert target"
                          className="min-w-[180px] flex-1 rounded-full border border-white/8 bg-black/15 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setAlertTargets((current) => ({
                              ...current,
                              [stock.ticker]: Number(alertDraft),
                            }))
                          }
                          className="rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-black"
                        >
                          Save alert
                        </button>
                        {alertTarget ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAlertTargets((current) => {
                                const next = { ...current };
                                delete next[stock.ticker];
                                return next;
                              })
                            }
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]"
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm text-[var(--sand)]">
                        {alertTarget
                          ? alertGap !== null && alertGap <= 0
                            ? `Target hit. ${stock.ticker} is through ${currency(alertTarget)}.`
                            : alertGap !== null && alertGap < 3
                              ? `${stock.ticker} is within ${Math.abs(alertGap).toFixed(2)}% of the target.`
                              : `${stock.ticker} is working toward ${currency(alertTarget)}.`
                          : "No price alert saved yet."}
                      </p>
                    </div>

                    <div className="rounded-[22px] border border-white/8 bg-white/5 p-4 sm:w-[180px]">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Actions</p>
                      <div className="mt-3 grid gap-2">
                        {stock.userAdded ? (
                          <button
                            type="button"
                            onClick={() =>
                              startTransition(() => {
                                setWatchlist((current) =>
                                  current.filter((item) => item.ticker !== stock.ticker),
                                );
                                const fallback = watchlist.find((item) => item.ticker !== stock.ticker);
                                if (fallback) {
                                  setTicker(fallback.ticker);
                                }
                              })
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </button>
                        ) : null}
                        <a
                          href={`https://www.google.com/finance/quote/${stock.ticker}:NASDAQ`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]"
                        >
                          Research
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1fr_0.95fr]">
                  <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Ticker news</p>
                    <div className="mt-4 grid gap-3">
                      {stockNews.map((item) => (
                        <div key={item.headline} className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                          <p className="text-sm font-semibold text-[var(--cream)]">{item.headline}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.source}</span>
                            {item.publishedAt ? (
                              <span className="text-xs text-[var(--muted)]">
                                {new Date(item.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            ) : null}
                            <span className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--sand)]">
                              {item.tone}
                            </span>
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[var(--cream)]"
                              >
                                Source
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">New names to look at</p>
                    <div className="mt-4 grid gap-3">
                      {liveSuggestions.map((item) => (
                        <button
                          key={item.ticker}
                          type="button"
                          onClick={() =>
                            !watchlist.some((stockItem) => stockItem.ticker === item.ticker) &&
                            startTransition(() =>
                              setWatchlist((current) => [
                                ...current,
                                {
                                  ticker: item.ticker,
                                  company: item.company,
                                  price: item.seedHistory.at(-1) ?? item.seedHistory[0],
                                  dayChange:
                                    (((item.seedHistory.at(-1) ?? item.seedHistory[0]) -
                                      item.seedHistory[0]) /
                                      item.seedHistory[0]) *
                                    100,
                                  history: item.seedHistory,
                                  thesis: item.thesis,
                                  rating: item.rating,
                                  sectors: ["Opportunity"],
                                  conviction: 76,
                                },
                              ]),
                            )
                          }
                          className="rounded-[18px] border border-white/8 bg-white/5 p-4 text-left"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-display text-2xl text-[var(--cream)]">{item.ticker}</p>
                            <span className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs text-[var(--muted)]">
                              {item.rating}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--sand)]">{item.catalyst}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard id="weather" className="p-5 sm:p-6">
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div>
                <div className="flex items-center gap-3">
                  <CloudSun className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Weather</h2>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sand)]">
                  Choose a home city, compare it against another, and pull the current forecast
                  from live weather data instead of the static seed board when the API is available.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.25em] text-[var(--sand)]">
                    {weatherMode === "live" ? "Live forecast" : "Fallback forecast"}
                  </span>
                  <button
                    type="button"
                    onClick={refreshWeather}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]"
                  >
                    <RefreshCcw className={cn("h-4 w-4", weatherLoading && "animate-spin")} />
                    Refresh weather
                  </button>
                  {weatherGeneratedAt ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[var(--muted)]">
                      Updated {new Date(weatherGeneratedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  ) : null}
                  {weatherWarning ? <p className="text-sm text-[var(--sand)]">{weatherWarning}</p> : null}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <select
                    value={selectedCity}
                    onChange={(event) => setSelectedCity(event.target.value)}
                    aria-label="Primary weather city"
                    className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none"
                  >
                    {weatherCities.map((city) => (
                      <option key={city.name} value={city.name}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={compareCity}
                    onChange={(event) => setCompareCity(event.target.value)}
                    aria-label="Comparison weather city"
                    className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none"
                  >
                    {weatherCities.map((city) => (
                      <option key={city.name} value={city.name}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-[26px] border border-white/8 bg-black/15 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                          {activeWeather.name}, {activeWeather.region}
                        </p>
                        <h3 className="mt-3 font-display text-4xl text-[var(--cream)]">
                          {formatTemp(activeWeather.tempF)}
                        </h3>
                        <p className="mt-2 text-sm text-[var(--sand)]">{activeWeather.condition}</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                        {activeWeather.uv} UV
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-[var(--sand)]">{activeWeather.summary}</p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Feels like</p>
                        <p className="mt-2 text-2xl font-semibold text-[var(--cream)]">{formatTemp(activeWeather.feelsLikeF)}</p>
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Rain chance</p>
                        <p className="mt-2 text-2xl font-semibold text-[var(--cream)]">{activeWeather.precipitationChance}%</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeWeather.hourly.slice(0, 4).map((hour) => (
                        <div key={hour.time} className="rounded-full border border-white/8 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]">
                          {hour.time} · {formatTemp(hour.tempF)}
                        </div>
                      ))}
                    </div>
                    <Link href="/weather" className="mt-5 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">
                      Open weather page
                    </Link>
                  </div>

                  <div className="rounded-[26px] border border-white/8 bg-black/15 p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Compare city</p>
                    <h3 className="mt-3 font-display text-3xl text-[var(--cream)]">
                      {compareWeatherSnapshot.name}
                    </h3>
                    <p className="mt-2 text-sm text-[var(--sand)]">{compareWeatherSnapshot.condition}</p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Now</p>
                        <p className="mt-2 text-2xl font-semibold text-[var(--cream)]">{formatTemp(compareWeatherSnapshot.tempF)}</p>
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Wind</p>
                        <p className="mt-2 text-2xl font-semibold text-[var(--cream)]">{compareWeatherSnapshot.windMph} mph</p>
                      </div>
                    </div>
                    <div className="mt-5 rounded-[20px] border border-white/8 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Travel read</p>
                      <p className="mt-3 text-sm leading-6 text-[var(--sand)]">
                        {activeWeather.tempF > compareWeatherSnapshot.tempF
                          ? `${compareWeatherSnapshot.name} runs cooler than ${activeWeather.name} today, so pack a layer.`
                          : `${compareWeatherSnapshot.name} is warmer than ${activeWeather.name}, so lighter clothing should hold.`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-3">
                  <Gamepad2 className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Games</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--sand)]">
                  The arcade stays compact on purpose: quick sessions, visible controls, and play
                  routes that feel native to the product instead of tacked onto it.
                </p>
                <div className="mt-4 grid gap-3">
                  {games.map((game) => (
                    <div key={game.slug} className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-display text-2xl text-[var(--cream)]">{game.name}</p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                          {game.license}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--sand)]">{game.tagline}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/games/${game.slug}`}
                          className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]"
                        >
                          Launch {game.name}
                        </Link>
                        <a
                          href={game.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]"
                        >
                          Source
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
                <Link href="/games" className="mt-5 inline-flex rounded-full border border-white/10 bg-[var(--cream)] px-4 py-3 text-sm font-semibold text-black">
                  Open games page
                </Link>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid gap-6">
          <GlassCard id="planner" className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <CalendarClock className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Planner</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--sand)]">
                  Click any day to inspect events and due bills, add reminders with notes, and keep
                  conflict-prone slots visible before they become messy.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMonth((current) => addMonths(current, -1))}
                  aria-label="Previous month"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMonth(startOfMonth(new Date()));
                    setSelectedDay(isoDate(new Date()));
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setMonth((current) => addMonths(current, 1))}
                  aria-label="Next month"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]">
                {month.toLocaleString("en-US", { month: "long", year: "numeric" })}
              </div>
              <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]">
                {events.length} events tracked
              </div>
              <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]">
                {bills.length} recurring bills
              </div>
            </div>

            <div className="mt-4 overflow-x-auto pb-2">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-7 gap-2 text-center text-[11px] uppercase tracking-[0.25em] text-[var(--muted)]">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                    <div key={day}>{day}</div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-7 gap-2">
                  {calendarDays.map((day) => (
                    <button
                      key={day.dateIso}
                      type="button"
                      onClick={() => setSelectedDay(day.dateIso)}
                      className={cn(
                        "min-h-24 rounded-[20px] border p-2 text-left transition-all",
                        day.inMonth ? "border-white/8 bg-black/12" : "border-white/6 bg-white/3",
                        day.dateIso === selectedDay && "border-[var(--gold-soft)] bg-white/10",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn("text-sm", day.inMonth ? "text-[var(--cream)]" : "text-[var(--muted)]")}>
                          {day.date.getDate()}
                        </span>
                        {day.dueBills.length ? (
                          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]">
                            {day.paidCount === day.dueBills.length ? "paid" : "bill"}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 space-y-1">
                        {day.events.slice(0, 2).map((event) => (
                          <div key={event.id} className="rounded-full bg-white/7 px-2 py-1 text-[10px] text-[var(--sand)]">
                            {event.time} {event.title}
                          </div>
                        ))}
                        {day.dueBills.slice(0, 1).map((bill) => (
                          <div key={bill.id} className="rounded-full bg-[var(--gold-soft)] px-2 py-1 text-[10px] text-[var(--cream)]">
                            {bill.name}
                          </div>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.96fr]">
              <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Selected day</p>
                    <h3 className="mt-2 font-display text-2xl text-[var(--cream)]">
                      {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </h3>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    {selectedDayEvents.length + selectedDayBills.length} items
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {selectedDayEvents.map((event) => (
                    <div key={event.id} className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--cream)]">{event.title}</p>
                          <p className="mt-1 text-sm text-[var(--sand)]">
                            {event.time} · {event.category} · remind {event.reminderMinutes} min before
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setEvents((current) => current.filter((item) => item.id !== event.id))
                          }
                          className="rounded-full border border-white/10 bg-black/15 p-2 text-[var(--cream)]"
                          aria-label={`Delete ${event.title}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--sand)]">{event.notes}</p>
                    </div>
                  ))}

                  {selectedDayBills.map(({ bill, key, paid }) => (
                    <div key={key} className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--cream)]">{bill.name}</p>
                          <p className="mt-1 text-sm text-[var(--sand)]">
                            {currency(bill.amount)} · {bill.account} · {bill.autopay ? "Autopay" : "Manual"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setPaidBillCycles((current) =>
                              current.includes(key)
                                ? current.filter((item) => item !== key)
                                : [...current, key],
                            )
                          }
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm",
                            paid
                              ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black"
                              : "border-white/10 bg-black/15 text-[var(--cream)]",
                          )}
                        >
                          {paid ? "Paid" : "Mark paid"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {!selectedDayEvents.length && !selectedDayBills.length ? (
                    <div className="rounded-[18px] border border-dashed border-white/10 bg-black/15 p-4 text-sm text-[var(--sand)]">
                      Nothing is on this day yet. Add an event below or move to another date.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add event</p>
                <div className="mt-3 grid gap-3">
                  <input value={eventDraft.title} onChange={(event) => setEventDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Event title" aria-label="Event title" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={eventDraft.date} type="date" onChange={(event) => setEventDraft((current) => ({ ...current, date: event.target.value }))} aria-label="Event date" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                    <input value={eventDraft.time} type="time" onChange={(event) => setEventDraft((current) => ({ ...current, time: event.target.value }))} aria-label="Event time" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select value={eventDraft.category} onChange={(event) => setEventDraft((current) => ({ ...current, category: event.target.value }))} aria-label="Event category" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none">
                      {eventCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                    <select value={eventDraft.reminderMinutes} onChange={(event) => setEventDraft((current) => ({ ...current, reminderMinutes: event.target.value }))} aria-label="Event reminder" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none">
                      {[10, 15, 30, 60, 120].map((minutes) => (
                        <option key={minutes} value={String(minutes)}>
                          {minutes} min reminder
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea value={eventDraft.notes} rows={4} onChange={(event) => setEventDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes or prep details" aria-label="Event notes" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" />
                  <p className="text-sm text-[var(--sand)]">
                    {eventConflictCount
                      ? `Warning: ${eventConflictCount} event${eventConflictCount > 1 ? "s already" : " already"} exist at this time.`
                      : "No conflict on this slot yet."}
                  </p>
                  <button type="button" onClick={addEvent} className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black">
                    <CirclePlus className="h-4 w-4" />
                    Add event
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/8 bg-black/15 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Upcoming agenda</p>
              <div className="mt-4 grid gap-3">
                {upcomingEvents.length ? (
                  upcomingEvents.map((event) => (
                    <div key={event.id} className="flex items-start justify-between gap-3 rounded-[18px] border border-white/8 bg-white/5 p-4">
                      <div>
                        <p className="font-semibold text-[var(--cream)]">{event.title}</p>
                        <p className="mt-1 text-sm text-[var(--sand)]">{formatDateTime(event.date, event.time)}</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                        {event.category}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-[var(--sand)]">
                    No upcoming events yet. Add one above to start building the week.
                  </div>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <WalletCards className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Bills</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--sand)]">
                  Track recurring bills with due windows, payment status, account labels, and
                  cadence beyond a simple monthly list.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Monthly load</p>
                  <p className="mt-2 font-display text-2xl text-[var(--cream)]">{currency(monthlyOutflow)}</p>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Due soon</p>
                  <p className="mt-2 font-display text-2xl text-[var(--cream)]">{dueSoonCount}</p>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Overdue</p>
                  <p className="mt-2 font-display text-2xl text-[var(--cream)]">{overdueCount}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {billOccurrences.length ? (
                billOccurrences.map((item) => (
                <div key={item.key} className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-2xl text-[var(--cream)]">{item.bill.name}</p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          {formatCadence(item.bill.cadenceMonths)}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          {item.bill.account}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--sand)]">
                        {currency(item.bill.amount)} · due {formatShortDate(item.dueDate)} · {item.bill.autopay ? "Autopay" : "Manual"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn("rounded-full border px-3 py-2 text-xs uppercase tracking-[0.25em]", item.status === "paid" ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black" : item.status === "overdue" ? "border-[var(--danger)]/40 bg-[var(--danger)]/12 text-[var(--danger)]" : item.status === "due-soon" ? "border-[var(--gold-soft)] bg-[var(--gold-soft)] text-[var(--cream)]" : "border-white/10 bg-white/5 text-[var(--muted)]")}>
                        {item.status === "due-soon" ? "Due soon" : item.status}
                      </span>
                      <button type="button" onClick={() => setPaidBillCycles((current) => current.includes(item.key) ? current.filter((value) => value !== item.key) : [...current, item.key])} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)]">
                        {item.paid ? "Mark unpaid" : "Mark paid"}
                      </button>
                    </div>
                  </div>
                </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/15 p-4 text-sm text-[var(--sand)]">
                  No recurring bills yet. Add the first one below and Arfor will build the next due windows automatically.
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.98fr]">
              <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Recurring bills</p>
                <div className="mt-4 grid gap-3">
                  {bills.length ? (
                    bills.map((bill) => (
                    <div key={bill.id} className="rounded-[18px] border border-white/8 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--cream)]">{bill.name}</p>
                          <p className="mt-1 text-sm text-[var(--sand)]">
                            {currency(bill.amount)} · {bill.category} · {formatCadence(bill.cadenceMonths)}
                          </p>
                        </div>
                        <button type="button" onClick={() => setBills((current) => current.filter((item) => item.id !== bill.id))} className="rounded-full border border-white/10 bg-black/15 p-2 text-[var(--cream)]" aria-label={`Delete ${bill.name}`}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <button type="button" onClick={() => setBills((current) => current.map((item) => item.id === bill.id ? { ...item, autopay: !item.autopay } : item))} className="mt-3 rounded-full border border-white/10 bg-black/15 px-3 py-2 text-sm text-[var(--cream)]">
                        {bill.autopay ? "Autopay on" : "Autopay off"}
                      </button>
                    </div>
                    ))
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-[var(--sand)]">
                      Your recurring bill list is empty. Start with rent, subscriptions, or any fixed payment you track every month.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add bill</p>
                <div className="mt-3 grid gap-3">
                  <input value={billDraft.name} onChange={(event) => setBillDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Bill name" aria-label="Bill name" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={billDraft.amount} type="number" onChange={(event) => setBillDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="Amount" aria-label="Bill amount" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                    <input value={billDraft.dueDay} type="number" min="1" max="28" onChange={(event) => setBillDraft((current) => ({ ...current, dueDay: event.target.value }))} placeholder="Due day" aria-label="Bill due day" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select value={billDraft.cadence} onChange={(event) => setBillDraft((current) => ({ ...current, cadence: event.target.value }))} aria-label="Bill cadence" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none">
                      {billCadenceOptions.map((months) => (
                        <option key={months} value={String(months)}>
                          {formatCadence(months)}
                        </option>
                      ))}
                    </select>
                    <input value={billDraft.startsAt} type="date" onChange={(event) => setBillDraft((current) => ({ ...current, startsAt: event.target.value }))} aria-label="Bill start date" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={billDraft.account} onChange={(event) => setBillDraft((current) => ({ ...current, account: event.target.value }))} placeholder="Account" aria-label="Bill account" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                    <input value={billDraft.category} onChange={(event) => setBillDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Category" aria-label="Bill category" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                  </div>
                  <label className="inline-flex items-center gap-3 rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">
                    <input type="checkbox" checked={billDraft.autopay} onChange={(event) => setBillDraft((current) => ({ ...current, autopay: event.target.checked }))} />
                    Autopay enabled
                  </label>
                  <button type="button" onClick={addBill} className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black">
                    <CirclePlus className="h-4 w-4" />
                    Add bill
                  </button>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Sparkles className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Workspace</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--sand)]">
                  Keep the workspace portable. Export a local backup, restore it later, or clear
                  the stored dashboard state without touching the project files.
                </p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--sand)]">
                {quickResetText}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <button type="button" onClick={exportWorkspace} className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-white/10 bg-white/5 px-5 py-4 text-sm text-[var(--cream)]">
                <Download className="h-4 w-4" />
                Export backup
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-white/10 bg-white/5 px-5 py-4 text-sm text-[var(--cream)]">
                <Upload className="h-4 w-4" />
                Import backup
              </button>
              <button type="button" onClick={resetWorkspace} className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-white/10 bg-white/5 px-5 py-4 text-sm text-[var(--cream)]">
                <RefreshCcw className="h-4 w-4" />
                Reset workspace
              </button>
            </div>

            <input ref={importInputRef} type="file" accept="application/json" onChange={onImportWorkspace} className="hidden" />

            {importMessage ? (
              <div className="mt-4 rounded-[22px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--sand)]">
                {importMessage}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/login" className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">
                Account
              </Link>
              <Link href="/weather" className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">
                Weather
              </Link>
              <Link href="/games" className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">
                Games
              </Link>
            </div>
          </GlassCard>
        </motion.div>
      </div>

      <nav className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 gap-2 rounded-full border border-white/10 bg-[rgba(12,12,14,0.86)] px-3 py-2 backdrop-blur md:hidden">
        {[
          { href: "#news", label: "News" },
          { href: "#stocks", label: "Markets" },
          { href: "#planner", label: "Plan" },
          { href: "#weather", label: "More" },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="rounded-full px-3 py-2 text-sm text-[var(--cream)]">
            {item.label}
          </Link>
        ))}
      </nav>
    </ArforFrame>
  );
}
