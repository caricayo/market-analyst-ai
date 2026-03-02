"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Components } from "react-markdown";

interface DeepDiveTabProps {
  content: string;
  focusQuery?: string;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children ?? "");
  }
  return "";
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-3xl font-bold text-t-green mt-10 mb-5 border-b border-t-green/40 pb-3 tracking-tight">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      id={slugifyHeading(flattenText(children))}
      className="text-2xl font-bold text-t-amber mt-10 mb-5 border-b border-t-amber/35 pb-2 tracking-tight"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-bold text-t-green mt-8 mb-3">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-bold text-t-white mt-4 mb-2">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-t-text leading-8 mb-5 text-[14px] md:text-[15px]">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-t-amber italic">{children}</em>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-t-amber underline underline-offset-2 hover:text-t-amber-dim"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-2 mb-5 ml-6 text-t-text text-[14px] md:text-[15px]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-2 mb-5 ml-6 text-t-text text-[14px] md:text-[15px]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-7">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-t-amber pl-4 py-3 my-5 bg-t-dark/70 text-t-text text-[14px] md:text-[15px] leading-8">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isInline = !className;
    if (isInline) {
      return <code className="bg-t-dark text-t-amber px-1 py-0.5 text-xs">{children}</code>;
    }
    return (
      <code
        className={`block bg-t-dark p-3 text-t-amber text-xs overflow-x-auto border border-t-border ${className || ""}`}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-3">{children}</pre>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse text-[12px] md:text-[13px] border border-t-border/60 bg-t-black/40">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-t-amber/40 bg-t-dark/70">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left py-2 px-2 text-t-amber font-bold uppercase tracking-[0.08em] text-[11px]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-2.5 px-2.5 text-t-text border-b border-t-border/30 align-top leading-6">{children}</td>
  ),
  hr: () => <hr className="border-t-border my-6" />,
};

function slugifyHeading(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

export default function DeepDiveTab({ content, focusQuery }: DeepDiveTabProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sectionHeadings = useMemo(() => {
    const matches = Array.from(content.matchAll(/^##\s+(.+)$/gm));
    return matches
      .map((m) => m[1].trim())
      .filter(Boolean)
      .map((title) => ({ title, id: slugifyHeading(title) }));
  }, [content]);

  useEffect(() => {
    if (!focusQuery || !rootRef.current) return;
    const query = normalizeForMatch(focusQuery);
    if (!query) return;

    const candidates = Array.from(
      rootRef.current.querySelectorAll("p, li, td, blockquote")
    ) as HTMLElement[];
    const target = candidates.find((el) =>
      normalizeForMatch(el.textContent || "").includes(query)
    );
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ring-1", "ring-t-cyan", "bg-t-cyan/10");
    const timer = window.setTimeout(() => {
      target.classList.remove("ring-1", "ring-t-cyan", "bg-t-cyan/10");
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [focusQuery]);

  return (
    <div className="grid grid-cols-1 gap-6 px-5 py-5 md:px-8 lg:grid-cols-[240px_minmax(0,1fr)] min-w-0 [overflow-wrap:anywhere]">
      <aside className="hidden lg:block">
        <div className="sticky top-4 border border-t-border/70 bg-t-dark/60 p-3">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-t-dim">
            In This Report
          </h3>
          <ul className="space-y-1">
            {sectionHeadings.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-[11px] leading-5 text-t-dim hover:text-t-cyan"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div ref={rootRef} className="min-w-0">
        <div className="pb-4">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
