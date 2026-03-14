"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [message, setMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setMessage("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable Google auth.");
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) setMessage(error.message);
  };

  return (
    <ArforFrame activePath="/login" eyebrow="Authentication" title="Google sign-in, ready for Supabase." description="This route is scaffolded for your existing Google auth setup. Once the environment variables are present, the button below will redirect through Supabase OAuth.">
      <div className="mx-auto max-w-2xl">
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-center gap-3"><LockKeyhole className="h-5 w-5 text-[var(--gold)]" /><h2 className="font-display text-3xl text-[var(--cream)]">Continue to Arfor</h2></div>
          <p className="mt-4 text-sm leading-6 text-[var(--sand)]">Keep the callback URL aligned in Supabase and on the Railway deployment.</p>
          <button type="button" onClick={handleGoogleLogin} className="mt-8 flex w-full items-center justify-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--gold)] px-5 py-4 text-sm font-semibold text-black">
            Continue with Google
            <ArrowRight className="h-4 w-4" />
          </button>
          {message ? <p className="mt-4 rounded-[20px] border border-[var(--panel-border)] bg-white/5 px-4 py-3 text-sm text-[var(--sand)]">{message}</p> : null}
          <Link href="/" className="mt-6 inline-flex text-sm text-[var(--sand)]">Back to dashboard</Link>
        </GlassCard>
      </div>
    </ArforFrame>
  );
}
