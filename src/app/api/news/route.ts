import { NextResponse } from "next/server";
import { getLiveNews } from "@/lib/server/live-services";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const categories = url.searchParams
    .get("categories")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
  const query = url.searchParams.get("query") ?? "";
  const localDate = url.searchParams.get("date") ?? undefined;
  const timeZone = url.searchParams.get("timezone") ?? undefined;
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const payload = await getLiveNews(categories, query, {
    forceRefresh,
    localDate,
    timeZone,
  });
  return NextResponse.json(payload);
}
