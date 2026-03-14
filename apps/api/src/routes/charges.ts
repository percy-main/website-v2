import type { FastifyPluginAsync } from "fastify";
import { client } from "@percy-main/db";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";
import { parseBody } from "../lib/validation.js";

export const chargeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/charges", { preHandler: [requireAuth] }, async (request) => {
    const { user } = request.authSession!;

    const member = await client
      .selectFrom("member")
      .where("email", "=", user.email)
      .select(["id"])
      .executeTakeFirst();

    if (!member) {
      return { charges: [] };
    }

    const charges = await client
      .selectFrom("charge")
      .where("member_id", "=", member.id)
      .where("deleted_at", "is", null)
      .selectAll()
      .orderBy("charge_date", "desc")
      .execute();

    return { charges };
  });

  app.post(
    "/charges/confirm-payment",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { user } = request.authSession!;
      const { paymentIntentId } = parseBody(
        request,
        z.object({ paymentIntentId: z.string() }),
      );

      const member = await client
        .selectFrom("member")
        .where("email", "=", user.email)
        .select(["id"])
        .executeTakeFirst();

      if (!member) {
        return reply.status(404).send({ error: "No member record found" });
      }

      await client
        .updateTable("charge")
        .set({ payment_confirmed_at: new Date().toISOString() })
        .where("member_id", "=", member.id)
        .where("stripe_payment_intent_id", "=", paymentIntentId)
        .where("paid_at", "is", null)
        .where("payment_confirmed_at", "is", null)
        .execute();

      return { success: true };
    },
  );
};
