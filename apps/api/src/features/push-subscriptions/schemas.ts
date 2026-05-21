import { z } from "zod";

// Push-service hostnames we trust as subscription endpoints. Browsers
// only return endpoints under these domains today; restricting at the
// API layer stops an authenticated user from registering an attacker-
// controlled URL that the server would then POST to (SSRF). When a new
// browser engine ships, add its host suffix here.
const TRUSTED_PUSH_HOST_SUFFIXES = [
  "googleapis.com", // FCM (Chrome, Edge, Brave, Opera, Android)
  "push.apple.com", // Apple Push (Safari / iOS PWA)
  "mozilla.com", // Mozilla autopush (Firefox)
  "mozaws.net", // Mozilla autopush (Firefox)
  "windows.com", // WNS (legacy Edge)
];

function isTrustedPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return TRUSTED_PUSH_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

const pushEndpointSchema = z
  .url()
  .refine(isTrustedPushEndpoint, "Endpoint host is not a known push service");

// Mirrors the PushSubscriptionJSON shape returned by PushManager.subscribe()
// in the browser. The browser produces keys + endpoint as opaque strings;
// we store them verbatim and pass them back to web-push at send time.
export const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(200),
});

export const createPushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: pushSubscriptionKeysSchema,
  userAgent: z.string().max(500).optional(),
});

export const createPushSubscriptionResponseSchema = z.object({
  id: z.string(),
});

export const deletePushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
});

export const deletePushSubscriptionResponseSchema = z.object({
  deleted: z.boolean(),
});

export const vapidPublicKeyResponseSchema = z.object({
  publicKey: z.string().min(1),
});
