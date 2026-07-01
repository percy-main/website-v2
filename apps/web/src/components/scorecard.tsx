import { Kicker } from "@/components/theme/bits.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { isPast } from "date-fns";
import { IoPersonCircleOutline } from "react-icons/io5";
import { Link } from "react-router";

// --- Types ---
// The /api/play-cricket/match/{matchId} endpoint returns `unknown` in the
// generated spec (raw Play Cricket API proxy), so we keep local types for the
// transformed scorecard data.

interface BattingEntry {
  position: string;
  name: string;
  memberSlug: string | null;
  howOut: string | null;
  fielderName: string | null;
  bowlerName: string | null;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  // Women's Softball (Play Cricket "Pairs") only: count of dismissals for
  // this batter in this innings (can be 0, 1, or 2+). Always 0 for hardball.
  timesOut: number;
}

interface BowlingEntry {
  name: string;
  memberSlug: string | null;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  noBalls: number;
}

interface FoWEntry {
  wicketNumber: number;
  runs: number;
  batsmanOutName: string;
}

interface Extras {
  byes: number;
  legByes: number;
  wides: number;
  noBalls: number;
  penalties: number;
  total: number;
}

interface InningsTotal {
  runs: number;
  wickets: number;
  overs: string;
  declared: boolean;
}

interface ScorecardInnings {
  teamBattingName: string;
  inningsNumber: number;
  batting: BattingEntry[];
  bowling: BowlingEntry[];
  fallOfWickets: FoWEntry[];
  extras: Extras;
  total: InningsTotal;
}

// Per-team points entry from Play Cricket — game points + bonus point
// breakdown for the match. Bonus rows are hardball-only; Pairs returns
// game_points alone.
interface PointsEntry {
  teamId: string;
  gamePoints: number;
  bonusPointsBatting: number;
  bonusPointsBowling: number;
  bonusPointsTogether: number;
  penaltyPoints: number;
}

interface MatchDetailData {
  homeTeamName: string;
  homeTeamId: string;
  homeClubName: string;
  homeClubId: string;
  awayTeamName: string;
  awayTeamId: string;
  awayClubName: string;
  awayClubId: string;
  toss: string;
  result: string;
  resultDescription: string;
  resultAppliedTo: string;
  // "Standard" hardball or "Pairs" Women's Softball. Drives Net Score
  // rendering + dismissal-label fallbacks.
  gameType: string;
  // Pairs only: starting score added to runs, penalty subtracted per
  // dismissal. Null for hardball — Net Score is not displayed.
  startingRuns: number | null;
  dismissalPenalty: number | null;
  points: PointsEntry[];
  innings: ScorecardInnings[];
}

function fetchMatchDetail(matchId: string) {
  return callApi(
    api.GET("/api/play-cricket/match/{matchId}", {
      params: { path: { matchId } },
    }),
  );
}

// --- Helpers ---

function formatDismissal(entry: BattingEntry): string {
  const { howOut, fielderName, bowlerName } = entry;
  // Play Cricket leaves how_out null for every batter in a Pairs (Women's
  // Softball) innings — players rotate at their balls limit instead of being
  // dismissed individually. Show "retired not out" to match Play Cricket's
  // own UI label.
  if (howOut === null || howOut === "" || howOut === "rtno") {
    return "retired not out";
  }
  switch (howOut) {
    case "b":
      return `b ${bowlerName}`;
    case "ct":
      return fielderName && fielderName === bowlerName
        ? `c & b ${bowlerName}`
        : `c ${fielderName} b ${bowlerName}`;
    case "lbw":
      return `lbw b ${bowlerName}`;
    case "ro":
      return fielderName ? `run out (${fielderName})` : "run out";
    case "st":
      return `st ${fielderName} b ${bowlerName}`;
    case "hw":
      return `hit wicket b ${bowlerName}`;
    case "no":
      return "not out";
    case "rtd":
      return "retired";
    case "dnb":
      return "did not bat";
    default:
      return howOut;
  }
}

function formatExtrasBreakdown(extras: Extras): string {
  const parts: string[] = [];
  if (extras.byes) parts.push(`b ${extras.byes}`);
  if (extras.legByes) parts.push(`lb ${extras.legByes}`);
  if (extras.wides) parts.push(`w ${extras.wides}`);
  if (extras.noBalls) parts.push(`nb ${extras.noBalls}`);
  if (extras.penalties) parts.push(`pen ${extras.penalties}`);
  return parts.join(", ");
}

function formatTotalScore(total: InningsTotal): string {
  const wicketsPart = total.wickets >= 10 ? "" : `/${total.wickets}`;
  const declaredPart = total.declared ? " dec" : "";
  const oversPart = total.overs ? ` (${total.overs} ov)` : "";
  return `${total.runs}${wicketsPart}${declaredPart}${oversPart}`;
}

function oversToDecimal(overs: string): number {
  const parts = overs.split(".");
  const completedOvers = parseInt(parts[0], 10) || 0;
  const balls = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
  return completedOvers + balls / 6;
}

// --- Transform API response to display types ---

function transformMatchDetail(
  raw: Record<string, unknown>,
): MatchDetailData | null {
  const details = raw.match_details as
    Array<Record<string, unknown>> | undefined;
  if (!details || details.length === 0) return null;

  const d = details[0];
  const rawInnings = d.innings as Array<Record<string, unknown>> | undefined;
  if (!rawInnings || rawInnings.length === 0) return null;

  // Check there's actual scorecard data
  const hasData = rawInnings.some((inn) => {
    const bat = inn.bat as unknown[];
    return bat && bat.length > 0;
  });
  if (!hasData) return null;

  const innings: ScorecardInnings[] = rawInnings.map((inn, idx) => {
    const bat = (inn.bat as Array<Record<string, string>>) ?? [];
    const bowl = (inn.bowl as Array<Record<string, string>>) ?? [];
    const fow = (inn.fow as Array<Record<string, unknown>>) ?? [];

    // Drop empty Pairs ghost rows but keep explicit "dnb" rows so the
    // "Did not bat" section below can still render them. In Pairs every
    // batter has a null how_out, so we can't tell DNB from "took strike"
    // by how_out alone - fall back to the quantitative fields. Hardball
    // DNB rows arrive with how_out = "dnb" and pass through untouched.
    const battingRaw = bat.filter((b) => {
      const code = (b.how_out ?? "").toLowerCase().trim();
      if (code !== "") return true;
      const runs = parseInt(b.runs);
      const balls = parseInt(b.balls);
      const timesOut = parseInt(b.times_out ?? "");
      return (
        (Number.isFinite(runs) && runs !== 0) ||
        (Number.isFinite(balls) && balls > 0) ||
        (Number.isFinite(timesOut) && timesOut > 0)
      );
    });
    const batting: BattingEntry[] = battingRaw.map((b) => ({
      position: b.position,
      name: b.batsman_name,
      memberSlug: b.batsman_member_slug ?? null,
      howOut: b.how_out ?? null,
      fielderName: b.fielder_name ?? null,
      bowlerName: b.bowler_name ?? null,
      runs: parseInt(b.runs) || 0,
      balls: parseInt(b.balls) || 0,
      fours: parseInt(b.fours) || 0,
      sixes: parseInt(b.sixes) || 0,
      timesOut: parseInt(b.times_out ?? "") || 0,
    }));

    const bowling: BowlingEntry[] = bowl.map((b) => ({
      name: b.bowler_name,
      memberSlug: b.bowler_member_slug ?? null,
      overs: b.overs,
      maidens: parseInt(b.maidens) || 0,
      runs: parseInt(b.runs) || 0,
      wickets: parseInt(b.wickets) || 0,
      wides: parseInt(b.wides) || 0,
      noBalls: parseInt(b.no_balls) || 0,
    }));

    const fallOfWickets: FoWEntry[] = fow.map((f) => ({
      wicketNumber: (f as Record<string, number>).wickets,
      runs: parseInt((f as Record<string, string>).runs) || 0,
      batsmanOutName: (f as Record<string, string>).batsman_out_name ?? "",
    }));

    const runs = parseInt(inn.runs as string) || 0;
    const wickets = parseInt(inn.wickets as string) || 0;

    return {
      teamBattingName: inn.team_batting_name as string,
      inningsNumber: idx + 1,
      batting,
      bowling,
      fallOfWickets,
      extras: {
        byes: parseInt(inn.extra_byes as string) || 0,
        legByes: parseInt(inn.extra_leg_byes as string) || 0,
        wides: parseInt(inn.extra_wides as string) || 0,
        noBalls: parseInt(inn.extra_no_balls as string) || 0,
        penalties: parseInt(inn.extra_penalty_runs as string) || 0,
        total: parseInt(inn.total_extras as string) || 0,
      },
      total: {
        runs,
        wickets,
        overs: (inn.overs as string) ?? "",
        declared: (inn.declared as boolean) ?? false,
      },
    };
  });

  // Play Cricket emits points as { team_id: number, game_points: string, ... }
  // for both hardball and softball. Bonus rows are populated for hardball only.
  const rawPoints =
    (d.points as
      | Array<{
          team_id?: number | string;
          game_points?: string;
          bonus_points_batting?: string;
          bonus_points_bowling?: string;
          bonus_points_together?: string;
          penalty_points?: string;
        }>
      | undefined) ?? [];
  const points: PointsEntry[] = rawPoints.map((p) => ({
    teamId: p.team_id === undefined ? "" : String(p.team_id),
    gamePoints: parseInt(p.game_points ?? "") || 0,
    bonusPointsBatting: parseFloat(p.bonus_points_batting ?? "") || 0,
    bonusPointsBowling: parseFloat(p.bonus_points_bowling ?? "") || 0,
    bonusPointsTogether: parseFloat(p.bonus_points_together ?? "") || 0,
    penaltyPoints: parseFloat(p.penalty_points ?? "") || 0,
  }));

  const startingRunsRaw = parseInt((d.starting_runs as string) ?? "");
  const dismissalPenaltyRaw = parseInt((d.dismissal_penalty as string) ?? "");

  return {
    homeTeamName: d.home_team_name as string,
    homeTeamId: d.home_team_id as string,
    homeClubName: d.home_club_name as string,
    homeClubId: (d.home_club_id as string) ?? "",
    awayTeamName: d.away_team_name as string,
    awayTeamId: d.away_team_id as string,
    awayClubName: d.away_club_name as string,
    awayClubId: (d.away_club_id as string) ?? "",
    toss: (d.toss as string) ?? "",
    result: (d.result as string) ?? "",
    resultDescription: (d.result_description as string) ?? "",
    resultAppliedTo: (d.result_applied_to as string) ?? "",
    gameType: (d.game_type as string) ?? "Standard",
    startingRuns: Number.isFinite(startingRunsRaw) ? startingRunsRaw : null,
    dismissalPenalty: Number.isFinite(dismissalPenaltyRaw)
      ? dismissalPenaltyRaw
      : null,
    points,
    innings,
  };
}

function netScore(
  total: InningsTotal,
  startingRuns: number,
  dismissalPenalty: number,
): number {
  return startingRuns + total.runs - total.wickets * dismissalPenalty;
}

// --- Sub-components ---

function PlayerName({
  name,
  slug,
  className,
}: {
  name: string;
  slug: string | null;
  className?: string;
}) {
  if (!slug) return <span className={className}>{name}</span>;
  return (
    <Link
      to={`/person/${slug}`}
      className={`${className ?? ""} text-primary decoration-cta/70 hover:text-cta inline-flex items-center gap-0.5 underline underline-offset-2`}
      title="View player profile"
    >
      {name}
      <IoPersonCircleOutline
        className="shrink-0"
        size={14}
        aria-hidden="true"
      />
    </Link>
  );
}

function BattingCard({
  batting,
  extras,
  total,
  isPairs,
}: {
  batting: BattingEntry[];
  extras: Extras;
  total: InningsTotal;
  isPairs: boolean;
}) {
  const activeBatters = batting.filter((b) => b.howOut !== "dnb");
  const didNotBat = batting.filter((b) => b.howOut === "dnb");
  // Pairs swaps the SR column for "TO" (times out) — softball batters don't
  // get individual dismissal codes, so SR adds less than a per-batter
  // dismissal count.
  const totalColSpan = isPairs ? 5 : 5;

  return (
    <div className="fc-stat">
      <Table>
        <caption className="sr-only">Batting scorecard</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-full">
              Batter
            </TableHead>
            <TableHead scope="col" className="text-right">
              R
            </TableHead>
            <TableHead scope="col" className="text-right">
              B
            </TableHead>
            <TableHead scope="col" className="text-right">
              4s
            </TableHead>
            <TableHead scope="col" className="text-right">
              6s
            </TableHead>
            <TableHead scope="col" className="text-right">
              {isPairs ? "TO" : "SR"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeBatters.map((b) => (
            <TableRow key={b.position}>
              <TableCell>
                <div>
                  <PlayerName
                    name={b.name}
                    slug={b.memberSlug}
                    className="font-medium"
                  />
                  <div className="text-muted text-xs">{formatDismissal(b)}</div>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {b.runs}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {b.balls || "-"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {b.fours}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {b.sixes}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {isPairs
                  ? b.timesOut
                  : b.balls > 0
                    ? ((b.runs / b.balls) * 100).toFixed(1)
                    : "-"}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <span className="text-muted text-sm">
                Extras ({formatExtrasBreakdown(extras)})
              </span>
            </TableCell>
            <TableCell className="text-right font-mono font-semibold tabular-nums">
              {extras.total}
            </TableCell>
            <TableCell colSpan={4} />
          </TableRow>
          <TableRow className="border-t-2 font-bold">
            <TableCell>Total</TableCell>
            <TableCell
              className="text-right font-mono tabular-nums"
              colSpan={totalColSpan}
            >
              {formatTotalScore(total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {didNotBat.length > 0 && (
        <p className="text-muted mt-2 text-xs">
          <strong>Did not bat:</strong>{" "}
          {didNotBat.map((b, i) => (
            <span key={b.position}>
              {i > 0 && ", "}
              <PlayerName name={b.name} slug={b.memberSlug} />
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function BowlingCard({ bowling }: { bowling: BowlingEntry[] }) {
  return (
    <div className="fc-stat">
      <Table>
        <caption className="sr-only">Bowling scorecard</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-full">
              Bowler
            </TableHead>
            <TableHead scope="col" className="text-right">
              O
            </TableHead>
            <TableHead scope="col" className="text-right">
              M
            </TableHead>
            <TableHead scope="col" className="text-right">
              R
            </TableHead>
            <TableHead scope="col" className="text-right">
              W
            </TableHead>
            <TableHead scope="col" className="text-right">
              Econ
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bowling.map((b) => {
            const decimalOvers = oversToDecimal(b.overs);
            const economy =
              decimalOvers > 0 ? (b.runs / decimalOvers).toFixed(1) : "-";
            return (
              <TableRow key={b.memberSlug ?? b.name}>
                <TableCell>
                  <PlayerName
                    name={b.name}
                    slug={b.memberSlug}
                    className="font-medium"
                  />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {b.overs}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {b.maidens}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {b.runs}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {b.wickets}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {economy}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FallOfWickets({ fow }: { fow: FoWEntry[] }) {
  if (fow.length === 0) return null;
  return (
    <p className="text-muted text-xs">
      <strong>Fall of wickets:</strong>{" "}
      {fow.map((f, i) => (
        <span key={f.wicketNumber}>
          {i > 0 && ", "}
          {f.wicketNumber}-{f.runs} ({f.batsmanOutName})
        </span>
      ))}
    </p>
  );
}

function InningsCard({
  innings,
  isPairs,
  startingRuns,
  dismissalPenalty,
}: {
  innings: ScorecardInnings;
  isPairs: boolean;
  startingRuns: number | null;
  dismissalPenalty: number | null;
}) {
  const showNetScore =
    isPairs && startingRuns !== null && dismissalPenalty !== null;
  return (
    <div className="border-primary bg-surface border-2">
      <div className="border-border border-b p-4 pb-2">
        <div className="text-primary text-lg font-semibold">
          {innings.teamBattingName}
        </div>
        <div className="text-muted text-sm font-semibold">
          {formatTotalScore(innings.total)}
        </div>
        {showNetScore && (
          <div className="text-primary text-base font-bold">
            Net Score {netScore(innings.total, startingRuns, dismissalPenalty)}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4 p-4">
        <BattingCard
          batting={innings.batting}
          extras={innings.extras}
          total={innings.total}
          isPairs={isPairs}
        />
        <FallOfWickets fow={innings.fallOfWickets} />
        <div className="border-border border-t pt-4">
          <Kicker level={5} className="mb-2">
            Bowling
          </Kicker>
          <BowlingCard bowling={innings.bowling} />
        </div>
      </div>
    </div>
  );
}

function ScorecardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <h4 className="fc-two-tone text-lg font-semibold md:text-xl">
        Scorecard
      </h4>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {["innings-1", "innings-2"].map((k) => (
          <div key={k} className="border-primary bg-surface border-2 p-4">
            <div className="bg-primary/10 h-5 w-40 animate-pulse rounded" />
            <div className="mt-4 space-y-3">
              {["r1", "r2", "r3", "r4", "r5", "r6"].map((row) => (
                <div
                  key={`${k}-${row}`}
                  className="bg-primary/10 h-4 animate-pulse rounded"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScorecardDisplay({ data }: { data: MatchDetailData }) {
  const isPairs = data.gameType === "Pairs";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h4 className="fc-two-tone text-lg font-semibold md:text-xl">
          Scorecard
        </h4>
        {isPairs && (
          <span className="bg-primary text-paper px-2 py-0.5 text-xs font-semibold">
            Women&apos;s Softball
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.innings.map((inn) => (
          <InningsCard
            key={inn.inningsNumber}
            innings={inn}
            isPairs={isPairs}
            startingRuns={data.startingRuns}
            dismissalPenalty={data.dismissalPenalty}
          />
        ))}
      </div>
    </div>
  );
}

// --- Main component ---

export function Scorecard({
  matchId,
  when,
}: {
  matchId: string;
  when: string | null;
}) {
  const gameInPast = when ? isPast(new Date(when)) : false;

  const { data, isLoading } = useQuery({
    queryKey: ["getMatchDetail", matchId],
    queryFn: () => fetchMatchDetail(matchId),
    enabled: gameInPast,
    staleTime: 30 * 60 * 1000,
  });

  if (!gameInPast) return null;
  if (isLoading) return <ScorecardSkeleton />;

  if (!data) return null;

  const matchDetail = transformMatchDetail(data as Record<string, unknown>);
  if (!matchDetail || matchDetail.innings.length === 0) return null;

  return <ScorecardDisplay data={matchDetail} />;
}
