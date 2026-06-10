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
import { api, callApi } from "@/lib/api-client";
import type { ContentKind } from "@percy-main/shared/content";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router";

// The editor pulls in BlockNote (the single heaviest dependency in the
// admin panel), so it loads as its own chunk only when an item is open.
const ContentEditor = lazy(() => import("./content-editor.js"));

const STATUS_BADGES: Record<string, "default" | "secondary" | "outline"> = {
  published: "default",
  draft: "secondary",
  archived: "outline",
};

const PAGE_SIZE = 20;

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

  const openItem = searchParams.get("item");
  const status = searchParams.get("status") ?? "all";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "content", kind, status, search, page],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/content", {
          params: {
            query: {
              kind,
              ...(status !== "all"
                ? { status: status as "draft" | "published" | "archived" }
                : {}),
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
            setParams({ item: null });
          }}
          onCreated={(id) => {
            setParams({ item: id });
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
              setParams({ q: e.target.value, page: null });
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
        <Button
          onClick={() => {
            setParams({ item: "new" });
          }}
        >
          New report
        </Button>
      </div>

      {isLoading ? (
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
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-56">Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                className="cursor-pointer"
                onClick={() => {
                  setParams({ item: item.id });
                }}
              >
                <TableCell className="font-medium">{item.title}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGES[item.status] ?? "secondary"}>
                    {item.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-stone-600">
                  {formatDateTime(item.updatedAt)}
                  {item.updatedByName ? ` · ${item.updatedByName}` : ""}
                </TableCell>
              </TableRow>
            ))}
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
