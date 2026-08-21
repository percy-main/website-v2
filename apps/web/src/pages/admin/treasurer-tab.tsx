import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAuthedQuery } from "@/lib/authed-query.js";
import { Suspense, lazy, useState } from "react";
import { formatPence } from "./status-pill";
import { TreasurerExpensesSection } from "./treasurer-expenses-section";
import { TreasurerOutstandingSection } from "./treasurer-outstanding-section";

const TreasurerIncomeChart = lazy(() => import("./treasurer-income-chart.js"));

// --- Types ---

type SponsorshipSummaryResponse =
  paths["/api/treasurer/sponsorship-summary"]["get"]["responses"]["200"]["content"]["application/json"];

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

// --- Component ---

// eslint-disable-next-line react-doctor/no-giant-component -- treasurer dashboard: date range picker + 4 income/sponsor/expense queries + chart + summary tiles share dateFrom/dateTo via prop drilling that a split would only formalise. Sub-sections (chart, expenses, outstanding) already live in sibling files.
export function TreasurerTab() {
  const defaults = getFinancialYearDefaults();
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);

  // --- Queries ---

  const { data: income } = useAuthedQuery({
    queryKey: ["treasurer", "income-by-month", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/income-by-month", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
  });

  const { data: membership, isLoading: isMembershipLoading } = useAuthedQuery({
    queryKey: ["treasurer", "membership-summary"],
    queryFn: () => callApi(api.GET("/api/treasurer/membership-summary")),
  });

  // Page 1 fetched here purely so the summary card can show the count;
  // TreasurerOutstandingSection runs the same query with its own page
  // state (TanStack dedupes the page-1 hit).
  const { data: outstanding } = useAuthedQuery({
    queryKey: ["treasurer", "outstanding-payments", 1],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/outstanding-payments", {
          params: {
            query: {
              page: 1,
              pageSize: PAGE_SIZE,
            },
          },
        }),
      ),
  });

  const { data: sponsorship, isLoading: isSponsorshipLoading } = useAuthedQuery(
    {
      queryKey: ["treasurer", "sponsorship-summary", dateFrom, dateTo],
      queryFn: () =>
        callApi(
          api.GET("/api/treasurer/sponsorship-summary", {
            params: { query: { dateFrom, dateTo } },
          }),
        ),
    },
  );

  const { data: expensesSummary } = useAuthedQuery({
    queryKey: ["treasurer", "matchday-expenses-summary", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/matchday-expenses-summary", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
  });

  // --- Derived data ---

  const totalChargesIncome = income
    ? income.charges.reduce((sum, c) => sum + c.total_pence, 0)
    : 0;

  const totalSponsorIncome = income
    ? income.gameSponsorIncome.reduce((sum, s) => sum + s.total_pence, 0) +
      income.playerSponsorIncome.reduce((sum, s) => sum + s.total_pence, 0)
    : 0;

  const totalIncome = totalChargesIncome + totalSponsorIncome;

  const membershipIncome = income
    ? income.charges
        .filter((c) => c.type === "membership")
        .reduce((sum, c) => sum + c.total_pence, 0)
    : 0;

  const outstandingTotal = outstanding?.total ?? 0;

  const expensesGrandTotal = expensesSummary?.grandTotal ?? 0;

  // --- Chart data ---

  const chartData = (() => {
    if (!income) return [];

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

    for (const charge of income.charges) {
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

    for (const s of income.gameSponsorIncome) {
      const entry = getEntry(s.month);
      entry.Sponsorship += s.total_pence / 100;
    }

    for (const s of income.playerSponsorIncome) {
      const entry = getEntry(s.month);
      entry.Sponsorship += s.total_pence / 100;
    }

    return Array.from(monthMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
  })();

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
        <label
          className="flex items-center gap-1.5 text-sm"
          htmlFor="treasurer-date-from"
        >
          From
          <Input
            id="treasurer-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </label>
        <label
          className="flex items-center gap-1.5 text-sm"
          htmlFor="treasurer-date-to"
        >
          To
          <Input
            id="treasurer-date-to"
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
            {isMembershipLoading ? (
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
                  {membership?.memberships.map((m) => (
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
                  {membership && (
                    <TableRow className="font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success">
                          {membership.memberships.reduce(
                            (sum, m) => sum + m.active,
                            0,
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            membership.memberships.reduce(
                              (sum, m) => sum + m.lapsed,
                              0,
                            ) > 0
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {membership.memberships.reduce(
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
            {isSponsorshipLoading ? (
              <p className="py-8 text-center text-stone-500">Loading…</p>
            ) : sponsorship ? (
              <SponsorshipTable data={sponsorship} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Matchday Expenses (table + detail modal + receipt lightbox) */}
      <TreasurerExpensesSection dateFrom={dateFrom} dateTo={dateTo} />

      {/* Outstanding Payments (paginated table + per-row chase action) */}
      <TreasurerOutstandingSection />
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
