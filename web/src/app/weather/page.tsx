"use client";

import { useMemo, useState } from "react";
import { CloudSun, MapPinned, Sunrise, ThermometerSun, Umbrella, Wind } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { formatTemp, getWeatherSnapshot, isoDate } from "@/lib/arfor-utils";
import { weatherCities } from "@/lib/mock-data";

export default function WeatherPage() {
  const [city, setCity] = useState(weatherCities[0].name);
  const [compareCity, setCompareCity] = useState(weatherCities[1].name);
  const dayKey = isoDate(new Date());

  const featured = useMemo(
    () => getWeatherSnapshot(weatherCities.find((item) => item.name === city) ?? weatherCities[0], dayKey),
    [city, dayKey],
  );
  const compared = useMemo(
    () =>
      getWeatherSnapshot(
        weatherCities.find((item) => item.name === compareCity) ?? weatherCities[1],
        dayKey,
      ),
    [compareCity, dayKey],
  );

  return (
    <ArforFrame
      activePath="/weather"
      eyebrow="Weather Atlas"
      title="Forecasts that are actually useful beyond a single widget."
      description="Use this page for city switching, short-range hourly planning, five-day scanning, and a quick travel comparison against a second location."
    >
      <div className="grid gap-6 xl:grid-cols-[1.16fr_0.84fr]">
        <GlassCard className="p-6 sm:p-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <CloudSun className="h-5 w-5 text-[var(--gold)]" />
                <p className="text-xs uppercase tracking-[0.35em] text-[var(--muted)]">Featured city</p>
              </div>
              <h2 className="mt-3 font-display text-4xl text-[var(--cream)]">{featured.name}</h2>
              <p className="mt-2 text-sm text-[var(--sand)]">{featured.region}</p>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sand)]">{featured.summary}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select value={city} onChange={(event) => setCity(event.target.value)} aria-label="Featured city" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none">
                {weatherCities.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select value={compareCity} onChange={(event) => setCompareCity(event.target.value)} aria-label="Comparison city" className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] outline-none">
                {weatherCities.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {[
              { icon: ThermometerSun, label: "Feels like", value: formatTemp(featured.feelsLikeF) },
              { icon: Umbrella, label: "Rain chance", value: `${featured.precipitationChance}%` },
              { icon: Wind, label: "Wind", value: `${featured.windMph} mph` },
              { icon: Sunrise, label: "Sunrise", value: featured.sunrise },
            ].map((item) => (
              <div key={item.label} className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <item.icon className="h-4 w-4 text-[var(--gold)]" />
                <p className="mt-3 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--cream)]">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-5">
            {featured.hourly.map((item) => (
              <div key={item.time} className="rounded-[24px] border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.time}</p>
                <p className="mt-3 text-2xl font-semibold text-[var(--cream)]">{formatTemp(item.tempF)}</p>
                <p className="mt-2 text-sm text-[var(--sand)]">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[24px] border border-white/8 bg-black/15 p-4">
            <div className="flex items-center gap-3">
              <MapPinned className="h-5 w-5 text-[var(--gold)]" />
              <h3 className="font-display text-2xl text-[var(--cream)]">Five-day board</h3>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-5">
              {featured.daily.map((day) => (
                <div key={day.day} className="rounded-[20px] border border-white/8 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{day.day}</p>
                  <p className="mt-3 text-2xl font-semibold text-[var(--cream)]">{formatTemp(day.highF)}</p>
                  <p className="mt-1 text-sm text-[var(--sand)]">{formatTemp(day.lowF)} low</p>
                  <p className="mt-3 text-sm text-[var(--sand)]">{day.label}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{day.rainChance}% rain</p>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        <div className="grid gap-6">
          <GlassCard className="p-6">
            <h2 className="font-display text-3xl text-[var(--cream)]">Compare lane</h2>
            <div className="mt-5 grid gap-4">
              <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">{compared.name}</p>
                <p className="mt-3 text-4xl font-semibold text-[var(--cream)]">{formatTemp(compared.tempF)}</p>
                <p className="mt-2 text-sm text-[var(--sand)]">{compared.condition}</p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-black/15 p-4">
                <p className="text-sm leading-6 text-[var(--sand)]">
                  {featured.tempF > compared.tempF
                    ? `${compared.name} is cooler than ${featured.name} today, so a layer makes sense if you are traveling.`
                    : `${compared.name} is warmer than ${featured.name}, so lighter clothing should work better there.`}
                </p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="font-display text-3xl text-[var(--cream)]">City board</h2>
            <div className="mt-5 grid gap-4">
              {weatherCities.map((cityItem) => {
                const snapshot = getWeatherSnapshot(cityItem, dayKey);
                return (
                  <button
                    key={cityItem.name}
                    type="button"
                    onClick={() => setCity(cityItem.name)}
                    className="rounded-[24px] border border-white/8 bg-black/15 p-4 text-left transition-colors hover:border-[var(--panel-border)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xl font-semibold text-[var(--cream)]">{snapshot.name}</p>
                        <p className="mt-1 text-sm text-[var(--sand)]">{snapshot.condition}</p>
                      </div>
                      <p className="text-3xl font-semibold text-[var(--cream)]">{formatTemp(snapshot.tempF)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </div>
      </div>
    </ArforFrame>
  );
}
