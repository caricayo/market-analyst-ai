"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
    <h2 className="text-lg font-bold text-t-amber mt-4 mb-3 border-b border-t-border/50 pb-1">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-bold text-t-green-dim mt-3 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-t-text leading-relaxed mb-2">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="list-none space-y-1 mb-2 ml-2">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="text-t-text before:content-['›_'] before:text-t-green before:mr-1">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-t-red pl-4 py-2 my-2 bg-t-red/5 text-t-text">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-t-amber/40">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left py-1.5 px-2 text-t-amber font-bold text-xs">{children}</th>
  ),
  td: ({ children }) => (
    <td className="py-1 px-2 text-t-text border-b border-t-border/30">{children}</td>
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

  // Split persona blocks by --- separator
  const blocks = content.split(/\n---\n/).filter((b) => b.trim());

  function togglePanel(id: string) {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="px-4 py-4 overflow-hidden break-words">
      {/* Comparison table at top */}
      <div className="mb-6 border border-t-border bg-t-dark p-3">
        <h3 className="text-xs font-bold text-t-amber uppercase tracking-wider mb-3">
          Verdict Comparison
        </h3>
        <ComparisonTable verdicts={verdicts} />
      </div>

      {/* Expandable persona sections */}
      <div className="space-y-2">
        {blocks.map((block, i) => {
          const verdict = verdicts[i];
          const id = verdict?.persona_id || `persona-${i}`;
          const isOpen = openPanels.has(id);

          return (
            <Collapsible.Root
              key={id}
              open={isOpen}
              onOpenChange={() => togglePanel(id)}
            >
              <Collapsible.Trigger asChild>
                <button className="w-full flex items-center justify-between py-2 px-3 border border-t-border bg-t-dark hover:bg-t-gray transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-t-green text-xs">
                      {isOpen ? "▼" : "▶"}
                    </span>
                    <span className="text-sm font-bold text-t-text">
                      {verdict?.persona_name || `Persona ${i + 1}`}
                    </span>
                    {verdict?.persona_label && (
                      <span className="text-[10px] text-t-dim">
                        {verdict.persona_label}
                      </span>
                    )}
                  </div>
                  {verdict?.available && (
                    <VerdictBadge rating={verdict.rating} />
                  )}
                </button>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <div className="border border-t-0 border-t-border bg-t-black/50 px-4 py-3">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
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
