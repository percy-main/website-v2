import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockExecuteTakeFirst, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockCountAll = vi.fn().mockReturnValue({
      as: vi.fn().mockReturnThis(),
    });
    const mockCount = vi.fn().mockReturnValue({
      distinct: vi.fn().mockReturnValue({
        as: vi.fn().mockReturnThis(),
      }),
    });
    const mockMax = vi.fn().mockReturnValue({
      as: vi.fn().mockReturnThis(),
    });

    const mockQueryBuilder: Record<string, unknown> = {
      selectFrom: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      deleteFrom: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      distinct: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnValue({
        columns: vi.fn().mockReturnValue({
          doUpdateSet: vi.fn().mockReturnValue({
            execute: mockExecute,
          }),
        }),
      }),
      fn: {
        countAll: mockCountAll,
        count: mockCount,
        max: mockMax,
      },
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) =>
          cb(mockQueryBuilder),
        ),
      }),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

import {
  assignPlayer,
  getActiveRequests,
  getDateDetail,
  getRequest,
  listRequests,
  removeAssignment,
  respond,
  setAvailability,
  updateRequestStatus,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("availability service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = mockQueryBuilder[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
    mockQueryBuilder.transaction = vi.fn().mockReturnValue({
      execute: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) =>
        cb(mockQueryBuilder),
      ),
    });
  });

  describe("listRequests", () => {
    it("returns empty items when no requests exist", async () => {
      mockExecute.mockResolvedValueOnce([]); // requests query
      const result = await listRequests(db)("user-1", "admin", {
        limit: 20,
        offset: 0,
      });
      expect(result).toEqual({ items: [] });
    });

    it("returns requests with fixture and response counts", async () => {
      mockExecute.mockResolvedValueOnce([
        {
          id: "req-1",
          date_from: "2026-06-01",
          date_to: "2026-06-07",
          status: "open",
          created_at: "2026-06-01T00:00:00Z",
          created_by: "user-1",
          created_by_name: "Test User",
        },
      ]);
      mockExecute.mockResolvedValueOnce([
        { availability_request_id: "req-1", fixture_count: "3" },
      ]);
      mockExecute.mockResolvedValueOnce([
        { availability_request_id: "req-1", respondent_count: "5" },
      ]);
      mockExecute.mockResolvedValueOnce([]); // fixtures query

      const result = await listRequests(db)("user-1", "admin", {
        limit: 20,
        offset: 0,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].fixtureCount).toBe(3);
      expect(result.items[0].respondentCount).toBe(5);
    });
  });

  describe("getRequest", () => {
    it("throws 404 for non-existent request", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      await expect(
        getRequest(db)("user-1", "admin", "missing"),
      ).rejects.toThrow("not found");
    });
  });

  describe("getDateDetail", () => {
    it("throws 404 for non-existent request", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      await expect(
        getDateDetail(db)("user-1", "admin", "missing", "2026-06-01"),
      ).rejects.toThrow("not found");
    });
  });

  describe("assignPlayer", () => {
    it("throws 404 when fixture not found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // fixture lookup
      await expect(
        assignPlayer(db)("user-1", "admin", "req-1", "2026-06-01", {
          fixtureId: "fix-1",
          playerName: "Test Player",
        }),
      ).rejects.toThrow("not found");
    });

    it("throws 409 when player already assigned", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "fix-1" }); // fixture exists
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "assign-1" }); // duplicate check
      await expect(
        assignPlayer(db)("user-1", "admin", "req-1", "2026-06-01", {
          fixtureId: "fix-1",
          memberId: "member-1",
          playerName: "Test Player",
        }),
      ).rejects.toThrow("already assigned");
    });
  });

  describe("removeAssignment", () => {
    it("throws 404 for non-existent assignment", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      await expect(
        removeAssignment(db)("user-1", "admin", "missing"),
      ).rejects.toThrow("not found");
    });

    it("removes assignment successfully", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "assign-1",
        availability_fixture_id: "fix-1",
      });
      mockExecute.mockResolvedValueOnce(undefined); // delete

      const result = await removeAssignment(db)("user-1", "admin", "assign-1");
      expect(result).toEqual({ success: true });
    });
  });

  describe("setAvailability", () => {
    it("throws 404 when no fixture on date", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      await expect(
        setAvailability(db)(
          "user-1",
          "admin",
          "req-1",
          "2026-06-01",
          "member-1",
          {
            status: "available",
          },
        ),
      ).rejects.toThrow("No fixtures");
    });

    it("throws 404 when member not found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "fixture-1" }); // fixture lookup
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // member lookup
      await expect(
        setAvailability(db)(
          "user-1",
          "admin",
          "req-1",
          "2026-06-01",
          "missing",
          {
            status: "available",
          },
        ),
      ).rejects.toThrow("Member not found");
    });

    it("upserts availability with override", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "fixture-1" }); // fixture lookup
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "member-1" }); // member lookup
      mockExecute.mockResolvedValueOnce(undefined); // upsert

      const result = await setAvailability(db)(
        "user-1",
        "admin",
        "req-1",
        "2026-06-01",
        "member-1",
        { status: "available" },
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("updateRequestStatus", () => {
    it("throws 404 for non-existent request", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      await expect(
        updateRequestStatus(db)("user-1", "admin", "missing", {
          status: "closed",
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("getActiveRequests", () => {
    it("returns empty items when no open requests", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "member-1" }); // member lookup
      mockExecute.mockResolvedValueOnce([]); // dependents
      mockExecute.mockResolvedValueOnce([]); // requests
      const result = await getActiveRequests(db)("test@example.com");
      expect(result).toEqual({
        memberId: "member-1",
        dependents: [],
        items: [],
      });
    });
  });

  describe("respond", () => {
    it("throws 404 when member not found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // member lookup
      await expect(
        respond(db)("nobody@example.com", "req-1", {
          responses: [{ matchDate: "2026-06-01", status: "available" }],
        }),
      ).rejects.toThrow("Member record not found");
    });

    it("throws 404 when request not found or closed", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "member-1" }); // member
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // request lookup
      await expect(
        respond(db)("test@example.com", "missing", {
          responses: [{ matchDate: "2026-06-01", status: "available" }],
        }),
      ).rejects.toThrow("not found or is closed");
    });
  });
});
