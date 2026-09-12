import { requireMcpAuth } from "@better-auth/mcp";
import rateLimit from "@fastify/rate-limit";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth } from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  oauthClientParamsSchema,
  oauthClientResponseSchema,
} from "./schemas.ts";
import { buildMcpServer, getOauthClientDisplay } from "./service.ts";

/** Converts a Fastify request to a Web Request, the same way
 * apps/api/src/features/auth/routes.ts bridges to better-auth's handler. */
function toFetchRequest(request: FastifyRequest): Request {
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

  return new Request(url.toString(), {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? JSON.stringify(request.body)
        : undefined,
  });
}

/** MCP transport route (ADR 062). Registered without the /api prefix — the
 * path must match the `resource` identifier configured on the mcp() plugin
 * in features/auth/auth.ts. Not schema-declared like other routes — like
 * features/auth/routes.ts, this is a raw protocol passthrough, not a typed
 * JSON endpoint. */
export const mcpRoutes: FastifyPluginAsync = async (app) => {
  // Every call here runs requireMcpAuth (token verification) before doing
  // any real work, so this needs the same brute-force protection as the
  // auth routes — bound generously above legitimate multi-tool-call MCP
  // client usage.
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  const resource = `${app.config.API_BASE_URL}/mcp`;

  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    const fetchReq = toFetchRequest(request);

    const wrapped = requireMcpAuth(
      app.auth,
      async (_req, claims) => {
        try {
          if (
            !app.config.PLAY_CRICKET_API_TOKEN ||
            !app.config.PLAY_CRICKET_SITE_ID
          ) {
            reply.status(503);
            reply.send({ error: "Play Cricket API is not configured." });
            return new Response(null, { status: 204 });
          }

          const authUser = await app.db
            .selectFrom("user")
            .where("id", "=", claims.sub ?? "")
            .select("email")
            .executeTakeFirst();

          const server = buildMcpServer({
            mcpReadonly: app.mcpReadonly,
            db: app.db,
            playCricket: createApiClient({
              apiToken: app.config.PLAY_CRICKET_API_TOKEN,
              siteId: app.config.PLAY_CRICKET_SITE_ID,
            }),
            logger: app.log,
            memberEmail: authUser?.email ?? null,
          });

          const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          await server.connect(transport);

          // A fresh McpServer + transport is created per request (stateless
          // design), so both must be closed when the response ends or the
          // client disconnects — the SDK's own Fastify integration docs
          // call this out explicitly for exactly this stateless-per-request
          // shape; without it, resources tied to this transport/server pair
          // stay alive indefinitely.
          reply.raw.on("close", () => {
            transport.close().catch((err: unknown) => {
              request.log.error({ err }, "mcp transport close failed");
            });
            server.close().catch((err: unknown) => {
              request.log.error({ err }, "mcp server close failed");
            });
          });

          // CORS (and any other) headers set by Fastify hooks live on the
          // reply object and are flushed to reply.raw only when
          // reply.send() runs. handleRequest writes directly to reply.raw,
          // so copy those headers across first — same pattern as
          // features/scout/routes.ts's UI message stream pipe.
          for (const [key, value] of Object.entries(reply.getHeaders())) {
            if (value !== undefined && !reply.raw.hasHeader(key)) {
              reply.raw.setHeader(key, value);
            }
          }

          await transport.handleRequest(request.raw, reply.raw, request.body);
        } catch (err) {
          request.log.error({ err }, "mcp request handling failed");
          if (!reply.raw.headersSent) {
            reply.status(500);
            reply.send({ error: "Internal error" });
          }
        }
        // The real response was already written directly to reply.raw
        // above. This Response is never sent to the client — see below,
        // where we branch on reply.raw.writableEnded instead of this
        // wrapper's return value.
        return new Response(null, { status: 204 });
      },
      { resource, requiredScopes: ["mcp:use"] },
    );

    const authResult = await wrapped(fetchReq);

    // Success path already fully wrote (and ended) reply.raw above.
    // Only an auth failure reaches here with reply.raw still open — in
    // that case authResult is the real RFC 6750/9728 challenge response,
    // which we translate back onto the Fastify reply.
    if (reply.raw.writableEnded) return reply;

    reply.status(authResult.status);
    authResult.headers.forEach((value, key) => {
      void reply.header(key, value);
    });
    return reply.send(await authResult.text());
  };

  // hide: true — this is a raw MCP JSON-RPC/SSE transport, not a REST
  // endpoint; without it, the generated OpenAPI spec (and so the typed
  // frontend client) declares a nonsensical bodyless POST /mcp that no
  // caller should ever actually use.
  const opts = { schema: { hide: true } };
  app.post("/mcp", opts, handle);
  app.get("/mcp", opts, handle);
  app.delete("/mcp", opts, handle);
};

/** Small authenticated support endpoint for the /auth/consent page: looks
 * up an OAuth client's public display info (name/uri/icon) by id, so the
 * consent screen can show "<name> wants to access your account" without
 * needing a registration access token. Registered under /api, unlike
 * mcpRoutes. */
// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const mcpConsentSupportRoutes: FastifyPluginAsyncZod = async (app) => {
  const getDisplay = getOauthClientDisplay(app.db);

  app.get(
    "/mcp/oauth-client/:clientId",
    {
      preHandler: [requireAuth],
      schema: {
        params: oauthClientParamsSchema,
        response: { 200: oauthClientResponseSchema },
      },
    },
    async (request) => {
      return await getDisplay(request.params.clientId);
    },
  );
};
