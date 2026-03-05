interface Trade {
  id: number;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number | null;
  pnl_usdt: number | null;
  pnl_pct: number | null;
  stop_loss_price: number;
  take_profit_price: number;
  model_confidence: number | null;
  exit_reason: string | null;
  opened_at: string;
  closed_at: string | null;
}

interface Props {
  trades: Trade[];
  showAll?: boolean;
}

export default function RecentTrades({ trades, showAll }: Props) {
  if (trades.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-500 text-sm">
        No trades yet
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
              <th className="text-right px-4 py-2">Exit</th>
              <th className="text-right px-4 py-2">P&L ($)</th>
              <th className="text-right px-4 py-2">P&L (%)</th>
              <th className="text-right px-4 py-2">Conf</th>
              <th className="text-left px-4 py-2">Reason</th>
              {showAll && <th className="text-right px-4 py-2">Opened</th>}
              <th className="text-right px-4 py-2">Closed</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const profit = t.pnl_usdt != null && t.pnl_usdt > 0;
              const loss = t.pnl_usdt != null && t.pnl_usdt < 0;
              return (
                <tr
                  key={t.id}
                  className={`border-b border-slate-800 hover:bg-slate-800/30 ${
                    profit ? "bg-emerald-950/20" : loss ? "bg-red-950/20" : ""
                  }`}
                >
                  <td className="px-4 py-2 font-bold text-slate-100">{t.symbol}</td>
                  <td className="px-4 py-2 text-right text-slate-300">${t.entry_price.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right text-slate-300">
                    {t.exit_price != null ? `$${t.exit_price.toFixed(4)}` : "—"}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${profit ? "text-emerald-400" : loss ? "text-red-400" : "text-slate-400"}`}>
                    {t.pnl_usdt != null ? `${t.pnl_usdt >= 0 ? "+" : ""}$${t.pnl_usdt.toFixed(2)}` : "—"}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${profit ? "text-emerald-400" : loss ? "text-red-400" : "text-slate-400"}`}>
                    {t.pnl_pct != null ? `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-300">
                    {t.model_confidence != null ? `${(t.model_confidence * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-400">{t.exit_reason ?? "open"}</td>
                  {showAll && (
                    <td className="px-4 py-2 text-right text-slate-500">
                      {new Date(t.opened_at).toLocaleDateString()}
                    </td>
                  )}
                  <td className="px-4 py-2 text-right text-slate-500">
                    {t.closed_at ? new Date(t.closed_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
