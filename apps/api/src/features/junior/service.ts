import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import type { DependentInput } from "./schemas.js";

const FIRST_CHILD_FEE_PENCE = 5000;
const ADDITIONAL_CHILD_FEE_PENCE = 3000;

/**
 * Find an existing member by email or create a minimal record.
 */
async function findOrCreateMember(db: Kysely<DB>, email: string): Promise<string> {
  const existing = await db
    .selectFrom("member")
    .where("email", "=", email)
    .where("deleted_at", "is", null)
    .select(["id"])
    .executeTakeFirst();

  if (existing) {
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .insertInto("member")
    .values({ id, email })
    .execute();

  return id;
}

/**
 * Count dependents registered by a member in the current calendar year.
 */
async function countDependentsThisYear(db: Kysely<DB>, memberId: string): Promise<number> {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const result = await db
    .selectFrom("dependent")
    .where("member_id", "=", memberId)
    .where("created_at", ">=", yearStart)
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirst();

  return Number(result?.count ?? 0);
}

/**
 * Validate that a dependent's date of birth indicates they are under 18.
 */
function validateAge(dob: string): void {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  if (age >= 18) {
    const error = new Error("Dependent must be under 18 years old") as Error & {
      statusCode: number;
    };
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Register one or more dependents for a member, creating a charge record.
 */
export function addDependents(db: Kysely<DB>) {
  return async (email: string, dependents: DependentInput[]) => {
    const memberId = await findOrCreateMember(db, email);
    const existingCount = await countDependentsThisYear(db, memberId);

    const dependentIds: string[] = [];
    for (const dep of dependents) {
      validateAge(dep.dob);

      const id = crypto.randomUUID();
      await db
        .insertInto("dependent")
        .values({
          id,
          member_id: memberId,
          name: dep.name,
          sex: dep.sex,
          dob: dep.dob,
          school_year: dep.school_year ?? null,
          played_before: dep.played_before ?? null,
          previous_cricket: dep.previous_cricket ?? null,
          whatsapp_consent: dep.whatsapp_consent,
          alt_contact_name: dep.alt_contact_name ?? null,
          alt_contact_phone: dep.alt_contact_phone ?? null,
          alt_contact_whatsapp_consent: dep.alt_contact_whatsapp_consent ?? null,
          gp_surgery: dep.gp_surgery ?? null,
          gp_phone: dep.gp_phone ?? null,
          has_disability: dep.has_disability ?? null,
          disability_type: dep.disability_type ?? null,
          medical_info: dep.medical_info ?? null,
          emergency_medical_consent: dep.emergency_medical_consent,
          medical_fitness_declaration: dep.medical_fitness_declaration,
          data_protection_consent: dep.data_protection_consent,
          photo_consent: dep.photo_consent,
        })
        .execute();

      dependentIds.push(id);
    }

    // Calculate charge: first child this year = £50, additional = £30 each
    let totalPence = 0;
    for (let i = 0; i < dependents.length; i++) {
      const overallIndex = existingCount + i;
      totalPence +=
        overallIndex === 0 ? FIRST_CHILD_FEE_PENCE : ADDITIONAL_CHILD_FEE_PENCE;
    }

    const chargeId = crypto.randomUUID();
    const today = new Date().toISOString().split("T")[0];

    await db
      .insertInto("charge")
      .values({
        id: chargeId,
        member_id: memberId,
        amount_pence: totalPence,
        description: `Junior registration: ${dependents.length} child(ren)`,
        charge_date: today,
        created_by: "system",
        type: "junior_registration",
        source: "website",
      })
      .execute();

    // Link charge to dependents
    for (const depId of dependentIds) {
      await db
        .insertInto("charge_dependent")
        .values({ charge_id: chargeId, dependent_id: depId })
        .execute();
    }

    return { dependentIds, memberId, chargeId };
  };
}

/**
 * Get all dependents for a member, including membership info.
 */
export function getDependents(db: Kysely<DB>) {
  return async (email: string) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .where("deleted_at", "is", null)
      .select(["id", "name", "telephone", "email"])
      .executeTakeFirst();

    if (!member) {
      return { dependents: [], currentYearCount: 0 };
    }

    const dependents = await db
      .selectFrom("dependent")
      .leftJoin("membership", "membership.dependent_id", "dependent.id")
      .where("dependent.member_id", "=", member.id)
      .select([
        "dependent.id",
        "dependent.name",
        "dependent.sex",
        "dependent.dob",
        "dependent.school_year",
        "dependent.played_before",
        "dependent.previous_cricket",
        "dependent.whatsapp_consent",
        "dependent.created_at",
        "membership.paid_until",
      ])
      .execute();

    const yearStart = `${new Date().getFullYear()}-01-01`;
    const currentYearCount = dependents.filter(
      (d) => d.created_at >= yearStart,
    ).length;

    return {
      dependents: dependents.map((d) => ({
        ...d,
        parent: {
          name: member.name,
          telephone: member.telephone,
          email: member.email,
        },
      })),
      currentYearCount,
    };
  };
}

/**
 * List teams visible to the user based on their role.
 */
export function listMyTeams(db: Kysely<DB>) {
  return async (userId: string, role: string) => {
    if (role === "admin") {
      return db
        .selectFrom("junior_team")
        .selectAll()
        .orderBy("name", "asc")
        .execute();
    }

    // junior_manager: only assigned teams
    return db
      .selectFrom("junior_team_manager")
      .innerJoin("junior_team", "junior_team.id", "junior_team_manager.junior_team_id")
      .where("junior_team_manager.user_id", "=", userId)
      .select([
        "junior_team.id",
        "junior_team.name",
        "junior_team.age_group",
        "junior_team.sex",
        "junior_team.created_at",
      ])
      .orderBy("junior_team.name", "asc")
      .execute();
  };
}

/**
 * Compute an age group string (e.g. "U11") from a date of birth,
 * based on age on September 1st of the current year.
 */
function computeAgeGroup(dob: string): string {
  const birthDate = new Date(dob);
  const year = new Date().getFullYear();
  const septFirst = new Date(year, 8, 1); // September 1
  let age = septFirst.getFullYear() - birthDate.getFullYear();
  const monthDiff = septFirst.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && septFirst.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return `U${age + 1}`;
}

/**
 * List players (dependents) matching a team's age group and sex.
 * Verifies the user has access to the team.
 */
export function listPlayers(db: Kysely<DB>) {
  return async (userId: string, role: string, teamId: string) => {
    // Verify access
    if (role !== "admin") {
      const assignment = await db
        .selectFrom("junior_team_manager")
        .where("junior_team_id", "=", teamId)
        .where("user_id", "=", userId)
        .select(["junior_team_id"])
        .executeTakeFirst();

      if (!assignment) {
        const error = new Error("Not assigned to this team") as Error & {
          statusCode: number;
        };
        error.statusCode = 403;
        throw error;
      }
    }

    const team = await db
      .selectFrom("junior_team")
      .where("id", "=", teamId)
      .select(["age_group", "sex"])
      .executeTakeFirst();

    if (!team) {
      const error = new Error("Team not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    // Get all dependents, then filter by computed age group and sex
    const allDependents = await db
      .selectFrom("dependent")
      .innerJoin("member", "member.id", "dependent.member_id")
      .where("dependent.sex", "=", team.sex)
      .select([
        "dependent.id",
        "dependent.name",
        "dependent.sex",
        "dependent.dob",
        "dependent.school_year",
        "dependent.played_before",
        "dependent.medical_info",
        "member.name as parent_name",
        "member.telephone as parent_telephone",
        "member.email as parent_email",
      ])
      .execute();

    return allDependents.filter((d) => computeAgeGroup(d.dob) === team.age_group);
  };
}

/**
 * Get detailed information for a single dependent.
 * Verifies the user has access via team assignment.
 */
export function getPlayerDetail(db: Kysely<DB>) {
  return async (userId: string, role: string, dependentId: string) => {
    const dependent = await db
      .selectFrom("dependent")
      .innerJoin("member", "member.id", "dependent.member_id")
      .where("dependent.id", "=", dependentId)
      .select([
        "dependent.id",
        "dependent.name",
        "dependent.sex",
        "dependent.dob",
        "dependent.school_year",
        "dependent.played_before",
        "dependent.previous_cricket",
        "dependent.whatsapp_consent",
        "dependent.alt_contact_name",
        "dependent.alt_contact_phone",
        "dependent.alt_contact_whatsapp_consent",
        "dependent.gp_surgery",
        "dependent.gp_phone",
        "dependent.has_disability",
        "dependent.disability_type",
        "dependent.medical_info",
        "dependent.emergency_medical_consent",
        "dependent.medical_fitness_declaration",
        "dependent.data_protection_consent",
        "dependent.photo_consent",
        "member.name as parent_name",
        "member.telephone as parent_telephone",
        "member.email as parent_email",
        "member.address as parent_address",
        "member.postcode as parent_postcode",
      ])
      .executeTakeFirst();

    if (!dependent) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    // Verify access: admin can see all; junior_manager must be assigned to a
    // team whose age group and sex match this dependent
    if (role !== "admin") {
      const ageGroup = computeAgeGroup(dependent.dob);
      const assignedTeam = await db
        .selectFrom("junior_team_manager")
        .innerJoin(
          "junior_team",
          "junior_team.id",
          "junior_team_manager.junior_team_id",
        )
        .where("junior_team_manager.user_id", "=", userId)
        .where("junior_team.age_group", "=", ageGroup)
        .where("junior_team.sex", "=", dependent.sex)
        .select(["junior_team.id"])
        .executeTakeFirst();

      if (!assignedTeam) {
        const error = new Error("Not authorized to view this player") as Error & {
          statusCode: number;
        };
        error.statusCode = 403;
        throw error;
      }
    }

    return dependent;
  };
}
