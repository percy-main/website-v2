import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type Stripe from "stripe";
import type { MemberUpdate } from "./schemas.ts";

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
    });

    // Collect unique product IDs from subscription items, then batch-fetch
    const productIds = new Set<string>();
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        const pid = item.price?.product;
        if (typeof pid === "string") productIds.add(pid);
      }
    }

    const products = new Map<string, { id: string; name: string }>();
    await Promise.all(
      [...productIds].map(async (id) => {
        const product = await stripe.products.retrieve(id);
        products.set(id, { id: product.id, name: product.name });
      }),
    );

    return subscriptions.data.map((sub) => {
      const item = sub.items.data[0];
      const productId =
        typeof item?.price?.product === "string" ? item.price.product : "";
      const product = products.get(productId) ?? { id: "", name: "" };

      return {
        id: sub.id,
        name: item?.price?.nickname ?? null,
        product,
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
      await db
        .updateTable("member")
        .set(data)
        .where("id", "=", existing.id)
        .execute();
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
