/**
 * Browser push subscription lifecycle for the matchday PWA.
 *
 * Lives in `lib/` rather than the notifications feature because
 * `auth-client.ts` has to tear a subscription down on sign-out and on
 * an account switch, and a lib module must not import a feature module.
 * The React binding stays in `features/notifications/use-push.ts`.
 *
 * The invariant this module enforces: a PushSubscription in the browser
 * is only ever reported as "on" for the account it is registered to
 * server-side. PushManager itself knows nothing about accounts, so on a
 * shared device an endpoint left behind by the previous user would
 * otherwise read as subscribed for whoever signs in next while the
 * pushes kept going to the previous user.
 */

import { api, API_BASE, callApi } from "@/lib/api-client.js";

// Shared with public/push-handler.js: the SW reads this Cache entry on
// `pushsubscriptionchange` to re-subscribe + re-register after the push
// service rotates an endpoint. Window and SW share Cache storage per
// origin, so this is the durable handoff for config the SW can't read
// from import.meta.env. Keep the names in sync with push-handler.js.
const PUSH_CONFIG_CACHE = "push-config-v1";
const PUSH_CONFIG_KEY = "/__push-config__";

async function storePushConfig(vapidPublicKey: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(PUSH_CONFIG_CACHE);
    await cache.put(
      PUSH_CONFIG_KEY,
      new Response(JSON.stringify({ apiBase: API_BASE, vapidPublicKey }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    // Best-effort: without it, a post-rotation re-subscribe just falls
    // back to the user re-enabling manually (the pre-existing behaviour).
  }
}

async function clearPushConfig(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(PUSH_CONFIG_CACHE);
  } catch {
    // ignore
  }
}

export type Support =
  | { supported: true; permission: NotificationPermission }
  | { supported: false; reason: string };

/**
 * Synchronous browser capability check. Exported so the UI can render
 * the support/permission copy on first paint, without waiting for the
 * async subscription + ownership lookup.
 */
export function detectSupport(): Support {
  if (typeof window === "undefined") {
    return { supported: false, reason: "ssr" };
  }
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "no_service_worker" };
  }
  if (!("PushManager" in window)) {
    return { supported: false, reason: "no_push_manager" };
  }
  if (!("Notification" in window)) {
    return { supported: false, reason: "no_notification_api" };
  }
  return { supported: true, permission: Notification.permission };
}

function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const aView = new Uint8Array(a);
  const bView = new Uint8Array(b);
  for (let i = 0; i < aView.length; i++) {
    if (aView[i] !== bView[i]) return false;
  }
  return true;
}

// Convert the base64url-encoded VAPID public key the API hands us into
// the raw Uint8Array<ArrayBuffer> that PushManager.subscribe() expects.
// Backed by a real ArrayBuffer (not ArrayBufferLike) so the DOM types
// accept it as a BufferSource without an `as` escape hatch.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

// base64url-encode raw key bytes - inverse of urlBase64ToUint8Array. Used
// to recover the stored VAPID key from an existing subscription's
// applicationServerKey when backfilling config for devices that
// subscribed before the pushsubscriptionchange recovery path shipped.
function urlBase64FromBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Devices that enabled push before the SW recovery path shipped have a
// live subscription but no stashed config, so a pushsubscriptionchange
// would no-op for them. Backfill from the subscription's own
// applicationServerKey (no network round-trip) the first time we see it.
async function backfillPushConfig(sub: PushSubscription): Promise<void> {
  if (typeof caches === "undefined") return;
  const key = sub.options.applicationServerKey;
  if (!key) return;
  try {
    const cache = await caches.open(PUSH_CONFIG_CACHE);
    if (await cache.match(PUSH_CONFIG_KEY)) return; // already stored
  } catch {
    return;
  }
  await storePushConfig(urlBase64FromBytes(key));
}

/** The browser's own subscription for this origin, or null. */
async function getLocalSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Endpoints registered to the *currently signed-in* user, or `null` when
 * the API could not be reached (offline, 401, 5xx). `null` means "cannot
 * prove ownership", which every caller treats as "not ours".
 */
async function fetchRegisteredEndpoints(): Promise<Set<string> | null> {
  try {
    const { subscriptions } = await callApi(
      api.GET("/api/me/push-subscriptions"),
    );
    return new Set(subscriptions.map((sub) => sub.endpoint));
  } catch {
    return null;
  }
}

/**
 * Kill the browser-side subscription and the stashed SW config, without
 * touching the server. Used when the row we would want to delete belongs
 * to a different account, so the authenticated DELETE isn't available to
 * us: unsubscribing at the push service makes the next dispatch to that
 * endpoint return 404/410, and the dispatcher prunes the row then
 * (`deletePushSubscriptionByEndpoint`).
 *
 * Clearing the config is what stops a later `pushsubscriptionchange`
 * from resurrecting the subscription and re-registering it (PR #444).
 */
async function dropLocalPushSubscription(sub: PushSubscription): Promise<void> {
  await clearPushConfig();
  try {
    await sub.unsubscribe();
  } catch {
    // Best-effort. The config is gone either way, so nothing will
    // re-register this endpoint, and the state read below reports it as
    // not subscribed for this account.
  }
}

export interface PushState {
  support: Support;
  // null while react-query is still resolving the SW registration check.
  subscribed: boolean | null;
}

/**
 * Report `subscribed: true` only when the browser's local subscription
 * is registered against the signed-in account.
 *
 * Offline behaviour: if the endpoint list can't be fetched we report
 * "not subscribed" rather than trusting the local subscription. It's the
 * safe direction - claiming "this device will receive matchday push" to
 * someone whose account has no such row is exactly the bug this fixes,
 * and the recovery is one tap on Enable (which reuses the existing
 * browser subscription and re-registers the endpoint).
 */
export async function readPushState(): Promise<PushState> {
  const support = detectSupport();
  if (!support.supported) return { support, subscribed: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { support, subscribed: false };
    await backfillPushConfig(sub);
    const registered = await fetchRegisteredEndpoints();
    return { support, subscribed: registered?.has(sub.endpoint) ?? false };
  } catch {
    return { support, subscribed: false };
  }
}

/**
 * Reconcile this device's push subscription with the account that just
 * became active. Call on any identity change the app detects.
 *
 * We deliberately do NOT re-key the endpoint onto the new user: push is
 * a consent decision, so the new user gets "not subscribed" and an
 * Enable button rather than silently inheriting someone else's alerts.
 *
 * Skipped when nobody is signed in (`userId === null`). A session ending
 * without an explicit sign-out is usually just an expired cookie on a
 * personal device, and dropping the subscription there would silently
 * turn off notifications for the person who is about to sign back in.
 * The explicit sign-out path tears the subscription down itself, and a
 * genuine account switch is caught on the next signed-in boot, before
 * any UI renders.
 */
export async function reconcilePushSubscriptionForUser(
  userId: string | null,
): Promise<void> {
  if (!userId) return;
  const sub = await getLocalSubscription();
  if (!sub) return;
  const registered = await fetchRegisteredEndpoints();
  if (registered?.has(sub.endpoint)) return;
  await dropLocalPushSubscription(sub);
}

// Walks the browser through permission -> subscribe -> register on
// the server. Returns the endpoint on success so callers can show a
// confirmation chip.
export async function enablePushOnThisDevice(): Promise<{
  endpoint: string;
}> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported on this device.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notification permission is blocked. Re-enable it in the browser site settings to receive push."
        : "Notification permission not granted.",
    );
  }

  const reg = await navigator.serviceWorker.ready;
  // Pull the VAPID public key from the API rather than baking it into
  // the bundle - lets us rotate the keypair without a matchday rebuild.
  const { publicKey } = await callApi(api.GET("/api/push/public-key"));
  const serverKey = urlBase64ToUint8Array(publicKey);

  // Existing subscription? Reuse it only if it was created with the
  // *current* VAPID key. After a key rotation the old subscription is
  // still in PushManager but the push service will reject any sends to
  // it - so unsubscribe + re-subscribe with the new key transparently.
  let existing = await reg.pushManager.getSubscription();
  if (existing) {
    const existingKey = existing.options.applicationServerKey;
    if (!existingKey || !bytesEqual(existingKey, serverKey.buffer)) {
      await existing.unsubscribe();
      existing = null;
    }
  }
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey,
    }));

  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("Push subscription is missing key material.");
  }

  // Re-registering an endpoint that some other account still owns
  // re-keys the row onto the caller (see `upsertPushSubscription`), so
  // the previous user stops receiving on a device they no longer use.
  await callApi(
    api.POST("/api/me/push-subscriptions", {
      body: {
        endpoint: json.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: navigator.userAgent.slice(0, 500),
      },
    }),
  );

  // Hand the SW what it needs to re-subscribe + re-register itself after
  // the push service rotates this endpoint (pushsubscriptionchange).
  await storePushConfig(publicKey);

  return { endpoint: json.endpoint };
}

export async function disablePushOnThisDevice(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  // Drop the stashed config first - unconditionally, even if the local
  // subscription has already expired/disappeared - so a later
  // pushsubscriptionchange can't resurrect a subscription the user just
  // turned off.
  await clearPushConfig();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  // Best-effort server cleanup before we yank the local subscription -
  // if the server call fails the worst case is a stale row that gets
  // pruned at first 410 from the push service.
  try {
    await callApi(
      api.DELETE("/api/me/push-subscriptions", {
        body: { endpoint: sub.endpoint },
      }),
    );
  } catch {
    // ignore - local unsubscribe still proceeds
  }
  await sub.unsubscribe();
}
