import { NextResponse } from "next/server";
import { getTradingBotSnapshot } from "@/lib/server/trading-bot";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const executionState = globalThis as typeof globalThis & {
  __btcKalshiLastExecutionAt?: number;
};

async function assertTradingOperator() {
  const allowedEmails = (process.env.BOT_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedEmails.length) {
    throw new Error("BOT_OPERATOR_EMAILS is not configured, so order execution is disabled.");
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase auth is not configured, so order execution is disabled.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails.includes(email)) {
    throw new Error("You are not authorized to run live trading.");
  }
}

export async function GET() {
  try {
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
    await assertTradingOperator();
    const now = Date.now();
    const lastExecutionAt = executionState.__btcKalshiLastExecutionAt ?? 0;
    if (now - lastExecutionAt < 10_000) {
      return NextResponse.json(
        {
          error: "Trading is rate-limited for 10 seconds to reduce duplicate order submissions.",
        },
        { status: 429 },
      );
    }

    executionState.__btcKalshiLastExecutionAt = now;
    const payload = await getTradingBotSnapshot({ executeTrade: true });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the trading bot.",
      },
      { status: 500 },
    );
  }
}
