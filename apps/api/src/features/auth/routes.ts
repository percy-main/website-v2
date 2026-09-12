import rateLimit from "@fastify/rate-limit";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

/**
 * Bridges a Fastify request through to better-auth's Fetch API handler,
 * converting the Web Response back to a Fastify reply. Shared by both
 * routes below — the actual `auth.handler` call is identical, only the
 * path pattern each is registered under differs.
 */
async function bridgeToAuthHandler(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const url = new URL(request.url, `${request.protocol}://${request.hostname}`);

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

  // Re-encode request.body to match whatever Fastify actually parsed it
  // from — @fastify/formbody parses application/x-www-form-urlencoded
  // into the same kind of plain object JSON parsing produces, so
  // JSON.stringify-ing it unconditionally would silently rewrite the wire
  // format while keeping the original Content-Type header, breaking
  // better-auth's own body parsing on endpoints like /oauth2/token that
  // are conventionally called as form-urlencoded.
  const isFormEncoded = (request.headers["content-type"] ?? "").includes(
    "application/x-www-form-urlencoded",
  );
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const requestBody = hasBody
    ? isFormEncoded
      ? new URLSearchParams(request.body as Record<string, string>).toString()
      : JSON.stringify(request.body)
    : undefined;

  const webRequest = new Request(url.toString(), {
    method: request.method,
    headers,
    body: requestBody,
  });

  const response = await app.auth.handler(webRequest);

  reply.status(response.status);
  response.headers.forEach((value, key) => {
    void reply.header(key, value);
  });

  const body = await response.text();
  return reply.send(body);
}

/**
 * better-auth catch-all route handler.
 *
 * better-auth exposes its own router at /api/auth/*. We pass all requests
 * under this prefix through to the better-auth handler, which manages
 * sign-up, sign-in, sessions, OAuth callbacks, passkeys, 2FA, etc.
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  // This catch-all covers sign-in, sign-up, password reset, and the OAuth
  // 2.1 authorize/token/register endpoints (ADR 062) — all
  // credential/token-checking, so all brute-force targets.
  //
  // /oauth2/register (DCR) gets a stricter limit than the rest: unlike a
  // failed sign-in attempt, a successful call persists a new oauthClient
  // row, so the abuse case isn't just credential-guessing but unbounded
  // table growth. ADR 062 deliberately allows unauthenticated DCR
  // (allowUnauthenticatedClientRegistration in auth.ts) rather than
  // requiring CIMD, so the defence here is a tighter per-IP budget on
  // registration specifically, not disabling DCR.
  await app.register(rateLimit, {
    max: (request) => (request.url.includes("/oauth2/register") ? 5 : 30),
    timeWindow: "1 minute",
  });
  app.all("/*", (request, reply) => bridgeToAuthHandler(app, request, reply));
};

/**
 * RFC 8414/9728 well-known discovery documents (OAuth AS metadata, OIDC
 * config, protected-resource metadata for /mcp — ADR 062) must be servable
 * from the site root, not under /api/auth — the spec mandates
 * `/.well-known/...`, not a service-specific basePath. better-auth's oauth
 * provider plugin registers these paths internally against its own router
 * regardless of `basePath`, so this just needs to route matching root
 * requests to the same `auth.handler`, unprefixed. Registered without a
 * prefix in app.ts, alongside (not instead of) authRoutes above.
 */
export const wellKnownRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  app.all(
    "/.well-known/*",
    // hide: true — OAuth discovery documents proxied through auth.handler,
    // not a REST endpoint the typed frontend client should ever call.
    { schema: { hide: true } },
    (request, reply) => bridgeToAuthHandler(app, request, reply),
  );
};
