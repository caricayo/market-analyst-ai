import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { BlockfallGame } from "@/components/games/blockfall";
import { TwentyFortyEightGame } from "@/components/games/twenty-forty-eight";
import { GlassCard } from "@/components/glass-card";
import { games } from "@/lib/mock-data";

const gameViews = {
  "2048": TwentyFortyEightGame,
  blockfall: BlockfallGame,
} as const;

export function generateStaticParams() {
  return games.map((game) => ({ slug: game.slug }));
}

export default async function GamePlayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = games.find((entry) => entry.slug === slug);

  if (!game) {
    notFound();
  }

  const GameView = gameViews[slug as keyof typeof gameViews];
  if (!GameView) {
    notFound();
  }

  return (
    <ArforFrame
      activePath="/games"
      eyebrow="Play Mode"
      title={`${game.name}, launched cleanly.`}
      description="Arfor keeps the game surface focused so it feels deliberate on mobile and desktop instead of jammed into a cramped widget."
    >
      <div className="grid gap-6">
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                  {game.license}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                  {game.sessionLength}
                </span>
              </div>
              <h2 className="mt-4 font-display text-4xl text-[var(--cream)]">{game.name}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--sand)]">{game.description}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/games"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to shelf
              </Link>
              <a
                href={game.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
              >
                Source repo
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        </GlassCard>

        <GameView />

        <GlassCard className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--gold)]" />
            <h3 className="font-display text-2xl text-[var(--cream)]">Verified lane</h3>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--sand)]">
            This play route is built for browser use on phone and desktop, with visible controls so
            input is never hidden behind keyboard assumptions. Progress is kept locally on the
            device for now, and can move into Supabase-backed profiles later.
          </p>
        </GlassCard>
      </div>
    </ArforFrame>
  );
}
