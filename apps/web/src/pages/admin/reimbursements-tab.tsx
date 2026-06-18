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
import type { paths } from "@/lib/api.gen";
import {
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUSES,
  type ExpenseStatus,
} from "@percy-main/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { ManageExpenseTagsDialog } from "./manage-expense-tags-dialog";
import { ReimbursementDetailDialog } from "./reimbursement-detail-dialog";
import { formatDate, formatPence } from "./status-pill";

type ListResponse =
  paths["/api/expenses"]["get"]["responses"]["200"]["content"]["application/json"];
type SummaryResponse =
  paths["/api/expenses/summary"]["get"]["responses"]["200"]["content"]["application/json"];

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<
  ExpenseStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  pending: "default",
  awaiting_second_approval: "warning",
  approved: "success",
  denied: "destructive",
  paid: "secondary",
  payout_failed: "destructive",
};

interface Filters {
  status: ExpenseStatus | "all";
  tagId: string;
  search: string;
  debouncedSearch: string;
  page: number;
}

type FilterAction =
  | { type: "setStatus"; value: ExpenseStatus | "all" }
  | { type: "setTag"; value: string }
  | { type: "setSearch"; value: string }
  | { type: "commitSearch"; value: string }
  | { type: "setPage"; value: number };

const INITIAL_FILTERS: Filters = {
  status: "all",
  tagId: "all",
  search: "",
  debouncedSearch: "",
  page: 1,
};

// Filter changes reset to page 1 so you never sit on an out-of-range page.
function filtersReducer(state: Filters, action: FilterAction): Filters {
  switch (action.type) {
    case "setStatus":
      return { ...state, status: action.value, page: 1 };
    case "setTag":
      return { ...state, tagId: action.value, page: 1 };
    case "setSearch":
      return { ...state, search: action.value };
    case "commitSearch":
      return { ...state, debouncedSearch: action.value, page: 1 };
    case "setPage":
      return { ...state, page: action.value };
  }
}

export function ReimbursementsTab() {
  const canApprove = useHasPermission("expenses", "approve").allowed;
  const canPay = useHasPermission("expenses", "pay").allowed;
  const canManageTags = useHasPermission("expenses", "manage_tags").allowed;

  const [filters, dispatch] = useReducer(filtersReducer, INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(
      () => dispatch({ type: "commitSearch", value: filters.search }),
      300,
    );
    return () => clearTimeout(t);
  }, [filters.search]);

  const { data: categories } = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => callApi(api.GET("/api/expense-categories")),
  });

  const queryParams = {
    page: filters.page,
    pageSize: PAGE_SIZE,
    status: filters.status,
    tagId: filters.tagId === "all" ? undefined : filters.tagId,
    search: filters.debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "list", queryParams],
    queryFn: () =>
      callApi(api.GET("/api/expenses", { params: { query: queryParams } })),
  });

  const { data: summary } = useQuery({
    queryKey: ["expenses", "summary"],
    queryFn: () => callApi(api.GET("/api/expenses/summary", { params: {} })),
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const availableTags = (categories?.categories ?? []).map((c) => c.name);

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Reimbursements</h2>
        {canManageTags && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setManageOpen(true)}
          >
            Manage tags
          </Button>
        )}
      </div>

      {summary && <SummaryCards summary={summary} />}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="reimb-status" className="text-xs text-stone-500">
            Status
          </label>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              dispatch({ type: "setStatus", value: v as ExpenseStatus | "all" })
            }
          >
            <SelectTrigger id="reimb-status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EXPENSE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {EXPENSE_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reimb-tag" className="text-xs text-stone-500">
            Tag
          </label>
          <Select
            value={filters.tagId}
            onValueChange={(v) => dispatch({ type: "setTag", value: v })}
          >
            <SelectTrigger id="reimb-tag" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {(categories?.categories ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reimb-search" className="text-xs text-stone-500">
            Search
          </label>
          <Input
            id="reimb-search"
            placeholder="Claimant or description…"
            value={filters.search}
            onChange={(e) =>
              dispatch({ type: "setSearch", value: e.target.value })
            }
            className="w-56"
          />
        </div>
      </div>

      <div className="text-sm text-stone-500">
        {data
          ? `${data.total} claim${data.total === 1 ? "" : "s"} found`
          : isLoading
            ? "Loading…"
            : ""}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claimant</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Approvals</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((row: ListResponse["items"][number]) => (
              <TableRow key={row.id}>
                <TableCell>{row.claimantName}</TableCell>
                <TableCell className="max-w-xs truncate">
                  {row.description}
                </TableCell>
                <TableCell className="text-right">
                  {formatPence(row.amountPence)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.tags.map((t) => (
                      <Badge key={t.id} variant="secondary">
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status]}>
                    {EXPENSE_STATUS_LABELS[row.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {row.approvalCount}/{row.needsTwoApprovers ? 2 : 1}
                </TableCell>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedId(row.id)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data?.items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-stone-500"
                >
                  No claims found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-stone-500">
            Page {filters.page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() =>
                dispatch({ type: "setPage", value: filters.page - 1 })
              }
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page >= totalPages}
              onClick={() =>
                dispatch({ type: "setPage", value: filters.page + 1 })
              }
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ReimbursementDetailDialog
        expenseId={selectedId}
        availableTags={availableTags}
        canApprove={canApprove}
        canPay={canPay}
        onClose={() => setSelectedId(null)}
      />
      <ManageExpenseTagsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
      />
    </div>
  );
}

function SummaryCards({ summary }: { summary: SummaryResponse }) {
  const cards: Array<{ label: string; status: ExpenseStatus }> = [
    { label: "Pending", status: "pending" },
    { label: "Awaiting 2nd", status: "awaiting_second_approval" },
    { label: "Approved", status: "approved" },
    { label: "Paid", status: "paid" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => {
        const bucket = summary.byStatus[c.status];
        return (
          <div key={c.status} className="rounded-md border p-3">
            <p className="text-xs text-stone-500">{c.label}</p>
            <p className="text-lg font-semibold">
              {formatPence(bucket.totalPence)}
            </p>
            <p className="text-xs text-stone-400">{bucket.count} claims</p>
          </div>
        );
      })}
    </div>
  );
}
