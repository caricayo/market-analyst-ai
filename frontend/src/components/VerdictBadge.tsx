"use client";

import { RATING_COLORS } from "@/lib/constants";

interface VerdictBadgeProps {
  rating: string;
}

export default function VerdictBadge({ rating }: VerdictBadgeProps) {
  const colorClass = RATING_COLORS[rating] || RATING_COLORS["N/A"];

  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-bold uppercase tracking-wider border ${colorClass}`}
    >
      {rating}
    </span>
  );
}
