"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { ArforFrame } from "@/components/arfor-frame";
import { GlassCard } from "@/components/glass-card";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const envReady = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

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

  const handleSignOut = async () => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setUserEmail(null);
    setMessage("Signed out of the current browser session.");
  };

  return (
    <ArforFrame
      activePath="/login"
      eyebrow="Account"
      title="Sign in when you want sync, stay local when you do not."
      description="This page shows whether the Supabase client is configured, whether a browser session already exists, and how close the app is to production-ready account sync."
    >
      <div className="mx-auto grid max-w-4xl gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <LockKeyhole className="h-5 w-5 text-[var(--gold)]" />
            <h2 className="font-display text-3xl text-[var(--cream)]">Account access</h2>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--sand)]">
            Keep the callback URL aligned in Supabase and on the Railway deployment so Google OAuth
            can round-trip back into this app cleanly.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Environment</p>
              <p className="mt-2 text-xl font-semibold text-[var(--cream)]">
                {envReady ? "Configured" : "Missing vars"}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Session</p>
              <p className="mt-2 text-xl font-semibold text-[var(--cream)]">
                {userEmail ? "Active" : "Not signed in"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--gold)] px-5 py-4 text-sm font-semibold text-black"
          >
            Continue with Google
            <ArrowRight className="h-4 w-4" />
          </button>

          {userEmail ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-4 text-sm text-[var(--cream)]"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          ) : null}

          {message ? (
            <p className="mt-4 rounded-[20px] border border-[var(--panel-border)] bg-white/5 px-4 py-3 text-sm text-[var(--sand)]">
              {message}
            </p>
          ) : null}

          <Link href="/" className="mt-6 inline-flex text-sm text-[var(--sand)]">
            Back to dashboard
          </Link>
        </GlassCard>

        <div className="grid gap-6">
          <GlassCard className="p-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--gold)]" />
              <h3 className="font-display text-2xl text-[var(--cream)]">Status board</h3>
            </div>
            <div className="mt-5 grid gap-3">
              {[
                envReady
                  ? "Supabase client variables are present."
                  : "Supabase client variables are not present in this environment.",
                userEmail
                  ? `Signed in as ${userEmail}.`
                  : "No browser session detected right now.",
                "Google auth should redirect back to /auth/callback after consent.",
              ].map((item) => (
                <div key={item} className="rounded-[18px] border border-white/8 bg-black/15 p-4 text-sm text-[var(--sand)]">
                  {item}
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-[var(--gold)]" />
              <h3 className="font-display text-2xl text-[var(--cream)]">Setup notes</h3>
            </div>
            <div className="mt-5 space-y-3 text-sm leading-6 text-[var(--sand)]">
              <p>Confirm the Railway deployment URL is listed in Supabase OAuth redirect URLs.</p>
              <p>Confirm Google provider credentials are enabled in the Supabase auth settings.</p>
              <p>Once a project is linked, user-level data can move from local backup into profile sync.</p>
            </div>
          </GlassCard>
        </div>
      </div>
    </ArforFrame>
  );
}
