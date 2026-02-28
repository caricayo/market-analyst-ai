"use client";

import * as Tabs from "@radix-ui/react-tabs";
import type { AnalysisResult } from "@/lib/types";
import DeepDiveTab from "./DeepDiveTab";
import PerspectiveTab from "./PerspectiveTab";
import SynthesisTab from "./SynthesisTab";

interface ReportViewProps {
  result: AnalysisResult;
}

export default function ReportView({ result }: ReportViewProps) {
  return (
    <Tabs.Root defaultValue="deep-dive" className="w-full">
      <Tabs.List
        className="flex border-b border-t-border"
        aria-label="Report sections"
      >
        <Tabs.Trigger
          value="deep-dive"
          className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-t-dim data-[state=active]:text-t-green data-[state=active]:border-b-2 data-[state=active]:border-t-green hover:text-t-text transition-colors"
        >
          Deep Dive
        </Tabs.Trigger>
        <Tabs.Trigger
          value="perspectives"
          className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-t-dim data-[state=active]:text-t-green data-[state=active]:border-b-2 data-[state=active]:border-t-green hover:text-t-text transition-colors"
        >
          Perspective Panel
        </Tabs.Trigger>
        <Tabs.Trigger
          value="synthesis"
          className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-t-dim data-[state=active]:text-t-green data-[state=active]:border-b-2 data-[state=active]:border-t-green hover:text-t-text transition-colors"
        >
          Synthesis
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="deep-dive" className="outline-none">
        <DeepDiveTab content={result.sections.deep_dive} />
      </Tabs.Content>

      <Tabs.Content value="perspectives" className="outline-none">
        <PerspectiveTab
          content={result.sections.perspectives}
          verdicts={result.persona_verdicts}
        />
      </Tabs.Content>

      <Tabs.Content value="synthesis" className="outline-none">
        <SynthesisTab content={result.sections.synthesis} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
