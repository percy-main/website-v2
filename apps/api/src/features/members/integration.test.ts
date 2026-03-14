import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  seedTestUser,
  type TestContext,
} from "../../test/containers.js";
import { getMemberDetails, updateMemberDetails } from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("members service (integration)", () => {
  describe("getMemberDetails", () => {
    it("returns null for a non-existent member", async () => {
      const result = await getMemberDetails(ctx.db)("nobody@example.com");
      expect(result).toBeNull();
    });

    it("excludes soft-deleted members", async () => {
      const email = `deleted-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email });

      // Soft-delete the member
      await ctx.db
        .updateTable("member")
        .set({ deleted_at: new Date().toISOString() })
        .where("email", "=", email)
        .execute();

      const result = await getMemberDetails(ctx.db)(email);
      expect(result).toBeNull();
    });
  });

  describe("updateMemberDetails", () => {
    it("creates a member record if one does not exist", async () => {
      const email = `new-member-${crypto.randomUUID()}@test.com`;

      await updateMemberDetails(ctx.db)(email, {
        name: "New Member",
        telephone: "01onal234",
      });

      const result = await getMemberDetails(ctx.db)(email);
      expect(result).toBeTruthy();
      expect(result!.name).toBe("New Member");
      expect(result!.telephone).toBe("01onal234");
    });

    it("updates only provided fields and leaves others unchanged", async () => {
      const email = `partial-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email, name: "Original Name" });

      // Set initial fields via direct DB update
      await ctx.db
        .updateTable("member")
        .set({
          telephone: "0191-111-1111",
          address: "123 Main St",
          postcode: "NE1 1AA",
        })
        .where("email", "=", email)
        .execute();

      // Update only telephone
      await updateMemberDetails(ctx.db)(email, { telephone: "0191-222-2222" });

      const result = await getMemberDetails(ctx.db)(email);
      expect(result).toBeTruthy();
      expect(result!.telephone).toBe("0191-222-2222");
      // Other fields should remain unchanged
      expect(result!.address).toBe("123 Main St");
      expect(result!.postcode).toBe("NE1 1AA");
      expect(result!.name).toBe("Original Name");
    });
  });
});
