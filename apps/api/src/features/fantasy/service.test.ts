import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExecuteTakeFirst,
  mockExecuteTakeFirstOrThrow,
  mockExecute,
  mockQueryBuilder,
} = vi.hoisted(() => {
  const mockExecuteTakeFirst = vi.fn();
  const mockExecute = vi.fn();

  const mockExecuteTakeFirstOrThrow = vi.fn();

  const mockQueryBuilder = {
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    distinct: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    executeTakeFirst: mockExecuteTakeFirst,
    executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
    execute: mockExecute,
    transaction: vi.fn().mockReturnValue({
      execute: vi
        .fn()
        .mockImplementation(
          async (fn: (trx: unknown) => Promise<unknown>) =>
            await fn(mockQueryBuilder),
        ),
    }),
  };

  return {
    mockExecuteTakeFirst,
    mockExecuteTakeFirstOrThrow,
    mockExecute,
    mockQueryBuilder,
  };
});

vi.mock("kysely", () => ({
  sql: new Proxy(() => ({ as: () => "sql_expr" }), {
    get() {
      return () => ({ as: () => "sql_expr" });
    },
    apply() {
      return { as: () => "sql_expr" };
    },
  }),
}));

import {
  getCurrentGameweek,
  getCurrentSeason,
  getPreviousSeason,
} from "./gameweek.ts";
import type { PlayerInput } from "./schemas.ts";
import {
  getEligiblePlayers,
  populatePlayers,
  saveTeam,
  toggleEligibility,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

function makePlayer(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    playCricketId: `player-${Math.random().toString(36).slice(2, 6)}`,
    isCaptain: false,
    slotType: "batting",
    isWicketkeeper: false,
    ...overrides,
  };
}

function makeValidSquad(): PlayerInput[] {
  return [
    // 6 batting
    makePlayer({
      playCricketId: "bat-1",
      slotType: "batting",
      isCaptain: true,
    }),
    makePlayer({ playCricketId: "bat-2", slotType: "batting" }),
    makePlayer({ playCricketId: "bat-3", slotType: "batting" }),
    makePlayer({ playCricketId: "bat-4", slotType: "batting" }),
    makePlayer({ playCricketId: "bat-5", slotType: "batting" }),
    makePlayer({ playCricketId: "bat-6", slotType: "batting" }),
    // 4 bowling
    makePlayer({ playCricketId: "bowl-1", slotType: "bowling" }),
    makePlayer({ playCricketId: "bowl-2", slotType: "bowling" }),
    makePlayer({ playCricketId: "bowl-3", slotType: "bowling" }),
    makePlayer({ playCricketId: "bowl-4", slotType: "bowling" }),
    // 1 allrounder
    makePlayer({
      playCricketId: "ar-1",
      slotType: "allrounder",
      isWicketkeeper: true,
    }),
  ];
}

describe("gameweek utilities", () => {
  it("getCurrentSeason returns a 4-digit year string", () => {
    const season = getCurrentSeason();
    expect(season).toMatch(/^\d{4}$/);
  });

  it("getCurrentGameweek returns a non-negative number", () => {
    const gw = getCurrentGameweek();
    expect(gw).toBeGreaterThanOrEqual(0);
  });

  it("getPreviousSeason returns one year less", () => {
    expect(getPreviousSeason("2025")).toBe("2024");
    expect(getPreviousSeason("2020")).toBe("2019");
  });
});

describe("fantasy service", () => {
  beforeEach(() => {
    // Pin to a Wednesday so weekend-lock logic never fires
    vi.useFakeTimers({ now: new Date("2026-03-18T12:00:00Z") });
    vi.resetAllMocks();
    // Reset chain methods to return the builder
    for (const key of Object.keys(mockQueryBuilder)) {
      const fn = mockQueryBuilder[key as keyof typeof mockQueryBuilder];
      if (typeof fn === "function" && "mockReturnValue" in fn) {
        if (key === "executeTakeFirst") {
          mockExecuteTakeFirst.mockResolvedValue(undefined);
        } else if (key === "executeTakeFirstOrThrow") {
          mockExecuteTakeFirstOrThrow.mockResolvedValue({});
        } else if (key === "execute") {
          mockExecute.mockResolvedValue([]);
        } else if (key === "transaction") {
          (fn as ReturnType<typeof vi.fn>).mockReturnValue({
            execute: vi
              .fn()
              .mockImplementation(
                async (cb: (trx: unknown) => Promise<unknown>) =>
                  await cb(mockQueryBuilder),
              ),
          });
        } else {
          (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
        }
      }
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getEligiblePlayers", () => {
    it("returns only eligible players with enriched data", async () => {
      // First call: fantasy_player where eligible=true
      // Second call: fantasy_player_score aggregation
      // Third call: ownership
      // Fourth call: team count
      const eligiblePlayer = {
        play_cricket_id: "p1",
        player_name: "Test Player",
        eligible: true,
        sandwich_cost: 3,
      };

      mockExecute
        .mockResolvedValueOnce([eligiblePlayer]) // eligible players
        .mockResolvedValueOnce([]) // previous points
        .mockResolvedValueOnce([]); // ownership

      mockExecuteTakeFirst.mockResolvedValueOnce({ total: 0 }); // team count

      const result = await getEligiblePlayers(db)("2025");

      expect(result.season).toBe("2025");
      expect(result.previousSeason).toBe("2024");
      expect(result.budget).toBe(30);
      expect(result.players).toHaveLength(1);
      expect(result.players[0].previousSeasonPoints).toBe(0);
      expect(result.players[0].ownershipPercent).toBe(0);
    });
  });

  describe("saveTeam", () => {
    it("rejects squad with wrong batting count", async () => {
      const badSquad = [
        // 7 batting (too many)
        ...Array.from({ length: 7 }, (_, i) =>
          makePlayer({ playCricketId: `bat-${i}`, slotType: "batting" }),
        ),
        // 3 bowling (too few)
        ...Array.from({ length: 3 }, (_, i) =>
          makePlayer({ playCricketId: `bowl-${i}`, slotType: "bowling" }),
        ),
        // 1 allrounder
        makePlayer({ playCricketId: "ar-1", slotType: "allrounder" }),
      ];
      badSquad[0].isCaptain = true;

      await expect(saveTeam(db)("user-1", badSquad, "2025")).rejects.toThrow(
        "Must have exactly 6 batting slots",
      );
    });

    it("rejects squad exceeding budget", async () => {
      const squad = makeValidSquad();

      // Mock chaos week check
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      // Mock DB players with high costs (all cost 5 = 55 total, over 30 budget)
      const expensivePlayers = squad.map((p) => ({
        play_cricket_id: p.playCricketId,
        sandwich_cost: 5,
      }));

      mockExecute.mockResolvedValueOnce(expensivePlayers);

      await expect(saveTeam(db)("user-1", squad, "2025")).rejects.toThrow(
        /budget/,
      );
    });

    it("rejects squad with no captain", async () => {
      const squad = makeValidSquad();
      // Remove captain flag from all
      for (const p of squad) p.isCaptain = false;

      await expect(saveTeam(db)("user-1", squad, "2025")).rejects.toThrow(
        /captain/,
      );
    });

    it("rejects squad with 2 captains", async () => {
      const squad = makeValidSquad();
      squad[1].isCaptain = true; // second captain

      await expect(saveTeam(db)("user-1", squad, "2025")).rejects.toThrow(
        /captain/,
      );
    });

    it("creates new team when none exists", async () => {
      const squad = makeValidSquad();

      // Mock chaos week check
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      // Mock eligible players check (budget)
      const cheapPlayers = squad.map((p) => ({
        play_cricket_id: p.playCricketId,
        sandwich_cost: 1,
        eligible: true,
      }));
      mockExecute.mockResolvedValueOnce(cheapPlayers);

      // No existing team (inside transaction)
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      // insertInto("fantasy_team").returning("id").executeTakeFirstOrThrow()
      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce({ id: "new-team-id" });

      // Subsequent execute calls for inserts
      mockExecute.mockResolvedValue([]);

      const result = await saveTeam(db)("user-1", squad, "2025");

      expect(result.isNew).toBe(true);
      expect(result.teamId).toBeDefined();
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("fantasy_team");
    });
  });

  describe("toggleEligibility", () => {
    it("updates player eligibility", async () => {
      mockExecute.mockResolvedValueOnce([]);

      const result = await toggleEligibility(db)("p1", true);

      expect(result).toEqual({ playCricketId: "p1", eligible: true });
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith(
        "fantasy_player",
      );
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({ eligible: true });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "play_cricket_id",
        "=",
        "p1",
      );
    });
  });

  describe("populatePlayers", () => {
    it("upserts players from match performance data", async () => {
      const battingPlayers = [
        { player_id: "p1", player_name: "Alice" },
        { player_id: "p2", player_name: "Bob" },
      ];
      const bowlingPlayers = [
        { player_id: "p2", player_name: "Bob" },
        { player_id: "p3", player_name: "Charlie" },
      ];
      const fieldingPlayers = [{ player_id: "p1", player_name: "Alice" }];

      mockExecute
        .mockResolvedValueOnce(battingPlayers)
        .mockResolvedValueOnce(bowlingPlayers)
        .mockResolvedValueOnce(fieldingPlayers);

      // For each unique player, check if exists then insert
      // p1: not found, insert
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      mockExecute.mockResolvedValueOnce([]);
      // p2: not found, insert
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      mockExecute.mockResolvedValueOnce([]);
      // p3: already exists
      mockExecuteTakeFirst.mockResolvedValueOnce({ play_cricket_id: "p3" });

      const result = await populatePlayers(db)();

      expect(result.total).toBe(3);
      expect(result.inserted).toBe(2);
    });
  });
});
