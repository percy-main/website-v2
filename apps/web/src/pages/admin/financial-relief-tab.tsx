import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  CONTACT_PREFERENCE_LABELS,
  CONTRIBUTION_ABILITY_LABELS,
  DURATION_LABELS,
  REASON_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  VOLUNTEER_OPTION_LABELS,
  type RequestStatus,
} from "@percy-main/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useReducer, useState } from "react";
import { useSearchParams } from "react-router";
import {
  DEFAULT_FILTERS,
  STATUS_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  type StatusFilter,
} from "./financial-relief-tab.reducer";

export function FinancialReliefTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );

  const updateFilters = (
    next: Partial<typeof DEFAULT_FILTERS>,
    options: { resetPage?: boolean } = {},
  ) => {
    setSearchParams(
      filtersToSearchParams({
        ...filters,
        ...next,
        page: options.resetPage ? 1 : (next.page ?? filters.page),
      }),
      { replace: true },
    );
  };

  const listQuery = useQuery({
    queryKey: [
      "admin-relief",
      "list",
      filters.page,
      filters.pageSize,
      filters.status,
      filters.search,
    ],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/financial-relief/requests", {
          params: {
            query: {
              page: filters.page,
              pageSize: filters.pageSize,
              status: filters.status,
              search: filters.search || undefined,
            },
          },
        }),
      ),
  });

  const selectedRequestId = searchParams.get("requestId") ?? null;
  const openDetail = (id: string | null) => {
    const params = filtersToSearchParams(filters);
    if (id) params.set("requestId", id);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <ReliefReportPanel />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="reliefStatus">Status</Label>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              updateFilters({ status: v as StatusFilter }, { resetPage: true })
            }
          >
            <SelectTrigger id="reliefStatus" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All" : REQUEST_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="reliefSearch">Search</Label>
          <Input
            id="reliefSearch"
            placeholder="Member or submitter"
            value={filters.search}
            onChange={(e) =>
              updateFilters({ search: e.target.value }, { resetPage: true })
            }
            className="w-[260px]"
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitted</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Submitter</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Decided</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listQuery.isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-stone-600">
                Loading…
              </TableCell>
            </TableRow>
          ) : listQuery.data?.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-stone-600">
                No requests match these filters.
              </TableCell>
            </TableRow>
          ) : (
            listQuery.data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-sm">
                  {new Date(row.createdAt).toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{row.memberName ?? "—"}</span>
                    <span className="text-xs text-stone-600">
                      {row.memberEmail}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col text-sm">
                    <span>{row.submittedByName ?? "—"}</span>
                    {row.submittedByEmail !== row.memberEmail ? (
                      <span className="text-xs text-stone-600">
                        {row.submittedByEmail}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.requestedMembershipFull ? (
                      <Badge variant="secondary">
                        Membership donation (full)
                      </Badge>
                    ) : null}
                    {row.requestedMembershipPartial ? (
                      <Badge variant="secondary">
                        Membership donation (partial)
                      </Badge>
                    ) : null}
                    {row.requestedMatchFees ? (
                      <Badge variant="secondary">Match donations</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill status={row.status} />
                </TableCell>
                <TableCell className="text-sm">
                  {row.decidedAt ? (
                    <>
                      {new Date(row.decidedAt).toLocaleDateString("en-GB")}
                      {row.decidedByName ? (
                        <div className="text-xs text-stone-600">
                          {row.decidedByName}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDetail(row.id)}
                  >
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {listQuery.data && listQuery.data.total > filters.pageSize ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => updateFilters({ page: filters.page - 1 })}
          >
            Prev
          </Button>
          <span className="text-sm text-stone-600">
            Page {filters.page} of{" "}
            {Math.ceil(listQuery.data.total / filters.pageSize)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page * filters.pageSize >= listQuery.data.total}
            onClick={() => updateFilters({ page: filters.page + 1 })}
          >
            Next
          </Button>
        </div>
      ) : null}

      {selectedRequestId ? (
        <RequestDetailDialog
          requestId={selectedRequestId}
          onClose={() => openDetail(null)}
        />
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: RequestStatus }) {
  const map: Record<
    RequestStatus,
    "secondary" | "warning" | "success" | "info"
  > = {
    submitted: "warning",
    in_review: "info",
    more_info_needed: "warning",
    approved: "success",
    declined: "secondary",
    withdrawn: "secondary",
    expired: "secondary",
  };
  return <Badge variant={map[status]}>{REQUEST_STATUS_LABELS[status]}</Badge>;
}

function RequestDetailDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["admin-relief", "detail", requestId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/financial-relief/requests/{requestId}", {
          params: { path: { requestId } },
        }),
      ),
  });

  const transition = useMutation({
    mutationFn: (body: {
      toStatus: "in_review" | "more_info_needed";
      note?: string | null;
    }) =>
      callApi(
        api.POST("/api/admin/financial-relief/requests/{requestId}/status", {
          params: { path: { requestId } },
          body,
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-relief", "detail", requestId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-relief", "list"] }),
      ]),
  });

  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [decideDialogOpen, setDecideDialogOpen] = useState(false);
  const isOpen = detailQuery.data
    ? ["submitted", "in_review", "more_info_needed"].includes(
        detailQuery.data.request.status,
      )
    : false;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {detailQuery.isLoading ? (
          <p className="text-sm text-stone-600">Loading…</p>
        ) : !detailQuery.data ? (
          <p className="text-sm text-stone-600">Request not found.</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {detailQuery.data.request.memberName ?? "—"}
              </DialogTitle>
              <DialogDescription>
                Submitted by {detailQuery.data.request.submittedByName ?? "—"} (
                {detailQuery.data.request.submittedByEmail}) on{" "}
                {new Date(
                  detailQuery.data.request.createdAt,
                ).toLocaleDateString("en-GB")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 text-sm">
              <div>
                <StatusPill status={detailQuery.data.request.status} />
              </div>

              <DetailSection title="Requested support">
                <ul className="ml-4 list-disc">
                  {detailQuery.data.request.requestedMembershipFull ? (
                    <li>Full membership donation relief</li>
                  ) : null}
                  {detailQuery.data.request.requestedMembershipPartial ? (
                    <li>
                      Partial membership donation relief
                      {detailQuery.data.request.partialAmountPence != null
                        ? ` (manageable: £${(detailQuery.data.request.partialAmountPence / 100).toFixed(2)})`
                        : ""}
                    </li>
                  ) : null}
                  {detailQuery.data.request.requestedMatchFees ? (
                    <li>Match donation relief</li>
                  ) : null}
                </ul>
              </DetailSection>

              <DetailSection title="Reason">
                {detailQuery.data.request.reasonCategory ? (
                  <p className="font-medium">
                    {REASON_CATEGORY_LABELS[
                      detailQuery.data.request
                        .reasonCategory as keyof typeof REASON_CATEGORY_LABELS
                    ] ?? detailQuery.data.request.reasonCategory}
                  </p>
                ) : null}
                {detailQuery.data.request.reasonText ? (
                  <p className="whitespace-pre-wrap text-stone-700">
                    {detailQuery.data.request.reasonText}
                  </p>
                ) : (
                  <p className="text-stone-500">No explanation provided.</p>
                )}
              </DetailSection>

              <DetailSection title="Duration">
                <p>
                  {detailQuery.data.request.duration
                    ? (DURATION_LABELS[
                        detailQuery.data.request
                          .duration as keyof typeof DURATION_LABELS
                      ] ?? detailQuery.data.request.duration)
                    : "—"}
                </p>
                {detailQuery.data.request.durationOtherText ? (
                  <p className="text-stone-700">
                    {detailQuery.data.request.durationOtherText}
                  </p>
                ) : null}
              </DetailSection>

              <DetailSection title="Contribution offered">
                <p>
                  {detailQuery.data.request.contributionAbility
                    ? (CONTRIBUTION_ABILITY_LABELS[
                        detailQuery.data.request
                          .contributionAbility as keyof typeof CONTRIBUTION_ABILITY_LABELS
                      ] ?? detailQuery.data.request.contributionAbility)
                    : "—"}
                </p>
                {detailQuery.data.request.contributionAmountPence != null ? (
                  <p>
                    Amount: £
                    {(
                      detailQuery.data.request.contributionAmountPence / 100
                    ).toFixed(2)}
                  </p>
                ) : null}
              </DetailSection>

              <DetailSection title="Non-financial contribution">
                {detailQuery.data.request.volunteerOptions.length === 0 ? (
                  <p className="text-stone-500">None selected.</p>
                ) : (
                  <ul className="ml-4 list-disc">
                    {detailQuery.data.request.volunteerOptions.map((o) => (
                      <li key={o}>
                        {VOLUNTEER_OPTION_LABELS[
                          o as keyof typeof VOLUNTEER_OPTION_LABELS
                        ] ?? o}
                      </li>
                    ))}
                  </ul>
                )}
                {detailQuery.data.request.volunteerNotes ? (
                  <p className="whitespace-pre-wrap text-stone-700">
                    {detailQuery.data.request.volunteerNotes}
                  </p>
                ) : null}
              </DetailSection>

              <DetailSection title="Contact preference">
                <p>
                  {CONTACT_PREFERENCE_LABELS[
                    detailQuery.data.request
                      .contactPreference as keyof typeof CONTACT_PREFERENCE_LABELS
                  ] ?? detailQuery.data.request.contactPreference}
                </p>
              </DetailSection>

              {detailQuery.data.grant ? (
                <DetailSection title="Active grant">
                  <p>
                    Covers{" "}
                    {[
                      detailQuery.data.grant.coversMembership
                        ? "membership donations"
                        : null,
                      detailQuery.data.grant.coversMatchFees
                        ? "match donations"
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" + ") || "—"}
                    , from{" "}
                    {new Date(
                      detailQuery.data.grant.effectiveFrom,
                    ).toLocaleDateString("en-GB")}
                    {detailQuery.data.grant.effectiveToExclusive
                      ? ` until ${new Date(detailQuery.data.grant.effectiveToExclusive).toLocaleDateString("en-GB")}`
                      : " (open-ended)"}
                    .
                  </p>
                  {detailQuery.data.grant.memberFacingNote ? (
                    <p className="text-stone-700">
                      Note to member: {detailQuery.data.grant.memberFacingNote}
                    </p>
                  ) : null}
                </DetailSection>
              ) : null}

              <DetailSection title="History">
                <ul className="ml-4 list-disc">
                  {detailQuery.data.events.map((e) => (
                    <li key={e.id}>
                      <span className="font-medium">{e.eventType}</span>{" "}
                      &middot; {new Date(e.createdAt).toLocaleString("en-GB")}{" "}
                      &middot; {e.actorName ?? "—"}
                      {e.note ? ` — ${e.note}` : ""}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            </div>

            <DialogFooter className="flex-wrap gap-2">
              {isOpen ? (
                <>
                  {detailQuery.data.request.status !== "in_review" ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        transition.mutate({
                          toStatus: "in_review",
                          note: null,
                        })
                      }
                      disabled={transition.isPending}
                    >
                      Move to in review
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() =>
                      transition.mutate({
                        toStatus: "more_info_needed",
                        note: null,
                      })
                    }
                    disabled={transition.isPending}
                  >
                    Request more info
                  </Button>
                  <Button onClick={() => setDecideDialogOpen(true)}>
                    Approve…
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setDeclineDialogOpen(true)}
                  >
                    Decline
                  </Button>
                </>
              ) : null}
              {detailQuery.data.grant && !detailQuery.data.grant.closedAt ? (
                <>
                  {detailQuery.data.grant.coversMembership ? (
                    <ApplyMembershipReliefButton
                      grantId={detailQuery.data.grant.id}
                      requestId={requestId}
                    />
                  ) : null}
                  <CloseGrantButton
                    grantId={detailQuery.data.grant.id}
                    requestId={requestId}
                  />
                </>
              ) : null}
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {declineDialogOpen ? (
          <DeclineDialog
            requestId={requestId}
            onClose={() => setDeclineDialogOpen(false)}
          />
        ) : null}
        {decideDialogOpen ? (
          <DecideDialog
            requestId={requestId}
            onClose={() => setDecideDialogOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [memberFacingNote, setMemberFacingNote] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const decline = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/financial-relief/requests/{requestId}/decline", {
          params: { path: { requestId } },
          body: {
            memberFacingNote: memberFacingNote || null,
            adminNote: adminNote || null,
          },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-relief", "detail", requestId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-relief", "list"] }),
      ]).then(onClose),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline request</DialogTitle>
          <DialogDescription>
            The member-facing note is shown to the requester. The admin note
            stays internal.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="memberFacingNote">
              Member-facing note (optional)
            </Label>
            <Textarea
              id="memberFacingNote"
              rows={3}
              value={memberFacingNote}
              onChange={(e) => setMemberFacingNote(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adminNote">Admin note (optional)</Label>
            <Textarea
              id="adminNote"
              rows={3}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={decline.isPending}
            onClick={() => decline.mutate()}
          >
            {decline.isPending ? "Declining…" : "Decline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

interface DecideFormState {
  decision: "approved_full" | "approved_partial" | "approved_temporary";
  coversMembership: boolean;
  coversMatchFees: boolean;
  membershipPartialPounds: string;
  effectiveFrom: string;
  effectiveToExclusive: string;
  adminNotes: string;
  memberFacingNote: string;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function poundsToPenceOrNull(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function DecideDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, update] = useState<DecideFormState>({
    decision: "approved_temporary",
    coversMembership: false,
    coversMatchFees: true,
    membershipPartialPounds: "",
    effectiveFrom: todayIso(),
    effectiveToExclusive: "",
    adminNotes: "",
    memberFacingNote: "",
  });

  const decide = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/financial-relief/requests/{requestId}/decide", {
          params: { path: { requestId } },
          body: {
            decision: form.decision,
            coversMembership: form.coversMembership,
            coversMatchFees: form.coversMatchFees,
            membershipPartialPence:
              form.decision === "approved_partial" && form.coversMembership
                ? poundsToPenceOrNull(form.membershipPartialPounds)
                : null,
            effectiveFrom: form.effectiveFrom,
            effectiveToExclusive: form.effectiveToExclusive || null,
            adminNotes: form.adminNotes || null,
            memberFacingNote: form.memberFacingNote || null,
          },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-relief", "detail", requestId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-relief", "list"] }),
      ]).then(onClose),
  });

  const canSubmit =
    (form.coversMembership || form.coversMatchFees) &&
    !!form.effectiveFrom &&
    !decide.isPending;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Approve request</DialogTitle>
          <DialogDescription>
            The grant takes effect from the chosen date. The member-facing note
            is shown verbatim to the requester; admin notes stay internal.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="decision">Decision</Label>
            <Select
              value={form.decision}
              onValueChange={(v) =>
                update((s) => ({
                  ...s,
                  decision: v as DecideFormState["decision"],
                }))
              }
            >
              <SelectTrigger id="decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved_full">
                  Approved (full relief)
                </SelectItem>
                <SelectItem value="approved_partial">
                  Approved (partial relief)
                </SelectItem>
                <SelectItem value="approved_temporary">
                  Approved (temporary relief)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">What does this cover?</span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="coversMembership"
                checked={form.coversMembership}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    coversMembership: e.target.checked,
                  }))
                }
              />
              <Label htmlFor="coversMembership">Membership donations</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="coversMatchFees"
                checked={form.coversMatchFees}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    coversMatchFees: e.target.checked,
                  }))
                }
              />
              <Label htmlFor="coversMatchFees">Match donations</Label>
            </div>
          </div>
          {form.decision === "approved_partial" && form.coversMembership ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="membershipPartialPounds">
                Member contributes (in £) towards membership
              </Label>
              <Input
                id="membershipPartialPounds"
                type="number"
                min="0"
                step="1"
                value={form.membershipPartialPounds}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    membershipPartialPounds: e.target.value,
                  }))
                }
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="effectiveFrom">Effective from</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) =>
                  update((s) => ({ ...s, effectiveFrom: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="effectiveToExclusive">
                Until (exclusive, optional)
              </Label>
              <Input
                id="effectiveToExclusive"
                type="date"
                value={form.effectiveToExclusive}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    effectiveToExclusive: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="memberFacingNote">
              Member-facing note (shown to requester)
            </Label>
            <Textarea
              id="memberFacingNote"
              rows={3}
              value={form.memberFacingNote}
              onChange={(e) =>
                update((s) => ({ ...s, memberFacingNote: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="decideAdminNotes">Admin notes (private)</Label>
            <Textarea
              id="decideAdminNotes"
              rows={3}
              value={form.adminNotes}
              onChange={(e) =>
                update((s) => ({ ...s, adminNotes: e.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => decide.mutate()}>
            {decide.isPending ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseGrantButton({
  grantId,
  requestId,
}: {
  grantId: string;
  requestId: string;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  const close = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/financial-relief/grants/{grantId}/close", {
          params: { path: { grantId } },
          body: { reason: reason || "closed by admin" },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-relief", "detail", requestId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-relief", "list"] }),
      ]).then(() => setConfirming(false)),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Close grant
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={(v) => !v && setConfirming(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close grant</DialogTitle>
            <DialogDescription>
              Previously-relieved charges stay relieved. Future charges stop
              being auto-forgiven.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="closeReason">Reason</Label>
            <Input
              id="closeReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. season ended"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={close.isPending}
              onClick={() => close.mutate()}
            >
              {close.isPending ? "Closing…" : "Close grant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApplyMembershipReliefButton({
  grantId,
  requestId,
}: {
  grantId: string;
  requestId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, update] = useReducer(
    (
      s: {
        amountPounds: string;
        effectiveDate: string;
        membershipPaidUntil: string;
        membershipType: string;
        description: string;
      },
      patch: Partial<typeof s>,
    ) => ({ ...s, ...patch }),
    null,
    () => ({
      amountPounds: "",
      effectiveDate: todayIso(),
      membershipPaidUntil: "",
      membershipType: "",
      description: "",
    }),
  );
  const {
    amountPounds,
    effectiveDate,
    membershipPaidUntil,
    membershipType,
    description,
  } = form;

  const apply = useMutation({
    mutationFn: () =>
      callApi(
        api.POST(
          "/api/admin/financial-relief/grants/{grantId}/apply-membership",
          {
            params: { path: { grantId } },
            body: {
              amountPence: Math.max(
                0,
                Math.round(Number(amountPounds || "0") * 100),
              ),
              effectiveDate,
              membershipPaidUntil,
              membershipType,
              description,
            },
          },
        ),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-relief", "detail", requestId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-relief", "list"] }),
      ]).then(() => setOpen(false)),
  });

  const canSubmit =
    !!membershipType &&
    !!membershipPaidUntil &&
    !!effectiveDate &&
    !!description &&
    Number(amountPounds) > 0 &&
    !apply.isPending;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Apply membership relief
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply membership relief</DialogTitle>
            <DialogDescription>
              Creates a relieved membership charge for reporting and extends
              this member's paid_until.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="amountPounds">Amount (in £)</Label>
              <Input
                id="amountPounds"
                type="number"
                min="0"
                step="1"
                value={amountPounds}
                onChange={(e) => update({ amountPounds: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="applyEffective">Charge date</Label>
                <Input
                  id="applyEffective"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => update({ effectiveDate: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="paidUntil">Paid until</Label>
                <Input
                  id="paidUntil"
                  type="date"
                  value={membershipPaidUntil}
                  onChange={(e) =>
                    update({ membershipPaidUntil: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="membershipType">Membership type</Label>
              <Input
                id="membershipType"
                placeholder="e.g. senior_player"
                value={membershipType}
                onChange={(e) => update({ membershipType: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="applyDescription">Description</Label>
              <Input
                id="applyDescription"
                placeholder="e.g. Senior membership (relief)"
                value={description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={() => apply.mutate()}>
              {apply.isPending ? "Applying…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const SEASON_BUCKETS: Array<{
  key: "juniors" | "womensGirls" | "senior" | "other";
  label: string;
}> = [
  { key: "juniors", label: "Juniors" },
  { key: "womensGirls", label: "Women's / Girls" },
  { key: "senior", label: "Senior" },
  { key: "other", label: "Other" },
];

function startOfYearIso() {
  return `${new Date().getFullYear()}-01-01`;
}

function endOfYearIso() {
  return `${new Date().getFullYear()}-12-31`;
}

const POUNDS_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function formatPounds(pence: number): string {
  return POUNDS_FORMATTER.format(pence / 100);
}

function ReliefReportPanel() {
  const [report, update] = useReducer(
    (
      s: { dateFrom: string; dateTo: string; submitted: boolean },
      patch: Partial<typeof s>,
    ) => ({ ...s, ...patch }),
    null,
    () => ({
      dateFrom: startOfYearIso(),
      dateTo: endOfYearIso(),
      submitted: false,
    }),
  );

  const query = useQuery({
    queryKey: ["admin-relief", "report", report.dateFrom, report.dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/financial-relief/report", {
          params: {
            query: { dateFrom: report.dateFrom, dateTo: report.dateTo },
          },
        }),
      ),
    enabled: report.submitted,
  });

  return (
    <div className="rounded border border-stone-200 p-4">
      <h2 className="text-base font-semibold">Relief summary</h2>
      <p className="text-xs text-stone-600">
        Aggregate totals of forgiven charges by section. No member details are
        included, so these figures are safe to share publicly.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="reportFrom">From</Label>
          <Input
            id="reportFrom"
            type="date"
            value={report.dateFrom}
            onChange={(e) =>
              update({ dateFrom: e.target.value, submitted: false })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="reportTo">To</Label>
          <Input
            id="reportTo"
            type="date"
            value={report.dateTo}
            onChange={(e) =>
              update({ dateTo: e.target.value, submitted: false })
            }
          />
        </div>
        <Button onClick={() => update({ submitted: true })}>Summarise</Button>
      </div>

      {query.isLoading ? (
        <p className="mt-3 text-sm text-stone-600">Loading…</p>
      ) : query.data ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            label="Total relief"
            value={formatPounds(query.data.totalForgivenPence)}
            sub={`${query.data.forgivenChargeCount} charges`}
          />
          <SummaryCard
            label="Match donations"
            value={formatPounds(query.data.byReliefType.matchFeePence)}
          />
          <SummaryCard
            label="Membership donations"
            value={formatPounds(query.data.byReliefType.membershipPence)}
          />
          <SummaryCard
            label="Members supported"
            value={String(query.data.membersSupported)}
          />
          {SEASON_BUCKETS.map(({ key, label }) => {
            const b = query.data.bySection[key];
            return (
              <SummaryCard
                key={key}
                label={label}
                value={formatPounds(b.pence)}
                sub={`${b.count} charges · ${b.members} members`}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col rounded border border-stone-200 px-3 py-2">
      <span className="text-xs text-stone-600">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
      {sub ? <span className="text-xs text-stone-500">{sub}</span> : null}
    </div>
  );
}
