import type { DB } from "@percy-main/db";
import { getAgeGroup, getTeamName, nameSimilarity } from "@percy-main/shared";
import type { Kysely } from "kysely";
import type {
  CreateCharge,
  CreateMember,
  LinkDependent,
  ListJuniors,
  ListUsers,
  RecordLinking,
  SearchUsersForLinking,
  Unlink,
  UnlinkDependent,
  UpdateUser,
} from "./schemas.js";

export function listUsers(db: Kysely<DB>) {
  return async (params: ListUsers) => {
    const { page, pageSize, search, includeArchived, role } = params;
    const offset = (page - 1) * pageSize;

    let query = db
      .selectFrom("user")
      .leftJoin("member", "member.email", "user.email")
      .leftJoin("membership", "membership.member_id", "member.id");

    if (!includeArchived) {
      query = query.where((eb) =>
        eb.or([eb("user.banned", "=", false), eb("user.banned", "is", null)]),
      );
    }

    if (search) {
      const pattern = `%${search}%`;
      query = query.where((eb) =>
        eb.or([
          eb("user.name", "ilike", pattern),
          eb("user.email", "ilike", pattern),
        ]),
      );
    }

    if (role) {
      query = query.where("user.role", "=", role);
    }

    if (params.memberCategory) {
      query = query.where("member.member_category", "=", params.memberCategory);
    }

    if (params.isMember !== undefined) {
      if (params.isMember) {
        query = query.where("member.id", "is not", null);
      } else {
        query = query.where("member.id", "is", null);
      }
    }

    if (params.membershipStatus) {
      const now = new Date().toISOString();
      if (params.membershipStatus === "active") {
        query = query.where("membership.paid_until", ">", now);
      } else if (params.membershipStatus === "lapsed") {
        query = query
          .where("membership.paid_until", "is not", null)
          .where("membership.paid_until", "<=", now);
      } else if (params.membershipStatus === "none") {
        query = query.where("membership.id", "is", null);
      }
    }

    if (params.membershipType) {
      query = query.where("membership.type", "=", params.membershipType);
    }

    const [items, countResult] = await Promise.all([
      query
        .select([
          "user.id",
          "user.name",
          "user.email",
          "user.role",
          "user.banned",
          "user.emailVerified",
          "user.createdAt",
          "member.id as memberId",
          "member.member_category",
          "member.deleted_at as memberDeletedAt",
          "member.deleted_reason as memberDeletedReason",
          "membership.type as membershipType",
          "membership.paid_until as membershipPaidUntil",
        ])
        .orderBy("user.createdAt", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
      query.select(db.fn.countAll().as("total")).executeTakeFirst(),
    ]);

    return {
      items,
      total: Number(countResult?.total ?? 0),
      page,
      pageSize,
    };
  };
}

export function updateUser(db: Kysely<DB>) {
  return async (userId: string, data: Omit<UpdateUser, "userId">) => {
    const fieldsToUpdate: Record<string, unknown> = {};
    if (data.name !== undefined) fieldsToUpdate.name = data.name;
    if (data.email !== undefined) fieldsToUpdate.email = data.email;
    if (data.role !== undefined) fieldsToUpdate.role = data.role;
    if (data.banned !== undefined) fieldsToUpdate.banned = data.banned;
    if (data.banReason !== undefined) fieldsToUpdate.banReason = data.banReason;

    if (Object.keys(fieldsToUpdate).length > 0) {
      await db
        .updateTable("user")
        .set(fieldsToUpdate)
        .where("id", "=", userId)
        .execute();
    }

    return { success: true };
  };
}

export function createMember(db: Kysely<DB>) {
  return async (data: CreateMember) => {
    const id = crypto.randomUUID();

    await db
      .insertInto("member")
      .values({
        id,
        email: data.email,
        name: data.name ?? null,
        title: data.title ?? null,
        member_category: data.memberCategory ?? null,
      })
      .execute();

    return { id };
  };
}

export function sendChargeNotification(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select(["email", "name"])
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .select("id")
      .executeTakeFirst();

    if (!member) {
      const error = new Error("No member record found for user") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const unpaidCharges = await db
      .selectFrom("charge")
      .where("member_id", "=", member.id)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      .where("deleted_at", "is", null)
      .selectAll()
      .execute();

    if (unpaidCharges.length === 0) {
      return { sent: false, reason: "No outstanding charges" };
    }

    // TODO: Send email notification via email service
    return { sent: true, chargeCount: unpaidCharges.length };
  };
}

export function getRecordLinking(db: Kysely<DB>) {
  return async () => {
    const [members, dependents] = await Promise.all([
      db
        .selectFrom("member")
        .where("deleted_at", "is", null)
        .select(["id", "name", "play_cricket_id", "contentful_entry_id"])
        .orderBy("name", "asc")
        .execute(),
      db
        .selectFrom("dependent")
        .innerJoin("member", "member.id", "dependent.member_id")
        .where("member.deleted_at", "is", null)
        .select([
          "dependent.id",
          "dependent.name",
          "dependent.play_cricket_id",
          "member.name as parentName",
        ])
        .orderBy("dependent.name", "asc")
        .execute(),
    ]);

    return { members, dependents };
  };
}

export function linkPlayCricketPlayer(db: Kysely<DB>) {
  return async (
    type: RecordLinking["type"],
    id: string,
    playCricketId: string,
  ) => {
    const table = type === "member" ? "member" : "dependent";

    await db
      .updateTable(table)
      .set({ play_cricket_id: playCricketId })
      .where("id", "=", id)
      .execute();

    return { success: true };
  };
}

export function unlinkPlayCricketPlayer(db: Kysely<DB>) {
  return async (type: Unlink["type"], id: string) => {
    const table = type === "member" ? "member" : "dependent";

    await db
      .updateTable(table)
      .set({ play_cricket_id: null })
      .where("id", "=", id)
      .execute();

    return { success: true };
  };
}

export function linkContentfulPerson(db: Kysely<DB>) {
  return async (memberId: string, contentfulEntryId: string) => {
    await db
      .updateTable("member")
      .set({ contentful_entry_id: contentfulEntryId })
      .where("id", "=", memberId)
      .execute();

    return { success: true };
  };
}

export function unlinkContentfulPerson(db: Kysely<DB>) {
  return async (memberId: string) => {
    await db
      .updateTable("member")
      .set({ contentful_entry_id: null })
      .where("id", "=", memberId)
      .execute();

    return { success: true };
  };
}

export function getUserDetail(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select([
        "id",
        "name",
        "email",
        "role",
        "banned",
        "emailVerified",
        "createdAt",
      ])
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .selectAll()
      .executeTakeFirst();

    const membership = member
      ? await db
          .selectFrom("membership")
          .where("member_id", "=", member.id)
          .selectAll()
          .executeTakeFirst()
      : null;

    const dependents = member
      ? await db
          .selectFrom("dependent")
          .where("dependent.member_id", "=", member.id)
          .leftJoin("membership", (join) =>
            join
              .onRef("membership.dependent_id", "=", "dependent.id")
              .onRef("membership.member_id", "=", "dependent.member_id"),
          )
          .select([
            "dependent.id",
            "dependent.name",
            "dependent.dob",
            "dependent.sex",
            "dependent.school_year",
            "dependent.photo_consent",
            "dependent.gp_surgery",
            "dependent.gp_phone",
            "dependent.alt_contact_name",
            "dependent.alt_contact_phone",
            "dependent.emergency_medical_consent",
            "dependent.has_disability",
            "dependent.disability_type",
            "dependent.medical_info",
            "membership.paid_until as membershipPaidUntil",
          ])
          .execute()
      : [];

    const charges = member
      ? await db
          .selectFrom("charge")
          .where("member_id", "=", member.id)
          .selectAll()
          .orderBy("charge_date", "desc")
          .execute()
      : [];

    const juniorManagerTeams = await db
      .selectFrom("junior_team_manager")
      .innerJoin(
        "junior_team",
        "junior_team.id",
        "junior_team_manager.junior_team_id",
      )
      .where("junior_team_manager.user_id", "=", userId)
      .select([
        "junior_team.id",
        "junior_team.name",
        "junior_team.age_group",
        "junior_team.sex",
      ])
      .execute();

    const officialTeams = await db
      .selectFrom("team_official")
      .innerJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "team_official.play_cricket_team_id",
      )
      .where("team_official.user_id", "=", userId)
      .select(["play_cricket_team.id", "play_cricket_team.name"])
      .execute();

    return {
      user,
      member: member ?? null,
      membership: membership ?? null,
      dependents,
      charges,
      juniorManagerTeams,
      officialTeams,
    };
  };
}

export function setMemberCategory(db: Kysely<DB>) {
  return async (userId: string, memberCategory: string | null) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await db
      .updateTable("member")
      .set({ member_category: memberCategory })
      .where("email", "=", user.email)
      .execute();

    return { success: true };
  };
}

export function archiveMember(db: Kysely<DB>) {
  return async (userId: string, reason: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const now = new Date().toISOString();

    await Promise.all([
      db
        .updateTable("user")
        .set({ banned: true, banReason: reason })
        .where("id", "=", userId)
        .execute(),
      db
        .updateTable("member")
        .set({
          deleted_at: now,
          deleted_by: userId,
          deleted_reason: reason,
        })
        .where("email", "=", user.email)
        .execute(),
    ]);

    return { success: true };
  };
}

export function restoreMember(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await Promise.all([
      db
        .updateTable("user")
        .set({ banned: false, banReason: null })
        .where("id", "=", userId)
        .execute(),
      db
        .updateTable("member")
        .set({
          deleted_at: null,
          deleted_by: null,
          deleted_reason: null,
        })
        .where("email", "=", user.email)
        .execute(),
    ]);

    return { success: true };
  };
}

export function createCharge(db: Kysely<DB>) {
  return async (userId: string, adminUserId: string, data: CreateCharge) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .select("id")
      .executeTakeFirst();

    if (!member) {
      const error = new Error("No member record found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const id = crypto.randomUUID();

    await db
      .insertInto("charge")
      .values({
        id,
        member_id: member.id,
        description: data.description,
        amount_pence: data.amountPence,
        charge_date: data.chargeDate,
        created_by: adminUserId,
        source: "admin",
        type: "manual",
      })
      .execute();

    return { id };
  };
}

export function deleteCharge(db: Kysely<DB>) {
  return async (chargeId: string, adminUserId: string, reason: string) => {
    const now = new Date().toISOString();

    const result = await db
      .updateTable("charge")
      .set({
        deleted_at: now,
        deleted_by: adminUserId,
        deleted_reason: reason,
      })
      .where("id", "=", chargeId)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      const error = new Error("Charge not found or already paid") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}

export function setJuniorManagerTeams(db: Kysely<DB>) {
  return async (userId: string, teamIds: string[]) => {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("junior_team_manager")
        .where("user_id", "=", userId)
        .execute();

      if (teamIds.length > 0) {
        await trx
          .insertInto("junior_team_manager")
          .values(
            teamIds.map((teamId) => ({
              user_id: userId,
              junior_team_id: teamId,
            })),
          )
          .execute();

        await trx
          .updateTable("user")
          .set({ role: "junior_manager" })
          .where("id", "=", userId)
          .execute();
      } else {
        const user = await trx
          .selectFrom("user")
          .where("id", "=", userId)
          .select("role")
          .executeTakeFirst();

        if (user?.role === "junior_manager") {
          await trx
            .updateTable("user")
            .set({ role: "user" })
            .where("id", "=", userId)
            .execute();
        }
      }
    });

    return { success: true };
  };
}

export function setOfficialTeams(db: Kysely<DB>) {
  return async (userId: string, teamIds: string[]) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("role")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    if (user.role === "admin") {
      const error = new Error(
        "Cannot assign official role to an admin. Demote them first.",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    await db
      .deleteFrom("team_official")
      .where("user_id", "=", userId)
      .execute();

    if (teamIds.length > 0) {
      await db
        .insertInto("team_official")
        .values(
          teamIds.map((teamId) => ({
            user_id: userId,
            play_cricket_team_id: teamId,
          })),
        )
        .execute();

      await db
        .updateTable("user")
        .set({ role: "official" })
        .where("id", "=", userId)
        .execute();
    } else {
      if (user.role === "official") {
        await db
          .updateTable("user")
          .set({ role: "user" })
          .where("id", "=", userId)
          .execute();
      }
    }

    return { success: true };
  };
}

export function getAllJuniorTeams(db: Kysely<DB>) {
  return async () => {
    return await db
      .selectFrom("junior_team")
      .selectAll()
      .orderBy("sex", "asc")
      .orderBy("age_group", "asc")
      .execute();
  };
}

export function getAllPlayCricketTeams(db: Kysely<DB>) {
  return async () => {
    return await db
      .selectFrom("play_cricket_team")
      .selectAll()
      .orderBy("name", "asc")
      .execute();
  };
}

export function listJuniors(db: Kysely<DB>) {
  return async (params: ListJuniors) => {
    const { page, pageSize, search, sex, ageGroup, membershipStatus } = params;

    let query = db
      .selectFrom("dependent")
      .innerJoin("member", "member.id", "dependent.member_id")
      .leftJoin("membership", (join) =>
        join
          .onRef("membership.dependent_id", "=", "dependent.id")
          .on("membership.type", "=", "junior"),
      )
      .leftJoin("user", "user.id", "dependent.user_id")
      .where("member.deleted_at", "is", null);

    if (sex !== "all") {
      query = query.where("dependent.sex", "=", sex);
    }

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb("dependent.name", "ilike", term),
          eb("member.name", "ilike", term),
        ]),
      );
    }

    // Age group and membership status are computed values — must post-filter
    const allRows = await query
      .select([
        "dependent.id",
        "dependent.name",
        "dependent.sex",
        "dependent.dob",
        "dependent.created_at as registeredAt",
        "member.name as parentName",
        "member.email as parentEmail",
        "member.telephone as parentTelephone",
        "membership.paid_until as paidUntil",
        "dependent.user_id as linkedUserId",
        "user.email as linkedUserEmail",
      ])
      .orderBy("dependent.name", "asc")
      .execute();

    const now = new Date();
    const filtered = allRows.filter((row) => {
      if (ageGroup !== "all" && getAgeGroup(row.dob) !== ageGroup) {
        return false;
      }
      if (
        membershipStatus === "paid" &&
        !(row.paidUntil && new Date(row.paidUntil) >= now)
      ) {
        return false;
      }
      if (
        membershipStatus === "unpaid" &&
        row.paidUntil &&
        new Date(row.paidUntil) >= now
      ) {
        return false;
      }
      return true;
    });

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    return {
      juniors: paged.map((row) => ({
        id: row.id,
        name: row.name,
        sex: row.sex,
        dob: row.dob,
        registeredAt: row.registeredAt,
        parentName: row.parentName,
        parentEmail: row.parentEmail,
        parentTelephone: row.parentTelephone,
        paidUntil: row.paidUntil,
        ageGroup: getAgeGroup(row.dob),
        teamName: getTeamName(row.dob, row.sex),
        hasOwnAccount: row.linkedUserId != null,
        linkedUserEmail: row.linkedUserEmail ?? null,
      })),
      total,
      page,
      pageSize,
    };
  };
}

export function searchUsersForLinking(db: Kysely<DB>) {
  return async (params: SearchUsersForLinking) => {
    const { dependentId, search } = params;

    const dep = await db
      .selectFrom("dependent")
      .select("name")
      .where("id", "=", dependentId)
      .executeTakeFirst();

    if (!dep) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    let query = db.selectFrom("user").select(["id", "name", "email"]);

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([eb("name", "ilike", term), eb("email", "ilike", term)]),
      );
    }

    const users = await query.limit(50).execute();

    const scored = users
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        score: nameSimilarity(dep.name, u.name),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return { dependentName: dep.name, users: scored };
  };
}

export function linkDependentToUser(db: Kysely<DB>) {
  return async (params: LinkDependent) => {
    const { dependentId, userId } = params;

    const dep = await db
      .selectFrom("dependent")
      .select(["id", "user_id"])
      .where("id", "=", dependentId)
      .executeTakeFirst();

    if (!dep) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    if (dep.user_id != null) {
      const error = new Error(
        "Dependent is already linked to a user. Unlink first.",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    const user = await db
      .selectFrom("user")
      .select("id")
      .where("id", "=", userId)
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await db
      .updateTable("dependent")
      .set({ user_id: userId })
      .where("id", "=", dependentId)
      .execute();

    return { success: true };
  };
}

export function unlinkDependentUser(db: Kysely<DB>) {
  return async (params: UnlinkDependent) => {
    const { dependentId } = params;

    const result = await db
      .updateTable("dependent")
      .set({ user_id: null })
      .where("id", "=", dependentId)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}
