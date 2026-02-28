"use client";

import { POSITION_SIZES } from "@/lib/constants";

interface RiskIndicatorProps {
  level: string; // None, Small, Moderate, Full
}

export default function RiskIndicator({ level }: RiskIndicatorProps) {
  const idx = POSITION_SIZES.indexOf(level as (typeof POSITION_SIZES)[number]);
  const filledCount = idx === -1 ? 0 : idx + 1;

  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-px">
        {POSITION_SIZES.map((size, i) => (
          <div
            key={size}
            className={`w-4 h-3 border border-t-border ${
              i < filledCount
                ? filledCount <= 1
                  ? "bg-t-dim"
                  : filledCount <= 2
                    ? "bg-t-amber"
                    : filledCount <= 3
                      ? "bg-t-amber"
                      : "bg-t-green"
                : ""
            }`}
            title={size}
          />
        ))}
      </div>
      <span className="text-xs text-t-dim ml-1">{level}</span>
    </div>
  );
}
