import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import {
  createMember,
  linkDependentToUser,
  linkPlayCricketPlayer,
  listJuniors,
  listUsers,
  searchUsersForLinking,
  unlinkDependentUser,
  unlinkPlayCricketPlayer,
} from "./service.js";

/** Seeds a dependent (junior) under a member. Returns the dependent id. */
async function seedDependent(
  db: Kysely<DB>,
  memberId: string,
  overrides: {
    name?: string;
    sex?: string;
    dob?: string;
    userId?: string | null;
  } = {},
) {
  const id = `dep-${crypto.randomUUID()}`;
  await db
    .insertInto("dependent")
    .values({
      id,
      member_id: memberId,
      name: overrides.name ?? "Test Junior",
      sex: overrides.sex ?? "male",
      dob: overrides.dob ?? "2015-03-15",
      whatsapp_consent: false,
      emergency_medical_consent: true,
      medical_fitness_declaration: true,
      data_protection_consent: true,
      photo_consent: true,
      user_id: overrides.userId ?? null,
    })
    .execute();
  return id;
}

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

  describe("listJuniors", () => {
    it("returns juniors with parent info and computed fields", async () => {
      const email = `jr-parent-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, {
        email,
        name: "Parent Smith",
      });

      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      await seedDependent(ctx.db, memberId, {
        name: "Junior Smith",
        sex: "male",
        dob: "2015-06-01",
      });

      const result = await listJuniors(ctx.db)({
        page: 1,
        pageSize: 100,
        sex: "all",
        ageGroup: "all",
        membershipStatus: "all",
      });

      const junior = result.juniors.find((j) => j.name === "Junior Smith");
      expect(junior).toBeDefined();
      if (!junior) return;
      expect(junior.parentName).toBe("Parent Smith");
      expect(junior.parentEmail).toBe(email);
      expect(junior.ageGroup).toBeTruthy(); // should have an age group
      expect(junior.teamName).toMatch(/Boys$/); // male → Boys
      expect(junior.hasOwnAccount).toBe(false);
    });

    it("filters by sex", async () => {
      const email = `jr-sex-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      await seedDependent(ctx.db, memberId, {
        name: "Girl A",
        sex: "female",
        dob: "2014-01-01",
      });
      await seedDependent(ctx.db, memberId, {
        name: "Boy A",
        sex: "male",
        dob: "2014-01-01",
      });

      const girls = await listJuniors(ctx.db)({
        page: 1,
        pageSize: 100,
        sex: "female",
        ageGroup: "all",
        membershipStatus: "all",
      });

      expect(girls.juniors.every((j) => j.sex === "female")).toBe(true);
    });

    it("filters by search term (case insensitive)", async () => {
      const email = `jr-search-${crypto.randomUUID()}@test.com`;
      const uniqueName = `UniqueName${crypto.randomUUID().slice(0, 6)}`;
      const seed = await seedTestUser(ctx.db, { email, name: "Search Parent" });
      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      await seedDependent(ctx.db, memberId, {
        name: uniqueName,
        sex: "male",
        dob: "2015-01-01",
      });

      const result = await listJuniors(ctx.db)({
        page: 1,
        pageSize: 100,
        search: uniqueName.toLowerCase(),
        sex: "all",
        ageGroup: "all",
        membershipStatus: "all",
      });

      expect(result.juniors.length).toBeGreaterThanOrEqual(1);
      expect(result.juniors.some((j) => j.name === uniqueName)).toBe(true);
    });
  });

  describe("searchUsersForLinking", () => {
    it("returns scored users for a dependent", async () => {
      const email = `sr-link-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email, name: "John Smith" });
      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      const depId = await seedDependent(ctx.db, memberId, {
        name: "John Smith Jr",
        sex: "male",
        dob: "2015-01-01",
      });

      const result = await searchUsersForLinking(ctx.db)({
        dependentId: depId,
      });

      expect(result.dependentName).toBe("John Smith Jr");
      expect(result.users.length).toBeGreaterThanOrEqual(1);

      // The parent user should appear with a reasonable score
      const match = result.users.find((u) => u.email === email);
      expect(match).toBeDefined();
      if (!match) return;
      expect(match.score).toBeGreaterThan(0);
    });

    it("throws 404 for non-existent dependent", async () => {
      await expect(
        searchUsersForLinking(ctx.db)({
          dependentId: "non-existent-id",
        }),
      ).rejects.toThrow("Dependent not found");
    });
  });

  describe("linkDependentToUser / unlinkDependentUser", () => {
    it("links and unlinks a dependent to a user account", async () => {
      const parentEmail = `link-parent-${crypto.randomUUID()}@test.com`;
      const parentSeed = await seedTestUser(ctx.db, { email: parentEmail });
      const parentMemberId = parentSeed.memberId ?? "";
      expect(parentMemberId).toBeTruthy();

      const childEmail = `link-child-${crypto.randomUUID()}@test.com`;
      const childSeed = await seedTestUser(ctx.db, {
        email: childEmail,
        withMember: false,
      });

      const depId = await seedDependent(ctx.db, parentMemberId, {
        name: "Linkable Junior",
        sex: "female",
        dob: "2016-05-10",
      });

      // Link
      await linkDependentToUser(ctx.db)({
        dependentId: depId,
        userId: childSeed.userId,
      });

      const linked = await ctx.db
        .selectFrom("dependent")
        .where("id", "=", depId)
        .select("user_id")
        .executeTakeFirst();
      expect(linked?.user_id).toBe(childSeed.userId);

      // Attempting to link again should fail
      await expect(
        linkDependentToUser(ctx.db)({
          dependentId: depId,
          userId: childSeed.userId,
        }),
      ).rejects.toThrow("already linked");

      // Unlink
      await unlinkDependentUser(ctx.db)({ dependentId: depId });

      const unlinked = await ctx.db
        .selectFrom("dependent")
        .where("id", "=", depId)
        .select("user_id")
        .executeTakeFirst();
      expect(unlinked?.user_id).toBeNull();
    });

    it("throws 404 when linking non-existent dependent", async () => {
      await expect(
        linkDependentToUser(ctx.db)({
          dependentId: "non-existent",
          userId: "some-user",
        }),
      ).rejects.toThrow("Dependent not found");
    });

    it("throws 404 when unlinking non-existent dependent", async () => {
      await expect(
        unlinkDependentUser(ctx.db)({ dependentId: "non-existent" }),
      ).rejects.toThrow("Dependent not found");
    });
  });
});
