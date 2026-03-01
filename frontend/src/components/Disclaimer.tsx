"use client";

import Link from "next/link";

export default function Disclaimer() {
  return (
    <footer className="border-t border-t-border px-6 py-3 mt-auto">
      <div className="max-w-6xl mx-auto">
        <p className="text-[10px] text-t-dim leading-relaxed">
          This tool does not provide investment advice. All analysis is AI-generated and may
          contain errors, hallucinations, or outdated information. Always conduct your own
          research and consult a licensed financial advisor before making investment decisions.
        </p>
        <div className="flex gap-4 mt-2">
          <Link href="/terms" className="text-[10px] text-t-dim hover:text-t-amber transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy" className="text-[10px] text-t-dim hover:text-t-amber transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
