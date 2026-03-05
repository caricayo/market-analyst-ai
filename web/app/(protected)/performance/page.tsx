import { createClient } from "@/lib/supabase/server";
import EquityCurve from "@/components/equity-curve";
import DrawdownChart from "@/components/drawdown-chart";

export const revalidate = 300;

export default async function PerformancePage() {
  const supabase = createClient();

  const { data: dailyStats } = await supabase
    .from("daily_stats")
    .select("date, portfolio_value_end, daily_pnl_usdt, daily_pnl_pct")
    .order("date", { ascending: true })
    .limit(365);

  const { data: simResult } = await supabase
    .from("simulation_results")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Compute drawdown series from daily portfolio values
  const equityData = (dailyStats ?? []).filter((d) => d.portfolio_value_end != null);

  let peak = equityData[0]?.portfolio_value_end ?? 0;
  const drawdownData = equityData.map((d) => {
    if (d.portfolio_value_end! > peak) peak = d.portfolio_value_end!;
    const dd = peak > 0 ? ((d.portfolio_value_end! - peak) / peak) * 100 : 0;
    return { date: d.date, drawdown: parseFloat(dd.toFixed(2)) };
  });

  const stats = [
    { label: "Total Return", value: simResult?.total_return_pct != null ? `${(simResult.total_return_pct * 100).toFixed(2)}%` : "—" },
    { label: "Sharpe Ratio", value: simResult?.sharpe_ratio?.toFixed(2) ?? "—" },
    { label: "Max Drawdown", value: simResult?.max_drawdown_pct != null ? `${(simResult.max_drawdown_pct * 100).toFixed(2)}%` : "—" },
    { label: "Win Rate", value: simResult?.win_rate != null ? `${(simResult.win_rate * 100).toFixed(1)}%` : "—" },
    { label: "Profit Factor", value: simResult?.profit_factor?.toFixed(2) ?? "—" },
    { label: "Avg Win", value: simResult?.avg_win_pct != null ? `${(simResult.avg_win_pct * 100).toFixed(2)}%` : "—" },
    { label: "Avg Loss", value: simResult?.avg_loss_pct != null ? `${(simResult.avg_loss_pct * 100).toFixed(2)}%` : "—" },
    { label: "Total Trades", value: simResult?.total_trades?.toString() ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-slate-100">Performance</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-1">{s.label}</p>
            <p className="text-lg font-mono font-bold text-slate-100">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide">
          Equity Curve
        </h2>
        <EquityCurve data={equityData} />
      </div>

      {/* Drawdown */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide">
          Drawdown
        </h2>
        <DrawdownChart data={drawdownData} />
      </div>
    </div>
  );
}
