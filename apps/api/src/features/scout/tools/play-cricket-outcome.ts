/**
 * Computes an always-present `outcome` object for Play Cricket match/result
 * rows so the agent can never misread who won or which side made which total.
 *
 * Why this exists: Play Cricket scatters the result across three fields that
 * are individually unreadable -
 *   - `result`             is "W"/"L" in result_summary but free text
 *                          ("Won by 5 wickets") in match_detail, and is
 *                          expressed relative to `result_applied_to`, NOT the
 *                          home side and NOT from any fixed club's view.
 *   - `result_applied_to`  is a bare team_id with no name attached.
 *   - innings totals carry only `team_batting_id` (result_summary often omits
 *                          team_batting_name entirely), so a 297 vs 130 pair
 *                          can't be attributed to a club from the totals alone.
 * The only reliably human-readable winner signal is `result_description`
 * ("Percy Main won"). We therefore surface it verbatim and, purely from the
 * SAME response (no DB, no guessing), resolve every team_id -> club name and
 * attribute every innings total to its batting club. The agent reads the
 * plain-English description for the winner and the attributed innings for the
 * scores; it never has to decode the raw `result` code.
 */

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// First string-or-number-ish value coerced to string, else "". Mirrors the
// defensive `pickString` in play-cricket.ts so unexpected shapes never become
// "[object Object]".
function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return "";
}

export interface OutcomeInnings {
  /** Club that batted this innings, resolved from team_batting_id. null when unresolvable. */
  batting_club: string | null;
  /** Raw team_batting_name (often empty in result_summary - prefer batting_club). */
  team_batting_name: string;
  team_batting_id: string;
  runs: string;
  wickets: string;
  overs: string;
  /** true/false when known; null for historical match-detail innings where the flag is unknown. */
  declared: boolean | null;
}

export interface Outcome {
  /** Raw Play Cricket result code/text, verbatim. Do not read alone. */
  result: string;
  /**
   * Plain-English result, expressed relative to result_applied_to_club, e.g.
   * "Percy Main won" or "...Won bat second 27". Covers non-win states too
   * (tied, drawn, abandoned, cancelled), so read it literally - it does not
   * always name a winner. The reliable result signal.
   */
  result_description: string;
  /** team_id the raw `result` code is expressed relative to. */
  result_applied_to: string;
  /** result_applied_to resolved to a club name within this response. */
  result_applied_to_club: string | null;
  batted_first: string;
  batted_first_club: string | null;
  innings: OutcomeInnings[];
}

// A row is "played" (worth an outcome) when it carries any result signal. We
// skip fixture-only rows (future matches, no result, no innings) so aggregate
// or fixture-list projections aren't bloated with empty outcome objects.
function isPlayed(m: Rec): boolean {
  return (
    str(m.result).trim() !== "" ||
    str(m.result_description).trim() !== "" ||
    (Array.isArray(m.innings) && m.innings.length > 0)
  );
}

/**
 * Build the outcome object for a single match-ish record (a result_summary row
 * or a match_details entry). Returns null for unplayed/fixture rows.
 */
export function buildOutcome(match: unknown): Outcome | null {
  if (!isRec(match) || !isPlayed(match)) return null;

  const homeTeamId = str(match.home_team_id);
  const awayTeamId = str(match.away_team_id);
  const homeClub = str(match.home_club_name);
  const awayClub = str(match.away_club_name);
  const clubForTeam = (teamId: string): string | null => {
    if (!teamId) return null;
    if (teamId === homeTeamId) return homeClub || null;
    if (teamId === awayTeamId) return awayClub || null;
    return null;
  };

  const innings = Array.isArray(match.innings) ? match.innings : [];
  return {
    result: str(match.result),
    result_description: str(match.result_description),
    result_applied_to: str(match.result_applied_to),
    result_applied_to_club: clubForTeam(str(match.result_applied_to)),
    batted_first: str(match.batted_first),
    batted_first_club: clubForTeam(str(match.batted_first)),
    innings: innings.map((inn) => {
      const i = isRec(inn) ? inn : {};
      return {
        batting_club: clubForTeam(str(i.team_batting_id)),
        team_batting_name: str(i.team_batting_name),
        team_batting_id: str(i.team_batting_id),
        runs: str(i.runs),
        wickets: str(i.wickets),
        overs: str(i.overs),
        // null means "unknown" (historical match-detail), not "did not declare".
        declared: i.declared === null ? null : Boolean(i.declared),
      };
    }),
  };
}

// Attach `outcome` to each row of a projected array, reading the matching raw
// row by index. The projector maps every source element 1:1 (never filters),
// so projected[i] aligns with raw[i]. Unplayed rows get no outcome and are left
// as projected. A played row always gets its outcome - including the case where
// the caller projected ONLY outcome sub-paths (e.g. ["...outcome.result_description"]),
// which leaves the projected row undefined because `outcome` doesn't exist in
// the raw response yet; we materialise `{ outcome }` so the contract holds.
function attachToArray(projectedArr: unknown, rawArr: unknown): unknown {
  if (!Array.isArray(projectedArr) || !Array.isArray(rawArr)) {
    return projectedArr;
  }
  const rawRows = rawArr as unknown[];
  return (projectedArr as unknown[]).map((row: unknown, i: number) => {
    const outcome = buildOutcome(rawRows[i]);
    if (!outcome) return row;
    return isRec(row) ? { ...row, outcome } : { outcome };
  });
}

/**
 * Enrich a projected Play Cricket response with `outcome` objects, in place of
 * a copy. Handles all three container shapes the pc_* tools return:
 *   - { result_summary: [row] }                  (pc_site_results)
 *   - { match_details:  [row] }                  (pc_match_detail)
 *   - { matches: [{ match_details: [row] }] }     (pc_find_opposition_matches)
 *
 * Only enriches match rows the projection actually returned - if the caller
 * projected aggregate-only fields (e.g. matchedCount) with no match rows, the
 * payload is left lean. Whenever a match row IS present, it always carries the
 * full outcome, so the agent can never receive a match without its result.
 */
export function enrichOutcomes(projected: unknown, raw: unknown): unknown {
  if (!isRec(projected)) return projected;
  const rawObj: Rec = isRec(raw) ? raw : {};
  const out: Rec = { ...projected };

  if ("result_summary" in out) {
    out.result_summary = attachToArray(
      out.result_summary,
      rawObj.result_summary,
    );
  }
  if ("match_details" in out) {
    out.match_details = attachToArray(out.match_details, rawObj.match_details);
  }
  if (Array.isArray(out.matches)) {
    const rawMatches: unknown[] = Array.isArray(rawObj.matches)
      ? (rawObj.matches as unknown[])
      : [];
    out.matches = (out.matches as unknown[]).map(
      (entry: unknown, j: number) => {
        const rawEntry = rawMatches[j];
        if (!isRec(entry) || !("match_details" in entry) || !isRec(rawEntry)) {
          return entry;
        }
        return {
          ...entry,
          match_details: attachToArray(
            entry.match_details,
            rawEntry.match_details,
          ),
        };
      },
    );
  }

  return out;
}
