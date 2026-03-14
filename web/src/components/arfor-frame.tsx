import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  CloudSun,
  Gamepad2,
  LayoutGrid,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Brief", icon: LayoutGrid },
  { href: "/weather", label: "Weather", icon: CloudSun },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/login", label: "Login", icon: ShieldCheck },
];

type ArforFrameProps = {
  activePath: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

export function ArforFrame({
  activePath,
  eyebrow,
  title,
  description,
  children,
}: ArforFrameProps) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="ambient-orb float-slow left-[-3rem] top-12 h-60 w-60 bg-[#ffd27d1f]" />
      <div className="ambient-orb float-fast right-[-2rem] top-28 h-52 w-52 bg-[#7cc4ff1a]" />
      <div className="ambient-orb float-slow bottom-16 left-1/4 h-40 w-40 bg-[#f7b3e81a]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="glass-panel panel-noise relative overflow-hidden rounded-[34px] px-4 py-4 sm:px-6">
          <div className="relative flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <div className="pulse-gold glow-ring flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8">
                    <CalendarDays className="h-5 w-5 text-[var(--gold)]" />
                  </div>
                  <div>
                    <p className="font-display text-2xl text-[var(--cream)]">Arfor</p>
                    <p className="text-xs uppercase tracking-[0.35em] text-[var(--muted)]">
                      {eyebrow}
                    </p>
                  </div>
                </div>
                <h1 className="mt-6 max-w-3xl font-display text-4xl leading-tight text-[var(--cream)] sm:text-5xl">
                  {title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sand)] sm:text-base">
                  {description}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === activePath;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-4 py-3 text-sm transition-all duration-200",
                        isActive
                          ? "border-[var(--gold-soft)] bg-[var(--gold)] text-black"
                          : "border-white/10 bg-white/5 text-[var(--sand)] hover:border-[var(--panel-border)] hover:text-[var(--cream)]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                Dark first
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                Glass system
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
                Mobile + desktop equal
              </span>
              <Link
                href="/login"
                className="ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
              >
                Google auth scaffold
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </header>

        <main className="relative flex-1 py-6">{children}</main>
      </div>
    </div>
  );
}
