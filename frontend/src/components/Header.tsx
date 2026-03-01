"use client";

import { useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import { getBackendUrl } from "@/lib/api";

interface HeaderProps {
  userEmail?: string;
  creditsRemaining?: number | null;
  onOpenStore?: () => void;
}

export default function Header({ userEmail, creditsRemaining, onOpenStore }: HeaderProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    const sb = createSupabaseClient();
    await sb.auth.signOut();
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const sb = createSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;

      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/api/user/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) throw new Error("Failed to delete account");

      await sb.auth.signOut();
    } catch (e) {
      console.error("Account deletion failed:", e);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <>
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
                disabled={signingOut}
                className="text-xs text-t-dim hover:text-t-red transition-colors disabled:opacity-50"
              >
                {signingOut ? "..." : "SIGN OUT"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-[10px] text-t-dim/50 hover:text-t-red transition-colors"
                title="Delete your account and all data"
              >
                DELETE
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Delete account confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="border border-t-red bg-t-dark p-6 max-w-sm w-full mx-4">
            <h2 className="text-sm font-bold text-t-red uppercase tracking-wider mb-3">
              Delete Account
            </h2>
            <p className="text-xs text-t-text mb-2">
              This will permanently delete your account and all associated data including:
            </p>
            <ul className="text-xs text-t-dim mb-4 ml-2 space-y-1">
              <li className="before:content-['›_'] before:text-t-red before:mr-1">Your profile and settings</li>
              <li className="before:content-['›_'] before:text-t-red before:mr-1">All analysis history and reports</li>
              <li className="before:content-['›_'] before:text-t-red before:mr-1">Credit balance and transaction history</li>
            </ul>
            <p className="text-xs text-t-red mb-4">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-2 border border-t-border text-xs text-t-text hover:border-t-green hover:text-t-green transition-colors disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 py-2 border border-t-red text-xs text-t-red hover:bg-t-red/10 transition-colors disabled:opacity-50"
              >
                {deleting ? "DELETING..." : "DELETE ACCOUNT"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
