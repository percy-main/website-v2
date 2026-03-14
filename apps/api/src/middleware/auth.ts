import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session, User } from "better-auth";
import { auth } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: { user: User; session: Session };
  }
}

/**
 * Fastify preHandler hook that validates the session via better-auth.
 * Populates request.authSession on success, returns 401 on failure.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  const session = await auth.api.getSession({ headers });

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  request.authSession = session;
}

/**
 * Checks that the authenticated user has one of the specified roles.
 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const userRole =
      (request.authSession?.user as { role?: string | null }).role ?? "user";
    if (!roles.includes(userRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
  };
}
