"use client";

import { useEffect } from "react";

/**
 * Le service worker installé interceptait le réseau et empêchait l'icône
 * téléphone de s'ouvrir. On le retire ; le manifest suffit pour l'écran d'accueil.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) void reg.unregister();
    });
  }, []);

  return null;
}
