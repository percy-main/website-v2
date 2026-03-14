import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, cleanDb, seedTestUser } from "../../test/db.js";

// Mock the db client used by the service
vi.mock("@percy-main/db", async () => {
  const testDb = createTestDb();
  return { client: testDb };
});

const db = createTestDb();

describe("leaderboard service", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  afterAll(async () => {
    await cleanDb(db);
    await db.destroy();
  });

  describe("submitScore", () => {
    it("creates a new score", async () => {
      const { submitScore } = await import("./service.js");
      const { userId } = await seedTestUser(db);

      const result = await submitScore(userId, {
        game: "be-the-keeper",
        score: 100,
        level: 3,
        catches: 10,
        bestStreak: 5,
      });

      expect(result.saved).toBe(true);
      expect(result.isNewBest).toBe(true);

      const saved = await db
        .selectFrom("game_score")
        .where("user_id", "=", userId)
        .selectAll()
        .executeTakeFirst();

      expect(saved).toBeTruthy();
      expect(saved!.score).toBe(100);
    });

    it("updates when higher score is submitted", async () => {
      const { submitScore } = await import("./service.js");
      const { userId } = await seedTestUser(db);

      await submitScore(userId, {
        game: "be-the-keeper",
        score: 50,
        level: 2,
        catches: 5,
        bestStreak: 3,
      });

      const result = await submitScore(userId, {
        game: "be-the-keeper",
        score: 150,
        level: 5,
        catches: 15,
        bestStreak: 8,
      });

      expect(result.saved).toBe(true);
      expect(result.isNewBest).toBe(true);

      const saved = await db
        .selectFrom("game_score")
        .where("user_id", "=", userId)
        .selectAll()
        .executeTakeFirst();

      expect(saved!.score).toBe(150);
      expect(saved!.level).toBe(5);
    });

    it("ignores lower score", async () => {
      const { submitScore } = await import("./service.js");
      const { userId } = await seedTestUser(db);

      await submitScore(userId, {
        game: "be-the-keeper",
        score: 200,
        level: 7,
        catches: 20,
        bestStreak: 10,
      });

      const result = await submitScore(userId, {
        game: "be-the-keeper",
        score: 50,
        level: 1,
        catches: 3,
        bestStreak: 2,
      });

      expect(result.saved).toBe(false);
      expect(result.isNewBest).toBe(false);

      const saved = await db
        .selectFrom("game_score")
        .where("user_id", "=", userId)
        .selectAll()
        .executeTakeFirst();

      expect(saved!.score).toBe(200);
    });
  });

  describe("getLeaderboard", () => {
    it("returns top scores ordered by score descending", async () => {
      const { getLeaderboard } = await import("./service.js");

      const user1 = await seedTestUser(db, {
        id: "lb-user-1",
        email: "lb1@test.com",
        name: "Player One",
      });
      const user2 = await seedTestUser(db, {
        id: "lb-user-2",
        email: "lb2@test.com",
        name: "Player Two",
        withMember: false,
      });
      const user3 = await seedTestUser(db, {
        id: "lb-user-3",
        email: "lb3@test.com",
        name: "Player Three",
        withMember: false,
      });

      const now = new Date().toISOString();
      await db
        .insertInto("game_score")
        .values([
          {
            id: "gs-1",
            user_id: user1.userId,
            game: "be-the-keeper",
            score: 300,
            level: 10,
            catches: 30,
            best_streak: 15,
            updated_at: now,
          },
          {
            id: "gs-2",
            user_id: user2.userId,
            game: "be-the-keeper",
            score: 500,
            level: 15,
            catches: 50,
            best_streak: 25,
            updated_at: now,
          },
          {
            id: "gs-3",
            user_id: user3.userId,
            game: "be-the-keeper",
            score: 100,
            level: 3,
            catches: 10,
            best_streak: 5,
            updated_at: now,
          },
        ])
        .execute();

      const result = await getLeaderboard("be-the-keeper", 10);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Player Two");
      expect(result[0].score).toBe(500);
      expect(result[1].name).toBe("Player One");
      expect(result[2].name).toBe("Player Three");
    });

    it("respects limit parameter", async () => {
      const { getLeaderboard } = await import("./service.js");

      const user1 = await seedTestUser(db, {
        id: "lim-1",
        email: "lim1@test.com",
        name: "A",
      });
      const user2 = await seedTestUser(db, {
        id: "lim-2",
        email: "lim2@test.com",
        name: "B",
        withMember: false,
      });

      const now = new Date().toISOString();
      await db
        .insertInto("game_score")
        .values([
          {
            id: "lgs-1",
            user_id: user1.userId,
            game: "be-the-keeper",
            score: 300,
            level: 10,
            catches: 30,
            best_streak: 15,
            updated_at: now,
          },
          {
            id: "lgs-2",
            user_id: user2.userId,
            game: "be-the-keeper",
            score: 500,
            level: 15,
            catches: 50,
            best_streak: 25,
            updated_at: now,
          },
        ])
        .execute();

      const result = await getLeaderboard("be-the-keeper", 1);
      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(500);
    });
  });
});
