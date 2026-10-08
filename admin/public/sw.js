/* Korymb PWA — service worker minimal (installabilité Chrome).
 * Pas de cache : Next sert le réseau, pour ne pas figer un build périmé.
 *
 * Ne pas appeler event.respondWith(fetch(event.request)).
 * Sur téléphone, Chrome lance des requêtes « only-if-cached » que fetch()
 * dans le worker rejette. L'application installée reste alors sur l'écran
 * violet, alors que le site répond. Un listener fetch vide suffit à Chrome
 * pour proposer l'installation.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", () => {
  /* Laisser le navigateur gérer le réseau. */
});
