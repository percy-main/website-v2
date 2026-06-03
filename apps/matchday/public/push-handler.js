/* global self, clients, caches, fetch */
// Web Push handler for matchday. Imported by the generateSW-produced
// service worker via vite-plugin-pwa's workbox.importScripts. Lives as
// a plain script (not bundled by Vite) because it's loaded with
// importScripts() into the SW global - no module syntax allowed.
//
// Payload contract: the API sends JSON.stringify({ title, body, url, tag }).
// Anything else is treated as a bare title-only push.
//
// Config (the cross-origin API base + current VAPID key) is stashed into
// the Cache below by the enable flow (use-push.ts) - the SW can't read
// import.meta.env and a pushsubscriptionchange can fire with no client
// open, so a window→SW shared Cache entry is the durable handoff.

// Keep in sync with use-push.ts.
const PUSH_CONFIG_CACHE = "push-config-v1";
const PUSH_CONFIG_KEY = "/__push-config__";

// base64url → Uint8Array for PushManager.subscribe()'s applicationServerKey.
// Mirror of the helper in use-push.ts (can't import across the SW boundary).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = self.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

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
              return;
            } catch {
              // navigate() is restricted to same-origin and can also be
              // disallowed if the tab is suspended; fall through to
              // openWindow rather than leaving the user looking at the
              // wrong page in the focused tab.
            }
          } else {
            // No navigate() (older browsers): focusing the existing tab
            // is the best we can do.
            return;
          }
        }
      }
      if (clients.openWindow) {
        await clients.openWindow(targetUrl);
      }
    })(),
  );
});

// The push service periodically rotates or expires a subscription's
// endpoint and fires `pushsubscriptionchange` in the SW. Without this
// handler the subscription silently dies: the next server send hits the
// dead endpoint, gets a 410, and the row is pruned - leaving the user
// "enabled" in the browser but with nothing registered server-side, and
// no notifications. Re-subscribe with the stored VAPID key and re-register
// the fresh endpoint so delivery survives a rotation transparently.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      let config;
      try {
        const cache = await caches.open(PUSH_CONFIG_CACHE);
        const res = await cache.match(PUSH_CONFIG_KEY);
        if (!res) return; // never enabled on this device - nothing to do
        config = await res.json();
      } catch {
        return;
      }
      const { apiBase, vapidPublicKey } = config ?? {};
      if (!apiBase || !vapidPublicKey) return;

      let subscription;
      try {
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      } catch {
        // Permission revoked or push otherwise unavailable - the server
        // prunes the dead endpoint on its next 410. Re-enable is manual.
        return;
      }

      const json = subscription.toJSON();
      const keys = json.keys || {};
      if (!json.endpoint || !keys.p256dh || !keys.auth) return;

      try {
        // apiBase already includes the `/api` prefix (it's VITE_API_URL,
        // e.g. https://api.v2.percymain.org/api), so this resolves to
        // /api/me/push-subscriptions - the same route the typed client
        // hits. Cross-origin to the API subdomain; credentials carry the
        // cross-subdomain session cookie (CORS-allowlisted for matchday).
        const res = await fetch(`${apiBase}/me/push-subscriptions`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
            userAgent: (self.navigator && self.navigator.userAgent
              ? self.navigator.userAgent
              : ""
            ).slice(0, 500),
          }),
        });
        // A 401 (expired session) or other non-2xx is best-effort: the new
        // endpoint stays unregistered until the user next opens the app,
        // where the enable flow / backfill re-syncs it. Don't pretend a
        // failed POST succeeded - just nothing more we can do from the SW.
        if (!res.ok) return;
      } catch {
        // network error - same best-effort fallback as a non-2xx response
      }
    })(),
  );
});
