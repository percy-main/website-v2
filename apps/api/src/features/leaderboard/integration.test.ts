import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { getLeaderboard, submitScore } from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("leaderboard service (integration)", () => {
  describe("submitScore", () => {
    it("creates a new score entry", async () => {
      const { userId } = await seedTestUser(ctx.db, { withMember: false });

      const result = await submitScore(ctx.db)(userId, {
        game: "be-the-keeper",
        score: 100,
        level: 3,
        catches: 10,
        bestStreak: 5,
      });

      expect(result.saved).toBe(true);
      expect(result.isNewBest).toBe(true);

      const saved = await ctx.db
        .selectFrom("game_score")
        .where("user_id", "=", userId)
        .selectAll()
        .executeTakeFirst();

      expect(saved).toBeTruthy();
      expect(saved?.score).toBe(100);
      expect(saved?.level).toBe(3);
      expect(saved?.catches).toBe(10);
      expect(saved?.best_streak).toBe(5);
    });

    it("updates when a higher score is submitted", async () => {
      const { userId } = await seedTestUser(ctx.db, { withMember: false });

      await submitScore(ctx.db)(userId, {
        game: "be-the-keeper",
        score: 50,
        level: 2,
        catches: 5,
        bestStreak: 3,
      });

      const result = await submitScore(ctx.db)(userId, {
        game: "be-the-keeper",
        score: 150,
        level: 5,
        catches: 15,
        bestStreak: 8,
      });

      expect(result.saved).toBe(true);
      expect(result.isNewBest).toBe(true);

      const saved = await ctx.db
        .selectFrom("game_score")
        .where("user_id", "=", userId)
        .selectAll()
        .executeTakeFirst();

      expect(saved?.score).toBe(150);
      expect(saved?.level).toBe(5);
    });

    it("ignores a lower score", async () => {
      const { userId } = await seedTestUser(ctx.db, { withMember: false });

      await submitScore(ctx.db)(userId, {
        game: "be-the-keeper",
        score: 200,
        level: 7,
        catches: 20,
        bestStreak: 10,
      });

      const result = await submitScore(ctx.db)(userId, {
        game: "be-the-keeper",
        score: 50,
        level: 1,
        catches: 3,
        bestStreak: 2,
      });

      expect(result.saved).toBe(false);
      expect(result.isNewBest).toBe(false);

      const saved = await ctx.db
        .selectFrom("game_score")
        .where("user_id", "=", userId)
        .selectAll()
        .executeTakeFirst();

      expect(saved?.score).toBe(200);
    });
  });

  describe("getLeaderboard", () => {
    it("returns top scores ordered by score descending", async () => {
      const user1 = await seedTestUser(ctx.db, {
        name: "Player One",
        withMember: false,
      });
      const user2 = await seedTestUser(ctx.db, {
        name: "Player Two",
        withMember: false,
      });
      const user3 = await seedTestUser(ctx.db, {
        name: "Player Three",
        withMember: false,
      });

      const game = `leaderboard-test-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await ctx.db
        .insertInto("game_score")
        .values([
          {
            id: crypto.randomUUID(),
            user_id: user1.userId,
            game,
            score: 300,
            level: 10,
            catches: 30,
            best_streak: 15,
            updated_at: now,
          },
          {
            id: crypto.randomUUID(),
            user_id: user2.userId,
            game,
            score: 500,
            level: 15,
            catches: 50,
            best_streak: 25,
            updated_at: now,
          },
          {
            id: crypto.randomUUID(),
            user_id: user3.userId,
            game,
            score: 100,
            level: 3,
            catches: 10,
            best_streak: 5,
            updated_at: now,
          },
        ])
        .execute();

      const result = await getLeaderboard(ctx.db)(game, 10);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Player Two");
      expect(result[0].score).toBe(500);
      expect(result[1].name).toBe("Player One");
      expect(result[2].name).toBe("Player Three");
    });

    it("respects the limit parameter", async () => {
      const user1 = await seedTestUser(ctx.db, {
        name: "Limit A",
        withMember: false,
      });
      const user2 = await seedTestUser(ctx.db, {
        name: "Limit B",
        withMember: false,
      });

      const game = `limit-test-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await ctx.db
        .insertInto("game_score")
        .values([
          {
            id: crypto.randomUUID(),
            user_id: user1.userId,
            game,
            score: 300,
            level: 10,
            catches: 30,
            best_streak: 15,
            updated_at: now,
          },
          {
            id: crypto.randomUUID(),
            user_id: user2.userId,
            game,
            score: 500,
            level: 15,
            catches: 50,
            best_streak: 25,
            updated_at: now,
          },
        ])
        .execute();

      const result = await getLeaderboard(ctx.db)(game, 1);
      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(500);
    });
  });
});
