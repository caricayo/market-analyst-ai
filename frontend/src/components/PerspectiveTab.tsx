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
    <h2 className="text-xl font-bold text-t-amber mt-6 mb-4 border-b border-t-amber/30 pb-2">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-bold text-t-green mt-5 mb-3">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-t-white leading-7 mb-3">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="list-none space-y-2 mb-3 ml-3">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="text-t-white leading-6 before:content-['-_'] before:text-t-green before:mr-1">
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
    <div className="px-5 py-5 md:px-8 min-w-0 [overflow-wrap:anywhere] text-[13px]">
      <div className="mb-6 border border-t-border/70 bg-t-dark/70 p-4">
        <h3 className="text-sm font-bold text-t-amber uppercase tracking-[0.08em] mb-3">
          Verdict Comparison
        </h3>
        <ComparisonTable verdicts={verdicts} />
      </div>

      <div className="space-y-3">
        {blocks.map((block, i) => {
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
