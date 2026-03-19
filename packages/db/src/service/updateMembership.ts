import { defaultCategoryForMembershipType } from "@percy-main/shared";
import { randomUUID } from "crypto";
import { add, type Duration } from "date-fns";
import type { Kysely } from "kysely";
import type { DB } from "../__generated__/db.ts";

export function updateMembership(db: Kysely<DB>) {
  return async ({
    membershipType,
    email,
    addedDuration,
    paidAt,
    paidUntil: explicitPaidUntil,
  }: {
    membershipType: string;
    email: string;
    addedDuration: Duration;
    paidAt: Date;
    paidUntil?: Date;
  }) => {
    console.log(
      "Updating membership",
      JSON.stringify({ membershipType, email, addedDuration, paidAt }, null, 2),
    );

    const member = await db
      .selectFrom("member")
      .leftJoin("membership", (join) =>
        join
          .onRef("member.id", "=", "membership.member_id")
          .on("membership.type", "=", membershipType),
      )
      .select([
        "member.id as member_id",
        "membership.id as membership_id",
        "membership.paid_until as paid_until",
        "member.name as name",
        "member.member_category as member_category",
      ])
      .where("member.email", "=", email)
      .executeTakeFirst();

    if (!member) {
      const newMemberId = randomUUID();
      await db
        .insertInto("member")
        .values({ id: newMemberId, email })
        .execute();

      const paid_until = explicitPaidUntil
        ? explicitPaidUntil.toISOString()
        : add(paidAt, addedDuration).toISOString();

      const membership = await db
        .insertInto("membership")
        .values({
          id: randomUUID(),
          type: membershipType,
          member_id: newMemberId,
          paid_until,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const category = defaultCategoryForMembershipType(membershipType);
      if (category) {
        await db
          .updateTable("member")
          .set({ member_category: category })
          .where("id", "=", newMemberId)
          .execute();
      }

      return { ...membership, name: null, isNew: true };
    }

    console.log("Adding membership duration", addedDuration);

    if (!member.membership_id) {
      console.log("No existing membership for customer, creating membership");

      const paid_until = explicitPaidUntil
        ? explicitPaidUntil.toISOString()
        : add(paidAt, addedDuration).toISOString();

      const membership = await db
        .insertInto("membership")
        .values({
          id: randomUUID(),
          type: membershipType,
          member_id: member.member_id,
          paid_until,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (!member.member_category) {
        const category = defaultCategoryForMembershipType(membershipType);
        if (category) {
          await db
            .updateTable("member")
            .set({ member_category: category })
            .where("id", "=", member.member_id)
            .execute();
        }
      }

      return { ...membership, name: member.name, isNew: true };
    } else {
      console.log("Existing membership for customer, adding duration");

      const paid_until = explicitPaidUntil
        ? explicitPaidUntil.toISOString()
        : add(
            member.paid_until ? new Date(member.paid_until) : paidAt,
            addedDuration,
          ).toISOString();

      const membership = await db
        .updateTable("membership")
        .set({ paid_until })
        .where("id", "=", member.membership_id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (!member.member_category) {
        const category = defaultCategoryForMembershipType(membershipType);
        if (category) {
          await db
            .updateTable("member")
            .set({ member_category: category })
            .where("id", "=", member.member_id)
            .execute();
        }
      }

      return { ...membership, name: member.name, isNew: false };
    }
  };
}
