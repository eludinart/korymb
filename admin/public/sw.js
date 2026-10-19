/* Korymb — retire le service worker qui bloquait le lancement sur téléphone.
 * L'ancien fetch handler rejetait la navigation (écran violet). On se désinscrit
 * et on laisse le navigateur charger les pages tout seul.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })(),
  );
});

self.addEventListener("fetch", () => {
  /* Ne pas appeler respondWith : la navigation doit rester au navigateur. */
});
