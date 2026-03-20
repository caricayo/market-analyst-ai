import { redirect } from "next/navigation";
import { TradingBotDashboard } from "@/components/trading-bot-dashboard";
import { getServerSupabaseUser } from "@/lib/supabase/server";

export default async function Home() {
  const user = await getServerSupabaseUser();
  if (!user) {
    redirect("/login");
  }

  return <TradingBotDashboard />;
}
