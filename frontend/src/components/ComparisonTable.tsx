"use client";

import type { PersonaVerdict } from "@/lib/types";
import VerdictBadge from "./VerdictBadge";
import ConfidenceGauge from "./ConfidenceGauge";
import RiskIndicator from "./RiskIndicator";

interface ComparisonTableProps {
  verdicts: PersonaVerdict[];
}

export default function ComparisonTable({ verdicts }: ComparisonTableProps) {
  const available = verdicts.filter((v) => v.available);
  if (available.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-t-border">
            <th className="text-left py-2 px-3 text-t-amber font-bold uppercase tracking-wider">
              Dimension
            </th>
            {verdicts.map((v) => (
              <th
                key={v.persona_id}
                className="text-left py-2 px-3 text-t-amber font-bold uppercase tracking-wider"
              >
                <div>{v.persona_name}</div>
                <div className="text-[10px] text-t-dim font-normal normal-case">
                  {v.persona_label}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-t-border/50">
            <td className="py-2 px-3 text-t-dim">Rating</td>
            {verdicts.map((v) => (
              <td key={v.persona_id} className="py-2 px-3">
                {v.available ? (
                  <VerdictBadge rating={v.rating} />
                ) : (
                  <span className="text-t-dim">—</span>
                )}
              </td>
            ))}
          </tr>
          <tr className="border-b border-t-border/50">
            <td className="py-2 px-3 text-t-dim">Confidence</td>
            {verdicts.map((v) => (
              <td key={v.persona_id} className="py-2 px-3">
                {v.available && v.confidence > 0 ? (
                  <ConfidenceGauge value={v.confidence} />
                ) : (
                  <span className="text-t-dim">—</span>
                )}
              </td>
            ))}
          </tr>
          <tr className="border-b border-t-border/50">
            <td className="py-2 px-3 text-t-dim">Time Horizon</td>
            {verdicts.map((v) => (
              <td key={v.persona_id} className="py-2 px-3 text-t-text">
                {v.available ? v.time_horizon : "—"}
              </td>
            ))}
          </tr>
          <tr className="border-b border-t-border/50">
            <td className="py-2 px-3 text-t-dim">Position Size</td>
            {verdicts.map((v) => (
              <td key={v.persona_id} className="py-2 px-3">
                {v.available ? (
                  <RiskIndicator level={v.position_size} />
                ) : (
                  <span className="text-t-dim">—</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
