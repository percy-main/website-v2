import { ShareMyTeamButton } from "@/components/fantasy/share-my-team-button.js";
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
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen.js";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  BUDGET,
  countSlots,
  EMPTY_SLOT_PREFIX,
  getNextSlotType as getNextSlotTypeFromSquad,
  moveSquadPlayerToSlot,
  parseEmptySlotId,
  reorderWithinSlot,
  SLOT_COUNTS,
  validateSquadComposition,
  type SelectedPlayer,
  type SlotType,
} from "./members-fantasy.lib";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SandwichCost({ cost }: { cost: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-sm whitespace-nowrap"
      title={`Sandwich cost: ${cost}`}
    >
      {"🥪".repeat(cost)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useEligiblePlayers() {
  return useQuery({
    queryKey: ["fantasy", "eligible-players"],
    queryFn: () => callApi(api.GET("/api/fantasy/players")),
    staleTime: 5 * 60_000,
  });
}

function useMyTeam() {
  return useQuery({
    queryKey: ["fantasy", "my-team"],
    queryFn: async () => {
      const data = await callApi(api.GET("/api/fantasy/team"));
      return data as unknown as MyTeamResponse;
    },
    staleTime: 30_000,
  });
}

function useChipStatus() {
  return useQuery({
    queryKey: ["fantasy", "chip-status"],
    queryFn: () => callApi(api.GET("/api/fantasy/chip")),
    staleTime: 30_000,
  });
}

type EligiblePlayer =
  paths["/api/fantasy/players"]["get"]["responses"][200]["content"]["application/json"]["players"][number];
type ChipStatus =
  paths["/api/fantasy/chip"]["get"]["responses"][200]["content"]["application/json"];

// The generated spec types `/api/fantasy/team` players as `{ [key: string]: unknown }[]`
// because Fastify serialises the response without a strict schema for the array items.
// We define the shape explicitly here until the OpenAPI spec is tightened.
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
  maxTransfers: number | null;
  chaosWeek: {
    name: string;
    description: string;
    rule_type: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Container — fetches data, handles loading/error, renders TeamBuilder
// ---------------------------------------------------------------------------

export function Component() {
  useDocumentMeta("My Fantasy Team");
  const playersQuery = useEligiblePlayers();
  const teamQuery = useMyTeam();
  const chipQuery = useChipStatus();

  if (playersQuery.isPending || teamQuery.isPending) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-3xl font-semibold">My Fantasy Team</h1>
        <div className="space-y-2">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-stone-200" />
          ))}
        </div>
      </div>
    );
  }

  if (playersQuery.error || teamQuery.error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-3xl font-semibold">My Fantasy Team</h1>
        <p className="text-center text-red-600">
          Failed to load fantasy data. Please try again.
        </p>
      </div>
    );
  }

  // Data is guaranteed non-null below this point
  const initialSquad: SelectedPlayer[] =
    teamQuery.data.team && teamQuery.data.players.length > 0
      ? teamQuery.data.players.map((p) => ({
          playCricketId: p.play_cricket_id,
          playerName: p.player_name,
          sandwichCost: p.sandwich_cost,
          isCaptain: p.is_captain,
          slotType: p.slot_type as SlotType,
          isWicketkeeper: p.is_wicketkeeper,
        }))
      : [];

  return (
    <TeamBuilder
      initialSquad={initialSquad}
      eligiblePlayers={playersQuery.data.players}
      teamData={teamQuery.data}
      chipData={chipQuery.data ?? null}
    />
  );
}

// ---------------------------------------------------------------------------
// TeamBuilder — pure component, receives resolved data as props
// ---------------------------------------------------------------------------

function TeamBuilder({
  initialSquad,
  eligiblePlayers,
  teamData,
  chipData,
}: {
  initialSquad: SelectedPlayer[];
  eligiblePlayers: EligiblePlayer[];
  teamData: MyTeamResponse;
  chipData: ChipStatus | null;
}) {
  const queryClient = useQueryClient();

  // Seeded from initialSquad on mount; parent never re-renders TeamBuilder
  // with a different team for the same user, so a key isn't needed.
  const [squad, setSquad] = useState<SelectedPlayer[]>(() => initialSquad);
  const [search, setSearch] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (players: SelectedPlayer[]) =>
      callApi(
        api.POST("/api/fantasy/team", {
          body: {
            players: players.map((p) => ({
              playCricketId: p.playCricketId,
              isCaptain: p.isCaptain,
              slotType: p.slotType,
              isWicketkeeper: p.isWicketkeeper,
            })),
          },
        }),
      ),
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
        ? callApi(
            api.POST("/api/fantasy/chip", {
              body: { chipType: "triple_captain" },
            }),
          )
        : callApi(
            api.POST("/api/fantasy/chip/deactivate", {
              body: { chipType: "triple_captain" },
            }),
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["fantasy", "chip-status"],
      });
    },
  });

  const squadPlayerIds = new Set(squad.map((p) => p.playCricketId));

  const slotCounts = countSlots(squad);
  const validation = validateSquadComposition(squad);
  const totalCost = validation.totalCost;
  const canSave = validation.isValid;
  const validationMessages = validation.messages;

  // Get next available slot type given the current squad
  function getNextSlotType(): SlotType | null {
    return getNextSlotTypeFromSquad(squad);
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
        isCaptain: prev.length === 0,
        slotType,
        isWicketkeeper: prev.length === 0,
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
    setSquad((prev) => moveSquadPlayerToSlot(prev, playCricketId, slotType));
  }

  const availablePlayers = (() => {
    const term = search.toLowerCase();
    return eligiblePlayers
      .filter(
        (p) =>
          !squadPlayerIds.has(p.play_cricket_id) &&
          (!search || p.player_name.toLowerCase().includes(term)),
      )
      .toSorted((a, b) => b.previousSeasonPoints - a.previousSeasonPoints);
  })();

  const [activeId, setActiveId] = useState<string | null>(null);
  const activePlayer = activeId
    ? (squad.find((p) => p.playCricketId === activeId) ?? null)
    : null;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const overId = over.id as string;

    // Dropping onto an empty slot — change the dragged player's slot type
    const emptySlotType = parseEmptySlotId(overId);
    if (emptySlotType) {
      setSquad((prev) =>
        moveSquadPlayerToSlot(prev, active.id as string, emptySlotType),
      );
      return;
    }

    setSquad((prev) => {
      const activePlayer = prev.find((p) => p.playCricketId === active.id);
      const overPlayer = prev.find((p) => p.playCricketId === overId);
      if (!activePlayer || !overPlayer) return prev;

      // Different slot type: move dragged player to the target's section (no swap)
      if (activePlayer.slotType !== overPlayer.slotType) {
        return moveSquadPlayerToSlot(
          prev,
          active.id as string,
          overPlayer.slotType,
        );
      }

      // Same slot type: reorder within the section
      return reorderWithinSlot(prev, active.id as string, overId);
    });
  }

  const chaosWeek = teamData.chaosWeek;
  const transfersUsed = teamData.transfersUsed;
  const maxTransfers = teamData.maxTransfers;
  const tripleCaptain = chipData?.chips.find(
    (c) => c.chipType === "triple_captain",
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">My Fantasy Team</h1>
        <div className="flex gap-2">
          {teamData.team &&
            initialSquad.length === 11 &&
            JSON.stringify(squad) === JSON.stringify(initialSquad) && (
              <ShareMyTeamButton />
            )}
          <Link to="/fantasy">
            <Button variant="outline" size="sm">
              Fantasy Home
            </Button>
          </Link>
        </div>
      </div>

      {chaosWeek && (
        <Alert className="mb-4 border-amber-400 bg-amber-50 text-amber-800">
          <strong>Chaos Week: {chaosWeek.name}.</strong> {chaosWeek.description}
        </Alert>
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 py-3">
          <div className="text-sm">
            <span className="font-medium">Budget:</span>{" "}
            <span
              className={
                totalCost > BUDGET ? "font-bold text-red-600" : "text-green-600"
              }
            >
              {totalCost}/{BUDGET}
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
              {saveMutation.isPending ? "Saving…" : "Save Team"}
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

      {/* Validation warnings for slot distribution */}
      {squad.length > 0 && validationMessages.length > 0 && (
        <Alert className="mb-4 border-amber-400 bg-amber-50 text-amber-800">
          <strong>Fix slot distribution to save:</strong>{" "}
          {validationMessages.join(", ")}. Drag players between sections to
          adjust.
        </Alert>
      )}

      {tripleCaptain && teamData.team && teamData.gameweek > 0 && (
        <Card className="mb-4">
          <CardContent className="flex items-center justify-between py-3">
            <div className="text-sm">
              <strong>Triple Captain:</strong> 3x captain multiplier.{" "}
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
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                {(["batting", "bowling", "allrounder"] as const).map((slot) => {
                  const slotPlayers = squad.filter((p) => p.slotType === slot);
                  const isOverfilled = slotPlayers.length > SLOT_COUNTS[slot];
                  const emptyCount = Math.max(
                    0,
                    SLOT_COUNTS[slot] - slotPlayers.length,
                  );

                  return (
                    <div
                      key={slot}
                      className={`mb-3 ${isOverfilled ? "rounded border-2 border-red-300" : ""}`}
                    >
                      <p
                        className={`mb-1 text-xs font-semibold uppercase ${
                          isOverfilled
                            ? "text-red-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        {slot} ({slotPlayers.length}/{SLOT_COUNTS[slot]})
                      </p>
                      <SortableContext
                        items={slotPlayers.map((p) => p.playCricketId)}
                        strategy={verticalListSortingStrategy}
                      >
                        {slotPlayers.map((p) => (
                          <SortableSquadRow
                            key={p.playCricketId}
                            player={p}
                            isOverflow={isOverfilled}
                            onRemove={() => removePlayer(p.playCricketId)}
                            onSetCaptain={() => setCaptain(p.playCricketId)}
                            onSetWk={() => setWicketkeeper(p.playCricketId)}
                            onSetSlot={(s) => setSlotType(p.playCricketId, s)}
                          />
                        ))}
                      </SortableContext>
                      {/* Empty slot placeholders as drop targets */}
                      {Array.from({ length: emptyCount }).map((_, i) => (
                        <EmptySlotRow
                          key={`${slot}-empty-${i}`}
                          slotType={slot}
                          index={i}
                        />
                      ))}
                    </div>
                  );
                })}
                <DragOverlay>
                  {activePlayer && (
                    <div className="flex items-center gap-2 rounded border bg-white p-2 text-sm shadow-lg">
                      <span className="text-muted-foreground">&#x2630;</span>
                      <span className="flex-1 font-medium">
                        {activePlayer.playerName}
                      </span>
                      <SandwichCost cost={activePlayer.sandwichCost} />
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Available Players</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3"
            />
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-center">Cost</TableHead>
                    <TableHead className="text-right">Prev Pts</TableHead>
                    <TableHead className="text-right">Owned</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availablePlayers.slice(0, 50).map((p) => (
                    <TableRow key={p.play_cricket_id}>
                      <TableCell className="text-sm">{p.player_name}</TableCell>
                      <TableCell className="text-center text-sm">
                        <SandwichCost cost={p.sandwich_cost} />
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
// Empty Slot Row (drop target for cross-slot drag)
// ---------------------------------------------------------------------------

function EmptySlotRow({
  slotType,
  index,
}: {
  slotType: SlotType;
  index: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${EMPTY_SLOT_PREFIX}${slotType}:${index}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`mb-1 rounded border border-dashed p-2 text-center text-xs text-stone-400 ${
        isOver ? "border-blue-400 bg-blue-50" : ""
      }`}
    >
      Empty slot
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable Squad Row
// ---------------------------------------------------------------------------

function SortableSquadRow({
  player,
  isOverflow,
  onRemove,
  onSetCaptain,
  onSetWk,
  onSetSlot,
}: {
  player: SelectedPlayer;
  isOverflow: boolean;
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
      className={`mb-1 flex items-center gap-2 rounded border p-2 text-sm ${
        isOverflow ? "border-red-300 bg-red-50" : "bg-white"
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        className="text-muted-foreground cursor-grab"
      >
        &#x2630;
      </span>
      <span className="flex-1 font-medium">{player.playerName}</span>
      <SandwichCost cost={player.sandwichCost} />

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
        className="size-6 p-0 text-xs"
        onClick={onSetCaptain}
        title="Set as Captain"
      >
        C
      </Button>
      <Button
        size="sm"
        variant={player.isWicketkeeper ? "default" : "ghost"}
        className="size-6 p-0 text-xs"
        onClick={onSetWk}
        title="Set as Wicketkeeper"
      >
        W
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="size-6 p-0 text-xs text-red-500"
        onClick={onRemove}
        title="Remove"
      >
        &times;
      </Button>
    </div>
  );
}
