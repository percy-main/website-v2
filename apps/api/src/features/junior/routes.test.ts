import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, cleanDb, seedTestUser } from "../../test/db.js";
import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";

// Mock the db client used by the service
vi.mock("@percy-main/db", async () => {
  const testDb = createTestDb();
  return { client: testDb };
});

const db = createTestDb();

async function seedJuniorTeam(
  testDb: Kysely<DB>,
  overrides: Partial<{
    id: string;
    name: string;
    age_group: string;
    sex: string;
  }> = {},
) {
  const id = overrides.id ?? "team-1";
  await testDb
    .insertInto("junior_team")
    .values({
      id,
      name: overrides.name ?? "U11 Boys",
      age_group: overrides.age_group ?? "U11",
      sex: overrides.sex ?? "male",
    })
    .execute();
  return id;
}

async function assignManager(
  testDb: Kysely<DB>,
  userId: string,
  teamId: string,
) {
  await testDb
    .insertInto("junior_team_manager")
    .values({ user_id: userId, junior_team_id: teamId })
    .execute();
}

describe("junior service", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  afterAll(async () => {
    await cleanDb(db);
    await db.destroy();
  });

  describe("addDependents", () => {
    it("creates dependent records", async () => {
      const { addDependents } = await import("./service.js");

      await seedTestUser(db, { email: "parent@test.com" });

      const result = await addDependents("parent@test.com", [
        {
          name: "Child One",
          sex: "male",
          dob: "2016-05-15",
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

      const dependent = await db
        .selectFrom("dependent")
        .where("id", "=", result.dependentIds[0])
        .selectAll()
        .executeTakeFirst();

      expect(dependent).toBeTruthy();
      expect(dependent!.name).toBe("Child One");
      expect(dependent!.sex).toBe("male");
    });

    it("creates charge with correct amount: 50 for first, 30 for additional", async () => {
      const { addDependents } = await import("./service.js");

      await seedTestUser(db, { email: "parent2@test.com" });

      const result = await addDependents("parent2@test.com", [
        {
          name: "Child A",
          sex: "female",
          dob: "2015-03-10",
          whatsapp_consent: true,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
        {
          name: "Child B",
          sex: "male",
          dob: "2017-07-20",
          whatsapp_consent: false,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
      ]);

      const charge = await db
        .selectFrom("charge")
        .where("id", "=", result.chargeId)
        .selectAll()
        .executeTakeFirst();

      expect(charge).toBeTruthy();
      // First child = 5000, second child = 3000
      expect(charge!.amount_pence).toBe(8000);
    });

    it("links charge to dependents via charge_dependent", async () => {
      const { addDependents } = await import("./service.js");

      await seedTestUser(db, { email: "parent3@test.com" });

      const result = await addDependents("parent3@test.com", [
        {
          name: "Child X",
          sex: "male",
          dob: "2016-01-01",
          whatsapp_consent: true,
          emergency_medical_consent: true,
          medical_fitness_declaration: true,
          data_protection_consent: true,
          photo_consent: true,
        },
      ]);

      const links = await db
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
      const { getDependents } = await import("./service.js");

      const { memberId, email } = await seedTestUser(db, {
        email: "parent4@test.com",
      });

      const depId = crypto.randomUUID();
      await db
        .insertInto("dependent")
        .values({
          id: depId,
          member_id: memberId,
          name: "Test Child",
          sex: "male",
          dob: "2015-06-01",
        })
        .execute();

      await db
        .insertInto("membership")
        .values({
          id: crypto.randomUUID(),
          member_id: memberId,
          dependent_id: depId,
          paid_until: "2026-09-30",
          type: "junior",
        })
        .execute();

      const result = await getDependents(email);

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].name).toBe("Test Child");
      expect(result.dependents[0].paid_until).toBe("2026-09-30");
      expect(result.dependents[0].parent.email).toBe(email);
    });
  });

  describe("listMyTeams", () => {
    it("returns all teams for admin", async () => {
      const { listMyTeams } = await import("./service.js");

      const { userId } = await seedTestUser(db, { role: "admin" });
      await seedJuniorTeam(db, { id: "t1", name: "U9 Boys" });
      await seedJuniorTeam(db, { id: "t2", name: "U11 Girls", sex: "female" });

      const teams = await listMyTeams(userId, "admin");
      expect(teams).toHaveLength(2);
    });

    it("returns only assigned teams for junior_manager", async () => {
      const { listMyTeams } = await import("./service.js");

      const { userId } = await seedTestUser(db, { role: "junior_manager" });
      const t1 = await seedJuniorTeam(db, { id: "t3", name: "U9 Boys" });
      await seedJuniorTeam(db, { id: "t4", name: "U11 Girls", sex: "female" });
      await assignManager(db, userId, t1);

      const teams = await listMyTeams(userId, "junior_manager");
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe("U9 Boys");
    });
  });
});
