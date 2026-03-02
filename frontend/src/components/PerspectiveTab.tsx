"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { PersonaVerdict } from "@/lib/types";
import ComparisonTable from "./ComparisonTable";
import VerdictBadge from "./VerdictBadge";
import type { Components } from "react-markdown";

interface PerspectiveTabProps {
  content: string;
  verdicts: PersonaVerdict[];
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-2xl font-bold text-t-amber mt-8 mb-4 border-b border-t-amber/30 pb-2">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-bold text-t-green mt-6 mb-3">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-t-text leading-8 mb-4 text-[14px] md:text-[15px]">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-2 mb-4 ml-6 text-t-text text-[14px] md:text-[15px]">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="leading-7">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-t-amber pl-4 py-3 my-3 bg-t-dark/70 text-t-white">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full border-collapse text-xs border border-t-border/60 bg-t-black/40">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-t-amber/40 bg-t-dark/70">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left py-2 px-2 text-t-amber font-bold text-[11px] uppercase tracking-[0.08em]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-2 px-2 text-t-white border-b border-t-border/30 align-top">{children}</td>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-t-amber underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="bg-t-dark text-t-amber px-1 py-0.5 text-xs">{children}</code>
  ),
  hr: () => <hr className="border-t-border my-4" />,
};

export default function PerspectiveTab({ content, verdicts }: PerspectiveTabProps) {
  const [openPanels, setOpenPanels] = useState<Set<string>>(new Set());
  const blocks = (content.includes("<!-- PERSONA_SPLIT -->")
    ? content.split("<!-- PERSONA_SPLIT -->")
    : content.split(/\n---\n/)
  ).map((b) => b.trim()).filter((b) => b.length > 0);
  const panelCount = verdicts.length > 0 ? verdicts.length : blocks.length;
  const panelIndexes = Array.from({ length: panelCount }, (_, i) => i);

  function togglePanel(id: string) {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="px-5 py-5 md:px-8 min-w-0 [overflow-wrap:anywhere] text-[14px]">
      <div className="mb-6 border border-t-border/70 bg-t-dark/70 p-4">
        <h3 className="text-sm font-bold text-t-amber uppercase tracking-[0.08em] mb-3">
          Verdict Comparison
        </h3>
        <ComparisonTable verdicts={verdicts} />
      </div>

      <div className="space-y-3">
        {panelIndexes.map((i) => {
          const block = blocks[i] || "_No persona output captured for this slot._";
          const verdict = verdicts[i];
          const id = verdict?.persona_id || `persona-${i}`;
          const isOpen = openPanels.has(id);

          return (
            <Collapsible.Root key={id} open={isOpen} onOpenChange={() => togglePanel(id)}>
              <Collapsible.Trigger asChild>
                <button className="w-full flex items-center justify-between py-3 px-4 border border-t-border/70 bg-t-dark/70 hover:bg-t-gray transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-t-green text-sm">{isOpen ? "-" : "+"}</span>
                    <span className="text-base font-bold text-t-white">
                      {verdict?.persona_name || `Persona ${i + 1}`}
                    </span>
                    {verdict?.persona_label && (
                      <span className="text-xs text-t-dim">{verdict.persona_label}</span>
                    )}
                  </div>
                  {verdict?.available && <VerdictBadge rating={verdict.rating} />}
                </button>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <div className="border border-t-0 border-t-border/70 bg-t-black/50 px-5 py-4">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                    components={markdownComponents}
                  >
                    {block.trim()}
                  </ReactMarkdown>
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          );
        })}
      </div>
    </div>
  );
}
