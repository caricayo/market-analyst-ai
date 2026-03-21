import { NextResponse } from "next/server";
import { getTradingBotSnapshot } from "@/lib/server/trading-bot";
import { getServerSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getServerSupabaseUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const payload = await getTradingBotSnapshot();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load the trading bot snapshot.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Manual execution is disabled. This page is now a read-only signal monitor.",
    },
    { status: 405 },
  );
}
