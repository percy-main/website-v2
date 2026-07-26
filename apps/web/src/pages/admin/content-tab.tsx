import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { api, callApi } from "@/lib/api-client";
import {
  CONTENT_KIND_RESOURCES,
  CONTENT_STATUSES,
  type ContentKind,
  type ContentStatus,
} from "@percy-main/shared/content";
import { useQuery } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { lazy, Suspense } from "react";
import { IoOpenOutline } from "react-icons/io5";
import { useSearchParams } from "react-router";
import { CONTENT_KIND_NOUNS } from "./content-kind-labels.js";
import { displayState, STATE_BADGES, UUID_RE } from "./content-state.js";

// The editor pulls in BlockNote (the single heaviest dependency in the
// admin panel), so it loads as its own chunk only when an item is open.
const ContentEditor = lazy(() => import("./content-editor.js"));

const PAGE_SIZE = 20;

/**
 * Public URL a published item is live at. Per-kind: game reports render
 * inside their game page; news and events have slug-routed pages. Later
 * kinds add their mappings here.
 */
function liveUrl(
  kind: ContentKind,
  item: { metadata: Record<string, unknown>; slug: string },
): string | null {
  if (kind === "game_report") {
    const playCricketId = item.metadata.playCricketId;
    return typeof playCricketId === "string" && playCricketId !== ""
      ? `/calendar/game/${playCricketId}`
      : null;
  }
  if (kind === "news") return `/news/article/${item.slug}`;
  if (kind === "event") return `/calendar/event/${item.slug}`;
  if (kind === "person") return `/person/${item.slug}`;
  return null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Content list + editor for one content kind. All UI state (open item,
 * status filter, search, page) lives in the URL alongside the admin
 * panel's section/sub params, so deep links restore the full view.
 */
export function ContentTab({ kind }: { kind: ContentKind }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const { allowed: canManage } = useHasPermission(
    CONTENT_KIND_RESOURCES[kind],
    "manage",
  );

  // URL state is user input: anything unexpected degrades to the default
  // rather than reaching the typed API call.
  const itemParam = searchParams.get("item");
  const openItem =
    itemParam === "new" || (itemParam !== null && UUID_RE.test(itemParam))
      ? itemParam
      : null;
  const statusParam = searchParams.get("status");
  const status: ContentStatus | "all" = (
    CONTENT_STATUSES as readonly string[]
  ).includes(statusParam ?? "")
    ? (statusParam as ContentStatus)
    : "all";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  /**
   * Navigation-like changes (open/close item, filters, paging) push a
   * history entry so the back button retraces steps; continuous
   * refinements (search keystrokes) and the new->id swap replace, so
   * history isn't spammed with intermediate states.
   */
  const setParams = (
    updates: Record<string, string | null>,
    options: { replace?: boolean } = {},
  ) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: options.replace ?? false });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "content", kind, status, search, page],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/content", {
          params: {
            query: {
              kind,
              ...(status !== "all" ? { status } : {}),
              ...(search ? { search } : {}),
              page,
              pageSize: PAGE_SIZE,
            },
          },
        }),
      ),
    enabled: openItem === null,
  });

  if (openItem !== null) {
    return (
      <Suspense
        fallback={
          <p className="py-8 text-sm text-stone-500">Loading editor…</p>
        }
      >
        <ContentEditor
          kind={kind}
          contentId={openItem === "new" ? null : openItem}
          onClose={() => {
            // Closing the create form replaces: Back from the list must
            // not reopen a stale ?item=new entry. The editor's sidebar
            // panel param goes with it - it means nothing on the list.
            setParams(
              { item: null, panel: null },
              { replace: openItem === "new" },
            );
          }}
          onCreated={(id) => {
            // Swap "new" for the created id: back must not return to the
            // create form and spawn a duplicate.
            setParams({ item: id }, { replace: true });
          }}
        />
      </Suspense>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search titles…"
            value={search}
            onChange={(e) => {
              setParams({ q: e.target.value, page: null }, { replace: true });
            }}
            className="w-56"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setParams({ status: value === "all" ? null : value, page: null });
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setParams({ item: "new" });
            }}
          >
            New {CONTENT_KIND_NOUNS[kind]}
          </Button>
        )}
      </div>

      {error ? (
        <p className="py-8 text-sm text-red-600">
          Couldn't load content - {error.message}
        </p>
      ) : isLoading ? (
        <p className="py-8 text-sm text-stone-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-sm text-stone-500">
          No content yet - create the first one.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-36">Status</TableHead>
              <TableHead className="w-56">Last updated</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Live page</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const state = displayState(item);
              const itemLiveUrl = liveUrl(kind, item);
              return (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setParams({ item: item.id });
                  }}
                >
                  <TableCell className="font-medium">{item.title}</TableCell>
                  <TableCell>
                    <Badge variant={STATE_BADGES[state].variant}>
                      {STATE_BADGES[state].label}
                    </Badge>
                    {state === "scheduled" && item.publishedAt !== null && (
                      <div className="mt-1 text-xs text-stone-500">
                        {formatInTimeZone(
                          new Date(item.publishedAt),
                          "Europe/London",
                          "d MMM yyyy, HH:mm",
                        )}{" "}
                        UK time
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-stone-600">
                    {formatDateTime(item.updatedAt)}
                    {item.updatedByName ? ` · ${item.updatedByName}` : ""}
                  </TableCell>
                  <TableCell>
                    {state === "live" && itemLiveUrl && (
                      <a
                        href={itemLiveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open live page for ${item.title}`}
                        title="Open live page"
                        className="inline-flex text-stone-500 hover:text-stone-900"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <IoOpenOutline className="size-4" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setParams({ page: page <= 2 ? null : String(page - 1) });
            }}
          >
            Previous
          </Button>
          <span className="text-sm text-stone-600">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setParams({ page: String(page + 1) });
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
