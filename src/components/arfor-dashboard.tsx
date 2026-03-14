"use client";

import { useDeferredValue, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  CalendarClock,
  CirclePlus,
  CloudSun,
  Compass,
  Gamepad2,
  Newspaper,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import {
  aiStockSuggestions,
  defaultBills,
  defaultEvents,
  defaultWatchlist,
  games,
  newsPanels,
  newsTickerFeed,
  newsTypes,
  weatherCities,
} from "@/lib/mock-data";
import { cn, currency, percent } from "@/lib/utils";

type EventItem = (typeof defaultEvents)[number];
type BillItem = (typeof defaultBills)[number];

const storageKey = "arfor-local-state";
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth() + count, 1);
const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
const formatShortDate = (value: string | Date) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    typeof value === "string" ? new Date(`${value}T00:00:00`) : value,
  );

function getBillDate(bill: BillItem, month: Date) {
  const start = startOfMonth(new Date(`${bill.startsAt}T00:00:00`));
  const diff = (month.getFullYear() - start.getFullYear()) * 12 + month.getMonth() - start.getMonth();

  if (diff < 0 || diff % bill.cadenceMonths !== 0) {
    return null;
  }

  return new Date(
    month.getFullYear(),
    month.getMonth(),
    Math.min(bill.dueDay, new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()),
  );
}

export function ArforDashboard() {
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [filters, setFilters] = useState<string[]>(["Markets", "Tech", "World"]);
  const [events, setEvents] = useState(defaultEvents);
  const [bills, setBills] = useState(defaultBills);
  const [watchlist, setWatchlist] = useState(defaultWatchlist);
  const [ticker, setTicker] = useState(defaultWatchlist[0].ticker);
  const [eventDraft, setEventDraft] = useState({
    title: "",
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
  });
  const [billDraft, setBillDraft] = useState({
    name: "",
    amount: "120",
    dueDay: "5",
    cadence: "1",
  });

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;

    const saved = JSON.parse(raw) as {
      filters?: string[];
      events?: EventItem[];
      bills?: BillItem[];
      watchlist?: typeof defaultWatchlist;
      ticker?: string;
    };

    if (saved.filters?.length) setFilters(saved.filters);
    if (saved.events?.length) setEvents(saved.events);
    if (saved.bills?.length) setBills(saved.bills);
    if (saved.watchlist?.length) setWatchlist(saved.watchlist);
    if (saved.ticker) setTicker(saved.ticker);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ filters, events, bills, watchlist, ticker }),
    );
  }, [filters, events, bills, watchlist, ticker]);

  const activeTicker = useDeferredValue(ticker);
  const stock = watchlist.find((item) => item.ticker === activeTicker) ?? watchlist[0];
  const filteredNews = newsPanels.filter((item) => filters.includes(item.category));
  const weather = weatherCities[0];
  const calendarDays = Array.from({ length: 35 }, (_, index) => {
    const leading = (month.getDay() + 6) % 7;
    const date = new Date(month.getFullYear(), month.getMonth(), index - leading + 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    return {
      date,
      inMonth: date.getMonth() === month.getMonth(),
      events: events.filter((event) => event.date === iso),
      hasBill: bills.some((bill) => {
        const due = getBillDate(bill, startOfMonth(date));
        return due ? sameDay(due, date) : false;
      }),
    };
  });

  const quickStats = [
    { label: "Active news", value: `${filteredNews.length} panels` },
    { label: "Tracked stocks", value: `${watchlist.length}` },
    { label: "Upcoming bills", value: `${bills.length}` },
  ];

  return (
    <ArforFrame
      activePath="/"
      eyebrow="Daily Brief"
      title="A calm, cinematic command center for the way your day actually moves."
      description="Arfor combines daily news, planning, perpetual bills, stocks, weather, and a game room in one dark-first glass system."
    >
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.95fr]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6">
          <GlassCard id="news" className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Newspaper className="h-5 w-5 text-[var(--gold)]" />
                <h2 className="font-display text-3xl text-[var(--cream)]">Daily brief</h2>
              </div>
              <p className="text-sm text-[var(--sand)]">Editorial grid</p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
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
                    "rounded-full border px-4 py-2 text-sm",
                    filters.includes(item)
                      ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black"
                      : "border-white/10 bg-white/5 text-[var(--cream)]",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {quickStats.map((item) => (
                <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.label}</p>
                  <p className="mt-2 font-display text-2xl text-[var(--cream)]">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {filteredNews.map((item, index) => (
                <article
                  key={item.headline}
                  className={cn(
                    "rounded-[28px] border border-white/8 bg-black/18 p-5",
                    index === 0 && "md:col-span-2 md:grid md:grid-cols-[1.05fr_0.95fr] md:gap-5",
                  )}
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                      {item.category} · {item.source}
                    </p>
                    <h3 className={cn("mt-3 font-display text-[var(--cream)]", index === 0 ? "text-3xl" : "text-2xl")}>
                      {item.headline}
                    </h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--sand)] md:mt-0">{item.summary}</p>
                </article>
              ))}
            </div>
          </GlassCard>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <GlassCard id="stocks" className="p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <Compass className="h-5 w-5 text-[var(--gold)]" />
                <h2 className="font-display text-3xl text-[var(--cream)]">Stocks</h2>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="space-y-3">
                  {watchlist.map((item) => (
                    <button
                      key={item.ticker}
                      type="button"
                      onClick={() => setTicker(item.ticker)}
                      className={cn(
                        "w-full rounded-[24px] border p-4 text-left",
                        ticker === item.ticker
                          ? "border-[var(--gold-soft)] bg-white/10"
                          : "border-white/8 bg-black/12",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-display text-xl text-[var(--cream)]">{item.ticker}</p>
                          <p className="text-sm text-[var(--sand)]">{item.company}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-[var(--cream)]">{currency(item.price)}</p>
                          <p className={cn("text-sm", item.dayChange >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]")}>
                            {percent(item.dayChange)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="rounded-[28px] border border-white/8 bg-black/18 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-3xl text-[var(--cream)]">{stock.ticker}</h3>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                      {stock.rating}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--sand)]">{stock.thesis}</p>
                  <div className="mt-5 flex h-32 items-end gap-2 rounded-[24px] bg-white/5 px-4 pb-4 pt-8">
                    {stock.history.map((point, index, history) => {
                      const min = Math.min(...history);
                      const max = Math.max(...history);
                      return (
                        <div
                          key={`${stock.ticker}-${index}`}
                          className="w-full rounded-full bg-[var(--gold)]/80"
                          style={{ height: ((point - min) / (max - min || 1)) * 72 + 18 }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-4 grid gap-3">
                    {newsTickerFeed[activeTicker]?.map((item) => (
                      <div key={item.headline} className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3">
                        <p className="text-sm font-semibold text-[var(--cream)]">{item.headline}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.source}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-[var(--gold)]" />
                <h2 className="font-display text-3xl text-[var(--cream)]">Ideas + bills</h2>
              </div>
              <div className="mt-5 grid gap-4">
                {bills.map((bill) => (
                  <div key={bill.id} className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-2xl text-[var(--cream)]">{bill.name}</p>
                        <p className="text-sm text-[var(--sand)]">{currency(bill.amount)}</p>
                      </div>
                      <p className="text-sm text-[var(--cream)]">
                        Due {formatShortDate(getBillDate(bill, startOfMonth(new Date())) ?? new Date())}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-[24px] border border-white/8 bg-black/15 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add bill</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <label className="sr-only" htmlFor="bill-name">Bill name</label>
                  <input id="bill-name" aria-label="Bill name" value={billDraft.name} onChange={(event) => setBillDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Studio rent" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" />
                  <label className="sr-only" htmlFor="bill-amount">Bill amount</label>
                  <input id="bill-amount" aria-label="Bill amount" type="number" value={billDraft.amount} onChange={(event) => setBillDraft((current) => ({ ...current, amount: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                  <label className="sr-only" htmlFor="bill-day">Bill due day</label>
                  <input id="bill-day" aria-label="Bill due day" type="number" min="1" max="28" value={billDraft.dueDay} onChange={(event) => setBillDraft((current) => ({ ...current, dueDay: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                  <label className="sr-only" htmlFor="bill-cadence">Bill cadence</label>
                  <select id="bill-cadence" aria-label="Bill cadence" value={billDraft.cadence} onChange={(event) => setBillDraft((current) => ({ ...current, cadence: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none">
                    <option value="1">Monthly</option>
                    <option value="3">Quarterly</option>
                    <option value="12">Yearly</option>
                  </select>
                </div>
                <button type="button" onClick={() => billDraft.name.trim() && startTransition(() => { setBills((current) => [...current, { id: crypto.randomUUID(), name: billDraft.name.trim(), amount: Number(billDraft.amount), dueDay: Number(billDraft.dueDay), cadenceMonths: Number(billDraft.cadence), startsAt: new Date().toISOString().slice(0, 10), autopay: true }]); setBillDraft((current) => ({ ...current, name: "" })); })} className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black"><CirclePlus className="h-4 w-4" />Add bill</button>
              </div>
              <div className="mt-4 grid gap-3">
                {aiStockSuggestions.map((item) => (
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
                              (((item.seedHistory.at(-1) ?? item.seedHistory[0]) - item.seedHistory[0]) /
                                item.seedHistory[0]) *
                              100,
                            history: item.seedHistory,
                            thesis: item.thesis,
                            rating: item.rating,
                          },
                        ]),
                      )
                    }
                    className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-left"
                  >
                    <p className="font-display text-xl text-[var(--cream)]">{item.ticker}</p>
                    <p className="mt-1 text-sm text-[var(--sand)]">{item.thesis}</p>
                  </button>
                ))}
              </div>
            </GlassCard>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid gap-6">
          <GlassCard id="planner" className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CalendarClock className="h-5 w-5 text-[var(--gold)]" />
                <h2 className="font-display text-3xl text-[var(--cream)]">Planner</h2>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setMonth((current) => addMonths(current, -1))} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]">Prev</button>
                <button type="button" onClick={() => setMonth((current) => addMonths(current, 1))} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]">Next</button>
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
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day}>{day}</div>)}
                </div>
                <div className="mt-3 grid grid-cols-7 gap-2">
                  {calendarDays.map((day) => (
                    <div key={day.date.toISOString()} className={cn("min-h-24 rounded-[20px] border p-2", day.inMonth ? "border-white/8 bg-black/12" : "border-white/6 bg-white/3", day.hasBill && "border-[var(--gold-soft)]")}>
                      <div className="flex items-center justify-between">
                        <span className={cn("text-sm", day.inMonth ? "text-[var(--cream)]" : "text-[var(--muted)]")}>{day.date.getDate()}</span>
                        {day.hasBill ? <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]">bill</span> : null}
                      </div>
                      <div className="mt-2 space-y-1">
                        {day.events.slice(0, 2).map((event) => (
                          <div key={event.id} className="rounded-full bg-white/7 px-2 py-1 text-[10px] text-[var(--sand)]">
                            {event.time} {event.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-[24px] border border-white/8 bg-black/15 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add event</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="sr-only" htmlFor="event-title">Event title</label>
                <input id="event-title" aria-label="Event title" value={eventDraft.title} onChange={(event) => setEventDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Design sync" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" />
                <label className="sr-only" htmlFor="event-date">Event date</label>
                <input id="event-date" aria-label="Event date" type="date" value={eventDraft.date} onChange={(event) => setEventDraft((current) => ({ ...current, date: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
                <label className="sr-only" htmlFor="event-time">Event time</label>
                <input id="event-time" aria-label="Event time" type="time" value={eventDraft.time} onChange={(event) => setEventDraft((current) => ({ ...current, time: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" />
              </div>
              <button type="button" onClick={() => eventDraft.title.trim() && startTransition(() => { setEvents((current) => [...current, { id: crypto.randomUUID(), title: eventDraft.title.trim(), date: eventDraft.date, time: eventDraft.time, reminderMinutes: 30, category: "Personal" }]); setEventDraft((current) => ({ ...current, title: "" })); })} className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black"><CirclePlus className="h-4 w-4" />Add event</button>
            </div>
          </GlassCard>

          <GlassCard id="weather" className="p-5 sm:p-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="flex items-center gap-3">
                  <CloudSun className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Weather</h2>
                </div>
                <p className="mt-4 text-6xl font-semibold text-[var(--cream)]">{weather.temp}</p>
                <p className="mt-2 text-sm text-[var(--sand)]">{weather.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {weather.hourly.slice(0, 4).map((item) => (
                    <div key={item.time} className="rounded-full border border-white/8 bg-white/5 px-3 py-2 text-sm text-[var(--cream)]">
                      {item.time} · {item.temp}
                    </div>
                  ))}
                </div>
                <Link href="/weather" className="mt-5 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">Open weather page</Link>
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <Gamepad2 className="h-5 w-5 text-[var(--gold)]" />
                  <h2 className="font-display text-3xl text-[var(--cream)]">Games</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  {games.slice(0, 2).map((game) => (
                    <div key={game.name} className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                      <p className="font-display text-2xl text-[var(--cream)]">{game.name}</p>
                      <p className="mt-2 text-sm text-[var(--sand)]">{game.description}</p>
                    </div>
                  ))}
                </div>
                <Link href="/games" className="mt-5 inline-flex rounded-full border border-white/10 bg-[var(--cream)] px-4 py-3 text-sm font-semibold text-black">Open games page</Link>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      </div>

      <div className="mt-6 rounded-[28px] border border-white/8 bg-white/5 px-5 py-4 text-sm text-[var(--sand)]">
        {pending ? "Updating dashboard state..." : "Arfor saves local interactions now and is ready to move into Supabase-backed persistence."}
      </div>

      <nav className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 gap-2 rounded-full border border-white/10 bg-[rgba(12,12,14,0.86)] px-3 py-2 backdrop-blur md:hidden">
        {[
          { href: "#news", label: "News" },
          { href: "#stocks", label: "Stocks" },
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
