import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  chasePayment,
  createMember,
  findDuplicateMembers,
  getChargeAggregates,
  getMergePreview,
  getUserDetail,
  linkDependentToUser,
  linkMemberParent,
  linkPlayCricketPlayer,
  listAllCharges,
  listContactSubmissions,
  listJuniors,
  listUsers,
  markChargePaid,
  mergeMembers,
  searchMembersForParentLink,
  searchUsersForLinking,
  unlinkDependentUser,
  unlinkMemberParent,
  unlinkPlayCricketPlayer,
} from "./service.ts";

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
});

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

      // Use initial + surname so name similarity triggers initial match (score 0.8)
      const depId = await seedDependent(ctx.db, memberId, {
        name: "J Smith",
        sex: "male",
        dob: "2015-01-01",
      });

      const result = await searchUsersForLinking(ctx.db)({
        dependentId: depId,
      });

      expect(result.dependentName).toBe("J Smith");
      expect(result.users.length).toBeGreaterThanOrEqual(1);

      // The parent user "John Smith" should appear with a high score
      // ("J Smith" vs "John Smith" = initial match = 0.8)
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

  describe("member-parent linking", () => {
    it("links a junior to a parent and exposes the relationship via getUserDetail", async () => {
      const parentSeed = await seedTestUser(ctx.db, {
        email: `mp-parent-${crypto.randomUUID()}@test.com`,
        name: "Pat Parent",
      });
      const juniorSeed = await seedTestUser(ctx.db, {
        email: `mp-junior-${crypto.randomUUID()}@test.com`,
        name: "Jamie Junior",
      });

      await linkMemberParent(ctx.db)(
        {
          memberId: juniorSeed.memberId ?? "",
          parentMemberId: parentSeed.memberId ?? "",
        },
        null,
      );

      const parentDetail = await getUserDetail(ctx.db)(parentSeed.userId);
      expect(parentDetail.linkedJuniors).toHaveLength(1);
      expect(parentDetail.linkedJuniors[0]).toMatchObject({
        memberId: juniorSeed.memberId,
        name: "Jamie Junior",
      });
      expect(parentDetail.linkedParents).toEqual([]);

      const juniorDetail = await getUserDetail(ctx.db)(juniorSeed.userId);
      expect(juniorDetail.linkedParents).toHaveLength(1);
      expect(juniorDetail.linkedParents[0]).toMatchObject({
        memberId: parentSeed.memberId,
        name: "Pat Parent",
      });
      expect(juniorDetail.linkedJuniors).toEqual([]);
    });

    it("rejects a reciprocal link that would create a cycle", async () => {
      const aSeed = await seedTestUser(ctx.db, {
        email: `mp-cyc-a-${crypto.randomUUID()}@test.com`,
      });
      const bSeed = await seedTestUser(ctx.db, {
        email: `mp-cyc-b-${crypto.randomUUID()}@test.com`,
      });
      // A as parent of B
      await linkMemberParent(ctx.db)(
        {
          memberId: bSeed.memberId ?? "",
          parentMemberId: aSeed.memberId ?? "",
        },
        null,
      );
      // B as parent of A → would create cycle
      await expect(
        linkMemberParent(ctx.db)(
          {
            memberId: aSeed.memberId ?? "",
            parentMemberId: bSeed.memberId ?? "",
          },
          null,
        ),
      ).rejects.toThrow("already linked as this member's junior");
    });

    it("refuses to link an archived (soft-deleted) member", async () => {
      const liveSeed = await seedTestUser(ctx.db, {
        email: `mp-live-${crypto.randomUUID()}@test.com`,
      });
      const archivedSeed = await seedTestUser(ctx.db, {
        email: `mp-arc-${crypto.randomUUID()}@test.com`,
      });
      await ctx.db
        .updateTable("member")
        .set({ deleted_at: new Date().toISOString(), deleted_reason: "test" })
        .where("id", "=", archivedSeed.memberId ?? "")
        .execute();

      await expect(
        linkMemberParent(ctx.db)(
          {
            memberId: liveSeed.memberId ?? "",
            parentMemberId: archivedSeed.memberId ?? "",
          },
          null,
        ),
      ).rejects.toThrow("Member not found");
    });

    it("rejects self-linking", async () => {
      const seed = await seedTestUser(ctx.db, {
        email: `mp-self-${crypto.randomUUID()}@test.com`,
      });
      await expect(
        linkMemberParent(ctx.db)(
          {
            memberId: seed.memberId ?? "",
            parentMemberId: seed.memberId ?? "",
          },
          null,
        ),
      ).rejects.toThrow("cannot be their own parent");
    });

    it("is idempotent — linking twice does not error and produces one row", async () => {
      const parentSeed = await seedTestUser(ctx.db, {
        email: `mp-idem-p-${crypto.randomUUID()}@test.com`,
      });
      const juniorSeed = await seedTestUser(ctx.db, {
        email: `mp-idem-j-${crypto.randomUUID()}@test.com`,
      });
      const params = {
        memberId: juniorSeed.memberId ?? "",
        parentMemberId: parentSeed.memberId ?? "",
      };
      await linkMemberParent(ctx.db)(params, null);
      await linkMemberParent(ctx.db)(params, null);

      const rows = await ctx.db
        .selectFrom("member_parent_link")
        .where("member_id", "=", params.memberId)
        .where("parent_member_id", "=", params.parentMemberId)
        .select("member_id")
        .execute();
      expect(rows).toHaveLength(1);
    });

    it("unlinks", async () => {
      const parentSeed = await seedTestUser(ctx.db, {
        email: `mp-ul-p-${crypto.randomUUID()}@test.com`,
      });
      const juniorSeed = await seedTestUser(ctx.db, {
        email: `mp-ul-j-${crypto.randomUUID()}@test.com`,
      });
      const params = {
        memberId: juniorSeed.memberId ?? "",
        parentMemberId: parentSeed.memberId ?? "",
      };
      await linkMemberParent(ctx.db)(params, null);
      await unlinkMemberParent(ctx.db)(params);

      const detail = await getUserDetail(ctx.db)(juniorSeed.userId);
      expect(detail.linkedParents).toEqual([]);
    });

    it("searches candidate parents by name/email and excludes the junior themselves", async () => {
      const sharedSurname = `Smithy-${crypto.randomUUID().slice(0, 6)}`;
      const juniorSeed = await seedTestUser(ctx.db, {
        email: `mp-search-jr-${crypto.randomUUID()}@test.com`,
        name: `Junior ${sharedSurname}`,
      });
      const parentSeed = await seedTestUser(ctx.db, {
        email: `mp-search-pa-${crypto.randomUUID()}@test.com`,
        name: `Adult ${sharedSurname}`,
      });

      const result = await searchMembersForParentLink(ctx.db)({
        juniorMemberId: juniorSeed.memberId ?? "",
        search: sharedSurname,
      });

      expect(result.juniorName).toBe(`Junior ${sharedSurname}`);
      expect(result.members.some((m) => m.id === juniorSeed.memberId)).toBe(
        false,
      );
      expect(result.members.some((m) => m.id === parentSeed.memberId)).toBe(
        true,
      );
    });
  });

  describe("listAllCharges", () => {
    it("returns charges with member info and computed status", async () => {
      const email = `charges-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email, name: "Charge User" });
      const memberId = seed.memberId ?? "";
      expect(memberId).toBeTruthy();

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Test charge",
          amount_pence: 5000,
          charge_date: "2026-03-01",
          created_by: "admin-user",
          source: "admin",
          type: "manual",
        })
        .execute();

      const result = await listAllCharges(ctx.db)({
        page: 1,
        pageSize: 20,
        status: "all",
        showDeleted: false,
      });

      const charge = result.charges.find((c) => c.id === chargeId);
      expect(charge).toBeDefined();
      if (!charge) return;
      expect(charge.memberName).toBe("Charge User");
      expect(charge.memberEmail).toBe(email);
      expect(charge.amountPence).toBe(5000);
      expect(charge.status).toBe("unpaid");
    });

    it("filters by paid status", async () => {
      const email = `charges-paid-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      await ctx.db
        .insertInto("charge")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId,
          description: "Paid charge",
          amount_pence: 3000,
          charge_date: "2026-03-01",
          paid_at: new Date().toISOString(),
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await ctx.db
        .insertInto("charge")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId,
          description: "Unpaid charge",
          amount_pence: 2000,
          charge_date: "2026-03-01",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const paidResult = await listAllCharges(ctx.db)({
        page: 1,
        pageSize: 100,
        status: "paid",
        showDeleted: false,
      });

      expect(paidResult.charges.every((c) => c.status === "paid")).toBe(true);
    });

    it("filters by search term (case insensitive)", async () => {
      const uniqueDesc = `UniqueDesc-${crypto.randomUUID().slice(0, 8)}`;
      const email = `charges-search-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      await ctx.db
        .insertInto("charge")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId,
          description: uniqueDesc,
          amount_pence: 1000,
          charge_date: "2026-03-01",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const result = await listAllCharges(ctx.db)({
        page: 1,
        pageSize: 100,
        status: "all",
        showDeleted: false,
        search: uniqueDesc.toLowerCase(),
      });

      expect(result.charges.length).toBeGreaterThanOrEqual(1);
      expect(result.charges.some((c) => c.description === uniqueDesc)).toBe(
        true,
      );
    });

    it("excludes deleted charges by default", async () => {
      const email = `charges-del-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const deletedId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: deletedId,
          member_id: memberId,
          description: "Deleted charge",
          amount_pence: 500,
          charge_date: "2026-03-01",
          created_by: "admin",
          source: "admin",
          type: "manual",
          deleted_at: new Date().toISOString(),
          deleted_by: "admin",
          deleted_reason: "Duplicate",
        })
        .execute();

      const resultExcluded = await listAllCharges(ctx.db)({
        page: 1,
        pageSize: 100,
        status: "all",
        showDeleted: false,
      });
      expect(
        resultExcluded.charges.find((c) => c.id === deletedId),
      ).toBeUndefined();

      const resultIncluded = await listAllCharges(ctx.db)({
        page: 1,
        pageSize: 100,
        status: "all",
        showDeleted: true,
      });
      expect(
        resultIncluded.charges.find((c) => c.id === deletedId),
      ).toBeDefined();
    });
  });

  describe("getChargeAggregates", () => {
    it("returns correct aggregate totals", async () => {
      const email = `agg-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      // Insert one paid and one unpaid charge
      await ctx.db
        .insertInto("charge")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId,
          description: "Paid agg",
          amount_pence: 4000,
          charge_date: "2026-03-10",
          paid_at: new Date().toISOString(),
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await ctx.db
        .insertInto("charge")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId,
          description: "Unpaid agg",
          amount_pence: 3000,
          charge_date: "2026-03-10",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const result = await getChargeAggregates(ctx.db)({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
      });

      expect(result.totalCharged).toBeGreaterThanOrEqual(7000);
      expect(result.totalPaid).toBeGreaterThanOrEqual(4000);
      expect(result.totalOutstanding).toBeGreaterThanOrEqual(3000);
      expect(result.countPaid).toBeGreaterThanOrEqual(1);
      expect(result.countUnpaid).toBeGreaterThanOrEqual(1);
    });
  });

  describe("chasePayment", () => {
    it("returns success for existing unpaid charge", async () => {
      const email = `chase-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email, name: "Chase User" });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Chase me",
          amount_pence: 2500,
          charge_date: "2026-03-15",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const result = await chasePayment(ctx.db)(chargeId);
      expect(result).toEqual({ success: true });
    });

    it("throws 404 for paid charge", async () => {
      const email = `chase-paid-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Already paid",
          amount_pence: 1000,
          charge_date: "2026-03-15",
          paid_at: new Date().toISOString(),
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await expect(chasePayment(ctx.db)(chargeId)).rejects.toThrow(
        "Charge not found or already paid/deleted",
      );
    });

    it("throws 404 for non-existent charge", async () => {
      await expect(chasePayment(ctx.db)("non-existent")).rejects.toThrow(
        "Charge not found or already paid/deleted",
      );
    });

    it("throws 404 for pending charge (payment in flight)", async () => {
      const email = `chase-pending-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Pending payment",
          amount_pence: 2000,
          charge_date: "2026-03-15",
          payment_confirmed_at: new Date().toISOString(),
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await expect(chasePayment(ctx.db)(chargeId)).rejects.toThrow(
        "Charge not found or already paid/deleted",
      );
    });
  });

  describe("markChargePaid", () => {
    it("marks an unpaid charge as paid with the given payment method", async () => {
      const email = `mark-paid-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Cash payment",
          amount_pence: 1500,
          charge_date: "2026-03-15",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const result = await markChargePaid(ctx.db)(chargeId, {
        paymentMethod: "cash",
      });
      expect(result).toEqual({ success: true });

      const after = await ctx.db
        .selectFrom("charge")
        .where("id", "=", chargeId)
        .select(["paid_at", "payment_method"])
        .executeTakeFirstOrThrow();
      expect(after.paid_at).not.toBeNull();
      expect(after.payment_method).toBe("cash");
    });

    it("throws 404 for an already-paid charge", async () => {
      const email = `mark-paid-already-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Already paid",
          amount_pence: 1500,
          charge_date: "2026-03-15",
          paid_at: new Date().toISOString(),
          payment_method: "card",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await expect(
        markChargePaid(ctx.db)(chargeId, { paymentMethod: "cash" }),
      ).rejects.toThrow("Charge not found or already paid/deleted");
    });

    it("throws 404 for a deleted (voided) charge", async () => {
      const email = `mark-paid-voided-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Voided",
          amount_pence: 1500,
          charge_date: "2026-03-15",
          deleted_at: new Date().toISOString(),
          deleted_reason: "raised in error",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await expect(
        markChargePaid(ctx.db)(chargeId, { paymentMethod: "cash" }),
      ).rejects.toThrow("Charge not found or already paid/deleted");
    });

    it("throws 404 for a charge with payment in flight", async () => {
      const email = `mark-paid-pending-${crypto.randomUUID()}@test.com`;
      const seed = await seedTestUser(ctx.db, { email });
      const memberId = seed.memberId ?? "";

      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Pending Stripe confirmation",
          amount_pence: 1500,
          charge_date: "2026-03-15",
          payment_confirmed_at: new Date().toISOString(),
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      await expect(
        markChargePaid(ctx.db)(chargeId, { paymentMethod: "cash" }),
      ).rejects.toThrow("Charge not found or already paid/deleted");
    });
  });

  describe("listContactSubmissions", () => {
    it("returns paginated contact submissions", async () => {
      // Seed submissions
      await ctx.db
        .insertInto("contact_submission")
        .values({
          id: `cs-${crypto.randomUUID()}`,
          name: "Alice Test",
          email: "alice@test.com",
          message: "Hello, I have a question",
          page: "/contact",
        })
        .execute();
      await ctx.db
        .insertInto("contact_submission")
        .values({
          id: `cs-${crypto.randomUUID()}`,
          name: "Bob Test",
          email: "bob@test.com",
          message: "Another message",
          page: "/juniors",
        })
        .execute();

      const result = await listContactSubmissions(ctx.db)({
        page: 1,
        pageSize: 10,
      });

      expect(result.submissions.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.submissions[0]).toHaveProperty("id");
      expect(result.submissions[0]).toHaveProperty("name");
      expect(result.submissions[0]).toHaveProperty("email");
      expect(result.submissions[0]).toHaveProperty("message");
      expect(result.submissions[0]).toHaveProperty("page");
      expect(result.submissions[0]).toHaveProperty("createdAt");
    });

    it("filters by search term (name)", async () => {
      const uniqueName = `SearchTest-${crypto.randomUUID().slice(0, 8)}`;
      await ctx.db
        .insertInto("contact_submission")
        .values({
          id: `cs-${crypto.randomUUID()}`,
          name: uniqueName,
          email: "search@test.com",
          message: "Search test",
          page: "/contact",
        })
        .execute();

      const result = await listContactSubmissions(ctx.db)({
        page: 1,
        pageSize: 10,
        search: uniqueName,
      });

      expect(result.submissions).toHaveLength(1);
      expect(result.submissions[0].name).toBe(uniqueName);
    });

    it("filters by search term (email)", async () => {
      const uniqueEmail = `unique-${crypto.randomUUID().slice(0, 8)}@test.com`;
      await ctx.db
        .insertInto("contact_submission")
        .values({
          id: `cs-${crypto.randomUUID()}`,
          name: "Email Search",
          email: uniqueEmail,
          message: "Email search test",
          page: "/contact",
        })
        .execute();

      const result = await listContactSubmissions(ctx.db)({
        page: 1,
        pageSize: 10,
        search: uniqueEmail,
      });

      expect(result.submissions).toHaveLength(1);
      expect(result.submissions[0].email).toBe(uniqueEmail);
    });

    it("paginates correctly", async () => {
      // Seed enough for pagination
      for (let i = 0; i < 3; i++) {
        await ctx.db
          .insertInto("contact_submission")
          .values({
            id: `cs-page-${crypto.randomUUID()}`,
            name: `Paginate User ${i}`,
            email: `paginate${i}@test.com`,
            message: "Pagination test",
            page: "/contact",
          })
          .execute();
      }

      const page1 = await listContactSubmissions(ctx.db)({
        page: 1,
        pageSize: 2,
      });

      expect(page1.submissions).toHaveLength(2);
      expect(page1.total).toBeGreaterThanOrEqual(3);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);
    });
  });

  describe("findDuplicateMembers", () => {
    it("detects fuzzy name-based duplicates", async () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      await ctx.db
        .insertInto("member")
        .values({
          id: `name-a-${suffix}`,
          email: `name-a-${suffix}@test.com`,
          name: `John Testington${suffix}`,
        })
        .execute();
      await ctx.db
        .insertInto("member")
        .values({
          id: `name-b-${suffix}`,
          email: `name-b-${suffix}@test.com`,
          name: `J Testington${suffix}`,
        })
        .execute();

      const result = await findDuplicateMembers(ctx.db)();
      const nameGroup = result.groups.find(
        (g) =>
          g.matchType === "name" &&
          g.members.some((m) => m.id === `name-a-${suffix}`),
      );

      expect(nameGroup).toBeDefined();
      expect(nameGroup?.members.length).toBe(2);
    });

    it("returns correct shape when no duplicates exist", async () => {
      const result = await findDuplicateMembers(ctx.db)();
      expect(result).toHaveProperty("groups");
      expect(Array.isArray(result.groups)).toBe(true);
    });

    it("includes membership, dependent, and charge counts", async () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const memberIdA = `dup-counts-a-${suffix}`;
      const memberIdB = `dup-counts-b-${suffix}`;
      await ctx.db
        .insertInto("member")
        .values({
          id: memberIdA,
          email: `dup-counts-a-${suffix}@test.com`,
          name: `Alexander Countsworth${suffix}`,
        })
        .execute();
      await ctx.db
        .insertInto("member")
        .values({
          id: memberIdB,
          email: `dup-counts-b-${suffix}@test.com`,
          name: `Alex Countsworth${suffix}`,
        })
        .execute();

      // Add a charge to the first member
      await ctx.db
        .insertInto("charge")
        .values({
          id: crypto.randomUUID(),
          member_id: memberIdA,
          description: "Test charge",
          amount_pence: 1000,
          charge_date: "2026-01-01",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const result = await findDuplicateMembers(ctx.db)();
      const group = result.groups.find(
        (g) =>
          g.matchType === "name" && g.members.some((m) => m.id === memberIdA),
      );

      expect(group).toBeDefined();
      const memberWithCharge = group?.members.find((m) => m.id === memberIdA);
      expect(memberWithCharge?.chargeCount).toBe(1);
    });
  });

  describe("getMergePreview", () => {
    it("returns preview with member details and related records", async () => {
      const email1 = `preview-a-${crypto.randomUUID()}@test.com`;
      const email2 = `preview-b-${crypto.randomUUID()}@test.com`;
      const keepId = `preview-keep-${crypto.randomUUID()}`;
      const removeId = `preview-rm-${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("member")
        .values({ id: keepId, email: email1, name: "Keep Me" })
        .execute();
      await ctx.db
        .insertInto("member")
        .values({ id: removeId, email: email2, name: "Remove Me" })
        .execute();

      const result = await getMergePreview(ctx.db)({
        keepMemberId: keepId,
        removeMemberId: removeId,
      });

      expect(result.isCrossEmailMerge).toBe(true);
      expect(result.keep.member.id).toBe(keepId);
      expect(result.remove.member.id).toBe(removeId);
      expect(Array.isArray(result.keep.memberships)).toBe(true);
      expect(Array.isArray(result.remove.dependents)).toBe(true);
    });

    it("throws 400 for self-merge", async () => {
      await expect(
        getMergePreview(ctx.db)({
          keepMemberId: "same-id",
          removeMemberId: "same-id",
        }),
      ).rejects.toThrow("Cannot merge a member with itself");
    });
  });

  describe("mergeMembers", () => {
    it("re-points foreign keys and deletes the duplicate", async () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const keepId = `merge-keep-${suffix}`;
      const removeId = `merge-rm-${suffix}`;

      await ctx.db
        .insertInto("member")
        .values({
          id: keepId,
          email: `merge-keep-${suffix}@test.com`,
          name: "Keep",
        })
        .execute();
      await ctx.db
        .insertInto("member")
        .values({
          id: removeId,
          email: `merge-rm-${suffix}@test.com`,
          name: "Remove",
        })
        .execute();

      // Add a charge, dependent, and membership to the remove member
      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: removeId,
          description: "Merge charge",
          amount_pence: 500,
          charge_date: "2026-01-01",
          created_by: "admin",
          source: "admin",
          type: "manual",
        })
        .execute();

      const depId = await seedDependent(ctx.db, removeId, {
        name: "Merge Dep",
      });

      const membershipId = crypto.randomUUID();
      await ctx.db
        .insertInto("membership")
        .values({
          id: membershipId,
          member_id: removeId,
          type: "senior_player",
          paid_until: "2027-04-01",
        })
        .execute();

      const result = await mergeMembers(ctx.db)({
        keepMemberId: keepId,
        removeMemberId: removeId,
      });

      expect(result).toEqual({ success: true });

      // Verify charge was re-pointed
      const charge = await ctx.db
        .selectFrom("charge")
        .where("id", "=", chargeId)
        .select("member_id")
        .executeTakeFirst();
      expect(charge?.member_id).toBe(keepId);

      // Verify dependent was re-pointed
      const dep = await ctx.db
        .selectFrom("dependent")
        .where("id", "=", depId)
        .select("member_id")
        .executeTakeFirst();
      expect(dep?.member_id).toBe(keepId);

      // Verify membership was re-pointed
      const membership = await ctx.db
        .selectFrom("membership")
        .where("id", "=", membershipId)
        .select("member_id")
        .executeTakeFirst();
      expect(membership?.member_id).toBe(keepId);

      // Verify removed member is deleted
      const removed = await ctx.db
        .selectFrom("member")
        .where("id", "=", removeId)
        .selectAll()
        .executeTakeFirst();
      expect(removed).toBeUndefined();
    });

    it("preserves stripe_customer_id from removed member when keep has none", async () => {
      const keepId = `merge-stripe-keep-${crypto.randomUUID()}`;
      const removeId = `merge-stripe-rm-${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("member")
        .values({
          id: keepId,
          email: `stripe-k-${crypto.randomUUID()}@test.com`,
          name: "No Stripe",
          stripe_customer_id: null,
        })
        .execute();
      await ctx.db
        .insertInto("member")
        .values({
          id: removeId,
          email: `stripe-r-${crypto.randomUUID()}@test.com`,
          name: "Has Stripe",
          stripe_customer_id: "cus_test123",
        })
        .execute();

      await mergeMembers(ctx.db)({
        keepMemberId: keepId,
        removeMemberId: removeId,
      });

      const kept = await ctx.db
        .selectFrom("member")
        .where("id", "=", keepId)
        .select("stripe_customer_id")
        .executeTakeFirst();
      expect(kept?.stripe_customer_id).toBe("cus_test123");
    });

    it("does not overwrite existing stripe_customer_id", async () => {
      const keepId = `merge-stripe2-keep-${crypto.randomUUID()}`;
      const removeId = `merge-stripe2-rm-${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("member")
        .values({
          id: keepId,
          email: `stripe2-k-${crypto.randomUUID()}@test.com`,
          name: "Has Stripe Keep",
          stripe_customer_id: "cus_keep",
        })
        .execute();
      await ctx.db
        .insertInto("member")
        .values({
          id: removeId,
          email: `stripe2-r-${crypto.randomUUID()}@test.com`,
          name: "Has Stripe Remove",
          stripe_customer_id: "cus_remove",
        })
        .execute();

      await mergeMembers(ctx.db)({
        keepMemberId: keepId,
        removeMemberId: removeId,
      });

      const kept = await ctx.db
        .selectFrom("member")
        .where("id", "=", keepId)
        .select("stripe_customer_id")
        .executeTakeFirst();
      expect(kept?.stripe_customer_id).toBe("cus_keep");
    });

    it("throws 404 for non-existent members", async () => {
      await expect(
        mergeMembers(ctx.db)({
          keepMemberId: "nonexistent-a",
          removeMemberId: "nonexistent-b",
        }),
      ).rejects.toThrow("One or both member records not found");
    });
  });
});
