import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatDate, formatPence } from "./status-pill";

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  umpire_fee: "Umpire Fee",
  scorer_fee: "Scorer Fee",
  match_ball: "Match Ball",
  teas: "Teas",
  miscellaneous: "Miscellaneous",
};

type ChargeStatus = "paid" | "pending" | "unpaid" | "abandoned" | "deleted";

function formatMatchDate(dateStr: string): string {
  const d = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  return d.toLocaleDateString("en-GB", options);
}

export function GameReportsTab() {
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState<string | null>(
    null,
  );

  const teamsQuery = useQuery({
    queryKey: ["admin", "playCricketTeams"],
    queryFn: () => callApi(api.GET("/api/admin/play-cricket-teams")),
  });

  const matchdaysQuery = useQuery({
    queryKey: ["admin", "gameReports", teamFilter],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/game-reports", {
          params: {
            query: {
              limit: 50,
              ...(teamFilter !== "all" ? { teamId: teamFilter } : {}),
            },
          },
        }),
      ),
  });

  const teams = teamsQuery.data ?? [];
  const matchdays = matchdaysQuery.data?.matchdays ?? [];

  if (selectedMatchdayId) {
    return (
      <MatchdayReport
        matchdayId={selectedMatchdayId}
        onBack={() => setSelectedMatchdayId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Game Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">
              Filter by Team
            </label>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {matchdaysQuery.isLoading ? (
            <p className="text-sm text-stone-500">Loading…</p>
          ) : matchdays.length === 0 ? (
            <p className="text-sm text-stone-500">No matchdays found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Opposition</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchdays.map((matchday) => (
                  <TableRow key={matchday.id}>
                    <TableCell>{formatDate(matchday.match_date)}</TableCell>
                    <TableCell>{matchday.team_name ?? "Unknown"}</TableCell>
                    <TableCell>{matchday.opposition}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          matchday.status === "pending"
                            ? "bg-yellow-100 text-yellow-800"
                            : matchday.status === "confirmed"
                              ? "bg-green-100 text-green-800"
                              : "bg-stone-100 text-stone-800"
                        }`}
                      >
                        {matchday.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedMatchdayId(matchday.id)}
                      >
                        View Report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChargeStatusBadge({
  status,
  paymentMethod,
}: {
  status: ChargeStatus | null;
  paymentMethod: string | null;
}) {
  switch (status) {
    case "paid":
      return (
        <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
          Paid
          {paymentMethod && (
            <span className="ml-1 text-green-600">({paymentMethod})</span>
          )}
        </span>
      );
    case "pending":
      return (
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
          Pending
        </span>
      );
    case "unpaid":
      return (
        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800">
          Outstanding
        </span>
      );
    case "abandoned":
      return <span className="text-xs text-stone-400">Abandoned</span>;
    case "deleted":
      return <span className="text-xs text-stone-400">Deleted</span>;
    default:
      return <span className="text-xs text-stone-400">-</span>;
  }
}

function MatchdayReport({
  matchdayId,
  onBack,
}: {
  matchdayId: string;
  onBack: () => void;
}) {
  const reportQuery = useQuery({
    queryKey: ["admin", "matchdayReport", matchdayId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/game-reports/{matchdayId}", {
          params: { path: { matchdayId } },
        }),
      ),
  });

  const data = reportQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        {reportQuery.isLoading ? (
          <p className="text-stone-500">Loading report…</p>
        ) : data ? (
          <div>
            <h3 className="text-lg font-semibold">
              {data.team?.name} vs {data.matchday.opposition}
            </h3>
            <p className="text-sm text-stone-500">
              {formatMatchDate(data.matchday.match_date)}
              {data.matchday.competition_type && (
                <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">
                  {data.matchday.competition_type}
                </span>
              )}
            </p>
          </div>
        ) : null}
      </div>

      {reportQuery.isError && (
        <p className="text-red-600">Failed to load report.</p>
      )}

      {data && (
        <>
          {/* Financial Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Financial Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded border border-stone-200 p-3">
                  <p className="text-sm text-stone-500">Match Fee Income</p>
                  <p className="text-lg font-semibold">
                    {formatPence(data.summary.totalIncoming)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    <span className="text-green-600">
                      Paid: {formatPence(data.summary.totalPaid)}
                    </span>
                    {data.summary.totalPending > 0 && (
                      <span className="text-blue-600">
                        Pending: {formatPence(data.summary.totalPending)}
                      </span>
                    )}
                    <span className="text-yellow-600">
                      Outstanding: {formatPence(data.summary.totalOutstanding)}
                    </span>
                  </div>
                </div>
                {data.summary.sponsorshipIncome > 0 && (
                  <div className="rounded border border-stone-200 p-3">
                    <p className="text-sm text-stone-500">Sponsorship Income</p>
                    <p className="text-lg font-semibold">
                      {formatPence(data.summary.sponsorshipIncome)}
                    </p>
                    {data.sponsorship && (
                      <p className="mt-1 text-xs text-stone-500">
                        {data.sponsorship.sponsor_name}
                      </p>
                    )}
                  </div>
                )}
                <div className="rounded border border-stone-200 p-3">
                  <p className="text-sm text-stone-500">Total Expenses</p>
                  <p className="text-lg font-semibold">
                    {formatPence(data.summary.totalExpenses)}
                  </p>
                </div>
                <div
                  className={`rounded border p-3 ${
                    data.summary.profitLoss >= 0
                      ? "border-green-200 bg-green-50"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <p className="text-sm text-stone-500">
                    {data.summary.profitLoss >= 0 ? "Profit" : "Loss"}
                  </p>
                  <p
                    className={`text-lg font-semibold ${
                      data.summary.profitLoss >= 0
                        ? "text-green-700"
                        : "text-red-700"
                    }`}
                  >
                    {formatPence(Math.abs(data.summary.profitLoss))}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Players */}
          <Card>
            <CardHeader>
              <CardTitle>Players</CardTitle>
            </CardHeader>
            <CardContent>
              {data.players.length === 0 ? (
                <p className="text-sm text-stone-500">No players recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Match Fee</TableHead>
                      <TableHead>Payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.players.map((player) => (
                      <TableRow key={player.id}>
                        <TableCell className="font-medium">
                          {player.player_name}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              player.status === "playing"
                                ? "bg-green-100 text-green-800"
                                : player.status === "dropped_out"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : player.status === "no_show"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-stone-100 text-stone-700"
                            }`}
                          >
                            {player.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-stone-500 capitalize">
                          {player.member_category ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {player.charge_amount_pence != null &&
                          player.charge_status !== "deleted" &&
                          player.charge_status !== "abandoned"
                            ? formatPence(player.charge_amount_pence)
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <ChargeStatusBadge
                            status={player.charge_status}
                            paymentMethod={player.charge_payment_method}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Expenses */}
          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              {data.expenses.length === 0 ? (
                <p className="text-sm text-stone-500">No expenses recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.expenses.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell>
                          {EXPENSE_TYPE_LABELS[expense.expense_type] ??
                            expense.expense_type}
                        </TableCell>
                        <TableCell className="text-stone-500">
                          {expense.description ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPence(expense.amount_pence)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell colSpan={2}>Total</TableCell>
                      <TableCell className="text-right">
                        {formatPence(data.summary.totalExpenses)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
