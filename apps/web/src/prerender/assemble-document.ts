import type { DehydratedState } from "@tanstack/react-query";

// Assembles a prerendered HTML document from the CLIENT build's
// dist/index.html. Using the built file as the template - not a copy -
// means the hashed script/stylesheet tags, modulepreloads and gtag
// stripping are always exactly what the deployed SPA uses; the assembler
// only swaps the marked regions.

export interface AssembleInput {
  /** The built dist/index.html (after Vite's transforms). */
  template: string;
  /** Replacement for the pm-meta block (build-head.ts). */
  headHtml: string;
  /** renderToString output for the page (entry-server.tsx). */
  appHtml: string;
  /** react-query state to embed for the client take-over. */
  dehydratedState: DehydratedState;
}

const META_BLOCK = /<!-- pm-meta:start -->[\s\S]*?<!-- pm-meta:end -->/;
const THEME_BLOCK = /<!-- pm-theme:start -->[\s\S]*?<!-- pm-theme:end -->/;
const HTML_OPEN = '<html lang="en">';
const ROOT_DIV = '<div id="root"></div>';

/** `</script>`-safe serialization for the inline state payload. */
function serializePayload(dehydratedState: DehydratedState): string {
  return JSON.stringify({ v: 1, dehydratedState }).replaceAll("<", "\\u003c");
}

export function assembleDocument(input: AssembleInput): string {
  const { template, headHtml, appHtml, dehydratedState } = input;

  for (const [name, needle] of [
    ["pm-meta markers", META_BLOCK],
    ["pm-theme markers", THEME_BLOCK],
    ["html open tag", HTML_OPEN],
    ["root div", ROOT_DIV],
  ] as const) {
    if (
      typeof needle === "string"
        ? !template.includes(needle)
        : !needle.test(template)
    ) {
      throw new Error(`Prerender template is missing the ${name}`);
    }
  }

  return (
    template
      .replace(META_BLOCK, headHtml)
      // Every prerendered URL is an fc-theme route (fc-theme.ts): bake the
      // class the ContentThemeClass effect would apply and drop the
      // pre-paint dark-mode script - fc-theme has no dark variant, so a
      // stored dark preference must not flash html.dark.fc-theme over
      // real first-paint content.
      .replace(THEME_BLOCK, "")
      .replace(HTML_OPEN, '<html lang="en" class="fc-theme">')
      .replace(
        ROOT_DIV,
        `<script>window.__PM_PRERENDER__ = ${serializePayload(dehydratedState)};</script>\n    <div id="root">${appHtml}</div>`,
      )
  );
}
