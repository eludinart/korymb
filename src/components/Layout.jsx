import React from "react";
import { Link, useLocation } from "react-router-dom";

const NAV = [{ to: "/dashboard", label: "QG" }];

export default function Layout({ children }) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-base font-bold tracking-tight text-slate-900">Korymb</span>
          <nav className="flex gap-1">
            {NAV.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  pathname === to
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
