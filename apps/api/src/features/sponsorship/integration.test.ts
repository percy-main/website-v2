import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  approveGameSponsorship,
  createManualGameSponsorship,
  getGameSponsorByGameId,
  listGameSponsorships,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

/** Seed a game_sponsorship row. */
async function seedGameSponsorship(overrides: {
  gameId?: string;
  approved?: boolean;
  paidAt?: string | null;
  amountPence?: number;
}) {
  const id = `gs-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await ctx.db
    .insertInto("game_sponsorship")
    .values({
      id,
      game_id: overrides.gameId ?? `game-${crypto.randomUUID()}`,
      sponsor_name: "Test Sponsor",
      sponsor_email: "sponsor@example.com",
      amount_pence: overrides.amountPence ?? 5000,
      approved: overrides.approved ?? false,
      paid_at: overrides.paidAt !== undefined ? overrides.paidAt : null,
      created_at: now,
    })
    .execute();
  return id;
}

describe("sponsorship service (integration)", () => {
  describe("getGameSponsorByGameId", () => {
    it("returns null when no sponsorship exists", async () => {
      const result = await getGameSponsorByGameId(ctx.db)(
        `nonexistent-${crypto.randomUUID()}`,
      );
      expect(result).toBeNull();
    });

    it("returns null when sponsorship exists but not approved", async () => {
      const gameId = `game-${crypto.randomUUID()}`;
      await seedGameSponsorship({
        gameId,
        approved: false,
        paidAt: new Date().toISOString(),
      });

      const result = await getGameSponsorByGameId(ctx.db)(gameId);
      expect(result).toBeNull();
    });

    it("returns null when sponsorship is approved but not paid", async () => {
      const gameId = `game-${crypto.randomUUID()}`;
      await seedGameSponsorship({ gameId, approved: true, paidAt: null });

      const result = await getGameSponsorByGameId(ctx.db)(gameId);
      expect(result).toBeNull();
    });

    it("returns sponsor when approved and paid", async () => {
      const gameId = `game-${crypto.randomUUID()}`;
      await seedGameSponsorship({
        gameId,
        approved: true,
        paidAt: new Date().toISOString(),
      });

      const result = await getGameSponsorByGameId(ctx.db)(gameId);
      expect(result).not.toBeNull();
      expect(result?.game_id).toBe(gameId);
      expect(result?.approved).toBe(true);
    });
  });

  describe("approveGameSponsorship", () => {
    it("sets approved=true on the sponsorship", async () => {
      const id = await seedGameSponsorship({
        approved: false,
        paidAt: new Date().toISOString(),
      });

      const result = await approveGameSponsorship(ctx.db)(id);
      expect(result.success).toBe(true);

      const row = await ctx.db
        .selectFrom("game_sponsorship")
        .where("id", "=", id)
        .select("approved")
        .executeTakeFirst();
      expect(row?.approved).toBe(true);
    });
  });

  describe("listGameSponsorships", () => {
    it("paginates correctly", async () => {
      // Seed 5 sponsorships
      for (let i = 0; i < 5; i++) {
        await seedGameSponsorship({});
      }

      const page1 = await listGameSponsorships(ctx.db)(1, 2, "all");
      expect(page1.items.length).toBeLessThanOrEqual(2);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);
      expect(page1.total).toBeGreaterThanOrEqual(5);

      const page2 = await listGameSponsorships(ctx.db)(2, 2, "all");
      expect(page2.items.length).toBeLessThanOrEqual(2);
      expect(page2.page).toBe(2);

      // Items should be different between pages
      const page1Ids = page1.items.map((i) => i.id);
      const page2Ids = page2.items.map((i) => i.id);
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }
    });
  });

  describe("createManualGameSponsorship", () => {
    it("creates an approved and paid record", async () => {
      const gameId = `game-manual-${crypto.randomUUID()}`;

      const result = await createManualGameSponsorship(ctx.db)({
        gameId,
        sponsorName: "Manual Sponsor",
        sponsorEmail: "manual@example.com",
        amountPence: 7500,
      });

      expect(result.id).toBeTruthy();

      const row = await ctx.db
        .selectFrom("game_sponsorship")
        .where("id", "=", result.id)
        .selectAll()
        .executeTakeFirst();
      expect(row).toBeTruthy();
      expect(row?.approved).toBe(true);
      expect(row?.paid_at).toBeTruthy();
      expect(row?.sponsor_name).toBe("Manual Sponsor");
      expect(row?.amount_pence).toBe(7500);
      expect(row?.game_id).toBe(gameId);
    });
  });
});
