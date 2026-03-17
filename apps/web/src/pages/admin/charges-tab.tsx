import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatPence } from "./status-pill";

const PAGE_SIZE = 20;

type ChargeStatus = "all" | "unpaid" | "pending" | "paid" | "abandoned";

interface Charge {
  id: string;
  memberId: string;
  description: string;
  amountPence: number;
  chargeDate: string;
  createdAt: string;
  paidAt: string | null;
  paymentConfirmedAt: string | null;
  stripePaymentIntentId: string | null;
  type: string;
  source: string;
  deletedAt: string | null;
  deletedReason: string | null;
  memberName: string | null;
  memberEmail: string;
  status: "paid" | "pending" | "unpaid" | "abandoned" | "deleted";
}

interface ChargesResponse {
  charges: Charge[];
  total: number;
  page: number;
  pageSize: number;
}

interface AggregatesResponse {
  totalCharged: number;
  totalPaid: number;
  totalOutstanding: number;
  totalAbandoned: number;
  totalDeleted: number;
  countPaid: number;
  countUnpaid: number;
  countPending: number;
  countAbandoned: number;
  countDeleted: number;
}

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

export function ChargesTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ChargeStatus>("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [chasingChargeId, setChasingChargeId] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
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
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        status,
        showDeleted: String(showDeleted),
      });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return api.get<ChargesResponse>(`/admin/charges?${params}`);
    },
  });

  const aggregatesQuery = useQuery({
    queryKey: ["admin", "chargeAggregates", dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const qs = params.toString();
      return api.get<AggregatesResponse>(
        `/admin/charge-aggregates${qs ? `?${qs}` : ""}`,
      );
    },
  });

  const chaseMutation = useMutation({
    mutationFn: (chargeId: string) =>
      api.post("/admin/chase-payment", { chargeId }),
    onSuccess: () => {
      setChasingChargeId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "charges"] });
    },
  });

  const result = chargesQuery.data;
  const aggregates = aggregatesQuery.data;
  const totalPages = result
    ? Math.max(1, Math.ceil(result.total / PAGE_SIZE))
    : 1;

  const hasFilters =
    dateFrom || dateTo || search || status !== "all" || showDeleted;

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
          placeholder="Search member or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as ChargeStatus);
            setPage(1);
          }}
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
          <Label htmlFor="charges-date-from" className="text-gray-500">
            From
          </Label>
          <Input
            id="charges-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          />
        </div>
        <div className="flex items-center gap-1">
          <Label htmlFor="charges-date-to" className="text-gray-500">
            To
          </Label>
          <Input
            id="charges-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="charges-show-deleted"
            checked={showDeleted}
            onCheckedChange={(checked) => {
              setShowDeleted(checked === true);
              setPage(1);
            }}
          />
          <Label htmlFor="charges-show-deleted" className="text-gray-600">
            Show deleted
          </Label>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setDebouncedSearch("");
              setStatus("all");
              setDateFrom("");
              setDateTo("");
              setShowDeleted(false);
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Loading / Error */}
      {chargesQuery.isLoading && <p className="text-gray-500">Loading...</p>}
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
                  <TableCell colSpan={8} className="text-center text-gray-500">
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
                        <span className="text-xs text-gray-500">
                          {charge.memberEmail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {charge.description}
                      {charge.deletedReason && (
                        <div className="text-xs text-gray-400">
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
                        <>
                          {chasingChargeId === charge.id ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={chaseMutation.isPending}
                                onClick={() => chaseMutation.mutate(charge.id)}
                              >
                                {chaseMutation.isPending
                                  ? "Sending..."
                                  : "Send"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setChasingChargeId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setChasingChargeId(charge.id)}
                            >
                              Chase
                            </Button>
                          )}
                          {chaseMutation.isError &&
                            chasingChargeId === charge.id && (
                              <p className="mt-1 text-xs text-red-600">
                                Failed to send reminder.
                              </p>
                            )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              {result.total} charge{result.total !== 1 ? "s" : ""} total
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
        <CardTitle className="text-sm font-medium text-gray-500">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold">{formatPence(amount)}</div>
        <p className="text-xs text-gray-500">
          {count} charge{count !== 1 ? "s" : ""}
        </p>
      </CardContent>
    </Card>
  );
}
