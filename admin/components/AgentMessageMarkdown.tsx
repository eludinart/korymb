"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import { normalizeLooseMarkdown } from "../lib/normalizeLooseMarkdown";

/** react-markdown / hast peuvent injecter des props non-DOM : ne pas les repasser aux balises HTML. */
function markdownDomProps(props: Record<string, unknown>) {
  const { node, inline, ...rest } = props;
  void node;
  void inline;
  return rest;
}

/** Styles adaptés aux bulles assistant (fond clair). Pas de HTML brut (sûr par défaut). */
const bubbleComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1
      className="mt-4 mb-2 border-b border-slate-200 pb-1 text-base font-bold text-slate-900 first:mt-0"
      {...markdownDomProps(props as Record<string, unknown>)}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mt-4 mb-2 text-sm font-bold text-slate-900 first:mt-0" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold text-slate-800 first:mt-0" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="mt-3 mb-1 text-sm font-semibold text-slate-800" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </h4>
  ),
  /** `div` évite des `<p><ul/></p>` invalides que le navigateur « répare » et désynchronise React. */
  p: ({ children, ...props }) => (
    <div className="mb-2 leading-relaxed last:mb-0" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </div>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-2 list-disc space-y-1 pl-5" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-slate-900" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-slate-800" {...markdownDomProps(props as Record<string, unknown>)}>
      {children}
    </em>
  ),
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
      target="_blank"
      rel="noopener noreferrer"
      {...markdownDomProps(props as Record<string, unknown>)}
    >
      {children}
    </a>
  ),
  hr: (props) => <hr className="my-4 border-0 border-t border-slate-300" {...markdownDomProps(props as Record<string, unknown>)} />,
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-2 space-y-2 border-l-4 border-violet-200 bg-violet-50/60 py-1 pl-3 pr-2 text-slate-700"
      {...markdownDomProps(props as Record<string, unknown>)}
    >
      {children}
    </blockquote>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-xs text-slate-100"
      {...markdownDomProps(props as Record<string, unknown>)}
    >
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const dom = markdownDomProps(props as Record<string, unknown>);
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return (
        <code className={`block bg-transparent p-0 font-mono text-xs leading-relaxed text-inherit ${className || ""}`} {...dom}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-slate-200/90 px-1 py-0.5 font-mono text-[0.85em] text-slate-900" {...dom}>
        {children}
      </code>
    );
  },
  br: (props) => <br className="block" {...markdownDomProps(props as Record<string, unknown>)} />,
};

type Props = {
  source: string;
  /** Classes sur le conteneur (ex. taille de texte). */
  className?: string;
};

export default function AgentMessageMarkdown({ source, className = "" }: Props) {
  const text = normalizeLooseMarkdown(String(source ?? ""));
  if (!text.trim()) return null;
  return (
    <div className={`agent-message-md max-w-none break-words [overflow-wrap:anywhere] ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkBreaks]} components={bubbleComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
