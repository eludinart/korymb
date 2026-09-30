"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker racine (/sw.js) pour rendre Korymb installable
 * comme application (Chrome Android), pas seulement en raccourci.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // En HTTP local hors localhost, Chrome refuse le SW — silencieux.
    const secure =
      window.isSecureContext ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";
    if (!secure) return;

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        // Force update check après deploy (SW non mis en cache longtemps côté config).
        try {
          void reg.update();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* ignore — pas bloquant pour l'UI */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
