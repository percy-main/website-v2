import { McpServer } from "@modelcontextprotocol/server";
import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { confirmAvailabilitySchema } from "./schemas.ts";
import { adaptTool, buildMcpServer, getOauthClientDisplay } from "./service.ts";

function mockDb(row: unknown) {
  const chain: Record<string, unknown> = {};
  chain.selectFrom = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.executeTakeFirst = vi.fn().mockResolvedValue(row);
  return chain as unknown as Kysely<DB>;
}

describe("getOauthClientDisplay", () => {
  it("returns the client's public display fields", async () => {
    const db = mockDb({ name: "Claude Code", uri: null, icon: null });
    const result = await getOauthClientDisplay(db)("client-1");
    expect(result).toEqual({ name: "Claude Code", uri: null, icon: null });
  });

  it("throws a 404 when no client matches", async () => {
    const db = mockDb(undefined);
    await expect(getOauthClientDisplay(db)("missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("confirmAvailabilitySchema", () => {
  it("requires requestId alongside respondSchema's fields", () => {
    const result = confirmAvailabilitySchema.safeParse({
      responses: [{ matchDate: "2026-05-01", status: "available" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload with requestId", () => {
    const result = confirmAvailabilitySchema.safeParse({
      requestId: "req-1",
      responses: [{ matchDate: "2026-05-01", status: "available" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("adaptTool", () => {
  it("wraps a tool's execute result as a single text content block", async () => {
    const registerTool = vi.fn();
    const fakeServer = { registerTool } as unknown as McpServer;
    const execute = vi.fn().mockResolvedValue({ rows: [{ n: 1 }] });

    adaptTool(fakeServer, "some_tool", {
      description: "does a thing",
      inputSchema: z.object({}),
      execute,
    } as never);

    expect(registerTool).toHaveBeenCalledWith(
      "some_tool",
      expect.objectContaining({ description: "does a thing" }),
      expect.any(Function),
    );

    const callback = registerTool.mock.calls[0][2] as (
      input: Record<string, never>,
    ) => Promise<{ content: Array<{ type: string; text: string }> }>;
    const result = await callback({});
    expect(execute).toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ rows: [{ n: 1 }] }) }],
    });
  });

  it("does not register a tool with no execute function", () => {
    const registerTool = vi.fn();
    const fakeServer = { registerTool } as unknown as McpServer;

    adaptTool(fakeServer, "no_execute_tool", {
      description: "unused",
      inputSchema: z.object({}),
    } as never);

    expect(registerTool).not.toHaveBeenCalled();
  });
});

describe("buildMcpServer", () => {
  const baseDeps = () => ({
    mcpReadonly: mockDb(undefined),
    db: mockDb(undefined),
    playCricket: {} as never,
    memberEmail: null,
  });

  function registeredToolNames(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls.map((call) => call[0] as string);
  }

  it("registers the personalized availability tools only when memberEmail is set", () => {
    const spy = vi.spyOn(McpServer.prototype, "registerTool");

    buildMcpServer(baseDeps());
    const withoutMemberNames = registeredToolNames(spy);
    expect(withoutMemberNames).not.toContain("open_availability_requests");
    expect(withoutMemberNames).not.toContain("confirm_availability");

    spy.mockClear();
    buildMcpServer({ ...baseDeps(), memberEmail: "member@example.com" });
    const withMemberNames = registeredToolNames(spy);
    expect(withMemberNames).toContain("open_availability_requests");
    expect(withMemberNames).toContain("confirm_availability");

    spy.mockRestore();
  });

  it("always registers the club-data tools", () => {
    const spy = vi.spyOn(McpServer.prototype, "registerTool");
    buildMcpServer(baseDeps());
    const names = registeredToolNames(spy);
    expect(names).toContain("db_run_sql");
    expect(names).toContain("weather_get");
    spy.mockRestore();
  });
});
