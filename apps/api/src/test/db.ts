import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "@percy-main/db";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://percy:percy@localhost:5433/percy_main_test";

/**
 * Creates a test database client.
 * Each test suite should use this and clean up after itself.
 */
export function createTestDb() {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 5 }),
    }),
  });
}

/**
 * Cleans all application data from the test database.
 * Preserves schema and seed data structure.
 */
export async function cleanDb(db: Kysely<DB>) {
  // Delete in dependency order (children first)
  await db.deleteFrom("fantasy_team_score").execute();
  await db.deleteFrom("fantasy_chip_usage").execute();
  await db.deleteFrom("fantasy_player_score").execute();
  await db.deleteFrom("fantasy_team_player").execute();
  await db.deleteFrom("fantasy_team").execute();
  await db.deleteFrom("fantasy_chaos_week").execute();
  await db.deleteFrom("matchday_expense").execute();
  await db.deleteFrom("matchday_player").execute();
  await db.deleteFrom("matchday").execute();
  await db.deleteFrom("match_fee_rate").execute();
  await db.deleteFrom("team_official").execute();
  await db.deleteFrom("charge_dependent").execute();
  await db.deleteFrom("charge").execute();
  await db.deleteFrom("player_sponsorship").execute();
  await db.deleteFrom("game_sponsorship").execute();
  await db.deleteFrom("game_score").execute();
  await db.deleteFrom("membership").execute();
  await db.deleteFrom("dependent").execute();
  await db.deleteFrom("junior_team_manager").execute();
  await db.deleteFrom("contact_submission").execute();
  await db.deleteFrom("event_subscriber").execute();
  await db.deleteFrom("play_cricket_match_cache").execute();
  await db.deleteFrom("play_cricket_sync_log").execute();
  await db.deleteFrom("match_performance_batting").execute();
  await db.deleteFrom("match_performance_bowling").execute();
  await db.deleteFrom("match_performance_fielding").execute();
  await db.deleteFrom("match_result").execute();
  await db.deleteFrom("member").execute();
  await db.deleteFrom("passkey").execute();
  await db.deleteFrom("twoFactor" as never).execute();
  await db.deleteFrom("session").execute();
  await db.deleteFrom("account").execute();
  await db.deleteFrom("verification").execute();
  await db.deleteFrom("user").execute();
}

/**
 * Seeds a test user and optionally a member record.
 */
export async function seedTestUser(
  db: Kysely<DB>,
  overrides: {
    id?: string;
    email?: string;
    name?: string;
    role?: string;
    withMember?: boolean;
  } = {},
) {
  const userId = overrides.id ?? "test-user-1";
  const email = overrides.email ?? "test@example.com";
  const name = overrides.name ?? "Test User";

  await db
    .insertInto("user")
    .values({
      id: userId,
      email,
      name,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: overrides.role ?? null,
    })
    .execute();

  if (overrides.withMember !== false) {
    await db
      .insertInto("member")
      .values({ id: `member-${userId}`, email, name })
      .execute();
  }

  return { userId, email, name, memberId: `member-${userId}` };
}
