import React from "react";
import { Link, useLocation } from "react-router-dom";

const NAV = [
  { to: "/dashboard", label: "QG" },
];

export default function Layout({ children }) {
  const { pathname } = useLocation();

  return (
    <div style={s.app}>
      <header style={s.header}>
        <span style={s.logo}>Korymb</span>
        <nav style={s.nav}>
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              style={{
                ...s.navLink,
                ...(pathname === to ? s.navLinkActive : {}),
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main style={s.main}>{children}</main>
    </div>
  );
}

const s = {
  app: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 960,
    margin: "0 auto",
    padding: "0 16px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 0",
    borderBottom: "1px solid #e5e7eb",
    marginBottom: 20,
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "-0.5px",
  },
  nav: {
    display: "flex",
    gap: 8,
  },
  navLink: {
    padding: "6px 14px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    textDecoration: "none",
    fontSize: 13,
    color: "#374151",
  },
  navLinkActive: {
    background: "#111",
    color: "#fff",
    borderColor: "#111",
  },
  main: {
    paddingBottom: 40,
  },
};
