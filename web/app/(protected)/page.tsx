import { createClient } from "@/lib/supabase/server";
import PortfolioCard from "@/components/portfolio-card";
import OpenPositions from "@/components/open-positions";
import RecentTrades from "@/components/trades-table";

export const revalidate = 60;

export default async function OverviewPage() {
  const supabase = createClient();

  // Latest daily stat
  const { data: latestStat } = await supabase
    .from("daily_stats")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  // 7-day return
  const { data: last7Days } = await supabase
    .from("daily_stats")
    .select("daily_pnl_pct")
    .order("date", { ascending: false })
    .limit(7);

  const sevenDayReturn = (last7Days ?? []).reduce(
    (sum, r) => sum + (r.daily_pnl_pct ?? 0),
    0
  );

  // 14-day win rate
  const since14 = new Date();
  since14.setDate(since14.getDate() - 14);
  const { data: trades14 } = await supabase
    .from("trades")
    .select("prediction_correct")
    .not("closed_at", "is", null)
    .gte("opened_at", since14.toISOString());

  const total14 = trades14?.length ?? 0;
  const wins14 = trades14?.filter((t) => t.prediction_correct).length ?? 0;
  const winRate14 = total14 > 0 ? (wins14 / total14) * 100 : null;

  // Open positions
  const { data: openTrades } = await supabase
    .from("trades")
    .select("*")
    .is("closed_at", null)
    .eq("paper", true)
    .order("opened_at", { ascending: false });

  // Recent closed trades
  const { data: recentTrades } = await supabase
    .from("trades")
    .select("*")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-slate-100">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <PortfolioCard
          label="Portfolio Value"
          value={
            latestStat?.portfolio_value_end != null
              ? `$${latestStat.portfolio_value_end.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"
          }
        />
        <PortfolioCard
          label="Today's P&L"
          value={
            latestStat?.daily_pnl_usdt != null
              ? `$${latestStat.daily_pnl_usdt.toFixed(2)}`
              : "—"
          }
          positive={latestStat?.daily_pnl_usdt != null ? latestStat.daily_pnl_usdt >= 0 : undefined}
          sub={
            latestStat?.daily_pnl_pct != null
              ? `${latestStat.daily_pnl_pct >= 0 ? "+" : ""}${latestStat.daily_pnl_pct.toFixed(2)}%`
              : undefined
          }
        />
        <PortfolioCard
          label="7-Day Return"
          value={`${sevenDayReturn >= 0 ? "+" : ""}${sevenDayReturn.toFixed(2)}%`}
          positive={sevenDayReturn >= 0}
        />
        <PortfolioCard
          label="Win Rate (14d)"
          value={winRate14 != null ? `${winRate14.toFixed(1)}%` : "—"}
          sub={total14 > 0 ? `${wins14}/${total14} trades` : undefined}
        />
      </div>

      {/* Open positions */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
          Open Positions
        </h2>
        <OpenPositions initialPositions={openTrades ?? []} />
      </section>

      {/* Recent trades */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
          Recent Trades
        </h2>
        <RecentTrades trades={recentTrades ?? []} />
      </section>
    </div>
  );
}
