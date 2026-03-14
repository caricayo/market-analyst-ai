import { CloudSun, ThermometerSun, Wind } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { weatherCities } from "@/lib/mock-data";

export default function WeatherPage() {
  const featured = weatherCities[0];

  return (
    <ArforFrame activePath="/weather" eyebrow="Weather Atlas" title="Forecasts that feel calm, legible, and quick to scan." description="Arfor keeps a compact widget on the dashboard and a fuller forecast surface here for trend, comfort, and quick city checks.">
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-3"><CloudSun className="h-5 w-5 text-[var(--gold)]" /><p className="text-xs uppercase tracking-[0.35em] text-[var(--muted)]">Featured city</p></div><h2 className="mt-3 font-display text-4xl text-[var(--cream)]">{featured.name}</h2><p className="mt-3 text-sm leading-6 text-[var(--sand)]">{featured.summary}</p></div><p className="text-6xl font-semibold text-[var(--cream)]">{featured.temp}</p></div>
          <div className="mt-6 grid gap-4 md:grid-cols-4">{[{ icon: ThermometerSun, label: "Feels like", value: featured.feelsLike }, { icon: CloudSun, label: "Condition", value: featured.condition }, { icon: Wind, label: "Wind", value: featured.wind }, { icon: ThermometerSun, label: "Humidity", value: featured.humidity }].map((item) => <div key={item.label} className="rounded-[24px] border border-white/8 bg-black/15 p-4"><item.icon className="h-4 w-4 text-[var(--gold)]" /><p className="mt-3 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">{item.label}</p><p className="mt-2 text-2xl font-semibold text-[var(--cream)]">{item.value}</p></div>)}</div>
          <div className="mt-6 grid gap-4 md:grid-cols-5">{featured.hourly.map((item) => <div key={item.time} className="rounded-[24px] border border-white/8 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.time}</p><p className="mt-3 text-2xl font-semibold text-[var(--cream)]">{item.temp}</p><p className="mt-2 text-sm text-[var(--sand)]">{item.label}</p></div>)}</div>
        </GlassCard>
        <GlassCard className="p-6">
          <h2 className="font-display text-3xl text-[var(--cream)]">City board</h2>
          <div className="mt-5 grid gap-4">{weatherCities.map((city) => <div key={city.name} className="rounded-[24px] border border-white/8 bg-black/15 p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-xl font-semibold text-[var(--cream)]">{city.name}</p><p className="mt-1 text-sm text-[var(--sand)]">{city.condition}</p></div><p className="text-3xl font-semibold text-[var(--cream)]">{city.temp}</p></div></div>)}</div>
        </GlassCard>
      </div>
    </ArforFrame>
  );
}
