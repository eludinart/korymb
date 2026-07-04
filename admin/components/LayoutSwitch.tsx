"use client";

import { usePathname } from "next/navigation";
import AppChrome from "./AppChrome";
import PublicShell from "./PublicShell";

const PUBLIC_EXACT = new Set(["/", "/login", "/register"]);

function isPublicRoute(pathname: string) {
  return PUBLIC_EXACT.has(pathname);
}

export default function LayoutSwitch({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  if (isPublicRoute(pathname)) {
    return <PublicShell>{children}</PublicShell>;
  }
  return <AppChrome>{children}</AppChrome>;
}
