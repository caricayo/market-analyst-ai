import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = url.searchParams.get("next") || "/";
  if (!code) {
    return NextResponse.redirect(`${url.origin}/login?error=${encodeURIComponent("Missing OAuth code.")}`);
  }

  try {
    const supabase = await createServerSupabaseClient();
    await supabase?.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(`${url.origin}${nextPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete Google sign-in.";
    return NextResponse.redirect(`${url.origin}/login?error=${encodeURIComponent(message)}`);
  }
}
