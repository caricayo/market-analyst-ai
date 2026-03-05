import { createClient } from "@/lib/supabase/server";
import LiveFeed from "@/components/live-feed";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("bot_events")
    .select("id, event_type, level, symbol, message, data, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  // Parse data JSONB → object for events that arrived as string
  const parsed = (events ?? []).map((ev) => ({
    ...ev,
    data:
      ev.data && typeof ev.data === "string"
        ? (() => { try { return JSON.parse(ev.data); } catch { return null; } })()
        : ev.data,
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-700 shrink-0">
        <h1 className="text-lg font-semibold text-slate-100">Live Feed</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Gatekeeper decisions, coin scores, and trade events in real time
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <LiveFeed initial={parsed} />
      </div>
    </div>
  );
}
