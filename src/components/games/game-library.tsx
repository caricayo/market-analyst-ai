import Link from "next/link";
import { ArrowRight, BadgeCheck, ExternalLink, Gamepad2, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { games } from "@/lib/mock-data";

export function GameLibrary() {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <GlassCard className="overflow-hidden p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-[var(--gold)]" />
          <h2 className="font-display text-3xl text-[var(--cream)]">MIT-only game shelf</h2>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--sand)] sm:text-base">
          The library is intentionally tight: only lightweight, browser-safe games with verified
          MIT roots made the cut. Pick one, launch it into a focused play view, and drop back into
          the rest of Arfor without losing the mood.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {games.map((game) => (
            <section
              key={game.slug}
              className="relative overflow-hidden rounded-[28px] border border-white/8 bg-black/20 p-5"
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${game.accent}`} />
              <div className="relative">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    {game.license}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    {game.mode}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-3xl text-[var(--cream)]">{game.name}</h3>
                <p className="mt-2 text-sm text-[var(--cream)]">{game.tagline}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--sand)]">{game.description}</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/games/${game.slug}`}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--gold-soft)] bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-black"
                  >
                    Play now
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href={game.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
                  >
                    Source
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </section>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-6">
        <GlassCard className="p-6">
          <div className="flex items-center gap-3">
            <Gamepad2 className="h-5 w-5 text-[var(--gold)]" />
            <h3 className="font-display text-2xl text-[var(--cream)]">Workflow</h3>
          </div>
          <div className="mt-5 space-y-3 text-sm leading-6 text-[var(--sand)]">
            <p>1. Open the games shelf from the main nav or dashboard.</p>
            <p>2. Launch a single game into its own focused play route.</p>
            <p>3. Use touch buttons or keyboard shortcuts depending on the device.</p>
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-3">
            <BadgeCheck className="h-5 w-5 text-[var(--gold)]" />
            <h3 className="font-display text-2xl text-[var(--cream)]">Quality bar</h3>
          </div>
          <div className="mt-5 space-y-3 text-sm leading-6 text-[var(--sand)]">
            <p>Only verified MIT-source picks are surfaced here.</p>
            <p>Every game is playable with on-screen controls, not keyboard-only.</p>
            <p>The library stays intentionally small so the page feels curated, not cluttered.</p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
