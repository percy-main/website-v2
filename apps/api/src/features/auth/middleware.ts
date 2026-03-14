import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session, User } from "better-auth";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: { user: User; session: Session };
  }
}

/** Convert Fastify headers to Web API Headers for better-auth. */
function toWebHeaders(headers: FastifyRequest["headers"]): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach((v) => webHeaders.append(key, v));
      } else {
        webHeaders.set(key, value);
      }
    }
  }
  return webHeaders;
}

/**
 * Fastify preHandler that validates session via better-auth.
 * Populates request.authSession on success, returns 401 on failure.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = await request.server.auth.api.getSession({
    headers: toWebHeaders(request.headers),
  });

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  request.authSession = session;
}

/**
 * Requires the authenticated user has a verified email.
 * Must be used after requireAuth.
 */
export async function requireVerifiedEmail(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (!request.authSession?.user.emailVerified) {
    return reply.status(403).send({ error: "Email not verified" });
  }
}

/**
 * Creates a preHandler that checks the user has one of the specified roles.
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

/**
 * Extract the authenticated session from a request.
 * Use in route handlers after requireAuth middleware.
 * Throws 401 if session is missing (should not happen after middleware).
 */
export function getAuthSession(request: FastifyRequest) {
  const session = request.authSession;
  if (!session) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  return session;
}

export { toWebHeaders };
