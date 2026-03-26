"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

function getInitialSearchState() {
  if (typeof window === "undefined") {
    return {
      message: null as string | null,
      nextPath: "/",
    };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    message: params.get("error"),
    nextPath: params.get("next") || "/",
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [searchState] = useState(getInitialSearchState);
  const [message, setMessage] = useState<string | null>(searchState.message);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath] = useState(searchState.nextPath);

  const envReady = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? null;
      setUserEmail(email);
      if (email) {
        router.replace(nextPath);
      }
    });
  }, [nextPath, router]);

  const handleGoogleLogin = async () => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setMessage("Supabase client variables are missing in this environment.");
      return;
    }

    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(36,197,94,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_22%),linear-gradient(135deg,#081019_0%,#0f1723_50%,#101827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-[32px] border border-white/10 bg-[rgba(7,12,20,0.76)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-200/70">Protected Access</p>
              <h1 className="mt-3 max-w-3xl font-display text-4xl text-white sm:text-5xl">
                Sign in with Google to open the BTC 15-minute trading console.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
                This page is isolated from the previous dashboard shell. It only handles Supabase
                Google login and redirects straight back into the protected bot after a valid session
                is created.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Environment</p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {envReady ? "Configured" : "Missing vars"}
                  </p>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Return Path</p>
                  <p className="mt-2 text-xl font-semibold text-white">{nextPath}</p>
                </div>
              </div>

              {message ? (
                <div className="mt-5 rounded-[24px] border border-amber-300/25 bg-amber-300/10 px-5 py-4 text-sm text-amber-50">
                  {message}
                </div>
              ) : null}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[rgba(9,15,24,0.78)] p-5 backdrop-blur xl:p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <LockKeyhole className="h-5 w-5 text-emerald-200" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Session Gate</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Google + Supabase</h2>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current Session</p>
                  <p className="mt-2 text-lg font-semibold text-white">{userEmail ?? "Not signed in"}</p>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                  Only authenticated sessions can view the dashboard or call the trading API. After
                  Google consent, Supabase returns to <span className="font-semibold text-white">/auth/callback</span> and then forwards you to <span className="font-semibold text-white">{nextPath}</span>.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                disabled={loading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400 px-5 py-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Redirecting to Google..." : "Continue with Google"}
                <ArrowRight className="h-4 w-4" />
              </button>

              {userEmail ? (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/5 px-5 py-4 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              ) : null}

              <div className="mt-5 rounded-[20px] border border-white/10 bg-[#0c1420] p-4 text-sm text-slate-300">
                <div className="flex items-center gap-2 text-white">
                  <ShieldCheck className="h-4 w-4 text-emerald-200" />
                  Auth checklist
                </div>
                <div className="mt-3 grid gap-2">
                  <p>Supabase Google provider must be enabled.</p>
                  <p>Railway domain must exist in Supabase redirect URLs.</p>
                  <p>The callback endpoint must be reachable at `/auth/callback`.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
