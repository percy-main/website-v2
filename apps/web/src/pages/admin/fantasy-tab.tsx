import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const CURRENT_SEASON =
  new Date().getMonth() >= 3
    ? new Date().getFullYear()
    : new Date().getFullYear() - 1;

const RULE_TYPE_LABELS: Record<string, string> = {
  no_transfers: "No Transfers",
  no_subs: "No Subs",
  scoring_modifier: "Scoring Modifier",
  scoring_threshold: "Scoring Threshold",
  reverse_scoring: "Reverse Scoring",
  random_captain: "Random Captain",
};

const DEFAULT_CONFIGS: Record<string, string> = {
  scoring_modifier: JSON.stringify(
    { sandwich_cost_min: 1, sandwich_cost_max: 1, multiplier: 2 },
    null,
    2,
  ),
  scoring_threshold: JSON.stringify({ min_runs: 30, min_wickets: 3 }, null, 2),
};

function PlayCricketSyncSection() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncMutation = useMutation({
    mutationFn: () => callApi(api.POST("/api/play-cricket/admin/sync")),
    onSuccess: () => {
      setResult(
        "Sync started. Match data and fantasy scores will appear in a few minutes.",
      );
      setError(null);
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Play Cricket Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-stone-600">
          Manually trigger a Play Cricket sync. Pulls latest match scorecards
          and recomputes fantasy scores. Runs automatically Sun/Mon/Tue at
          03:00.
        </p>
        <Button
          disabled={syncMutation.isPending}
          onClick={() => {
            setResult(null);
            setError(null);
            syncMutation.mutate();
          }}
        >
          {syncMutation.isPending ? "Starting sync…" : "Sync now"}
        </Button>
        {result && <p className="text-sm text-green-700">{result}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PlayerManagementSection() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [populateResult, setPopulateResult] = useState<string | null>(null);
  const [costsResult, setCostsResult] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data } = useQuery({
    queryKey: ["admin", "fantasyPlayers", debouncedSearch],
    queryFn: () =>
      callApi(
        api.GET("/api/fantasy/admin/players", {
          params: {
            query: {
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
            },
          },
        }),
      ),
  });

  const populateMutation = useMutation({
    mutationFn: () => callApi(api.POST("/api/fantasy/admin/populate-players")),
    onSuccess: (result) => {
      setPopulateResult(
        `Found ${result.total} players, ${result.inserted} updated.`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["admin", "fantasyPlayers"],
      });
    },
  });

  const calculateCostsMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/fantasy/admin/calculate-costs", {
          body: { season: String(CURRENT_SEASON) },
        }),
      ),
    onSuccess: (result) => {
      setCostsResult(
        `Sandwich costs calculated from ${result.previousSeason} season data. ${result.updated} players updated for ${result.season} season.`,
      );
    },
  });

  const toggleEligibilityMutation = useMutation({
    mutationFn: ({
      playCricketId,
      eligible,
    }: {
      playCricketId: string;
      eligible: boolean;
    }) =>
      callApi(
        api.POST("/api/fantasy/admin/toggle-eligibility", {
          body: { playCricketId, eligible },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "fantasyPlayers"],
      });
    },
  });

  const players = data?.players ?? [];
  const eligibleCount = players.filter((p) => p.eligible).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Fantasy Player Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={populateMutation.isPending}
              onClick={() => {
                setPopulateResult(null);
                populateMutation.mutate();
              }}
            >
              {populateMutation.isPending
                ? "Refreshing…"
                : "Refresh from Play Cricket"}
            </Button>
            <Button
              variant="outline"
              disabled={calculateCostsMutation.isPending}
              onClick={() => {
                setCostsResult(null);
                calculateCostsMutation.mutate();
              }}
            >
              {calculateCostsMutation.isPending
                ? "Calculating…"
                : "Calculate Sandwich Costs"}
            </Button>
          </div>
          {populateResult && (
            <p className="text-sm text-green-700">{populateResult}</p>
          )}
          {costsResult && (
            <p className="text-sm whitespace-pre-line text-green-700">
              {costsResult}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Players ({eligibleCount} eligible / {players.length} total)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search players…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-64"
          />

          {players.length === 0 ? (
            <p className="py-12 text-center text-stone-500">
              No players found. Click &quot;Refresh from Play Cricket&quot; to
              populate the player list.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Play Cricket ID</TableHead>
                  <TableHead className="text-center">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((player) => (
                  <TableRow key={player.play_cricket_id}>
                    <TableCell className="font-medium">
                      {player.player_name}
                    </TableCell>
                    <TableCell className="text-stone-500">
                      {player.play_cricket_id}
                    </TableCell>
                    <TableCell className="text-center">
                      {"🥪".repeat(player.sandwich_cost)}
                    </TableCell>
                    <TableCell>
                      {player.eligible ? (
                        <Badge variant="success">Eligible</Badge>
                      ) : (
                        <Badge variant="secondary">Ineligible</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={toggleEligibilityMutation.isPending}
                        onClick={() =>
                          toggleEligibilityMutation.mutate({
                            playCricketId: player.play_cricket_id,
                            eligible: !player.eligible,
                          })
                        }
                      >
                        {player.eligible ? "Mark Ineligible" : "Mark Eligible"}
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

function ChaosWeeksSection() {
  const queryClient = useQueryClient();
  const [gameweekId, setGameweekId] = useState("");
  const [ruleType, setRuleType] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ruleConfig, setRuleConfig] = useState("");
  const [sendEmail, setSendEmail] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin", "chaosWeeks", CURRENT_SEASON],
    queryFn: () =>
      callApi(
        api.GET("/api/fantasy/admin/chaos-weeks", {
          params: { query: { season: String(CURRENT_SEASON) } },
        }),
      ),
  });

  const createMutation = useMutation({
    mutationFn: (body: {
      gameweekId: number;
      name: string;
      description: string;
      ruleType:
        | "no_transfers"
        | "no_captain_change"
        | "no_captain_multiplier"
        | "scoring_modifier"
        | "scoring_threshold";
      ruleConfig?: string;
    }) => callApi(api.POST("/api/fantasy/admin/chaos-weeks", { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "chaosWeeks"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      callApi(api.DELETE("/api/fantasy/admin/chaos-weeks", { body: { id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "chaosWeeks"] });
    },
  });

  // Note: send-email endpoint does not exist in the OpenAPI spec.
  // Keeping the mutation structure for future implementation.
  const sendEmailMutation = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: (_id: number) =>
      Promise.reject(new Error("send-email endpoint not yet implemented")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "chaosWeeks"] });
    },
  });

  function resetForm() {
    setGameweekId("");
    setRuleType("");
    setName("");
    setDescription("");
    setRuleConfig("");
    setSendEmail(false);
  }

  function handleRuleTypeChange(value: string) {
    const newType = value === "__none__" ? "" : value;
    setRuleType(newType);
    if (newType in DEFAULT_CONFIGS) {
      setRuleConfig(DEFAULT_CONFIGS[newType]);
    } else {
      setRuleConfig("");
    }
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    createMutation.mutate({
      gameweekId: Number(gameweekId),
      name,
      description,
      ruleType: ruleType as
        | "no_transfers"
        | "no_captain_change"
        | "no_captain_multiplier"
        | "scoring_modifier"
        | "scoring_threshold",
      ruleConfig: ruleConfig.trim() ? ruleConfig.trim() : undefined,
    });
  }

  const weeks = data?.weeks ?? [];
  const showRuleConfig =
    ruleType === "scoring_modifier" || ruleType === "scoring_threshold";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Chaos Week</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Gameweek
                </label>
                <Input
                  type="number"
                  min={1}
                  value={gameweekId}
                  onChange={(e) => setGameweekId(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Rule Type
                </label>
                <Select value={ruleType} onValueChange={handleRuleTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select rule type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select rule type</SelectItem>
                    <SelectItem value="no_transfers">No Transfers</SelectItem>
                    <SelectItem value="no_subs">No Subs</SelectItem>
                    <SelectItem value="scoring_modifier">
                      Scoring Modifier
                    </SelectItem>
                    <SelectItem value="scoring_threshold">
                      Scoring Threshold
                    </SelectItem>
                    <SelectItem value="reverse_scoring">
                      Reverse Scoring
                    </SelectItem>
                    <SelectItem value="random_captain">
                      Random Captain
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">
                  Description
                </label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>
              {showRuleConfig && (
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium">
                    Rule Config JSON
                  </label>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-stone-300 bg-white px-3 py-2 font-mono text-sm placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    value={ruleConfig}
                    onChange={(e) => setRuleConfig(e.target.value)}
                  />
                </div>
              )}
              <div className="col-span-2">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                  />
                  Allow sending announcement email
                </label>
              </div>
            </div>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Chaos Week"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chaos Weeks ({weeks.length} configured)</CardTitle>
        </CardHeader>
        <CardContent>
          {weeks.length === 0 ? (
            <p className="py-12 text-center text-stone-500">
              No chaos weeks configured yet. Create one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gameweek</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((week) => (
                  <TableRow key={week.id}>
                    <TableCell className="font-medium">
                      {week.gameweek_id}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{week.name}</div>
                        <div className="text-xs text-stone-500">
                          {week.description}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {RULE_TYPE_LABELS[week.rule_type] ?? week.rule_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {week.email_sent ? (
                        <Badge variant="success">Sent</Badge>
                      ) : week.send_email && !week.email_sent ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={sendEmailMutation.isPending}
                          onClick={() => sendEmailMutation.mutate(week.id)}
                        >
                          Send Email
                        </Button>
                      ) : (
                        <span className="text-stone-500">Disabled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(week.id)}
                      >
                        Delete
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

export function FantasyTab() {
  return (
    <div className="space-y-6">
      <PlayCricketSyncSection />
      <PlayerManagementSection />
      <ChaosWeeksSection />
    </div>
  );
}
