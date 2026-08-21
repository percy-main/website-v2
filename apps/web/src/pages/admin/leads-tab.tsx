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
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import { campaigns } from "@percy-main/shared/marketing";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useReducer, useRef, useState } from "react";
import {
  initialLeadsFilterState,
  leadsFilterReducer,
} from "./leads-tab.reducer";
import { formatDate } from "./status-pill";

const PAGE_SIZE = 25;

type Outcome = "contacted" | "attended" | "joined" | "lost";
const OUTCOMES: Outcome[] = ["contacted", "attended", "joined", "lost"];
const OFFLINE_OUTCOMES = new Set<Outcome>(["attended", "joined"]);

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

// eslint-disable-next-line react-doctor/no-giant-component -- admin leads tab: filter bar + table + per-row status mutations and detail dialog share the filters reducer and a single query.
export function LeadsTab() {
  const [filters, dispatch] = useReducer(
    leadsFilterReducer,
    initialLeadsFilterState,
  );
  const { page, search, debouncedSearch, campaignId, segment, status, source } =
    filters;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberLinkLeadId, setMemberLinkLeadId] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const authedKey = useAuthedQueryKey();

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      dispatch({ type: "commitSearch", value: search });
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [search]);

  const campaignSegments = campaignId
    ? (campaigns[campaignId as keyof typeof campaigns]?.segments ?? [])
    : [];

  const { data, isLoading, isError } = useAuthedQuery({
    queryKey: [
      "admin",
      "leads",
      page,
      debouncedSearch,
      campaignId,
      segment,
      status,
      source,
    ] as const,
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

  const outcomeMutation = useMutation({
    mutationFn: async (vars: {
      leadId: string;
      outcome: Outcome;
      memberId?: string;
    }) =>
      callApi(
        api.POST("/api/admin/leads/{leadId}/outcomes", {
          params: { path: { leadId: vars.leadId } },
          body: {
            outcome: vars.outcome,
            ...(vars.memberId ? { memberId: vars.memberId } : {}),
          },
        }),
      ),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: authedKey(["admin", "leads"]),
      });
      void queryClient.invalidateQueries({
        queryKey: authedKey(["admin", "lead-events", vars.leadId]),
      });
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) =>
            dispatch({ type: "setSearch", value: e.target.value })
          }
          className="max-w-sm"
        />
        <select
          className="border-border rounded border px-2 py-1 text-sm"
          value={campaignId}
          onChange={(e) =>
            dispatch({ type: "setCampaignId", value: e.target.value })
          }
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
          onChange={(e) =>
            dispatch({ type: "setSegment", value: e.target.value })
          }
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
          onChange={(e) =>
            dispatch({ type: "setStatus", value: e.target.value })
          }
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
          onChange={(e) =>
            dispatch({ type: "setSource", value: e.target.value })
          }
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-stone-500">Loading…</p>}
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
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-6 text-center text-stone-500"
                  >
                    No leads found.
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((lead) => {
                const isExpanded = expandedId === lead.id;
                const cutoffPassed = lead.adsCutoffAt
                  ? new Date(lead.adsCutoffAt) < new Date()
                  : false;
                return (
                  <Fragment key={lead.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    >
                      <TableCell className="font-medium">
                        {lead.email}
                      </TableCell>
                      <TableCell>{lead.name ?? "-"}</TableCell>
                      <TableCell>{lead.source}</TableCell>
                      <TableCell>{lead.firstCampaignId ?? "-"}</TableCell>
                      <TableCell>{lead.firstSegment ?? "-"}</TableCell>
                      <TableCell>{lead.status}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{formatDate(lead.createdAt, true)}</span>
                          {lead.adsCutoffAt && (
                            <span
                              className={
                                cutoffPassed
                                  ? "text-xs text-stone-500"
                                  : "text-xs text-stone-400"
                              }
                              title={
                                cutoffPassed
                                  ? "The Google Ads attribution window for this lead has expired. Outcome events are still recorded in our DB but won't be uploaded to Ads."
                                  : "Latest date this lead's offline outcomes can still reach Google Ads."
                              }
                            >
                              {cutoffPassed
                                ? "Ads window: closed"
                                : "Ads window:"}{" "}
                              {formatDate(lead.adsCutoffAt, false)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="flex flex-wrap gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {OUTCOMES.map((outcome) => {
                          const isOffline = OFFLINE_OUTCOMES.has(outcome);
                          const dbOnly = isOffline && cutoffPassed;
                          return (
                            <Button
                              key={outcome}
                              variant="outline"
                              size="sm"
                              disabled={outcomeMutation.isPending}
                              title={
                                dbOnly
                                  ? "Past Ads attribution window — recorded in DB only"
                                  : undefined
                              }
                              onClick={() => {
                                if (outcome === "joined") {
                                  setMemberLinkLeadId(lead.id);
                                  return;
                                }
                                outcomeMutation.mutate({
                                  leadId: lead.id,
                                  outcome,
                                });
                              }}
                            >
                              {outcome}
                              {dbOnly ? " (DB only)" : ""}
                            </Button>
                          );
                        })}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30">
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
            <span className="text-stone-500">
              {data.total} lead{data.total !== 1 ? "s" : ""} total
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  dispatch({ type: "setPage", value: Math.max(1, page - 1) })
                }
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
                onClick={() =>
                  dispatch({
                    type: "setPage",
                    value: Math.min(totalPages, page + 1),
                  })
                }
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {memberLinkLeadId && (
        <JoinedModal
          leadId={memberLinkLeadId}
          onClose={() => setMemberLinkLeadId(null)}
          onSubmit={(memberId) => {
            outcomeMutation.mutate({
              leadId: memberLinkLeadId,
              outcome: "joined",
              memberId: memberId || undefined,
            });
            setMemberLinkLeadId(null);
          }}
        />
      )}
    </div>
  );
}

function LeadEventTimeline({ leadId }: { leadId: string }) {
  const { data, isLoading } = useAuthedQuery({
    queryKey: ["admin", "lead-events", leadId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/marketing-events", {
          params: { query: { leadId } },
        }),
      ),
  });

  if (isLoading)
    return <p className="py-2 text-sm text-stone-500">Loading events…</p>;
  if (!data?.items.length)
    return <p className="py-2 text-sm text-stone-500">No events yet.</p>;

  return (
    <ol className="flex flex-col gap-1 py-2 text-sm">
      {data.items.map((evt) => (
        <li key={evt.id} className="flex items-center gap-3">
          <span className="font-mono text-xs text-stone-500">
            {formatDate(evt.createdAt, true)}
          </span>
          <span className="font-medium">{evt.type}</span>
          {evt.campaignId && (
            <span className="text-stone-600">
              {evt.campaignId}
              {evt.segment ? ` / ${evt.segment}` : ""}
            </span>
          )}
          {evt.adsConversionAction && (
            <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-900">
              ads queued
            </span>
          )}
          <span className="text-stone-500">via {evt.source}</span>
        </li>
      ))}
    </ol>
  );
}

function JoinedModal({
  leadId,
  onClose,
  onSubmit,
}: {
  leadId: string;
  onClose: () => void;
  onSubmit: (memberId: string) => void;
}) {
  const [memberId, setMemberId] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-md bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">
          Mark lead {leadId.slice(0, 8)}… as joined
        </h3>
        <p className="text-sm text-stone-600">
          Optionally link an existing member record by id. Leave blank to record
          the outcome without a link.
        </p>
        <Input
          type="text"
          placeholder="member id (optional)"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(memberId.trim())}>Mark joined</Button>
        </div>
      </div>
    </div>
  );
}
