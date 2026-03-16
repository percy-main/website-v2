import { Alert } from "@/components/ui/alert";
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
import { api } from "@/lib/api";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SlotType = "batting" | "bowling" | "allrounder";

interface SelectedPlayer {
  playCricketId: string;
  playerName: string;
  sandwichCost: number;
  isCaptain: boolean;
  slotType: SlotType;
  isWicketkeeper: boolean;
}

interface EligiblePlayer {
  play_cricket_id: string;
  player_name: string;
  sandwich_cost: number;
  previousSeasonPoints: number;
  ownershipPercent: number;
}

interface MyTeamResponse {
  team: { id: number; season: string } | null;
  players: Array<{
    play_cricket_id: string;
    player_name: string;
    sandwich_cost: number;
    is_captain: boolean;
    slot_type: string;
    is_wicketkeeper: boolean;
  }>;
  gameweek: number;
  transfersUsed: number;
  maxTransfers: number;
  chaosWeek: {
    name: string;
    description: string;
    rule_type: string;
  } | null;
}

interface ChipStatus {
  chips: Array<{
    chipType: string;
    usedThisSeason: number;
    maxPerSeason: number;
    activeThisGameweek: boolean;
  }>;
  gameweek: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLOT_COUNTS = { batting: 6, bowling: 4, allrounder: 1 };
const BUDGET = 30;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useEligiblePlayers() {
  return useQuery({
    queryKey: ["fantasy", "eligible-players"],
    queryFn: () =>
      api.get<{
        players: EligiblePlayer[];
        season: string;
        previousSeason: string;
        budget: number;
      }>("/fantasy/players"),
    staleTime: 5 * 60_000,
  });
}

function useMyTeam() {
  return useQuery({
    queryKey: ["fantasy", "my-team"],
    queryFn: () => api.get<MyTeamResponse>("/fantasy/team"),
    staleTime: 30_000,
  });
}

function useChipStatus() {
  return useQuery({
    queryKey: ["fantasy", "chip-status"],
    queryFn: () => api.get<ChipStatus>("/fantasy/chip"),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Component() {
  const playersQuery = useEligiblePlayers();
  const teamQuery = useMyTeam();
  const chipQuery = useChipStatus();
  const queryClient = useQueryClient();

  const [squad, setSquad] = useState<SelectedPlayer[]>([]);
  const [hasLoadedTeam, setHasLoadedTeam] = useState(false);
  const [search, setSearch] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load existing team into local state once
  if (teamQuery.data && !hasLoadedTeam) {
    if (teamQuery.data.team && teamQuery.data.players.length > 0) {
      setSquad(
        teamQuery.data.players.map((p) => ({
          playCricketId: p.play_cricket_id,
          playerName: p.player_name,
          sandwichCost: p.sandwich_cost,
          isCaptain: p.is_captain,
          slotType: p.slot_type as SlotType,
          isWicketkeeper: p.is_wicketkeeper,
        })),
      );
    }
    setHasLoadedTeam(true);
  }

  const saveMutation = useMutation({
    mutationFn: (players: SelectedPlayer[]) =>
      api.post("/fantasy/team", {
        players: players.map((p) => ({
          playCricketId: p.playCricketId,
          isCaptain: p.isCaptain,
          slotType: p.slotType,
          isWicketkeeper: p.isWicketkeeper,
        })),
      }),
    onSuccess: () => {
      setSaveError(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["fantasy"] });
    },
    onError: (err: Error) => {
      setSaveError(err.message);
      setSaveSuccess(false);
    },
  });

  const chipMutation = useMutation({
    mutationFn: (params: { action: "activate" | "deactivate" }) =>
      params.action === "activate"
        ? api.post("/fantasy/chip", { chipType: "triple_captain" })
        : api.delete("/fantasy/chip"),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["fantasy", "chip-status"],
      });
    },
  });

  // Derived state
  const totalCost = squad.reduce((sum, p) => sum + p.sandwichCost, 0);
  const budgetRemaining = BUDGET - totalCost;
  const captainCount = squad.filter((p) => p.isCaptain).length;
  const wkCount = squad.filter((p) => p.isWicketkeeper).length;
  const squadPlayerIds = useMemo(
    () => new Set(squad.map((p) => p.playCricketId)),
    [squad],
  );

  const slotCounts = { batting: 0, bowling: 0, allrounder: 0 };
  for (const p of squad) slotCounts[p.slotType]++;

  const canSave =
    squad.length === 11 &&
    captainCount === 1 &&
    wkCount === 1 &&
    slotCounts.batting === SLOT_COUNTS.batting &&
    slotCounts.bowling === SLOT_COUNTS.bowling &&
    slotCounts.allrounder === SLOT_COUNTS.allrounder &&
    totalCost <= BUDGET;

  // Get next available slot type
  function getNextSlotType(): SlotType | null {
    if (slotCounts.batting < SLOT_COUNTS.batting) return "batting";
    if (slotCounts.bowling < SLOT_COUNTS.bowling) return "bowling";
    if (slotCounts.allrounder < SLOT_COUNTS.allrounder) return "allrounder";
    return null;
  }

  function addPlayer(player: EligiblePlayer) {
    if (squad.length >= 11) return;
    const slotType = getNextSlotType();
    if (!slotType) return;

    setSquad((prev) => [
      ...prev,
      {
        playCricketId: player.play_cricket_id,
        playerName: player.player_name,
        sandwichCost: player.sandwich_cost,
        isCaptain: prev.length === 0, // First player is captain by default
        slotType,
        isWicketkeeper: prev.length === 0, // First player is WK by default
      },
    ]);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function removePlayer(playCricketId: string) {
    setSquad((prev) => prev.filter((p) => p.playCricketId !== playCricketId));
    setSaveError(null);
    setSaveSuccess(false);
  }

  function setCaptain(playCricketId: string) {
    setSquad((prev) =>
      prev.map((p) => ({
        ...p,
        isCaptain: p.playCricketId === playCricketId,
      })),
    );
  }

  function setWicketkeeper(playCricketId: string) {
    setSquad((prev) =>
      prev.map((p) => ({
        ...p,
        isWicketkeeper: p.playCricketId === playCricketId,
      })),
    );
  }

  function setSlotType(playCricketId: string, slotType: SlotType) {
    setSquad((prev) =>
      prev.map((p) =>
        p.playCricketId === playCricketId ? { ...p, slotType } : p,
      ),
    );
  }

  // Available players (filtered)
  const availablePlayers = useMemo(() => {
    if (!playersQuery.data) return [];
    return playersQuery.data.players
      .filter((p) => !squadPlayerIds.has(p.play_cricket_id))
      .filter(
        (p) =>
          !search || p.player_name.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => b.previousSeasonPoints - a.previousSeasonPoints);
  }, [playersQuery.data, squadPlayerIds, search]);

  // Drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setSquad((prev) => {
      const oldIndex = prev.findIndex((p) => p.playCricketId === active.id);
      const newIndex = prev.findIndex((p) => p.playCricketId === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const copy = [...prev];
      const [moved] = copy.splice(oldIndex, 1);
      copy.splice(newIndex, 0, moved);
      return copy;
    });
  }

  const isLoading = playersQuery.isPending || teamQuery.isPending;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-3xl font-bold">My Fantasy Team</h1>
        <div className="space-y-2">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  const chaosWeek = teamQuery.data?.chaosWeek;
  const transfersUsed = teamQuery.data?.transfersUsed ?? 0;
  const maxTransfers = teamQuery.data?.maxTransfers ?? null;
  const tripleCaptain = chipQuery.data?.chips.find(
    (c) => c.chipType === "triple_captain",
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">My Fantasy Team</h1>
        <Link to="/fantasy">
          <Button variant="outline" size="sm">
            Fantasy Home
          </Button>
        </Link>
      </div>

      {/* Chaos week banner */}
      {chaosWeek && (
        <Alert className="mb-4 border-amber-400 bg-amber-50 text-amber-800">
          <strong>Chaos Week: {chaosWeek.name}</strong> —{" "}
          {chaosWeek.description}
        </Alert>
      )}

      {/* Status bar */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 py-3">
          <div className="text-sm">
            <span className="font-medium">Budget:</span>{" "}
            <span
              className={
                budgetRemaining < 0
                  ? "font-bold text-red-600"
                  : "text-green-600"
              }
            >
              {budgetRemaining}/{BUDGET}
            </span>
          </div>
          <div className="text-sm">
            <span className="font-medium">Squad:</span> {squad.length}/11
          </div>
          <div className="text-sm">
            <span className="font-medium">Slots:</span> {slotCounts.batting}/
            {SLOT_COUNTS.batting} bat, {slotCounts.bowling}/
            {SLOT_COUNTS.bowling} bowl, {slotCounts.allrounder}/
            {SLOT_COUNTS.allrounder} AR
          </div>
          {maxTransfers !== null && (
            <div className="text-sm">
              <span className="font-medium">Transfers:</span> {transfersUsed}/
              {maxTransfers}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate(squad)}
            >
              {saveMutation.isPending ? "Saving..." : "Save Team"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {saveError && (
        <Alert className="mb-4 border-red-400 bg-red-50 text-red-800">
          {saveError}
        </Alert>
      )}
      {saveSuccess && (
        <Alert className="mb-4 border-green-400 bg-green-50 text-green-800">
          Team saved successfully!
        </Alert>
      )}

      {/* Triple Captain chip */}
      {tripleCaptain && teamQuery.data?.team && teamQuery.data.gameweek > 0 && (
        <Card className="mb-4">
          <CardContent className="flex items-center justify-between py-3">
            <div className="text-sm">
              <strong>Triple Captain</strong> — 3x captain multiplier.{" "}
              {tripleCaptain.usedThisSeason}/{tripleCaptain.maxPerSeason} used
              this season.
            </div>
            <Button
              size="sm"
              variant={
                tripleCaptain.activeThisGameweek ? "destructive" : "outline"
              }
              disabled={
                chipMutation.isPending ||
                (!tripleCaptain.activeThisGameweek &&
                  tripleCaptain.usedThisSeason >= tripleCaptain.maxPerSeason)
              }
              onClick={() =>
                chipMutation.mutate({
                  action: tripleCaptain.activeThisGameweek
                    ? "deactivate"
                    : "activate",
                })
              }
            >
              {tripleCaptain.activeThisGameweek ? "Deactivate" : "Activate"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Squad */}
        <Card>
          <CardHeader>
            <CardTitle>Your Squad</CardTitle>
          </CardHeader>
          <CardContent>
            {squad.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Search and add players from the right panel to build your squad.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={squad.map((p) => p.playCricketId)}
                  strategy={verticalListSortingStrategy}
                >
                  {(["batting", "bowling", "allrounder"] as const).map(
                    (slot) => {
                      const slotPlayers = squad.filter(
                        (p) => p.slotType === slot,
                      );
                      if (slotPlayers.length === 0) return null;

                      return (
                        <div key={slot} className="mb-3">
                          <p className="text-muted-foreground mb-1 text-xs font-semibold uppercase">
                            {slot} ({slotPlayers.length}/{SLOT_COUNTS[slot]})
                          </p>
                          {slotPlayers.map((p) => (
                            <SortableSquadRow
                              key={p.playCricketId}
                              player={p}
                              onRemove={() => removePlayer(p.playCricketId)}
                              onSetCaptain={() => setCaptain(p.playCricketId)}
                              onSetWk={() => setWicketkeeper(p.playCricketId)}
                              onSetSlot={(s) => setSlotType(p.playCricketId, s)}
                            />
                          ))}
                        </div>
                      );
                    },
                  )}
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        {/* Available Players */}
        <Card>
          <CardHeader>
            <CardTitle>Available Players</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3"
            />
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Prev Pts</TableHead>
                    <TableHead className="text-right">Owned</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availablePlayers.slice(0, 50).map((p) => (
                    <TableRow key={p.play_cricket_id}>
                      <TableCell className="text-sm">{p.player_name}</TableCell>
                      <TableCell className="text-right text-sm">
                        {p.sandwich_cost}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {p.previousSeasonPoints}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {p.ownershipPercent}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={squad.length >= 11 || !getNextSlotType()}
                          onClick={() => addPlayer(p)}
                        >
                          +
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable Squad Row
// ---------------------------------------------------------------------------

function SortableSquadRow({
  player,
  onRemove,
  onSetCaptain,
  onSetWk,
  onSetSlot,
}: {
  player: SelectedPlayer;
  onRemove: () => void;
  onSetCaptain: () => void;
  onSetWk: () => void;
  onSetSlot: (s: SlotType) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: player.playCricketId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="mb-1 flex items-center gap-2 rounded border bg-white p-2 text-sm"
    >
      <span
        {...attributes}
        {...listeners}
        className="text-muted-foreground cursor-grab"
      >
        &#x2630;
      </span>
      <span className="flex-1 font-medium">{player.playerName}</span>
      <span className="text-muted-foreground">{player.sandwichCost}</span>

      {/* Slot selector */}
      <select
        value={player.slotType}
        onChange={(e) => onSetSlot(e.target.value as SlotType)}
        className="rounded border px-1 py-0.5 text-xs"
      >
        <option value="batting">Bat</option>
        <option value="bowling">Bowl</option>
        <option value="allrounder">AR</option>
      </select>

      <Button
        size="sm"
        variant={player.isCaptain ? "default" : "ghost"}
        className="h-6 w-6 p-0 text-xs"
        onClick={onSetCaptain}
        title="Set as Captain"
      >
        C
      </Button>
      <Button
        size="sm"
        variant={player.isWicketkeeper ? "default" : "ghost"}
        className="h-6 w-6 p-0 text-xs"
        onClick={onSetWk}
        title="Set as Wicketkeeper"
      >
        W
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0 text-xs text-red-500"
        onClick={onRemove}
        title="Remove"
      >
        &times;
      </Button>
    </div>
  );
}
