import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { campaigns } from "@percy-main/shared/marketing";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { formatDate } from "./status-pill";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "attended", label: "Attended" },
  { value: "joined", label: "Joined" },
  { value: "lost", label: "Lost" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "marketing_lead_form", label: "Marketing lead form" },
  { value: "contact_form", label: "Contact form" },
];

export function LeadsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [campaignId, setCampaignId] = useState<string>("");
  const [segment, setSegment] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [search]);

  const campaignSegments = campaignId
    ? (campaigns[campaignId as keyof typeof campaigns]?.segments ?? [])
    : [];

  const queryKey = [
    "admin",
    "leads",
    page,
    debouncedSearch,
    campaignId,
    segment,
    status,
    source,
  ] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      callApi(
        api.GET("/api/admin/leads", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
              ...(campaignId ? { campaignId } : {}),
              ...(segment ? { segment } : {}),
              ...(status ? { status } : {}),
              ...(source ? { source } : {}),
            },
          },
        }),
      ),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          className="border-border rounded border px-2 py-1 text-sm"
          value={campaignId}
          onChange={(e) => {
            setCampaignId(e.target.value);
            setSegment("");
            setPage(1);
          }}
        >
          <option value="">All campaigns</option>
          {Object.entries(campaigns).map(([id, c]) => (
            <option key={id} value={id}>
              {c.displayName}
            </option>
          ))}
        </select>
        <select
          className="border-border rounded border px-2 py-1 text-sm"
          value={segment}
          onChange={(e) => {
            setSegment(e.target.value);
            setPage(1);
          }}
          disabled={!campaignId}
        >
          <option value="">All segments</option>
          {campaignSegments.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
        <select
          className="border-border rounded border px-2 py-1 text-sm"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(1);
          }}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-gray-500">Loading…</p>}
      {isError && <p className="text-red-600">Failed to load leads.</p>}

      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-6 text-center text-gray-500"
                  >
                    No leads found.
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((lead) => {
                const isExpanded = expandedId === lead.id;
                return (
                  <Fragment key={lead.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    >
                      <TableCell className="font-medium">
                        {lead.email}
                      </TableCell>
                      <TableCell>{lead.name ?? "—"}</TableCell>
                      <TableCell>{lead.source}</TableCell>
                      <TableCell>{lead.firstCampaignId ?? "—"}</TableCell>
                      <TableCell>{lead.firstSegment ?? "—"}</TableCell>
                      <TableCell>{lead.status}</TableCell>
                      <TableCell>{formatDate(lead.createdAt, true)}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <LeadEventTimeline leadId={lead.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              {data.total} lead{data.total !== 1 ? "s" : ""} total
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-gray-600">
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

function LeadEventTimeline({ leadId }: { leadId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "lead-events", leadId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/marketing-events", {
          params: { query: { leadId } },
        }),
      ),
  });

  if (isLoading)
    return <p className="py-2 text-sm text-gray-500">Loading events…</p>;
  if (!data?.items.length)
    return <p className="py-2 text-sm text-gray-500">No events yet.</p>;

  return (
    <ol className="flex flex-col gap-1 py-2 text-sm">
      {data.items.map((evt) => (
        <li key={evt.id} className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-500">
            {formatDate(evt.createdAt, true)}
          </span>
          <span className="font-medium">{evt.type}</span>
          {evt.campaignId && (
            <span className="text-gray-600">
              {evt.campaignId}
              {evt.segment ? ` / ${evt.segment}` : ""}
            </span>
          )}
          {evt.adsConversionAction && (
            <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-900">
              ads queued
            </span>
          )}
          <span className="text-gray-500">via {evt.source}</span>
        </li>
      ))}
    </ol>
  );
}
