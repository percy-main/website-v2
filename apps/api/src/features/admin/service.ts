import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import type {
  ListUsers,
  UpdateUser,
  CreateMember,
  RecordLinking,
  Unlink,
} from "./schemas.js";

export function listUsers(db: Kysely<DB>) {
  return async (params: ListUsers) => {
    const { page, pageSize, search, includeArchived, role } = params;
    const offset = (page - 1) * pageSize;

    let query = db
      .selectFrom("user")
      .leftJoin("member", "member.email", "user.email");

    if (!includeArchived) {
      query = query.where((eb) =>
        eb.or([eb("user.banned", "=", false), eb("user.banned", "is", null)]),
      );
    }

    if (search) {
      const pattern = `%${search}%`;
      query = query.where((eb) =>
        eb.or([
          eb("user.name", "like", pattern),
          eb("user.email", "like", pattern),
        ]),
      );
    }

    if (role) {
      query = query.where("user.role", "=", role);
    }

    if (params.memberCategory) {
      query = query.where("member.member_category", "=", params.memberCategory);
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
        ])
        .orderBy("user.createdAt", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
      query
        .select(db.fn.countAll().as("total"))
        .executeTakeFirst(),
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
