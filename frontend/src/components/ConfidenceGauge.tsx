"use client";

interface ConfidenceGaugeProps {
  value: number; // 1-10
}

export default function ConfidenceGauge({ value }: ConfidenceGaugeProps) {
  const segments = Array.from({ length: 10 }, (_, i) => i + 1);

  function segmentColor(seg: number): string {
    if (seg > value) return "bg-t-border";
    if (value <= 3) return "bg-t-red";
    if (value <= 6) return "bg-t-amber";
    return "bg-t-green";
  }

  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-px">
        {segments.map((seg) => (
          <div
            key={seg}
            className={`w-2 h-4 ${segmentColor(seg)}`}
          />
        ))}
      </div>
      <span className="text-xs text-t-text ml-1 tabular-nums">{value}/10</span>
    </div>
  );
}
