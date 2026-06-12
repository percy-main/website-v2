import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shared card shell lives in mdx-components, which transitively
// imports the vite-imagetools image map, which doesn't exist outside a
// Vite build - stub the lookups, the editor only needs their shapes.
vi.mock("@/lib/image-map.js", () => ({
  getImageUrl: () => undefined,
  getPicture: () => undefined,
}));
vi.mock("@/lib/marketing/consent.js", () => ({
  CURRENT_CONSENT_VERSION: "v3",
  requestConsentReopen: () => undefined,
}));

import { peopleListQueryOptions } from "@/lib/content-queries.js";
import type { PersonGridEntry } from "@/lib/person-grid.js";
import type { ReactNode } from "react";
import { PersonEditor, PersonGridEditor } from "./person-editors.js";

// usePeople rides a react-query list query (disabled here); the roster
// is primed straight into the cache.
const rosterItem = (slug: string, title: string) => ({
  id: slug,
  slug,
  title,
  description: null,
  metadata: { isDBSChecked: false, hasLeftClub: false },
  publishedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const ROSTER = {
  items: [
    rosterItem("alex-slaven", "Alex Slaven"),
    rosterItem("bob-jones", "Bob Jones"),
  ],
  removed: [] as string[],
};

function render(children: ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  queryClient.setQueryData(peopleListQueryOptions().queryKey, ROSTER);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

function renderGrid(entries: PersonGridEntry[]): string {
  return render(
    <PersonGridEditor
      entries={entries}
      onWrite={() => {
        /* static render - never fired */
      }}
    />,
  );
}

function renderPerson(slug: string, role: string): string {
  return render(
    <PersonEditor
      slug={slug}
      role={role}
      onChange={() => {
        /* static render - never fired */
      }}
    />,
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

describe("PersonEditor", () => {
  it("renders a dashed picker card while no person is chosen", () => {
    const html = renderPerson("", "");
    expect(html).toContain('aria-label="Choose a person to display"');
    expect(html).toContain("Choose person");
    expect(html).not.toContain("Role shown for");
  });

  it("renders the card with an inline role input and a remove button", () => {
    const html = renderPerson("alex-slaven", "Captain");
    expect(html).toContain("Alex Slaven");
    expect(html).toContain('aria-label="Role shown for Alex Slaven"');
    expect(html).toContain('value="Captain"');
    expect(html).toContain('aria-label="Remove Alex Slaven"');
    expect(html).not.toContain("Choose a person to display");
  });

  it("falls back to the slug as the name for unknown people", () => {
    const html = renderPerson("mystery-person", "");
    expect(html).toContain("mystery-person");
    expect(html).toContain('aria-label="Role shown for mystery-person"');
  });
});
