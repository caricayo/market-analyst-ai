"use client";

import { useCallback } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { AnalysisResult } from "@/lib/types";
import DeepDiveTab from "./DeepDiveTab";
import PerspectiveTab from "./PerspectiveTab";
import SynthesisTab from "./SynthesisTab";

interface ReportViewProps {
  result: AnalysisResult;
}

export default function ReportView({ result }: ReportViewProps) {
  const estimatedCost = result.usage?.total_cost_usd;
  const hasEstimatedCost = typeof estimatedCost === "number" && Number.isFinite(estimatedCost);

  const downloadSection = useCallback(
    (sectionName: "deep-dive" | "perspectives" | "synthesis", content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const safeTicker = (result.ticker || "report").replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `${safeTicker}-${sectionName}.md`;
      const blob = new Blob([trimmed], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    [result.ticker]
  );

  return (
    <div className="w-full">
      <div className="border border-t-amber/30 bg-t-amber/5 px-4 py-3 mx-4 mt-4">
        <p className="text-xs text-t-amber leading-relaxed">
          This report is AI-generated and for informational purposes only. It does not
          constitute investment advice. Content may contain errors or outdated information.
          Consult a licensed financial advisor before making investment decisions.
        </p>
      </div>
      {hasEstimatedCost && (
        <div className="mx-4 mt-2 border border-t-cyan/40 bg-t-cyan/5 px-4 py-3">
          <p className="text-xs text-t-cyan">
            Estimated model cost: <span className="font-bold">${estimatedCost.toFixed(4)}</span>
            {typeof result.usage?.total_tokens === "number" && (
              <span className="text-t-dim"> | {result.usage.total_tokens.toLocaleString()} tokens</span>
            )}
            {typeof result.usage?.web_search_calls === "number" && (
              <span className="text-t-dim"> | {result.usage.web_search_calls} web searches</span>
            )}
          </p>
        </div>
      )}
      <Tabs.Root defaultValue="deep-dive" className="w-full">
        <Tabs.List className="flex border-b border-t-border px-1" aria-label="Report sections">
          <Tabs.Trigger
            value="deep-dive"
            className="px-4 py-3 text-sm font-bold uppercase tracking-[0.08em] text-t-dim data-[state=active]:text-t-green data-[state=active]:border-b-2 data-[state=active]:border-t-green hover:text-t-white transition-colors"
          >
            Deep Dive
          </Tabs.Trigger>
          <Tabs.Trigger
            value="perspectives"
            className="px-4 py-3 text-sm font-bold uppercase tracking-[0.08em] text-t-dim data-[state=active]:text-t-green data-[state=active]:border-b-2 data-[state=active]:border-t-green hover:text-t-white transition-colors"
          >
            Perspective Panel
          </Tabs.Trigger>
          <Tabs.Trigger
            value="synthesis"
            className="px-4 py-3 text-sm font-bold uppercase tracking-[0.08em] text-t-dim data-[state=active]:text-t-green data-[state=active]:border-b-2 data-[state=active]:border-t-green hover:text-t-white transition-colors"
          >
            Synthesis
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="deep-dive" className="outline-none">
          <div className="flex justify-end px-4 pt-4">
            <button
              type="button"
              onClick={() => downloadSection("deep-dive", result.sections.deep_dive)}
              disabled={!result.sections.deep_dive.trim()}
              className="px-3 py-2 border border-t-green text-t-green text-xs uppercase tracking-[0.08em] hover:bg-t-green/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download Deep Dive
            </button>
          </div>
          <DeepDiveTab content={result.sections.deep_dive} />
        </Tabs.Content>

        <Tabs.Content value="perspectives" className="outline-none">
          <div className="flex justify-end px-4 pt-4">
            <button
              type="button"
              onClick={() => downloadSection("perspectives", result.sections.perspectives)}
              disabled={!result.sections.perspectives.trim()}
              className="px-3 py-2 border border-t-green text-t-green text-xs uppercase tracking-[0.08em] hover:bg-t-green/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download Perspectives
            </button>
          </div>
          <PerspectiveTab content={result.sections.perspectives} verdicts={result.persona_verdicts} />
        </Tabs.Content>

        <Tabs.Content value="synthesis" className="outline-none">
          <div className="flex justify-end px-4 pt-4">
            <button
              type="button"
              onClick={() => downloadSection("synthesis", result.sections.synthesis)}
              disabled={!result.sections.synthesis.trim()}
              className="px-3 py-2 border border-t-green text-t-green text-xs uppercase tracking-[0.08em] hover:bg-t-green/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download Synthesis
            </button>
          </div>
          <SynthesisTab content={result.sections.synthesis} />
        </Tabs.Content>
      </Tabs.Root>
      <div className="px-4 py-3 border-t border-t-border">
        <p className="text-[10px] text-t-dim">Coming soon: Ask AI questions about this report</p>
      </div>
    </div>
  );
}
