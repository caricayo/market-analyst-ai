"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Trade {
  id: number;
  symbol: string;
  side: string;
  entry_price: number;
  position_value: number;
  stop_loss_price: number;
  take_profit_price: number;
  model_confidence: number | null;
  opened_at: string;
  closed_at: string | null;
}

interface Props {
  initialPositions: Trade[];
}

function updatePositions(prev: Trade[], payload: { eventType: string; new: Trade; old: { id: number } }): Trade[] {
  if (payload.eventType === "INSERT") return [payload.new, ...prev];
  if (payload.eventType === "UPDATE") {
    if (payload.new.closed_at) return prev.filter((t) => t.id !== payload.new.id);
    return prev.map((t) => (t.id === payload.new.id ? payload.new : t));
  }
  if (payload.eventType === "DELETE") return prev.filter((t) => t.id !== payload.old.id);
  return prev;
}

export default function OpenPositions({ initialPositions }: Props) {
  const [positions, setPositions] = useState<Trade[]>(initialPositions);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("open-positions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trades", filter: "closed_at=is.null" },
        (payload) => setPositions((prev) => updatePositions(prev, payload as any))
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (positions.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-500 text-sm">
        No open positions
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-700 bg-slate-800/50">
              <th className="text-left px-4 py-2">Symbol</th>
              <th className="text-right px-4 py-2">Entry</th>
              <th className="text-right px-4 py-2">Value</th>
              <th className="text-right px-4 py-2">Stop</th>
              <th className="text-right px-4 py-2">Target</th>
              <th className="text-right px-4 py-2">Conf</th>
              <th className="text-right px-4 py-2">Opened</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((t) => (
              <tr key={t.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="px-4 py-2 font-bold text-slate-100">{t.symbol}</td>
                <td className="px-4 py-2 text-right text-slate-300">${t.entry_price.toFixed(4)}</td>
                <td className="px-4 py-2 text-right text-slate-300">${t.position_value.toFixed(2)}</td>
                <td className="px-4 py-2 text-right text-red-400">${t.stop_loss_price.toFixed(4)}</td>
                <td className="px-4 py-2 text-right text-emerald-400">${t.take_profit_price.toFixed(4)}</td>
                <td className="px-4 py-2 text-right text-slate-300">
                  {t.model_confidence != null ? `${(t.model_confidence * 100).toFixed(0)}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right text-slate-500">
                  {new Date(t.opened_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
