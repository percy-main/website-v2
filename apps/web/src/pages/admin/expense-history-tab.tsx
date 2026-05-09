import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { paths } from "@/lib/api.gen";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatPence } from "./status-pill";

// --- Types ---

type ExpenseHistoryResponse =
  paths["/api/treasurer/expenses"]["get"]["responses"]["200"]["content"]["application/json"];
type ExpenseItem = ExpenseHistoryResponse["items"][number];

// --- Constants ---

const PAGE_SIZE = 20;

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  umpire_fee: "Umpire Fee",
  scorer_fee: "Scorer Fee",
  match_ball: "Match Ball",
  teas: "Teas",
  miscellaneous: "Miscellaneous",
};

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "success" | "warning" | "destructive";
  }
> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "Submitted", variant: "default" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  reimbursed: { label: "Reimbursed", variant: "secondary" },
};

function getFinancialYearDefaults(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const year = currentMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    dateFrom: `${year}-04-01`,
    dateTo: `${year + 1}-03-31`,
  };
}

// --- Component ---

export function ExpenseHistoryTab() {
  const defaults = getFinancialYearDefaults();
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [status, setStatus] = useState("all");
  const [expenseType, setExpenseType] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseItem | null>(
    null,
  );
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
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

  const queryParams = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: status === "all" ? undefined : status,
    expenseType: expenseType === "all" ? undefined : expenseType,
    search: debouncedSearch || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const expensesQuery = useQuery({
    queryKey: ["treasurer", "expense-history", queryParams],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/expenses", {
          params: { query: queryParams },
        }),
      ),
  });

  const totalPages = Math.ceil((expensesQuery.data?.total ?? 0) / PAGE_SIZE);

  const hasFilters =
    status !== "all" ||
    expenseType !== "all" ||
    debouncedSearch !== "" ||
    dateFrom !== defaults.dateFrom ||
    dateTo !== defaults.dateTo;

  const clearFilters = () => {
    setStatus("all");
    setExpenseType("all");
    setSearch("");
    setDebouncedSearch("");
    setDateFrom(defaults.dateFrom);
    setDateTo(defaults.dateTo);
    setPage(1);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/treasurer/expenses/export?${new URLSearchParams(
          Object.entries({
            dateFrom: dateFrom || "",
            dateTo: dateTo || "",
            status: status === "all" ? "" : status,
            expenseType: expenseType === "all" ? "" : expenseType,
            search: debouncedSearch || "",
          }).filter(([, v]) => v !== ""),
        ).toString()}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        alert("Failed to export expenses. Please try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "expenses-export.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Expense History</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={isExporting}
        >
          {isExporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">Status</label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="reimbursed">Reimbursed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">Type</label>
          <Select
            value={expenseType}
            onValueChange={(v) => {
              setExpenseType(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(EXPENSE_TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-stone-500">Search</label>
          <Input
            placeholder="Description or opposition…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Results count */}
      <div className="text-sm text-stone-500">
        {expensesQuery.data
          ? `${expensesQuery.data.total} expense${expensesQuery.data.total === 1 ? "" : "s"} found`
          : expensesQuery.isLoading
            ? "Loading…"
            : ""}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Match Date</TableHead>
              <TableHead>Opposition</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {expensesQuery.data?.items.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell>{formatDate(expense.match_date)}</TableCell>
                <TableCell>{expense.opposition}</TableCell>
                <TableCell>{expense.team_name}</TableCell>
                <TableCell>
                  {EXPENSE_TYPE_LABELS[expense.expense_type] ??
                    expense.expense_type}
                </TableCell>
                <TableCell className="text-right">
                  {formatPence(expense.amount_pence)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      STATUS_CONFIG[expense.status]?.variant ?? "default"
                    }
                  >
                    {STATUS_CONFIG[expense.status]?.label ?? expense.status}
                  </Badge>
                </TableCell>
                <TableCell>{expense.submitted_by_name}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedExpense(expense)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {expensesQuery.data?.items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-stone-500"
                >
                  No expenses found matching your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-stone-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      <Dialog
        open={!!selectedExpense}
        onOpenChange={(open) => {
          if (!open) setSelectedExpense(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Expense Detail</DialogTitle>
          </DialogHeader>
          {selectedExpense && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-stone-500">Match Date</p>
                  <p>{formatDate(selectedExpense.match_date)}</p>
                </div>
                <div>
                  <p className="text-stone-500">Opposition</p>
                  <p>{selectedExpense.opposition}</p>
                </div>
                <div>
                  <p className="text-stone-500">Team</p>
                  <p>{selectedExpense.team_name}</p>
                </div>
                <div>
                  <p className="text-stone-500">Type</p>
                  <p>
                    {EXPENSE_TYPE_LABELS[selectedExpense.expense_type] ??
                      selectedExpense.expense_type}
                  </p>
                </div>
                <div>
                  <p className="text-stone-500">Amount</p>
                  <p className="font-medium">
                    {formatPence(selectedExpense.amount_pence)}
                  </p>
                </div>
                <div>
                  <p className="text-stone-500">Status</p>
                  <Badge
                    variant={
                      STATUS_CONFIG[selectedExpense.status]?.variant ??
                      "default"
                    }
                  >
                    {STATUS_CONFIG[selectedExpense.status]?.label ??
                      selectedExpense.status}
                  </Badge>
                </div>
                {selectedExpense.description && (
                  <div className="col-span-2">
                    <p className="text-stone-500">Description</p>
                    <p>{selectedExpense.description}</p>
                  </div>
                )}
              </div>

              {/* Audit trail */}
              <div className="border-t pt-3">
                <h4 className="mb-2 text-sm font-medium">Audit Trail</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-500">
                      {selectedExpense.submitted_at
                        ? "Submitted by"
                        : "Created by"}
                    </span>
                    <span>
                      {selectedExpense.submitted_by_name}
                      {selectedExpense.submitted_at &&
                        ` on ${formatDate(selectedExpense.submitted_at, true)}`}
                    </span>
                  </div>
                  {selectedExpense.approved_at && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Approved by</span>
                      <span>
                        {selectedExpense.approved_by_name ?? "Unknown"}
                        {` on ${formatDate(selectedExpense.approved_at, true)}`}
                      </span>
                    </div>
                  )}
                  {selectedExpense.reimbursed_at && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Reimbursed by</span>
                      <span>
                        {selectedExpense.reimbursed_by_name ?? "Unknown"}
                        {` on ${formatDate(selectedExpense.reimbursed_at, true)}`}
                      </span>
                    </div>
                  )}
                  {selectedExpense.rejected_reason && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Rejected reason</span>
                      <span className="text-red-600">
                        {selectedExpense.rejected_reason}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Receipt image */}
              {selectedExpense.receipt_image_url && (
                <div className="border-t pt-3">
                  <h4 className="mb-2 text-sm font-medium">Receipt</h4>
                  <img
                    src={selectedExpense.receipt_image_url}
                    alt="Receipt"
                    className="max-h-48 cursor-pointer rounded border object-contain"
                    onClick={() =>
                      setLightboxUrl(selectedExpense.receipt_image_url)
                    }
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Receipt full size"
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
