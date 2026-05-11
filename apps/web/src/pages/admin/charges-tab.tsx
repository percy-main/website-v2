import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  type ChargeStatus,
  chargesFilterReducer,
  initialChargesFilterState,
  isFiltered,
} from "./charges-tab.reducer";
import { formatDate, formatPence } from "./status-pill";

const PAGE_SIZE = 20;

const statusBadgeMap: Record<
  string,
  {
    variant:
      | "success"
      | "warning"
      | "info"
      | "destructive"
      | "default"
      | "secondary";
    label: string;
  }
> = {
  paid: { variant: "success", label: "Paid" },
  unpaid: { variant: "warning", label: "Unpaid" },
  pending: { variant: "info", label: "Pending" },
  abandoned: { variant: "destructive", label: "Abandoned" },
  deleted: { variant: "secondary", label: "Deleted" },
};

// eslint-disable-next-line react-doctor/no-giant-component -- admin charges tab: filter bar + paginated table + row actions (refund, void, edit) all share the filters reducer + table query; splitting would mean lifting the reducer and queryClient through props for marginal benefit. TODO: extract row-level mutations into a hook if more action verbs are added.
export function ChargesTab() {
  const queryClient = useQueryClient();
  const [filters, dispatch] = useReducer(
    chargesFilterReducer,
    initialChargesFilterState,
  );
  const {
    page,
    status,
    showDeleted,
    dateFrom,
    dateTo,
    search,
    debouncedSearch,
  } = filters;
  type ConfirmAction =
    | { kind: "chase"; chargeId: string }
    | { kind: "void"; chargeId: string; reason: string };
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null,
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      dispatch({ type: "commitSearch", value: search });
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [search]);

  const chargesQuery = useQuery({
    queryKey: [
      "admin",
      "charges",
      page,
      PAGE_SIZE,
      status,
      showDeleted,
      dateFrom,
      dateTo,
      debouncedSearch,
    ],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/charges", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              status,
              showDeleted,
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
            },
          },
        }),
      ),
  });

  const aggregatesQuery = useQuery({
    queryKey: ["admin", "chargeAggregates", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/charge-aggregates", {
          params: {
            query: {
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
            },
          },
        }),
      ),
  });

  const chaseMutation = useMutation({
    mutationFn: (chargeId: string) =>
      callApi(
        api.POST("/api/admin/chase-payment", {
          body: { chargeId },
        }),
      ),
    onSuccess: () => {
      setConfirmAction(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "charges"] });
    },
  });

  const voidMutation = useMutation({
    mutationFn: (input: { chargeId: string; reason: string }) =>
      callApi(
        api.DELETE("/api/admin/charges/{chargeId}", {
          params: { path: { chargeId: input.chargeId } },
          body: { reason: input.reason },
        }),
      ),
    onSuccess: () => {
      setConfirmAction(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "charges"] });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "chargeAggregates"],
      });
    },
  });

  const result = chargesQuery.data;
  const aggregates = aggregatesQuery.data;
  const totalPages = result
    ? Math.max(1, Math.ceil(result.total / PAGE_SIZE))
    : 1;

  const hasFilters = isFiltered(filters);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Cards */}
      {aggregates && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            title="Total Charged"
            amount={aggregates.totalCharged}
            count={
              aggregates.countPaid +
              aggregates.countUnpaid +
              aggregates.countPending +
              aggregates.countAbandoned
            }
            variant="default"
          />
          <SummaryCard
            title="Collected"
            amount={aggregates.totalPaid}
            count={aggregates.countPaid}
            variant="success"
          />
          <SummaryCard
            title="Outstanding"
            amount={aggregates.totalOutstanding}
            count={
              aggregates.countUnpaid +
              aggregates.countPending +
              aggregates.countAbandoned
            }
            variant="warning"
          />
          <SummaryCard
            title="Abandoned"
            amount={aggregates.totalAbandoned}
            count={aggregates.countAbandoned}
            variant="destructive"
          />
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="text"
          placeholder="Search member or description…"
          value={search}
          onChange={(e) =>
            dispatch({ type: "setSearch", value: e.target.value })
          }
          className="w-full max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) =>
            dispatch({ type: "setStatus", value: value as ChargeStatus })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Label htmlFor="charges-date-from" className="text-stone-500">
            From
          </Label>
          <Input
            id="charges-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) =>
              dispatch({ type: "setDateFrom", value: e.target.value })
            }
            className="w-auto"
          />
        </div>
        <div className="flex items-center gap-1">
          <Label htmlFor="charges-date-to" className="text-stone-500">
            To
          </Label>
          <Input
            id="charges-date-to"
            type="date"
            value={dateTo}
            onChange={(e) =>
              dispatch({ type: "setDateTo", value: e.target.value })
            }
            className="w-auto"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="charges-show-deleted"
            checked={showDeleted}
            onCheckedChange={(checked) =>
              dispatch({ type: "setShowDeleted", value: checked === true })
            }
          />
          <Label htmlFor="charges-show-deleted" className="text-stone-600">
            Show deleted
          </Label>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "clearFilters" })}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Loading / Error */}
      {chargesQuery.isLoading && <p className="text-stone-500">Loading…</p>}
      {chargesQuery.isError && (
        <p className="text-red-600">Failed to load charges.</p>
      )}

      {/* Table */}
      {result && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.charges.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-stone-500">
                    No charges found.
                  </TableCell>
                </TableRow>
              )}
              {result.charges.map((charge) => {
                const badge = statusBadgeMap[charge.status];
                return (
                  <TableRow
                    key={charge.id}
                    className={charge.status === "deleted" ? "opacity-60" : ""}
                  >
                    <TableCell>{formatDate(charge.chargeDate)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{charge.memberName}</span>
                        <span className="text-xs text-stone-500">
                          {charge.memberEmail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {charge.description}
                      {charge.deletedReason && (
                        <div className="text-xs text-stone-400">
                          Deleted: {charge.deletedReason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPence(charge.amountPence)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{charge.source}</Badge>
                    </TableCell>
                    <TableCell>
                      {badge && (
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {charge.paidAt ? formatDate(charge.paidAt) : "-"}
                    </TableCell>
                    <TableCell>
                      {(charge.status === "abandoned" ||
                        charge.status === "unpaid") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Charge actions"
                              className="size-8 p-0"
                            >
                              <EllipsisIcon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                setConfirmAction({
                                  kind: "chase",
                                  chargeId: charge.id,
                                })
                              }
                            >
                              Chase
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-700 focus:bg-red-50 focus:text-red-800"
                              onSelect={() =>
                                setConfirmAction({
                                  kind: "void",
                                  chargeId: charge.id,
                                  reason: "",
                                })
                              }
                            >
                              Void…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-stone-500">
              {result.total} charge{result.total !== 1 ? "s" : ""} total
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

      <ChaseConfirmDialog
        action={confirmAction?.kind === "chase" ? confirmAction : null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        onConfirm={(chargeId) => chaseMutation.mutate(chargeId)}
        isPending={chaseMutation.isPending}
        isError={chaseMutation.isError}
      />

      <VoidConfirmDialog
        action={confirmAction?.kind === "void" ? confirmAction : null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        onReasonChange={(reason) =>
          setConfirmAction((prev) =>
            prev?.kind === "void" ? { ...prev, reason } : prev,
          )
        }
        onConfirm={(input) => voidMutation.mutate(input)}
        isPending={voidMutation.isPending}
        isError={voidMutation.isError}
      />
    </div>
  );
}

function EllipsisIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function ChaseConfirmDialog({
  action,
  onOpenChange,
  onConfirm,
  isPending,
  isError,
}: {
  action: { chargeId: string } | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (chargeId: string) => void;
  isPending: boolean;
  isError: boolean;
}) {
  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chase this charge?</DialogTitle>
          <DialogDescription>
            Sends a payment-reminder email to the member. The charge stays
            outstanding.
          </DialogDescription>
        </DialogHeader>
        {isError && (
          <p className="mt-2 text-sm text-red-600">
            Failed to send reminder. Try again.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!action || isPending}
            onClick={() => {
              if (action) onConfirm(action.chargeId);
            }}
          >
            {isPending ? "Sending…" : "Send reminder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidConfirmDialog({
  action,
  onOpenChange,
  onReasonChange,
  onConfirm,
  isPending,
  isError,
}: {
  action: { chargeId: string; reason: string } | null;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: (input: { chargeId: string; reason: string }) => void;
  isPending: boolean;
  isError: boolean;
}) {
  const reason = action?.reason ?? "";
  const trimmed = reason.trim();
  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this charge?</DialogTitle>
          <DialogDescription>
            Soft-deletes the charge so it no longer counts as outstanding and
            the member is not chased. Cannot be undone from the UI.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="void-reason" className="text-sm font-medium">
            Reason (required)
          </Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="e.g. matchday cancelled, charge raised in error"
            rows={3}
            maxLength={500}
          />
        </div>
        {isError && (
          <p className="mt-2 text-sm text-red-600">
            Failed to void. Try again.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!action || isPending || trimmed.length === 0}
            onClick={() => {
              if (action && trimmed.length > 0) {
                onConfirm({ chargeId: action.chargeId, reason: trimmed });
              }
            }}
          >
            {isPending ? "Voiding…" : "Void charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  title,
  amount,
  count,
  variant,
}: {
  title: string;
  amount: number;
  count: number;
  variant: "default" | "success" | "warning" | "destructive";
}) {
  const borderColorMap: Record<string, string> = {
    default: "",
    success: "border-l-green-500",
    warning: "border-l-yellow-500",
    destructive: "border-l-red-500",
  };

  return (
    <Card className={`border-l-4 ${borderColorMap[variant]}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-stone-500">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold">{formatPence(amount)}</div>
        <p className="text-xs text-stone-500">
          {count} charge{count !== 1 ? "s" : ""}
        </p>
      </CardContent>
    </Card>
  );
}
