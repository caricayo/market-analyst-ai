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
    <h2 className="text-xl font-bold text-t-amber mt-8 mb-4 border-b border-t-amber/30 pb-2">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-bold text-t-green mt-6 mb-3">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-t-white leading-7 mb-4">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-t-amber italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="list-none space-y-2 mb-4 ml-3">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside space-y-2 mb-4 ml-3 text-t-white">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-t-white leading-6 before:content-['-_'] before:text-t-green before:mr-1">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-t-amber pl-4 py-3 my-4 bg-t-dark/70 text-t-white">
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
    <th className="text-left py-2 px-2 text-t-amber font-bold uppercase tracking-[0.08em] text-[11px]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-2 px-2 text-t-white border-b border-t-border/30 align-top">{children}</td>
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
  code: ({ children }) => (
    <code className="bg-t-dark text-t-amber px-1 py-0.5 text-xs">{children}</code>
  ),
  hr: () => <hr className="border-t-border my-6" />,
};

export default function SynthesisTab({ content }: SynthesisTabProps) {
  return (
    <div className="px-5 py-5 md:px-8 min-w-0 [overflow-wrap:anywhere] text-[13px]">
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
