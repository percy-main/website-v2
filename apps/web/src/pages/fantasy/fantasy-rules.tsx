import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmt(v: number) {
  return v > 0 ? `+${v}` : `${v}`;
}

function RoleSlotsRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role Slots</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <div>
            <h4 className="font-medium">Batting slots (6)</h4>
            <p className="text-muted-foreground">
              Score batting + fielding + team points only. Bowling points are
              excluded.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Bowling slots (4)</h4>
            <p className="text-muted-foreground">
              Score bowling + fielding + team points only. Batting points are
              excluded.
            </p>
          </div>
          <div>
            <h4 className="font-medium">All-Rounder slot (1)</h4>
            <p className="text-muted-foreground">
              Scores ALL point categories (batting + bowling + fielding + team).
              The all-rounder <strong>cannot</strong> be made captain.
            </p>
          </div>
          <p className="text-muted-foreground">
            Reassigning players between slots is free and does not count as a
            transfer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SandwichBudgetRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sandwich Budget</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Each player has a sandwich cost from 1 to 5, based on their previous
            season performance. Top performers cost more sandwiches.
          </p>
          <Table>
            <caption className="sr-only">Sandwich cost tiers</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Cost</TableHead>
                <TableHead scope="col">Player Tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">5</TableCell>
                <TableCell>Top 10% of scorers</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">4</TableCell>
                <TableCell>Top 10–30%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">3</TableCell>
                <TableCell>Top 30–50%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">2</TableCell>
                <TableCell>Top 50–70%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">1</TableCell>
                <TableCell>Bottom 30% / new players</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-muted-foreground">
            Your total squad cost must not exceed <strong>30 sandwiches</strong>
            . This ensures team diversity, so you can&apos;t just pick all the
            best players.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function WicketkeeperRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wicketkeeper</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Designate exactly one player in your squad as wicketkeeper (WK).
            Scoring is based on the actual match role, not just the fantasy tag:
          </p>
          <Table>
            <caption className="sr-only">Wicketkeeper scoring</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Scenario</TableHead>
                <TableHead scope="col" className="text-right">
                  Catches
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Stumpings
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Any player in WK slot</TableCell>
                <TableCell className="text-right font-medium">
                  +5/catch
                </TableCell>
                <TableCell className="text-right font-medium">
                  +15/stumping
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Non-keeper in non-WK slot</TableCell>
                <TableCell className="text-right font-medium">
                  +10/catch
                </TableCell>
                <TableCell className="text-muted-foreground text-right">
                  N/A
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-red-600">
                  Actual keeper NOT in WK slot
                </TableCell>
                <TableCell className="text-right font-medium text-red-600">
                  0
                </TableCell>
                <TableCell className="text-right font-medium text-red-600">
                  0
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-muted-foreground">
            The WK slot uses a reduced catch rate (5pt vs 10pt). If the actual
            match wicketkeeper is placed in a non-WK slot, they forfeit all
            catch and stumping points. You must place the real keeper in the WK
            slot to earn their dismissal points.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function BattingRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Batting</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <caption className="sr-only">Batting scoring</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Action</TableHead>
              <TableHead scope="col" className="w-24 text-right">
                Points
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Per run scored</TableCell>
              <TableCell className="text-right font-medium">{fmt(1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per four hit</TableCell>
              <TableCell className="text-right font-medium">{fmt(1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per six hit</TableCell>
              <TableCell className="text-right font-medium">{fmt(2)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Half-century bonus (50–99 runs)</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(20)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Century bonus (100+ runs)</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(50)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Duck penalty (0 runs, not out excluded)</TableCell>
              <TableCell className="text-right font-medium text-red-600">
                {fmt(-10)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-sm">
          Half-century and century bonuses are mutually exclusive; a century
          earns the century bonus only.
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
          <caption className="sr-only">Bowling scoring</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Action</TableHead>
              <TableHead scope="col" className="w-24 text-right">
                Points
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Per wicket taken</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(10)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per maiden over</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(10)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>3-wicket haul bonus (3–4 wickets)</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(15)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>5-wicket haul bonus (5+ wickets)</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(30)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Good economy bonus (under 4.0 RPO, min 3 overs)
              </TableCell>
              <TableCell className="text-right font-medium">
                {fmt(10)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Poor economy penalty (over 7.0 RPO, min 3 overs)
              </TableCell>
              <TableCell className="text-right font-medium text-red-600">
                {fmt(-10)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-sm">
          3-wicket and 5-wicket bonuses are mutually exclusive. Economy bonuses
          require a minimum of 3 overs bowled.
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
          <caption className="sr-only">Fielding scoring</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Action</TableHead>
              <TableHead scope="col" className="w-24 text-right">
                Points
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Per catch (fielder)</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(10)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per catch (wicketkeeper)</TableCell>
              <TableCell className="text-right font-medium">{fmt(5)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per run out</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(15)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per stumping</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(15)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-sm">
          Wicketkeeper catches are worth fewer points since keepers get more
          catching opportunities.
        </p>
      </CardContent>
    </Card>
  );
}

function GeneralRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team &amp; General</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <caption className="sr-only">Team and general scoring</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Rule</TableHead>
              <TableHead scope="col" className="w-24 text-right">
                Points
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Win bonus (player&apos;s team wins)</TableCell>
              <TableCell className="text-right font-medium">
                {fmt(10)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Captain multiplier</TableCell>
              <TableCell className="text-right font-medium">2x</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground mt-2 text-sm">
          Your captain&apos;s points are doubled in your team score. The captain
          cannot be placed in the all-rounder slot. The captain multiplier does
          not affect the player leaderboard.
        </p>
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
      <CardContent>
        <div className="space-y-3 text-sm">
          <div>
            <h4 className="font-medium">Triple Captain</h4>
            <p className="text-muted-foreground">
              When activated, your captain&apos;s points are tripled (3x)
              instead of doubled (2x) for that gameweek. You get 2 uses per
              season.
            </p>
          </div>
          <div>
            <h4 className="font-medium">How to use</h4>
            <p className="text-muted-foreground">
              Activate a chip from the &quot;Chips&quot; section on the My Team
              page before the gameweek locks (Friday 23:59 UK time). You can
              deactivate it before the lock deadline if you change your mind.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TransferRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfers &amp; Deadlines</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <div>
            <h4 className="font-medium">Squad size</h4>
            <p className="text-muted-foreground">
              Pick 11 players for your squad, including one captain.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Pre-season</h4>
            <p className="text-muted-foreground">
              Unlimited changes to your squad before Gameweek 1 starts.
            </p>
          </div>
          <div>
            <h4 className="font-medium">In-season transfers</h4>
            <p className="text-muted-foreground">
              Maximum 3 transfers per gameweek. Your first squad selection is
              always unlimited.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Lock deadline</h4>
            <p className="text-muted-foreground">
              Teams lock at Friday 23:59 UK time. Editing reopens Monday 00:00
              UK time.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Eligible matches</h4>
            <p className="text-muted-foreground">
              Only league matches for 1st XI and 2nd XI count towards fantasy
              points.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Scoring rules content without page wrapper — used in the fantasy home tab */
export function ScoringRulesContent() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        Points are awarded based on real match performances in Percy Main 1st XI
        and 2nd XI league matches.
      </p>
      <RoleSlotsRules />
      <SandwichBudgetRules />
      <WicketkeeperRules />
      <BattingRules />
      <BowlingRules />
      <FieldingRules />
      <GeneralRules />
      <ChipRules />
      <TransferRules />
    </div>
  );
}
