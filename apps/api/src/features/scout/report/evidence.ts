import { scoutLeagueTableSchema } from "@percy-main/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ── EvidenceRecord ─────────────────────────────────────────────────────────
//
// The hard contract between the researcher and analyst phases. Researcher
// emits these via record_evidence; analyst sees nothing else (no raw tool
// outputs, no synthesis, no narrative). Each record is one atomic, citable
// piece of evidence — analyst cites by id, validators check that mechanics
// claims are backed by fact-typed evidence.

// Re-export the structured league-table schema. league_standings evidence
// records carry one of these on their `leagueTable` field; the runReport
// pipeline picks it up post-analyst and injects it into the PDF payload.
export const evidenceLeagueTableSchema = scoutLeagueTableSchema;

export const evidenceSourceTypeSchema = z.enum([
  "db",
  "play_cricket",
  "weather",
  "fact",
]);

export const evidenceClaimTypeSchema = z.enum([
  // DB-derived stat aggregate (e.g. "Smith's 2025 batting average is 34.2").
  "db_aggregate",
  // DB-derived row of context (e.g. selection, match meta).
  "db_row",
  // Play Cricket aggregate (a player's career batting/bowling stats page).
  "pc_aggregate",
  // A single Play Cricket match — scorecard line, fall of wickets, toss.
  "pc_match",
  // Counts of how_out values over a sample (e.g. "5 of 8 dismissals are
  // bowled or LBW"). NOT enough on its own to back a mechanics claim.
  "dismissal_pattern",
  // Open-Meteo forecast for the ground/date.
  "weather",
  // fact_retrieve result, scope=user — the captain's own observation.
  "captain_fact",
  // fact_retrieve result, scope=club — anyone at the club has recorded it.
  "club_fact",
  // Division standings — the source of truth for ANY team's W/L record.
  // Scorecards mis-credit results when extras tilt the balance, so the
  // researcher must NEVER derive W/L counts from match scores; only this
  // claim type backs them. The structured table travels on the record's
  // `leagueTable` field for the renderer to pick up post-analyst.
  "league_standings",
]);

export const evidencePermanenceSchema = z.enum([
  "permanent",
  "seasonal",
  "ephemeral",
]);

export type EvidenceClaimType = z.infer<typeof evidenceClaimTypeSchema>;

// Mechanics-allowed claim types. Stats/scorecard alone cannot back claims
// about line/length/movement/footwork/shot/glovework/captaincy — those need
// a captain/club fact. Exported so the analyst's validator can reference
// the same source of truth.
export const MECHANICS_CAPABLE_CLAIM_TYPES: ReadonlySet<EvidenceClaimType> =
  new Set(["captain_fact", "club_fact"]);

// W/L-record-allowed claim types. Win/loss/draw counts derived from
// scorecards mis-credit results when extras tilt the balance — only the
// official league standings are reliable. Mirrors the mechanics gate.
export const LEAGUE_RECORD_CAPABLE_CLAIM_TYPES: ReadonlySet<EvidenceClaimType> =
  new Set(["league_standings"]);

// What the researcher's record_evidence tool ACCEPTS. The id + retrievedAt
// are filled server-side, so the model doesn't supply them.
export const evidenceRecordInputSchema = z.object({
  sourceType: evidenceSourceTypeSchema.describe(
    "Where this came from. db = our local mirror via ask_db; play_cricket = pc_* tools; weather = weather_get; fact = fact_retrieve.",
  ),
  sourceRef: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Specific identifier within the source — e.g. 'pc_match_summary:1234567', 'fact:<uuid>', 'ask_db:Smith 2025 avg', 'weather:54.99,-1.45,2026-05-10'. Lets the analyst (and humans reviewing) trace evidence back to the call.",
    ),
  sourceUrl: z
    .url()
    .optional()
    .describe(
      "Public URL backing this evidence (Play Cricket scorecard, player-stats page, weather forecast page). Auto-deduped into the report's references list — do NOT also emit a separate 'references' record.",
    ),
  claimType: evidenceClaimTypeSchema.describe(
    "What KIND of evidence this is. Determines what kinds of analytical claim it can support — see the analyst's mechanics rule.",
  ),
  content: z
    .string()
    .min(3)
    .max(600)
    .describe(
      "The evidence as one short readable sentence the analyst can quote: e.g. 'Smith took 5 wickets vs Newcastle on 18 May 2026 (5/27 in 8 overs)' or 'Captain has recorded that Mitford have no covers'.",
    ),
  numericValue: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Optional numeric value the analyst can use for chart data points or stat callouts. String-typed (not number) so big-int aggregates and formatted '12*' values both fit.",
    ),
  context: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional()
    .describe(
      "Optional structured fields that don't fit in `content` — e.g. {player:'Dance', season:2026, team:'Newcastle 1st XI'}. Analyst can read these, but they are not parsed by validators.",
    ),
  confidence: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe(
      "1 = guess, 3 = solid inference / DB result, 5 = directly observed/stated by the captain or in an authoritative source.",
    ),
  permanence: evidencePermanenceSchema.describe(
    "permanent = handedness, bowling style; seasonal = ground covers, scheduling; ephemeral = weather, recent form, injuries.",
  ),
  leagueTable: evidenceLeagueTableSchema
    .optional()
    .describe(
      "Required ONLY when claimType === 'league_standings'. Carries the structured division table so the runReport pipeline can render it on page 1 of the PDF without round-tripping through the analyst. Use the EXACT W/L/T/Pts numbers from the official league table — never recompute from scorecards.",
    ),
});

export type EvidenceRecordInput = z.infer<typeof evidenceRecordInputSchema>;

// What the rest of the system uses. id and retrievedAt are server-set.
export const evidenceRecordSchema = evidenceRecordInputSchema.extend({
  id: z.string().min(1),
  retrievedAt: z.iso.datetime(),
});

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

// ── ClaimRecord ────────────────────────────────────────────────────────────
//
// Analyst's parallel registry of every analytical claim it makes. The
// validator checks: (a) every claim has at least one evidenceId, (b) every
// id resolves to a real EvidenceRecord, (c) mechanics claims (isMechanics =
// true) cite at least one evidence with claimType in MECHANICS_CAPABLE_CLAIM_TYPES.

// Sections of ScoutReportContent that hold ANALYTICAL prose — every claim a
// claim-eligible. ourPlayers / theirPlayers map to the `notes` field on each
// player object (the analyst can scope a claim to "any of the player notes
// in this section"; the validator searches across the array's notes). The
// renderer fields outside this list (e.g. weather.summary, references) are
// pure data passthrough and don't carry analytical claims.
export const claimSectionSchema = z.enum([
  "intro",
  "tossDecision",
  "overallStrategy",
  "keyMatchups",
  "tactics",
  "conclusion",
  "ourPlayers",
  "theirPlayers",
]);

export type ClaimSection = z.infer<typeof claimSectionSchema>;

export const ANALYTICAL_SECTIONS: readonly ClaimSection[] = [
  "intro",
  "tossDecision",
  "overallStrategy",
  "keyMatchups",
  "tactics",
  "conclusion",
  "ourPlayers",
  "theirPlayers",
];

export const claimRecordSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Stable id the analyst chooses — used to reference this claim in audit / future versions of the schema. Free-form, e.g. 'c1', 'their_player_dance_form'.",
    ),
  section: claimSectionSchema.describe(
    "Which section of ScoutReportContent this claim's `text` lives in. Validator checks the text appears as a substring of that section's prose, and that every section with non-trivial prose has at least one ClaimRecord covering it.",
  ),
  text: z
    .string()
    .min(3)
    .max(600)
    .describe(
      "Verbatim claim copied from the prose. If you write 'Dance has been bowled or LBW in 5 of his last 8 dismissals — bowl straight at him' in keyMatchups, register a ClaimRecord with this exact substring (or a meaningful sub-phrase).",
    ),
  isMechanics: z
    .boolean()
    .describe(
      "True if the claim describes line, length, movement, swing, footwork, shot selection, field placement, captaincy, or wicketkeeping mechanics. Mechanics claims MUST cite at least one captain_fact or club_fact — stats alone are not enough.",
    ),
  evidenceIds: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Ids of EvidenceRecords that ground this claim. At least one required. Mechanics claims need at least one fact-typed evidence among these.",
    ),
});

export type ClaimRecord = z.infer<typeof claimRecordSchema>;

// ── EvidenceAccumulator ────────────────────────────────────────────────────
//
// Per-call mutable store the record_evidence tool writes into. The
// researcher's loop populates this; the final array is what we hand to the
// analyst phase.

export class EvidenceAccumulator {
  private records: EvidenceRecord[] = [];
  private seenRefs = new Set<string>();

  /** Push a record. Returns the assigned id. Dedupes on (sourceRef + content). */
  add(input: EvidenceRecordInput): { id: string; deduped: boolean } {
    const dedupeKey = `${input.sourceRef}::${input.content}`;
    if (this.seenRefs.has(dedupeKey)) {
      const existing = this.records.find(
        (r) => `${r.sourceRef}::${r.content}` === dedupeKey,
      );
      // Should always be set if seenRefs has it, but guard anyway.
      if (existing) return { id: existing.id, deduped: true };
    }
    const id = `evi_${randomUUID().slice(0, 8)}`;
    const record: EvidenceRecord = {
      ...input,
      id,
      retrievedAt: new Date().toISOString(),
    };
    this.records.push(record);
    this.seenRefs.add(dedupeKey);
    return { id, deduped: false };
  }

  snapshot(): EvidenceRecord[] {
    // Caller-side mutation must not leak back; return a copy.
    return this.records.slice();
  }

  size(): number {
    return this.records.length;
  }
}
