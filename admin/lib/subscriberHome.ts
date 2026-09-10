"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "./api";
import type { StorefrontPublic } from "./storefront";

export function useSubscriberHome() {
  return useQuery({
    queryKey: ["subscriber-home"],
    queryFn: async () => {
      const { data } = await requestJson("/subscriber/home", { headers: agentHeaders() });
      return data as StorefrontPublic;
    },
  });
}

/** Charge l’espace participant et corrige le slug d’URL s’il ne correspond plus. */
export function useSubscriberSpace(slug: string | undefined) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const home = useSubscriberHome();

  useEffect(() => {
    const actual = home.data?.slug;
    if (!actual || !slug || actual === slug) return;
    const tail = pathname.replace(/^\/a\/[^/]+/, "") || "";
    router.replace(`/a/${encodeURIComponent(actual)}${tail}`);
  }, [home.data?.slug, pathname, router, slug]);

  return home;
}
