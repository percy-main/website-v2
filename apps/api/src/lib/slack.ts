/**
 * Minimal Slack incoming-webhook sender for background workers.
 *
 * The request-scoped notifiers (contact, incident-report, marketing) each
 * build a message and post it from inside a route handler. This one exists
 * for code with no request to hang off - the scheduled Play Cricket sync -
 * so it takes plain text and nothing else.
 *
 * Unlike those three it checks the response status. A webhook that has been
 * revoked or pointed at a deleted channel answers 404/410 rather than
 * failing the fetch, and an alerting path that silently accepts that is
 * worse than no alerting at all.
 */

const TIMEOUT_MS = 10_000;

/**
 * Static-message error so New Relic groups every webhook failure together;
 * status and body live as properties.
 */
export class SlackWebhookError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyPreview: string,
  ) {
    super("slack_webhook_error");
    this.name = "SlackWebhookError";
  }
}

/**
 * Returns a sender that resolves `true` when Slack accepted the message and
 * `false` when no webhook is configured, so callers can tell "delivered"
 * from "nowhere to deliver to" and log accordingly. Delivery failures throw.
 */
export function createSlackNotifier(webhookUrl?: string) {
  return async (text: string): Promise<boolean> => {
    if (!webhookUrl) return false;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      // A hung webhook must not eat into the sync's 10-minute deadline.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SlackWebhookError(res.status, body.slice(0, 200));
    }

    return true;
  };
}

export type SlackNotifier = ReturnType<typeof createSlackNotifier>;
