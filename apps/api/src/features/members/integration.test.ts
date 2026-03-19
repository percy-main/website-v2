import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  getMemberDetails,
  getMyMembership,
  updateMemberDetails,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

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
      expect(result?.name).toBe("New Member");
      expect(result?.telephone).toBe("01onal234");
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
      expect(result?.telephone).toBe("0191-222-2222");
      // Other fields should remain unchanged
      expect(result?.address).toBe("123 Main St");
      expect(result?.postcode).toBe("NE1 1AA");
      expect(result?.name).toBe("Original Name");
    });
  });

  describe("getMyMembership", () => {
    it("returns null for a user with no membership", async () => {
      const email = `no-membership-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email });

      const result = await getMyMembership(ctx.db)(email);
      expect(result).toBeNull();
    });

    it("returns the primary membership for a member", async () => {
      const email = `with-membership-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      await ctx.db
        .insertInto("membership")
        .values({
          id: `ms-${crypto.randomUUID()}`,
          member_id: memberId ?? "",
          type: "senior_player",
          paid_until: "2026-09-30",
        })
        .execute();

      const result = await getMyMembership(ctx.db)(email);
      expect(result).toBeTruthy();
      expect(result?.type).toBe("senior_player");
      expect(result?.paid_until).toBe("2026-09-30");
      expect(result?.created_at).toBeTruthy();
    });

    it("excludes dependent memberships", async () => {
      const email = `dep-membership-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const dependentId = `dep-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("dependent")
        .values({
          id: dependentId,
          member_id: memberId ?? "",
          name: "Junior Child",
          dob: "2015-01-01",
          sex: "male",
        })
        .execute();

      // Create a dependent membership (should be excluded)
      await ctx.db
        .insertInto("membership")
        .values({
          id: `ms-dep-${crypto.randomUUID()}`,
          member_id: memberId ?? "",
          dependent_id: dependentId,
          type: "junior",
          paid_until: "2026-12-31",
        })
        .execute();

      const result = await getMyMembership(ctx.db)(email);
      expect(result).toBeNull();
    });

    it("returns primary membership even when dependent memberships exist", async () => {
      const email = `both-membership-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      // Primary membership
      await ctx.db
        .insertInto("membership")
        .values({
          id: `ms-primary-${crypto.randomUUID()}`,
          member_id: memberId ?? "",
          type: "social",
          paid_until: "2026-06-30",
        })
        .execute();

      // Dependent membership
      const dependentId = `dep-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("dependent")
        .values({
          id: dependentId,
          member_id: memberId ?? "",
          name: "Junior Child",
          dob: "2015-05-05",
          sex: "female",
        })
        .execute();

      await ctx.db
        .insertInto("membership")
        .values({
          id: `ms-dep-${crypto.randomUUID()}`,
          member_id: memberId ?? "",
          dependent_id: dependentId,
          type: "junior",
          paid_until: "2026-12-31",
        })
        .execute();

      const result = await getMyMembership(ctx.db)(email);
      expect(result).toBeTruthy();
      expect(result?.type).toBe("social");
    });
  });
});
