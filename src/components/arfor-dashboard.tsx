"use client";

import { useDeferredValue, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { CalendarClock, CirclePlus, CloudSun, Compass, Gamepad2, Newspaper, WalletCards } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { aiStockSuggestions, defaultBills, defaultEvents, defaultWatchlist, games, newsPanels, newsTickerFeed, newsTypes, weatherCities } from "@/lib/mock-data";
import { cn, currency, percent } from "@/lib/utils";

type EventItem = (typeof defaultEvents)[number];
type BillItem = (typeof defaultBills)[number];
const key = "arfor-local-state";
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthAdd = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmt = (d: string | Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(typeof d === "string" ? new Date(`${d}T00:00:00`) : d);
const billDue = (bill: BillItem, month: Date) => {
  const start = monthStart(new Date(`${bill.startsAt}T00:00:00`));
  const diff = (month.getFullYear() - start.getFullYear()) * 12 + month.getMonth() - start.getMonth();
  if (diff < 0 || diff % bill.cadenceMonths !== 0) return null;
  return new Date(month.getFullYear(), month.getMonth(), Math.min(bill.dueDay, new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()));
};

export function ArforDashboard() {
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [filters, setFilters] = useState<string[]>(["Markets", "Tech", "World"]);
  const [events, setEvents] = useState(defaultEvents);
  const [bills, setBills] = useState(defaultBills);
  const [watchlist, setWatchlist] = useState(defaultWatchlist);
  const [ticker, setTicker] = useState(defaultWatchlist[0].ticker);
  const [eventDraft, setEventDraft] = useState({ title: "", date: new Date().toISOString().slice(0, 10), time: "09:00" });
  const [billDraft, setBillDraft] = useState({ name: "", amount: "120", dueDay: "5", cadence: "1" });

  useEffect(() => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const saved = JSON.parse(raw) as { filters?: string[]; events?: EventItem[]; bills?: BillItem[]; watchlist?: typeof defaultWatchlist; ticker?: string };
    if (saved.filters?.length) setFilters(saved.filters);
    if (saved.events?.length) setEvents(saved.events);
    if (saved.bills?.length) setBills(saved.bills);
    if (saved.watchlist?.length) setWatchlist(saved.watchlist);
    if (saved.ticker) setTicker(saved.ticker);
  }, []);
  useEffect(() => window.localStorage.setItem(key, JSON.stringify({ filters, events, bills, watchlist, ticker })), [filters, events, bills, watchlist, ticker]);

  const activeTicker = useDeferredValue(ticker);
  const stock = watchlist.find((item) => item.ticker === activeTicker) ?? watchlist[0];
  const days = Array.from({ length: 35 }, (_, i) => {
    const lead = (month.getDay() + 6) % 7;
    const date = new Date(month.getFullYear(), month.getMonth(), i - lead + 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date, inMonth: date.getMonth() === month.getMonth(), events: events.filter((event) => event.date === iso), due: bills.some((bill) => { const due = billDue(bill, monthStart(date)); return due ? sameDay(due, date) : false; }) };
  });

  return (
    <ArforFrame activePath="/" eyebrow="Daily Brief" title="A calm, cinematic command center for the way your day actually moves." description="Arfor combines daily news, planning, perpetual bills, stocks, weather, and a game room in one dark-first glass system.">
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.95fr]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6">
          <GlassCard className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Newspaper className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">News feed</h2></div><p className="text-sm text-[var(--sand)]">Grid categories</p></div>
            <div className="mt-5 flex flex-wrap gap-3">{newsTypes.map((item) => <button key={item} type="button" onClick={() => startTransition(() => setFilters((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]))} className={cn("rounded-full border px-4 py-2 text-sm", filters.includes(item) ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black" : "border-white/10 bg-white/5 text-[var(--sand)]")}>{item}</button>)}</div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">{newsPanels.filter((item) => filters.includes(item.category)).map((item) => <div key={item.headline} className="rounded-[28px] border border-white/8 bg-black/18 p-5"><p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">{item.category} · {item.source}</p><h3 className="mt-3 font-display text-2xl text-[var(--cream)]">{item.headline}</h3><p className="mt-3 text-sm leading-6 text-[var(--sand)]">{item.summary}</p></div>)}</div>
          </GlassCard>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <GlassCard className="p-5 sm:p-6">
              <div className="flex items-center gap-3"><Compass className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Stocks</h2></div>
              <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="space-y-3">{watchlist.map((item) => <button key={item.ticker} type="button" onClick={() => setTicker(item.ticker)} className={cn("w-full rounded-[24px] border p-4 text-left", ticker === item.ticker ? "border-[var(--gold-soft)] bg-white/10" : "border-white/8 bg-black/12")}><div className="flex items-center justify-between gap-3"><div><p className="font-display text-xl text-[var(--cream)]">{item.ticker}</p><p className="text-sm text-[var(--sand)]">{item.company}</p></div><div className="text-right"><p className="text-lg font-semibold text-[var(--cream)]">{currency(item.price)}</p><p className={cn("text-sm", item.dayChange >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]")}>{percent(item.dayChange)}</p></div></div></button>)}</div>
                <div className="rounded-[28px] border border-white/8 bg-black/18 p-5"><h3 className="font-display text-3xl text-[var(--cream)]">{stock.ticker}</h3><p className="mt-2 text-sm leading-6 text-[var(--sand)]">{stock.thesis}</p><div className="mt-5 flex h-32 items-end gap-2 rounded-[24px] bg-white/5 px-4 pb-4 pt-8">{stock.history.map((point, index, history) => { const min = Math.min(...history); const max = Math.max(...history); return <div key={`${stock.ticker}-${index}`} className="w-full rounded-full bg-[var(--gold)]/80" style={{ height: ((point - min) / (max - min || 1)) * 72 + 18 }} />; })}</div><div className="mt-4 grid gap-3">{newsTickerFeed[activeTicker]?.map((item) => <div key={item.headline} className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3"><p className="text-sm font-semibold text-[var(--cream)]">{item.headline}</p><p className="mt-1 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.source}</p></div>)}</div></div>
              </div>
            </GlassCard>

            <GlassCard className="p-5 sm:p-6">
              <div className="flex items-center gap-3"><WalletCards className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Bills + ideas</h2></div>
              <div className="mt-5 grid gap-4">{bills.map((bill) => <div key={bill.id} className="rounded-[24px] border border-white/8 bg-black/15 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-display text-2xl text-[var(--cream)]">{bill.name}</p><p className="text-sm text-[var(--sand)]">{currency(bill.amount)}</p></div><p className="text-sm text-[var(--cream)]">Due {fmt(billDue(bill, monthStart(new Date())) ?? new Date())}</p></div></div>)}</div>
              <div className="mt-4 rounded-[24px] border border-white/8 bg-black/15 p-4"><p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add bill</p><div className="mt-3 grid gap-3 sm:grid-cols-4"><input value={billDraft.name} onChange={(event) => setBillDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Studio rent" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" /><input type="number" value={billDraft.amount} onChange={(event) => setBillDraft((current) => ({ ...current, amount: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" /><input type="number" min="1" max="28" value={billDraft.dueDay} onChange={(event) => setBillDraft((current) => ({ ...current, dueDay: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" /><select value={billDraft.cadence} onChange={(event) => setBillDraft((current) => ({ ...current, cadence: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none"><option value="1">Monthly</option><option value="3">Quarterly</option><option value="12">Yearly</option></select></div><button type="button" onClick={() => billDraft.name.trim() && startTransition(() => { setBills((current) => [...current, { id: crypto.randomUUID(), name: billDraft.name.trim(), amount: Number(billDraft.amount), dueDay: Number(billDraft.dueDay), cadenceMonths: Number(billDraft.cadence), startsAt: new Date().toISOString().slice(0, 10), autopay: true }]); setBillDraft((current) => ({ ...current, name: "" })); })} className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black"><CirclePlus className="h-4 w-4" />Add bill</button></div>
              <div className="mt-4 grid gap-3">{aiStockSuggestions.map((item) => <button key={item.ticker} type="button" onClick={() => !watchlist.some((stockItem) => stockItem.ticker === item.ticker) && startTransition(() => setWatchlist((current) => [...current, { ticker: item.ticker, company: item.company, price: item.seedHistory.at(-1) ?? item.seedHistory[0], dayChange: ((item.seedHistory.at(-1) ?? item.seedHistory[0]) - item.seedHistory[0]) / item.seedHistory[0] * 100, history: item.seedHistory, thesis: item.thesis, rating: item.rating }]))} className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-left"><p className="font-display text-xl text-[var(--cream)]">{item.ticker}</p><p className="mt-1 text-sm text-[var(--sand)]">{item.thesis}</p></button>)}</div>
            </GlassCard>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid gap-6">
          <GlassCard className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><CalendarClock className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Calendar</h2></div><div className="flex gap-2"><button type="button" onClick={() => setMonth((current) => monthAdd(current, -1))} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--sand)]">Prev</button><button type="button" onClick={() => setMonth((current) => monthAdd(current, 1))} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--sand)]">Next</button></div></div>
            <p className="mt-4 font-display text-2xl text-[var(--cream)]">{month.toLocaleString("en-US", { month: "long", year: "numeric" })}</p>
            <div className="mt-4 grid grid-cols-7 gap-2 text-center text-[11px] uppercase tracking-[0.25em] text-[var(--muted)]">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day}>{day}</div>)}</div>
            <div className="mt-3 grid grid-cols-7 gap-2">{days.map((day) => <div key={day.date.toISOString()} className={cn("min-h-24 rounded-[20px] border p-2", day.inMonth ? "border-white/8 bg-black/12" : "border-white/6 bg-white/3", day.due && "border-[var(--gold-soft)]")}><div className="flex items-center justify-between"><span className={cn("text-sm", day.inMonth ? "text-[var(--cream)]" : "text-[var(--muted)]")}>{day.date.getDate()}</span>{day.due ? <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]">bill</span> : null}</div><div className="mt-2 space-y-1">{day.events.slice(0, 2).map((event) => <div key={event.id} className="rounded-full bg-white/7 px-2 py-1 text-[10px] text-[var(--sand)]">{event.time} {event.title}</div>)}</div></div>)}</div>
            <div className="mt-4 rounded-[24px] border border-white/8 bg-black/15 p-4"><p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Add event</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><input value={eventDraft.title} onChange={(event) => setEventDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Design sync" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none placeholder:text-[var(--muted)]" /><input type="date" value={eventDraft.date} onChange={(event) => setEventDraft((current) => ({ ...current, date: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" /><input type="time" value={eventDraft.time} onChange={(event) => setEventDraft((current) => ({ ...current, time: event.target.value }))} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none" /></div><button type="button" onClick={() => eventDraft.title.trim() && startTransition(() => { setEvents((current) => [...current, { id: crypto.randomUUID(), title: eventDraft.title.trim(), date: eventDraft.date, time: eventDraft.time, reminderMinutes: 30, category: "Personal" }]); setEventDraft((current) => ({ ...current, title: "" })); })} className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-black"><CirclePlus className="h-4 w-4" />Add event</button></div>
          </GlassCard>

          <GlassCard className="p-5 sm:p-6">
            <div className="grid gap-6 md:grid-cols-2"><div><div className="flex items-center gap-3"><CloudSun className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Weather</h2></div><p className="mt-4 text-6xl font-semibold text-[var(--cream)]">{weatherCities[0].temp}</p><p className="mt-2 text-sm text-[var(--sand)]">{weatherCities[0].summary}</p><Link href="/weather" className="mt-5 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--sand)]">Open weather page</Link></div><div><div className="flex items-center gap-3"><Gamepad2 className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Games</h2></div><div className="mt-4 grid gap-3">{games.slice(0, 2).map((game) => <div key={game.name} className="rounded-[22px] border border-white/8 bg-black/15 p-4"><p className="font-display text-2xl text-[var(--cream)]">{game.name}</p><p className="mt-2 text-sm text-[var(--sand)]">{game.description}</p></div>)}</div><Link href="/games" className="mt-5 inline-flex rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-black">Open games page</Link></div></div>
          </GlassCard>
        </motion.div>
      </div>
      <div className="mt-6 rounded-[28px] border border-white/8 bg-white/5 px-5 py-4 text-sm text-[var(--sand)]">{pending ? "Updating dashboard state..." : "Arfor saves local interactions now and is ready to move into Supabase-backed persistence."}</div>
    </ArforFrame>
  );
}
