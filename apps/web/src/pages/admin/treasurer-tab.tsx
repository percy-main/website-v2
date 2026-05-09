import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Suspense, lazy, useMemo, useState } from "react";
import { formatDate, formatPence } from "./status-pill";

const TreasurerIncomeChart = lazy(() => import("./treasurer-income-chart.js"));

// --- Types ---

type SponsorshipSummaryResponse =
  paths["/api/treasurer/sponsorship-summary"]["get"]["responses"]["200"]["content"]["application/json"];

type ExpensesWithReceiptsResponse =
  paths["/api/treasurer/expenses-with-receipts"]["get"]["responses"]["200"]["content"]["application/json"];
type Expense = ExpensesWithReceiptsResponse["expenses"][number];

// --- Helpers ---

const PAGE_SIZE = 20;

function getFinancialYearDefaults(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const year = currentMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    dateFrom: `${year}-04-01`,
    dateTo: `${year + 1}-03-31`,
  };
}

const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  senior_player: "Senior Player",
  social: "Social",
  concessionary: "Concessionary",
  senior_women_player: "Women's Player",
  junior: "Junior",
  unknown: "Unknown",
};

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

function daysOverdue(chargeDate: string): number {
  const charge = new Date(chargeDate);
  const now = new Date();
  const diffMs = now.getTime() - charge.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// --- Component ---

export function TreasurerTab() {
  const defaults = getFinancialYearDefaults();
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [outstandingPage, setOutstandingPage] = useState(1);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [chasingId, setChasingId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // --- Queries ---

  const incomeQuery = useQuery({
    queryKey: ["treasurer", "income-by-month", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/income-by-month", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
  });

  const membershipQuery = useQuery({
    queryKey: ["treasurer", "membership-summary"],
    queryFn: () => callApi(api.GET("/api/treasurer/membership-summary")),
  });

  const outstandingQuery = useQuery({
    queryKey: ["treasurer", "outstanding-payments", outstandingPage],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/outstanding-payments", {
          params: {
            query: {
              page: outstandingPage,
              pageSize: PAGE_SIZE,
            },
          },
        }),
      ),
  });

  const sponsorshipQuery = useQuery({
    queryKey: ["treasurer", "sponsorship-summary", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/sponsorship-summary", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
  });

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

  const chaseMutation = useMutation({
    mutationFn: (userId: string) =>
      callApi(
        api.POST("/api/admin/charge-notification", {
          body: { userId },
        }),
      ),
    onSuccess: () => {
      setChasingId(null);
    },
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

  // --- Derived data ---

  const totalChargesIncome = useMemo(() => {
    if (!incomeQuery.data) return 0;
    return incomeQuery.data.charges.reduce((sum, c) => sum + c.total_pence, 0);
  }, [incomeQuery.data]);

  const totalSponsorIncome = useMemo(() => {
    if (!incomeQuery.data) return 0;
    const game = incomeQuery.data.gameSponsorIncome.reduce(
      (sum, s) => sum + s.total_pence,
      0,
    );
    const player = incomeQuery.data.playerSponsorIncome.reduce(
      (sum, s) => sum + s.total_pence,
      0,
    );
    return game + player;
  }, [incomeQuery.data]);

  const totalIncome = totalChargesIncome + totalSponsorIncome;

  const membershipIncome = useMemo(() => {
    if (!incomeQuery.data) return 0;
    return incomeQuery.data.charges
      .filter((c) => c.type === "membership")
      .reduce((sum, c) => sum + c.total_pence, 0);
  }, [incomeQuery.data]);

  const outstandingTotal = outstandingQuery.data?.total ?? 0;

  const expensesGrandTotal = expensesSummaryQuery.data?.grandTotal ?? 0;

  // --- Chart data ---

  const chartData = useMemo(() => {
    if (!incomeQuery.data) return [];

    const monthMap = new Map<
      string,
      {
        month: string;
        Membership: number;
        Sponsorship: number;
        Donation: number;
        Manual: number;
        Other: number;
      }
    >();

    const getEntry = (month: string) => {
      const existing = monthMap.get(month);
      if (existing) return existing;
      const entry = {
        month,
        Membership: 0,
        Sponsorship: 0,
        Donation: 0,
        Manual: 0,
        Other: 0,
      };
      monthMap.set(month, entry);
      return entry;
    };

    for (const charge of incomeQuery.data.charges) {
      const entry = getEntry(charge.month);
      switch (charge.type) {
        case "membership":
          entry.Membership += charge.total_pence / 100;
          break;
        case "sponsorship":
          entry.Sponsorship += charge.total_pence / 100;
          break;
        case "donation":
          entry.Donation += charge.total_pence / 100;
          break;
        case "manual":
          entry.Manual += charge.total_pence / 100;
          break;
        default:
          entry.Other += charge.total_pence / 100;
          break;
      }
    }

    for (const s of incomeQuery.data.gameSponsorIncome) {
      const entry = getEntry(s.month);
      entry.Sponsorship += s.total_pence / 100;
    }

    for (const s of incomeQuery.data.playerSponsorIncome) {
      const entry = getEntry(s.month);
      entry.Sponsorship += s.total_pence / 100;
    }

    return Array.from(monthMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
  }, [incomeQuery.data]);

  // --- Pagination ---

  const outstandingTotalPages = outstandingQuery.data
    ? Math.ceil(outstandingQuery.data.total / PAGE_SIZE)
    : 0;

  // --- Reset handler ---

  const resetDateRange = () => {
    const d = getFinancialYearDefaults();
    setDateFrom(d.dateFrom);
    setDateTo(d.dateTo);
  };

  const anyActionPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    reimburseMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Date Range Selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          From
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          To
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </label>
        <Button variant="ghost" size="sm" onClick={resetDateRange}>
          Reset to current year
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="border-t-2 border-t-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">
              Total Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPence(totalIncome)}</p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {outstandingTotal} payment{outstandingTotal !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">
              Membership
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatPence(membershipIncome)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">
              Sponsorship
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatPence(totalSponsorIncome)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-2 border-t-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">
              Matchday Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatPence(expensesGrandTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Income by Month Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Income by Month</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-12 text-center text-stone-500">
              No income data for this period.
            </p>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-[300px] items-center justify-center text-sm text-stone-500">
                  Loading chart…
                </div>
              }
            >
              <TreasurerIncomeChart data={chartData} />
            </Suspense>
          )}
        </CardContent>
      </Card>

      {/* Membership + Sponsorship side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Membership Status Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Membership Status</CardTitle>
          </CardHeader>
          <CardContent>
            {membershipQuery.isLoading ? (
              <p className="py-8 text-center text-stone-500">Loading…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Lapsed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membershipQuery.data?.memberships.map((m) => (
                    <TableRow key={m.type ?? "unknown"}>
                      <TableCell>
                        {MEMBERSHIP_TYPE_LABELS[m.type ?? "unknown"] ?? m.type}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success">{m.active}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={m.lapsed > 0 ? "warning" : "secondary"}>
                          {m.lapsed}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {membershipQuery.data && (
                    <TableRow className="font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success">
                          {membershipQuery.data.memberships.reduce(
                            (sum, m) => sum + m.active,
                            0,
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            membershipQuery.data.memberships.reduce(
                              (sum, m) => sum + m.lapsed,
                              0,
                            ) > 0
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {membershipQuery.data.memberships.reduce(
                            (sum, m) => sum + m.lapsed,
                            0,
                          )}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Sponsorship Summary Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sponsorship Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {sponsorshipQuery.isLoading ? (
              <p className="py-8 text-center text-stone-500">Loading…</p>
            ) : sponsorshipQuery.data ? (
              <SponsorshipTable data={sponsorshipQuery.data} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Matchday Expenses */}
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

      {/* Expense Detail Modal */}
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

              {/* Actions based on status */}
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

      {/* Outstanding Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Outstanding Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {outstandingQuery.isLoading ? (
            <p className="py-8 text-center text-stone-500">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Days Overdue</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outstandingQuery.data?.items.map((item) => {
                  const days = daysOverdue(item.charge_date);
                  const overdueBadgeVariant =
                    days > 30
                      ? "destructive"
                      : days > 7
                        ? "warning"
                        : "default";

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>{item.member_name}</div>
                        <div className="text-xs text-stone-500">
                          {item.member_email}
                        </div>
                      </TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">
                        {formatPence(item.amount_pence)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={overdueBadgeVariant}>{days}d</Badge>
                      </TableCell>
                      <TableCell>
                        {chasingId === item.id ? (
                          <div className="flex gap-1">
                            <Button
                              variant="default"
                              size="sm"
                              disabled={
                                chaseMutation.isPending || !("user_id" in item)
                              }
                              onClick={() => {
                                const userId = (item as { user_id?: string })
                                  .user_id;
                                if (userId) chaseMutation.mutate(userId);
                              }}
                            >
                              Send
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setChasingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setChasingId(item.id)}
                          >
                            Chase
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {outstandingQuery.data?.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-12 text-center text-stone-500"
                    >
                      No outstanding payments.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {outstandingQuery.data && outstandingQuery.data.total > 0 && (
          <CardFooter className="flex items-center justify-between">
            <span className="text-sm text-stone-600">
              {outstandingQuery.data.total} payment(s) total
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={outstandingPage <= 1}
                onClick={() => setOutstandingPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={outstandingPage >= outstandingTotalPages}
                onClick={() => setOutstandingPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Receipt Lightbox */}
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
    </div>
  );
}

// --- Sub-components ---

function SponsorshipTable({ data }: { data: SponsorshipSummaryResponse }) {
  const gameUnpaid =
    data.gameSponsorship.pending_payment +
    data.gameSponsorship.pending_approval;
  const playerUnpaid =
    data.playerSponsorship.pending_payment +
    data.playerSponsorship.pending_approval;
  const totalRevenue =
    data.gameSponsorship.total_amount_pence +
    data.playerSponsorship.total_amount_pence;
  const totalPaid =
    data.gameSponsorship.approved_paid + data.playerSponsorship.approved_paid;
  const totalUnpaid = gameUnpaid + playerUnpaid;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead className="text-right">Unpaid</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Game Sponsorship</TableCell>
          <TableCell className="text-right">
            {formatPence(data.gameSponsorship.total_amount_pence)}
          </TableCell>
          <TableCell className="text-right">
            <Badge variant="success">
              {data.gameSponsorship.approved_paid}
            </Badge>
          </TableCell>
          <TableCell className="text-right">
            <Badge variant={gameUnpaid > 0 ? "warning" : "secondary"}>
              {gameUnpaid}
            </Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Player Sponsorship</TableCell>
          <TableCell className="text-right">
            {formatPence(data.playerSponsorship.total_amount_pence)}
          </TableCell>
          <TableCell className="text-right">
            <Badge variant="success">
              {data.playerSponsorship.approved_paid}
            </Badge>
          </TableCell>
          <TableCell className="text-right">
            <Badge variant={playerUnpaid > 0 ? "warning" : "secondary"}>
              {playerUnpaid}
            </Badge>
          </TableCell>
        </TableRow>
        <TableRow className="font-bold">
          <TableCell>Total</TableCell>
          <TableCell className="text-right">
            {formatPence(totalRevenue)}
          </TableCell>
          <TableCell className="text-right">
            <Badge variant="success">{totalPaid}</Badge>
          </TableCell>
          <TableCell className="text-right">
            <Badge variant={totalUnpaid > 0 ? "warning" : "secondary"}>
              {totalUnpaid}
            </Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
