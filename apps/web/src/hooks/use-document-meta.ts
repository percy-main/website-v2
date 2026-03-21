import { useEffect } from "react";

const SITE_NAME = "Percy Main Community Sports Club";
const DEFAULT_DESCRIPTION =
  "Percy Main Community Sports Club — football, cricket, boxing, running, and community sports in North Shields.";

/**
 * Sets document title and meta description for the current page.
 * Title format: "{page} | Percy Main Community Sports Club"
 * Pass `null` for title to show just the site name (home page).
 */
export function useDocumentMeta(
  title: string | null | undefined,
  description?: string,
) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE_NAME}` : SITE_NAME;

    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", description ?? DEFAULT_DESCRIPTION);
    }
  }, [title, description]);
}
