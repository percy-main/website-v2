import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type {
  CreateCharge,
  CreateMember,
  ListUsers,
  RecordLinking,
  Unlink,
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
        .select([
          "id",
          "name",
          "email",
          "play_cricket_id",
          "contentful_entry_id",
        ])
        .orderBy("name", "asc")
        .execute(),
      db
        .selectFrom("dependent")
        .select(["id", "name", "play_cricket_id"])
        .orderBy("name", "asc")
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
