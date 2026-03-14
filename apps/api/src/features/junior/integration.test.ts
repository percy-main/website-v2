import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import { addDependents, getDependents, listMyTeams } from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

function makeChildDob(ageYears: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - ageYears);
  d.setMonth(d.getMonth() + 1); // ensure still under the target age
  return d.toISOString().split("T")[0];
}

describe("junior service (integration)", () => {
  describe("addDependents", () => {
    it("creates dependent records in the database", async () => {
      const email = `parent-add-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email });

      const result = await addDependents(ctx.db)(email, [
        {
          name: "Child One",
          sex: "male",
          dob: makeChildDob(10),
          whatsapp_consent: true,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
      ]);

      expect(result.dependentIds).toHaveLength(1);
      expect(result.memberId).toBeTruthy();
      expect(result.chargeId).toBeTruthy();

      const dependent = await ctx.db
        .selectFrom("dependent")
        .where("id", "=", result.dependentIds[0])
        .selectAll()
        .executeTakeFirst();

      expect(dependent).toBeTruthy();
      expect(dependent?.name).toBe("Child One");
      expect(dependent?.sex).toBe("male");
    });

    it("creates a charge with correct amount: 5000 for first, 3000 for additional", async () => {
      // Use withMember: false so addDependents creates the member fresh
      // (no pre-existing member -> no pre-existing dependents -> existingCount=0)
      const email = `parent-charge-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email, withMember: false });

      const result = await addDependents(ctx.db)(email, [
        {
          name: "Child A",
          sex: "female",
          dob: makeChildDob(12),
          whatsapp_consent: true,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
        {
          name: "Child B",
          sex: "male",
          dob: makeChildDob(8),
          whatsapp_consent: false,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
      ]);

      const charge = await ctx.db
        .selectFrom("charge")
        .where("id", "=", result.chargeId)
        .selectAll()
        .executeTakeFirst();

      expect(charge).toBeTruthy();
      // First child = 5000, second child = 3000
      expect(charge?.amount_pence).toBe(8000);
    });

    it("links charge to dependents via charge_dependent", async () => {
      const email = `parent-link-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email });

      const result = await addDependents(ctx.db)(email, [
        {
          name: "Child X",
          sex: "male",
          dob: makeChildDob(9),
          whatsapp_consent: true,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
      ]);

      const links = await ctx.db
        .selectFrom("charge_dependent")
        .where("charge_id", "=", result.chargeId)
        .selectAll()
        .execute();

      expect(links).toHaveLength(1);
      expect(links[0].dependent_id).toBe(result.dependentIds[0]);
    });
  });

  describe("getDependents", () => {
    it("returns dependents with membership info", async () => {
      const email = `parent-get-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const depId = crypto.randomUUID();
      await ctx.db
        .insertInto("dependent")
        .values({
          id: depId,
          member_id: memberId ?? "",
          name: "Test Child",
          sex: "male",
          dob: "2015-06-01",
        })
        .execute();

      await ctx.db
        .insertInto("membership")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId ?? "",
          dependent_id: depId,
          paid_until: "2026-09-30",
          type: "junior",
        })
        .execute();

      const result = await getDependents(ctx.db)(email);

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].name).toBe("Test Child");
      expect(result.dependents[0].paid_until).toBe("2026-09-30");
      expect(result.dependents[0].parent.email).toBe(email);
    });
  });

  describe("listMyTeams", () => {
    it("returns all teams for admin", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        role: "admin",
        withMember: false,
      });

      // The baseline migration seeds 8 junior_team rows
      const teams = await listMyTeams(ctx.db)(userId, "admin");
      expect(teams.length).toBeGreaterThanOrEqual(8);
    });

    it("returns only assigned teams for junior_manager", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        role: "junior_manager",
        withMember: false,
      });

      // Assign to one specific seeded team
      await ctx.db
        .insertInto("junior_team_manager")
        .values({ user_id: userId, junior_team_id: "u11-boys" })
        .execute();

      const teams = await listMyTeams(ctx.db)(userId, "junior_manager");
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe("U11 Boys");
    });
  });
});
