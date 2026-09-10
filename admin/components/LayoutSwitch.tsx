"use client";

import { usePathname } from "next/navigation";
import AppChrome from "./AppChrome";
import PublicShell from "./PublicShell";
import SubscriberShell from "./SubscriberShell";

const PUBLIC_EXACT = new Set(["/", "/login", "/register", "/confidentialite", "/cgu"]);

function isPublicRoute(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return pathname === "/p" || pathname.startsWith("/p/");
}

function isSubscriberRoute(pathname: string) {
  return pathname === "/a" || pathname.startsWith("/a/");
}

export default function LayoutSwitch({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  if (isPublicRoute(pathname)) {
    return <PublicShell>{children}</PublicShell>;
  }
  if (isSubscriberRoute(pathname)) {
    return <SubscriberShell>{children}</SubscriberShell>;
  }
  return <AppChrome>{children}</AppChrome>;
}
