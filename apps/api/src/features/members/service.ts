import { client } from "@percy-main/db";
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

export async function getMemberDetails(email: string) {
  const member = await client
    .selectFrom("member")
    .where("email", "=", email)
    .where("deleted_at", "is", null)
    .select([...MEMBER_COLUMNS])
    .executeTakeFirst();

  return member ?? null;
}

export async function updateMemberDetails(email: string, data: MemberUpdate) {
  const existing = await client
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
      await client
        .updateTable("member")
        .set(fieldsToUpdate)
        .where("id", "=", existing.id)
        .execute();
    }
  } else {
    await client
      .insertInto("member")
      .values({
        id: crypto.randomUUID(),
        email,
        ...data,
      })
      .execute();
  }
}
