import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { ScoringRulesContent } from "./fantasy-rules.js";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useTransferWindow() {
  return useQuery({
    queryKey: ["fantasy", "transfer-window"],
    queryFn: () => callApi(api.GET("/api/fantasy/transfer-window")),
    staleTime: 60_000,
  });
}

function usePreSeasonStats() {
  return useQuery({
    queryKey: ["fantasy", "pre-season-stats"],
    queryFn: () => callApi(api.GET("/api/fantasy/stats/pre-season")),
    staleTime: 60_000,
  });
}

function useSeasonLeaderboard() {
  return useQuery({
    queryKey: ["fantasy", "leaderboard", "season"],
    queryFn: () => callApi(api.GET("/api/fantasy/leaderboard/season")),
    staleTime: 5 * 60_000,
  });
}

function useWeeklyLeaderboard(gameweek?: number) {
  return useQuery({
    queryKey: ["fantasy", "leaderboard", "weekly", gameweek],
    queryFn: () =>
      callApi(
        api.GET("/api/fantasy/leaderboard/weekly", {
          params: { query: { gameweek } },
        }),
      ),
    staleTime: 5 * 60_000,
  });
}

function usePlayerLeaderboard() {
  return useQuery({
    queryKey: ["fantasy", "leaderboard", "players"],
    queryFn: () => callApi(api.GET("/api/fantasy/leaderboard/players")),
    staleTime: 5 * 60_000,
  });
}

function useHighlights() {
  return useQuery({
    queryKey: ["fantasy", "highlights"],
    queryFn: () => callApi(api.GET("/api/fantasy/highlights")),
    staleTime: 5 * 60_000,
  });
}

function useOwnership() {
  return useQuery({
    queryKey: ["fantasy", "ownership"],
    queryFn: () => callApi(api.GET("/api/fantasy/stats/ownership")),
    staleTime: 5 * 60_000,
  });
}

function useSandwichEfficiency() {
  return useQuery({
    queryKey: ["fantasy", "sandwich-efficiency"],
    queryFn: () => callApi(api.GET("/api/fantasy/stats/sandwich-efficiency")),
    staleTime: 5 * 60_000,
  });
}

function useTeams() {
  return useQuery({
    queryKey: ["fantasy", "teams"],
    queryFn: () => callApi(api.GET("/api/fantasy/teams")),
    staleTime: 5 * 60_000,
  });
}

function useTeamDetail(teamId: number | null) {
  return useQuery({
    queryKey: ["fantasy", "team", teamId],
    queryFn: () => {
      if (teamId === null) throw new Error("teamId is required");
      return callApi(
        api.GET("/api/fantasy/teams/{teamId}", {
          params: { path: { teamId } },
        }),
      );
    },
    enabled: teamId !== null,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

// ---------------------------------------------------------------------------
// Home Tab
// ---------------------------------------------------------------------------

function HomeTab({ onViewTeam }: { onViewTeam: (teamId: number) => void }) {
  const tw = useTransferWindow();
  const stats = usePreSeasonStats();
  const highlights = useHighlights();
  const ownership = useOwnership();
  const sandwich = useSandwichEfficiency();
  const seasonBoard = useSeasonLeaderboard();

  return (
    <div className="space-y-6">
      {/* Welcome hero */}
      <Card>
        <CardHeader>
          <CardTitle>Welcome to Percy Main Fantasy Cricket</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Pick your squad of 11 players from Percy Main&apos;s 1st and 2nd XI,
            choose a captain for double points, and compete against other
            members throughout the season. Points are scored from real match
            performances in league games.
          </p>
          <div className="flex gap-2">
            <Link to="/members/fantasy">
              <Button size="sm">Go to My Team</Button>
            </Link>
            <Link to="/fantasy?tab=rules">
              <Button variant="outline" size="sm">
                View Scoring Rules
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Countdown stat cards */}
      {tw.isPending ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex flex-col items-center py-6">
                <Skeleton className="mb-1 h-10 w-16" />
                <Skeleton className="h-4 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tw.data?.isPreSeason ? (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex flex-col items-center py-6">
              <span className="text-4xl font-bold text-blue-600">
                {tw.data.daysUntilLock}
              </span>
              <span className="text-muted-foreground text-sm">days to go</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center py-6">
              <span className="text-4xl font-bold">
                {stats.data?.teamCount ?? 0}
              </span>
              <span className="text-muted-foreground text-sm">
                teams registered
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center py-6">
              <span className="text-4xl font-bold text-amber-500">
                {stats.data?.totalSandwiches ?? 0}
              </span>
              <span className="text-muted-foreground text-sm">
                sandwiches consumed
              </span>
            </CardContent>
          </Card>
        </div>
      ) : tw.data?.locked ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-6">
            <span className="text-lg font-semibold text-amber-600">
              Teams locked
            </span>
            <span className="text-muted-foreground text-sm">
              Reopens in {tw.data.daysUntilLock} day
              {tw.data.daysUntilLock !== 1 ? "s" : ""}
            </span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-6">
            <span className="text-lg font-semibold text-green-600">
              Transfer window open — Gameweek {tw.data?.gameweek}
            </span>
            <span className="text-muted-foreground text-sm">
              Locks in {tw.data?.daysUntilLock} day
              {tw.data?.daysUntilLock !== 1 ? "s" : ""}
            </span>
          </CardContent>
        </Card>
      )}

      {/* How it works — concise bullet list */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li>Pick 11 players and designate a captain (2x points)</li>
            <li>Points from batting, bowling, fielding, and team wins</li>
            <li>Up to 3 transfers per gameweek during the season</li>
            <li>Teams lock Friday night, reopen Monday</li>
            <li>Only 1st XI and 2nd XI league matches count</li>
          </ul>
        </CardContent>
      </Card>

      {/* Gameweek Highlights */}
      {highlights.data?.highlights && (
        <Card>
          <CardHeader>
            <CardTitle>
              Gameweek {highlights.data.gameweek} Highlights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.data.highlights.topScorer && (
                <HighlightCard
                  label="Top Scorer"
                  value={highlights.data.highlights.topScorer.playerName}
                  detail={`${highlights.data.highlights.topScorer.totalPoints} pts`}
                />
              )}
              {highlights.data.highlights.bestSpell && (
                <HighlightCard
                  label="Best Spell"
                  value={highlights.data.highlights.bestSpell.playerName}
                  detail={`${highlights.data.highlights.bestSpell.bowlingPoints} bowling pts`}
                />
              )}
              {highlights.data.highlights.topTeam && (
                <HighlightCard
                  label="Top Team"
                  value={highlights.data.highlights.topTeam.ownerName}
                  detail={`${highlights.data.highlights.topTeam.totalPoints} pts`}
                />
              )}
              {highlights.data.highlights.mostCaptained && (
                <HighlightCard
                  label="Most Captained"
                  value={highlights.data.highlights.mostCaptained.playerName}
                  detail={`${highlights.data.highlights.mostCaptained.captainPct}% of teams`}
                />
              )}
              {highlights.data.highlights.fantasyShock && (
                <HighlightCard
                  label="Fantasy Shock"
                  value={highlights.data.highlights.fantasyShock.playerName}
                  detail={`${highlights.data.highlights.fantasyShock.totalPoints} pts, ${highlights.data.highlights.fantasyShock.ownershipPct}% owned`}
                />
              )}
              {highlights.data.highlights.differentialPick && (
                <HighlightCard
                  label="Differential Pick"
                  value={highlights.data.highlights.differentialPick.playerName}
                  detail={`${highlights.data.highlights.differentialPick.totalPoints} pts, ${highlights.data.highlights.differentialPick.ownershipPct}% owned`}
                />
              )}
              {highlights.data.highlights.biggestMover && (
                <HighlightCard
                  label="Biggest Mover"
                  value={highlights.data.highlights.biggestMover.ownerName}
                  detail={`+${highlights.data.highlights.biggestMover.rankChange} places to #${highlights.data.highlights.biggestMover.currentRank}`}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ownership: Most Owned + Most Captained (2-col grid, matches v1) */}
      {ownership.data && ownership.data.teamCount > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {ownership.data.mostOwned.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Most Owned</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="w-20 text-right">Owned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownership.data.mostOwned.map((p) => (
                      <TableRow key={p.playCricketId}>
                        <TableCell className="font-medium">
                          {p.playerName}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.ownershipPct}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {ownership.data.mostCaptained.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Most Captained</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="w-20 text-right">Captain</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownership.data.mostCaptained.map((p) => (
                      <TableRow key={p.playCricketId}>
                        <TableCell className="font-medium">
                          {p.playerName}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.captainPct}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Differential Picks + Sandwich Efficiency (2-col grid, matches v1) */}
      <div className="grid gap-4 md:grid-cols-2">
        {ownership.data && ownership.data.differentials.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Differential Picks
                {ownership.data.isFromPreviousSeason && (
                  <Badge variant="secondary" className="ml-2">
                    Previous Season
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Pts</TableHead>
                    <TableHead className="text-right">Owned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ownership.data.differentials.map((p) => (
                    <TableRow key={p.playCricketId}>
                      <TableCell>
                        <div className="font-medium">{p.playerName}</div>
                        <div className="text-xs">
                          {"🥪".repeat(p.sandwichCost)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{p.points}</TableCell>
                      <TableCell className="text-right">
                        {p.ownershipPct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {sandwich.data && sandwich.data.entries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Sandwich Efficiency
                {sandwich.data.isFromPreviousSeason && (
                  <Badge variant="secondary" className="ml-2">
                    Previous Season
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Pts</TableHead>
                    <TableHead className="text-right">PPS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sandwich.data.entries.map((e) => (
                    <TableRow key={e.playCricketId}>
                      <TableCell>{e.rank}</TableCell>
                      <TableCell>
                        <div>{e.playerName}</div>
                        <div className="text-xs">
                          {"🥪".repeat(e.sandwichCost)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {e.totalPoints}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.pointsPerSandwich}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Top 5 teams */}
      {seasonBoard.data && seasonBoard.data.entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Season Standings</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Gameweeks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seasonBoard.data.entries.slice(0, 5).map((e) => (
                  <TableRow
                    key={e.teamId}
                    className="cursor-pointer"
                    onClick={() => onViewTeam(e.teamId)}
                  >
                    <TableCell>{e.rank}</TableCell>
                    <TableCell className="text-primary font-medium">
                      {e.ownerName}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.totalPoints}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.gameweeksPlayed}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HighlightCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="font-semibold">{value}</p>
      <p className="text-muted-foreground text-sm">{detail}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboards Tab
// ---------------------------------------------------------------------------

function LeaderboardsTab({
  onViewTeam,
}: {
  onViewTeam: (teamId: number) => void;
}) {
  const [params, setParams] = useSearchParams();
  const subTab = params.get("lb") ?? "season";

  const gwParam = params.get("gw");
  const selectedGw =
    gwParam !== null && gwParam !== "" && !Number.isNaN(Number(gwParam))
      ? Number(gwParam)
      : undefined;

  function setSelectedGw(gw: number) {
    const next = new URLSearchParams(params);
    next.set("gw", String(gw));
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["season", "weekly", "players"] as const).map((t) => (
          <Button
            key={t}
            variant={subTab === t ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("lb", t);
              if (t !== "weekly") next.delete("gw");
              setParams(next, { replace: true });
            }}
          >
            {t === "season" ? "Season" : t === "weekly" ? "Weekly" : "Players"}
          </Button>
        ))}
      </div>

      {subTab === "season" && <SeasonLeaderboard onViewTeam={onViewTeam} />}
      {subTab === "weekly" && (
        <WeeklyLeaderboard
          selectedGw={selectedGw}
          onSelectGw={setSelectedGw}
          onViewTeam={onViewTeam}
        />
      )}
      {subTab === "players" && <PlayerLeaderboard />}
    </div>
  );
}

function SeasonLeaderboard({
  onViewTeam,
}: {
  onViewTeam: (teamId: number) => void;
}) {
  const { data, isPending, error } = useSeasonLeaderboard();

  if (isPending) return <LoadingTable rows={10} cols={4} />;
  if (error)
    return (
      <p className="text-center text-red-600">Failed to load leaderboard.</p>
    );
  if (!data?.entries.length)
    return <p className="text-muted-foreground text-center">No scores yet.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">Points</TableHead>
          <TableHead className="text-right">Gameweeks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.entries.map((e) => (
          <TableRow
            key={e.teamId}
            className="cursor-pointer"
            onClick={() => onViewTeam(e.teamId)}
          >
            <TableCell>{e.rank}</TableCell>
            <TableCell className="text-primary font-medium">
              {e.ownerName}
            </TableCell>
            <TableCell className="text-right">{e.totalPoints}</TableCell>
            <TableCell className="text-right">{e.gameweeksPlayed}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WeeklyLeaderboard({
  selectedGw,
  onSelectGw,
  onViewTeam,
}: {
  selectedGw: number | undefined;
  onSelectGw: (gw: number) => void;
  onViewTeam: (teamId: number) => void;
}) {
  const { data, isPending, error } = useWeeklyLeaderboard(selectedGw);

  if (isPending) return <LoadingTable rows={10} cols={3} />;
  if (error)
    return (
      <p className="text-center text-red-600">Failed to load leaderboard.</p>
    );

  return (
    <div className="space-y-3">
      {data?.availableGameweeks && data.availableGameweeks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.availableGameweeks.map((gw) => (
            <Button
              key={gw}
              variant={gw === data.gameweek ? "default" : "outline"}
              size="sm"
              onClick={() => onSelectGw(gw)}
            >
              GW{gw}
            </Button>
          ))}
        </div>
      )}

      {!data?.entries.length ? (
        <p className="text-muted-foreground text-center">No scores yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => (
              <TableRow
                key={e.teamId}
                className="cursor-pointer"
                onClick={() => onViewTeam(e.teamId)}
              >
                <TableCell>{e.rank}</TableCell>
                <TableCell className="text-primary font-medium">
                  {e.ownerName}
                </TableCell>
                <TableCell className="text-right">{e.weeklyPoints}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function PlayerLeaderboard() {
  const { data, isPending, error } = usePlayerLeaderboard();

  if (isPending) return <LoadingTable rows={10} cols={6} />;
  if (error)
    return (
      <p className="text-center text-red-600">Failed to load player stats.</p>
    );
  if (!data?.entries.length)
    return (
      <p className="text-muted-foreground text-center">No player scores yet.</p>
    );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">Bat</TableHead>
            <TableHead className="text-right">Bowl</TableHead>
            <TableHead className="text-right">Field</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Matches</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.entries.map((e) => (
            <TableRow key={e.playCricketId}>
              <TableCell>{e.rank}</TableCell>
              <TableCell>{e.playerName}</TableCell>
              <TableCell className="text-right">{e.battingPoints}</TableCell>
              <TableCell className="text-right">{e.bowlingPoints}</TableCell>
              <TableCell className="text-right">{e.fieldingPoints}</TableCell>
              <TableCell className="text-right font-semibold">
                {e.totalPoints}
              </TableCell>
              <TableCell className="text-right">{e.matchesPlayed}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All Teams Tab
// ---------------------------------------------------------------------------

function AllTeamsTab({ onViewTeam }: { onViewTeam: (teamId: number) => void }) {
  const { data, isPending, error } = useTeams();

  if (isPending) return <LoadingTable rows={8} cols={2} />;
  if (error)
    return <p className="text-center text-red-600">Failed to load teams.</p>;
  if (!data?.teams.length)
    return (
      <p className="text-muted-foreground text-center">
        No teams registered yet.
      </p>
    );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.teams.map((t) => (
          <TableRow
            key={t.id}
            className="cursor-pointer"
            onClick={() => onViewTeam(t.id)}
          >
            <TableCell className="text-primary font-medium">
              {t.ownerName}
            </TableCell>
            <TableCell className="text-muted-foreground text-right text-sm">
              {new Date(t.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Team detail view
// ---------------------------------------------------------------------------

function TeamView({ teamId, onBack }: { teamId: number; onBack: () => void }) {
  const { data, isPending, error } = useTeamDetail(teamId);

  if (isPending) return <LoadingTable rows={11} cols={4} />;
  if (error)
    return <p className="text-center text-red-600">Failed to load team.</p>;
  if (!data) return null;

  const slotOrder = { batting: 0, bowling: 1, allrounder: 2 };
  const sorted = [...data.players].sort(
    (a, b) => (slotOrder[a.slotType] ?? 3) - (slotOrder[b.slotType] ?? 3),
  );

  const { latestGameweek } = data.team;

  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={onBack}>
        &larr; Back
      </Button>
      <h3 className="text-lg font-semibold">{data.team.ownerName}</h3>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center py-6">
            <span className="text-3xl font-bold">{data.team.seasonPoints}</span>
            <span className="text-muted-foreground text-sm">Season points</span>
          </CardContent>
        </Card>
        {latestGameweek !== null && (
          <Card>
            <CardContent className="flex flex-col items-center py-6">
              <span className="text-3xl font-bold">
                {data.team.latestGameweekPoints}
              </span>
              <span className="text-muted-foreground text-sm">
                Gameweek {latestGameweek} points
              </span>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex flex-col items-center py-6">
            <span className="text-3xl font-bold">
              {data.team.gameweeksPlayed}
            </span>
            <span className="text-muted-foreground text-sm">
              Gameweeks played
            </span>
          </CardContent>
        </Card>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Slot</TableHead>
            <TableHead className="text-center">Cost</TableHead>
            <TableHead className="text-right">Owned</TableHead>
            <TableHead className="text-right">Season</TableHead>
            {latestGameweek !== null && (
              <TableHead className="text-right">GW{latestGameweek}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => (
            <TableRow key={p.playCricketId}>
              <TableCell>
                {p.playerName}
                {p.isCaptain && (
                  <Badge variant="default" className="ml-1">
                    C
                  </Badge>
                )}
                {p.isWicketkeeper && (
                  <Badge variant="secondary" className="ml-1">
                    WK
                  </Badge>
                )}
              </TableCell>
              <TableCell className="capitalize">{p.slotType}</TableCell>
              <TableCell className="text-center">
                <span className="inline-flex items-center gap-0.5 text-sm whitespace-nowrap">
                  {"🥪".repeat(p.sandwichCost)}
                </span>
              </TableCell>
              <TableCell className="text-right">{p.ownershipPct}%</TableCell>
              <TableCell className="text-right font-medium">
                {p.seasonPoints}
              </TableCell>
              {latestGameweek !== null && (
                <TableCell className="text-right">
                  {p.latestGameweekPoints}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

function LoadingTable({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function Component() {
  useDocumentMeta(
    "Fantasy Cricket",
    "Percy Main Fantasy Cricket — pick your team, track scores, and compete on the leaderboard.",
  );
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "home";

  const teamParam = params.get("team");
  const viewTeamId =
    teamParam !== null && teamParam !== "" && !Number.isNaN(Number(teamParam))
      ? Number(teamParam)
      : null;

  function setTab(t: string) {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    // Clean up sub-params when switching tabs so stale state doesn't leak across.
    next.delete("lb");
    next.delete("gw");
    next.delete("team");
    setParams(next, { replace: true });
  }

  function onViewTeam(teamId: number) {
    const next = new URLSearchParams(params);
    next.set("team", String(teamId));
    setParams(next);
  }

  function onBackFromTeam() {
    const next = new URLSearchParams(params);
    next.delete("team");
    setParams(next);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Fantasy Cricket</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 w-full justify-start">
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="teams">All Teams</TabsTrigger>
          <TabsTrigger value="leaderboards">Leaderboards</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        {viewTeamId !== null ? (
          <TeamView teamId={viewTeamId} onBack={onBackFromTeam} />
        ) : (
          <>
            <TabsContent value="home">
              <HomeTab onViewTeam={onViewTeam} />
            </TabsContent>
            <TabsContent value="teams">
              <AllTeamsTab onViewTeam={onViewTeam} />
            </TabsContent>
            <TabsContent value="leaderboards">
              <LeaderboardsTab onViewTeam={onViewTeam} />
            </TabsContent>
            <TabsContent value="rules">
              <ScoringRulesContent />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
