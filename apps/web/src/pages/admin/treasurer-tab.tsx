import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatPence } from "./status-pill";

// --- Types ---

interface IncomeByMonthResponse {
  charges: Array<{ month: string; type: string; total_pence: number }>;
  gameSponsorIncome: Array<{ month: string; total_pence: number }>;
  playerSponsorIncome: Array<{ month: string; total_pence: number }>;
}

interface MembershipSummaryResponse {
  memberships: Array<{
    type: string;
    total: number;
    active: number;
    lapsed: number;
  }>;
}

interface OutstandingPaymentsResponse {
  items: Array<{
    id: string;
    type: string;
    amount_pence: number;
    charge_date: string;
    description: string;
    member_name: string;
    member_email: string;
    user_id?: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

interface SponsorshipSummaryResponse {
  gameSponsorship: {
    total: number;
    approved_paid: number;
    pending_payment: number;
    pending_approval: number;
    total_amount_pence: number;
  };
  playerSponsorship: {
    total: number;
    approved_paid: number;
    pending_payment: number;
    pending_approval: number;
    total_amount_pence: number;
  };
}

interface MatchdayExpensesSummaryResponse {
  breakdown: Array<{
    expense_type: string;
    count: number;
    total_pence: number;
  }>;
  grandTotal: number;
}

interface Expense {
  id: string;
  date: string;
  match_description: string;
  expense_type: string;
  description: string;
  amount_pence: number;
  receipt_image_url: string | null;
}

interface ExpensesWithReceiptsResponse {
  expenses: Expense[];
}

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
  const [expensesView, setExpensesView] = useState<"summary" | "detail">(
    "summary",
  );
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [chasingId, setChasingId] = useState<string | null>(null);

  const dateParams = `dateFrom=${dateFrom}&dateTo=${dateTo}`;

  // --- Queries ---

  const incomeQuery = useQuery({
    queryKey: ["treasurer", "income-by-month", dateFrom, dateTo],
    queryFn: () =>
      api.get<IncomeByMonthResponse>(
        `/treasurer/income-by-month?${dateParams}`,
      ),
  });

  const membershipQuery = useQuery({
    queryKey: ["treasurer", "membership-summary"],
    queryFn: () =>
      api.get<MembershipSummaryResponse>(`/treasurer/membership-summary`),
  });

  const outstandingQuery = useQuery({
    queryKey: ["treasurer", "outstanding-payments", outstandingPage],
    queryFn: () =>
      api.get<OutstandingPaymentsResponse>(
        `/treasurer/outstanding-payments?page=${outstandingPage}&pageSize=${PAGE_SIZE}`,
      ),
  });

  const sponsorshipQuery = useQuery({
    queryKey: ["treasurer", "sponsorship-summary", dateFrom, dateTo],
    queryFn: () =>
      api.get<SponsorshipSummaryResponse>(
        `/treasurer/sponsorship-summary?${dateParams}`,
      ),
  });

  const expensesSummaryQuery = useQuery({
    queryKey: ["treasurer", "matchday-expenses-summary", dateFrom, dateTo],
    queryFn: () =>
      api.get<MatchdayExpensesSummaryResponse>(
        `/treasurer/matchday-expenses-summary?${dateParams}`,
      ),
  });

  const expensesDetailQuery = useQuery({
    queryKey: ["treasurer", "expenses-with-receipts", dateFrom, dateTo],
    queryFn: () =>
      api.get<ExpensesWithReceiptsResponse>(
        `/treasurer/expenses-with-receipts?${dateParams}`,
      ),
    enabled: expensesView === "detail",
  });

  const chaseMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post("/admin/charge-notification", { userId }),
    onSuccess: () => {
      setChasingId(null);
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
        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPence(totalIncome)}</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {outstandingTotal} payment{outstandingTotal !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Membership
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatPence(membershipIncome)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Sponsorship
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatPence(totalSponsorIncome)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
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
            <p className="py-12 text-center text-gray-500">
              No income data for this period.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip
                  formatter={(value) =>
                    new Intl.NumberFormat("en-GB", {
                      style: "currency",
                      currency: "GBP",
                    }).format(Number(value))
                  }
                />
                <Legend />
                <Bar
                  dataKey="Membership"
                  stackId="a"
                  fill="#2563eb"
                  name="Membership"
                />
                <Bar
                  dataKey="Sponsorship"
                  stackId="a"
                  fill="#16a34a"
                  name="Sponsorship"
                />
                <Bar
                  dataKey="Donation"
                  stackId="a"
                  fill="#f59e0b"
                  name="Donation"
                />
                <Bar
                  dataKey="Manual"
                  stackId="a"
                  fill="#8b5cf6"
                  name="Manual"
                />
                <Bar dataKey="Other" stackId="a" fill="#6b7280" name="Other" />
              </BarChart>
            </ResponsiveContainer>
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
              <p className="py-8 text-center text-gray-500">Loading...</p>
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
                    <TableRow key={m.type}>
                      <TableCell>
                        {MEMBERSHIP_TYPE_LABELS[m.type] ?? m.type}
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
              <p className="py-8 text-center text-gray-500">Loading...</p>
            ) : sponsorshipQuery.data ? (
              <SponsorshipTable data={sponsorshipQuery.data} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Matchday Expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            Matchday Expenses
            {expensesSummaryQuery.data
              ? ` (${formatPence(expensesSummaryQuery.data.grandTotal)} total)`
              : ""}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setExpensesView((v) => (v === "summary" ? "detail" : "summary"))
            }
          >
            {expensesView === "summary" ? "Detail" : "Summary"}
          </Button>
        </CardHeader>
        <CardContent>
          {expensesView === "summary" ? (
            <ExpensesSummaryTable data={expensesSummaryQuery.data} />
          ) : (
            <ExpensesDetailTable
              data={expensesDetailQuery.data}
              isLoading={expensesDetailQuery.isLoading}
              onViewReceipt={setLightboxUrl}
            />
          )}
        </CardContent>
      </Card>

      {/* Outstanding Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Outstanding Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {outstandingQuery.isLoading ? (
            <p className="py-8 text-center text-gray-500">Loading...</p>
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
                        <div className="text-xs text-gray-500">
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
                              disabled={chaseMutation.isPending}
                              onClick={() =>
                                chaseMutation.mutate(item.user_id ?? item.id)
                              }
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
                      className="py-12 text-center text-gray-500"
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
            <span className="text-sm text-gray-600">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setLightboxUrl(null)}
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

function ExpensesSummaryTable({
  data,
}: {
  data: MatchdayExpensesSummaryResponse | undefined;
}) {
  if (!data) {
    return <p className="py-8 text-center text-gray-500">Loading...</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Expense Type</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.breakdown.map((row) => (
          <TableRow key={row.expense_type}>
            <TableCell>
              {EXPENSE_TYPE_LABELS[row.expense_type] ?? row.expense_type}
            </TableCell>
            <TableCell className="text-right">
              {formatPence(row.total_pence)}
            </TableCell>
            <TableCell className="text-right">{row.count}</TableCell>
          </TableRow>
        ))}
        {data.breakdown.length === 0 && (
          <TableRow>
            <TableCell colSpan={3} className="py-8 text-center text-gray-500">
              No expenses for this period.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function ExpensesDetailTable({
  data,
  isLoading,
  onViewReceipt,
}: {
  data: ExpensesWithReceiptsResponse | undefined;
  isLoading: boolean;
  onViewReceipt: (url: string) => void;
}) {
  if (isLoading) {
    return <p className="py-8 text-center text-gray-500">Loading...</p>;
  }

  if (!data || data.expenses.length === 0) {
    return (
      <p className="py-8 text-center text-gray-500">
        No expenses for this period.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Match</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Receipt</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.expenses.map((expense) => (
          <TableRow key={expense.id}>
            <TableCell>{formatDate(expense.date)}</TableCell>
            <TableCell>{expense.match_description}</TableCell>
            <TableCell>
              {EXPENSE_TYPE_LABELS[expense.expense_type] ??
                expense.expense_type}
            </TableCell>
            <TableCell>{expense.description}</TableCell>
            <TableCell className="text-right">
              {formatPence(expense.amount_pence)}
            </TableCell>
            <TableCell>
              {expense.receipt_image_url ? (
                <Button
                  variant="link"
                  size="sm"
                  className="text-blue-600"
                  onClick={() => {
                    if (expense.receipt_image_url) {
                      onViewReceipt(expense.receipt_image_url);
                    }
                  }}
                >
                  View
                </Button>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
