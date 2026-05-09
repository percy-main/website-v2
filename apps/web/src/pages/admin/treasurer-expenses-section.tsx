import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { paths } from "@/lib/api.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatDate, formatPence } from "./status-pill";

type ExpensesWithReceiptsResponse =
  paths["/api/treasurer/expenses-with-receipts"]["get"]["responses"]["200"]["content"]["application/json"];
type Expense = ExpensesWithReceiptsResponse["expenses"][number];

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

interface TreasurerExpensesSectionProps {
  dateFrom: string;
  dateTo: string;
}

/**
 * Matchday Expenses card + detail modal + receipt lightbox.
 *
 * Owns the row-selection / reject-flow / lightbox UI state, plus the
 * approve/reject/reimburse mutations. Pulled out of TreasurerTab so the
 * latter no longer hosts ~250 lines of single-feature concerns.
 *
 * The expenses-summary header (grand total) is fetched separately from
 * the detail listing — both queries are scoped to the same `dateFrom` /
 * `dateTo` keys driven by the parent.
 */
export function TreasurerExpensesSection({
  dateFrom,
  dateTo,
}: TreasurerExpensesSectionProps) {
  const queryClient = useQueryClient();
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const expensesSummaryQuery = useQuery({
    queryKey: ["treasurer", "matchday-expenses-summary", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/matchday-expenses-summary", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
  });

  const expensesDetailQuery = useQuery({
    queryKey: ["treasurer", "expenses-with-receipts", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/expenses-with-receipts", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
  });

  const invalidateExpenses = () => {
    void queryClient.invalidateQueries({
      queryKey: ["treasurer", "expenses-with-receipts"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["treasurer", "matchday-expenses-summary"],
    });
  };

  const approveMutation = useMutation({
    mutationFn: (expenseId: string) =>
      callApi(
        api.POST("/api/matchday/expenses/{expenseId}/approve", {
          params: { path: { expenseId } },
        }),
      ),
    onSuccess: () => {
      setSelectedExpense(null);
      invalidateExpenses();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      expenseId,
      reason,
    }: {
      expenseId: string;
      reason: string;
    }) =>
      callApi(
        api.POST("/api/matchday/expenses/{expenseId}/reject", {
          params: { path: { expenseId } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      setSelectedExpense(null);
      setRejectingId(null);
      setRejectReason("");
      invalidateExpenses();
    },
  });

  const reimburseMutation = useMutation({
    mutationFn: (expenseId: string) =>
      callApi(
        api.POST("/api/matchday/expenses/{expenseId}/reimburse", {
          params: { path: { expenseId } },
        }),
      ),
    onSuccess: () => {
      setSelectedExpense(null);
      invalidateExpenses();
    },
  });

  const anyActionPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    reimburseMutation.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Matchday Expenses
            {expensesSummaryQuery.data
              ? ` (${formatPence(expensesSummaryQuery.data.grandTotal)} total)`
              : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {expensesDetailQuery.isLoading ? (
            <p className="py-8 text-center text-stone-500">Loading…</p>
          ) : !expensesDetailQuery.data ||
            expensesDetailQuery.data.expenses.length === 0 ? (
            <p className="py-8 text-center text-stone-500">
              No expenses for this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Match Date</TableHead>
                  <TableHead>Opposition</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expensesDetailQuery.data.expenses.map((expense) => {
                  const sc = STATUS_CONFIG[expense.status] ?? {
                    label: expense.status,
                    variant: "secondary" as const,
                  };
                  return (
                    <TableRow key={expense.id}>
                      <TableCell>{formatDate(expense.match_date)}</TableCell>
                      <TableCell>{expense.opposition}</TableCell>
                      <TableCell>
                        {EXPENSE_TYPE_LABELS[expense.expense_type] ??
                          expense.expense_type}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPence(expense.amount_pence)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sc.variant}>{sc.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedExpense(expense)}
                        >
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selectedExpense !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedExpense(null);
            setRejectingId(null);
            setRejectReason("");
          }
        }}
      >
        {selectedExpense && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Expense Detail</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="font-medium text-stone-500">Match</dt>
                <dd>
                  {selectedExpense.opposition} (
                  {formatDate(selectedExpense.match_date)})
                </dd>
                <dt className="font-medium text-stone-500">Type</dt>
                <dd>
                  {EXPENSE_TYPE_LABELS[selectedExpense.expense_type] ??
                    selectedExpense.expense_type}
                </dd>
                <dt className="font-medium text-stone-500">Description</dt>
                <dd>{selectedExpense.description ?? "-"}</dd>
                <dt className="font-medium text-stone-500">Amount</dt>
                <dd className="font-semibold">
                  {formatPence(selectedExpense.amount_pence)}
                </dd>
                <dt className="font-medium text-stone-500">Submitted by</dt>
                <dd>{selectedExpense.submitted_by_name}</dd>
                <dt className="font-medium text-stone-500">Status</dt>
                <dd>
                  <Badge
                    variant={
                      (
                        STATUS_CONFIG[selectedExpense.status] ?? {
                          variant: "secondary",
                        }
                      ).variant
                    }
                  >
                    {
                      (
                        STATUS_CONFIG[selectedExpense.status] ?? {
                          label: selectedExpense.status,
                        }
                      ).label
                    }
                  </Badge>
                </dd>
                {selectedExpense.rejected_reason && (
                  <>
                    <dt className="font-medium text-stone-500">
                      Rejection reason
                    </dt>
                    <dd className="text-red-600">
                      {selectedExpense.rejected_reason}
                    </dd>
                  </>
                )}
              </dl>

              {selectedExpense.receipt_image_url && (
                <div>
                  <p className="mb-1 text-sm font-medium text-stone-500">
                    Receipt
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedExpense.receipt_image_url) {
                        setLightboxUrl(selectedExpense.receipt_image_url);
                      }
                    }}
                    className="cursor-pointer"
                    aria-label="Open receipt full size"
                  >
                    <img
                      src={selectedExpense.receipt_image_url}
                      alt="Receipt"
                      className="max-h-48 rounded border"
                    />
                  </button>
                </div>
              )}

              <div className="flex gap-2 border-t pt-4">
                {selectedExpense.status === "submitted" && (
                  <>
                    <Button
                      size="sm"
                      disabled={anyActionPending}
                      onClick={() => approveMutation.mutate(selectedExpense.id)}
                    >
                      Approve
                    </Button>
                    {rejectingId === selectedExpense.id ? (
                      <div className="flex flex-1 gap-2">
                        <Input
                          placeholder="Reason for rejection"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            anyActionPending || rejectReason.trim() === ""
                          }
                          onClick={() =>
                            rejectMutation.mutate({
                              expenseId: selectedExpense.id,
                              reason: rejectReason.trim(),
                            })
                          }
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={anyActionPending}
                        onClick={() => setRejectingId(selectedExpense.id)}
                      >
                        Reject
                      </Button>
                    )}
                  </>
                )}
                {selectedExpense.status === "approved" && (
                  <Button
                    size="sm"
                    disabled={anyActionPending}
                    onClick={() => reimburseMutation.mutate(selectedExpense.id)}
                  >
                    Mark Reimbursed
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Receipt full size"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
              setLightboxUrl(null);
            }
          }}
        >
          <img
            src={lightboxUrl}
            alt="Receipt"
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
