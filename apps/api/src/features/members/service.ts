import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import type { MemberUpdate } from "./schemas.js";

const MEMBER_COLUMNS = [
  "title",
  "name",
  "address",
  "postcode",
  "dob",
  "telephone",
  "email",
  "emergency_contact_name",
  "emergency_contact_telephone",
] as const;

export function getMemberDetails(db: Kysely<DB>) {
  return async (email: string) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .where("deleted_at", "is", null)
      .select([...MEMBER_COLUMNS])
      .executeTakeFirst();

    return member ?? null;
  };
}

export function updateMemberDetails(db: Kysely<DB>) {
  return async (email: string, data: MemberUpdate) => {
    const existing = await db
      .selectFrom("member")
      .where("email", "=", email)
      .where("deleted_at", "is", null)
      .select(["id"])
      .executeTakeFirst();

    if (existing) {
      // Only update fields that are present in data
      const fieldsToUpdate: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          fieldsToUpdate[key] = value;
        }
      }

      if (Object.keys(fieldsToUpdate).length > 0) {
        await db
          .updateTable("member")
          .set(fieldsToUpdate)
          .where("id", "=", existing.id)
          .execute();
      }
    } else {
      await db
        .insertInto("member")
        .values({
          id: crypto.randomUUID(),
          email,
          ...data,
        })
        .execute();
    }
  };
}
