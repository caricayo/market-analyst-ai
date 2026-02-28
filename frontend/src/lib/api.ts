import type { TickerInfo } from "./types";

export async function fetchTickers(): Promise<TickerInfo[]> {
  const res = await fetch("/api/tickers");
  if (!res.ok) throw new Error("Failed to fetch tickers");
  const data = await res.json();
  return data.tickers;
}

export async function startAnalysis(ticker: string): Promise<{ analysis_id: string }> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (res.status === 409) {
    throw new Error("An analysis is already in progress");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to start analysis");
  }
  return res.json();
}

export async function cancelAnalysis(analysisId: string): Promise<void> {
  await fetch(`/api/analyze/${analysisId}/cancel`, { method: "POST" });
}

export async function getAnalysisStatus(): Promise<{
  active: boolean;
  analysis_id?: string;
  ticker?: string;
}> {
  const res = await fetch("/api/analyze/status");
  return res.json();
}
