"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type BotEvent = {
  id: number;
  event_type: string;
  level: string;
  symbol: string | null;
  message: string;
  data: Record<string, unknown> | null;
  created_at: string;
};

function eventBadge(event_type: string) {
  const map: Record<string, string> = {
    gatekeeper: "bg-violet-900/60 text-violet-300",
    coin_score:  "bg-slate-700 text-slate-300",
    trade_open:  "bg-emerald-900/60 text-emerald-300",
    trade_close: "bg-sky-900/60 text-sky-300",
    system:      "bg-slate-700 text-slate-400",
  };
  return map[event_type] ?? "bg-slate-700 text-slate-400";
}

function levelColor(level: string) {
  if (level === "error") return "text-red-400";
  if (level === "warn")  return "text-amber-400";
  return "text-slate-200";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function LiveFeed({ initial }: { initial: BotEvent[] }) {
  const [events, setEvents] = useState<BotEvent[]>(initial);
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("bot-events-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_events" },
        (payload) => {
          if (pausedRef.current) return;
          const newEvent = payload.new as BotEvent;
          // Parse data if it came as string
          if (newEvent.data && typeof newEvent.data === "string") {
            try { (newEvent as BotEvent & { data: unknown }).data = JSON.parse(newEvent.data as unknown as string); } catch {}
          }
          setEvents((prev) => [newEvent, ...prev].slice(0, 200));
        }
      )
      .subscribe();

    return () => { channel.unsubscribe().then(() => supabase.removeChannel(channel)); };
  }, []);

  // Auto-scroll to top (newest events are at top)
  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, paused]);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
        <span className="text-xs text-slate-400">
          {events.length} events &bull; live
          <span className="ml-2 inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </span>
        <button
          onClick={() => setPaused((p) => !p)}
          className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-100 hover:border-slate-400 transition-colors"
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {events.length === 0 && (
          <p className="text-slate-500 text-center mt-12">
            No events yet. Events appear here when the bot runs its morning routine.
          </p>
        )}
        {events.map((ev) => (
          <div
            key={ev.id}
            className="flex gap-3 px-4 py-1.5 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors"
          >
            {/* Timestamp */}
            <span className="text-slate-500 shrink-0 w-20 pt-0.5">
              {formatTime(ev.created_at)}
            </span>

            {/* Badge */}
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] h-fit ${eventBadge(ev.event_type)}`}
            >
              {ev.event_type.replace("_", " ")}
            </span>

            {/* Message */}
            <span className={`flex-1 leading-snug ${levelColor(ev.level)}`}>
              {ev.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
