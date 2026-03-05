"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/trades", label: "Trades" },
  { href: "/performance", label: "Performance" },
  { href: "/health", label: "Health" },
];

export default function NavSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-44 bg-slate-900 border-r border-slate-700 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-700">
        <span className="text-sm font-bold text-slate-100">Trading Bot</span>
        <span className="ml-2 text-xs bg-emerald-900 text-emerald-300 px-1.5 py-0.5 rounded">PAPER</span>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block px-3 py-2 rounded text-sm transition-colors ${
                active
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-700">
        <button
          onClick={signOut}
          className="w-full text-left px-3 py-2 rounded text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
