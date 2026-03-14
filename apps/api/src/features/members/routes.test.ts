import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
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

import { getMemberDetails, updateMemberDetails } from "./service.js";

describe("members service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder.selectFrom.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.insertInto.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.updateTable.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values.mockReturnValue(mockQueryBuilder);
  });

  describe("getMemberDetails", () => {
    it("returns null when no member exists", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      const result = await getMemberDetails("nobody@example.com");

      expect(result).toBeNull();
    });

    it("returns member data when member exists", async () => {
      const memberData = {
        title: "Mr",
        name: "John Doe",
        address: "123 Main St",
        postcode: "NE1 1AA",
        dob: "1990-01-01",
        telephone: "07700000000",
        email: "john@example.com",
        emergency_contact_name: "Jane Doe",
        emergency_contact_telephone: "07700000001",
      };
      mockExecuteTakeFirst.mockResolvedValue(memberData);

      const result = await getMemberDetails("john@example.com");

      expect(result).toEqual(memberData);
      expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith("member");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "email",
        "=",
        "john@example.com",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "deleted_at",
        "is",
        null,
      );
    });

    it("excludes soft-deleted members", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await getMemberDetails("deleted@example.com");

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "deleted_at",
        "is",
        null,
      );
    });
  });

  describe("updateMemberDetails", () => {
    it("creates new member if none exists", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);
      mockExecute.mockResolvedValue([]);

      await updateMemberDetails("new@example.com", {
        name: "New User",
        telephone: "07700000000",
      });

      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("member");
      expect(mockQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@example.com",
          name: "New User",
          telephone: "07700000000",
        }),
      );
    });

    it("updates only provided fields when member exists", async () => {
      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue([]);

      await updateMemberDetails("existing@example.com", {
        name: "Updated Name",
      });

      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("member");
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        name: "Updated Name",
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "id",
        "=",
        "member-1",
      );
    });

    it("does not overwrite fields not in input", async () => {
      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue([]);

      await updateMemberDetails("existing@example.com", {
        telephone: "07700000099",
      });

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        telephone: "07700000099",
      });
      expect(mockQueryBuilder.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.anything() }),
      );
    });
  });
});
