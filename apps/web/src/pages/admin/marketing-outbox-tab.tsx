import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatDate } from "./status-pill";

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "dead", label: "Dead" },
];

export function MarketingOutboxTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const queryClient = useQueryClient();
  const authedKey = useAuthedQueryKey();

  const { data, isLoading } = useAuthedQuery({
    queryKey: ["admin", "marketing-outbox", page, status] as const,
    queryFn: () =>
      callApi(
        api.GET("/api/admin/marketing-outbox", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(status ? { status } : {}),
            },
          },
        }),
      ),
  });

  const retryMutation = useMutation({
    mutationFn: async (outboxId: string) =>
      callApi(
        api.POST("/api/admin/marketing-outbox/{outboxId}/retry", {
          params: { path: { outboxId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: authedKey(["admin", "marketing-outbox"]),
      });
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-sm text-stone-600">
        <p>
          Marketing outbox: pending and historical Google Ads conversion
          uploads.
        </p>
        <select
          className="border-border rounded border px-2 py-1 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-stone-500">Loading…</p>}

      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Next attempt</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-6 text-center text-stone-500"
                  >
                    No outbox rows.
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    {formatDate(row.createdAt, true)}
                  </TableCell>
                  <TableCell>
                    {row.eventType ?? row.eventId.slice(0, 8)}
                  </TableCell>
                  <TableCell>{row.campaignId ?? "-"}</TableCell>
                  <TableCell>{row.segment ?? "-"}</TableCell>
                  <TableCell>{row.destination}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{row.attempts}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDate(row.nextAttemptAt, true)}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs text-red-700">
                    {row.lastError ?? ""}
                  </TableCell>
                  <TableCell>
                    {row.status === "dead" || row.status === "failed" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(row.id)}
                      >
                        Retry
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <span className="text-stone-500">{data.total} rows total</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-stone-600">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
