import { CUSTOM_BLOCK_TYPES } from "@percy-main/shared/content";
import { describe, expect, it, vi } from "vitest";

// The editor schema is constructed at module load by createReactBlockSpec
// calls that use @blocknote/react and @blocknote/shadcn. Neither package
// functions outside a browser/JSDOM environment, so we stub the parts
// that touch DOM APIs.  We only need the schema's blockSpecs keys - the
// actual block render functions are irrelevant to this assertion.

vi.mock("@blocknote/react", () => ({
  createReactBlockSpec: (config: { type: string }) => () => ({
    config,
    implementation: {},
  }),
  getDefaultReactSlashMenuItems: () => [],
  SuggestionMenuController: () => null,
  useCreateBlockNote: () => ({}),
}));

vi.mock("@blocknote/core", () => ({
  BlockNoteSchema: {
    create: (opts: { blockSpecs: Record<string, unknown> }) => ({
      blockSpecs: opts.blockSpecs,
      BlockNoteEditor: null,
      PartialBlock: null,
    }),
  },
  defaultBlockSpecs: {
    paragraph: {},
    heading: {},
    bulletListItem: {},
    numberedListItem: {},
    checkListItem: {},
    table: {},
    codeBlock: {},
    quote: {},
    image: {},
    video: {},
    audio: {},
    file: {},
  },
  filterSuggestionItems: (_items: unknown[], _query: string) => [],
  insertOrUpdateBlockForSlashMenu: () => undefined,
}));

vi.mock("@blocknote/shadcn", () => ({
  BlockNoteView: () => null,
}));

vi.mock("@blocknote/core/fonts/inter.css", () => ({}));
vi.mock("@blocknote/shadcn/style.css", () => ({}));

// Stub all downstream imports that touch Vite-specific transforms or DOM.
vi.mock("@/lib/people.js", () => ({
  getAllPeople: () => [],
  getPersonBySlug: () => undefined,
}));
vi.mock("@/lib/use-people.js", () => ({
  usePeople: () => new Map<string, never>(),
  usePeopleList: () => [],
}));
vi.mock("@/lib/image-map.js", () => ({
  getImageUrl: () => undefined,
  getPicture: () => undefined,
}));
vi.mock("@/components/leaderboard-content.js", () => ({
  LeaderboardContent: () => null,
}));
vi.mock("@/components/records-wall.js", () => ({
  RecordsWall: () => null,
}));
vi.mock("@/lib/marketing/consent.js", () => ({
  CURRENT_CONSENT_VERSION: "v3",
  requestConsentReopen: () => undefined,
}));
vi.mock("@/lib/content-images.js", () => ({
  uploadContentImage: () => Promise.resolve({}),
}));
vi.mock("@/lib/api-client.js", () => ({
  api: {},
  callApi: () => Promise.resolve({}),
}));
vi.mock("@/hooks/use-has-permission.js", () => ({
  useHasPermission: () => ({ allowed: false }),
}));
vi.mock("./content-kind-labels.js", () => ({
  CONTENT_KIND_NOUNS: {},
}));
vi.mock("./pages-tab.lib.js", () => ({
  buildPageTree: () => [],
  visibleNodes: () => [],
}));

// Dynamic import so vi.mock calls above are hoisted before module execution.
const { schema } = await import("./content-editor.js");

describe("content-editor schema", () => {
  it("registers a blockSpec for every CUSTOM_BLOCK_TYPES value", () => {
    const registeredKeys = new Set(Object.keys(schema.blockSpecs));
    for (const blockType of Object.values(CUSTOM_BLOCK_TYPES)) {
      expect(registeredKeys, `missing blockSpec for "${blockType}"`).toContain(
        blockType,
      );
    }
  });
});
