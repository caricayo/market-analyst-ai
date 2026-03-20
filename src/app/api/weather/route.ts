import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      error: "Legacy endpoint removed. Use /api/trading/bot instead.",
    },
    { status: 410 },
  );
}
