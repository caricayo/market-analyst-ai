import type { TickerInfo } from "./types";
import { createSupabaseClient } from "./supabase";

export function getBackendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "http://localhost:8000"
      : "")
  );
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const sb = createSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Refresh the Supabase session and return new auth headers.
 * Returns empty headers if refresh fails (user must re-login).
 */
async function refreshAndGetHeaders(): Promise<Record<string, string>> {
  const sb = createSupabaseClient();
  const { data, error } = await sb.auth.refreshSession();
  if (error || !data.session) return {};
  return { Authorization: `Bearer ${data.session.access_token}` };
}

/**
 * Fetch wrapper that retries once with a refreshed token on 401.
 */
async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const auth = await getAuthHeaders();
  const headers = { ...init?.headers, ...auth };
  const res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    // Token may be expired — refresh and retry once
    const freshAuth = await refreshAndGetHeaders();
    if (freshAuth.Authorization) {
      return fetch(url, { ...init, headers: { ...init?.headers, ...freshAuth } });
    }
  }

  return res;
}

export async function fetchTickers(): Promise<TickerInfo[]> {
  const res = await fetch("/api/tickers");
  if (!res.ok) throw new Error("Failed to fetch tickers");
  const data = await res.json();
  return data.tickers;
}

export async function searchTickers(
  query: string,
  limit = 8,
  signal?: AbortSignal
): Promise<TickerInfo[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`/api/tickers/search?${params}`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results;
}

export async function startAnalysis(
  ticker: string
): Promise<{ analysis_id: string; credits_remaining?: number }> {
  const backendUrl = getBackendUrl();

  const res = await authFetch(`${backendUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const backendUrl = getBackendUrl();
  await authFetch(`${backendUrl}/api/analyze/${analysisId}/cancel`, {
    method: "POST",
  });
}

export async function fetchProfile(): Promise<{
  credits_remaining: number;
  tier: string;
  total_analyses: number;
  member_since: string;
  next_reset: string | null;
}> {
  const backendUrl = getBackendUrl();
  const res = await authFetch(`${backendUrl}/api/user/profile`);
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export async function fetchAnalysesList(limit = 50): Promise<{
  analyses: Array<{
    id: string;
    ticker: string;
    status: string;
    cost_usd: number | null;
    created_at: string;
  }>;
  total: number;
}> {
  const backendUrl = getBackendUrl();
  const res = await authFetch(`${backendUrl}/api/user/analyses?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch analyses");
  return res.json();
}

export async function fetchAnalysisById(id: string): Promise<Record<string, unknown> | null> {
  const backendUrl = getBackendUrl();
  const res = await authFetch(`${backendUrl}/api/user/analyses/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export interface CreditPack {
  id: string;
  credits: number;
  price_cents: number;
  price_display: string;
  per_credit: string;
  label: string;
}

export async function fetchCreditPacks(): Promise<CreditPack[]> {
  const backendUrl = getBackendUrl();
  const res = await authFetch(`${backendUrl}/api/checkout/packs`);
  if (!res.ok) throw new Error("Failed to fetch credit packs");
  const data = await res.json();
  return data.packs;
}

export async function createCheckoutSession(packId: string): Promise<string> {
  const backendUrl = getBackendUrl();
  const res = await authFetch(`${backendUrl}/api/checkout/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to create checkout session");
  }
  const data = await res.json();
  return data.checkout_url;
}
