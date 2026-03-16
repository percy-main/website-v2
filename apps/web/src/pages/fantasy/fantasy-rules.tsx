import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "react-router";

function fmt(v: number) {
  return v > 0 ? `+${v}` : `${v}`;
}

function BattingRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Batting</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Per run scored</TableCell>
              <TableCell className="text-right">{fmt(1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per four hit</TableCell>
              <TableCell className="text-right">{fmt(1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per six hit</TableCell>
              <TableCell className="text-right">{fmt(2)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Half-century (50–99 runs)</TableCell>
              <TableCell className="text-right">{fmt(20)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Century (100+ runs)</TableCell>
              <TableCell className="text-right">{fmt(50)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Duck (0 runs, not-out excluded)</TableCell>
              <TableCell className="text-right">{fmt(-10)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-sm">
          Milestone bonuses are mutually exclusive — a century earns the century
          bonus only, not the fifty bonus as well.
        </p>
      </CardContent>
    </Card>
  );
}

function BowlingRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bowling</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Per wicket taken</TableCell>
              <TableCell className="text-right">{fmt(10)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per maiden over bowled</TableCell>
              <TableCell className="text-right">{fmt(10)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>3-wicket haul (3–4 wickets)</TableCell>
              <TableCell className="text-right">{fmt(15)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>5-wicket haul (5+ wickets)</TableCell>
              <TableCell className="text-right">{fmt(30)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Economy rate &lt; 4.0 RPO (min 3 overs)</TableCell>
              <TableCell className="text-right">{fmt(10)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Economy rate &gt; 7.0 RPO (min 3 overs)</TableCell>
              <TableCell className="text-right">{fmt(-10)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-sm">
          Wicket haul bonuses are mutually exclusive — a 5-wicket haul earns the
          5-wicket bonus only. Economy bonuses require a minimum of 3 overs
          bowled.
        </p>
      </CardContent>
    </Card>
  );
}

function FieldingRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fielding</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Catch (fielder)</TableCell>
              <TableCell className="text-right">{fmt(10)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Catch (wicketkeeper)</TableCell>
              <TableCell className="text-right">{fmt(5)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Run out</TableCell>
              <TableCell className="text-right">{fmt(15)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Stumping</TableCell>
              <TableCell className="text-right">{fmt(15)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SlotRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Squad Slots</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Your squad of 11 players is divided into three slot types:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>6 Batting slots</strong> — earn batting + fielding + team
            points only
          </li>
          <li>
            <strong>4 Bowling slots</strong> — earn bowling + fielding + team
            points only
          </li>
          <li>
            <strong>1 All-rounder slot</strong> — earns all categories (batting
            + bowling + fielding + team)
          </li>
        </ul>
        <p className="text-muted-foreground">
          Choose your slots wisely — a top all-rounder in the batting slot
          won&apos;t earn bowling points!
        </p>
      </CardContent>
    </Card>
  );
}

function BudgetRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sandwich Budget</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Each player costs 1–5 sandwiches based on their previous season
          performance. Your total squad budget is <strong>30 sandwiches</strong>
          .
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prev. Season Percentile</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Top 10%</TableCell>
              <TableCell className="text-right">5 sandwiches</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>10–25%</TableCell>
              <TableCell className="text-right">4 sandwiches</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>25–50%</TableCell>
              <TableCell className="text-right">3 sandwiches</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>50–75%</TableCell>
              <TableCell className="text-right">2 sandwiches</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Bottom 25%</TableCell>
              <TableCell className="text-right">1 sandwich</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WicketkeeperRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wicketkeeper Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Designate one player in your squad as <strong>wicketkeeper</strong>{" "}
          (WK). This affects fielding points:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A player in the WK slot who is <em>not</em> the actual keeper has
            their catches scored at the keeper rate (5 pts instead of 10 pts)
          </li>
          <li>
            The actual keeper who is <em>not</em> in the WK slot forfeits all
            catches and stumpings
          </li>
        </ul>
        <p className="text-muted-foreground">
          Put the real wicketkeeper in the WK slot for maximum points!
        </p>
      </CardContent>
    </Card>
  );
}

function GeneralRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>General Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Win bonus:</strong> +10 points for players on the winning
            team
          </li>
          <li>
            <strong>Captain:</strong> earns 2x their effective points (cannot be
            placed in the all-rounder slot)
          </li>
          <li>
            <strong>Eligible matches:</strong> only 1st XI and 2nd XI league
            matches count
          </li>
          <li>
            <strong>Gameweek:</strong> Saturday to Friday, aligned with match
            weekends
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function ChipRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chips</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <strong>Triple Captain</strong> — activates a 3x captain multiplier
          for one gameweek. You can use this chip twice per season. Activate or
          deactivate before the Friday 23:59 lock deadline.
        </p>
      </CardContent>
    </Card>
  );
}

function TransferRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Pre-season:</strong> unlimited transfers until GW1 starts
          </li>
          <li>
            <strong>Initial squad:</strong> your first 11 picks don&apos;t count
            as transfers
          </li>
          <li>
            <strong>In-season:</strong> max 3 transfers per gameweek
          </li>
          <li>
            <strong>Slot reassignment:</strong> changing a player&apos;s slot or
            captain/WK status is free — not counted as a transfer
          </li>
          <li>
            <strong>Lock deadline:</strong> Friday 23:59 UK time. Teams are
            locked Saturday and Sunday, reopening Monday 00:00.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function ScoringRulesContent() {
  return (
    <div className="flex flex-col gap-4">
      <BattingRules />
      <BowlingRules />
      <FieldingRules />
      <SlotRules />
      <BudgetRules />
      <WicketkeeperRules />
      <GeneralRules />
      <ChipRules />
      <TransferRules />
    </div>
  );
}

export function Component() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Fantasy Cricket — Scoring Rules</h1>
        <Link
          to="/fantasy"
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          Back to Fantasy
        </Link>
      </div>
      <ScoringRulesContent />
    </div>
  );
}
