import { client } from "@percy-main/db";
import type { ScoreInput } from "./schemas.js";

/**
 * Submit a game score. Only saves if it is the user's new best for the game.
 */
export async function submitScore(userId: string, data: ScoreInput) {
  const existing = await client
    .selectFrom("game_score")
    .where("user_id", "=", userId)
    .where("game", "=", data.game)
    .select(["id", "score"])
    .executeTakeFirst();

  if (existing && data.score <= existing.score) {
    return { saved: false, isNewBest: false };
  }

  const now = new Date().toISOString();

  if (existing) {
    await client
      .updateTable("game_score")
      .set({
        score: data.score,
        level: data.level,
        catches: data.catches,
        best_streak: data.bestStreak,
        updated_at: now,
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await client
      .insertInto("game_score")
      .values({
        id: crypto.randomUUID(),
        user_id: userId,
        game: data.game,
        score: data.score,
        level: data.level,
        catches: data.catches,
        best_streak: data.bestStreak,
        updated_at: now,
      })
      .execute();
  }

  return { saved: true, isNewBest: true };
}

/**
 * Get the top scores for a game, ordered by score descending.
 */
export async function getLeaderboard(game: string, limit: number) {
  const entries = await client
    .selectFrom("game_score")
    .innerJoin("user", "user.id", "game_score.user_id")
    .where("game_score.game", "=", game)
    .select([
      "user.name",
      "game_score.score",
      "game_score.level",
      "game_score.catches",
      "game_score.best_streak as bestStreak",
    ])
    .orderBy("game_score.score", "desc")
    .limit(limit)
    .execute();

  return entries;
}
