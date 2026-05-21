# ADR 045: Matchday service worker push integration via importScripts

## Status

Accepted

## Context

Matchday's PWA is built by `vite-plugin-pwa` in `generateSW` mode. The generated service worker handles precaching, workbox runtime caching for GET endpoints used pitch-side, BackgroundSync for the captain's write endpoints, and a "tap to reload on new version" toast. None of that machinery is hand-written - it falls out of the existing workbox config in `apps/matchday/vite.config.ts`.

Adding Web Push (#379) means the SW needs two extra event listeners:

```js
self.addEventListener("push", (event) => { ... });
self.addEventListener("notificationclick", (event) => { ... });
```

Workbox-generated service workers do not include those listeners on their own.

## Decision

Keep `generateSW` and layer the push handler in via `workbox.importScripts`. The handler lives at `apps/matchday/public/push-handler.js`, gets served at `/push-handler.js`, and is loaded into the generated SW via `importScripts("/push-handler.js")` at SW boot.

## Problem

Two ways exist to ship custom SW code with `vite-plugin-pwa`:

1. Switch to `injectManifest`, which lets us write the entire SW by hand and import workbox modules à la carte.
2. Stay on `generateSW` and inject extra scripts via `workbox.importScripts`.

Pushing to (1) is the "standard" migration path the docs nudge you towards for non-trivial custom logic. We deliberately did not.

## Options considered

1. **`generateSW` + `workbox.importScripts: ['/push-handler.js']`** (chosen). Workbox config is unchanged. The push-handler is a plain JS file in `public/`, dropped into the generated SW at boot time.
2. **Switch to `injectManifest` and write a custom `sw.ts`.** Requires re-implementing the existing precache + runtimeCaching + backgroundSync setup in TypeScript using direct workbox imports.
3. **Inline the push listener into the React app** via the `useRegisterSW` callback. Does not actually work - push and notificationclick handlers must be on the SW global, not the page.

## Rationale

Option 1 wins because:

- The existing workbox config has eight runtime-caching rules and three BackgroundSync rules, all tuned for pitch-side use (see `vite.config.ts` lines 80-171). Rewriting all of that to call `precacheAndRoute`, `registerRoute`, `NetworkOnly` with `BackgroundSyncPlugin`, etc. by hand is a fair amount of code to maintain forever just to add two listeners.
- The handler is a flat ~50 LOC of platform API calls (`registration.showNotification`, `clients.matchAll`, `clients.openWindow`). There is no app code to share with it - it does not import from `@/` and does not need bundling.
- `workbox.importScripts` is a first-class workbox-build option, not a workaround. It maps directly to `self.importScripts(...)` in the generated SW.
- We get to keep "tap to reload on update" via `vite-plugin-pwa`'s `useRegisterSW` without rewiring the React shell.

The trade-off is that the push handler is plain JS, not bundled or type-checked against our codebase. That is fine: it is a SW global; it cannot import from `@/`; and the payload contract (`{ title, body, url, tag }`) lives in `apps/api/src/lib/push-sender.ts` where the producer side is type-checked. The handler does its own try/catch around `event.data.json()` so a malformed payload does not crash the SW.

## Rejected alternatives

- **`injectManifest`** - rejected on cost. We would adopt this if the SW grew enough TypeScript-shaped logic that the duplication-with-workbox-config became worse than re-implementing the cache rules. As of #379 there is none.
- **Inline page-side listener** - does not work; mentioned only to flag it as a non-starter so the next person does not try.

## Related

- The push-handler script source: `apps/matchday/public/push-handler.js`. It is loaded into both the dev SW (when enabled) and the production-built SW (`dist/sw.js`).
- Push payload contract enforced server-side: `apps/api/src/lib/push-sender.ts` `PushPayload`.
- VAPID public key is fetched at subscribe time rather than baked into the bundle - see [ADR 046](046-vapid-public-key-via-api.md).
