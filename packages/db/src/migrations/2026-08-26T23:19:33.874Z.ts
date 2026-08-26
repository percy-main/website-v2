import { type Kysely, sql } from "kysely";

// better-auth 1.7 schema upgrade (see the 1.7 upgrade guide's "Account
// identity" section).
//
// 1.7 scopes external account identity by (issuer, accountId) instead of
// by provider configuration, so `account` gains a required `issuer`
// column with a compound unique index. Backfill values must match what
// the 1.7 runtime writes, or sign-ins create duplicate accounts:
//
//   - credential accounts: 'local:credential', with accountId = the
//     linked user's id (the documented stable identifier; better-auth
//     has always set accountId = userId for credential accounts, so the
//     accountId write is a defensive no-op)
//   - google: 'https://accounts.google.com' (the provider's
//     accountIssuer in @better-auth/core)
//   - anything else: the synthetic 'local:oauth:<providerId>' namespace
//     for OAuth providers without an issuer of their own (defensive -
//     credential and google are the only providers configured)
//
// The twoFactor plugin adds verification-attempt tracking (verified /
// failedVerificationCount / lockedUntil). Existing rows get
// verified = true via the column default: better-auth chose that default
// so pre-1.7 rows keep working, and whether 2FA is enforced is still
// gated by user.twoFactorEnabled. The passkey plugin now stores the
// authenticator's AAGUID for labeling passkeys in management UIs;
// existing rows stay NULL (unknown authenticator model).
//
// The secondary indexes mirror the fields better-auth 1.7 marks
// index: true in its schema definitions.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE account ADD COLUMN issuer TEXT`.execute(db);

  await sql`
    UPDATE account
    SET issuer = 'local:credential', "accountId" = "userId"
    WHERE "providerId" = 'credential'
  `.execute(db);

  await sql`
    UPDATE account
    SET issuer = 'https://accounts.google.com'
    WHERE "providerId" = 'google'
  `.execute(db);

  await sql`
    UPDATE account
    SET issuer = 'local:oauth:' || "providerId"
    WHERE issuer IS NULL
  `.execute(db);

  await sql`ALTER TABLE account ALTER COLUMN issuer SET NOT NULL`.execute(db);

  // Fails on identity collisions, which is the desired outcome: a
  // collision means two account rows claim the same external identity
  // and needs manual investigation, not a silent merge.
  await sql`
    CREATE UNIQUE INDEX account_issuer_accountid_uq
    ON account (issuer, "accountId")
  `.execute(db);

  await sql`
    ALTER TABLE "twoFactor"
    ADD COLUMN verified BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lockedUntil" TIMESTAMP
  `.execute(db);

  await sql`ALTER TABLE passkey ADD COLUMN aaguid TEXT`.execute(db);

  await sql`CREATE INDEX idx_twofactor_secret ON "twoFactor" (secret)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_twofactor_user ON "twoFactor" ("userId")`.execute(
    db,
  );
  await sql`CREATE INDEX idx_passkey_user ON passkey ("userId")`.execute(db);
  await sql`
    CREATE INDEX idx_passkey_credentialid ON passkey ("credentialID")
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX idx_passkey_credentialid`.execute(db);
  await sql`DROP INDEX idx_passkey_user`.execute(db);
  await sql`DROP INDEX idx_twofactor_user`.execute(db);
  await sql`DROP INDEX idx_twofactor_secret`.execute(db);
  await sql`ALTER TABLE passkey DROP COLUMN aaguid`.execute(db);
  await sql`
    ALTER TABLE "twoFactor"
    DROP COLUMN "lockedUntil",
    DROP COLUMN "failedVerificationCount",
    DROP COLUMN verified
  `.execute(db);
  await sql`DROP INDEX account_issuer_accountid_uq`.execute(db);
  await sql`ALTER TABLE account DROP COLUMN issuer`.execute(db);
}
