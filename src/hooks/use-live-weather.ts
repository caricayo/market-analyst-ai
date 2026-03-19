"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveWeatherResponse } from "@/lib/live-data";
import { weatherCities, type WeatherCity } from "@/lib/mock-data";

type WeatherState = {
  cities: WeatherCity[];
  loading: boolean;
  mode: "live" | "fallback";
  warning: string | null;
  generatedAt: string | null;
};

export function useLiveWeather(cities: string[]) {
  const cityKey = useMemo(
    () =>
      Array.from(new Set(cities.map((city) => city.trim()).filter(Boolean)))
        .sort()
        .join(","),
    [cities],
  );
  const normalizedCities = useMemo(() => (cityKey ? cityKey.split(",") : []), [cityKey]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<WeatherState>({
    cities: weatherCities.filter((item) => normalizedCities.includes(item.name)),
    loading: false,
    mode: "fallback",
    warning: null,
    generatedAt: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    const loadWeather = async () => {
      setState((current) => ({ ...current, loading: true, warning: null }));

      try {
        const response = await fetch(`/api/weather?cities=${encodeURIComponent(cityKey)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Unable to load live weather right now.");
        }

        const payload = (await response.json()) as LiveWeatherResponse;
        if (controller.signal.aborted) {
          return;
        }

        setState({
          cities: payload.cities.length
            ? payload.cities
            : weatherCities.filter((item) => normalizedCities.includes(item.name)),
          loading: false,
          mode: payload.mode,
          warning: payload.warning ?? null,
          generatedAt: payload.generatedAt,
        });
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          cities: weatherCities.filter((item) => normalizedCities.includes(item.name)),
          loading: false,
          mode: "fallback",
          warning: error instanceof Error ? error.message : "Unable to load live weather right now.",
          generatedAt: null,
        });
      }
    };

    void loadWeather();

    return () => controller.abort();
  }, [cityKey, normalizedCities, refreshKey]);

  return {
    weatherCities: state.cities,
    weatherMode: state.mode,
    weatherLoading: state.loading,
    weatherWarning: state.warning,
    weatherGeneratedAt: state.generatedAt,
    refreshWeather: () => setRefreshKey((current) => current + 1),
  };
}
