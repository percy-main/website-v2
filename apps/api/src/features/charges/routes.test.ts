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
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

import type Stripe from "stripe";
import {
  confirmPayment,
  getMyCharges,
  payOutstandingCharges,
} from "./service.js";

const db = mockQueryBuilder as unknown as Kysely<DB>;

const mockPaymentIntentsCreate = vi.fn();
const mockStripe = {
  paymentIntents: { create: mockPaymentIntentsCreate },
} as unknown as Stripe;

describe("charges service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder.selectFrom.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.updateTable.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectAll.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);
  });

  describe("getMyCharges", () => {
    it("returns empty array when no member exists", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      const result = await getMyCharges(db)("nobody@example.com");

      expect(result).toEqual([]);
    });

    it("returns charges ordered by date desc", async () => {
      const charges = [
        { id: "c1", charge_date: "2026-03-14", amount: 50 },
        { id: "c2", charge_date: "2026-02-01", amount: 25 },
      ];

      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue(charges);

      const result = await getMyCharges(db)("user@example.com");

      expect(result).toEqual(charges);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "charge_date",
        "desc",
      );
    });

    it("excludes soft-deleted charges", async () => {
      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue([]);

      await getMyCharges(db)("user@example.com");

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "deleted_at",
        "is",
        null,
      );
    });
  });

  describe("confirmPayment", () => {
    it("throws when no member found", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await expect(
        confirmPayment(db)("nobody@example.com", "pi_123"),
      ).rejects.toThrow("No member record found");
    });

    it("updates matching charges", async () => {
      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue([]);

      await confirmPayment(db)("user@example.com", "pi_abc");

      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("charge");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "stripe_payment_intent_id",
        "=",
        "pi_abc",
      );
      expect(mockQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_confirmed_at: expect.any(String) as string,
        }),
      );
    });

    it("ignores already-confirmed charges", async () => {
      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue([]);

      await confirmPayment(db)("user@example.com", "pi_abc");

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "paid_at",
        "is",
        null,
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "payment_confirmed_at",
        "is",
        null,
      );
    });
  });

  describe("payOutstandingCharges", () => {
    it("throws when no member found", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await expect(
        payOutstandingCharges(db, mockStripe)("nobody@example.com"),
      ).rejects.toThrow("No member record found");
    });

    it("throws when no unpaid charges exist", async () => {
      mockExecuteTakeFirst.mockResolvedValue({ id: "member-1" });
      mockExecute.mockResolvedValue([]);

      await expect(
        payOutstandingCharges(db, mockStripe)("user@example.com"),
      ).rejects.toThrow("No unpaid charges found");
    });
  });
});
