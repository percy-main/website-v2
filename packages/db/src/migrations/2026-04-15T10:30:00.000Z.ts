import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "ssoProvider" (
      id TEXT NOT NULL PRIMARY KEY,
      issuer TEXT NOT NULL,
      "oidcConfig" TEXT,
      "samlConfig" TEXT,
      "userId" TEXT REFERENCES "user"(id),
      "providerId" TEXT NOT NULL UNIQUE,
      "organizationId" TEXT,
      domain TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "ssoProvider"`.execute(db);
}
