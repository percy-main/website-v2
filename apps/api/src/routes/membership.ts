import type { FastifyPluginAsync } from "fastify";
import { client } from "@percy-main/db";
import { requireAuth } from "../middleware/auth.js";

export const membershipRoutes: FastifyPluginAsync = async (app) => {
  app.get("/membership", { preHandler: [requireAuth] }, async (request) => {
    const { user } = request.authSession!;

    const membership = await client
      .selectFrom("membership")
      .leftJoin("member", "member.id", "membership.member_id")
      .where("member.email", "=", user.email)
      .where("membership.dependent_id", "is", null)
      .select([
        "membership.id",
        "membership.type",
        "membership.paid_until",
        "membership.created_at",
      ])
      .executeTakeFirst();

    return { membership: membership ?? null };
  });
};
