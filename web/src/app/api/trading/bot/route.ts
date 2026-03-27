import { NextResponse } from "next/server";
import {
  setSignalExecutionControlState,
  toPublicSignalExecutionControl,
} from "@/lib/server/btc-signal-control-store";
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

export async function POST(request: Request) {
  try {
    const user = await getServerSupabaseUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as { command?: string } | null;
    if (payload?.command !== "start" && payload?.command !== "stop") {
      return NextResponse.json({ error: "Command must be 'start' or 'stop'." }, { status: 400 });
    }

    const control = await setSignalExecutionControlState({
      mode: payload.command === "start" ? "running" : "stopped",
      reason: payload.command === "start" ? null : "manual_stop",
      message:
        payload.command === "start"
          ? "Auto-execution is live."
          : "Auto-execution was stopped manually.",
      updatedBy: user.email ?? user.id,
    });

    return NextResponse.json({ control: toPublicSignalExecutionControl(control) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update execution control." },
      { status: 500 },
    );
  }
}
