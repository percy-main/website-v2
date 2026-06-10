import type { ContentKind } from "@percy-main/shared/content";

/**
 * Human noun for each content kind, used in admin UI copy ("New report",
 * "Discard unsaved changes to this article?").
 */
export const CONTENT_KIND_NOUNS: Record<ContentKind, string> = {
  page: "page",
  news: "article",
  event: "event",
  game_report: "report",
  person: "profile",
};
