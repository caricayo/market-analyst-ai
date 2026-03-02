"use client";

import { useMemo, useState } from "react";
import type { ClaimLedgerEntry } from "@/lib/types";

interface ClaimsLedgerPanelProps {
  claims: ClaimLedgerEntry[];
  onLocate: (claim: ClaimLedgerEntry) => void;
}

type FilterKey = "all" | "sec_ir" | "unverified" | "low_confidence";

export default function ClaimsLedgerPanel({ claims, onLocate }: ClaimsLedgerPanelProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const filteredClaims = useMemo(() => {
    const q = query.trim().toLowerCase();
    return claims.filter((claim) => {
      if (filter === "sec_ir" && claim.source_type !== "SEC/IR") return false;
      if (filter === "unverified" && String(claim.source_citation).toLowerCase() !== "unverified") return false;
      if (filter === "low_confidence" && claim.confidence !== "low") return false;
      if (!q) return true;
      const haystack = `${claim.metric} ${claim.statement} ${claim.notes}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [claims, filter, query]);

  return (
    <div className="mx-4 mt-2 border border-t-border/80 bg-t-dark/70">
      <div className="border-b border-t-border/80 px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-t-cyan">
          Claims Ledger
        </h3>
        <p className="mt-1 text-[11px] text-t-dim">
          Audit view of factual claims detected in the Deep Dive.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-t-border/60 px-4 py-3">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`px-2 py-1 text-[11px] uppercase tracking-[0.08em] border ${
            filter === "all" ? "border-t-green text-t-green" : "border-t-border text-t-dim hover:text-t-white"
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFilter("sec_ir")}
          className={`px-2 py-1 text-[11px] uppercase tracking-[0.08em] border ${
            filter === "sec_ir" ? "border-t-green text-t-green" : "border-t-border text-t-dim hover:text-t-white"
          }`}
        >
          SEC/IR
        </button>
        <button
          type="button"
          onClick={() => setFilter("unverified")}
          className={`px-2 py-1 text-[11px] uppercase tracking-[0.08em] border ${
            filter === "unverified" ? "border-t-green text-t-green" : "border-t-border text-t-dim hover:text-t-white"
          }`}
        >
          Unverified
        </button>
        <button
          type="button"
          onClick={() => setFilter("low_confidence")}
          className={`px-2 py-1 text-[11px] uppercase tracking-[0.08em] border ${
            filter === "low_confidence" ? "border-t-green text-t-green" : "border-t-border text-t-dim hover:text-t-white"
          }`}
        >
          Low Confidence
        </button>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search metric/statement..."
          className="ml-auto w-full md:w-72 border border-t-border bg-t-black px-2 py-1 text-[12px] text-t-white placeholder:text-t-dim focus:outline-none focus:border-t-cyan"
        />
      </div>

      <div className="max-h-96 overflow-y-auto">
        {filteredClaims.length === 0 ? (
          <p className="px-4 py-4 text-xs text-t-dim">No matching claims.</p>
        ) : (
          <ul className="divide-y divide-t-border/40">
            {filteredClaims.map((claim, idx) => (
              <li key={`${claim.metric}-${idx}`} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {claim.claim_id && (
                    <span className="border border-t-cyan/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-t-cyan">
                      {claim.claim_id}
                    </span>
                  )}
                  <span className="text-xs font-bold text-t-amber">{claim.metric}</span>
                  <span className="border border-t-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-t-dim">
                    {claim.claim_type}
                  </span>
                  <span className="border border-t-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-t-dim">
                    {claim.confidence}
                  </span>
                  <span className="border border-t-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-t-dim">
                    {claim.source_type}
                  </span>
                </div>
                <p className="mb-2 text-[12px] leading-6 text-t-text">{claim.statement}</p>
                <p className="text-[11px] text-t-dim">
                  Citation: {claim.source_citation || "unverified"}
                </p>
                {claim.source_url && (
                  <a
                    href={claim.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[11px] text-t-cyan hover:text-t-cyan/80 underline underline-offset-2"
                  >
                    Open source link
                  </a>
                )}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => onLocate(claim)}
                    className="border border-t-cyan px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-t-cyan hover:bg-t-cyan/10"
                  >
                    Locate In Report
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
