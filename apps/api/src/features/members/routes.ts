import type { FastifyPluginAsync } from "fastify";
import { requireVerifiedEmail } from "../auth/middleware.js";
import { parseBody } from "../../lib/validation.js";
import { updateMemberSchema } from "./schemas.js";
import { getMemberDetails, updateMemberDetails } from "./service.js";

export const memberRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/members/me",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = request.authSession!;
      const member = await getMemberDetails(user.email);
      return { member };
    },
  );

  app.put(
    "/members/me",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = request.authSession!;
      const data = parseBody(request, updateMemberSchema);
      await updateMemberDetails(user.email, data);
      return { success: true };
    },
  );
};
