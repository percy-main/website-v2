import type { Kysely } from "kysely";

// Per-batter instance numbers from RV ball-by-ball. Always 1 in hardball but
// significant in Pairs / Women's Softball where a batter can be dismissed,
// retire, and return later in the same innings: their second trip carries
// inst_num = 2. Required to split a single batter's wagon wheel between
// instances and to attribute dismissals to the correct one.
//
// Nullable - older rows pre-date this column and existing hardball ingests
// don't lose anything if these stay null (wagon-wheel queries fall back to
// "all instances" when absent).

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("match_ball")
    .addColumn("batter_inst_num", "integer")
    .addColumn("batter_ns_inst_num", "integer")
    .addColumn("dismissed_batter_inst_num", "integer")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("match_ball")
    .dropColumn("batter_inst_num")
    .dropColumn("batter_ns_inst_num")
    .dropColumn("dismissed_batter_inst_num")
    .execute();
}
