import { NextResponse } from "next/server";
import { getBtc15mSignalSnapshot } from "@/lib/server/btc-signal-service";
import { getServerSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getServerSupabaseUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const payload = await getBtc15mSignalSnapshot();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load the BTC 15-minute signal snapshot.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: "This endpoint is read-only. The BTC 15-minute signal station does not place trades.",
    },
    { status: 405 },
  );
}
