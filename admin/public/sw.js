/* Korymb PWA — service worker minimal (installabilité Chrome).
 * Pas de cache agressif : on laisse Next servir le réseau pour éviter les builds périmés.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Un gestionnaire fetch est requis pour que Chrome propose « Installer l'application ».
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
