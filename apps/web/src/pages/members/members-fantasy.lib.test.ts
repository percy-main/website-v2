import { describe, expect, it } from "vitest";
import {
  BUDGET,
  calculateSquadCost,
  canDropOnSlot,
  countSlots,
  ensureCaptain,
  getNextSlotType,
  moveSquadPlayerToSlot,
  parseEmptySlotId,
  reorderWithinSlot,
  SLOT_COUNTS,
  validateSquadComposition,
  type SelectedPlayer,
  type SlotType,
} from "./members-fantasy.lib";

function makePlayer(
  id: string,
  overrides: Partial<SelectedPlayer> = {},
): SelectedPlayer {
  return {
    playCricketId: id,
    playerName: `Player ${id}`,
    sandwichCost: 2,
    isCaptain: false,
    slotType: "batting",
    isWicketkeeper: false,
    ...overrides,
  };
}

function makeFullSquad(): SelectedPlayer[] {
  const batters = Array.from({ length: SLOT_COUNTS.batting }, (_, i) =>
    makePlayer(`bat-${i}`, {
      slotType: "batting",
      isCaptain: i === 0,
      isWicketkeeper: i === 0,
      sandwichCost: 2,
    }),
  );
  const bowlers = Array.from({ length: SLOT_COUNTS.bowling }, (_, i) =>
    makePlayer(`bow-${i}`, { slotType: "bowling", sandwichCost: 3 }),
  );
  const ar = Array.from({ length: SLOT_COUNTS.allrounder }, (_, i) =>
    makePlayer(`ar-${i}`, { slotType: "allrounder", sandwichCost: 4 }),
  );
  return [...batters, ...bowlers, ...ar];
}

describe("parseEmptySlotId", () => {
  it("parses a valid empty-slot id and returns the slot type", () => {
    expect(parseEmptySlotId("empty-slot:batting:0")).toBe("batting");
    expect(parseEmptySlotId("empty-slot:bowling:3")).toBe("bowling");
    expect(parseEmptySlotId("empty-slot:allrounder:0")).toBe("allrounder");
  });

  it("returns null for ids that don't match the prefix", () => {
    expect(parseEmptySlotId("player-123")).toBeNull();
    expect(parseEmptySlotId("")).toBeNull();
  });

  it("returns null for an unknown slot type", () => {
    expect(parseEmptySlotId("empty-slot:keeper:0")).toBeNull();
  });
});

describe("calculateSquadCost", () => {
  it("returns 0 for an empty squad", () => {
    expect(calculateSquadCost([])).toBe(0);
  });

  it("sums sandwich costs across the squad", () => {
    const squad = [
      makePlayer("a", { sandwichCost: 1 }),
      makePlayer("b", { sandwichCost: 2 }),
      makePlayer("c", { sandwichCost: 5 }),
    ];
    expect(calculateSquadCost(squad)).toBe(8);
  });
});

describe("countSlots", () => {
  it("returns zero counts for an empty squad", () => {
    expect(countSlots([])).toEqual({ batting: 0, bowling: 0, allrounder: 0 });
  });

  it("counts each slot type correctly", () => {
    const squad = [
      makePlayer("a", { slotType: "batting" }),
      makePlayer("b", { slotType: "batting" }),
      makePlayer("c", { slotType: "bowling" }),
      makePlayer("d", { slotType: "allrounder" }),
    ];
    expect(countSlots(squad)).toEqual({
      batting: 2,
      bowling: 1,
      allrounder: 1,
    });
  });
});

describe("getNextSlotType", () => {
  it("returns 'batting' for an empty squad", () => {
    expect(getNextSlotType([])).toBe("batting");
  });

  it("falls back to bowling once batting is full", () => {
    const squad = Array.from({ length: SLOT_COUNTS.batting }, (_, i) =>
      makePlayer(`b${i}`, { slotType: "batting" }),
    );
    expect(getNextSlotType(squad)).toBe("bowling");
  });

  it("falls back to allrounder once batting and bowling are full", () => {
    const squad = [
      ...Array.from({ length: SLOT_COUNTS.batting }, (_, i) =>
        makePlayer(`b${i}`, { slotType: "batting" }),
      ),
      ...Array.from({ length: SLOT_COUNTS.bowling }, (_, i) =>
        makePlayer(`bo${i}`, { slotType: "bowling" }),
      ),
    ];
    expect(getNextSlotType(squad)).toBe("allrounder");
  });

  it("returns null when the squad is full", () => {
    expect(getNextSlotType(makeFullSquad())).toBeNull();
  });
});

describe("validateSquadComposition", () => {
  it("returns isValid=false and three messages for an empty squad", () => {
    const result = validateSquadComposition([]);
    expect(result.isValid).toBe(false);
    expect(result.messages).toEqual([
      `Batting: 0/${SLOT_COUNTS.batting}`,
      `Bowling: 0/${SLOT_COUNTS.bowling}`,
      `All-rounder: 0/${SLOT_COUNTS.allrounder}`,
    ]);
    expect(result.totalCost).toBe(0);
  });

  it("returns isValid=true for a well-formed squad within budget", () => {
    const squad = makeFullSquad();
    const result = validateSquadComposition(squad);
    expect(result.isValid).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.hasCaptain).toBe(true);
    expect(result.hasWicketkeeper).toBe(true);
    expect(result.isFullSize).toBe(true);
    expect(result.withinBudget).toBe(true);
  });

  it("flags over-budget squads as invalid but still within slot composition", () => {
    const squad = makeFullSquad().map((p) => ({ ...p, sandwichCost: 4 }));
    const result = validateSquadComposition(squad);
    expect(result.totalCost).toBeGreaterThan(BUDGET);
    expect(result.withinBudget).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it("flags missing captain as invalid", () => {
    const squad = makeFullSquad().map((p) => ({ ...p, isCaptain: false }));
    const result = validateSquadComposition(squad);
    expect(result.hasCaptain).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it("flags missing wicketkeeper as invalid", () => {
    const squad = makeFullSquad().map((p) => ({ ...p, isWicketkeeper: false }));
    const result = validateSquadComposition(squad);
    expect(result.hasWicketkeeper).toBe(false);
    expect(result.isValid).toBe(false);
  });
});

describe("canDropOnSlot", () => {
  it("allows dropping back on the same slot type even when full", () => {
    const squad = makeFullSquad();
    const player = squad.find((p) => p.slotType === "batting")!;
    expect(canDropOnSlot(squad, player, "batting")).toBe(true);
  });

  it("rejects dropping onto a full slot of a different type", () => {
    const squad = makeFullSquad();
    const player = squad.find((p) => p.slotType === "batting")!;
    expect(canDropOnSlot(squad, player, "allrounder")).toBe(false);
  });

  it("allows dropping onto a different slot that has capacity", () => {
    const squad: SelectedPlayer[] = [
      makePlayer("a", { slotType: "batting" }),
    ];
    const player = squad[0]!;
    expect(canDropOnSlot(squad, player, "bowling")).toBe(true);
  });
});

describe("ensureCaptain", () => {
  it("does nothing if a captain already exists", () => {
    const squad = [
      makePlayer("a", { slotType: "batting", isCaptain: true }),
      makePlayer("b", { slotType: "bowling" }),
    ];
    expect(ensureCaptain(squad)).toEqual(squad);
  });

  it("promotes the first non-allrounder when captain is missing", () => {
    const squad = [
      makePlayer("a", { slotType: "allrounder" }),
      makePlayer("b", { slotType: "bowling" }),
      makePlayer("c", { slotType: "batting" }),
    ];
    const result = ensureCaptain(squad);
    expect(result.find((p) => p.playCricketId === "b")?.isCaptain).toBe(true);
    expect(result.find((p) => p.playCricketId === "a")?.isCaptain).toBe(false);
    expect(result.find((p) => p.playCricketId === "c")?.isCaptain).toBe(false);
  });

  it("returns the squad unchanged when only allrounders exist", () => {
    const squad = [
      makePlayer("a", { slotType: "allrounder" }),
      makePlayer("b", { slotType: "allrounder" }),
    ];
    expect(ensureCaptain(squad).every((p) => !p.isCaptain)).toBe(true);
  });
});

describe("moveSquadPlayerToSlot", () => {
  it("moves a player into the new slot type", () => {
    const squad = [
      makePlayer("a", { slotType: "batting", isCaptain: true }),
      makePlayer("b", { slotType: "bowling" }),
    ];
    const result = moveSquadPlayerToSlot(squad, "b", "batting");
    expect(result.find((p) => p.playCricketId === "b")?.slotType).toBe(
      "batting",
    );
  });

  it("clears captain when moving to allrounder and reassigns to a non-AR player", () => {
    const squad = [
      makePlayer("a", { slotType: "batting", isCaptain: true }),
      makePlayer("b", { slotType: "bowling" }),
    ];
    const result = moveSquadPlayerToSlot(squad, "a", "allrounder");
    const a = result.find((p) => p.playCricketId === "a");
    const b = result.find((p) => p.playCricketId === "b");
    expect(a?.slotType).toBe("allrounder");
    expect(a?.isCaptain).toBe(false);
    expect(b?.isCaptain).toBe(true);
  });

  it("returns a new array and does not mutate the input", () => {
    const squad: ReadonlyArray<SelectedPlayer> = [
      makePlayer("a", { slotType: "batting", isCaptain: true }),
    ];
    const before = JSON.stringify(squad);
    moveSquadPlayerToSlot(squad, "a", "bowling");
    expect(JSON.stringify(squad)).toBe(before);
  });

  it("is a no-op when the player isn't in the squad", () => {
    const squad = [
      makePlayer("a", { slotType: "batting", isCaptain: true }),
    ];
    const result = moveSquadPlayerToSlot(squad, "missing", "bowling" as SlotType);
    expect(result).toEqual(squad);
  });
});

describe("reorderWithinSlot", () => {
  it("moves the active player to the over player's index", () => {
    const squad = [
      makePlayer("a", { slotType: "batting" }),
      makePlayer("b", { slotType: "batting" }),
      makePlayer("c", { slotType: "batting" }),
    ];
    const result = reorderWithinSlot(squad, "c", "a");
    expect(result.map((p) => p.playCricketId)).toEqual(["c", "a", "b"]);
  });

  it("returns the squad unchanged if active and over are in different slots", () => {
    const squad = [
      makePlayer("a", { slotType: "batting" }),
      makePlayer("b", { slotType: "bowling" }),
    ];
    const result = reorderWithinSlot(squad, "a", "b");
    expect(result.map((p) => p.playCricketId)).toEqual(["a", "b"]);
  });

  it("is a no-op when the active id is unknown", () => {
    const squad = [makePlayer("a"), makePlayer("b")];
    expect(reorderWithinSlot(squad, "missing", "a")).toEqual(squad);
  });
});
