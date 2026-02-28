import type { TickerInfo } from "./types";
import { createSupabaseClient } from "./supabase";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const sb = createSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

function getBackendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "http://localhost:8000"
      : "")
  );
}

export async function fetchTickers(): Promise<TickerInfo[]> {
  const res = await fetch("/api/tickers");
  if (!res.ok) throw new Error("Failed to fetch tickers");
  const data = await res.json();
  return data.tickers;
}

export async function startAnalysis(
  ticker: string
): Promise<{ analysis_id: string; credits_remaining?: number }> {
  const auth = await getAuthHeaders();
  const backendUrl = getBackendUrl();

  const res = await fetch(`${backendUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ ticker }),
  });

  if (res.status === 402) {
    const data = await res.json();
    throw new Error(data.detail || "No analysis credits remaining");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to start analysis");
  }
  return res.json();
}

export async function cancelAnalysis(analysisId: string): Promise<void> {
  const auth = await getAuthHeaders();
  const backendUrl = getBackendUrl();
  await fetch(`${backendUrl}/api/analyze/${analysisId}/cancel`, {
    method: "POST",
    headers: auth,
  });
}

export async function fetchProfile(): Promise<{
  credits_remaining: number;
  tier: string;
  total_analyses: number;
  member_since: string;
}> {
  const auth = await getAuthHeaders();
  const backendUrl = getBackendUrl();

  const res = await fetch(`${backendUrl}/api/user/profile`, {
    headers: auth,
  });
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}
