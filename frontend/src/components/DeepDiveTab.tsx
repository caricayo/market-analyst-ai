"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface DeepDiveTabProps {
  content: string;
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-bold text-t-green mt-8 mb-4 border-b border-t-border pb-2 glow-green">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-bold text-t-amber mt-6 mb-3 border-b border-t-border/50 pb-1">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-bold text-t-green-dim mt-4 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-bold text-t-text mt-3 mb-1">{children}</h4>
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
  code: ({ className, children }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="bg-t-dark text-t-amber px-1 py-0.5 text-xs">{children}</code>
      );
    }
    return (
      <code className={`block bg-t-dark p-3 text-t-amber text-xs overflow-x-auto border border-t-border ${className || ""}`}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3">{children}</pre>
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
  hr: () => <hr className="border-t-border my-6" />,
};

export default function DeepDiveTab({ content }: DeepDiveTabProps) {
  // Split by ## Section boundaries for content-visibility optimization
  const sections = content.split(/(?=## Section \d+)/);

  return (
    <div className="px-4 py-4 space-y-2 min-w-0 [overflow-wrap:anywhere]">
      {sections.map((section, i) => (
        <div key={i} style={{ contentVisibility: "auto" }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {section}
          </ReactMarkdown>
        </div>
      ))}
    </div>
  );
}
