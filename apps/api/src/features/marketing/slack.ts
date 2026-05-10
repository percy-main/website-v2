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

    // No internal catch — let the caller's `.catch()` handle it so
    // failures land in NR with a structured log line. The marketing
    // route (#187) and contact service (#174) both wrap this with a
    // .catch(err => log.warn(...)) at the call site.
    await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };
}
