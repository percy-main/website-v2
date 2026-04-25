export interface LeadSlackContext {
  baseUrl: string;
  campaignId: string;
  segment?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  leadId: string;
}

export function createLeadSlackNotifier(slackWebhookUrl?: string) {
  return async (lead: LeadSlackContext): Promise<void> => {
    if (!slackWebhookUrl) return;

    const noteLine = lead.notes ? `\n> ${lead.notes.split("\n")[0]}` : "";
    const segmentLine = lead.segment ? ` (${lead.segment})` : "";
    const adminLink = `${lead.baseUrl.replace(/\/$/, "")}/admin/leads/${lead.leadId}`;
    const text = [
      `*New lead* — ${lead.name} <${lead.email}>${lead.phone ? ` · ${lead.phone}` : ""}`,
      `Campaign: ${lead.campaignId}${segmentLine}`,
      `Admin: ${adminLink}`,
      noteLine,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch {
      // Fire-and-forget — Slack failures must not affect the API response.
    }
  };
}
