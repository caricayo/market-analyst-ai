"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <div className="bg-red-950/40 border border-red-800 rounded-lg p-6 max-w-md w-full text-center">
        <p className="text-red-400 font-semibold mb-2">Something went wrong</p>
        <p className="text-slate-400 text-sm mb-4">
          {error.message || "An unexpected error occurred loading this page."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm rounded transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
