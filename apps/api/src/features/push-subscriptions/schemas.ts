import { z } from "zod";

// Mirrors the PushSubscriptionJSON shape returned by PushManager.subscribe()
// in the browser. The browser produces keys + endpoint as opaque strings;
// we store them verbatim and pass them back to web-push at send time.
export const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export const createPushSubscriptionSchema = z.object({
  endpoint: z.url(),
  keys: pushSubscriptionKeysSchema,
  userAgent: z.string().max(500).optional(),
});

export const createPushSubscriptionResponseSchema = z.object({
  id: z.string(),
});

export const deletePushSubscriptionSchema = z.object({
  endpoint: z.url(),
});

export const deletePushSubscriptionResponseSchema = z.object({
  deleted: z.boolean(),
});

export const vapidPublicKeyResponseSchema = z.object({
  publicKey: z.string().min(1),
});
