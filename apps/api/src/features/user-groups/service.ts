import type { DB } from "@percy-main/db";
import { sql, type Kysely } from "kysely";
import type {
  AddGroupMember,
  CreateGroup,
  SearchUsersForGroup,
} from "./schemas.ts";

function httpError(statusCode: number, message: string): never {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  throw err;
}

const SEARCH_LIMIT = 20;

export function listGroups(db: Kysely<DB>) {
  return async () => {
    const rows = await db
      .selectFrom("user_group")
      .leftJoin(
        "user_group_member",
        "user_group_member.group_id",
        "user_group.id",
      )
      .select((eb) => [
        "user_group.id",
        "user_group.name",
        "user_group.description",
        "user_group.created_at",
        eb.fn.count<string>("user_group_member.member_id").as("member_count"),
      ])
      .groupBy([
        "user_group.id",
        "user_group.name",
        "user_group.description",
        "user_group.created_at",
      ])
      .orderBy("user_group.name", "asc")
      .execute();

    return {
      groups: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        memberCount: Number(r.member_count),
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  };
}

export function getGroup(db: Kysely<DB>) {
  return async (groupId: string) => {
    const group = await db
      .selectFrom("user_group")
      .where("id", "=", groupId)
      .select(["id", "name", "description"])
      .executeTakeFirst();

    if (!group) httpError(404, "Group not found");

    const members = await db
      .selectFrom("user_group_member")
      .innerJoin("member", "member.id", "user_group_member.member_id")
      .where("user_group_member.group_id", "=", groupId)
      .where("member.deleted_at", "is", null)
      .select([
        "member.id as memberId",
        "member.name",
        "member.email",
        "user_group_member.added_at",
      ])
      .orderBy("member.name", "asc")
      .execute();

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      members: members.map((m) => ({
        memberId: m.memberId,
        name: m.name,
        email: m.email,
        addedAt: new Date(m.added_at).toISOString(),
      })),
    };
  };
}

export function createGroup(db: Kysely<DB>) {
  return async (actorUserId: string, data: CreateGroup) => {
    const id = crypto.randomUUID();
    try {
      await db
        .insertInto("user_group")
        .values({
          id,
          name: data.name,
          description: data.description ?? null,
          created_by_user_id: actorUserId,
        })
        .execute();
    } catch (err: unknown) {
      // Unique constraint on name — surface as 409 for the UI.
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("user_group_name")
      ) {
        httpError(409, "A group with that name already exists");
      }
      throw err;
    }
    return { id };
  };
}

export function addGroupMember(db: Kysely<DB>) {
  return async (groupId: string, data: AddGroupMember, actorUserId: string) => {
    const group = await db
      .selectFrom("user_group")
      .where("id", "=", groupId)
      .select("id")
      .executeTakeFirst();
    if (!group) httpError(404, "Group not found");

    const member = await db
      .selectFrom("member")
      .where("id", "=", data.memberId)
      .where("deleted_at", "is", null)
      .select("id")
      .executeTakeFirst();
    if (!member) httpError(404, "Member not found");

    await db
      .insertInto("user_group_member")
      .values({
        group_id: groupId,
        member_id: data.memberId,
        added_by_user_id: actorUserId,
      })
      .onConflict((oc) => oc.columns(["group_id", "member_id"]).doNothing())
      .execute();

    return { success: true };
  };
}

export function removeGroupMember(db: Kysely<DB>) {
  return async (groupId: string, memberId: string) => {
    await db
      .deleteFrom("user_group_member")
      .where("group_id", "=", groupId)
      .where("member_id", "=", memberId)
      .execute();
    return { success: true };
  };
}

export function searchUsersForGroup(db: Kysely<DB>) {
  return async (groupId: string, params: SearchUsersForGroup) => {
    const group = await db
      .selectFrom("user_group")
      .where("id", "=", groupId)
      .select("id")
      .executeTakeFirst();
    if (!group) httpError(404, "Group not found");

    const term = params.q?.trim() ?? "";
    if (term.length === 0) return { users: [] };

    const like = `%${term}%`;
    const existing = db
      .selectFrom("user_group_member")
      .select("member_id")
      .where("group_id", "=", groupId);

    const rows = await db
      .selectFrom("member")
      .where("deleted_at", "is", null)
      .where((eb) =>
        eb.or([eb("name", "ilike", like), eb("email", "ilike", like)]),
      )
      .where("id", "not in", existing)
      .select(["id", "name", "email"])
      .orderBy(
        // Exact prefix match on name/email ranks above substring matches.
        sql`CASE
              WHEN lower(name) LIKE ${term.toLowerCase() + "%"} THEN 0
              WHEN lower(email) LIKE ${term.toLowerCase() + "%"} THEN 1
              ELSE 2
            END`,
      )
      .orderBy("name", "asc")
      .limit(SEARCH_LIMIT)
      .execute();

    return {
      users: rows.map((r) => ({
        memberId: r.id,
        name: r.name,
        email: r.email,
      })),
    };
  };
}
