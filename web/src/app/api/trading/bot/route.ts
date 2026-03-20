import { NextResponse } from "next/server";
import { ensureAutoEntryManagerStarted } from "@/lib/server/auto-entry-manager";
import { getTradingBotSnapshot, runTradingBotExecution } from "@/lib/server/trading-bot";
import { getServerSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getServerSupabaseUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    ensureAutoEntryManagerStarted();
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
  try {
    const user = await getServerSupabaseUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    ensureAutoEntryManagerStarted();
    const payload = await runTradingBotExecution("manual");
    return NextResponse.json(payload);
  } catch (error) {
    const status =
      error instanceof Error && error.message.includes("rate-limited")
        ? 429
        : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the trading bot.",
      },
      { status },
    );
  }
}
