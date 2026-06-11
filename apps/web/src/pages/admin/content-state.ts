// Shared admin-content display helpers, used by the flat content list
// (content-tab) and the page tree (pages-tab) so both render the same
// badge treatment.

/**
 * What the row means editorially, not the raw status: a published item
 * with a future published_at is Scheduled, not Live. The Live/Scheduled
 * split is a client-side now() comparison - fine for the admin list; the
 * public visibility decision stays server-side (publishedOnly()).
 */
export type DisplayState = "draft" | "scheduled" | "live" | "archived";

export function displayState(item: {
  status: string;
  publishedAt: string | null;
}): DisplayState {
  if (item.status === "archived") return "archived";
  if (item.status !== "published") return "draft";
  return item.publishedAt !== null && Date.parse(item.publishedAt) > Date.now()
    ? "scheduled"
    : "live";
}

export const STATE_BADGES: Record<
  DisplayState,
  { label: string; variant: "default" | "secondary" | "outline" | "info" }
> = {
  live: { label: "Live", variant: "default" },
  scheduled: { label: "Scheduled", variant: "info" },
  draft: { label: "Draft", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
};

/**
 * URL params are user input: anything that isn't a UUID degrades to the
 * default rather than reaching the typed API call.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
