"use client";

import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createSupabaseClient } from "@/lib/supabase";

type AuthView = "login" | "signup";

interface AuthGateProps {
  children: (user: User | null, session: Session | null) => React.ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createSupabaseClient();

    sb.auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        // Supabase unreachable — show landing page (no session)
        setLoading(false);
      });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-t-dim text-xs">Initializing...</div>
      </div>
    );
  }

  return <>{children(session?.user ?? null, session)}</>;
}

export function AuthForm() {
  const [view, setView] = useState<AuthView>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);

      const sb = createSupabaseClient();

      try {
        if (view === "login") {
          const { error } = await sb.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
        } else {
          const { error } = await sb.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          });
          if (error) throw error;
          setCheckEmail(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, view]
  );

  const handleGoogleLogin = useCallback(async () => {
    const sb = createSupabaseClient();
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  }, []);

  if (checkEmail) {
    return (
      <div className="w-full max-w-sm border border-t-border bg-t-dark p-6">
        <h2 className="text-sm font-bold text-t-green mb-3">
          CHECK YOUR EMAIL
        </h2>
        <p className="text-xs text-t-text mb-4">
          We sent a confirmation link to{" "}
          <span className="text-t-amber">{email}</span>. Click it to activate
          your account.
        </p>
        <button
          onClick={() => {
            setCheckEmail(false);
            setView("login");
          }}
          className="w-full py-2 border border-t-border text-xs text-t-text hover:border-t-green hover:text-t-green transition-colors"
        >
          BACK TO LOGIN
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm border border-t-border bg-t-dark p-6">
      {/* Tab toggle */}
      <div className="flex border border-t-border mb-4">
        <button
          onClick={() => {
            setView("login");
            setError(null);
          }}
          className={`flex-1 py-1.5 text-xs uppercase tracking-wider transition-colors ${
            view === "login"
              ? "bg-t-green/10 text-t-green border-r border-t-border"
              : "text-t-dim hover:text-t-text border-r border-t-border"
          }`}
        >
          Login
        </button>
        <button
          onClick={() => {
            setView("signup");
            setError(null);
          }}
          className={`flex-1 py-1.5 text-xs uppercase tracking-wider transition-colors ${
            view === "signup"
              ? "bg-t-green/10 text-t-green"
              : "text-t-dim hover:text-t-text"
          }`}
        >
          Sign Up
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border border-t-red bg-t-red/5 px-3 py-2 mb-4">
          <p className="text-xs text-t-red">{error}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-t-dim mb-1 uppercase tracking-wider">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-t-black border border-t-border px-3 py-2 text-xs text-t-text focus:border-t-green outline-none transition-colors"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-xs text-t-dim mb-1 uppercase tracking-wider">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full bg-t-black border border-t-border px-3 py-2 text-xs text-t-text focus:border-t-green outline-none transition-colors"
            placeholder={
              view === "signup" ? "min. 6 characters" : "your password"
            }
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 border border-t-green text-t-green text-xs uppercase tracking-wider hover:bg-t-green/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting
            ? "..."
            : view === "login"
              ? "LOGIN"
              : "CREATE ACCOUNT"}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center my-4">
        <div className="flex-1 border-t border-t-border" />
        <span className="px-3 text-xs text-t-dim">or</span>
        <div className="flex-1 border-t border-t-border" />
      </div>

      {/* Google OAuth */}
      <button
        onClick={handleGoogleLogin}
        className="w-full py-2 border border-t-border text-xs text-t-text hover:border-t-amber hover:text-t-amber transition-colors"
      >
        CONTINUE WITH GOOGLE
      </button>

      {/* Free tier note */}
      <p className="text-center text-xs text-t-dim mt-4">
        Free tier includes weekly analysis credits
      </p>
      <p className="text-center text-[10px] text-t-dim mt-2">
        By signing in you agree to our{" "}
        <a href="/terms" className="text-t-amber hover:underline">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="/privacy" className="text-t-amber hover:underline">
          Privacy Policy
        </a>
      </p>
    </div>
  );
}
