import { NextResponse } from "next/server";
import { getLiveMarkets } from "@/lib/server/live-services";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const focusTicker = url.searchParams.get("focusTicker") ?? "NVDA";
  const tickers = url.searchParams
    .get("tickers")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

  const payload = await getLiveMarkets(focusTicker, tickers);
  return NextResponse.json(payload);
}
