import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/middleware.ts";

/**
 * Gates Scout routes to a hard-coded allowlist of email addresses
 * (config.SCOUT_ALLOWED_EMAILS). Scout is alex-only for now; the allowlist
 * is the real boundary, the frontend hide-the-link is just cosmetic.
 *
 * Emits 403 (not 401) on a logged-in user who isn't on the list, so the
 * absence of Scout from the menu and a 403 from the API tell the same story.
 */
export async function requireScoutAccess(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const email = request.authSession?.user.email;
  const allowed = request.server.config.SCOUT_ALLOWED_EMAILS;
  if (!email || !allowed.includes(email)) {
    return reply.status(403).send({ error: "Forbidden" });
  }
}
