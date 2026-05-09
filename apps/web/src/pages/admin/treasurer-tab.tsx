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
import { useQuery } from "@tanstack/react-query";
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

  // Page 1 fetched here purely so the summary card can show the count;
  // TreasurerOutstandingSection runs the same query with its own page
  // state (TanStack dedupes the page-1 hit).
  const outstandingQuery = useQuery({
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

  // --- Derived data ---

  const totalChargesIncome = incomeQuery.data
    ? incomeQuery.data.charges.reduce((sum, c) => sum + c.total_pence, 0)
    : 0;

  const totalSponsorIncome = incomeQuery.data
    ? incomeQuery.data.gameSponsorIncome.reduce(
        (sum, s) => sum + s.total_pence,
        0,
      ) +
      incomeQuery.data.playerSponsorIncome.reduce(
        (sum, s) => sum + s.total_pence,
        0,
      )
    : 0;

  const totalIncome = totalChargesIncome + totalSponsorIncome;

  const membershipIncome = incomeQuery.data
    ? incomeQuery.data.charges
        .filter((c) => c.type === "membership")
        .reduce((sum, c) => sum + c.total_pence, 0)
    : 0;

  const outstandingTotal = outstandingQuery.data?.total ?? 0;

  const expensesGrandTotal = expensesSummaryQuery.data?.grandTotal ?? 0;

  // --- Chart data ---

  const chartData = (() => {
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
