// ---------------------------------------------------------------------------
// Pure helpers extracted from members-fantasy.tsx for unit testing.
// No React, no react-query, no DOM dependencies — only data shape transforms
// and validation logic. Wired back into the component as-is.
// ---------------------------------------------------------------------------

export type SlotType = "batting" | "bowling" | "allrounder";

export interface SelectedPlayer {
  playCricketId: string;
  playerName: string;
  sandwichCost: number;
  isCaptain: boolean;
  slotType: SlotType;
  isWicketkeeper: boolean;
}

export const SLOT_COUNTS: Record<SlotType, number> = {
  batting: 6,
  bowling: 4,
  allrounder: 1,
};
export const BUDGET = 30;
export const SQUAD_SIZE = 11;
export const EMPTY_SLOT_PREFIX = "empty-slot:";

const SLOT_TYPES: readonly SlotType[] = ["batting", "bowling", "allrounder"];

/** Returns true for one of the three valid SlotType strings. */
export function isSlotType(value: string): value is SlotType {
  return (SLOT_TYPES as readonly string[]).includes(value);
}

/**
 * Parse a droppable id of the form `empty-slot:<slotType>:<index>`.
 * Returns the slot type if valid, otherwise null.
 */
export function parseEmptySlotId(id: string): SlotType | null {
  if (!id.startsWith(EMPTY_SLOT_PREFIX)) return null;
  const rest = id.slice(EMPTY_SLOT_PREFIX.length);
  const [slotType] = rest.split(":");
  return slotType !== undefined && isSlotType(slotType) ? slotType : null;
}

/** Sum of sandwich costs for the squad. */
export function calculateSquadCost(squad: readonly SelectedPlayer[]): number {
  return squad.reduce((sum, p) => sum + p.sandwichCost, 0);
}

/** Tally of how many players each slot currently has. */
export function countSlots(
  squad: readonly SelectedPlayer[],
): Record<SlotType, number> {
  const counts: Record<SlotType, number> = {
    batting: 0,
    bowling: 0,
    allrounder: 0,
  };
  for (const p of squad) counts[p.slotType]++;
  return counts;
}

/**
 * Returns the next slot type with capacity (in priority order:
 * batting → bowling → allrounder), or null if all slots are full.
 */
export function getNextSlotType(
  squad: readonly SelectedPlayer[],
): SlotType | null {
  const counts = countSlots(squad);
  if (counts.batting < SLOT_COUNTS.batting) return "batting";
  if (counts.bowling < SLOT_COUNTS.bowling) return "bowling";
  if (counts.allrounder < SLOT_COUNTS.allrounder) return "allrounder";
  return null;
}

/**
 * Validation result describing which slot constraints are violated.
 * messages is a list of "<Slot>: <count>/<limit>" strings for slots that
 * don't match the required count.
 */
export interface SquadValidation {
  isValid: boolean;
  messages: string[];
  totalCost: number;
  withinBudget: boolean;
  hasCaptain: boolean;
  hasWicketkeeper: boolean;
  isFullSize: boolean;
}

/**
 * Validate a squad for save eligibility. Encapsulates every constraint
 * the Save button checks, plus the slot-distribution warning messages.
 */
export function validateSquadComposition(
  squad: readonly SelectedPlayer[],
): SquadValidation {
  const counts = countSlots(squad);
  const totalCost = calculateSquadCost(squad);
  const captainCount = squad.filter((p) => p.isCaptain).length;
  const wkCount = squad.filter((p) => p.isWicketkeeper).length;

  const messages: string[] = [];
  if (counts.batting !== SLOT_COUNTS.batting) {
    messages.push(`Batting: ${counts.batting}/${SLOT_COUNTS.batting}`);
  }
  if (counts.bowling !== SLOT_COUNTS.bowling) {
    messages.push(`Bowling: ${counts.bowling}/${SLOT_COUNTS.bowling}`);
  }
  if (counts.allrounder !== SLOT_COUNTS.allrounder) {
    messages.push(
      `All-rounder: ${counts.allrounder}/${SLOT_COUNTS.allrounder}`,
    );
  }

  const hasCaptain = captainCount === 1;
  const hasWicketkeeper = wkCount === 1;
  const isFullSize = squad.length === SQUAD_SIZE;
  const withinBudget = totalCost <= BUDGET;

  const isValid =
    isFullSize &&
    hasCaptain &&
    hasWicketkeeper &&
    counts.batting === SLOT_COUNTS.batting &&
    counts.bowling === SLOT_COUNTS.bowling &&
    counts.allrounder === SLOT_COUNTS.allrounder &&
    withinBudget;

  return {
    isValid,
    messages,
    totalCost,
    withinBudget,
    hasCaptain,
    hasWicketkeeper,
    isFullSize,
  };
}

/**
 * Determine whether a given player can be dropped on a target slot.
 * - same slot is allowed (reorder)
 * - dropping into a slot whose target capacity is full and the player isn't
 *   already in that slot is rejected.
 */
export function canDropOnSlot(
  squad: readonly SelectedPlayer[],
  player: SelectedPlayer,
  targetSlot: SlotType,
): boolean {
  if (player.slotType === targetSlot) return true;
  const counts = countSlots(squad);
  return counts[targetSlot] < SLOT_COUNTS[targetSlot];
}

/**
 * Move a player to a new slot type, applying:
 * - allrounder slots cannot hold the captain (auto-clears `isCaptain`)
 * - if no captain remains, promote the first non-allrounder player.
 */
export function moveSquadPlayerToSlot(
  squad: readonly SelectedPlayer[],
  playCricketId: string,
  targetSlot: SlotType,
): SelectedPlayer[] {
  const updated = squad.map((p) => {
    if (p.playCricketId !== playCricketId) return p;
    const next: SelectedPlayer = { ...p, slotType: targetSlot };
    if (targetSlot === "allrounder" && p.isCaptain) {
      next.isCaptain = false;
    }
    return next;
  });
  return ensureCaptain(updated);
}

/**
 * If no player in the squad is captain, promote the first non-allrounder
 * player to captain. If all players are allrounders (or list is empty),
 * the squad is returned untouched.
 */
export function ensureCaptain(
  squad: readonly SelectedPlayer[],
): SelectedPlayer[] {
  if (squad.some((p) => p.isCaptain)) return squad.slice();
  const first = squad.find((p) => p.slotType !== "allrounder");
  if (!first) return squad.slice();
  return squad.map((p) =>
    p.playCricketId === first.playCricketId ? { ...p, isCaptain: true } : p,
  );
}

/**
 * Reorder within a single slot: move `activeId` to the position currently
 * held by `overId`. If either id isn't found or the players aren't in the
 * same slot, returns the squad unchanged.
 */
export function reorderWithinSlot(
  squad: readonly SelectedPlayer[],
  activeId: string,
  overId: string,
): SelectedPlayer[] {
  const active = squad.find((p) => p.playCricketId === activeId);
  const over = squad.find((p) => p.playCricketId === overId);
  if (!active || !over) return squad.slice();
  if (active.slotType !== over.slotType) return squad.slice();

  const result = squad.slice();
  const activeIdx = result.indexOf(active);
  const overIdx = result.indexOf(over);
  result.splice(activeIdx, 1);
  result.splice(overIdx, 0, active);
  return result;
}
