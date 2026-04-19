import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "./caption.ts";
import { CAPTION_HASHTAG_SUFFIX } from "./caption.ts";

describe("caption assembly", () => {
  it("appends the fixed hashtag suffix exactly once, even when LLM emits hashtags", async () => {
    const llm: LlmClient = {
      generateCaption: vi
        .fn()
        .mockResolvedValue("Up the club! #PMCC #percymain vibes"),
    };

    const { generateCaption } = await import("./caption.ts");
    const result = await generateCaption(llm)({
      teamName: "Percy Main 1st XI",
      opposition: "Benwell Hill",
      matchDate: "2026-06-15",
      matchTime: "13:00",
      isHome: true,
      players: [{ playerName: "Alex Young", sponsorName: null }],
      matchSponsor: null,
    });

    expect(result.source).toBe("ai");
    const occurrences = result.caption.split(CAPTION_HASHTAG_SUFFIX).length - 1;
    expect(occurrences).toBe(1);
    expect(result.caption).not.toMatch(/#PMCC.*#PMCC/);
  });

  it("falls back to deterministic template when LLM errors", async () => {
    const llm: LlmClient = {
      generateCaption: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    const { generateCaption } = await import("./caption.ts");
    const result = await generateCaption(llm)({
      teamName: "Percy Main 2nd XI",
      opposition: "Tynemouth",
      matchDate: "2026-06-22",
      matchTime: null,
      isHome: false,
      players: [{ playerName: "Jane Smith", sponsorName: null }],
      matchSponsor: { name: "Crossling", logoUrl: null },
    });

    expect(result.source).toBe("fallback");
    expect(result.caption).toContain("travel to Tynemouth");
    expect(result.caption).toContain("Crossling");
    expect(result.caption.trim().endsWith(CAPTION_HASHTAG_SUFFIX)).toBe(true);
  });
});

describe("publishTeamSheet (disabled)", () => {
  it("returns a skipped marker when SOCIAL_POSTING_ENABLED is false", async () => {
    const { publishTeamSheet } = await import("./service.ts");

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as FastifyBaseLogger;

    const db = {} as unknown as Parameters<typeof publishTeamSheet>[0]["db"];

    const result = await publishTeamSheet({
      db,
      llm: { generateCaption: vi.fn() },
      meta: {
        postToFacebook: vi.fn(),
        postToInstagram: vi.fn(),
      },
      s3Social: { uploadTeamSheet: vi.fn() },
      log,
      enabled: false,
    })({
      matchdayId: "md-1",
      userId: "user-1",
      role: "admin",
      isHome: true,
      matchTime: null,
    });

    expect(result).toEqual({ skipped: "feature disabled" });
  });
});
