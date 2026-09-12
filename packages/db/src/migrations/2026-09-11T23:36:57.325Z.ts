import { type Kysely, sql } from "kysely";

// Schema for the better-auth `jwt()` plugin (signing keys) and `mcp()`
// plugin (an OAuth 2.1 provider built on `@better-auth/oauth-provider`),
// added to support ADR 062 (expose Scout as an MCP server). Field lists
// and nullability are taken verbatim from the installed packages' own
// schema declarations (`@better-auth/oauth-provider@1.7.4`'s
// `dist/oauth-1Ud-hvZY.d.mts` and `better-auth@1.7.2`'s
// `dist/plugins/jwt/index.d.mts`) — better-auth does not auto-create its
// schema at runtime in this app (see `0001_baseline.ts`), so every
// plugin's tables are hand-ported here the same way.
//
// Column type mapping (confirmed against better-auth's own migration
// generator, `better-auth/dist/db/get-migration.mjs`): string -> text,
// number -> integer, boolean -> boolean, date -> timestamp (this app's
// existing better-auth tables use plain TIMESTAMP, not TIMESTAMPTZ — kept
// consistent with `0001_baseline.ts`/the 1.7 upgrade migration rather than
// the generator's own timestamptz default), json/string[] -> jsonb. Every
// model gets an implicit `id TEXT PRIMARY KEY` with no default (ids are
// assigned by application code, matching every existing better-auth table).
// A field with no `required` key in the source schema defaults to
// required (the generator's own rule is `required !== false`).
//
// FK targets — confirmed against the literal `references` values in the
// installed package's own compiled schema (grep
// node_modules/@better-auth/oauth-provider/dist/authorize-*.mjs for
// "references:"), not just its .d.mts type declarations, which widen
// every `field` to the generic `string` type and can't be trusted for
// the literal value. A real DCR registration (POST /oauth2/register)
// also confirmed this empirically for `clientId`/`resourceId` — the
// first version of this migration referenced `oauthClient(id)` and
// registration failed with a foreign key violation, since better-auth
// writes the client's public `client_id` into child tables, not the
// internal row id:
//   oauthClientResource.clientId  -> oauthClient(clientId)
//   oauthClientResource.resourceId -> oauthResource(identifier)
//   oauthRefreshToken.clientId    -> oauthClient(clientId)
//   oauthAccessToken.clientId     -> oauthClient(clientId)
//   oauthAccessToken.refreshId    -> oauthRefreshToken(id)  <- NOT .token;
//     unlike every other business-identifier FK above, this one really
//     does reference the internal row id (confirmed in the compiled
//     source directly — this wasn't exercised by the empirical DCR test,
//     which never requested offline_access, so no refresh token was ever
//     issued to check against).
//   oauthConsent.clientId         -> oauthClient(clientId)
// `sessionId`/`userId` reference `.id` throughout because `session`/
// `user` have no distinct business identifier of their own.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── jwks: JWT plugin's signing-key store ──
  await sql`
    CREATE TABLE jwks (
      id TEXT PRIMARY KEY,
      "publicKey" TEXT NOT NULL,
      "privateKey" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL,
      "expiresAt" TIMESTAMP,
      alg TEXT,
      crv TEXT
    )
  `.execute(db);

  // ── oauthClient: registered MCP clients (DCR) ──
  await sql`
    CREATE TABLE "oauthClient" (
      id TEXT PRIMARY KEY,
      "clientId" TEXT NOT NULL UNIQUE,
      "clientSecret" TEXT,
      "clientDiscoveryId" TEXT,
      disabled BOOLEAN,
      "skipConsent" BOOLEAN,
      "enableEndSession" BOOLEAN,
      "subjectType" TEXT,
      scopes JSONB,
      "clientCredentialsScopes" JSONB,
      "userId" TEXT REFERENCES "user"(id) ON DELETE CASCADE,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP,
      name TEXT,
      uri TEXT,
      icon TEXT,
      contacts JSONB,
      tos TEXT,
      policy TEXT,
      "softwareId" TEXT,
      "softwareVersion" TEXT,
      "softwareStatement" TEXT,
      "redirectUris" JSONB NOT NULL,
      "postLogoutRedirectUris" JSONB,
      "backchannelLogoutUri" TEXT,
      "backchannelLogoutSessionRequired" BOOLEAN,
      "tokenEndpointAuthMethod" TEXT,
      "applicationType" TEXT,
      jwks TEXT,
      "jwksUri" TEXT,
      "grantTypes" JSONB,
      "responseTypes" JSONB,
      "requirePKCE" BOOLEAN,
      "dpopBoundAccessTokens" BOOLEAN,
      "referenceId" TEXT,
      metadata JSONB
    )
  `.execute(db);

  await sql`CREATE INDEX idx_oauthclient_userid ON "oauthClient" ("userId")`.execute(
    db,
  );

  // ── oauthResource: protected-resource registry (per-resource token policy) ──
  await sql`
    CREATE TABLE "oauthResource" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      "accessTokenTtl" INTEGER,
      "refreshTokenTtl" INTEGER,
      "signingAlgorithm" TEXT,
      "signingKeyId" TEXT,
      "allowedScopes" JSONB,
      "customClaims" JSONB,
      "dpopBoundAccessTokensRequired" BOOLEAN,
      disabled BOOLEAN,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP,
      "policyVersion" INTEGER,
      metadata JSONB
    )
  `.execute(db);

  // ── oauthClientResource: which clients may request which resources ──
  await sql`
    CREATE TABLE "oauthClientResource" (
      id TEXT PRIMARY KEY,
      "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
      "resourceId" TEXT NOT NULL REFERENCES "oauthResource"(identifier) ON DELETE CASCADE,
      metadata JSONB,
      "createdAt" TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_oauthclientresource_clientid ON "oauthClientResource" ("clientId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthclientresource_resourceid ON "oauthClientResource" ("resourceId")
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX oauthclientresource_clientid_resourceid_uq
    ON "oauthClientResource" ("clientId", "resourceId")
  `.execute(db);

  // ── oauthRefreshToken: opaque refresh tokens (offline_access) ──
  await sql`
    CREATE TABLE "oauthRefreshToken" (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
      "sessionId" TEXT REFERENCES session(id) ON DELETE SET NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "referenceId" TEXT,
      "authorizationCodeId" TEXT,
      resources JSONB,
      "requestedUserInfoClaims" JSONB,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP NOT NULL,
      revoked TIMESTAMP,
      "rotatedAt" TIMESTAMP,
      "rotationReplayResponse" TEXT,
      "rotationReplayExpiresAt" TIMESTAMP,
      "authTime" TIMESTAMP,
      confirmation JSONB,
      scopes JSONB NOT NULL
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_oauthrefreshtoken_clientid ON "oauthRefreshToken" ("clientId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthrefreshtoken_sessionid ON "oauthRefreshToken" ("sessionId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthrefreshtoken_userid ON "oauthRefreshToken" ("userId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthrefreshtoken_authorizationcodeid ON "oauthRefreshToken" ("authorizationCodeId")
  `.execute(db);

  // ── oauthAccessToken: opaque access tokens (only when no resource-audience JWT applies) ──
  await sql`
    CREATE TABLE "oauthAccessToken" (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
      "sessionId" TEXT REFERENCES session(id) ON DELETE SET NULL,
      "userId" TEXT REFERENCES "user"(id) ON DELETE CASCADE,
      "referenceId" TEXT,
      "authorizationCodeId" TEXT,
      resources JSONB,
      "requestedUserInfoClaims" JSONB,
      "refreshId" TEXT REFERENCES "oauthRefreshToken"(id) ON DELETE CASCADE,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP NOT NULL,
      revoked TIMESTAMP,
      confirmation JSONB,
      scopes JSONB NOT NULL
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_oauthaccesstoken_clientid ON "oauthAccessToken" ("clientId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthaccesstoken_sessionid ON "oauthAccessToken" ("sessionId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthaccesstoken_userid ON "oauthAccessToken" ("userId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthaccesstoken_authorizationcodeid ON "oauthAccessToken" ("authorizationCodeId")
  `.execute(db);
  await sql`
    CREATE INDEX idx_oauthaccesstoken_refreshid ON "oauthAccessToken" ("refreshId")
  `.execute(db);

  // ── oauthConsent: per-user, per-client grant record ──
  await sql`
    CREATE TABLE "oauthConsent" (
      id TEXT PRIMARY KEY,
      "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
      "userId" TEXT REFERENCES "user"(id) ON DELETE CASCADE,
      "referenceId" TEXT,
      resources JSONB,
      "requestedUserInfoClaims" JSONB,
      scopes JSONB NOT NULL,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL
    )
  `.execute(db);

  await sql`CREATE INDEX idx_oauthconsent_clientid ON "oauthConsent" ("clientId")`.execute(
    db,
  );
  await sql`CREATE INDEX idx_oauthconsent_userid ON "oauthConsent" ("userId")`.execute(
    db,
  );

  // ── oauthClientAssertion: single-use private_key_jwt assertion replay guard ──
  // The row `id` is a digest of the assertion's `jti`, assigned by
  // application code (not a random id) — a replayed/concurrent assertion
  // collides on the primary key and the insert fails atomically.
  await sql`
    CREATE TABLE "oauthClientAssertion" (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMP NOT NULL
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("oauthClientAssertion").execute();
  await db.schema.dropTable("oauthConsent").execute();
  await db.schema.dropTable("oauthAccessToken").execute();
  await db.schema.dropTable("oauthRefreshToken").execute();
  await db.schema.dropTable("oauthClientResource").execute();
  await db.schema.dropTable("oauthResource").execute();
  await db.schema.dropTable("oauthClient").execute();
  await db.schema.dropTable("jwks").execute();
}
