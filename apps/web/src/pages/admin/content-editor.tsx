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
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Checkbox } from "@/components/ui/checkbox.js";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

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

interface EditorProps {
  kind: ContentKind;
  contentId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export default function ContentEditor({
  kind,
  contentId,
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
  playCricketId: string;
}

function MetadataFields({
  kind,
  form,
  slugLocked,
  onChange,
}: {
  kind: ContentKind;
  form: FormState;
  slugLocked: boolean;
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
    </>
  );
}

function PublishingCard({
  item,
  canPublish,
  canManage,
}: {
  item: ContentItemDetail;
  canPublish: boolean;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [publishAt, setPublishAt] = useState("");

  const statusMutation = useMutation({
    mutationFn: async (action: "publish" | "unpublish" | "archive") => {
      if (action === "publish") {
        await callApi(
          api.POST("/api/admin/content/{contentId}/publish", {
            params: { path: { contentId: item.id } },
            body: publishAt
              ? { publishedAt: new Date(publishAt).toISOString() }
              : {},
          }),
        );
      } else if (action === "unpublish") {
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Publishing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-stone-600">
          Status: <strong>{item.status}</strong>
          {item.publishedAt &&
            ` · live from ${new Date(item.publishedAt).toLocaleString("en-GB")}`}
        </p>
        {item.status !== "archived" && (canPublish || canManage) && (
          <>
            {canPublish && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="publish-at">
                  Schedule (leave empty to publish now)
                </Label>
                <Input
                  id="publish-at"
                  type="datetime-local"
                  value={publishAt}
                  onChange={(e) => {
                    setPublishAt(e.target.value);
                  }}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {canPublish && (
                <Button
                  size="sm"
                  disabled={statusMutation.isPending}
                  onClick={() => {
                    statusMutation.mutate("publish");
                  }}
                >
                  {publishAt ? "Schedule" : "Publish"}
                </Button>
              )}
              {canPublish && item.status === "published" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={statusMutation.isPending}
                  onClick={() => {
                    statusMutation.mutate("unpublish");
                  }}
                >
                  Unpublish
                </Button>
              )}
              {canManage && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={statusMutation.isPending}
                  onClick={() => {
                    statusMutation.mutate("archive");
                  }}
                >
                  Archive
                </Button>
              )}
            </div>
          </>
        )}
        {statusMutation.error && (
          <p className="text-sm text-red-600">
            {statusMutation.error instanceof Error
              ? statusMutation.error.message
              : "Action failed"}
          </p>
        )}
      </CardContent>
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
}: {
  editor: Editor;
  slashItems: () => ReturnType<typeof getDefaultReactSlashMenuItems>;
  currentBody: () => unknown;
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
          <BlockNoteView editor={editor} theme="light" slashMenu={false}>
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
  onClose,
  onCreated,
}: {
  kind: ContentKind;
  item: ContentItemDetail | null;
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

  const [form, setForm] = useState<FormState>({
    title: item?.title ?? "",
    slug: item?.slug ?? "",
    description: item?.description ?? "",
    playCricketId:
      typeof item?.metadata.playCricketId === "string"
        ? item.metadata.playCricketId
        : "",
  });
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    item?.updatedAt ?? null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the author has manually edited the slug (handler-only flag:
  // it never affects what's on screen, only how title edits behave).
  const slugTouchedRef = useRef(item !== null);

  const slugLocked = item?.publishedAt != null;

  const onFormChange = (updates: Partial<FormState>) => {
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
      const metadata = { playCricketId: form.playCricketId };
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
            },
          }),
        );
      }
      return await callApi(
        api.PUT("/api/admin/content/{contentId}", {
          params: { path: { contentId: item.id } },
          body: {
            ...(slugLocked ? {} : { slug: form.slug }),
            title: form.title,
            description: form.description || null,
            body,
            metadata,
          },
        }),
      );
    },
    onSuccess: (result) => {
      setLastSavedAt(new Date().toISOString());
      void queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
      if (item === null) onCreated(result.id);
    },
  });

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

  const slashItems = () => [
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
        <Button variant="ghost" size="sm" onClick={onClose}>
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
          {canManage && (
            <Button
              onClick={() => {
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending || !form.title || !form.slug}
            >
              {saveMutation.isPending
                ? "Saving…"
                : item === null
                  ? "Create draft"
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
            slugLocked={slugLocked}
            onChange={onFormChange}
          />
          {item !== null && (
            <PublishingCard
              item={item}
              canPublish={canPublish}
              canManage={canManage}
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
          />
        </div>
      </div>
    </div>
  );
}
