import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducer, useState } from "react";
import { formatDate } from "./status-pill";

const PAGE_SIZE = 20;

type Status = "new" | "in_review" | "done";
type Severity = "low" | "medium" | "high";
type StatusFilter = "all" | Status;
type IncidentType =
  | "injury"
  | "near_miss"
  | "dangerous_occurrence"
  | "ill_health"
  | "property_damage";
type InjurySeverity = "minor" | "serious" | "fatal";
type RiddorState = "unset" | "yes" | "no";

const REPORTER_RELATIONSHIP_LABELS: Record<string, string> = {
  member: "Member",
  parent_or_guardian: "Parent / guardian",
  player: "Player",
  coach_or_volunteer: "Coach / volunteer",
  visitor: "Visitor",
  other: "Other",
};

const AFFECTED_RELATIONSHIP_LABELS: Record<string, string> = {
  trustee: "Trustee",
  member: "Member",
  volunteer: "Volunteer",
  visitor: "Visitor",
  contractor: "Contractor",
  other: "Other",
};

const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  injury: "Injury",
  near_miss: "Near miss",
  dangerous_occurrence: "Dangerous occurrence",
  ill_health: "Ill health",
  property_damage: "Property damage",
};

function StatusBadge({ status }: { status: Status }) {
  if (status === "new") return <Badge variant="warning">New</Badge>;
  if (status === "in_review") return <Badge variant="info">In review</Badge>;
  return <Badge variant="success">Done</Badge>;
}

function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) return <Badge variant="outline">Unset</Badge>;
  if (severity === "high") return <Badge variant="destructive">High</Badge>;
  if (severity === "medium") return <Badge variant="warning">Medium</Badge>;
  return <Badge variant="secondary">Low</Badge>;
}

function InjurySeverityBadge({
  severity,
}: {
  severity: InjurySeverity | null;
}) {
  if (!severity) return <>-</>;
  if (severity === "fatal") return <Badge variant="destructive">Fatal</Badge>;
  if (severity === "serious")
    return <Badge variant="destructive">Serious</Badge>;
  return <Badge variant="secondary">Minor</Badge>;
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function IncidentsTab() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "incidentReports", page, PAGE_SIZE, statusFilter],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/incident-reports", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(statusFilter !== "all" ? { status: statusFilter } : {}),
            },
          },
        }),
      ),
  });

  const totalPages = query.data
    ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE))
    : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="incident-status-filter" className="text-sm">
          Status
        </Label>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger id="incident-status-filter" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="in_review">In review</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isLoading && <p className="text-stone-500">Loading…</p>}
      {query.isError && (
        <p className="text-red-600">Failed to load incident reports.</p>
      )}

      {query.data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reported</TableHead>
                <TableHead>Occurred</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Reporter</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.reports.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-6 text-center text-stone-500"
                  >
                    No incident reports found.
                  </TableCell>
                </TableRow>
              )}
              {query.data.reports.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setOpenId(r.id)}
                >
                  <TableCell>{formatDate(r.createdAt, true)}</TableCell>
                  <TableCell>{formatDate(r.occurredAt, true)}</TableCell>
                  <TableCell>{INCIDENT_TYPE_LABELS[r.incidentType]}</TableCell>
                  <TableCell>{r.location}</TableCell>
                  <TableCell>{r.reporterName}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.affectedIsMinor && (
                        <Badge variant="destructive">U18</Badge>
                      )}
                      {r.injuryOccurred && (
                        <Badge variant="warning">Injury</Badge>
                      )}
                      {r.injurySeverity === "fatal" && (
                        <Badge variant="destructive">Fatal</Badge>
                      )}
                      {r.injurySeverity === "serious" && (
                        <Badge variant="destructive">Serious</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={r.severity} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <span className="text-stone-500">
              {query.data.total} report{query.data.total !== 1 ? "s" : ""} total
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

      <IncidentDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function IncidentDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const open = id !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incident report</DialogTitle>
        </DialogHeader>
        {id !== null && (
          <IncidentDetailBody key={id} id={id} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type IncidentDetail = NonNullable<
  Awaited<ReturnType<typeof loadIncidentDetail>>
>;

async function loadIncidentDetail(id: string) {
  return await callApi(
    api.GET("/api/admin/incident-reports/{id}", {
      params: { path: { id } },
    }),
  );
}

function IncidentDetailBody({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["admin", "incidentReport", id],
    queryFn: () => loadIncidentDetail(id),
  });

  if (detail.isLoading) return <p className="text-stone-500">Loading…</p>;
  if (detail.isError || !detail.data)
    return <p className="text-red-600">Failed to load report.</p>;

  return (
    <IncidentEditForm
      key={id}
      id={id}
      initial={detail.data}
      onClose={onClose}
    />
  );
}

// eslint-disable-next-line react-doctor/no-giant-component -- incident review form: 12 fields all submit together as a PATCH with one validation/mutation lifecycle; splitting fragments a single H&S record's edit semantics.
function IncidentEditForm({
  id,
  initial,
  onClose,
}: {
  id: string;
  initial: IncidentDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  // All state seeded from `initial` on mount. The parent passes
  // `key={id}` so opening a different incident remounts this form
  // with fresh state — no need to sync state to props on update.
  interface IncidentFormState {
    status: Status;
    severity: Severity | "unset";
    internalNotes: string;
    actionsTaken: string;
    targetCompletionDate: string;
    riddorRequired: RiddorState;
    riddorReportedAt: string;
    closureReason: string;
    closedAt: string;
    safeguardingDiscussed: boolean;
    safeguardingDiscussedAt: string;
    safeguardingNotes: string;
  }
  const [form, update] = useReducer(
    (s: IncidentFormState, p: Partial<IncidentFormState>) => ({ ...s, ...p }),
    {
      status: initial.status,
      severity: initial.severity ?? "unset",
      internalNotes: initial.internalNotes ?? "",
      actionsTaken: initial.actionsTaken ?? "",
      targetCompletionDate: toDateInput(initial.targetCompletionDate),
      riddorRequired:
        initial.riddorRequired === true
          ? "yes"
          : initial.riddorRequired === false
            ? "no"
            : "unset",
      riddorReportedAt: toDateInput(initial.riddorReportedAt),
      closureReason: initial.closureReason ?? "",
      closedAt: toDateTimeLocal(initial.closedAt),
      safeguardingDiscussed: initial.safeguardingDiscussed,
      safeguardingDiscussedAt: toDateTimeLocal(initial.safeguardingDiscussedAt),
      safeguardingNotes: initial.safeguardingNotes ?? "",
    },
  );
  const {
    status,
    severity,
    internalNotes,
    actionsTaken,
    targetCompletionDate,
    riddorRequired,
    riddorReportedAt,
    closureReason,
    closedAt,
    safeguardingDiscussed,
    safeguardingDiscussedAt,
    safeguardingNotes,
  } = form;

  const save = useMutation({
    mutationFn: () =>
      callApi(
        api.PATCH("/api/admin/incident-reports/{id}", {
          params: { path: { id } },
          body: {
            status,
            severity: severity === "unset" ? null : severity,
            actionsTaken: actionsTaken.trim() || null,
            targetCompletionDate: fromDateInput(targetCompletionDate),
            riddorRequired:
              riddorRequired === "unset" ? null : riddorRequired === "yes",
            riddorReportedAt: fromDateInput(riddorReportedAt),
            internalNotes: internalNotes.trim() || null,
            closureReason: closureReason.trim() || null,
            closedAt: fromDateTimeLocal(closedAt),
            safeguardingDiscussed,
            safeguardingDiscussedAt: fromDateTimeLocal(safeguardingDiscussedAt),
            safeguardingNotes: safeguardingNotes.trim() || null,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "incidentReports"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "incidentReport", id],
      });
      onClose();
    },
  });

  return (
    <>
      <div className="flex flex-col gap-6">
        <section className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <ReadField label="Reported at">
            {formatDate(initial.createdAt, true)}
          </ReadField>
          <ReadField label="Occurred">
            {formatDate(initial.occurredAt, true)}
          </ReadField>
          <ReadField label="Location">{initial.location}</ReadField>
          <ReadField label="Activity">{initial.activity ?? "-"}</ReadField>
          <ReadField label="Type">
            {INCIDENT_TYPE_LABELS[initial.incidentType]}
          </ReadField>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Reporter</h3>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <ReadField label="Name">{initial.reporterName}</ReadField>
            <ReadField label="Relationship">
              {REPORTER_RELATIONSHIP_LABELS[initial.reporterRelationship] ??
                initial.reporterRelationship}
            </ReadField>
            <ReadField label="Email">
              <a
                className="text-blue-700 underline"
                href={`mailto:${initial.reporterEmail}`}
              >
                {initial.reporterEmail}
              </a>
            </ReadField>
            <ReadField label="Phone">
              {initial.reporterPhone ? (
                <a
                  className="text-blue-700 underline"
                  href={`tel:${initial.reporterPhone}`}
                >
                  {initial.reporterPhone}
                </a>
              ) : (
                "-"
              )}
            </ReadField>
          </div>
          {initial.prefersNoContact && (
            <p className="mt-2 text-sm font-medium text-amber-700">
              ⚠ Reporter prefers not to be contacted about this report.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Injured / affected person
          </h3>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <ReadField label="Name">{initial.affectedName ?? "-"}</ReadField>
            <ReadField label="Role / relationship">
              {initial.affectedRelationship
                ? (AFFECTED_RELATIONSHIP_LABELS[initial.affectedRelationship] ??
                  initial.affectedRelationship)
                : "-"}
            </ReadField>
            <ReadField label="Contact">
              {initial.affectedContact ?? "-"}
            </ReadField>
            <ReadField label="Under 18">
              {initial.affectedIsMinor ? "Yes" : "No"}
            </ReadField>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">What happened</h3>
          <p className="mt-1 text-sm whitespace-pre-wrap">
            {initial.description}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Injury / ill health</h3>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <ReadField label="Injury / ill health occurred">
              {initial.injuryOccurred ? "Yes" : "No"}
            </ReadField>
            <ReadField label="Severity">
              <InjurySeverityBadge severity={initial.injurySeverity} />
            </ReadField>
            <ReadField label="Nature">
              {initial.natureOfInjury ?? "-"}
            </ReadField>
            <ReadField label="Body parts affected">
              {initial.bodyPartsAffected ?? "-"}
            </ReadField>
            <ReadField label="First aid given">
              {initial.firstAidGiven ? "Yes" : "No"}
            </ReadField>
            <ReadField label="First aider">
              {initial.firstAiderName ?? "-"}
            </ReadField>
            <ReadField label="First aid details">
              {initial.firstAidDetails ?? "-"}
            </ReadField>
            <ReadField label="Medical treatment required">
              {initial.medicalTreatmentRequired ? "Yes" : "No"}
            </ReadField>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Actions at the time &amp; witnesses
          </h3>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <ReadField label="Immediate actions">
              {initial.immediateActions ?? "-"}
            </ReadField>
            <ReadField label="Witnesses">{initial.witnesses ?? "-"}</ReadField>
          </div>
        </section>

        <section className="border-border bg-muted/30 rounded border p-3 text-xs text-stone-600">
          <strong>Declaration:</strong>{" "}
          {initial.declarationConfirmed
            ? "Reporter confirmed the information is true and accurate to the best of their knowledge and belief."
            : "Not confirmed."}
        </section>

        <hr />

        <section>
          <h3 className="mb-3 text-sm font-semibold">Admin review</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className="mb-1 block">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => update({ status: v as Status })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="in_review">In review</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) =>
                  update({ severity: v as Severity | "unset" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Unset</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1 block">Actions taken</Label>
              <Textarea
                rows={3}
                value={actionsTaken}
                onChange={(e) => update({ actionsTaken: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1 block">Target completion date</Label>
              <input
                type="date"
                className="border-border bg-surface text-dark w-full rounded-md border px-3 py-2 text-sm"
                value={targetCompletionDate}
                onChange={(e) =>
                  update({ targetCompletionDate: e.target.value })
                }
              />
            </div>
            <div>
              <Label className="mb-1 block">RIDDOR reporting required?</Label>
              <Select
                value={riddorRequired}
                onValueChange={(v) =>
                  update({ riddorRequired: v as RiddorState })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not decided</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {riddorRequired === "yes" && (
              <div className="md:col-span-2">
                <Label className="mb-1 block">Date reported to HSE</Label>
                <input
                  type="date"
                  className="border-border bg-surface text-dark w-full rounded-md border px-3 py-2 text-sm"
                  value={riddorReportedAt}
                  onChange={(e) => update({ riddorReportedAt: e.target.value })}
                />
              </div>
            )}
            <div className="md:col-span-2">
              <Label className="mb-1 block">Internal notes</Label>
              <Textarea
                rows={3}
                value={internalNotes}
                onChange={(e) => update({ internalNotes: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1 block">Date closed</Label>
              <input
                type="datetime-local"
                className="border-border bg-surface text-dark w-full rounded-md border px-3 py-2 text-sm"
                value={closedAt}
                onChange={(e) => update({ closedAt: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1 block">Closure reason</Label>
              <input
                type="text"
                className="border-border bg-surface text-dark w-full rounded-md border px-3 py-2 text-sm"
                value={closureReason}
                onChange={(e) => update({ closureReason: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <Checkbox
                id="safeguarding-discussed"
                checked={safeguardingDiscussed}
                onCheckedChange={(v) =>
                  update({ safeguardingDiscussed: v === true })
                }
              />
              <Label htmlFor="safeguarding-discussed">
                Discussed with club safeguarding officer
              </Label>
            </div>
            {safeguardingDiscussed && (
              <>
                <div>
                  <Label className="mb-1 block">Discussion date</Label>
                  <input
                    type="datetime-local"
                    className="border-border bg-surface text-dark w-full rounded-md border px-3 py-2 text-sm"
                    value={safeguardingDiscussedAt}
                    onChange={(e) =>
                      update({ safeguardingDiscussedAt: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="mb-1 block">Discussion note</Label>
                  <input
                    type="text"
                    className="border-border bg-surface text-dark w-full rounded-md border px-3 py-2 text-sm"
                    value={safeguardingNotes}
                    onChange={(e) =>
                      update({ safeguardingNotes: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReadField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
