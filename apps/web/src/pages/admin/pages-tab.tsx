import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHasPermission } from "@/hooks/use-has-permission";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { lazy, Suspense } from "react";
import {
  IoAddOutline,
  IoArrowDownOutline,
  IoArrowUpOutline,
  IoChevronDownOutline,
  IoChevronForwardOutline,
  IoEllipsisVertical,
  IoOpenOutline,
} from "react-icons/io5";
import { useSearchParams } from "react-router";
import { displayState, STATE_BADGES, UUID_RE } from "./content-state.js";
import {
  buildPageTree,
  reorderUpdates,
  visibleNodes,
  type MenuOrderUpdate,
  type PageTreeItem,
  type PageTreeNode,
} from "./pages-tab.lib.js";

// Same lazy split as content-tab: BlockNote only loads when an item opens.
const ContentEditor = lazy(() => import("./content-editor.js"));

const LOCKED_HINT = "Locked after publish - path and ordering are fixed";

/** Sibling groups in display order, keyed by member id, for reordering. */
function siblingGroups(roots: PageTreeNode[]): Map<string, PageTreeItem[]> {
  const groups = new Map<string, PageTreeItem[]>();
  const record = (nodes: PageTreeNode[]) => {
    const items = nodes.map((n) => n.item);
    for (const node of nodes) {
      groups.set(node.item.id, items);
      record(node.children);
    }
  };
  record(roots);
  return groups;
}

/**
 * Page tree for the admin Content section. All UI state (open item,
 * preset parent for a new child, expanded nodes) lives in the URL
 * alongside the panel's section/sub params, so deep links restore the
 * full view.
 */
export function PagesTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { allowed: canManage } = useHasPermission("content", "manage");

  const itemParam = searchParams.get("item");
  const openItem =
    itemParam === "new" || (itemParam !== null && UUID_RE.test(itemParam))
      ? itemParam
      : null;
  const parentParam = searchParams.get("parent");
  const newParentId =
    parentParam !== null && UUID_RE.test(parentParam) ? parentParam : null;
  const expanded = new Set(
    (searchParams.get("expanded") ?? "").split(",").filter(Boolean),
  );

  /**
   * Navigation-like changes (open item, new child) push a history entry;
   * expand/collapse replaces - like search refinement, expanding nodes
   * must not spam history with one entry per chevron click.
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
    // Rooted under ["admin", "content"] so the editor's existing save/
    // publish invalidations cover the tree without knowing about it.
    queryKey: ["admin", "content", "page-tree"],
    queryFn: () => callApi(api.GET("/api/admin/content/page-tree")),
    enabled: openItem === null,
  });

  const reorderMutation = useMutation({
    mutationFn: async (updates: MenuOrderUpdate[]) => {
      // menuOrder lives inside the kind metadata and updates replace the
      // whole metadata object, so merge over each page's current detail
      // (the tree payload deliberately omits hideTitle/ldjson). Each
      // page's read-then-write pair touches only its own row, so the
      // batch runs in parallel.
      await Promise.all(
        updates.map(async (update) => {
          const detail = await callApi(
            api.GET("/api/admin/content/{contentId}", {
              params: { path: { contentId: update.id } },
            }),
          );
          await callApi(
            api.PUT("/api/admin/content/{contentId}", {
              params: { path: { contentId: update.id } },
              body: {
                metadata: { ...detail.metadata, menuOrder: update.menuOrder },
              },
            }),
          );
        }),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
      // menuOrder drives the public nav ordering; drop ["content", ...]
      // (which includes ["content", "nav"]) so the live menu reorders too.
      void queryClient.invalidateQueries({ queryKey: ["content"] });
    },
  });

  if (openItem !== null) {
    return (
      <Suspense
        fallback={
          <p className="py-8 text-sm text-stone-500">Loading editor…</p>
        }
      >
        <ContentEditor
          kind="page"
          contentId={openItem === "new" ? null : openItem}
          newParentId={newParentId}
          onClose={() => {
            setParams(
              { item: null, parent: null },
              { replace: openItem === "new" },
            );
          }}
          onCreated={(id) => {
            // Swap "new" for the created id (and drop the parent preset):
            // back must not return to the create form and spawn a duplicate.
            setParams({ item: id, parent: null }, { replace: true });
          }}
        />
      </Suspense>
    );
  }

  const roots = buildPageTree(data?.items ?? []);
  const rows = visibleNodes(roots, expanded);
  const groups = siblingGroups(roots);

  const toggleExpanded = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParams(
      { expanded: Array.from(next).join(",") || null },
      { replace: true },
    );
  };

  const move = (item: PageTreeItem, direction: "up" | "down") => {
    const updates = reorderUpdates(
      groups.get(item.id) ?? [],
      item.id,
      direction,
    );
    if (updates.length > 0) reorderMutation.mutate(updates);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-stone-500">
          Pages nest into sections. A section's landing page is the parent
          page's own content - edit the parent to change what visitors see at
          its address.
        </p>
        {canManage && (
          <Button
            onClick={() => {
              setParams({ item: "new" });
            }}
          >
            New page
          </Button>
        )}
      </div>

      {reorderMutation.error && (
        <p className="text-sm text-red-600">
          Couldn't reorder - {reorderMutation.error.message}
        </p>
      )}

      {error ? (
        <p className="py-8 text-sm text-red-600">
          Couldn't load pages - {error.message}
        </p>
      ) : isLoading ? (
        <p className="py-8 text-sm text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-sm text-stone-500">
          No pages yet - create the first one. Pages added as children of an
          existing page form a section, and the parent page itself is the
          section's landing page.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200">
          {rows.map((node) => (
            <PageRow
              key={node.item.id}
              node={node}
              expanded={expanded.has(node.item.id)}
              canManage={canManage}
              reordering={reorderMutation.isPending}
              siblings={groups.get(node.item.id) ?? []}
              onToggle={() => {
                toggleExpanded(node.item.id);
              }}
              onOpen={() => {
                setParams({ item: node.item.id });
              }}
              onNewChild={() => {
                // Expand the parent too, so the new child is visible on
                // return to the tree.
                const nextExpanded = new Set(expanded);
                nextExpanded.add(node.item.id);
                setParams({
                  item: "new",
                  parent: node.item.id,
                  expanded: Array.from(nextExpanded).join(","),
                });
              }}
              onMove={(direction) => {
                move(node.item, direction);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PageRow({
  node,
  expanded,
  canManage,
  reordering,
  siblings,
  onToggle,
  onOpen,
  onNewChild,
  onMove,
}: {
  node: PageTreeNode;
  expanded: boolean;
  canManage: boolean;
  reordering: boolean;
  siblings: PageTreeItem[];
  onToggle: () => void;
  onOpen: () => void;
  onNewChild: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const { item, depth, children } = node;
  const state = displayState(item);
  const index = siblings.findIndex((s) => s.id === item.id);

  // The backend deliberately still accepts menuOrder changes for
  // ever-published pages (menuOrder is presentation, not part of the
  // locked URL), so this reorder restriction is UI-only per the issue
  // spec and trivially reversible if editors need it.
  const reorderHint = item.pathLocked
    ? LOCKED_HINT
    : reordering
      ? "Reordering…"
      : null;
  const canMoveUp = reorderHint === null && index > 0;
  const canMoveDown = reorderHint === null && index < siblings.length - 1;

  return (
    <li
      className="flex items-center gap-2 py-2 pr-2"
      style={{ paddingLeft: `${String(depth * 1.25 + 0.5)}rem` }}
    >
      {children.length > 0 ? (
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
          aria-expanded={expanded}
          className="flex size-6 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-900"
          onClick={onToggle}
        >
          {expanded ? (
            <IoChevronDownOutline className="size-4" />
          ) : (
            <IoChevronForwardOutline className="size-4" />
          )}
        </button>
      ) : (
        <span aria-hidden className="size-6 shrink-0" />
      )}

      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
        onClick={onOpen}
      >
        <span className="truncate font-medium">
          {item.title}
          {children.length > 0 && (
            <span className="ml-1 text-xs font-normal text-stone-400">
              ({children.length})
            </span>
          )}
        </span>
        <span className="truncate text-xs text-stone-500">{item.path}</span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <Badge variant={STATE_BADGES[state].variant}>
          {STATE_BADGES[state].label}
        </Badge>
        {state === "scheduled" && item.publishedAt !== null && (
          <span className="text-xs text-stone-500">
            {formatInTimeZone(
              new Date(item.publishedAt),
              "Europe/London",
              "d MMM yyyy, HH:mm",
            )}{" "}
            UK time
          </span>
        )}
      </div>

      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${item.title}`}
              className="shrink-0 px-2"
            >
              <IoEllipsisVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onNewChild}>
              <IoAddOutline className="size-4" />
              New child page
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canMoveUp}
              onSelect={() => {
                onMove("up");
              }}
            >
              <IoArrowUpOutline className="size-4" />
              <span>
                Move up
                {reorderHint !== null && (
                  <span className="block text-xs text-stone-500">
                    {reorderHint}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canMoveDown}
              onSelect={() => {
                onMove("down");
              }}
            >
              <IoArrowDownOutline className="size-4" />
              <span>
                Move down
                {reorderHint !== null && (
                  <span className="block text-xs text-stone-500">
                    {reorderHint}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
            {state === "live" && (
              <DropdownMenuItem asChild>
                <a href={item.path} target="_blank" rel="noopener noreferrer">
                  <IoOpenOutline className="size-4" />
                  View live page
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
