import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
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

import {
  CONTACT_FORM_CARD_CLASSES,
  CONTACT_FORM_DESCRIPTION_CLASSES,
  CONTACT_FORM_TITLE_CLASSES,
  ContactFormBody,
  mdxComponents,
} from "@/components/mdx-components.js";
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
import {
  playerOptions,
  type Ball,
  type PlayerOption,
} from "@/components/wagon-wheel-shared.js";
import { useHasPermission } from "@/hooks/use-has-permission.js";
import { useWagonWheelQuery } from "@/hooks/use-wagon-wheel.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { uploadContentImage } from "@/lib/content-images.js";
import {
  eventsListQueryOptions,
  parseEventMetadata,
} from "@/lib/content-queries.js";
import {
  parsePersonGridEntries,
  type PersonGridEntry,
} from "@/lib/person-grid.js";
import { parseGalleryImages, type GalleryImage } from "@/lib/photo-gallery.js";
import { usePeopleList } from "@/lib/use-people.js";
import { cn } from "@/lib/utils.js";
import {
  CONTENT_KIND_RESOURCES,
  contentBodySchema,
  CUSTOM_BLOCK_TYPES,
  expandEventOccurrences,
  type ContentKind,
  type ResolvedBlock,
  type ResolvedEditOp,
} from "@percy-main/shared/content";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import * as rruleNs from "rrule";
import {
  BlockSettings,
  EMPTY_CARD_CLASSES,
  EmptyCardPrompt,
  INLINE_TEXT_INPUT_CLASSES,
  PickerCard,
} from "./block-controls.js";
import { appendBlocks, applyEditOps } from "./content-ai/apply-edit-ops.js";
import {
  ContentAiPanel,
  type ContentAiEditorContext,
} from "./content-ai/content-ai-panel.js";
import { projectDraftBlocks } from "./content-ai/draft-projection.js";
import { CONTENT_KIND_NOUNS } from "./content-kind-labels.js";
import { EditorBlockPreview } from "./editor-block-preview.js";
import {
  buildPageTree,
  eligibleParents,
  visibleNodes,
} from "./pages-tab.lib.js";
import { PersonEditor, PersonGridEditor } from "./person-editors.js";
import { PhotoGalleryEditor } from "./photo-gallery-editor.js";
import {
  blocksToLines,
  detailLines,
  diffLines,
  type DiffLine,
} from "./revision-diff.js";
import { UploadConsentContext } from "./upload-consent-context.js";

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
      <div className="my-2 w-full max-w-xs">
        <PersonEditor
          slug={block.props.slug}
          role={block.props.role}
          onChange={({ slug, role }) => {
            editor.updateBlock(block, {
              props: { ...block.props, slug, role },
            });
          }}
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
    render: ({ block, editor }) => {
      const setGame = (playCricketId: string) => {
        editor.updateBlock(block, {
          props: { ...block.props, playCricketId },
        });
      };
      return (
        <div className="relative my-2 w-full">
          {block.props.playCricketId ? (
            <>
              <EditorBlockPreview>
                <mdxComponents.GamePreview
                  playCricketId={block.props.playCricketId}
                />
              </EditorBlockPreview>
              <BlockSettings label="Game preview settings" title="Game preview">
                <div className="flex flex-col gap-1">
                  <Label>Play-Cricket game</Label>
                  <GameSelect
                    value={block.props.playCricketId}
                    onChange={setGame}
                  />
                </div>
              </BlockSettings>
            </>
          ) : (
            <GamePickerCard onPick={setGame} />
          )}
        </div>
      );
    },
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
      // Gated on the event alone: once one is chosen, the preview and
      // settings stay mounted even while name/date are cleared mid-edit
      // (gating on those too would unmount the open modal per
      // keystroke - the league table block learned the same lesson).
      const hasEvent = block.props.eventId !== "";
      const update = (updates: Partial<typeof block.props>) => {
        editor.updateBlock(block, {
          props: { ...block.props, ...updates },
        });
      };
      const applyEvent = (event: PickedEvent) => {
        update({ eventId: event.slug, name: event.title, when: event.when });
      };
      return (
        <div className="relative my-2 w-full max-w-sm">
          {hasEvent ? (
            <>
              <EditorBlockPreview>
                <mdxComponents.EventPreview
                  id={block.props.eventId}
                  name={block.props.name}
                  when={block.props.when}
                />
              </EditorBlockPreview>
              <BlockSettings
                label="Event preview settings"
                title="Event preview"
              >
                <div className="flex flex-col gap-1">
                  <Label>Event</Label>
                  <EventSelect
                    value={block.props.eventId}
                    onPick={applyEvent}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`event-name-${block.id}`}>
                    Name shown on the card
                  </Label>
                  <Input
                    id={`event-name-${block.id}`}
                    value={block.props.name}
                    onChange={(e) => {
                      update({ name: e.target.value });
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`event-when-${block.id}`}>
                    Date shown on the card
                  </Label>
                  <Input
                    id={`event-when-${block.id}`}
                    type="date"
                    value={ukDate(block.props.when)}
                    onChange={(e) => {
                      update({ when: e.target.value });
                    }}
                  />
                </div>
              </BlockSettings>
            </>
          ) : (
            <EventPickerCard onPick={applyEvent} />
          )}
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
  return parsePictureValue(parsed);
}

/** Same structural floor over an already-parsed value (person metadata
 * stores the descriptor as an object, not a JSON string). */
function parsePictureValue(parsed: unknown): PictureSource | null {
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
      const set = (key: "caption" | "alt", value: string) => {
        editor.updateBlock(block, {
          props: { ...block.props, [key]: value },
        });
      };
      return (
        <figure className="relative my-2 w-full max-w-lg">
          <EditorBlockPreview>
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
          </EditorBlockPreview>
          {/* Edited in place, styled like the public figcaption. */}
          <input
            aria-label="Caption"
            placeholder="Add a caption (optional)…"
            value={block.props.caption}
            onChange={(e) => {
              set("caption", e.target.value);
            }}
            className={INLINE_TEXT_INPUT_CLASSES("mt-2 text-sm text-stone-600")}
          />
          <BlockSettings label="Image settings" title="Image">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`image-alt-${block.id}`}>
                Alt text for screen readers
              </Label>
              <Input
                id={`image-alt-${block.id}`}
                placeholder="Describe the photo"
                value={block.props.alt}
                onChange={(e) => {
                  set("alt", e.target.value);
                }}
              />
              <span className="text-xs text-stone-500">
                Read aloud by screen readers - not shown on the page.
              </span>
            </div>
          </BlockSettings>
        </figure>
      );
    },
  },
);

const photoGalleryBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.photoGallery,
    propSchema: {
      // JSON-stringified [{picture, alt?, caption?}] built from the
      // upload pipeline (the contentImage picture prop, pluralised).
      images: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const images = parseGalleryImages(block.props.images) ?? [];
      const write = (next: GalleryImage[]) => {
        editor.updateBlock(block, {
          props: {
            ...block.props,
            // Empty gallery stores "" (NULL-for-unset), which parses to
            // null - the editor shows the dashed add-photos card and the
            // public renderer hides the block.
            images: next.length > 0 ? JSON.stringify(next) : "",
          },
        });
      };
      return (
        <div className="my-2 w-full">
          <PhotoGalleryEditor images={images} onWrite={write} />
        </div>
      );
    },
  },
);

const personGridBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.personGrid,
    propSchema: {
      // Legacy fallback the public renderer still reads when entries is
      // absent - kept in sync as the CSV of the selected slugs.
      slugs: { default: "" },
      // Canonical role-preserving prop: JSON-stringified [{slug, role?}]
      // (same precedent as contentImage's picture prop).
      entries: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      // entries is canonical; a block predating it (or with malformed
      // JSON) degrades to the slugs CSV, role-less - exactly like the
      // public renderer.
      const entries: PersonGridEntry[] =
        parsePersonGridEntries(block.props.entries) ??
        block.props.slugs.split(",").flatMap((s) => {
          const trimmed = s.trim();
          return trimmed ? [{ slug: trimmed }] : [];
        });
      const write = (next: PersonGridEntry[]) => {
        editor.updateBlock(block, {
          props: {
            ...block.props,
            entries: JSON.stringify(next),
            slugs: next.map((e) => e.slug).join(","),
          },
        });
      };
      return (
        <div className="my-2 w-full">
          <PersonGridEditor entries={entries} onWrite={write} />
        </div>
      );
    },
  },
);

const leagueTableBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.leagueTable,
    propSchema: {
      divisionId: { default: "" },
      name: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const set = (key: "divisionId" | "name", value: string) => {
        editor.updateBlock(block, { props: { ...block.props, [key]: value } });
      };
      const fields = (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`league-division-${block.id}`}>
              Division ID (required)
            </Label>
            <Input
              id={`league-division-${block.id}`}
              value={block.props.divisionId}
              onChange={(e) => {
                set("divisionId", e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`league-name-${block.id}`}>
              Table heading (optional)
            </Label>
            <Input
              id={`league-name-${block.id}`}
              value={block.props.name}
              onChange={(e) => {
                set("name", e.target.value);
              }}
            />
          </div>
        </>
      );
      // One BlockSettings instance across the empty/filled branches:
      // typing the division ID flips the block to the preview, and a
      // separate instance would unmount the open modal mid-keystroke.
      // min-w-0: BlockNote lays blocks out as flex rows, so without it
      // the block can't shrink below the table's intrinsic width and
      // the table's own overflow-x scroll never engages.
      return (
        <div className="relative my-2 w-full min-w-0">
          {/* Not wrapped in EditorBlockPreview: the table is plain text
              (no links or buttons to neutralise) and inert would swallow
              the wheel/scrollbar events its horizontal scroll needs. */}
          {block.props.divisionId !== "" && (
            <mdxComponents.LeagueTable
              divisionId={block.props.divisionId}
              name={block.props.name || undefined}
            />
          )}
          <BlockSettings
            label="League table settings"
            title="League table"
            trigger={
              block.props.divisionId !== ""
                ? undefined
                : (open) => (
                    <button
                      type="button"
                      onClick={open}
                      className={EMPTY_CARD_CLASSES}
                    >
                      <EmptyCardPrompt prompt="Set up league table" />
                    </button>
                  )
            }
          >
            {fields}
          </BlockSettings>
        </div>
      );
    },
  },
);

const leaderboardBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.leaderboard,
    propSchema: {},
    content: "none",
  },
  {
    render: () => (
      <EditorBlockPreview className="my-2 w-full">
        <mdxComponents.Leaderboard />
      </EditorBlockPreview>
    ),
  },
);

const recordsWallBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.recordsWall,
    propSchema: {},
    content: "none",
  },
  {
    render: () => (
      <EditorBlockPreview className="my-2 w-full">
        <mdxComponents.RecordsWall />
      </EditorBlockPreview>
    ),
  },
);

const contactFormBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.contactForm,
    propSchema: {
      title: { default: "" },
      description: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const set = (key: "title" | "description", value: string) => {
        editor.updateBlock(block, { props: { ...block.props, [key]: value } });
      };
      // Same card frame as the public form, with the heading and
      // description edited in place; only the fields below them are
      // inert (the form must not be focusable or submittable - mouse OR
      // keyboard - inside the editor canvas).
      return (
        <div className={cn("my-2", CONTACT_FORM_CARD_CLASSES)}>
          <input
            aria-label="Form title"
            placeholder="Form title (optional)"
            value={block.props.title}
            onChange={(e) => {
              set("title", e.target.value);
            }}
            className={INLINE_TEXT_INPUT_CLASSES(
              cn(CONTACT_FORM_TITLE_CLASSES, "placeholder:font-normal"),
            )}
          />
          <input
            aria-label="Form description"
            placeholder="Description shown above the fields (optional)"
            value={block.props.description}
            onChange={(e) => {
              set("description", e.target.value);
            }}
            className={INLINE_TEXT_INPUT_CLASSES(
              CONTACT_FORM_DESCRIPTION_CLASSES,
            )}
          />
          <EditorBlockPreview>
            <ContactFormBody />
          </EditorBlockPreview>
        </div>
      );
    },
  },
);

const cookieSettingsLinkBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.cookieSettingsLink,
    propSchema: {
      text: { default: "Cookie settings" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <div className="my-2 w-full">
        {/* Edited in place, styled like the public link (which reopens
            the consent banner - inert here by virtue of being an input). */}
        <input
          aria-label="Link text"
          placeholder="Cookie settings"
          value={block.props.text}
          size={Math.max(block.props.text.length, 15)}
          onChange={(e) => {
            editor.updateBlock(block, {
              props: { ...block.props, text: e.target.value },
            });
          }}
          className={INLINE_TEXT_INPUT_CLASSES(
            "inline w-auto max-w-full text-blue-900 underline",
          )}
        />
      </div>
    ),
  },
);

const consentVersionBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.consentVersion,
    propSchema: {},
    content: "none",
  },
  {
    render: () => (
      <EditorBlockPreview className="my-2">
        <mdxComponents.ConsentVersion />
      </EditorBlockPreview>
    ),
  },
);

const wagonWheelBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.wagonWheel,
    propSchema: {
      matchId: { default: "" },
      // Team = batting innings; batter/bowler = RV ids. All stored as
      // strings (BlockNote JSON) and parsed where the viewer needs numbers.
      inningsNumber: { default: "" },
      batterRvId: { default: "" },
      bowlerRvId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const setProp = (
        key: "inningsNumber" | "batterRvId" | "bowlerRvId",
        value: string,
      ) => {
        editor.updateBlock(block, { props: { ...block.props, [key]: value } });
      };
      // Changing the match invalidates the innings/batter/bowler chosen
      // against the previous one, so clear them.
      const pickMatch = (matchId: string) => {
        editor.updateBlock(block, {
          props: {
            ...block.props,
            matchId,
            inningsNumber: "",
            batterRvId: "",
            bowlerRvId: "",
          },
        });
      };
      return (
        <div className="relative my-2 w-full min-w-0">
          {block.props.matchId === "" ? (
            <MatchPickerCard
              prompt="Choose a match for the wagon wheel"
              onPick={pickMatch}
            />
          ) : (
            <>
              <EditorBlockPreview className="w-full">
                <mdxComponents.WagonWheel
                  matchId={block.props.matchId}
                  inningsNumber={block.props.inningsNumber}
                  batterRvId={block.props.batterRvId}
                  bowlerRvId={block.props.bowlerRvId}
                />
              </EditorBlockPreview>
              <BlockSettings label="Wagon wheel settings" title="Wagon wheel">
                <WagonWheelSettingsFields
                  matchId={block.props.matchId}
                  inningsNumber={block.props.inningsNumber}
                  batterRvId={block.props.batterRvId}
                  bowlerRvId={block.props.bowlerRvId}
                  onMatch={pickMatch}
                  onSet={setProp}
                />
              </BlockSettings>
            </>
          )}
        </div>
      );
    },
  },
);

const wormChartBlock = createReactBlockSpec(
  {
    type: CUSTOM_BLOCK_TYPES.wormChart,
    propSchema: {
      matchId: { default: "" },
      // The batting innings whose line is highlighted (solid). Empty =
      // first innings.
      inningsNumber: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const setInnings = (value: string) => {
        editor.updateBlock(block, {
          props: { ...block.props, inningsNumber: value },
        });
      };
      const pickMatch = (matchId: string) => {
        editor.updateBlock(block, {
          props: { ...block.props, matchId, inningsNumber: "" },
        });
      };
      return (
        <div className="relative my-2 w-full min-w-0">
          {block.props.matchId === "" ? (
            <MatchPickerCard
              prompt="Choose a match for the worm chart"
              onPick={pickMatch}
            />
          ) : (
            <>
              <EditorBlockPreview className="w-full">
                <mdxComponents.WormChart
                  matchId={block.props.matchId}
                  inningsNumber={block.props.inningsNumber}
                />
              </EditorBlockPreview>
              <BlockSettings label="Worm chart settings" title="Worm chart">
                <WormChartSettingsFields
                  matchId={block.props.matchId}
                  inningsNumber={block.props.inningsNumber}
                  onMatch={pickMatch}
                  onSet={setInnings}
                />
              </BlockSettings>
            </>
          )}
        </div>
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

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...allowedDefaultBlocks,
    [CUSTOM_BLOCK_TYPES.person]: personBlock(),
    [CUSTOM_BLOCK_TYPES.personGrid]: personGridBlock(),
    [CUSTOM_BLOCK_TYPES.gamePreview]: gamePreviewBlock(),
    [CUSTOM_BLOCK_TYPES.eventPreview]: eventPreviewBlock(),
    [CUSTOM_BLOCK_TYPES.contentImage]: contentImageBlock(),
    [CUSTOM_BLOCK_TYPES.photoGallery]: photoGalleryBlock(),
    [CUSTOM_BLOCK_TYPES.leagueTable]: leagueTableBlock(),
    [CUSTOM_BLOCK_TYPES.leaderboard]: leaderboardBlock(),
    [CUSTOM_BLOCK_TYPES.recordsWall]: recordsWallBlock(),
    [CUSTOM_BLOCK_TYPES.wagonWheel]: wagonWheelBlock(),
    [CUSTOM_BLOCK_TYPES.wormChart]: wormChartBlock(),
    [CUSTOM_BLOCK_TYPES.contactForm]: contactFormBlock(),
    [CUSTOM_BLOCK_TYPES.cookieSettingsLink]: cookieSettingsLinkBlock(),
    [CUSTOM_BLOCK_TYPES.consentVersion]: consentVersionBlock(),
  },
});

type Editor = typeof schema.BlockNoteEditor;
type PartialBlock = typeof schema.PartialBlock;

// ── Games picker (shared by metadata form + gamePreview block) ──────────

/** A season's games; undefined while loading. Defaults to the current
 * season (the metadata form + gamePreview picker); the cricket result
 * blocks pass a chosen season so historical matches are reachable. */
function useGamesList(season = new Date().getFullYear()) {
  const { data: games } = useQuery({
    queryKey: ["games", season],
    queryFn: () =>
      callApi(api.GET("/api/games", { params: { query: { season } } })),
  });
  return games;
}

const gameLabel = (game: {
  team: { name: string };
  opposition: { club: { name: string } };
  matchDate: string;
}) => `${game.team.name} vs ${game.opposition.club.name} · ${game.matchDate}`;

function GameSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const games = useGamesList();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Choose a game…" />
      </SelectTrigger>
      <SelectContent>
        {(games ?? []).map((game) => (
          <SelectItem key={game.id} value={game.id}>
            {gameLabel(game)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The empty gamePreview block: a dashed picker card (one click). */
function GamePickerCard({ onPick }: { onPick: (id: string) => void }) {
  const games = useGamesList();
  if (games === undefined || games.length === 0) {
    return (
      <div className={EMPTY_CARD_CLASSES}>
        <span className="text-sm text-stone-500">
          {games === undefined
            ? "Loading games…"
            : "No games found for this season"}
        </span>
      </div>
    );
  }
  return (
    <PickerCard
      label="Choose a game to preview"
      prompt="Choose game"
      options={games.map((game) => ({
        value: game.id,
        label: gameLabel(game),
      }))}
      onPick={onPick}
    />
  );
}

// ── Cricket result blocks picker (wagon wheel / worm chart) ─────────────

// Current season plus a few prior, so authors can embed historical matches.
const SEASON_COUNT = 6;

function useSeasons(): number[] {
  return useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: SEASON_COUNT }, (_, i) => current - i);
  }, []);
}

/** Season dropdown + match dropdown. The match list follows the chosen
 * season; the value degrades to the placeholder when the stored match
 * isn't in the visible season (same pattern as EventSelect). */
function SeasonMatchSelect({
  value,
  onPick,
}: {
  value: string;
  onPick: (matchId: string) => void;
}) {
  const seasons = useSeasons();
  const [season, setSeason] = useState(seasons[0]);
  const games = useGamesList(season) ?? [];
  return (
    <div className="flex w-full flex-col gap-2">
      <Select
        value={String(season)}
        onValueChange={(v) => setSeason(Number(v))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {seasons.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s} season
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={games.some((game) => game.id === value) ? value : ""}
        onValueChange={onPick}
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={
              games.length ? "Choose a match…" : "No matches this season"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {games.map((game) => (
            <SelectItem key={game.id} value={game.id}>
              {gameLabel(game)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The empty cricket-block state: a dashed card holding the season + match
 * pickers, so the author lands on a configured block in one place. */
function MatchPickerCard({
  prompt,
  onPick,
}: {
  prompt: string;
  onPick: (matchId: string) => void;
}) {
  return (
    <div className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-stone-300 p-4">
      <span className="text-sm text-stone-500">{prompt}</span>
      <div className="w-full max-w-sm">
        <SeasonMatchSelect value="" onPick={onPick} />
      </div>
    </div>
  );
}

interface ConfigInnings {
  inningsNumber: number;
  teamName: string;
  balls: Ball[];
}

/** The battable innings of a match (those with balls), labelled with the
 * batting team's name. Team names come from the game detail endpoint, ball
 * data (for the batter/bowler lists) from the wagon-wheel endpoint - both
 * share the view-time caches, so the preview opens instantly. */
function useMatchConfigData(matchId: string): ConfigInnings[] {
  const { data: game } = useQuery({
    queryKey: ["game", matchId],
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}", { params: { path: { matchId } } }),
      ),
    enabled: matchId !== "",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: wagonWheel } = useWagonWheelQuery(matchId, matchId !== "");
  const teamNames = game?.result?.innings.map((inn) => inn.teamName);
  const result: ConfigInnings[] = [];
  for (const inn of wagonWheel?.innings ?? []) {
    if (inn.balls.length === 0) continue;
    result.push({
      inningsNumber: inn.inningsNumber,
      teamName:
        teamNames?.[inn.inningsNumber - 1] ?? `Innings ${inn.inningsNumber}`,
      balls: inn.balls,
    });
  }
  return result;
}

function WagonWheelSettingsFields({
  matchId,
  inningsNumber,
  batterRvId,
  bowlerRvId,
  onMatch,
  onSet,
}: {
  matchId: string;
  inningsNumber: string;
  batterRvId: string;
  bowlerRvId: string;
  onMatch: (matchId: string) => void;
  onSet: (
    key: "inningsNumber" | "batterRvId" | "bowlerRvId",
    value: string,
  ) => void;
}) {
  const innings = useMatchConfigData(matchId);
  // The effective innings drives the batter/bowler lists: an empty stored
  // value shows the first innings, which is what the viewer renders too.
  const effective =
    innings.find((inn) => String(inn.inningsNumber) === inningsNumber) ??
    innings[0];
  const batters = effective ? playerOptions(effective.balls, "bat") : [];
  const bowlers = effective ? playerOptions(effective.balls, "bowl") : [];
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label>Match (required)</Label>
        <SeasonMatchSelect value={matchId} onPick={onMatch} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Team (required)</Label>
        <TeamSelect
          innings={innings}
          value={effective ? String(effective.inningsNumber) : ""}
          onChange={(v) => onSet("inningsNumber", v)}
        />
      </div>
      <PlayerConfigSelect
        label="Batter (optional)"
        allLabel="All batters"
        options={batters}
        value={batterRvId}
        onChange={(v) => onSet("batterRvId", v)}
      />
      <PlayerConfigSelect
        label="Bowler (optional)"
        allLabel="All bowlers"
        options={bowlers}
        value={bowlerRvId}
        onChange={(v) => onSet("bowlerRvId", v)}
      />
    </>
  );
}

function WormChartSettingsFields({
  matchId,
  inningsNumber,
  onMatch,
  onSet,
}: {
  matchId: string;
  inningsNumber: string;
  onMatch: (matchId: string) => void;
  onSet: (value: string) => void;
}) {
  const innings = useMatchConfigData(matchId);
  const effective =
    innings.find((inn) => String(inn.inningsNumber) === inningsNumber) ??
    innings[0];
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label>Match (required)</Label>
        <SeasonMatchSelect value={matchId} onPick={onMatch} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Team to highlight</Label>
        <TeamSelect
          innings={innings}
          value={effective ? String(effective.inningsNumber) : ""}
          onChange={onSet}
        />
      </div>
    </>
  );
}

function TeamSelect({
  innings,
  value,
  onChange,
}: {
  innings: ConfigInnings[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={innings.length === 0}
    >
      <SelectTrigger className="w-full">
        <SelectValue
          placeholder={innings.length ? "Choose a team…" : "Loading…"}
        />
      </SelectTrigger>
      <SelectContent>
        {innings.map((inn) => (
          <SelectItem key={inn.inningsNumber} value={String(inn.inningsNumber)}>
            {inn.teamName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Radix SelectItem can't hold an empty value, so an explicit sentinel item
// maps back to "" (no filter) when stored.
const ALL_PLAYERS = "all";

function PlayerConfigSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: PlayerOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Select
        value={value === "" ? ALL_PLAYERS : value}
        onValueChange={(v) => onChange(v === ALL_PLAYERS ? "" : v)}
        disabled={options.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PLAYERS}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={String(option.id)}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Events picker (eventPreview block) ──────────────────────────────────

/** What picking an event hands back: everything the block stores. */
interface PickedEvent {
  slug: string;
  title: string;
  when: string;
}

/** Published events as pickable entries; undefined while loading. */
function useEventsList(): PickedEvent[] | undefined {
  const { data } = useQuery(eventsListQueryOptions());
  return data?.items.map((item) => ({
    slug: item.slug,
    title: item.title,
    when: parseEventMetadata(item.metadata)?.when ?? "",
  }));
}

/**
 * The UK calendar date of a stored `when` (ISO instant or plain date),
 * as a date-input value. Event instants are authored as UK wall-clock
 * (see EVENT_TZ); a machine-timezone or UTC slice would show the wrong
 * day for late-evening BST events. Empty for anything unparseable.
 */
function ukDate(when: string): string {
  const date = new Date(when);
  return Number.isNaN(date.getTime())
    ? ""
    : formatInTimeZone(date, EVENT_TZ, "yyyy-MM-dd");
}

const eventLabel = (event: PickedEvent) => {
  const date = new Date(event.when);
  return Number.isNaN(date.getTime())
    ? event.title
    : `${event.title} · ${formatInTimeZone(date, EVENT_TZ, "dd/MM/yyyy")}`;
};

function EventSelect({
  value,
  onPick,
}: {
  value: string;
  onPick: (event: PickedEvent) => void;
}) {
  const events = useEventsList() ?? [];
  return (
    <Select
      // Radix needs the value to match an item; legacy hand-entered ids
      // that aren't published events degrade to the placeholder.
      value={events.some((event) => event.slug === value) ? value : ""}
      onValueChange={(slug) => {
        const event = events.find((candidate) => candidate.slug === slug);
        if (event) onPick(event);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Choose an event…" />
      </SelectTrigger>
      <SelectContent>
        {events.map((event) => (
          <SelectItem key={event.slug} value={event.slug}>
            {eventLabel(event)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The empty eventPreview block: a dashed picker card (one click). */
function EventPickerCard({ onPick }: { onPick: (event: PickedEvent) => void }) {
  const events = useEventsList();
  if (events === undefined || events.length === 0) {
    return (
      <div className={EMPTY_CARD_CLASSES}>
        <span className="px-3 text-center text-sm text-stone-500">
          {events === undefined
            ? "Loading events…"
            : "No published events yet - create one in the Events tab first"}
        </span>
      </div>
    );
  }
  return (
    <PickerCard
      label="Choose an event to preview"
      prompt="Choose event"
      options={events.map((event) => ({
        value: event.slug,
        label: eventLabel(event),
      }))}
      onPick={(slug) => {
        const event = events.find((candidate) => candidate.slug === slug);
        if (event) onPick(event);
      }}
    />
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
      title: "Person grid",
      subtext: "Show a grid of club member cards",
      group: "Club content",
      aliases: ["people", "grid", "team"],
      icon: <span aria-hidden>👥</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.personGrid,
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
      title: "Wagon wheel",
      subtext: "Interactive ball-by-ball shot chart for a match",
      group: "Club content",
      aliases: ["wagon wheel", "shots", "ball by ball", "cricket"],
      icon: <span aria-hidden>🎯</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.wagonWheel,
        });
      },
    },
    {
      title: "Worm chart",
      subtext: "Cumulative runs per innings for a match",
      group: "Club content",
      aliases: ["worm", "runs", "cumulative", "manhattan", "cricket"],
      icon: <span aria-hidden>📈</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.wormChart,
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
    {
      title: "Photo gallery",
      subtext: "A set of photos with a main view and thumbnail strip",
      group: "Club content",
      aliases: ["gallery", "photos", "album", "carousel", "slideshow"],
      icon: <span aria-hidden>🖼️</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.photoGallery,
        });
      },
    },
    {
      title: "League table",
      subtext: "Show a live Play-Cricket league standings table",
      group: "Page widgets",
      aliases: ["league", "table", "standings", "division"],
      icon: <span aria-hidden>📊</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.leagueTable,
        });
      },
    },
    {
      title: "Leaderboard",
      subtext: "Show the club batting and bowling leaderboard",
      group: "Page widgets",
      aliases: ["leaderboard", "stats", "averages"],
      icon: <span aria-hidden>🏆</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.leaderboard,
        });
      },
    },
    {
      title: "Records wall",
      subtext: "Show the club batting and bowling records",
      group: "Page widgets",
      aliases: ["records", "records wall"],
      icon: <span aria-hidden>🎖️</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.recordsWall,
        });
      },
    },
    {
      title: "Contact form",
      subtext: "Embed a contact message form",
      group: "Page widgets",
      aliases: ["contact", "form", "message"],
      icon: <span aria-hidden>✉️</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.contactForm,
        });
      },
    },
    {
      title: "Cookie settings link",
      subtext: "Inline link that reopens the cookie consent banner",
      group: "Page widgets",
      aliases: ["cookie", "consent", "gdpr", "privacy"],
      icon: <span aria-hidden>🍪</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.cookieSettingsLink,
        });
      },
    },
    {
      title: "Consent version",
      subtext: "Display the current cookie consent policy version string",
      group: "Page widgets",
      aliases: ["consent version", "policy version"],
      icon: <span aria-hidden>📋</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: CUSTOM_BLOCK_TYPES.consentVersion,
        });
      },
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
  } = useAuthedQuery({
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
  // event recurrence - a structured builder for an iCal RRULE body. The
  // assembled rule + exceptions are stored under metadata.recurrence.
  repeats: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrenceInterval: string;
  recurrenceByDay: string[]; // weekday codes: MO TU WE TH FR SA SU
  recurrenceMonthMode: "dayOfMonth" | "nthWeekday";
  recurrenceEnd: "never" | "until" | "count";
  recurrenceUntil: string; // yyyy-MM-dd (UK calendar date)
  recurrenceCount: string;
  recurrenceExceptions: string[]; // cancelled dates, UK yyyy-MM-dd
  hasLocation: boolean;
  locationName: string;
  locationStreet: string;
  locationCity: string;
  locationPostcode: string;
  locationLat: string;
  locationLon: string;
  // person - title doubles as the person's name; photo holds the upload
  // API's PictureSource descriptor (null until a photo is uploaded)
  isDBSChecked: boolean;
  hasLeftClub: boolean;
  photo: PictureSource | null;
}

// ── Per-kind metadata: hydrate / validate / build ───────────────────────

/** Event times are stored as instants but authored as UK wall-clock. */
const EVENT_TZ = "Europe/London";

// rrule has no "exports" map, so bundlers resolve its ESM build (named
// exports) while Node resolves its CJS build (members under the interop
// default). Prefer the named export, fall back to default - works in the
// browser, in vitest's Node runtime, and in SSR.
const { RRule } =
  (rruleNs as typeof rruleNs & { default?: typeof rruleNs }).default ?? rruleNs;

// Weekday codes indexed by rrule's weekday number (MO=0 .. SU=6).
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const WEEKDAY_BY_CODE: Record<string, rruleNs.Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};
const FREQ_BY_REPEATS = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
} as const;

type RepeatsOption = FormState["repeats"];

const REPEATS_LABELS: Array<{ value: RepeatsOption; label: string }> = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

/** The Nth weekday-in-month a date falls on (1-based), e.g. 9th -> 2. */
function weekOfMonth(dayOfMonth: number): number {
  return Math.floor((dayOfMonth - 1) / 7) + 1;
}

/**
 * Assemble the stored RRULE body (no DTSTART line) from the builder fields.
 * Returns null when the event does not repeat or the start is unset. Mirrors
 * the shared eventMetadataSchema.recurrence shape on the way out.
 */
function buildEventRecurrence(
  form: FormState,
): { rrule: string; exceptions?: string[] } | null {
  if (form.repeats === "none" || !form.when) return null;

  const interval = Math.max(1, Number(form.recurrenceInterval) || 1);
  const options: Partial<rruleNs.Options> = {
    freq: FREQ_BY_REPEATS[form.repeats],
    interval,
  };

  if (form.repeats === "weekly" && form.recurrenceByDay.length > 0) {
    options.byweekday = form.recurrenceByDay.map((c) => WEEKDAY_BY_CODE[c]);
  }

  if (form.repeats === "monthly") {
    // The day the series starts drives both monthly modes.
    const start = new Date(ukLocalToIso(form.when));
    const dayOfMonth = Number(formatInTimeZone(start, EVENT_TZ, "d"));
    const weekday = Number(formatInTimeZone(start, EVENT_TZ, "i")) - 1; // 1..7 -> 0..6
    if (form.recurrenceMonthMode === "nthWeekday") {
      options.byweekday = [WEEKDAY_BY_CODE[WEEKDAY_CODES[weekday]]];
      options.bysetpos = [weekOfMonth(dayOfMonth)];
    } else {
      options.bymonthday = [dayOfMonth];
    }
  }

  if (form.recurrenceEnd === "count") {
    options.count = Math.max(1, Number(form.recurrenceCount) || 1);
  } else if (form.recurrenceEnd === "until" && form.recurrenceUntil) {
    // End of the chosen UK day, encoded in the floating space the shared
    // expander compares against (see packages/shared .../recurrence.ts).
    const [y, m, d] = form.recurrenceUntil.split("-").map(Number);
    options.until = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  }

  // optionsToString emits "RRULE:FREQ=..."; store the body only.
  const body = RRule.optionsToString(options).replace(/^RRULE:/, "");
  return {
    rrule: body,
    ...(form.recurrenceExceptions.length > 0
      ? { exceptions: form.recurrenceExceptions }
      : {}),
  };
}

/** Hydrate the recurrence builder fields from stored metadata.recurrence. */
function recurrenceFormFields(recurrence: unknown): {
  repeats: RepeatsOption;
  recurrenceInterval: string;
  recurrenceByDay: string[];
  recurrenceMonthMode: "dayOfMonth" | "nthWeekday";
  recurrenceEnd: "never" | "until" | "count";
  recurrenceUntil: string;
  recurrenceCount: string;
  recurrenceExceptions: string[];
} {
  const defaults = {
    repeats: "none" as RepeatsOption,
    recurrenceInterval: "1",
    recurrenceByDay: [] as string[],
    recurrenceMonthMode: "dayOfMonth" as "dayOfMonth" | "nthWeekday",
    recurrenceEnd: "never" as "never" | "until" | "count",
    recurrenceUntil: "",
    recurrenceCount: "",
    recurrenceExceptions: [] as string[],
  };
  const rule =
    typeof recurrence === "object" &&
    recurrence !== null &&
    typeof (recurrence as Record<string, unknown>).rrule === "string"
      ? (recurrence as { rrule: string; exceptions?: unknown })
      : null;
  if (!rule) return defaults;

  let options: Partial<rruleNs.Options>;
  try {
    options = RRule.parseString(rule.rrule);
  } catch {
    return defaults;
  }

  const repeats: RepeatsOption =
    options.freq === RRule.DAILY
      ? "daily"
      : options.freq === RRule.WEEKLY
        ? "weekly"
        : options.freq === RRule.MONTHLY
          ? "monthly"
          : options.freq === RRule.YEARLY
            ? "yearly"
            : "none";

  // byweekday entries may be Weekday instances or plain numbers.
  const byDayNums = toArray(options.byweekday).map((w) =>
    typeof w === "number" ? w : (w as rruleNs.Weekday).weekday,
  );
  const bysetpos = toArray(options.bysetpos);

  return {
    repeats,
    recurrenceInterval: String(options.interval ?? 1),
    recurrenceByDay:
      repeats === "weekly"
        ? byDayNums.flatMap((n) => (WEEKDAY_CODES[n] ? [WEEKDAY_CODES[n]] : []))
        : [],
    recurrenceMonthMode: bysetpos.length > 0 ? "nthWeekday" : "dayOfMonth",
    recurrenceEnd:
      options.count != null
        ? "count"
        : options.until != null
          ? "until"
          : "never",
    recurrenceUntil: options.until
      ? `${pad4(options.until.getUTCFullYear())}-${pad2(options.until.getUTCMonth() + 1)}-${pad2(options.until.getUTCDate())}`
      : "",
    recurrenceCount: options.count != null ? String(options.count) : "",
    recurrenceExceptions: Array.isArray(rule.exceptions)
      ? rule.exceptions.filter((d): d is string => typeof d === "string")
      : [],
  };
}

const toArray = <T,>(value: T | T[] | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

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
 * Hydrate per-kind form fields from stored metadata. Defensive on
 * purpose: stored JSON may predate the current schema, so anything
 * malformed degrades to the field default rather than crashing the
 * editor. Shared by the initial load and revision restore (#500).
 */
function metadataFormFields(
  metadata: Record<string, unknown>,
): Omit<FormState, "title" | "slug" | "description" | "parentId"> {
  const location =
    typeof metadata.location === "object" && metadata.location !== null
      ? (metadata.location as Record<string, unknown>)
      : null;
  return {
    playCricketId: asString(metadata.playCricketId),
    menuOrder: asNumberString(metadata.menuOrder) || "99",
    isMainMenu: metadata.isMainMenu === true,
    hideTitle: metadata.hideTitle === true,
    ldjson:
      typeof metadata.ldjson === "object" && metadata.ldjson !== null
        ? JSON.stringify(metadata.ldjson, null, 2)
        : "",
    tags: Array.isArray(metadata.tags)
      ? metadata.tags.filter(
          (tag): tag is string => typeof tag === "string" && tag !== "",
        )
      : [],
    authorSlug: asString(metadata.authorSlug),
    when: isoToUkLocal(metadata.when),
    finish: isoToUkLocal(metadata.finish),
    ...recurrenceFormFields(metadata.recurrence),
    hasLocation: location !== null,
    locationName: asString(location?.name),
    locationStreet: asString(location?.street),
    locationCity: asString(location?.city),
    locationPostcode: asString(location?.postcode),
    locationLat: asNumberString(location?.lat),
    locationLon: asNumberString(location?.lon),
    isDBSChecked: metadata.isDBSChecked === true,
    hasLeftClub: metadata.hasLeftClub === true,
    photo: parsePictureValue(metadata.photo),
  };
}

function initialForm(
  item: ContentItemDetail | null,
  newParentId: string | null,
): FormState {
  return {
    title: item?.title ?? "",
    slug: item?.slug ?? "",
    description: item?.description ?? "",
    parentId: item !== null ? item.parentId : newParentId,
    ...metadataFormFields(item?.metadata ?? {}),
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
    if (form.repeats !== "none") {
      if (form.recurrenceEnd === "until" && !form.recurrenceUntil) {
        return "Set the date the repeat ends on (or choose another end option)";
      }
      if (
        form.recurrenceEnd === "count" &&
        !(Number(form.recurrenceCount) >= 1)
      ) {
        return "Set how many times the event repeats";
      }
      const recurrence = buildEventRecurrence(form);
      if (!recurrence) return "The recurrence rule is incomplete";
    }
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
    const recurrence = buildEventRecurrence(form);
    return {
      when: ukLocalToIso(form.when),
      ...(form.finish ? { finish: ukLocalToIso(form.finish) } : {}),
      ...(recurrence ? { recurrence } : {}),
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
  if (kind === "person") {
    return {
      isDBSChecked: form.isDBSChecked,
      hasLeftClub: form.hasLeftClub,
      // Omitted entirely when there is no photo - never null/"".
      ...(form.photo !== null ? { photo: form.photo } : {}),
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
  const existingTags = new Set(tags);

  const commit = (raw: string) => {
    const tag = raw.trim();
    if (tag && !existingTags.has(tag)) onChange([...tags, tag]);
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
          // IME composition: Enter confirms the candidate, not the tag.
          if (e.nativeEvent.isComposing) return;
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
          existingTags.has(s) ? [] : [<option key={s} value={s} />],
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
  const people = usePeopleList();
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

// menuOrder is deliberately NOT covered by this lock: it is presentation
// only, so ordering stays editable after publish.
const PATH_LOCKED_HINT = "Locked after publish - the page's address is fixed";

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
  const { data } = useAuthedQuery({
    queryKey: ["admin", "content", "page-tree"],
    queryFn: () => callApi(api.GET("/api/admin/content/page-tree")),
  });
  const items = useMemo(() => data?.items ?? [], [data]);

  // Parent options: see eligibleParents (excludes self, descendants and
  // archived pages, keeping the currently-selected parent even when
  // archived so the Select isn't blank).
  const options = useMemo(() => {
    const eligible = eligibleParents(items, itemId, form.parentId);
    const allExpanded = new Set(eligible.map((item) => item.id));
    return visibleNodes(buildPageTree(eligible), allExpanded);
  }, [items, itemId, form.parentId]);

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
                {node.item.status === "archived" ? " (archived)" : ""}
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

function PersonPhotoField({
  photo,
  personName,
  consentConfirmed,
  onChange,
}: {
  photo: PictureSource | null;
  personName: string;
  consentConfirmed: boolean;
  onChange: (photo: PictureSource | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFileChosen = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // Same pipeline as editor images: presign -> S3 PUT -> confirm
      // (EXIF strip + responsive ladder). The descriptor lands in
      // metadata.photo instead of a contentImage block.
      const uploaded = await uploadContentImage(file, {});
      onChange(uploaded.picture);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Upload failed - try again",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>Profile photo (optional)</Label>
      {photo !== null ? (
        <OptimisedImage
          picture={photo}
          alt={personName || "Profile photo"}
          className="size-32 rounded-full object-cover"
          sizes="128px"
          width={128}
          height={128}
        />
      ) : (
        <p className="text-xs text-stone-500">
          No photo yet - the public profile shows a placeholder.
        </p>
      )}
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
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => {
            setError(null);
            if (!consentConfirmed) {
              setError("Tick the photo consent box below before uploading.");
              return;
            }
            fileInputRef.current?.click();
          }}
        >
          {uploading
            ? "Uploading…"
            : photo !== null
              ? "Replace photo"
              : "Upload photo"}
        </Button>
        {photo !== null && (
          <Button
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => {
              onChange(null);
            }}
          >
            Remove photo
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function PersonMetadataFields({
  form,
  consentConfirmed,
  onChange,
}: {
  form: FormState;
  consentConfirmed: boolean;
  onChange: (updates: Partial<FormState>) => void;
}) {
  return (
    <>
      <PersonPhotoField
        photo={form.photo}
        personName={form.title}
        consentConfirmed={consentConfirmed}
        onChange={(photo) => {
          onChange({ photo });
        }}
      />
      <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs leading-snug text-stone-700">
          Safeguarding: both flags below appear on the public website, so keep
          them accurate. Only tick DBS checked once the club has verified a
          current certificate, and untick it if the check lapses.
        </p>
        <div className="flex items-center gap-2">
          <Checkbox
            id="person-dbs-checked"
            checked={form.isDBSChecked}
            onCheckedChange={(value) => {
              onChange({ isDBSChecked: value === true });
            }}
          />
          <Label htmlFor="person-dbs-checked">
            DBS checked (shows the DBS badge on the profile)
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="person-has-left-club"
            checked={form.hasLeftClub}
            onCheckedChange={(value) => {
              onChange({ hasLeftClub: value === true });
            }}
          />
          <Label htmlFor="person-has-left-club">
            Has left the club (kept out of player and sponsorship pickers)
          </Label>
        </div>
      </div>
    </>
  );
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Structured recurrence builder for events. Drives the iCal RRULE body and
 * exception list under metadata.recurrence via the shared expander, so the
 * preview here matches exactly what every public surface will render.
 */
function EventRecurrenceFields({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
}) {
  const exceptions = new Set(form.recurrenceExceptions);

  // Preview the next handful of occurrences, ignoring exceptions so cancelled
  // dates still show (struck-through) with a Restore action.
  const preview = useMemo(() => {
    if (form.repeats === "none" || !form.when) return [];
    const rule = buildEventRecurrence({ ...form, recurrenceExceptions: [] });
    if (!rule) return [];
    const start = new Date(ukLocalToIso(form.when));
    const horizonDays =
      { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[form.repeats] ?? 31;
    const interval = Math.max(1, Number(form.recurrenceInterval) || 1);
    const to = new Date(
      start.getTime() + horizonDays * interval * 9 * 24 * 60 * 60 * 1000,
    );
    return expandEventOccurrences(
      { when: start.toISOString(), recurrence: rule },
      { from: new Date(start.getTime() - 1000), to },
    ).slice(0, 8);
  }, [form]);

  const toggleException = (date: string) => {
    onChange({
      recurrenceExceptions: exceptions.has(date)
        ? form.recurrenceExceptions.filter((d) => d !== date)
        : [...form.recurrenceExceptions, date].sort(),
    });
  };

  const toggleWeekday = (code: string) => {
    const selected = new Set(form.recurrenceByDay);
    if (selected.has(code)) selected.delete(code);
    else selected.add(code);
    onChange({
      recurrenceByDay: WEEKDAY_CODES.filter((c) => selected.has(c)),
    });
  };

  // Monthly mode labels reflect the start date the rule anchors on.
  const start = form.when ? new Date(ukLocalToIso(form.when)) : null;
  const monthlyDayLabel = start
    ? `On day ${formatInTimeZone(start, EVENT_TZ, "d")} of the month`
    : "On day-of-month";
  const monthlyNthLabel = start
    ? `On the ${ordinal(weekOfMonth(Number(formatInTimeZone(start, EVENT_TZ, "d"))))} ${formatInTimeZone(start, EVENT_TZ, "EEEE")}`
    : "On the Nth weekday";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-200 p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-repeats">Repeats</Label>
        <Select
          value={form.repeats}
          onValueChange={(value) => {
            onChange({ repeats: value as RepeatsOption });
          }}
        >
          <SelectTrigger id="event-repeats">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPEATS_LABELS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {form.repeats !== "none" && (
        <>
          <div className="flex items-center gap-2">
            <Label htmlFor="event-recurrence-interval">Every</Label>
            <Input
              id="event-recurrence-interval"
              type="number"
              min={1}
              className="w-20"
              value={form.recurrenceInterval}
              onChange={(e) => {
                onChange({ recurrenceInterval: e.target.value });
              }}
            />
            <span className="text-sm text-stone-600">
              {{
                daily: "day(s)",
                weekly: "week(s)",
                monthly: "month(s)",
                yearly: "year(s)",
                none: "",
              }[form.repeats] ?? ""}
            </span>
          </div>

          {form.repeats === "weekly" && (
            <div className="flex flex-col gap-1">
              <Label>On days</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_CODES.map((code) => (
                  <label key={code} className="flex items-center gap-1">
                    <Checkbox
                      checked={form.recurrenceByDay.includes(code)}
                      onCheckedChange={() => {
                        toggleWeekday(code);
                      }}
                    />
                    <span className="text-sm">{code}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {form.repeats === "monthly" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-recurrence-month-mode">Monthly on</Label>
              <Select
                value={form.recurrenceMonthMode}
                onValueChange={(value) => {
                  onChange({
                    recurrenceMonthMode: value as "dayOfMonth" | "nthWeekday",
                  });
                }}
              >
                <SelectTrigger id="event-recurrence-month-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dayOfMonth">{monthlyDayLabel}</SelectItem>
                  <SelectItem value="nthWeekday">{monthlyNthLabel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="event-recurrence-end">Ends</Label>
            <Select
              value={form.recurrenceEnd}
              onValueChange={(value) => {
                onChange({
                  recurrenceEnd: value as "never" | "until" | "count",
                });
              }}
            >
              <SelectTrigger id="event-recurrence-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="until">On date</SelectItem>
                <SelectItem value="count">After N times</SelectItem>
              </SelectContent>
            </Select>
            {form.recurrenceEnd === "until" && (
              <Input
                type="date"
                className="mt-1"
                value={form.recurrenceUntil}
                onChange={(e) => {
                  onChange({ recurrenceUntil: e.target.value });
                }}
              />
            )}
            {form.recurrenceEnd === "count" && (
              <Input
                type="number"
                min={1}
                className="mt-1 w-24"
                value={form.recurrenceCount}
                onChange={(e) => {
                  onChange({ recurrenceCount: e.target.value });
                }}
              />
            )}
          </div>

          {preview.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Upcoming occurrences</Label>
              <ul className="flex flex-col gap-1">
                {preview.map((occ) => {
                  const cancelled = exceptions.has(occ.date);
                  return (
                    <li
                      key={occ.date}
                      className="flex items-center justify-between gap-2"
                    >
                      <span
                        className={cn(
                          "text-sm",
                          cancelled && "text-stone-400 line-through",
                        )}
                      >
                        {formatInTimeZone(
                          new Date(occ.start),
                          EVENT_TZ,
                          "EEE d MMM yyyy, HH:mm",
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          toggleException(occ.date);
                        }}
                      >
                        {cancelled ? "Restore" : "Skip"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetadataFields({
  kind,
  form,
  itemId,
  slugLocked,
  tagSuggestions,
  consentConfirmed,
  onChange,
}: {
  kind: ContentKind;
  form: FormState;
  itemId: string | null;
  slugLocked: boolean;
  tagSuggestions: string[];
  consentConfirmed: boolean;
  onChange: (updates: Partial<FormState>) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="content-title">
          {kind === "person" ? "Name" : "Title"}
        </Label>
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
          <EventRecurrenceFields form={form} onChange={onChange} />
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
      {kind === "person" && (
        <PersonMetadataFields
          form={form}
          consentConfirmed={consentConfirmed}
          onChange={onChange}
        />
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
  const authedKey = useAuthedQueryKey();
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
      void queryClient.invalidateQueries({
        queryKey: authedKey(["admin", "content"]),
      });
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

// ── Revision history (#500) ─────────────────────────────────────────────

type RevisionDetail =
  paths["/api/admin/content/{contentId}/revisions/{revisionId}"]["get"]["responses"][200]["content"]["application/json"];

function DiffView({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0 || lines.every((line) => line.type === "same")) {
    return <p className="text-sm text-stone-500">No differences.</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded border border-stone-200 bg-white p-2 font-mono text-xs whitespace-pre-wrap">
      {/* Index keys are safe here: the diff is a pure projection of
          immutable data, rebuilt whole whenever either side changes. */}
      {lines.map((line, i) => (
        <div
          key={`diff-${String(i)}`}
          className={
            line.type === "removed"
              ? "bg-red-50 text-red-700"
              : line.type === "added"
                ? "bg-green-50 text-green-700"
                : "text-stone-600"
          }
        >
          {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}

function RevisionDialog({
  item,
  revisionId,
  canRestore,
  onRestore,
  onClose,
}: {
  item: ContentItemDetail;
  revisionId: string;
  canRestore: boolean;
  onRestore: (revision: RevisionDetail) => boolean;
  onClose: () => void;
}) {
  const {
    data: revision,
    isLoading,
    error,
  } = useAuthedQuery({
    queryKey: ["admin", "content", "revision", item.id, revisionId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/content/{contentId}/revisions/{revisionId}", {
          params: { path: { contentId: item.id, revisionId } },
        }),
      ),
  });

  // Both diffs read "this version -> latest saved version": red lines
  // exist only in this version (restore brings them back), green lines
  // were added since. Unsaved editor changes are not part of either side.
  const bodyDiff = useMemo(
    () =>
      revision
        ? diffLines(blocksToLines(revision.body), blocksToLines(item.body))
        : [],
    [revision, item.body],
  );
  const detailsDiff = useMemo(
    () =>
      revision
        ? diffLines(
            detailLines(revision),
            detailLines({
              title: item.title,
              description: item.description,
              metadata: item.metadata,
            }),
          )
        : [],
    [revision, item],
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {revision
              ? `Version from ${formatUkTime(revision.savedAt)}`
              : "Version"}
          </DialogTitle>
          <DialogDescription>
            Compared with the latest saved version:{" "}
            <span className="text-red-700">- only in this version</span>,{" "}
            <span className="text-green-700">+ added since</span>. Restoring
            copies this version into the editor - nothing changes until you
            save.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600">
            Couldn&apos;t load this version - {error.message}
          </p>
        ) : isLoading || !revision ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          <div className="flex flex-col gap-3">
            {revision.savedByName && (
              <p className="text-sm text-stone-600">
                Saved by {revision.savedByName}
              </p>
            )}
            <div>
              <h4 className="mb-1 text-sm font-medium">Content</h4>
              <DiffView lines={bodyDiff} />
            </div>
            <div>
              <h4 className="mb-1 text-sm font-medium">Details</h4>
              <DiffView lines={detailsDiff} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {canRestore && revision && (
            <Button
              onClick={() => {
                // Stays open when the author backs out of overwriting
                // unsaved work.
                if (onRestore(revision)) onClose();
              }}
            >
              Restore this version
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryCard({
  item,
  canRestore,
  onRestore,
}: {
  item: ContentItemDetail;
  canRestore: boolean;
  onRestore: (revision: RevisionDetail) => boolean;
}) {
  const { data, isLoading, error } = useAuthedQuery({
    queryKey: ["admin", "content", "revisions", item.id],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/content/{contentId}/revisions", {
          params: { path: { contentId: item.id } },
        }),
      ),
  });
  const [openRevisionId, setOpenRevisionId] = useState<string | null>(null);
  const revisions = data?.revisions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">History</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <p className="text-sm text-red-600">
            Couldn&apos;t load history - {error.message}
          </p>
        ) : isLoading ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {revisions.map((rev, i) => (
              <li key={rev.id}>
                <button
                  type="button"
                  className="w-full rounded px-1 py-1 text-left hover:bg-stone-100"
                  onClick={() => {
                    setOpenRevisionId(rev.id);
                  }}
                >
                  <span className="block text-sm">
                    {formatUkTime(rev.savedAt)}
                    {i === 0 ? " (latest)" : ""}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {rev.savedByName ?? "Unknown"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-stone-500">
          Every save keeps the previous version here, so nothing is ever lost.
          Open one to compare or restore it.
        </p>
      </CardContent>
      {openRevisionId !== null && (
        <RevisionDialog
          item={item}
          revisionId={openRevisionId}
          canRestore={canRestore}
          onRestore={onRestore}
          onClose={() => {
            setOpenRevisionId(null);
          }}
        />
      )}
    </Card>
  );
}

/**
 * Copy a revision into the working draft (#500): the editor and form
 * take the revision's body/metadata, and nothing persists until the
 * author saves - which writes a NEW revision, so the timeline stays
 * append-only and history is never rewritten. Slug and (for pages)
 * parent are not part of a revision and stay as they are. Restoring
 * never changes publish status.
 */
function useRevisionRestore({
  editor,
  setForm,
  dirtyRef,
}: {
  editor: Editor;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  dirtyRef: React.RefObject<boolean>;
}) {
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  /**
   * Returns false when the author backs out of overwriting unsaved
   * work - the dialog stays open so nothing is lost either way.
   */
  const restoreRevision = (revision: RevisionDetail): boolean => {
    if (
      dirtyRef.current &&
      !window.confirm(
        "Restoring will replace your unsaved changes with this version. Continue?",
      )
    ) {
      return false;
    }
    editor.replaceBlocks(
      editor.document,
      revision.body.length > 0
        ? (revision.body as PartialBlock[])
        : [{ type: "paragraph" }],
    );
    setForm((prev) => ({
      ...prev,
      title: revision.title,
      description: revision.description ?? "",
      ...metadataFormFields(revision.metadata),
    }));
    dirtyRef.current = true;
    setRestoreNotice(
      `Restored the version from ${formatUkTime(revision.savedAt)} - review it, then save to keep it.`,
    );
    return true;
  };

  return {
    restoreNotice,
    clearRestoreNotice: () => {
      setRestoreNotice(null);
    },
    restoreRevision,
  };
}

function EditorPane({
  editor,
  slashItems,
  onDirty,
}: {
  editor: Editor;
  slashItems: () => ReturnType<typeof getDefaultReactSlashMenuItems>;
  onDirty: () => void;
}) {
  // No separate preview tab: every block renders its published look in
  // place, so the canvas IS the preview. It sits on the same creamy
  // background as the public pages so card-style blocks (league table,
  // contact form, game/event previews) read exactly like the live site.
  return (
    // fc-theme on the canvas wrapper makes the editor a First-Class scope, so
    // the SAME .fc-theme content rules that style published pages style the
    // canvas — the preview matches the live site without any separate styling.
    <div className="fc-theme bg-body rounded-lg border border-stone-200 py-4">
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
  );
}

/**
 * "Assistant" sidebar tab body. Self-contained so the giant LoadedEditor
 * doesn't carry the AI state. Wires the live editor into the chat panel:
 * projects the draft into the agent's editor context and applies streamed
 * blocks/ops back to the document.
 */
function AssistantPane({
  editor,
  kind,
  form,
  dirtyRef,
}: {
  editor: Editor;
  kind: ContentKind;
  form: FormState;
  dirtyRef: React.RefObject<boolean>;
}) {
  // No manual memoisation: React Compiler caches these (react-doctor flags
  // useCallback here as dead weight).
  const handleInsertBlocks = (blocks: ResolvedBlock[]) => {
    appendBlocks(editor, blocks);
    dirtyRef.current = true;
  };

  const handleApplyOps = (ops: ResolvedEditOp[]) => {
    const result = applyEditOps(editor, ops);
    if (result.applied) dirtyRef.current = true;
    return result.applied;
  };

  // Built fresh on each send so the agent sees the current draft (block ids +
  // text via the projection) and metadata (e.g. a game report's
  // playCricketId).
  const getEditorContext = (): ContentAiEditorContext => {
    let metadata: Record<string, unknown>;
    try {
      // buildMetadata can throw on a half-filled draft (e.g. an empty event
      // date); the agent works fine with empty metadata in that case.
      metadata = buildMetadata(kind, form);
    } catch {
      metadata = {};
    }
    return {
      kind,
      title: form.title,
      slug: form.slug || undefined,
      metadata,
      blocks: projectDraftBlocks(editor.document),
    };
  };

  return (
    <ContentAiPanel
      getEditorContext={getEditorContext}
      onInsertBlocks={handleInsertBlocks}
      onApplyOps={handleApplyOps}
    />
  );
}

/**
 * The editor's left column: "Details" (metadata, publishing, history,
 * consent) and "Assistant" (AI chat) as tabs. The active tab lives in the
 * URL (?panel=assistant; details is the default and stays out of the URL,
 * matching the admin panel's section/sub convention). Both panels stay
 * mounted (forceMount) so the assistant's conversation survives tab
 * switches - that persistence is the whole point of the sidebar over the
 * old modal.
 */
function EditorSidebar({
  assistant,
  children,
}: {
  /** The assistant pane, or null when the user lacks the ai_content permission. */
  assistant: ReactNode | null;
  children: ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const panel =
    searchParams.get("panel") === "assistant" && assistant !== null
      ? "assistant"
      : "details";

  const onPanelChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === "assistant") params.set("panel", "assistant");
    else params.delete("panel");
    // Push (not replace): tab switches are navigation, Back retraces them.
    setSearchParams(params);
  };

  if (assistant === null) {
    return <div className="flex flex-col gap-3">{children}</div>;
  }

  return (
    <Tabs value={panel} onValueChange={onPanelChange}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="assistant">✨ Assistant</TabsTrigger>
      </TabsList>
      <TabsContent value="details" forceMount>
        <div className="flex flex-col gap-3">{children}</div>
      </TabsContent>
      <TabsContent value="assistant" forceMount>
        {/* Display/height classes live on this inner wrapper, never on the
            hidden tabpanel element itself, so the hidden attribute always
            wins. Sticky + viewport height on lg keeps the chat usable while
            the canvas scrolls (scout.tsx height pattern). */}
        <div className="flex h-[60vh] flex-col lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]">
          {assistant}
        </div>
      </TabsContent>
    </Tabs>
  );
}

/**
 * The slash-menu "Upload photo" flow: consent gate -> hidden file input
 * -> upload pipeline -> insert a contentImage block at the cursor. The
 * caller renders the returned handlers onto its own <input type="file">.
 */
function useSlashImageUpload(editor: Editor, consentConfirmed: boolean) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return { uploadError, fileInputRef, startImageUpload, onFileChosen };
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
  const authedKey = useAuthedQueryKey();
  const { allowed: canManage } = useHasPermission(
    CONTENT_KIND_RESOURCES[kind],
    "manage",
  );
  const { allowed: canPublish } = useHasPermission(
    CONTENT_KIND_RESOURCES[kind],
    "publish",
  );
  // Gated on the same permission the route enforces, so the Assistant tab
  // never shows for a user who'd get a 403.
  const { allowed: aiAllowed } = useHasPermission("ai_content", "use");

  const [form, setForm] = useState<FormState>(() =>
    initialForm(item, newParentId),
  );
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    item?.updatedAt ?? null,
  );
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
    // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone -- deliberate JSON round-trip: validates the exact plain-JSON shape the API receives, dropping non-JSON values structuredClone would keep
    contentBodySchema.parse(JSON.parse(JSON.stringify(editor.document)));

  const { restoreNotice, clearRestoreNotice, restoreRevision } =
    useRevisionRestore({ editor, setForm, dirtyRef });

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
      clearRestoreNotice();
      setLastSavedAt(new Date().toISOString());
      void queryClient.invalidateQueries({
        queryKey: authedKey(["admin", "content"]),
      });
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

  const { uploadError, fileInputRef, startImageUpload, onFileChosen } =
    useSlashImageUpload(editor, consentConfirmed);

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

      {restoreNotice && (
        <p className="text-sm text-amber-700">{restoreNotice}</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <EditorSidebar
            assistant={
              aiAllowed ? (
                <AssistantPane
                  editor={editor}
                  kind={kind}
                  form={form}
                  dirtyRef={dirtyRef}
                />
              ) : null
            }
          >
            <MetadataFields
              kind={kind}
              form={form}
              itemId={item?.id ?? null}
              slugLocked={slugLocked}
              tagSuggestions={tagSuggestions}
              consentConfirmed={consentConfirmed}
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
            {item !== null && (
              <HistoryCard
                item={item}
                canRestore={canSave}
                onRestore={restoreRevision}
              />
            )}
            <ConsentBox
              checked={consentConfirmed}
              onChange={setConsentConfirmed}
            />
            {uploadError && (
              <p className="text-sm text-red-600">{uploadError}</p>
            )}
          </EditorSidebar>
        </div>

        <div className="lg:col-span-2">
          {/* Blocks with their own upload affordance (photo gallery)
              read the consent tick through context - they render inside
              the BlockNote canvas and can't take page props. */}
          <UploadConsentContext.Provider value={consentConfirmed}>
            <EditorPane
              editor={editor}
              slashItems={slashItems}
              onDirty={() => {
                dirtyRef.current = true;
              }}
            />
          </UploadConsentContext.Provider>
        </div>
      </div>
    </div>
  );
}
