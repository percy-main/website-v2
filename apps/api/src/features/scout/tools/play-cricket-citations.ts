import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CitationAccumulator } from "../report/citation-accumulator.ts";

/**
 * Citation primitives for Play Cricket data — companions to cite_fact.
 *
 * Two consumers, two delivery channels:
 *  - Chat mode passes a `writer`; cite_match / cite_player_stats stream
 *    data-*-citation parts to the FE for inline [N] chips + Sources panel.
 *  - Report mode passes a `CitationAccumulator`; the same calls capture
 *    URLs server-side for the PDF's references page.
 *
 * Both deps are optional. When neither is wired up (unit tests), the call
 * still validates input and returns a payload, but nothing is recorded.
 */

const PERCY_MAIN_CLUB_ID = "134";

export interface PlayCricketCitationToolDeps {
  writer?: UIMessageStreamWriter;
  /** Per-run accumulator used in report mode to capture URLs for the
   *  references page. Distinct from the writer (chat-mode FE chips); both
   *  may be supplied, or just one, or neither. */
  accumulator?: CitationAccumulator;
}

const claim = z
  .string()
  .min(3)
  .max(500)
  .describe(
    "The verbatim sentence (or short clause) from your reply that the citation grounds. The frontend uses this to highlight the cited span.",
  );

export function createPlayCricketCitationTools(
  deps: PlayCricketCitationToolDeps,
) {
  const { writer, accumulator } = deps;

  return {
    cite_match: tool({
      description: `Attach a citation to a claim grounded in a specific Play Cricket match — past or upcoming. Call this immediately after the sentence the citation supports, with the matchId you got from a pc_* tool response (matches[].id, match_details[].id) or from db_run_sql (the local mirror). The frontend renders an inline [N] chip and a card linking to the match's page on percymain.play-cricket.com.

When to call:
- You stated something specific about a single match: "We beat Backworth by 47 runs on 26/04/2025" → cite_match with that matchId.
- You quoted a scorecard line: "Weatherburn 76 (115) in the 2nd XI fixture vs Tynemouth" → cite the match.
- A claim narrows to one match's events (toss decision, fall of wickets, a bowling spell).

When NOT to call:
- The claim aggregates across many matches (use cite_player_stats or just the underlying numbers).
- You don't have the Play Cricket matchId (e.g. weather-only claim, or a fact-corpus claim — use cite_fact).
- The claim is generic ("the pitch was slow") with no match attached.

One call per cited match. The same matchId can appear multiple times if the response references it more than once.`,
      inputSchema: z.object({
        matchId: z
          .string()
          .min(1)
          .describe(
            "Play Cricket match id, exactly as it appears in pc_* responses (matches[].id, match_details[].id) or in db_run_sql rows. Numeric string, e.g. '7262912'.",
          ),
        claim,
        matchDate: z
          .string()
          .optional()
          .describe(
            "Match date in dd/mm/yyyy as Play Cricket emits it. Display-only; the FE shows it on the source card.",
          ),
        homeTeam: z
          .string()
          .optional()
          .describe(
            "Home team display name (e.g. 'Percy Main CC, 1st XI'). Display-only.",
          ),
        awayTeam: z
          .string()
          .optional()
          .describe("Away team display name. Display-only."),
        groundName: z.string().optional(),
        competition: z
          .string()
          .optional()
          .describe(
            "League / cup name as it appears on the match summary, e.g. 'NTCL Premier Division'.",
          ),
        result: z
          .string()
          .optional()
          .describe("Result line if known, e.g. 'Percy Main won by 47 runs'."),
      }),
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; no async work here.
      execute: async (input) => {
        const citationId = randomUUID();
        if (writer) {
          writer.write({
            type: "data-match-citation",
            id: citationId,
            data: input,
          });
        }
        if (accumulator) {
          accumulator.recordMatch({
            matchId: input.matchId,
            matchDate: input.matchDate,
            homeTeam: input.homeTeam,
            awayTeam: input.awayTeam,
            groundName: input.groundName,
            competition: input.competition,
            result: input.result,
          });
        }
        return {
          cited: true as const,
          citationId,
          matchId: input.matchId,
        };
      },
    }),

    cite_player_stats: tool({
      description: `Attach a citation to a claim grounded in aggregate player stats from Play Cricket (batting, bowling, or fielding). Call this immediately after the sentence the citation supports. The frontend renders an inline [N] chip and a card linking to /player_stats/<type>/<playerId> on percymain.play-cricket.com (filtered as best we can with the optional fields you pass).

When to call:
- You quoted a player average / aggregate: "Smith averages 12.3 across 18 innings vs us this season" → cite_player_stats(playerId, "batting", ...).
- You quoted bowling figures across a season: "5–28 best, 17 wickets at 19.4" → statType "bowling".
- You quoted catches/run-outs across a season → statType "fielding".

When NOT to call:
- The claim is about a single match — use cite_match.
- The claim came from a recorded fact in <known-facts> — use cite_fact.
- You don't have a Play Cricket player_id (the link target is the playerId page; without it there's nothing to link to).

statType MUST match what you're claiming — picking "batting" for a bowling-figures claim links the user to the wrong stats page.`,
      inputSchema: z.object({
        playerId: z
          .string()
          .min(1)
          .describe(
            "Play Cricket player_id (a.k.a. member_id). Numeric string, e.g. '6577518'. Use pc_list_players (or pc_match_detail's players block on a recent fixture) for a club's roster if you only have a name.",
          ),
        playerName: z
          .string()
          .min(1)
          .describe(
            "Display name for the source card / references page. REQUIRED — pass the player's actual name (the one alongside player_id in the API response). Never pass a numeric id here.",
          ),
        statType: z
          .enum(["batting", "bowling", "fielding"])
          .describe(
            "Which stats page to link to. Must match the claim — batting averages → 'batting', wickets → 'bowling', catches/run-outs → 'fielding'.",
          ),
        claim,
        season: z
          .number()
          .int()
          .optional()
          .describe(
            "Season year if the claim is season-bounded (e.g. 2025). Display-only on the card.",
          ),
        teamId: z
          .string()
          .optional()
          .describe(
            "Play Cricket team_id (e.g. our 1st XI). When present, included as ?team_id=… on the link.",
          ),
        gameType: z
          .string()
          .optional()
          .describe(
            "Play Cricket game_type filter, e.g. 'League', 'Cup', 'T20'. When present, included as ?game_type=… on the link.",
          ),
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async (input) => {
        const citationId = randomUUID();
        if (writer) {
          writer.write({
            type: "data-player-stats-citation",
            id: citationId,
            data: { ...input, clubId: PERCY_MAIN_CLUB_ID },
          });
        }
        if (accumulator) {
          accumulator.recordPlayerStats({
            playerId: input.playerId,
            playerName: input.playerName,
            statType: input.statType,
            season: input.season,
            teamId: input.teamId,
            gameType: input.gameType,
          });
        }
        return {
          cited: true as const,
          citationId,
          playerId: input.playerId,
          statType: input.statType,
        };
      },
    }),
  };
}

export type PlayCricketCitationTools = ReturnType<
  typeof createPlayCricketCitationTools
>;
