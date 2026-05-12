import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";

async function notImplemented(): Promise<never> {
  const err = new Error("Not implemented") as Error & { statusCode: number };
  err.statusCode = 501;
  await Promise.resolve();
  throw err;
}

/**
 * Resolves the set of member ids the caller is allowed to submit a relief
 * request for: their own member record (if any) plus any junior member they
 * are linked to via member_parent_link.
 */
export function getEligibleMembers(db: Kysely<DB>) {
  return async (callerUserEmail: string) => {
    const self = await db
      .selectFrom("member")
      .where("email", "=", callerUserEmail)
      .where("deleted_at", "is", null)
      .select(["id", "name"])
      .executeTakeFirst();

    const items: Array<{
      memberId: string;
      name: string | null;
      relationship: "self" | "junior";
    }> = [];

    if (self) {
      items.push({
        memberId: self.id,
        name: self.name,
        relationship: "self",
      });

      const juniors = await db
        .selectFrom("member_parent_link")
        .innerJoin("member", "member.id", "member_parent_link.member_id")
        .where("member_parent_link.parent_member_id", "=", self.id)
        .where("member.deleted_at", "is", null)
        .select(["member.id", "member.name"])
        .orderBy("member.name", "asc")
        .execute();

      for (const j of juniors) {
        items.push({
          memberId: j.id,
          name: j.name,
          relationship: "junior",
        });
      }
    }

    return { members: items };
  };
}

export function submitReliefRequest(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function getMyReliefStatus(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function withdrawReliefRequest(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function listReliefRequestsForAdmin(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function getReliefRequestDetail(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function transitionReliefRequestStatus(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function declineReliefRequest(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function decideReliefRequest(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function closeReliefGrant(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function applyMembershipRelief(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function getReliefReport(_db: Kysely<DB>) {
  return async () => await notImplemented();
}
