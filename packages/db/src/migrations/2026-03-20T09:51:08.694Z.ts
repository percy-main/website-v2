import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Fix season on player_sponsorship records imported from v1
  // They were set to 2025 but should be 2026 (current season)
  await sql`
    UPDATE player_sponsorship SET season = 2026 WHERE season = 2025
  `.execute(db);
}
