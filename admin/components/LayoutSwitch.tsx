"use client";

import { usePathname } from "next/navigation";
import AppChrome from "./AppChrome";
import PublicShell from "./PublicShell";
import PullToRefresh from "./PullToRefresh";
import SubscriberShell from "./SubscriberShell";

const PUBLIC_EXACT = new Set(["/", "/login", "/register", "/ouvrir", "/confidentialite", "/cgu"]);

function isPublicRoute(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return pathname === "/p" || pathname.startsWith("/p/");
}

function isSubscriberRoute(pathname: string) {
  return pathname === "/a" || pathname.startsWith("/a/");
}

export default function LayoutSwitch({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const shell = isPublicRoute(pathname) ? (
    <PublicShell>{children}</PublicShell>
  ) : isSubscriberRoute(pathname) ? (
    <SubscriberShell>{children}</SubscriberShell>
  ) : (
    <AppChrome>{children}</AppChrome>
  );

  return (
    <>
      <PullToRefresh />
      {shell}
    </>
  );
}
