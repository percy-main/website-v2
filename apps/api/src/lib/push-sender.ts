import webPush from "web-push";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  // Used by the service worker to coalesce repeated notifications for
  // the same logical event (e.g. multiple devices receiving the same
  // availability request) into a single visible toast.
  tag?: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendPushResult =
  | { ok: true; endpoint: string }
  | { ok: false; endpoint: string; gone: boolean; reason: string };

export type SendPush = (
  subscription: PushSubscriptionInput,
  payload: PushPayload,
) => Promise<SendPushResult>;

export interface CreatePushSenderConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function createPushSender(config: CreatePushSenderConfig): SendPush {
  // VAPID details are passed inline per-send rather than via
  // setVapidDetails(), which eagerly validates the public key shape -
  // useful in production, but fatal at OpenAPI-generation boot where
  // we feed placeholder strings into the same config schema. Inline
  // details defer validation to the first real send.
  const vapidDetails = {
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  };

  return async (subscription, payload) => {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { vapidDetails },
      );
      return { ok: true, endpoint: subscription.endpoint };
    } catch (err) {
      const statusCode =
        err && typeof err === "object" && "statusCode" in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      // 404 (Not Found) and 410 (Gone) mean the push service has dropped
      // this subscription permanently - the browser uninstalled the SW,
      // the user revoked permission, or the endpoint expired. Caller
      // hard-deletes the row so we never retry it.
      const gone = statusCode === 404 || statusCode === 410;
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, endpoint: subscription.endpoint, gone, reason };
    }
  };
}
