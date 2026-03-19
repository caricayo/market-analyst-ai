import { NextResponse } from "next/server";
import { weatherCities } from "@/lib/mock-data";
import { getLiveWeather } from "@/lib/server/live-services";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedCities = url.searchParams
    .get("cities")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const cities = requestedCities?.length
    ? requestedCities
    : weatherCities.map((item) => item.name);

  const payload = await getLiveWeather(cities);
  return NextResponse.json(payload);
}
