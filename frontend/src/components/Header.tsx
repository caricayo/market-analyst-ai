"use client";

import { createSupabaseClient } from "@/lib/supabase";

interface HeaderProps {
  userEmail?: string;
  creditsRemaining?: number | null;
  onOpenStore?: () => void;
}

export default function Header({ userEmail, creditsRemaining, onOpenStore }: HeaderProps) {
  const handleSignOut = async () => {
    const sb = createSupabaseClient();
    await sb.auth.signOut();
  };

  return (
    <header className="border-b border-t-border px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-t-green glow-green tracking-wider">
            arfour
          </h1>
          <p className="text-xs text-t-amber mt-1 tracking-widest uppercase">
            multi-perspective investment intelligence
          </p>
        </div>
        {userEmail && (
          <div className="flex items-center gap-4">
            {creditsRemaining !== null && creditsRemaining !== undefined && (
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs ${
                    creditsRemaining > 0 ? "text-t-green" : "text-t-red"
                  }`}
                >
                  {creditsRemaining} credit{creditsRemaining !== 1 ? "s" : ""}
                </span>
                {creditsRemaining <= 1 && onOpenStore && (
                  <button
                    onClick={onOpenStore}
                    className="text-xs text-t-cyan hover:text-t-cyan/80 transition-colors"
                  >
                    GET CREDITS
                  </button>
                )}
              </div>
            )}
            <span className="text-xs text-t-dim">{userEmail}</span>
            <button
              onClick={handleSignOut}
              className="text-xs text-t-dim hover:text-t-red transition-colors"
            >
              SIGN OUT
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
