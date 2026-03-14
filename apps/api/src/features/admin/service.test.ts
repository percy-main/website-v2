import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      deleteFrom: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
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

vi.mock("@percy-main/db", () => ({
  client: new Proxy(mockQueryBuilder, {
    get(target, prop) {
      if (prop in target) {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      return vi.fn().mockReturnValue(target);
    },
  }),
}));

import {
  listUsers,
  createMember,
  linkPlayCricketPlayer,
  unlinkPlayCricketPlayer,
} from "./service.js";

describe("admin service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  describe("listUsers", () => {
    it("returns paginated results", async () => {
      const users = [
        { id: "u1", name: "Alice", email: "alice@example.com" },
        { id: "u2", name: "Bob", email: "bob@example.com" },
      ];

      mockExecute.mockResolvedValue(users);
      mockExecuteTakeFirst.mockResolvedValue({ total: 50 });

      const result = await listUsers({
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });

      expect(result.items).toEqual(users);
      expect(result.total).toBe(50);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it("filters by search term", async () => {
      mockExecute.mockResolvedValue([]);
      mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

      await listUsers({
        page: 1,
        pageSize: 20,
        search: "alice",
        includeArchived: false,
      });

      // The where clause should be called with a callback for OR search
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe("createMember", () => {
    it("creates member record and returns id", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await createMember({
        email: "new@example.com",
        name: "New Member",
      });

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("member");
    });
  });

  describe("linkPlayCricketPlayer", () => {
    it("updates play_cricket_id on member", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await linkPlayCricketPlayer(
        "member",
        "m-1",
        "pc-12345",
      );

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("member");
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        play_cricket_id: "pc-12345",
      });
    });

    it("updates play_cricket_id on dependent", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await linkPlayCricketPlayer(
        "dependent",
        "d-1",
        "pc-67890",
      );

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("dependent");
    });
  });

  describe("unlinkPlayCricketPlayer", () => {
    it("sets play_cricket_id to null", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await unlinkPlayCricketPlayer("member", "m-1");

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        play_cricket_id: null,
      });
    });
  });
});
