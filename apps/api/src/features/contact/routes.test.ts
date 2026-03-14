import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockQueryBuilder } = vi.hoisted(() => {
  const mockExecute = vi.fn();

  const mockQueryBuilder = {
    insertInto: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    execute: mockExecute,
  };

  return { mockExecute, mockQueryBuilder };
});

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  randomUUID: vi.fn().mockReturnValue("test-uuid-1234"),
});

import { createContactSubmission, createEventSubscriber } from "./service.js";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("contact service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder.insertInto.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values.mockReturnValue(mockQueryBuilder);
    mockExecute.mockResolvedValue([]);
  });

  describe("createContactSubmission", () => {
    it("stores submission in the database", async () => {
      const data = {
        name: "Alice",
        email: "alice@example.com",
        message: "Hello there",
        page: "/about",
      };

      await createContactSubmission(db, { slackWebhookUrl: undefined })(data);

      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "contact_submission",
      );
      expect(mockQueryBuilder.values).toHaveBeenCalledWith({
        id: "test-uuid-1234",
        name: "Alice",
        email: "alice@example.com",
        message: "Hello there",
        page: "/about",
      });
    });

    it("returns the generated id", async () => {
      const data = {
        name: "Bob",
        email: "bob@example.com",
        message: "Question about membership",
        page: "/contact",
      };

      const result = await createContactSubmission(db, {
        slackWebhookUrl: undefined,
      })(data);

      expect(result).toEqual({ id: "test-uuid-1234" });
    });
  });

  describe("createEventSubscriber", () => {
    it("stores subscriber with meta", async () => {
      const data = {
        email: "fan@example.com",
        meta: { source: "homepage", eventType: "cricket" },
      };

      await createEventSubscriber(db)(data);

      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "event_subscriber",
      );
      expect(mockQueryBuilder.values).toHaveBeenCalledWith({
        id: "test-uuid-1234",
        email: "fan@example.com",
        meta: JSON.stringify({ source: "homepage", eventType: "cricket" }),
      });
    });
  });
});
