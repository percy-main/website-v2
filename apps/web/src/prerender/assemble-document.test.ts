import type { DehydratedState } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { assembleDocument } from "./assemble-document.js";

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- pm-meta:start -->
    <title>Percy Main Community Sports Club</title>
    <meta name="description" content="generic" />
    <!-- pm-meta:end -->
    <link rel="manifest" href="/images/favicon/site.webmanifest" />
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  </head>
  <body>
    <!-- pm-theme:start -->
    <script>
      (function () {
        var t = localStorage.getItem("percy-theme");
      })();
    </script>
    <!-- pm-theme:end -->
    <div id="root"></div>
  </body>
</html>
`;

const STATE = { queries: [], mutations: [] } as unknown as DehydratedState;

describe("assembleDocument", () => {
  const doc = assembleDocument({
    template: TEMPLATE,
    headHtml: "<title>Club History | Percy Main</title>",
    appHtml: "<div>rendered content</div>",
    dehydratedState: STATE,
  });

  it("swaps the pm-meta block for the page head", () => {
    expect(doc).toContain("<title>Club History | Percy Main</title>");
    expect(doc).not.toContain('content="generic"');
    expect(doc).not.toContain("pm-meta:start");
  });

  it("keeps the built asset tags untouched", () => {
    expect(doc).toContain('src="/assets/index-abc123.js"');
    expect(doc).toContain('href="/images/favicon/site.webmanifest"');
  });

  it("bakes the fc-theme class and drops the dark-mode script", () => {
    expect(doc).toContain('<html lang="en" class="fc-theme">');
    expect(doc).not.toContain("percy-theme");
    expect(doc).not.toContain("pm-theme:start");
  });

  it("injects the state payload before the rendered root", () => {
    const stateIndex = doc.indexOf("window.__PM_PRERENDER__");
    const rootIndex = doc.indexOf('<div id="root"><div>rendered content</div></div>');
    expect(stateIndex).toBeGreaterThan(-1);
    expect(rootIndex).toBeGreaterThan(stateIndex);
    expect(doc).toContain('"v":1');
  });

  it("escapes < in the embedded state so markup cannot break out", () => {
    const doc2 = assembleDocument({
      template: TEMPLATE,
      headHtml: "<title>t</title>",
      appHtml: "<div />",
      dehydratedState: {
        queries: [
          {
            queryKey: ["x"],
            queryHash: '["x"]',
            state: { data: "</script><script>alert(1)" },
          },
        ],
        mutations: [],
      } as unknown as DehydratedState,
    });
    expect(doc2).not.toContain("</script><script>alert(1)");
    expect(doc2).toContain("\\u003c/script");
  });

  it("throws when a marker is missing rather than emitting a broken document", () => {
    expect(() =>
      assembleDocument({
        template: TEMPLATE.replace("<!-- pm-meta:start -->", ""),
        headHtml: "<title>t</title>",
        appHtml: "<div />",
        dehydratedState: STATE,
      }),
    ).toThrow(/pm-meta/);
    expect(() =>
      assembleDocument({
        template: TEMPLATE.replace('<div id="root"></div>', "<div></div>"),
        headHtml: "<title>t</title>",
        appHtml: "<div />",
        dehydratedState: STATE,
      }),
    ).toThrow(/root div/);
  });
});
