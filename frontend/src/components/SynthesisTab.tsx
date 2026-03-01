"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface SynthesisTabProps {
  content: string;
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-lg font-bold text-t-amber mt-6 mb-3 border-b border-t-border/50 pb-1">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-bold text-t-green-dim mt-4 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-t-text leading-relaxed mb-3">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-t-green font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-t-amber italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="list-none space-y-1 mb-3 ml-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside space-y-1 mb-3 ml-2 text-t-text">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-t-text before:content-['›_'] before:text-t-green before:mr-1">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-t-red pl-4 py-2 my-3 bg-t-red/5 text-t-text">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-t-amber/40">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left py-2 px-2 text-t-amber font-bold uppercase tracking-wider text-xs">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-1.5 px-2 text-t-text border-b border-t-border/30">{children}</td>
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
    <div className="px-4 py-4 min-w-0 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
