import type { FastifyPluginAsync } from "fastify";

/**
 * better-auth catch-all route handler.
 *
 * better-auth exposes its own router at /api/auth/*. We pass all requests
 * under this prefix through to the better-auth handler, which manages
 * sign-up, sign-in, sessions, OAuth callbacks, passkeys, 2FA, etc.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.all("/*", async (request, reply) => {
    // Convert Fastify request to Web Request for better-auth
    const url = new URL(
      request.url,
      `${request.protocol}://${request.hostname}`,
    );

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

    let body: BodyInit | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const contentType = request.headers["content-type"] ?? "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        // SAML IdP-initiated POST sends form-encoded data.
        // Convert the parsed object back to URLSearchParams for the Web Request.
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(
          request.body as Record<string, string>,
        )) {
          params.append(key, value);
        }
        body = params.toString();
      } else {
        body = JSON.stringify(request.body);
      }
    }

    const webRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body,
    });

    const response = await app.auth.handler(webRequest);

    // Convert Web Response back to Fastify reply
    reply.status(response.status);

    response.headers.forEach((value, key) => {
      void reply.header(key, value);
    });

    const responseBody = await response.text();
    return reply.send(responseBody);
  });
};
