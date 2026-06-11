import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";

import { ContentBody } from "@/components/content-body.js";
import { mdxComponents } from "@/components/mdx-components.js";
import {
  OptimisedImage,
  type PictureSource,
} from "@/components/optimised-image.js";
import { RadioButtons } from "@/components/radio-buttons.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useHasPermission } from "@/hooks/use-has-permission.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { uploadContentImage } from "@/lib/content-images.js";
import { getAllPeople } from "@/lib/people.js";
import {
  CONTENT_KIND_RESOURCES,
  contentBodySchema,
  CUSTOM_BLOCK_TYPES,
  type ContentKind,
} from "@percy-main/shared/content";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONTENT_KIND_NOUNS } from "./content-kind-labels.js";
import { buildPageTree, visibleNodes } from "./pages-tab.lib.js";

// ── Custom blocks ───────────────────────────────────────────────────────
//
// Type names come from shared CUSTOM_BLOCK_TYPES so the public renderer
// maps them 1:1. Each block renders the real public component read-only
// in-editor, with minimal prop controls underneath.

const personBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.person,
    propSchema: {
      slug: { default: "" },
      role: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <div className="my-2 flex w-full max-w-xs flex-col gap-2">
        {block.props.slug ? (
          <mdxComponents.Person
            slug={block.props.slug}
            role={block.props.role || undefined}
          />
        ) : (
          <p className="text-sm text-stone-500">Choose a person…</p>
        )}
        <select
          aria-label="Person"
          value={block.props.slug}
          onChange={(e) => {
            editor.updateBlock(block, {
              props: { ...block.props, slug: e.target.value },
            });
          }}
          className="rounded border border-stone-300 bg-white p-1 text-sm"
        >
          <option value="">Choose a person…</option>
          {getAllPeople().map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Role shown on the card"
          placeholder="Role (optional)"
          value={block.props.role}
          onChange={(e) => {
            editor.updateBlock(block, {
              props: { ...block.props, role: e.target.value },
            });
          }}
          className="rounded border border-stone-300 bg-white p-1 text-sm"
        />
      </div>
    ),
  },
);

const gamePreviewBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.gamePreview,
    propSchema: {
      playCricketId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <div className="my-2 w-full">
        {block.props.playCricketId ? (
          <mdxComponents.GamePreview
            playCricketId={block.props.playCricketId}
          />
        ) : (
          <p className="text-sm text-stone-500">Choose a game…</p>
        )}
        <GameSelect
          value={block.props.playCricketId}
          onChange={(id) => {
            editor.updateBlock(block, {
              props: { ...block.props, playCricketId: id },
            });
          }}
        />
      </div>
    ),
  },
);

const eventPreviewBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.eventPreview,
    propSchema: {
      eventId: { default: "" },
      name: { default: "" },
      when: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const complete =
        block.props.eventId && block.props.name && block.props.when;
      const set = (key: "eventId" | "name" | "when", value: string) => {
        editor.updateBlock(block, {
          props: { ...block.props, [key]: value },
        });
      };
      return (
        <div className="my-2 flex w-full max-w-sm flex-col gap-2">
          {complete ? (
            <mdxComponents.EventPreview
              id={block.props.eventId}
              name={block.props.name}
              when={block.props.when}
            />
          ) : (
            <p className="text-sm text-stone-500">Fill in the event details…</p>
          )}
          <input
            aria-label="Event id"
            placeholder="Event id"
            value={block.props.eventId}
            onChange={(e) => {
              set("eventId", e.target.value);
            }}
            className="rounded border border-stone-300 bg-white p-1 text-sm"
          />
          <input
            aria-label="Event name"
            placeholder="Event name"
            value={block.props.name}
            onChange={(e) => {
              set("name", e.target.value);
            }}
            className="rounded border border-stone-300 bg-white p-1 text-sm"
          />
          <input
            aria-label="Event date"
            type="date"
            value={block.props.when}
            onChange={(e) => {
              set("when", e.target.value);
            }}
            className="rounded border border-stone-300 bg-white p-1 text-sm"
          />
        </div>
      );
    },
  },
);

function parsePictureProp(raw: string): PictureSource | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // Same structural floor as the public renderer: enough shape that
  // OptimisedImage cannot crash on a malformed stored descriptor.
  const candidate = parsed as {
    sources?: unknown;
    img?: { src?: unknown; w?: unknown; h?: unknown };
  };
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.img?.src !== "string" ||
    typeof candidate.img.w !== "number" ||
    typeof candidate.img.h !== "number" ||
    typeof candidate.sources !== "object" ||
    candidate.sources === null
  ) {
    return null;
  }
  return candidate as PictureSource;
}

const contentImageBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.contentImage,
    propSchema: {
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      picture: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const picture = parsePictureProp(block.props.picture);
      return (
        <figure className="my-2 flex w-full max-w-lg flex-col gap-2">
          {picture ? (
            <OptimisedImage
              picture={picture}
              alt={block.props.alt}
              className="h-auto max-w-full rounded-lg"
              sizes="(max-width: 512px) 100vw, 512px"
            />
          ) : block.props.src ? (
            <img
              src={block.props.src}
              alt={block.props.alt}
              className="h-auto max-w-full rounded-lg"
            />
          ) : (
            <p className="text-sm text-stone-500">Image uploading…</p>
          )}
          <input
            aria-label="Caption"
            placeholder="Caption (optional)"
            value={block.props.caption}
            onChange={(e) => {
              editor.updateBlock(block, {
                props: { ...block.props, caption: e.target.value },
              });
            }}
            className="rounded border border-stone-300 bg-white p-1 text-sm"
          />
          <input
            aria-label="Alt text for screen readers"
            placeholder="Describe the photo (alt text)"
            value={block.props.alt}
            onChange={(e) => {
              editor.updateBlock(block, {
                props: { ...block.props, alt: e.target.value },
              });
            }}
            className="rounded border border-stone-300 bg-white p-1 text-sm"
          />
        </figure>
      );
    },
  },
);

// BlockNote's built-in media blocks are removed: their URL-embed tab
// would bypass the consent + EXIF-strip + responsive pipeline that the
// contentImage block (slash menu "Upload photo") goes through.
const {
  image: _image,
  video: _video,
  audio: _audio,
  file: _file,
  ...allowedDefaultBlocks
} = defaultBlockSpecs;

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...allowedDefaultBlocks,
    [CUSTOM_BLOCK_TYPES.person]: personBlock(),
    [CUSTOM_BLOCK_TYPES.gamePreview]: gamePreviewBlock(),
    [CUSTOM_BLOCK_TYPES.eventPreview]: eventPreviewBlock(),
    [CUSTOM_BLOCK_TYPES.contentImage]: contentImageBlock(),
  },
});

type Editor = typeof schema.BlockNoteEditor;
type PartialBlock = typeof schema.PartialBlock;

// ── Games picker (shared by metadata form + gamePreview block) ──────────

function GameSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const season = new Date().getFullYear();
  const { data: games } = useQuery({
    queryKey: ["games", season],
    queryFn: () =>
      callApi(api.GET("/api/games", { params: { query: { season } } })),
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Choose a game…" />
      </SelectTrigger>
      <SelectContent>
        {(games ?? []).map((game) => (
          <SelectItem key={game.id} value={game.id}>
            {game.team.name} vs {game.opposition.club.name} · {game.matchDate}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Editor screen ───────────────────────────────────────────────────────

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Club-content entries for the slash menu (module-level: no state). */
function buildSlashItems(editor: Editor, startImageUpload: () => void) {
  return [
    {
      title: "Person card",
      subtext: "Embed a club member profile card",
      group: "Club content",
      aliases: ["person", "player", "profile"],
      icon: <span aria-hidden>👤</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.person,
        });
      },
    },
    {
      title: "Game preview",
      subtext: "Link a Play-Cricket fixture or result",
      group: "Club content",
      aliases: ["game", "match", "fixture"],
      icon: <span aria-hidden>🏏</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.gamePreview,
        });
      },
    },
    {
      title: "Event preview",
      subtext: "Link a calendar event",
      group: "Club content",
      aliases: ["event", "calendar"],
      icon: <span aria-hidden>📅</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.eventPreview,
        });
      },
    },
    {
      title: "Upload photo",
      subtext: "Add an image (consent required)",
      group: "Club content",
      aliases: ["image", "photo", "picture"],
      icon: <span aria-hidden>📷</span>,
      onItemClick: startImageUpload,
    },
  ];
}

interface EditorProps {
  kind: ContentKind;
  contentId: string | null;
  /** Pages only: preset parent for a new child (?parent= URL param). */
  newParentId?: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export default function ContentEditor({
  kind,
  contentId,
  newParentId = null,
  onClose,
  onCreated,
}: EditorProps) {
  const {
    data: item,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin", "content", "detail", contentId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/content/{contentId}", {
          params: { path: { contentId: contentId ?? "" } },
        }),
      ),
    enabled: contentId !== null,
  });

  if (contentId !== null && error) {
    return (
      <div className="flex flex-col items-start gap-2 py-8">
        <p className="text-sm text-red-600">
          Couldn't load this item - {error.message}
        </p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ← Back to list
        </Button>
      </div>
    );
  }

  if (contentId !== null && (isLoading || !item)) {
    return <p className="py-8 text-sm text-stone-500">Loading…</p>;
  }

  return (
    <LoadedEditor
      key={contentId ?? "new"}
      kind={kind}
      item={item ?? null}
      newParentId={newParentId}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

// Derived from the generated OpenAPI types per house rule - never a
// hand-written response interface.
type ContentItemDetail =
  paths["/api/admin/content/{contentId}"]["get"]["responses"][200]["content"]["application/json"];

interface FormState {
  title: string;
  slug: string;
  description: string;
  // game_report
  playCricketId: string;
  // page - menuOrder stays a string while typing; ldjson is the raw
  // textarea value (validated/parsed only when building the payload)
  menuOrder: string;
  isMainMenu: boolean;
  hideTitle: boolean;
  ldjson: string;
  parentId: string | null;
  // news
  tags: string[];
  authorSlug: string;
  // event - datetimes are datetime-local values in UK wall-clock time
  when: string;
  finish: string;
  hasLocation: boolean;
  locationName: string;
  locationStreet: string;
  locationCity: string;
  locationPostcode: string;
  locationLat: string;
  locationLon: string;
}

// ── Per-kind metadata: hydrate / validate / build ───────────────────────

/** Event times are stored as instants but authored as UK wall-clock. */
const EVENT_TZ = "Europe/London";

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const asNumberString = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

/**
 * Stored ISO instant -> the wall-clock value a datetime-local input
 * expects, in UK time - so what the author sees never depends on their
 * machine timezone.
 */
function isoToUkLocal(iso: unknown): string {
  if (typeof iso !== "string" || iso === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatInTimeZone(date, EVENT_TZ, "yyyy-MM-dd'T'HH:mm");
}

/** Inverse: UK wall-clock from a datetime-local input -> ISO instant. */
function ukLocalToIso(value: string): string {
  return fromZonedTime(value, EVENT_TZ).toISOString();
}

/** Human-readable UK-time rendering of a stored instant. */
function formatUkTime(iso: string): string {
  return formatInTimeZone(
    new Date(iso),
    EVENT_TZ,
    "d MMM yyyy, HH:mm 'UK time'",
  );
}

/**
 * Hydrate per-kind fields from stored metadata. Defensive on purpose:
 * stored JSON may predate the current schema, so anything malformed
 * degrades to the field default rather than crashing the editor.
 */
function initialForm(
  item: ContentItemDetail | null,
  newParentId: string | null,
): FormState {
  const metadata = item?.metadata ?? {};
  const location =
    typeof metadata.location === "object" && metadata.location !== null
      ? (metadata.location as Record<string, unknown>)
      : null;
  return {
    title: item?.title ?? "",
    slug: item?.slug ?? "",
    description: item?.description ?? "",
    playCricketId: asString(metadata.playCricketId),
    menuOrder: asNumberString(metadata.menuOrder) || "99",
    isMainMenu: metadata.isMainMenu === true,
    hideTitle: metadata.hideTitle === true,
    ldjson:
      typeof metadata.ldjson === "object" && metadata.ldjson !== null
        ? JSON.stringify(metadata.ldjson, null, 2)
        : "",
    parentId: item !== null ? item.parentId : newParentId,
    tags: Array.isArray(metadata.tags)
      ? metadata.tags.filter(
          (tag): tag is string => typeof tag === "string" && tag !== "",
        )
      : [],
    authorSlug: asString(metadata.authorSlug),
    when: isoToUkLocal(metadata.when),
    finish: isoToUkLocal(metadata.finish),
    hasLocation: location !== null,
    locationName: asString(location?.name),
    locationStreet: asString(location?.street),
    locationCity: asString(location?.city),
    locationPostcode: asString(location?.postcode),
    locationLat: asNumberString(location?.lat),
    locationLon: asNumberString(location?.lon),
  };
}

const isBlankOrNumeric = (value: string) =>
  value.trim() === "" || !Number.isNaN(Number(value.trim()));

/** Parsed ldjson object, or null when the textarea isn't a JSON object. */
function parseLdjson(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Client-side floor for per-kind metadata the API would 400 without
 * (the server revalidates everything). Returns the message shown on the
 * disabled save button, or null when the metadata is saveable.
 */
function metadataProblem(kind: ContentKind, form: FormState): string | null {
  if (kind === "game_report" && !form.playCricketId) {
    return "Choose a Play-Cricket game first";
  }
  if (kind === "page") {
    const menuOrder = Number(form.menuOrder.trim());
    if (
      form.menuOrder.trim() === "" ||
      !Number.isInteger(menuOrder) ||
      menuOrder < 0 ||
      menuOrder > 999
    ) {
      return "Menu order must be a whole number from 0 to 999";
    }
    if (form.ldjson.trim() !== "" && parseLdjson(form.ldjson.trim()) === null) {
      return "Structured data must be a valid JSON object (or left empty)";
    }
  }
  if (kind === "event") {
    if (!form.when) return "Set the event start time first";
    if (form.hasLocation) {
      if (
        !form.locationName.trim() ||
        !form.locationStreet.trim() ||
        !form.locationCity.trim() ||
        !form.locationPostcode.trim()
      ) {
        return "Fill in the location fields (or untick Has location)";
      }
      if (
        !isBlankOrNumeric(form.locationLat) ||
        !isBlankOrNumeric(form.locationLon)
      ) {
        return "Latitude and longitude must be numbers";
      }
    }
  }
  return null;
}

/**
 * Metadata payload per kind, matching the shared metadata schemas.
 * Optional fields are omitted when unset - never sent as "".
 */
function buildMetadata(
  kind: ContentKind,
  form: FormState,
): Record<string, unknown> {
  if (kind === "page") {
    const ldjson = form.ldjson.trim();
    return {
      menuOrder: Number(form.menuOrder.trim()),
      isMainMenu: form.isMainMenu,
      hideTitle: form.hideTitle,
      // Omitted entirely when empty - never an empty string for "no value".
      ...(ldjson !== "" ? { ldjson: parseLdjson(ldjson) } : {}),
    };
  }
  if (kind === "news") {
    return {
      tags: form.tags,
      ...(form.authorSlug ? { authorSlug: form.authorSlug } : {}),
    };
  }
  if (kind === "event") {
    return {
      when: ukLocalToIso(form.when),
      ...(form.finish ? { finish: ukLocalToIso(form.finish) } : {}),
      ...(form.hasLocation
        ? {
            location: {
              name: form.locationName.trim(),
              street: form.locationStreet.trim(),
              city: form.locationCity.trim(),
              postcode: form.locationPostcode.trim(),
              ...(form.locationLat.trim() !== ""
                ? { lat: Number(form.locationLat.trim()) }
                : {}),
              ...(form.locationLon.trim() !== ""
                ? { lon: Number(form.locationLon.trim()) }
                : {}),
            },
          }
        : {}),
    };
  }
  return { playCricketId: form.playCricketId };
}

/**
 * Tags already used by items on the cached admin list pages for this
 * kind - a cheap, offline suggestion source (no extra endpoint). Tags
 * stay free-form; suggestions only aid consistency.
 */
function cachedTagSuggestions(
  queryClient: QueryClient,
  kind: ContentKind,
): string[] {
  const tags = new Set<string>();
  for (const [, data] of queryClient.getQueriesData({
    queryKey: ["admin", "content", kind],
  })) {
    const items = (data as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const itemTags = (item as { metadata?: Record<string, unknown> }).metadata
        ?.tags;
      if (!Array.isArray(itemTags)) continue;
      for (const tag of itemTags) {
        if (typeof tag === "string" && tag !== "") tags.add(tag);
      }
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

// ── Per-kind metadata inputs ────────────────────────────────────────────

function TagsInput({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className="hover:text-stone-500"
                onClick={() => {
                  onChange(tags.filter((t) => t !== tag));
                }}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id="news-tags"
        list="news-tag-suggestions"
        placeholder="Type a tag, press Enter"
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          if (!value.includes(",")) {
            setDraft(value);
            return;
          }
          // Comma commits mid-type (also handles pasted "a, b, c" lists);
          // anything after the last comma stays as the draft.
          const parts = value.split(",");
          const remainder = parts.pop() ?? "";
          const seen = new Set(tags);
          const additions: string[] = [];
          for (const part of parts) {
            const tag = part.trim();
            if (tag !== "" && !seen.has(tag)) {
              seen.add(tag);
              additions.push(tag);
            }
          }
          if (additions.length > 0) onChange([...tags, ...additions]);
          setDraft(remainder);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
      />
      <datalist id="news-tag-suggestions">
        {suggestions.flatMap((s) =>
          tags.includes(s) ? [] : [<option key={s} value={s} />],
        )}
      </datalist>
    </div>
  );
}

// Radix Select items can't have an empty value, so "no author" rides on a
// sentinel the slug grammar can never produce (no leading hyphens).
const NO_AUTHOR = "--none--";

function AuthorSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (slug: string) => void;
}) {
  const people = getAllPeople().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Select
      value={value === "" ? NO_AUTHOR : value}
      onValueChange={(next) => {
        onChange(next === NO_AUTHOR ? "" : next);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="No author" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_AUTHOR}>No author</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.slug} value={p.slug}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Radix Select items can't have an empty value, so "top level" rides on
// a sentinel the slug grammar can never produce (no leading hyphens).
const ROOT_PARENT = "--root--";

const PATH_LOCKED_HINT = "Locked after publish - path and ordering are fixed";

function PageMetadataFields({
  form,
  itemId,
  slugLocked,
  onChange,
}: {
  form: FormState;
  /** Editing target, or null when creating - excluded from the picker. */
  itemId: string | null;
  slugLocked: boolean;
  onChange: (updates: Partial<FormState>) => void;
}) {
  // Same key as the Pages tab's tree query, so opening the editor from
  // the tree hits the cache and the picker renders instantly.
  const { data } = useQuery({
    queryKey: ["admin", "content", "page-tree"],
    queryFn: () => callApi(api.GET("/api/admin/content/page-tree")),
  });
  const items = useMemo(() => data?.items ?? [], [data]);

  // Parent options: every page except this one and its descendants
  // (descendants are exactly the rows whose path extends this page's -
  // the same canonical-prefix rule the backend's cycle check uses).
  const options = useMemo(() => {
    const self = items.find((item) => item.id === itemId);
    const eligible = items.filter(
      (item) =>
        item.id !== itemId &&
        (self === undefined || !item.path.startsWith(`${self.path}/`)),
    );
    const allExpanded = new Set(eligible.map((item) => item.id));
    return visibleNodes(buildPageTree(eligible), allExpanded);
  }, [items, itemId]);

  // While the tree query is still loading, the parent's path is unknown -
  // show an ellipsis rather than implying the page sits at the root.
  const parentPath =
    form.parentId !== null
      ? (items.find((item) => item.id === form.parentId)?.path ?? "/…")
      : "";
  const pathPreview = `${parentPath}/${form.slug || "…"}`;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label>Parent page{slugLocked ? " (locked after publish)" : ""}</Label>
        <Select
          value={form.parentId ?? ROOT_PARENT}
          disabled={slugLocked}
          onValueChange={(next) => {
            onChange({ parentId: next === ROOT_PARENT ? null : next });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Top level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROOT_PARENT}>Top level (no parent)</SelectItem>
            {options.map((node) => (
              <SelectItem key={node.item.id} value={node.item.id}>
                {"\u00A0".repeat(node.depth * 3)}
                {node.item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {slugLocked ? (
          <span className="text-xs text-stone-500">{PATH_LOCKED_HINT}</span>
        ) : (
          <span className="text-xs text-stone-500">
            Page address: <span className="font-mono">{pathPreview}</span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="page-menu-order">Menu order (0-999)</Label>
        <Input
          id="page-menu-order"
          inputMode="numeric"
          value={form.menuOrder}
          onChange={(e) => {
            onChange({ menuOrder: e.target.value });
          }}
        />
        <span className="text-xs text-stone-500">
          Lower numbers appear first among sibling pages.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="page-is-main-menu"
          checked={form.isMainMenu}
          onCheckedChange={(value) => {
            onChange({ isMainMenu: value === true });
          }}
        />
        <Label htmlFor="page-is-main-menu">Show in the main menu</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="page-hide-title"
          checked={form.hideTitle}
          onCheckedChange={(value) => {
            onChange({ hideTitle: value === true });
          }}
        />
        <Label htmlFor="page-hide-title">Hide the title heading</Label>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="page-ldjson">Structured data (JSON-LD, optional)</Label>
        <Textarea
          id="page-ldjson"
          rows={4}
          className="font-mono text-xs"
          placeholder='{"@context": "https://schema.org", …}'
          value={form.ldjson}
          onChange={(e) => {
            onChange({ ldjson: e.target.value });
          }}
        />
      </div>
    </>
  );
}

function MetadataFields({
  kind,
  form,
  itemId,
  slugLocked,
  tagSuggestions,
  onChange,
}: {
  kind: ContentKind;
  form: FormState;
  itemId: string | null;
  slugLocked: boolean;
  tagSuggestions: string[];
  onChange: (updates: Partial<FormState>) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="content-title">Title</Label>
        <Input
          id="content-title"
          value={form.title}
          onChange={(e) => {
            onChange({ title: e.target.value });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="content-slug">
          Slug{slugLocked ? " (locked after publish)" : ""}
        </Label>
        <Input
          id="content-slug"
          value={form.slug}
          disabled={slugLocked}
          onChange={(e) => {
            onChange({ slug: e.target.value });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="content-description">Description (optional)</Label>
        <Textarea
          id="content-description"
          rows={2}
          value={form.description}
          onChange={(e) => {
            onChange({ description: e.target.value });
          }}
        />
      </div>
      {kind === "page" && (
        <PageMetadataFields
          form={form}
          itemId={itemId}
          slugLocked={slugLocked}
          onChange={onChange}
        />
      )}
      {kind === "game_report" && (
        <div className="flex flex-col gap-1">
          <Label>Play-Cricket game</Label>
          <GameSelect
            value={form.playCricketId}
            onChange={(playCricketId) => {
              onChange({ playCricketId });
            }}
          />
          {form.playCricketId && (
            <span className="text-xs text-stone-500">
              Match id: {form.playCricketId}
            </span>
          )}
        </div>
      )}
      {kind === "news" && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="news-tags">Tags</Label>
            <TagsInput
              tags={form.tags}
              suggestions={tagSuggestions}
              onChange={(tags) => {
                onChange({ tags });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Author (optional)</Label>
            <AuthorSelect
              value={form.authorSlug}
              onChange={(authorSlug) => {
                onChange({ authorSlug });
              }}
            />
          </div>
        </>
      )}
      {kind === "event" && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-when">Starts (UK time)</Label>
            <Input
              id="event-when"
              type="datetime-local"
              value={form.when}
              onChange={(e) => {
                onChange({ when: e.target.value });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-finish">Finishes (UK time, optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="event-finish"
                type="datetime-local"
                value={form.finish}
                onChange={(e) => {
                  onChange({ finish: e.target.value });
                }}
              />
              {form.finish && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange({ finish: "" });
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="event-has-location"
              checked={form.hasLocation}
              onCheckedChange={(value) => {
                onChange({ hasLocation: value === true });
              }}
            />
            <Label htmlFor="event-has-location">Has location</Label>
          </div>
          {form.hasLocation && (
            <div className="flex flex-col gap-3 rounded-lg border border-stone-200 p-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-location-name">Venue name</Label>
                <Input
                  id="event-location-name"
                  value={form.locationName}
                  onChange={(e) => {
                    onChange({ locationName: e.target.value });
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-location-street">Street</Label>
                <Input
                  id="event-location-street"
                  value={form.locationStreet}
                  onChange={(e) => {
                    onChange({ locationStreet: e.target.value });
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-location-city">City</Label>
                <Input
                  id="event-location-city"
                  value={form.locationCity}
                  onChange={(e) => {
                    onChange({ locationCity: e.target.value });
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-location-postcode">Postcode</Label>
                <Input
                  id="event-location-postcode"
                  value={form.locationPostcode}
                  onChange={(e) => {
                    onChange({ locationPostcode: e.target.value });
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="event-location-lat">Lat (optional)</Label>
                  <Input
                    id="event-location-lat"
                    inputMode="decimal"
                    value={form.locationLat}
                    onChange={(e) => {
                      onChange({ locationLat: e.target.value });
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="event-location-lon">Lon (optional)</Label>
                  <Input
                    id="event-location-lon"
                    inputMode="decimal"
                    value={form.locationLon}
                    onChange={(e) => {
                      onChange({ locationLon: e.target.value });
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

type PublishAction =
  | { action: "publish"; publishedAt?: string }
  | { action: "unpublish" }
  | { action: "archive" };

/** setTimeout clamps delays beyond a signed 32-bit int (~24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Scheduled = published with a still-future publish time. Client-side
 * now() comparison is fine here: it only picks the admin copy and
 * actions; the public visibility decision stays server-side.
 */
function isScheduled(item: {
  status: string;
  publishedAt: string | null;
}): boolean {
  return (
    item.status === "published" &&
    item.publishedAt !== null &&
    Date.parse(item.publishedAt) > Date.now()
  );
}

/**
 * Ever-live = published_at is in the past, i.e. the public has (or could
 * have) seen this item at its URL. The server enforces the matching
 * invariant - an ever-live item can only be published immediately, since
 * re-scheduling it would silently pull a page that WAS public - so the
 * dialog never offers "Schedule for later" here. Mutually exclusive with
 * isScheduled (that needs a FUTURE published_at).
 */
function hasBeenLive(item: { publishedAt: string | null }): boolean {
  return (
    item.publishedAt !== null && Date.parse(item.publishedAt) <= Date.now()
  );
}

/**
 * Why the schedule can't be confirmed yet, or null when it can. A
 * schedule must be in the future at confirm time. (The server accepts
 * any instant - re-publishing with a past date is a valid backdate.)
 */
function scheduleProblemFor(
  mode: "now" | "schedule",
  scheduleAt: string,
): string | null {
  if (mode !== "schedule") return null;
  if (scheduleAt === "") return "Pick a date and time first";
  return fromZonedTime(scheduleAt, EVENT_TZ).getTime() <= Date.now()
    ? "The scheduled time must be in the future"
    : null;
}

function PublishingCard({
  item,
  canPublish,
  canManage,
  beforePublish,
}: {
  item: ContentItemDetail;
  canPublish: boolean;
  canManage: boolean;
  /** Persists the editor's current state; publish aborts if it fails. */
  beforePublish: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  // UK wall-clock datetime-local value (same convention as event times).
  const [scheduleAt, setScheduleAt] = useState("");

  const scheduled = isScheduled(item);
  const everLive = hasBeenLive(item);

  // Flip Scheduled -> Live on our own when the publish time passes with
  // the editor open: isScheduled() reads Date.now() at render time only,
  // and a stale "Scheduled" card promises a slug unlock the server
  // (correctly, on the DB clock) would no longer grant. The mutation
  // flow is already server-authoritative; this only keeps the card's
  // state and copy honest.
  const [, setBoundaryTick] = useState(0);
  const publishedAtMs =
    item.publishedAt !== null ? Date.parse(item.publishedAt) : null;
  useEffect(() => {
    if (publishedAtMs === null) return;
    // Small slack so the re-render lands safely on the live side of the
    // boundary. Delays past the setTimeout clamp are skipped - a
    // schedule that far out doesn't need an in-session flip.
    const delay = publishedAtMs - Date.now() + 250;
    if (delay <= 0 || delay > MAX_TIMEOUT_MS) return;
    const timer = setTimeout(() => {
      setBoundaryTick((tick) => tick + 1);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [publishedAtMs]);

  const statusMutation = useMutation({
    mutationFn: async (input: PublishAction) => {
      if (input.action === "publish") {
        // What goes live must be what's in the editor (and what the
        // preview tab shows), not the last-saved state.
        await beforePublish();
        // "Publish now" sends no publishedAt: the server keeps a past
        // live-from date and replaces NULL or a future schedule with
        // now() on its own clock.
        await callApi(
          api.POST("/api/admin/content/{contentId}/publish", {
            params: { path: { contentId: item.id } },
            body: input.publishedAt ? { publishedAt: input.publishedAt } : {},
          }),
        );
      } else if (input.action === "unpublish") {
        await callApi(
          api.POST("/api/admin/content/{contentId}/unpublish", {
            params: { path: { contentId: item.id } },
          }),
        );
      } else {
        await callApi(
          api.POST("/api/admin/content/{contentId}/archive", {
            params: { path: { contentId: item.id } },
          }),
        );
      }
    },
    onSuccess: (_result, input) => {
      if (input.action === "publish") setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
      // Public pages cache content under ["content", ...] with a 5 minute
      // staleTime; drop those too so a publish/unpublish shows up on the
      // live site without waiting out the cache.
      void queryClient.invalidateQueries({ queryKey: ["content"] });
    },
  });

  const openPublishDialog = () => {
    statusMutation.reset();
    if (scheduled && item.publishedAt) {
      // "Change schedule" starts from the current scheduled time.
      setMode("schedule");
      setScheduleAt(isoToUkLocal(item.publishedAt));
    } else {
      setMode("now");
      setScheduleAt("");
    }
    setDialogOpen(true);
  };

  // If the publish boundary passes while the dialog is open in schedule
  // mode, the item is now ever-live and only immediate publishing is
  // valid - collapse to "now" rather than submitting a schedule the
  // server would 409.
  const effectiveMode = everLive ? "now" : mode;

  const scheduleProblem = scheduleProblemFor(effectiveMode, scheduleAt);

  const confirmPublish = () => {
    statusMutation.mutate(
      effectiveMode === "schedule"
        ? { action: "publish", publishedAt: ukLocalToIso(scheduleAt) }
        : { action: "publish" },
    );
  };

  const mutationError = statusMutation.error && (
    <p className="text-sm text-red-600">
      {statusMutation.error instanceof Error
        ? statusMutation.error.message
        : "Action failed"}
    </p>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Publishing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {scheduled && item.publishedAt ? (
          <p className="text-sm text-stone-600">
            Status: <strong>scheduled</strong> · goes live{" "}
            {formatUkTime(item.publishedAt)}
          </p>
        ) : (
          <p className="text-sm text-stone-600">
            Status: <strong>{item.status}</strong>
            {item.publishedAt &&
              ` · live from ${formatUkTime(item.publishedAt)}`}
          </p>
        )}
        {item.status !== "archived" && (canPublish || canManage) && (
          <div className="flex flex-wrap gap-2">
            {canPublish && (
              <Button
                size="sm"
                disabled={statusMutation.isPending}
                onClick={openPublishDialog}
              >
                {scheduled ? "Change schedule" : "Publish…"}
              </Button>
            )}
            {canPublish && item.status === "published" && (
              <Button
                size="sm"
                variant="outline"
                disabled={statusMutation.isPending}
                onClick={() => {
                  statusMutation.mutate({ action: "unpublish" });
                }}
              >
                {scheduled ? "Cancel schedule" : "Unpublish"}
              </Button>
            )}
            {canManage && (
              <Button
                size="sm"
                variant="destructive"
                disabled={statusMutation.isPending}
                onClick={() => {
                  statusMutation.mutate({ action: "archive" });
                }}
              >
                Archive
              </Button>
            )}
          </div>
        )}
        {scheduled && canPublish && (
          <p className="text-xs text-stone-500">
            Cancelling the schedule returns this item to draft, and the slug
            unlocks because it never went live.
          </p>
        )}
        {!dialogOpen && mutationError}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {scheduled ? "Change schedule" : "Publish"}
            </DialogTitle>
            <DialogDescription>
              {everLive
                ? "This item has been live before, so it can only be published immediately."
                : "Go live straight away, or pick a future time."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            {!everLive && (
              <RadioButtons
                id="publish-mode"
                options={[
                  {
                    title: "Publish now",
                    value: "now",
                    description: "Visible on the public site immediately",
                  },
                  {
                    title: "Schedule for later",
                    value: "schedule",
                    description:
                      "Hidden from the public site until the scheduled time",
                  },
                ]}
                value={mode}
                onChange={setMode}
              />
            )}
            {effectiveMode === "schedule" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="publish-schedule-at">Goes live (UK time)</Label>
                <Input
                  id="publish-schedule-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => {
                    setScheduleAt(e.target.value);
                  }}
                />
                {scheduleProblem !== null && scheduleAt !== "" && (
                  <p className="text-sm text-red-600">{scheduleProblem}</p>
                )}
              </div>
            )}
            {mutationError}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={statusMutation.isPending || scheduleProblem !== null}
              title={scheduleProblem ?? undefined}
              onClick={confirmPublish}
            >
              {statusMutation.isPending
                ? "Publishing…"
                : effectiveMode === "schedule"
                  ? "Schedule"
                  : "Publish now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ConsentBox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <Checkbox
        id="photo-consent"
        checked={checked}
        onCheckedChange={(value) => {
          onChange(value === true);
        }}
      />
      <Label
        htmlFor="photo-consent"
        className="text-xs leading-snug text-stone-700"
      >
        I confirm everyone identifiable in photos I upload has given consent for
        publication on the club website - for under-18s, that means
        parent/guardian consent.
      </Label>
    </div>
  );
}

function EditorPane({
  editor,
  slashItems,
  currentBody,
  onDirty,
}: {
  editor: Editor;
  slashItems: () => ReturnType<typeof getDefaultReactSlashMenuItems>;
  currentBody: () => unknown;
  onDirty: () => void;
}) {
  const [activeTab, setActiveTab] = useState("edit");
  const [previewBlocks, setPreviewBlocks] = useState<unknown>([]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => {
        if (tab === "preview") setPreviewBlocks(currentBody());
        setActiveTab(tab);
      }}
    >
      <TabsList>
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="edit">
        <div className="rounded-lg border border-stone-200 bg-white py-4">
          <BlockNoteView
            editor={editor}
            theme="light"
            slashMenu={false}
            onChange={onDirty}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={(query) =>
                Promise.resolve(
                  filterSuggestionItems(
                    [...slashItems(), ...getDefaultReactSlashMenuItems(editor)],
                    query,
                  ),
                )
              }
            />
          </BlockNoteView>
        </div>
      </TabsContent>
      <TabsContent value="preview">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <ContentBody body={previewBlocks} />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function LoadedEditor({
  kind,
  item,
  newParentId,
  onClose,
  onCreated,
}: {
  kind: ContentKind;
  item: ContentItemDetail | null;
  newParentId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { allowed: canManage } = useHasPermission(
    CONTENT_KIND_RESOURCES[kind],
    "manage",
  );
  const { allowed: canPublish } = useHasPermission(
    CONTENT_KIND_RESOURCES[kind],
    "publish",
  );

  const [form, setForm] = useState<FormState>(() =>
    initialForm(item, newParentId),
  );
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    item?.updatedAt ?? null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the author has manually edited the slug (handler-only flag:
  // it never affects what's on screen, only how title edits behave).
  const slugTouchedRef = useRef(item !== null);
  // Unsaved-changes flag (handler-only: read on Back, set by edits,
  // cleared by save).
  const dirtyRef = useRef(false);

  const slugLocked = item?.publishedAt != null;

  const onFormChange = (updates: Partial<FormState>) => {
    dirtyRef.current = true;
    if (updates.slug !== undefined) slugTouchedRef.current = true;
    setForm((prev) => {
      const next = { ...prev, ...updates };
      if (updates.title !== undefined && !slugTouchedRef.current) {
        next.slug = slugify(updates.title);
      }
      return next;
    });
  };

  const editor = useCreateBlockNote({
    schema,
    initialContent:
      item && Array.isArray(item.body) && item.body.length > 0
        ? (item.body as PartialBlock[])
        : undefined,
  });

  const editorBody = () =>
    contentBodySchema.parse(JSON.parse(JSON.stringify(editor.document)));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = editorBody();
      const metadata = buildMetadata(kind, form);
      if (item === null) {
        return await callApi(
          api.POST("/api/admin/content", {
            body: {
              kind,
              slug: form.slug,
              title: form.title,
              description: form.description || null,
              body,
              metadata,
              // Pages nest; every other kind is flat (the API rejects a
              // parent on non-page kinds).
              ...(kind === "page" ? { parentId: form.parentId } : {}),
            },
          }),
        );
      }
      return await callApi(
        api.PUT("/api/admin/content/{contentId}", {
          params: { path: { contentId: item.id } },
          body: {
            // Slug and (for pages) parent share the ever-published lock:
            // path = parent path + slug, so neither is sent once locked.
            ...(slugLocked
              ? {}
              : {
                  slug: form.slug,
                  ...(kind === "page" ? { parentId: form.parentId } : {}),
                }),
            title: form.title,
            description: form.description || null,
            body,
            metadata,
          },
        }),
      );
    },
    onSuccess: (result) => {
      dirtyRef.current = false;
      setLastSavedAt(new Date().toISOString());
      void queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
      // Saving a published item changes the live page immediately; drop
      // the public ["content", ...] cache so the SPA reflects it.
      void queryClient.invalidateQueries({ queryKey: ["content"] });
      if (item === null) onCreated(result.id);
    },
  });

  const requestClose = () => {
    if (
      dirtyRef.current &&
      !window.confirm(
        `Discard unsaved changes to this ${CONTENT_KIND_NOUNS[kind]}?`,
      )
    ) {
      return;
    }
    onClose();
  };

  const canSave = canManage && (item?.status !== "published" || canPublish);
  const metadataIssue = metadataProblem(kind, form);

  // Suggestions come from list pages already in the query cache; computed
  // once per mount, which is as fresh as the list the author came from.
  const tagSuggestions = useMemo(
    () => (kind === "news" ? cachedTagSuggestions(queryClient, kind) : []),
    [kind, queryClient],
  );

  const startImageUpload = () => {
    setUploadError(null);
    if (!consentConfirmed) {
      setUploadError(
        "Tick the photo consent box above before uploading images.",
      );
      return;
    }
    fileInputRef.current?.click();
  };

  const onFileChosen = async (file: File) => {
    try {
      const uploaded = await uploadContentImage(file, {});
      const cursor = editor.getTextCursorPosition();
      editor.insertBlocks(
        [
          {
            type: CUSTOM_BLOCK_TYPES.contentImage,
            props: {
              src: uploaded.picture.img.src,
              alt: "",
              caption: "",
              picture: JSON.stringify(uploaded.picture),
            },
          },
        ],
        cursor.block,
        "after",
      );
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed - try again",
      );
    }
  };

  const slashItems = () => buildSlashItems(editor, startImageUpload);

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFileChosen(file);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={requestClose}>
          ← Back to list
        </Button>
        <div className="flex items-center gap-3">
          {lastSavedAt && (
            <span className="text-xs text-stone-500">
              Last saved{" "}
              {new Date(lastSavedAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {canSave && (
            <Button
              onClick={() => {
                saveMutation.mutate();
              }}
              disabled={
                saveMutation.isPending ||
                !form.title ||
                !form.slug ||
                metadataIssue !== null
              }
              title={metadataIssue ?? undefined}
            >
              {saveMutation.isPending
                ? "Saving…"
                : item === null
                  ? "Create draft"
                  : item.status === "published"
                    ? "Save & update live page"
                    : "Save"}
            </Button>
          )}
        </div>
      </div>

      {saveMutation.error && (
        <p className="text-sm text-red-600">
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : "Save failed"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-1">
          <MetadataFields
            kind={kind}
            form={form}
            itemId={item?.id ?? null}
            slugLocked={slugLocked}
            tagSuggestions={tagSuggestions}
            onChange={onFormChange}
          />
          {item !== null && (
            <PublishingCard
              item={item}
              canPublish={canPublish}
              canManage={canManage}
              beforePublish={() => saveMutation.mutateAsync()}
            />
          )}
          <ConsentBox
            checked={consentConfirmed}
            onChange={setConsentConfirmed}
          />
          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
        </div>

        <div className="lg:col-span-2">
          <EditorPane
            editor={editor}
            slashItems={slashItems}
            currentBody={editorBody}
            onDirty={() => {
              dirtyRef.current = true;
            }}
          />
        </div>
      </div>
    </div>
  );
}
