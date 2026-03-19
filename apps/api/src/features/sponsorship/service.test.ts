import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      deleteFrom: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
      fn: {
        countAll: vi.fn().mockReturnValue({
          as: vi.fn().mockReturnValue("count_expr"),
        }),
      },
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

import {
  approveGameSponsorship,
  getGameSponsorshipPrice,
  getPlayerSponsorshipPrice,
  listGameSponsorships,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("sponsorship service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all chainable methods
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  describe("getGameSponsorshipPrice", () => {
    it("returns expected price values", () => {
      const price = getGameSponsorshipPrice();

      expect(price).toEqual({
        amountPence: 5000,
        currency: "gbp",
        productName: "Game Sponsorship",
      });
    });
  });

  describe("getPlayerSponsorshipPrice", () => {
    it("returns expected price values", () => {
      const price = getPlayerSponsorshipPrice();

      expect(price).toEqual({
        amountPence: 5000,
        currency: "gbp",
        productName: "Player Sponsorship",
      });
    });
  });

  describe("approveGameSponsorship", () => {
    it("sets approved to true", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await approveGameSponsorship(db)("sp-123");

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith(
        "game_sponsorship",
      );
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({ approved: true });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", "=", "sp-123");
    });
  });

  describe("listGameSponsorships", () => {
    it("paginates correctly", async () => {
      const items = [
        { id: "sp-1", sponsor_name: "Sponsor A" },
        { id: "sp-2", sponsor_name: "Sponsor B" },
      ];

      mockExecute.mockResolvedValue(items);
      mockExecuteTakeFirst.mockResolvedValue({ total: 10 });

      const result = await listGameSponsorships(db)(1, 2, "all");

      expect(result.items).toEqual(items);
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it("returns zero total when no results", async () => {
      mockExecute.mockResolvedValue([]);
      mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

      const result = await listGameSponsorships(db)(1, 20, "all");

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
