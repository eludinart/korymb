"use client";

import { useEffect, useState, type ReactNode } from "react";

export function PracticeMediaCard({
  coverUrl,
  title,
  children,
  footer,
  featured = false,
  compact = false,
}: {
  coverUrl?: string | null;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  featured?: boolean;
  compact?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [coverUrl]);
  const height = featured ? (compact ? "h-36" : "h-48 sm:h-56") : compact ? "h-28" : "h-36";
  const showImage = Boolean(coverUrl) && !broken;

  return (
    <article className="practice-card practice-media-card overflow-hidden">
      <div className={`practice-media-frame relative ${height}`}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl || ""}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="practice-media-fallback absolute inset-0" aria-hidden />
        )}
        <div className="practice-media-scrim absolute inset-x-0 bottom-0 h-1/2" aria-hidden />
      </div>
      <div className={featured ? "p-5" : "px-4 py-4"}>
        <h3 className={`practice-heading font-bold text-slate-900 ${featured ? "text-xl" : "text-base"}`}>{title}</h3>
        {children}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </div>
    </article>
  );
}
