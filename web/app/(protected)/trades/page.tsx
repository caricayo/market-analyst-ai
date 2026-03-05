import { createClient } from "@/lib/supabase/server";
import RecentTrades from "@/components/trades-table";

export const revalidate = 60;

export default async function TradesPage() {
  const supabase = createClient();

  const { data: trades } = await supabase
    .from("trades")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(500);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-100">Trade Log</h1>
      <RecentTrades trades={trades ?? []} showAll />
    </div>
  );
}
