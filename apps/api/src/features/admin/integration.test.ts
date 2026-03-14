import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  seedTestUser,
  type TestContext,
} from "../../test/containers.js";
import {
  listUsers,
  createMember,
  linkPlayCricketPlayer,
  unlinkPlayCricketPlayer,
} from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("admin service (integration)", () => {
  describe("listUsers", () => {
    it("returns paginated users from the database", async () => {
      // Seed a few users
      await seedTestUser(ctx.db, { name: "Admin User A", withMember: false });
      await seedTestUser(ctx.db, { name: "Admin User B", withMember: false });
      await seedTestUser(ctx.db, { name: "Admin User C", withMember: false });

      const result = await listUsers(ctx.db)({
        page: 1,
        pageSize: 2,
        includeArchived: false,
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });
  });

  describe("createMember", () => {
    it("creates a member record and returns its id", async () => {
      const email = `admin-member-${crypto.randomUUID()}@test.com`;
      const result = await createMember(ctx.db)({
        email,
        name: "New Admin Member",
        title: "Mr",
        memberCategory: "senior",
      });

      expect(result.id).toBeDefined();

      const row = await ctx.db
        .selectFrom("member")
        .where("id", "=", result.id)
        .selectAll()
        .executeTakeFirst();

      expect(row).toBeTruthy();
      expect(row?.email).toBe(email);
      expect(row?.name).toBe("New Admin Member");
      expect(row?.title).toBe("Mr");
      expect(row?.member_category).toBe("senior");
    });
  });

  describe("linkPlayCricketPlayer", () => {
    it("sets play_cricket_id on a member", async () => {
      const email = `link-pc-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      const pcId = "pc-12345";
      await linkPlayCricketPlayer(ctx.db)("member", memberId, pcId);

      const row = await ctx.db
        .selectFrom("member")
        .where("id", "=", memberId)
        .select(["play_cricket_id"])
        .executeTakeFirst();

      expect(row?.play_cricket_id).toBe(pcId);
    });
  });

  describe("unlinkPlayCricketPlayer", () => {
    it("clears play_cricket_id on a member", async () => {
      const email = `unlink-pc-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      // Link first
      await linkPlayCricketPlayer(ctx.db)("member", memberId, "pc-99999");

      // Then unlink
      await unlinkPlayCricketPlayer(ctx.db)("member", memberId);

      const row = await ctx.db
        .selectFrom("member")
        .where("id", "=", memberId)
        .select(["play_cricket_id"])
        .executeTakeFirst();

      expect(row?.play_cricket_id).toBeNull();
    });
  });
});
