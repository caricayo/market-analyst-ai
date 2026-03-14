import { Puzzle, Sparkles, Trophy } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { games } from "@/lib/mock-data";

export default function GamesPage() {
  return (
    <ArforFrame activePath="/games" eyebrow="Game Room" title="A dedicated playful corner, not an afterthought." description="Short focus resets live here so the app stays useful without becoming a flat utility dashboard.">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Mini games</h2></div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">{games.map((game) => <div key={game.name} className="rounded-[26px] border border-white/8 bg-black/15 p-5"><div className="flex items-center justify-between gap-3"><p className="font-display text-2xl text-[var(--cream)]">{game.name}</p><span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">{game.sessionLength}</span></div><p className="mt-3 text-sm leading-6 text-[var(--sand)]">{game.description}</p><div className="mt-4 rounded-[18px] bg-white/5 px-4 py-3 text-sm text-[var(--cream)]">{game.mode}</div></div>)}</div>
        </GlassCard>
        <div className="grid gap-6">
          <GlassCard className="p-6"><div className="flex items-center gap-3"><Trophy className="h-5 w-5 text-[var(--gold)]" /><h3 className="font-display text-2xl text-[var(--cream)]">Design intent</h3></div><p className="mt-5 text-sm leading-6 text-[var(--sand)]">The game tab uses the same glass language as the dashboard, but with looser pacing so it feels like a real mode switch.</p></GlassCard>
          <GlassCard className="p-6"><div className="flex items-center gap-3"><Puzzle className="h-5 w-5 text-[var(--gold)]" /><h3 className="font-display text-2xl text-[var(--cream)]">Next build</h3></div><div className="mt-5 space-y-3 text-sm text-[var(--sand)]"><p>Wire scores to Supabase profiles.</p><p>Add streaks and a lightweight achievement shelf.</p><p>Let users pin one game onto the dashboard.</p></div></GlassCard>
        </div>
      </div>
    </ArforFrame>
  );
}
