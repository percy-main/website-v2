import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type Stripe from "stripe";
import type { MemberUpdate } from "./schemas.js";

const MEMBERSHIP_COLUMNS = [
  "membership.id",
  "membership.type",
  "membership.created_at",
  "membership.paid_until",
] as const;

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

export function getMyMembership(db: Kysely<DB>) {
  return async (email: string) => {
    const membership = await db
      .selectFrom("membership")
      .leftJoin("member", "member.id", "membership.member_id")
      .where("member.email", "=", email)
      .where("membership.dependent_id", "is", null)
      .select([...MEMBERSHIP_COLUMNS])
      .orderBy("membership.paid_until", "desc")
      .executeTakeFirst();

    return membership ?? null;
  };
}

export function getMySubscriptions(stripe: Stripe) {
  return async (email: string) => {
    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0];

    if (!customer) {
      return [];
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      expand: ["data.items.data.price.product"],
    });

    return subscriptions.data.map((sub) => {
      const item = sub.items.data[0];
      const product = item?.price?.product as { id: string; name: string };

      return {
        id: sub.id,
        name: item?.price?.nickname ?? null,
        product: { id: product?.id ?? "", name: product?.name ?? "" },
        created: new Date(sub.created * 1000).toISOString(),
        status: sub.status,
        paidUntil: new Date(sub.current_period_end * 1000).toISOString(),
      };
    });
  };
}

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
