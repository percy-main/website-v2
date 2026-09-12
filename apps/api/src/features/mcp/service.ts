import type { Tool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import { McpServer } from "@modelcontextprotocol/server";
import type { DB } from "@percy-main/db";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { getActiveRequests, respond } from "../availability/service.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { createScoutCache } from "../scout/tools/cache.ts";
import { createDbTools } from "../scout/tools/db.ts";
import { createPlayCricketTools } from "../scout/tools/play-cricket.ts";
import { createWeatherTools } from "../scout/tools/weather.ts";
import { confirmAvailabilitySchema } from "./schemas.ts";

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

/** Public display info for an OAuth client, for the /auth/consent page.
 * Deliberately narrow — name/uri/icon only, nothing that would let a
 * consent screen leak client secrets or internal registration state. */
export function getOauthClientDisplay(db: Kysely<DB>) {
  return async (clientId: string) => {
    const client = await db
      .selectFrom("oauthClient")
      .where("clientId", "=", clientId)
      .select(["name", "uri", "icon"])
      .executeTakeFirst();

    if (!client) throwHttpError(404, "Unknown client");
    return client;
  };
}

export interface McpServerDeps {
  /** Kysely client scoped to the mcp_readonly Postgres role (ADR 062). */
  mcpReadonly: Kysely<DB>;
  /** Full-access client — for scout_tool_cache writes and the two
   * personalized availability tools, which reach their data through
   * already-reviewed service functions rather than raw SQL. */
  db: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  logger?: FastifyBaseLogger;
  /** The calling member's email, resolved from the verified access
   * token's `sub` claim. Null when no member record matches (or the
   * lookup hasn't run) — the personalized tools are omitted in that case. */
  memberEmail: string | null;
}

// A stub ToolExecutionOptions — none of the adapted tools (db/play-cricket/
// weather) read `context`, `messages`, or `abortSignal`, so a fixed stub is
// safe. Same shape already used by apps/api/src/features/scout/integration.test.ts
// to invoke these same tool factories' execute functions outside of streamText.
function stubToolExecutionOptions(): ToolExecutionOptions<never> {
  return {
    toolCallId: crypto.randomUUID(),
    messages: [],
    abortSignal: undefined,
  } as never;
}

/**
 * Re-registers an AI-SDK `tool()` object (as built for Scout's `streamText`
 * loop) as an MCP tool. MCP tools are called by the *client's* model, not
 * ours, so only the input schema and execute function carry over — the
 * result is always returned as a single text content block.
 */
export function adaptTool(
  mcpServer: McpServer,
  name: string,
  toolDef: Tool<never, unknown, never>,
) {
  const execute = toolDef.execute;
  if (!execute) return;

  const description =
    typeof toolDef.description === "string" ? toolDef.description : undefined;

  // registerTool's overloads resolve InputArgs from a statically known
  // schema; toolDef's schema is only known at runtime (this adapter walks
  // an arbitrary record of already-built AI-SDK tools), so the same `never`
  // escape hatch this codebase already uses for the equivalent problem
  // (apps/api/src/features/scout/integration.test.ts's `opts`/`runTool`)
  // applies at both boundary points here.
  mcpServer.registerTool(
    name,
    { description, inputSchema: toolDef.inputSchema } as never,
    (async (input: never) => {
      const result = await execute(input, stubToolExecutionOptions());
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }) as never,
  );
}

export function buildMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: "percy-main", version: "1.0.0" });

  const cache = createScoutCache(deps.db);
  const dbTools = createDbTools({
    dbReadonly: deps.mcpReadonly,
    logger: deps.logger,
  });
  const playCricketTools = createPlayCricketTools({
    playCricket: deps.playCricket,
    cache,
    logger: deps.logger,
  });
  const weatherTools = createWeatherTools({ cache });

  for (const [name, toolDef] of Object.entries({
    ...dbTools,
    ...playCricketTools,
    ...weatherTools,
  })) {
    adaptTool(server, name, toolDef as Tool<never, unknown, never>);
  }

  // Personalized tools — identity-scoped, only available once the caller's
  // member record is known. Re-register the existing availability service
  // functions unchanged (the same functions the matchday PWA's own routes
  // call); the safety boundary is the service function itself, not a
  // restrictive raw-SQL role, so these run on the full `db` client.
  if (deps.memberEmail) {
    const memberEmail = deps.memberEmail;

    const getActive = getActiveRequests(deps.db);
    server.registerTool(
      "open_availability_requests",
      {
        description:
          "List the calling member's open availability requests (and their dependents'), including fixtures, existing responses, and how many players have said available so far.",
        inputSchema: z.object({}),
      },
      async () => {
        const result = await getActive(memberEmail);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );

    const submitResponse = respond(deps.db);
    server.registerTool(
      "confirm_availability",
      {
        description:
          "Submit availability responses (available/unavailable, with an optional note) for one or more match dates on a given request. Pass subjectDependentId to answer on behalf of a junior dependent instead of the caller themselves.",
        inputSchema: confirmAvailabilitySchema,
      },
      async ({ requestId, ...data }) => {
        const result = await submitResponse(memberEmail, requestId, data);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );
  }

  return server;
}
