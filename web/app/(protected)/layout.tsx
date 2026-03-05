import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NavSidebar from "@/components/nav-sidebar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-950">
      <NavSidebar />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
