import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { getAuthSession, requireVerifiedEmail } from "../auth/middleware.js";
import { updateMemberSchema } from "./schemas.js";
import { getMemberDetails, updateMemberDetails } from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const memberRoutes: FastifyPluginAsync = async (app) => {
  const getDetails = getMemberDetails(app.db);
  const updateDetails = updateMemberDetails(app.db);

  app.get(
    "/members/me",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const member = await getDetails(user.email);
      return { member };
    },
  );

  app.put(
    "/members/me",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const data = parseBody(request, updateMemberSchema);
      await updateDetails(user.email, data);
      return { success: true };
    },
  );
};
