import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Anthropic's prompt-cache token counters, returned per turn in
  // result.providerMetadata.anthropic. Without these stored alongside
  // token_input/token_output we can't tell whether the cache_control
  // breakpoints in agent.ts are actually firing — the totals look
  // identical whether every step pays full input rate or 10% cache-read.
  await db.schema
    .alterTable("scout_message")
    .addColumn("token_cache_read", "integer")
    .addColumn("token_cache_creation", "integer")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_message")
    .dropColumn("token_cache_read")
    .dropColumn("token_cache_creation")
    .execute();
}
