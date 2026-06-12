import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shared card shell lives in mdx-components, which transitively
// imports the people corpus (.mdx files) and the vite-imagetools image
// map, neither of which exists outside a Vite build - stub the lookups,
// the editor only needs their shapes.
vi.mock("@/lib/people.js", () => ({
  getPersonBySlug: () => undefined,
  getAllPeople: () => [
    {
      slug: "alex-slaven",
      name: "Alex Slaven",
      photo: undefined,
      photoPicture: undefined,
    },
    {
      slug: "bob-jones",
      name: "Bob Jones",
      photo: undefined,
      photoPicture: undefined,
    },
  ],
}));
vi.mock("@/lib/image-map.js", () => ({
  getImageUrl: () => undefined,
  getPicture: () => undefined,
}));
vi.mock("@/lib/marketing/consent.js", () => ({
  CURRENT_CONSENT_VERSION: "v3",
  requestConsentReopen: () => undefined,
}));

import type { PersonGridEntry } from "@/lib/person-grid.js";
import { PersonGridEditor } from "./person-grid-editor.js";

// usePeople rides a react-query list query (disabled here, so the
// merged roster is just the static corpus stub above).
function renderGrid(entries: PersonGridEntry[]): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <PersonGridEditor
        entries={entries}
        onWrite={() => {
          /* static render - never fired */
        }}
      />
    </QueryClientProvider>,
  );
}

describe("PersonGridEditor", () => {
  it("renders a card per entry with an inline role input", () => {
    const html = renderGrid([
      { slug: "alex-slaven", role: "Captain" },
      { slug: "bob-jones" },
    ]);
    expect(html).toContain("Alex Slaven");
    expect(html).toContain("Bob Jones");
    expect(html).toContain('aria-label="Role shown for Alex Slaven"');
    expect(html).toContain('value="Captain"');
    // Role-less entries get an empty input, not "undefined".
    expect(html).toContain('aria-label="Role shown for Bob Jones"');
    expect(html).not.toContain("undefined");
  });

  it("falls back to the slug as the name for unknown people", () => {
    const html = renderGrid([{ slug: "mystery-person" }]);
    expect(html).toContain("mystery-person");
    expect(html).toContain('aria-label="Role shown for mystery-person"');
  });

  it("renders a remove button on every card", () => {
    const html = renderGrid([
      { slug: "alex-slaven" },
      { slug: "mystery-person" },
    ]);
    expect(html).toContain('aria-label="Remove Alex Slaven from the grid"');
    expect(html).toContain('aria-label="Remove mystery-person from the grid"');
  });

  it("shows the add card while people remain to be added", () => {
    const html = renderGrid([{ slug: "alex-slaven" }]);
    expect(html).toContain('aria-label="Add a person to the grid"');
    expect(html).toContain("Add person");
  });

  it("shows only the add card for an empty grid", () => {
    const html = renderGrid([]);
    expect(html).toContain('aria-label="Add a person to the grid"');
    expect(html).not.toContain("Role shown for");
  });

  it("hides the add card once everyone is in the grid", () => {
    const html = renderGrid([{ slug: "alex-slaven" }, { slug: "bob-jones" }]);
    expect(html).not.toContain("Add a person to the grid");
  });
});
