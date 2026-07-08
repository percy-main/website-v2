import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { listGamesPrerenderManifest } from "./service.ts";

// The module-level match-summary cache is keyed by season with a
// 30-minute TTL, so every test uses its own `now` year to keep its
// Play Cricket fixtures isolated from other tests in this run.

interface RecordedQuery {
  table: string;
  wheres: unknown[][];
}

/**
 * Minimal Kysely stand-in: selectFrom() returns a chain proxy that
 * records where() calls and resolves execute() through `handler`, so
 * each test dispatches per-table (and, for content_item, per-kind)
 * fixture rows.
 */
function createMockDb(
  handler: (query: RecordedQuery) => unknown[],
): Kysely<DB> {
  const selectFrom = (table: string) => {
    const query: RecordedQuery = { table, wheres: [] };
    const chain: unknown = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "execute") {
            return () => Promise.resolve(handler(query));
          }
          if (prop === "executeTakeFirst") {
            return () => Promise.resolve(handler(query)[0]);
          }
          if (prop === "where") {
            return (...args: unknown[]) => {
              query.wheres.push(args);
              return chain;
            };
          }
          return () => chain;
        },
      },
    );
    return chain;
  };
  return { selectFrom } as unknown as Kysely<DB>;
}

const SITE_ID = "SITE1";

function pcMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 100001,
    status: "New",
    published: "Yes",
    last_updated: "10/06/2030",
    season: "2030",
    match_date: "15/06/2030",
    match_time: "13:00",
    home_club_name: "Percy Main",
    home_team_name: "1st XI",
    home_team_id: "T1",
    home_club_id: SITE_ID,
    away_club_name: "Tynemouth CC",
    away_team_name: "2nd XI",
    away_team_id: "T9",
    away_club_id: "C9",
    league_name: "NTCL",
    league_id: "L1",
    competition_name: "Division 1",
    competition_id: "CMP1",
    competition_type: "League",
    ground_name: "St Johns Terrace",
    ...overrides,
  };
}

interface Fixtures {
  matchesBySeason: Record<number, unknown[]>;
  sponsorships?: unknown[];
  matchdays?: unknown[];
  matchdayPlayers?: unknown[];
  gameReports?: unknown[];
  events?: unknown[];
}

// Full client object like play-cricket/sync.test.ts - no casts; the
// untyped vi.fn() mocks are assignable to the method signatures.
function createMockApi(
  getMatchesSummary: PlayCricketApiClient["getMatchesSummary"],
): PlayCricketApiClient {
  return {
    getTeams: vi.fn().mockResolvedValue({ teams: [] }),
    getMatchesSummary,
    getMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
    getLiveMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
    getPlayers: vi.fn().mockResolvedValue({ players: [] }),
    getLeagueTable: vi.fn().mockResolvedValue({}),
    getMatchesForSite: vi.fn().mockResolvedValue({ matches: [] }),
    getResultSummaryForSite: vi.fn().mockResolvedValue({ result_summary: [] }),
    getResultSummary: vi.fn().mockResolvedValue({ result_summary: [] }),
  };
}

function createHarness(fixtures: Fixtures) {
  const getMatchesSummary = vi.fn();
  getMatchesSummary.mockImplementation((season: number) =>
    Promise.resolve({ matches: fixtures.matchesBySeason[season] ?? [] }),
  );
  const api = createMockApi(getMatchesSummary);

  const db = createMockDb((query) => {
    switch (query.table) {
      case "content_item": {
        const kindWhere = query.wheres.find((args) => args[0] === "kind");
        return kindWhere?.[2] === "event"
          ? (fixtures.events ?? [])
          : (fixtures.gameReports ?? []);
      }
      case "game_sponsorship": {
        // listGames filters to approved+paid (it surfaces sponsorName on
        // the list); the manifest reads ALL rows. Mirror the predicate so
        // hash behaviour matches real SQL.
        const rows = (fixtures.sponsorships ?? []) as Array<{
          approved: boolean;
          paid_at: string | null;
        }>;
        const filtersPaid = query.wheres.some((args) => args[0] === "paid_at");
        return filtersPaid
          ? rows.filter((row) => row.approved && row.paid_at !== null)
          : rows;
      }
      case "matchday":
        return fixtures.matchdays ?? [];
      case "matchday_player":
        return fixtures.matchdayPlayers ?? [];
      case "match_result":
        return [];
      default:
        return [];
    }
  });

  return {
    manifest: listGamesPrerenderManifest(db, api, SITE_ID),
    getMatchesSummary,
  };
}

describe("listGamesPrerenderManifest", () => {
  it("emits a game item per current-season game and 24 month items", async () => {
    const { manifest, getMatchesSummary } = createHarness({
      matchesBySeason: {
        2030: [
          pcMatch({ id: 100001 }),
          pcMatch({ id: 100002, match_date: "20/07/2030" }),
        ],
        2029: [
          pcMatch({
            id: 90001,
            season: "2029",
            match_date: "15/06/2029",
            last_updated: "16/06/2029",
          }),
        ],
      },
    });

    const { items } = await manifest(new Date("2030-06-01T12:00:00Z"));

    expect(getMatchesSummary).toHaveBeenCalledWith(2029);
    expect(getMatchesSummary).toHaveBeenCalledWith(2030);

    const games = items.filter((item) => item.kind === "game");
    const months = items.filter((item) => item.kind === "calendar-month");

    // Current season only - the 2029 game keeps the OG-redirect fallback.
    expect(games.map((game) => game.url).sort()).toEqual([
      "/calendar/game/100001",
      "/calendar/game/100002",
    ]);
    expect(games[0].slug).toBe("100001");

    expect(months).toHaveLength(24);
    expect(months.map((month) => month.url)).toContain("/calendar/2030/june");
    expect(months.map((month) => month.url)).toContain(
      "/calendar/2029/january",
    );
    expect(months.every((month) => month.slug.includes("/"))).toBe(true);
  });

  it("produces identical hashes for identical inputs", async () => {
    const fixtures: Fixtures = {
      matchesBySeason: { 2032: [pcMatch({ match_date: "15/06/2032" })] },
      events: [{ slug: "quiz-night", updated_at: new Date("2032-01-01") }],
    };
    const { manifest } = createHarness(fixtures);

    const first = await manifest(new Date("2032-06-01T12:00:00Z"));
    const second = await manifest(new Date("2032-06-01T12:00:00Z"));

    expect(second.items).toEqual(first.items);
  });

  it("a sponsorship change flips the game hash but not month hashes", async () => {
    const sponsorships: unknown[] = [];
    const fixtures: Fixtures = {
      matchesBySeason: { 2034: [pcMatch({ match_date: "15/06/2034" })] },
      sponsorships,
    };
    const { manifest } = createHarness(fixtures);

    const before = await manifest(new Date("2034-06-01T12:00:00Z"));
    sponsorships.push({
      id: "s1",
      game_id: "100001",
      approved: true,
      paid_at: null,
      display_name: null,
      sponsor_name: "Acme",
      sponsor_logo_url: null,
      sponsor_message: "Go team",
      sponsor_website: null,
      sponsor_phone: null,
    });
    const after = await manifest(new Date("2034-06-01T12:00:00Z"));

    const gameBefore = before.items.find((item) => item.kind === "game");
    const gameAfter = after.items.find((item) => item.kind === "game");
    expect(gameAfter?.hash).not.toBe(gameBefore?.hash);

    // The month page renders sponsorName from the games list overlay
    // (which this mock leaves unchanged), so month hashes hold steady.
    const monthsBefore = before.items.filter(
      (item) => item.kind === "calendar-month",
    );
    const monthsAfter = after.items.filter(
      (item) => item.kind === "calendar-month",
    );
    expect(monthsAfter.map((month) => month.hash)).toEqual(
      monthsBefore.map((month) => month.hash),
    );
  });

  it("an event change flips every month hash but no game hash", async () => {
    const events: unknown[] = [
      { slug: "quiz-night", updated_at: new Date("2036-01-01") },
    ];
    const fixtures: Fixtures = {
      matchesBySeason: { 2036: [pcMatch({ match_date: "15/06/2036" })] },
      events,
    };
    const { manifest } = createHarness(fixtures);

    const before = await manifest(new Date("2036-06-01T12:00:00Z"));
    (events[0] as { updated_at: Date }).updated_at = new Date("2036-02-01");
    const after = await manifest(new Date("2036-06-01T12:00:00Z"));

    const gameBefore = before.items.find((item) => item.kind === "game");
    const gameAfter = after.items.find((item) => item.kind === "game");
    expect(gameAfter?.hash).toBe(gameBefore?.hash);

    const monthHashesBefore = before.items
      .filter((item) => item.kind === "calendar-month")
      .map((month) => month.hash);
    const monthHashesAfter = after.items
      .filter((item) => item.kind === "calendar-month")
      .map((month) => month.hash);
    monthHashesAfter.forEach((hash, index) => {
      expect(hash).not.toBe(monthHashesBefore[index]);
    });
  });

  it("normalizes Play Cricket DD/MM/YYYY timestamps to ISO", async () => {
    const { manifest } = createHarness({
      matchesBySeason: {
        2038: [
          pcMatch({ match_date: "15/06/2038", last_updated: "10/06/2038" }),
        ],
      },
    });

    const { items } = await manifest(new Date("2038-06-01T12:00:00Z"));
    const game = items.find((item) => item.kind === "game");

    expect(game?.updatedAt).toBe("2038-06-10T00:00:00.000Z");
    expect(game?.publishedAt).toBe("2038-06-15T13:00:00");
    // Sitemap lastmod does .slice(0, 10) on both.
    expect(game?.updatedAt.slice(0, 10)).toBe("2038-06-10");
  });

  it("skips games with unparseable dates but still emits 24 months", async () => {
    const { manifest } = createHarness({
      matchesBySeason: {
        2040: [pcMatch({ match_date: "TBC", last_updated: "01/06/2040" })],
      },
    });

    const { items } = await manifest(new Date("2040-06-01T12:00:00Z"));

    expect(items.filter((item) => item.kind === "game")).toHaveLength(0);
    expect(items.filter((item) => item.kind === "calendar-month")).toHaveLength(
      24,
    );
  });

  it("propagates a Play Cricket failure instead of returning empty", async () => {
    const getMatchesSummary = vi.fn();
    getMatchesSummary.mockRejectedValue(new Error("PC down"));
    const db = createMockDb(() => []);
    const manifest = listGamesPrerenderManifest(
      db,
      createMockApi(getMatchesSummary),
      SITE_ID,
    );

    await expect(manifest(new Date("2042-06-01T12:00:00Z"))).rejects.toThrow(
      "PC down",
    );
  });
});
