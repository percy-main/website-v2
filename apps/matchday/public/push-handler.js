/* global self, clients */
// Web Push handler for matchday. Imported by the generateSW-produced
// service worker via vite-plugin-pwa's workbox.importScripts. Lives as
// a plain script (not bundled by Vite) because it's loaded with
// importScripts() into the SW global - no module syntax allowed.
//
// Payload contract: the API sends JSON.stringify({ title, body, url, tag }).
// Anything else is treated as a bare title-only push.

self.addEventListener("push", (event) => {
  let payload = { title: "Percy Main", body: "" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "Percy Main", body: event.data.text() };
    }
  }

  const title = payload.title || "Percy Main";
  const options = {
    body: payload.body || "",
    icon: "/images/favicon/web-app-manifest-192x192.png",
    badge: "/images/favicon/web-app-manifest-192x192.png",
    tag: payload.tag,
    // Re-alerting on a replaced toast feels right for matchday - new
    // availability ping or a re-send should re-vibrate even if the old
    // notification is still on screen.
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer focusing an already-open matchday tab and navigating it
      // to the target URL - cheaper than spinning a fresh window and
      // keeps the user's session warm.
      for (const client of all) {
        if (client.url && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // navigate() is restricted to same-origin; fall back to
              // opening a new window below.
            }
          }
          return;
        }
      }
      if (clients.openWindow) {
        await clients.openWindow(targetUrl);
      }
    })(),
  );
});
