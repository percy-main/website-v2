import type { DB } from "@percy-main/db";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { promises as fs } from "fs";
import { Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.resolve(
  __dirname,
  "../../../../packages/db/src/migrations",
);

export interface TestContext {
  container: StartedPostgreSqlContainer;
  db: Kysely<DB>;
  dialect: PostgresDialect;
  connectionString: string;
}

/**
 * Starts an isolated PostgreSQL container and runs all migrations.
 * Returns a Kysely client that tests pass directly to service factories.
 * No mocking, no process.env mutation — pure functional injection.
 *
 * Usage:
 * ```ts
 * let ctx: TestContext;
 * beforeAll(async () => { ctx = await startTestContainer(); });
 * afterAll(async () => { await stopTestContainer(ctx); });
 *
 * it("lists users", async () => {
 *   const list = listUsers(ctx.db);
 *   const result = await list({ page: 1, pageSize: 10 });
 * });
 * ```
 */
export async function startTestContainer(): Promise<TestContext> {
  // pgvector/pgvector:pg16 = official Postgres 16 image with the vector
  // extension pre-built. Used in place of postgres:16-alpine so Scout's
  // scout_fact migration (CREATE EXTENSION vector) can run.
  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:pg16",
  ).start();
  const connectionString = container.getConnectionUri();

  const pool = new pg.Pool({ connectionString, max: 5 });
  // Swallow errors from idle clients when the container is stopped during
  // teardown — PostgreSQL sends FATAL 57P01 which pg emits on the pool.
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional no-op
  pool.on("error", () => {});
  const dialect = new PostgresDialect({ pool });
  const db = new Kysely<DB>({ dialect });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsPath,
    }),
  });

  const { error } = await migrator.migrateToLatest();
  if (error) {
    await db.destroy();
    await container.stop();
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`Migration failed: ${message}`);
  }

  return { container, db, dialect, connectionString };
}

/**
 * Stops the container and closes DB connections.
 */
export async function stopTestContainer(ctx: TestContext) {
  await ctx.db.destroy();
  await ctx.container.stop();
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
  const userId = overrides.id ?? `user-${crypto.randomUUID()}`;
  const email = overrides.email ?? `${userId}@test.com`;
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

  let memberId: string | undefined;
  if (overrides.withMember !== false) {
    memberId = `member-${userId}`;
    await db
      .insertInto("member")
      .values({ id: memberId, email, name })
      .execute();
  }

  return { userId, email, name, memberId };
}
