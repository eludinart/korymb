"use client";

import AgentMessageMarkdown from "../AgentMessageMarkdown";
import { contactFieldLabel } from "../../lib/contactReachability";
import { httpHref, mailtoHref, mapsHref, telHref } from "../../lib/contactLinks";

const MARKDOWN_KEYS = new Set(["outreach_suggestions", "notes_append"]);
const LINK_KEYS = new Set(["website", "linkedin_url"]);

export function unwrapMarkdownFence(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  const whole = s.match(/^```[a-z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n```(?:\s*[-–—]*)?\s*$/i);
  if (whole) return whole[1].trim();
  const inner = s.match(/```[a-z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (inner) return inner[1].trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-z0-9_-]*\s*/i, "").replace(/\s*```[\s-–—]*$/, "");
  }
  return s.trim();
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

function External({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="break-all font-medium text-emerald-800 underline">
      {children}
    </a>
  );
}

function SocialList({ value }: { value: Record<string, string> }) {
  const rows = Object.entries(value)
    .map(([k, v]) => [k, String(v || "").trim()] as const)
    .filter(([, v]) => v);
  if (!rows.length) return <span className="text-slate-400">—</span>;
  return (
    <ul className="space-y-1.5">
      {rows.map(([key, url]) => {
        const href = httpHref(url);
        return (
          <li key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {contactFieldLabel(key)}
            </span>
            {href ? <External href={href}>{displayUrl(url)}</External> : <span className="break-all">{url}</span>}
          </li>
        );
      })}
    </ul>
  );
}

type Props = {
  field: string;
  value: unknown;
  tone?: "current" | "proposed";
};

export default function ContactEnrichmentValue({ field, value }: Props) {
  if (field === "socials" && value && typeof value === "object") {
    return <SocialList value={value as Record<string, string>} />;
  }

  const text = String(value ?? "").trim();
  if (!text || text === "—") return <span className="text-slate-400">—</span>;

  if (MARKDOWN_KEYS.has(field)) {
    return (
      <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-sm text-slate-800">
        <AgentMessageMarkdown source={unwrapMarkdownFence(text)} />
      </div>
    );
  }

  if (field === "email") {
    const href = mailtoHref(text);
    return href ? <External href={href}>{text}</External> : <>{text}</>;
  }
  if (field === "phone") {
    const href = telHref(text);
    return href ? (
      <a href={href} className="font-medium text-emerald-800 underline">
        {text}
      </a>
    ) : (
      <>{text}</>
    );
  }
  if (LINK_KEYS.has(field)) {
    const href = httpHref(text);
    return href ? <External href={href}>{displayUrl(text)}</External> : <>{text}</>;
  }
  if (field === "address") {
    const href = mapsHref([text]);
    return href ? <External href={href}>{text}</External> : <>{text}</>;
  }

  return <span className="whitespace-pre-wrap break-words text-slate-800">{text}</span>;
}
