import { describe, expect, it } from "vitest";
import { ASK_BBB_ALLOWED_TABLES } from "./ask-ball-by-ball.ts";
import { maskTableNames } from "./ask-db.ts";
import { SCOUT_ALLOWED_TABLES } from "./db.ts";

describe("ASK_BBB_ALLOWED_TABLES", () => {
  it("includes the three BBB tables (match_ball, match_stream, rv_player_mapping)", () => {
    expect(ASK_BBB_ALLOWED_TABLES).toContain("match_ball");
    expect(ASK_BBB_ALLOWED_TABLES).toContain("match_stream");
    expect(ASK_BBB_ALLOWED_TABLES).toContain("rv_player_mapping");
  });

  it("includes the join targets the BBB sub-agent needs to resolve players + dismissal mode", () => {
    // match_result for match metadata, match_performance_batting for
    // how_out (our players only), scout_member to resolve player names,
    // play_cricket_team for opposition team-name display.
    expect(ASK_BBB_ALLOWED_TABLES).toContain("match_result");
    expect(ASK_BBB_ALLOWED_TABLES).toContain("match_performance_batting");
    expect(ASK_BBB_ALLOWED_TABLES).toContain("scout_member");
    expect(ASK_BBB_ALLOWED_TABLES).toContain("play_cricket_team");
  });

  it("does not include sensitive or unrelated tables exposed to the main ask_db", () => {
    const sensitive = [
      "user",
      "account",
      "session",
      "member",
      "charge",
      "membership",
    ];
    for (const t of sensitive) expect(ASK_BBB_ALLOWED_TABLES).not.toContain(t);
    // And it's deliberately narrower than the main scout allowlist —
    // availability tables, fielding perfs, sync log are out of scope.
    expect(ASK_BBB_ALLOWED_TABLES).not.toContain("availability_fixture");
    expect(ASK_BBB_ALLOWED_TABLES).not.toContain("match_performance_fielding");
    expect(ASK_BBB_ALLOWED_TABLES).not.toContain("play_cricket_sync_log");
  });
});

describe("maskTableNames scoped to a sub-agent's allowlist", () => {
  // The masker uses the allowlist the sub-agent owns. Names outside that
  // allowlist pass through unchanged — that's by design: a BBB sub-agent
  // shouldn't be inventing or masking tables it can't see anyway.
  it("masks BBB tables when scoped to BBB allowlist", () => {
    const { masked, tablesFound } = maskTableNames(
      "Joined match_ball with rv_player_mapping for the dismissal balls.",
      ASK_BBB_ALLOWED_TABLES,
    );
    expect(tablesFound).toContain("match_ball");
    expect(tablesFound).toContain("rv_player_mapping");
    expect(masked).not.toContain("match_ball");
    expect(masked).not.toContain("rv_player_mapping");
    expect(masked).toContain("the relevant table");
  });

  it("masks SCOUT tables when scoped to SCOUT allowlist", () => {
    const { masked, tablesFound } = maskTableNames(
      "Filtered to the matchday and match_performance_batting rows.",
      SCOUT_ALLOWED_TABLES,
    );
    expect(tablesFound).toContain("matchday");
    expect(tablesFound).toContain("match_performance_batting");
    expect(masked).not.toContain("match_performance_batting");
  });

  it("does not mask BBB-only tables when scoped to SCOUT allowlist (defensive: keeps each agent's redaction independent)", () => {
    // SCOUT_ALLOWED_TABLES does not include match_ball; a summary that
    // accidentally names match_ball coming out of the main ask_db
    // sub-agent shouldn't be masked here (it'd indicate a bug — the
    // main sub-agent shouldn't know about match_ball at all).
    const { masked, tablesFound } = maskTableNames(
      "Reading from match_ball directly.",
      SCOUT_ALLOWED_TABLES,
    );
    expect(tablesFound).not.toContain("match_ball");
    expect(masked).toContain("match_ball");
  });
});
