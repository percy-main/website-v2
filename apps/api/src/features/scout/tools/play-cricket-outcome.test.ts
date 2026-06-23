import { describe, expect, it } from "vitest";
import { buildOutcome, enrichOutcomes } from "./play-cricket-outcome.ts";
import { project } from "./projector.ts";

// A result_summary row shaped like the live Play Cricket API: home/away
// team_ids + club names, a bare `result` code, a result_applied_to team_id,
// and innings that carry only team_batting_id (NO team_batting_name).
const wonRow = {
  id: 7262912,
  match_date: "02/05/2026",
  home_team_id: "200",
  home_club_name: "Backworth CC",
  away_team_id: "134134",
  away_club_name: "Percy Main",
  result: "W",
  result_description: "Percy Main won",
  result_applied_to: "134134",
  batted_first: "134134",
  innings: [
    { team_batting_id: "134134", runs: "297", wickets: "9", overs: "50.0" },
    { team_batting_id: "200", runs: "130", wickets: "10", overs: "38.2" },
  ],
};

describe("buildOutcome", () => {
  it("resolves team_ids to clubs and attributes each innings total", () => {
    const outcome = buildOutcome(wonRow);
    expect(outcome).not.toBeNull();
    expect(outcome?.result_description).toBe("Percy Main won");
    expect(outcome?.result_applied_to_club).toBe("Percy Main");
    expect(outcome?.batted_first_club).toBe("Percy Main");
    // The 297 belongs to Percy Main, the 130 to Backworth - the exact
    // attribution the content AI got wrong when it only had the bare totals.
    expect(outcome?.innings).toEqual([
      {
        batting_club: "Percy Main",
        team_batting_name: "",
        team_batting_id: "134134",
        runs: "297",
        wickets: "9",
        overs: "50.0",
        declared: false,
      },
      {
        batting_club: "Backworth CC",
        team_batting_name: "",
        team_batting_id: "200",
        runs: "130",
        wickets: "10",
        overs: "38.2",
        declared: false,
      },
    ]);
  });

  it("keeps result_description trustworthy even when the raw code is 'L' for the winner", () => {
    // Mirrors the integration-test softball fixture: result "L" alongside a
    // result_applied_to pointing at the side that actually won. The raw code
    // is unreliable; result_description is not.
    const outcome = buildOutcome({
      home_team_id: "134",
      home_club_name: "Percy Main",
      away_team_id: "999",
      away_club_name: "Tynemouth CC",
      result: "L",
      result_description: "Tynemouth CC won",
      result_applied_to: "999",
      innings: [],
    });
    expect(outcome?.result).toBe("L");
    expect(outcome?.result_description).toBe("Tynemouth CC won");
    expect(outcome?.result_applied_to_club).toBe("Tynemouth CC");
  });

  it("returns null for an unplayed fixture (no result, no innings)", () => {
    expect(
      buildOutcome({
        home_team_id: "1",
        away_team_id: "2",
        result: "",
        result_description: "",
      }),
    ).toBeNull();
  });

  it("leaves a club null when a team_id matches neither side", () => {
    const outcome = buildOutcome({
      ...wonRow,
      result_applied_to: "999999",
    });
    expect(outcome?.result_applied_to_club).toBeNull();
  });

  it("preserves declared as a tri-state: true / false / null (unknown)", () => {
    // match-detail innings carry declared as boolean|null (null for historical
    // matches, where the flag is genuinely unknown - not "did not declare").
    const outcome = buildOutcome({
      ...wonRow,
      innings: [
        { team_batting_id: "134134", runs: "297", declared: true },
        { team_batting_id: "200", runs: "130", declared: false },
        { team_batting_id: "200", runs: "44", declared: null },
      ],
    });
    expect(outcome?.innings.map((i) => i.declared)).toEqual([
      true,
      false,
      null,
    ]);
  });
});

describe("enrichOutcomes", () => {
  it("attaches outcome to a projected result_summary even when no result field was projected", () => {
    const raw = { result_summary: [wonRow] };
    // Caller projected only the id - they still get the full outcome.
    const projected = project(raw, ["result_summary[].id"]);
    const enriched = enrichOutcomes(projected, raw) as {
      result_summary: Array<{
        id: number;
        outcome?: { result_description: string };
      }>;
    };
    expect(enriched.result_summary[0].id).toBe(7262912);
    expect(enriched.result_summary[0].outcome?.result_description).toBe(
      "Percy Main won",
    );
  });

  it("attaches outcome under match_details for pc_match_detail", () => {
    const raw = { match_details: [{ ...wonRow, result: "Won by 167 runs" }] };
    const projected = project(raw, ["match_details[].match_date"]);
    const enriched = enrichOutcomes(projected, raw) as {
      match_details: Array<{
        outcome?: { result: string; innings: unknown[] };
      }>;
    };
    expect(enriched.match_details[0].outcome?.result).toBe("Won by 167 runs");
    expect(enriched.match_details[0].outcome?.innings).toHaveLength(2);
  });

  it("attaches outcome under the nested matches[].match_details shape", () => {
    const raw = {
      oppositionName: "Backworth",
      matchedCount: 1,
      matches: [{ match_details: [wonRow] }],
    };
    const projected = project(raw, [
      "matchedCount",
      "matches[].match_details[].match_date",
    ]);
    const enriched = enrichOutcomes(projected, raw) as {
      matchedCount: number;
      matches: Array<{
        match_details: Array<{
          outcome?: { result_applied_to_club: string | null };
        }>;
      }>;
    };
    expect(enriched.matchedCount).toBe(1);
    expect(
      enriched.matches[0].match_details[0].outcome?.result_applied_to_club,
    ).toBe("Percy Main");
  });

  it("attaches outcome even when ONLY outcome sub-paths were projected", () => {
    const raw = { result_summary: [wonRow] };
    // `outcome` doesn't exist in the raw response, so projecting only an
    // outcome sub-path leaves the projected row empty - enrichment must still
    // materialise the full outcome so the "always present" contract holds.
    const projected = project(raw, [
      "result_summary[].outcome.result_description",
    ]);
    const enriched = enrichOutcomes(projected, raw) as {
      result_summary: Array<{
        outcome?: { result_description: string; innings: unknown[] };
      }>;
    };
    expect(enriched.result_summary[0].outcome?.result_description).toBe(
      "Percy Main won",
    );
    expect(enriched.result_summary[0].outcome?.innings).toHaveLength(2);
  });

  it("does not fabricate match rows for an aggregate-only projection", () => {
    const raw = {
      matchedCount: 3,
      matches: [{ match_details: [wonRow] }],
    };
    // Only a top-level scalar projected - leave the payload lean.
    const projected = project(raw, ["matchedCount"]);
    const enriched = enrichOutcomes(projected, raw) as Record<string, unknown>;
    expect(enriched).toEqual({ matchedCount: 3 });
    expect(enriched.matches).toBeUndefined();
  });

  it("passes through a null projection unchanged", () => {
    expect(enrichOutcomes(null, { result_summary: [wonRow] })).toBeNull();
  });
});
