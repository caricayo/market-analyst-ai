"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Components } from "react-markdown";

interface SynthesisTabProps {
  content: string;
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-2xl font-bold text-t-amber mt-8 mb-4 border-b border-t-amber/30 pb-2 break-words">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-bold text-t-green mt-6 mb-3 break-words">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-t-text leading-8 mb-4 text-[14px] md:text-[15px] break-words">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-t-amber italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-2 mb-4 ml-6 text-t-text text-[14px] md:text-[15px]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside space-y-2 mb-4 ml-3 text-t-white">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-7 break-words">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-t-amber pl-4 py-3 my-4 bg-t-dark/70 text-t-white break-words">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse text-xs border border-t-border/60 bg-t-black/40">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-t-amber/40 bg-t-dark/70">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left py-2 px-2 text-t-amber font-bold uppercase tracking-[0.08em] text-[11px] break-words">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-2 px-2 text-t-white border-b border-t-border/30 align-top break-words">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-t-amber underline underline-offset-2 hover:text-t-amber-dim break-all"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="bg-t-dark text-t-amber px-1 py-0.5 text-xs whitespace-pre-wrap break-all">{children}</code>
  ),
  hr: () => <hr className="border-t-border my-6" />,
};

export default function SynthesisTab({ content }: SynthesisTabProps) {
  return (
    <div className="px-5 py-5 md:px-8 min-w-0 overflow-x-auto [overflow-wrap:anywhere] text-[14px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
