"use client";

import { useEffect, useState } from "react";
import { fetchCreditPacks, createCheckoutSession } from "@/lib/api";
import type { CreditPack } from "@/lib/api";

interface CreditStoreProps {
  open: boolean;
  onClose: () => void;
}

export default function CreditStore({ open, onClose }: CreditStoreProps) {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetchCreditPacks()
      .then(setPacks)
      .catch(() => setError("Failed to load packs"))
      .finally(() => setLoading(false));
  }, [open]);

  const handlePurchase = async (packId: string) => {
    setPurchasing(packId);
    setError(null);
    try {
      const url = await createCheckoutSession(packId);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setPurchasing(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md border border-t-border bg-t-dark p-6 mx-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-t-dim hover:text-t-text text-xs"
        >
          [ESC]
        </button>

        <h2 className="text-sm font-bold text-t-green mb-1 uppercase tracking-wider">
          Get More Credits
        </h2>
        <p className="text-xs text-t-dim mb-4">
          One-time purchase. Credits never expire.
        </p>

        {error && (
          <div className="border border-t-red bg-t-red/5 px-3 py-2 mb-3">
            <p className="text-xs text-t-red">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-xs text-t-dim">Loading...</div>
        ) : (
          <div className="space-y-2">
            {packs.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handlePurchase(pack.id)}
                disabled={purchasing !== null}
                className={`w-full border px-4 py-3 text-left transition-colors ${
                  purchasing === pack.id
                    ? "border-t-green bg-t-green/5 text-t-green"
                    : "border-t-border hover:border-t-cyan hover:bg-t-cyan/5"
                } disabled:opacity-50`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-t-text">
                      {pack.credits} credits
                    </span>
                    <span className="text-xs text-t-dim ml-2">
                      ({pack.per_credit}/ea)
                    </span>
                  </div>
                  <span className="text-sm font-bold text-t-cyan">
                    {purchasing === pack.id ? "..." : pack.price_display}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-t-dim mt-4 text-center">
          Secure checkout via Stripe.
        </p>
      </div>
    </div>
  );
}
