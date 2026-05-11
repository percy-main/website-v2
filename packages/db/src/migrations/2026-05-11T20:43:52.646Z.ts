import { type Kysely, sql } from "kysely";

/**
 * Rename existing match-fee charge descriptions to use "donation" wording.
 * Treasurer's request for amateur sports club tax/accounts purposes.
 * Only descriptions starting with the legacy "Match fee - " prefix are
 * rewritten; trailing "<opposition> (dd/MM/yyyy)" portion is preserved.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE charge
    SET description = 'Match donation - ' || substring(description from length('Match fee - ') + 1)
    WHERE description LIKE 'Match fee - %'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE charge
    SET description = 'Match fee - ' || substring(description from length('Match donation - ') + 1)
    WHERE description LIKE 'Match donation - %'
  `.execute(db);
}
