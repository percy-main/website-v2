import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

import type Stripe from "stripe";
import {
  getMemberDetails,
  getMyMembership,
  getMySubscriptions,
  updateMemberDetails,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

const mockCustomersList = vi.fn();
const mockSubscriptionsList = vi.fn();
const mockProductsRetrieve = vi.fn();
const mockStripe = {
  customers: { list: mockCustomersList },
  subscriptions: { list: mockSubscriptionsList },
  products: { retrieve: mockProductsRetrieve },
} as unknown as Stripe;

describe("members service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder.selectFrom.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.insertInto.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.updateTable.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.leftJoin.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);
  });

  describe("getMemberDetails", () => {
    it("returns null when no member exists", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      const result = await getMemberDetails(db)("nobody@example.com");

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

      const result = await getMemberDetails(db)("john@example.com");

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

      await getMemberDetails(db)("deleted@example.com");

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

      await updateMemberDetails(db)("new@example.com", {
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

      await updateMemberDetails(db)("existing@example.com", {
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

      await updateMemberDetails(db)("existing@example.com", {
        telephone: "07700000099",
      });

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        telephone: "07700000099",
      });
      expect(mockQueryBuilder.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.anything() as unknown }),
      );
    });
  });

  describe("getMyMembership", () => {
    it("returns null when no membership exists", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      const result = await getMyMembership(db)("nobody@example.com");

      expect(result).toBeNull();
    });

    it("returns membership data when membership exists", async () => {
      const membershipData = {
        id: "ms-1",
        type: "senior_player",
        created_at: "2025-06-01T00:00:00.000Z",
        paid_until: "2026-06-01",
      };
      mockExecuteTakeFirst.mockResolvedValue(membershipData);

      const result = await getMyMembership(db)("john@example.com");

      expect(result).toEqual(membershipData);
      expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith("membership");
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        "member",
        "member.id",
        "membership.member_id",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "member.email",
        "=",
        "john@example.com",
      );
    });

    it("filters out dependent memberships", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await getMyMembership(db)("user@example.com");

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "membership.dependent_id",
        "is",
        null,
      );
    });

    it("orders by paid_until descending to get the current membership", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await getMyMembership(db)("user@example.com");

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "membership.paid_until",
        "desc",
      );
    });
  });

  describe("getMySubscriptions", () => {
    it("returns empty array when no Stripe customer exists", async () => {
      mockCustomersList.mockResolvedValue({
        data: [],
      });

      const result = await getMySubscriptions(mockStripe)("nobody@example.com");

      expect(result).toEqual([]);
      expect(mockCustomersList).toHaveBeenCalledWith({
        email: "nobody@example.com",
        limit: 1,
      });
    });

    it("returns transformed subscriptions for an existing customer", async () => {
      mockCustomersList.mockResolvedValue({
        data: [{ id: "cus_123" }],
      });

      mockSubscriptionsList.mockResolvedValue({
        data: [
          {
            id: "sub_abc",
            created: 1700000000,
            status: "active",
            current_period_end: 1702592000,
            items: {
              data: [
                {
                  price: {
                    nickname: "Monthly Social",
                    product: "prod_1",
                  },
                },
              ],
            },
          },
        ],
      });

      mockProductsRetrieve.mockResolvedValue({
        id: "prod_1",
        name: "Social Membership",
      });

      const result = await getMySubscriptions(mockStripe)("user@example.com");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("sub_abc");
      expect(result[0].name).toBe("Monthly Social");
      expect(result[0].product.name).toBe("Social Membership");
      expect(result[0].status).toBe("active");
      expect(mockSubscriptionsList).toHaveBeenCalledWith({
        customer: "cus_123",
        status: "active",
      });
      expect(mockProductsRetrieve).toHaveBeenCalledWith("prod_1");
    });

    it("uses product name as fallback when price nickname is null", async () => {
      mockCustomersList.mockResolvedValue({
        data: [{ id: "cus_456" }],
      });

      mockSubscriptionsList.mockResolvedValue({
        data: [
          {
            id: "sub_xyz",
            created: 1700000000,
            status: "active",
            current_period_end: 1702592000,
            items: {
              data: [
                {
                  price: {
                    nickname: null,
                    product: "prod_2",
                  },
                },
              ],
            },
          },
        ],
      });

      mockProductsRetrieve.mockResolvedValue({
        id: "prod_2",
        name: "Playing Membership",
      });

      const result = await getMySubscriptions(mockStripe)("user@example.com");

      expect(result[0].name).toBeNull();
      expect(result[0].product.name).toBe("Playing Membership");
    });
  });
});
