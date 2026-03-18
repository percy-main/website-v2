import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { api } from "@/lib/api.js";
import { useQuery } from "@tanstack/react-query";
import { isPast } from "date-fns";

// --- Types ---

interface BattingEntry {
  position: string;
  name: string;
  howOut: string | null;
  fielderName: string | null;
  bowlerName: string | null;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
}

interface BowlingEntry {
  name: string;
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
  innings: ScorecardInnings[];
}

// --- Helpers ---

function formatDismissal(entry: BattingEntry): string {
  const { howOut, fielderName, bowlerName } = entry;
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
      return howOut ?? "unknown";
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

function buildResultText(data: MatchDetailData): string {
  if (!data.result) return "";
  if (data.result === "D") return "Match drawn";
  if (data.result === "T") return "Match tied";

  const desc = data.resultDescription.toLowerCase();
  if (desc.includes("abandon")) return "Match abandoned";
  if (desc.includes("cancel")) return "Match cancelled";
  if (desc.includes("no result")) return "No result";

  if (data.result === "W" && data.resultAppliedTo && data.innings.length >= 2) {
    const winningTeamId = data.resultAppliedTo;
    const winningTeamName =
      winningTeamId === data.homeTeamId ? data.homeTeamName : data.awayTeamName;

    const secondInnings = data.innings[1];

    if (secondInnings.total.runs !== undefined) {
      const firstInnings = data.innings[0];
      // Second innings team chased — won by wickets
      // First innings team set target — won by runs
      if (
        winningTeamId === data.homeTeamId ||
        winningTeamId === data.awayTeamId
      ) {
        const secondBattingTeamWon =
          secondInnings.teamBattingName.includes(winningTeamName) || false;
        if (secondBattingTeamWon) {
          const wicketsInHand = 10 - secondInnings.total.wickets;
          return `${winningTeamName} won by ${wicketsInHand} wicket${wicketsInHand !== 1 ? "s" : ""}`;
        } else {
          const margin = firstInnings.total.runs - secondInnings.total.runs;
          return `${winningTeamName} won by ${margin} run${margin !== 1 ? "s" : ""}`;
        }
      }
    }
  }

  return data.resultDescription;
}

// --- Transform API response to display types ---

function transformMatchDetail(
  raw: Record<string, unknown>,
): MatchDetailData | null {
  const details = raw.match_details as
    | Array<Record<string, unknown>>
    | undefined;
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

    const batting: BattingEntry[] = bat.map((b) => ({
      position: b.position,
      name: b.batsman_name,
      howOut: b.how_out ?? null,
      fielderName: b.fielder_name ?? null,
      bowlerName: b.bowler_name ?? null,
      runs: parseInt(b.runs) || 0,
      balls: parseInt(b.balls) || 0,
      fours: parseInt(b.fours) || 0,
      sixes: parseInt(b.sixes) || 0,
    }));

    const bowling: BowlingEntry[] = bowl.map((b) => ({
      name: b.bowler_name,
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
    innings,
  };
}

// --- Sub-components ---

function BattingCard({
  batting,
  extras,
  total,
}: {
  batting: BattingEntry[];
  extras: Extras;
  total: InningsTotal;
}) {
  const activeBatters = batting.filter((b) => b.howOut !== "dnb");
  const didNotBat = batting.filter((b) => b.howOut === "dnb");

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-full">Batter</TableHead>
            <TableHead className="text-right">R</TableHead>
            <TableHead className="text-right">B</TableHead>
            <TableHead className="text-right">4s</TableHead>
            <TableHead className="text-right">6s</TableHead>
            <TableHead className="text-right">SR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeBatters.map((b) => (
            <TableRow key={b.position}>
              <TableCell>
                <div>
                  <span className="font-medium">{b.name}</span>
                  <div className="text-xs text-gray-500">
                    {formatDismissal(b)}
                  </div>
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
                {b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "-"}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <span className="text-sm text-gray-600">
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
              colSpan={5}
            >
              {formatTotalScore(total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {didNotBat.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          <strong>Did not bat:</strong>{" "}
          {didNotBat.map((b) => b.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function BowlingCard({ bowling }: { bowling: BowlingEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-full">Bowler</TableHead>
          <TableHead className="text-right">O</TableHead>
          <TableHead className="text-right">M</TableHead>
          <TableHead className="text-right">R</TableHead>
          <TableHead className="text-right">W</TableHead>
          <TableHead className="text-right">Econ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bowling.map((b, i) => {
          const decimalOvers = oversToDecimal(b.overs);
          const economy =
            decimalOvers > 0 ? (b.runs / decimalOvers).toFixed(1) : "-";
          return (
            <TableRow key={`${b.name}-${i}`}>
              <TableCell className="font-medium">{b.name}</TableCell>
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
  );
}

function FallOfWickets({ fow }: { fow: FoWEntry[] }) {
  if (fow.length === 0) return null;
  return (
    <p className="text-xs text-gray-600">
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

function InningsCard({ innings }: { innings: ScorecardInnings }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{innings.teamBattingName}</CardTitle>
        <div className="text-sm font-semibold text-gray-700">
          {formatTotalScore(innings.total)}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <BattingCard
          batting={innings.batting}
          extras={innings.extras}
          total={innings.total}
        />
        <FallOfWickets fow={innings.fallOfWickets} />
        <div className="border-t pt-4">
          <h5 className="mb-2 text-sm font-semibold text-gray-700">Bowling</h5>
          <BowlingCard bowling={innings.bowling} />
        </div>
      </CardContent>
    </Card>
  );
}

function ScorecardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-lg font-semibold md:text-xl">Scorecard</h4>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 6 }, (_, j) => (
                <div
                  key={j}
                  className="h-4 animate-pulse rounded bg-gray-100"
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ScorecardDisplay({ data }: { data: MatchDetailData }) {
  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-lg font-semibold md:text-xl">Scorecard</h4>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.innings.map((inn) => (
          <InningsCard key={inn.inningsNumber} innings={inn} />
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
    queryFn: () =>
      api.get<Record<string, unknown>>(`/play-cricket/match/${matchId}`),
    enabled: gameInPast,
    staleTime: 30 * 60 * 1000,
  });

  if (!gameInPast) return null;
  if (isLoading) return <ScorecardSkeleton />;

  if (!data) return null;

  const matchDetail = transformMatchDetail(data);
  if (!matchDetail || matchDetail.innings.length === 0) return null;

  return <ScorecardDisplay data={matchDetail} />;
}
