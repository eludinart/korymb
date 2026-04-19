import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { API } from "../korymbApi";
import { FRONTEND_APP_VERSION, FRONTEND_REVISION_AT } from "../appVersion";

function formatRevisionInstant(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  });
}

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/mission/nouvelle", label: "Nouvelle mission" },
  { to: "/mission/guided", label: "Mission guidée" },
];

function navLinkActive(pathname, to) {
  if (to === "/dashboard") return pathname === "/dashboard";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Layout({ children }) {
  const { pathname } = useLocation();
  const [backendMeta, setBackendMeta] = useState({
    revision: null,
    revision_at: null,
    code_dir: null,
  });
  /** Dev : /health minimal (sans revision/code_dir) = souvent une vieille instance sur le meme port. */
  const [healthHint, setHealthHint] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const applyPayload = (d, headerRev) => {
      if (cancelled || !d) return;
      const revFromBody =
        d.revision != null ? String(d.revision) : d.version != null ? String(d.version) : null;
      const hdr = headerRev != null ? String(headerRev).trim() : "";
      // Le vrai Korymb expose X-Korymb-Version ; en cas de vieille instance sur le meme port, le corps peut rester en 3.0.0.
      const rev = hdr || revFromBody;
      const at = d.revision_at != null ? String(d.revision_at) : null;
      const codeDir = d.code_dir != null ? String(d.code_dir) : null;
      setBackendMeta({ revision: rev, revision_at: at, code_dir: codeDir });
    };
    const run = () => {
      const url = `${API}/health?_=${Date.now()}`;
      fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } })
        .then((r) => {
          if (!r.ok || cancelled) return null;
          const headerRev = r.headers.get("X-Korymb-Version") || r.headers.get("x-korymb-version");
          return r.json().then((d) => ({ d, headerRev }));
        })
        .then((payload) => {
          if (cancelled) return;
          if (!payload?.d) {
            setBackendMeta({ revision: null, revision_at: null, code_dir: null });
            setHealthHint(null);
            return;
          }
          const d = payload.d;
          if (import.meta.env.DEV && d.revision == null && d.code_dir == null) {
            setHealthHint(
              "Reponse /health minimale : un autre service peut occuper ce port (plusieurs LISTEN sous Windows). Change le port (ex. .env + restart) ou ferme les anciens uvicorn.",
            );
          } else {
            setHealthHint(null);
          }
          applyPayload(d, payload.headerRev);
        })
        .catch(() => {
          if (!cancelled) {
            setBackendMeta({ revision: null, revision_at: null, code_dir: null });
            setHealthHint(null);
          }
        });
    };
    run();
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-base font-bold tracking-tight text-slate-900">Korymb</span>
            <p className="text-[10px] text-slate-500 leading-snug space-y-0.5">
              <span
                className="block font-mono tabular-nums"
                title="SemVer du backend (major.minor.patch). Ex. 3.0.6 = trois · zéro · six — ce n’est pas « 3.6 »."
              >
                <span className="text-slate-400">Serveur (API)</span>{" "}
                <span className="text-slate-700 font-semibold">
                  rév.{" "}
                  {backendMeta.revision === null ? (
                    "…"
                  ) : (
                    <span className="font-mono tracking-tight">
                      v{backendMeta.revision || "—"}
                    </span>
                  )}
                </span>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-600">{formatRevisionInstant(backendMeta.revision_at)}</span>
              </span>
              {import.meta.env.DEV ? (
                <span
                  className="block text-[9px] text-slate-500 font-mono truncate max-w-[min(100vw-3rem,52rem)]"
                  title="URL utilisee pour GET /health (doit etre le meme port que uvicorn)"
                >
                  GET {API}/health
                </span>
              ) : null}
              {import.meta.env.DEV && healthHint ? (
                <span className="block text-[9px] text-red-700/90 leading-snug max-w-[min(100vw-3rem,52rem)]">
                  {healthHint}
                </span>
              ) : null}
              {import.meta.env.DEV && backendMeta.code_dir ? (
                <span
                  className="block text-[9px] text-amber-700/90 font-mono truncate max-w-[min(100vw-3rem,52rem)]"
                  title={backendMeta.code_dir}
                >
                  API code : {backendMeta.code_dir}
                </span>
              ) : null}
              <span
                className="block font-mono tabular-nums"
                title="SemVer du bundle Vite (indépendant du backend)."
              >
                <span className="text-slate-400">Interface (client)</span>{" "}
                <span className="text-slate-700 font-semibold">
                  rév. <span className="font-mono tracking-tight">v{FRONTEND_APP_VERSION}</span>
                </span>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-600">{formatRevisionInstant(FRONTEND_REVISION_AT)}</span>
              </span>
            </p>
          </div>
          <nav className="flex gap-1 shrink-0">
            {NAV.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  navLinkActive(pathname, to)
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
