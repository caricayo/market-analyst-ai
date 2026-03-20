import { NextResponse } from "next/server";
import { getTradingBotSnapshot } from "@/lib/server/trading-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const executionState = globalThis as typeof globalThis & {
  __btcKalshiLastExecutionAt?: number;
};

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
