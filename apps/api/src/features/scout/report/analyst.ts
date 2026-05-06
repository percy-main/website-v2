import {
  scoutReportContentSchema,
  type ScoutReportContent,
  type ScoutReportReference,
} from "@percy-main/shared";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Config } from "../../../config.ts";
import { deepseekFastProviderOptions, resolveModel } from "../provider.ts";
import { GROUNDING_RULES, IMPORTANT_CONTEXT } from "../system-prompt.ts";
import {
  ANALYTICAL_SECTIONS,
  claimRecordSchema,
  MECHANICS_CAPABLE_CLAIM_TYPES,
  type ClaimRecord,
  type ClaimSection,
  type EvidenceRecord,
} from "./evidence.ts";

export interface AnalystScope {
  matchId: string;
  ourTeam: string;
  opposition: string;
  homeAway: "home" | "away";
  matchDate: string;
  competition?: string;
  intent?: string;
}

export interface AnalystAttemptInfo {
  attempt: number;
  ms: number;
  ok: boolean;
}

export interface AnalystDeps {
  config: Config;
  logger?: FastifyBaseLogger;
  /** Optional progress callback — fires after each generateText attempt
   *  (1 on first try, 2 on validation retry). Used by the generate_report
   *  tool to surface analyst progress in the data-report card. */
  onAttempt?: (info: AnalystAttemptInfo) => void;
}

export interface AnalystOutput {
  content: ScoutReportContent;
  claims: ClaimRecord[];
}

const ANALYST_PROMPT = `You are the ANALYST phase inside Scout — a cricket-analysis system for Percy Main CC, a Saturday-league side in the Northumberland and Tyneside Cricket League (NTCL).

You receive ONE match scope and a packet of EvidenceRecords gathered by the researcher phase. You produce the structured scouting report — section content plus a parallel registry of every analytical claim you make. You have NO tools. You cannot fetch more data. You synthesise from the evidence packet you were given, and nothing else.

Output contract — read carefully:

Your final assistant message MUST be a single JSON object of shape:

{
  "content": <ScoutReportContent>,    // see schema below
  "claims": <ClaimRecord[]>           // every analytical claim, with citations
}

No prose before, no prose after. No markdown fences. Just the object.

ScoutReportContent shape (the "report content" sections):

{
  intro: string,                       // 1–2 paragraphs: which match, format, opposition, why it matters
  weather?: { summary, retrievedAt, source? },
  ourPlayers?: Player[],               // max 15
  ourPlayersCharts?: Chart[],          // 0–4 charts; data points must come from evidence numericValue
  theirPlayers?: Player[],             // max 15
  theirPlayersCharts?: Chart[],
  tossDecision: string,                // 1–3 sentences; bat/bowl + why
  overallStrategy: string,             // 1–3 sentences; headline plan
  keyMatchups: string,                 // bowler-vs-batter, batter-vs-bowler
  tactics: string,                     // detailed phase / order / fielding plans
  conclusion: string,                  // short close — do NOT include "Up The Main"
  references: { label: string, url: string }[]
}

Player = { name: string, role?: string, notes?: string, stats?: { label: string, value: string }[] (max 8) }
Chart  = { caption: string, spec: <Chart.js v4 config> }

ClaimRecord shape (one entry per analytical sentence in content):

{
  id: string,                          // your stable id, e.g. "c1", "their_dance_form"
  section: "intro" | "tossDecision" | "overallStrategy" | "keyMatchups" | "tactics" | "conclusion" | "ourPlayers" | "theirPlayers",
  text: string,                        // verbatim sub-phrase copied from the matching section's prose
  isMechanics: boolean,                // see "Mechanics rule" below
  evidenceIds: string[]                // ids of EvidenceRecords backing this claim — at least one
}

The validator parses your output and, for each ClaimRecord:
  - confirms every evidenceId resolves to a real EvidenceRecord from the packet (fabricated ids are stripped; if none survive, the claim is dropped)
  - confirms isMechanics:true claims cite at least one captain_fact / club_fact (otherwise the claim is dropped and its sentence is excised from the prose)
  - searches your prose for ClaimRecord.text and auto-corrects ClaimRecord.section to wherever the text actually appears — getting 'section' exactly right is helpful but not required, as long as the text is somewhere in the report. Claims whose text isn't a substring of any section are dropped.

The validator soft-drops individual claims rather than failing the whole report, so a small number of imperfect claims don't kill an otherwise good run. The retry path only triggers if the JSON is malformed or every claim drops. Aim to satisfy the rules anyway — soft-dropped claims still cost you grounding.

Hard rules — these are not negotiable:

1. EVIDENCE-ONLY. You may only state things the evidence packet supports. If you cannot point to one or more EvidenceRecord ids that ground a claim, do not write the claim. The evidence packet is finite and may be thin — if it is, the report is thin. Do NOT fill gaps with general cricket knowledge or model priors.

2. CLAIMS REGISTRY IS COMPLETE. Every analytical sentence in content (intro, tossDecision, overallStrategy, keyMatchups, tactics, conclusion, and any non-empty ourPlayers[].notes / theirPlayers[].notes) needs a ClaimRecord. The text field must be (or contain) a verbatim substring of the prose so the validator can locate it. The section field is a hint — the validator auto-corrects it — but please tag it accurately as a sanity check on yourself. Captions, stat labels, names, and direct factual statements about the match scope (which match, date, competition) do NOT need ClaimRecords. Anything analytical does.

3. MECHANICS RULE. A claim is "mechanics" if it describes line, length, movement, swing, footwork, shot selection, field placement, captaincy, wicketkeeping, run-up, pace, or grip. For mechanics claims, isMechanics MUST be true, AND at least one cited evidence MUST have claimType "captain_fact" or "club_fact". Stats, scorecards, and dismissal patterns CANNOT back mechanics claims — those are evidence about output, not about how the player operates.
   GOOD: "Dance has been bowled or LBW in 5 of 8 dismissals — bowl straight at him." (NOT mechanics — tactical recommendation supported by dismissal_pattern.)
   GOOD: "Dance bowls full and straight per the captain's note (fact:abc); his 5/27 last week is consistent with that." (Mechanics — backed by a captain_fact.)
   BAD:  "Dance's 5-for came from hitting a full length." (Mechanics with stats-only evidence — REJECTED.)

3a. LEAGUE-RECORD RULE. Any claim about a team's win/loss/draw record (e.g. "Tynemouth are 5-2 this season", "they sit second in the division", "we've won three of our last four") MUST cite at least one league_standings evidence record. Scorecard-derived W/L counts are NOT acceptable — extras tilt the balance enough that scorecards mis-credit results. If no league_standings evidence is in the packet, simply do NOT make a W/L-record claim. Don't say "5 wins from 8" if the only support is pc_match aggregates.
   GOOD: "Backworth lead Division 4 North on 96 pts (7W 1L)." (cites league_standings)
   BAD:  "Backworth have won 7 of their 8 fixtures by my count of the scorecards." (scorecard-derived — REJECTED.)

4. NO FABRICATED REFERENCES. content.references is auto-generated from evidence sourceUrl values; you do not author it. Emit content.references as an empty array — the BE will fill it after validation.

5. CHARTS, OPTIONAL AND GROUNDED. ourPlayersCharts / theirPlayersCharts are optional and frequently empty. If you do include a chart, every data point must correspond to an EvidenceRecord with a numericValue you used as the value. List the evidence ids in a single ClaimRecord whose text is the chart caption.

6. STATS DESCRIBE OUTPUT, NEVER MECHANICS. "Smith took 5 wickets" → fine, db_aggregate or pc_aggregate. "Smith generates movement / hits a hard length / opens the bowling" → mechanics — needs captain_fact / club_fact, otherwise omit.

7. NO TOOL CALLS. You have no tools. Anything you'd want to look up that isn't in the packet, you simply omit.

Format guidance:
- Inline markdown bold (**word**) and italic (_word_) render in the PDF. Headings, lists, links, and code do NOT — the structural sections handle layout.
- Field-level guidance:
  * tossDecision: 1–3 sentences. Toss call + why, grounded in weather + venue + opposition strengths from the packet.
  * overallStrategy: 1–3 sentences. Headline plan for the day.
  * keyMatchups: bowler-vs-batter and batter-vs-bowler plans, grounded in dismissal_pattern + stats + facts.
  * tactics: detailed phase / order / fielding plans. Toss + strategy already have their own fields — do NOT repeat them here.
  * conclusion: short close. Renderer appends "Up The Main" — do NOT include it.

${GROUNDING_RULES}

${IMPORTANT_CONTEXT}

Final reminder: emit JSON ONLY in the final assistant message. The orchestrator parses your message as JSON and fails if it's not a single object matching the shape above. References should be an empty array; we fill them server-side from evidence sourceUrls.
`;

const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]+?)\s*```/;

function extractJson(raw: string): string {
  const fenced = FENCED_JSON_RE.exec(raw);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return raw.slice(first, last + 1);
  }
  return raw.trim();
}

type ClaimDropReason =
  | "no_evidence" // every cited evidenceId was fabricated
  | "mechanics_unsupported" // mechanics:true but no captain_fact / club_fact backed it
  | "text_not_found"; // claim.text isn't a substring of any section's prose

export interface ClaimDrop {
  claim: ClaimRecord;
  reason: ClaimDropReason;
  /** The section we located the text in, if any. None for `text_not_found`. */
  locatedIn: ClaimSection | null;
}

export interface ValidationResult {
  /** Claims that survived validation. Auto-corrected: `section` is rewritten
   *  to where the text actually lives, and fabricated evidenceIds are
   *  stripped (provided at least one valid id remains). */
  claims: ClaimRecord[];
  /** Claims dropped during validation. Caller excises prose for drops with
   *  a non-null locatedIn so unsupported sentences don't ship. */
  drops: ClaimDrop[];
  /** Sections that had analytical prose but no surviving claim covering them.
   *  Logged as a warning — does not fail the report. */
  uncovered: ClaimSection[];
}

/**
 * Collect the analytical prose for one section, normalised for substring
 * comparison. ourPlayers / theirPlayers map to the union of `notes` across
 * all players in that section — the analyst can scope a claim to "ourPlayers"
 * and the validator searches the combined notes string. Returns the empty
 * string when the section has no analytical content (e.g. ourPlayers omitted
 * entirely, or every player's notes is undefined) — coverage logic uses this
 * to skip the section.
 */
function sectionProse(
  content: ScoutReportContent,
  section: ClaimSection,
): string {
  const join = (
    players: ScoutReportContent["ourPlayers"] | undefined,
  ): string =>
    (players ?? [])
      .map((p) => p.notes ?? "")
      .filter((s) => s.length > 0)
      .join(" \n ");
  switch (section) {
    case "intro":
      return content.intro;
    case "tossDecision":
      return content.tossDecision;
    case "overallStrategy":
      return content.overallStrategy;
    case "keyMatchups":
      return content.keyMatchups;
    case "tactics":
      return content.tactics;
    case "conclusion":
      return content.conclusion;
    case "ourPlayers":
      return join(content.ourPlayers);
    case "theirPlayers":
      return join(content.theirPlayers);
  }
}

const normaliseForMatch = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Remove the sentence containing `phrase` from `prose`. Used when a claim
 * is soft-dropped (mechanics rule violation): the claim's text would
 * otherwise stay in the section's prose without a citation chip, shipping
 * unsupportable mechanics advice in the PDF.
 *
 * Best-effort. We locate `phrase` case-insensitively, walk back to the
 * previous sentence break (. ! ? \n) or string start, walk forward to the
 * next sentence break (inclusive), and strip that range. Adjacent
 * whitespace is collapsed and a leading/trailing newline run is normalised.
 *
 * Edge cases we don't try to be clever about:
 *   - phrase spans multiple sentences (claim records are typically one
 *     sentence per the prompt rules; if it spans, the whole span goes,
 *     which is the right thing anyway).
 *   - phrase wraps onto a section that we can't find via case-insensitive
 *     substring (e.g. analyst paraphrased between content and claim.text).
 *     The validator's substring check would already have failed in that
 *     case, so we'd be on the must-fix retry path, not soft-drop.
 */
function excisePhraseFromString(prose: string, phrase: string): string {
  const needle = phrase.trim();
  if (!needle) return prose;
  const idx = prose.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return prose;

  let start = idx;
  while (start > 0 && !/[.!?\n]/.test(prose[start - 1])) start--;
  while (start < idx && /\s/.test(prose[start])) start++;

  let end = idx + needle.length;
  while (end < prose.length && !/[.!?\n]/.test(prose[end])) end++;
  if (end < prose.length) end++;
  while (end < prose.length && prose[end] === " ") end++;

  return (prose.slice(0, start) + prose.slice(end))
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n +/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Return a copy of `content` with the dropped claim's `text` excised from
 * its declared `section`. For string sections this is a single in-place
 * removal; for player-array sections we map each player's notes through
 * the same removal (the phrase will only match in one of them).
 */
function exciseClaimFromContent(
  content: ScoutReportContent,
  claim: ClaimRecord,
): ScoutReportContent {
  const exciseInPlayers = (
    players: ScoutReportContent["ourPlayers"],
  ): ScoutReportContent["ourPlayers"] =>
    (players ?? []).map((p) => ({
      ...p,
      notes: p.notes ? excisePhraseFromString(p.notes, claim.text) : p.notes,
    }));

  switch (claim.section) {
    case "intro":
      return {
        ...content,
        intro: excisePhraseFromString(content.intro, claim.text),
      };
    case "tossDecision":
      return {
        ...content,
        tossDecision: excisePhraseFromString(content.tossDecision, claim.text),
      };
    case "overallStrategy":
      return {
        ...content,
        overallStrategy: excisePhraseFromString(
          content.overallStrategy,
          claim.text,
        ),
      };
    case "keyMatchups":
      return {
        ...content,
        keyMatchups: excisePhraseFromString(content.keyMatchups, claim.text),
      };
    case "tactics":
      return {
        ...content,
        tactics: excisePhraseFromString(content.tactics, claim.text),
      };
    case "conclusion":
      return {
        ...content,
        conclusion: excisePhraseFromString(content.conclusion, claim.text),
      };
    case "ourPlayers":
      return { ...content, ourPlayers: exciseInPlayers(content.ourPlayers) };
    case "theirPlayers":
      return {
        ...content,
        theirPlayers: exciseInPlayers(content.theirPlayers),
      };
  }
}

/**
 * One-line summary of a drop list for log + error messages. Counts by reason
 * so the log line is greppable without exploding for every claim.
 */
function summariseDrops(drops: ClaimDrop[]): string {
  if (drops.length === 0) return "(none)";
  const counts: Record<ClaimDropReason, number> = {
    no_evidence: 0,
    mechanics_unsupported: 0,
    text_not_found: 0,
  };
  for (const d of drops) counts[d.reason]++;
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${reason}=${n}`)
    .join(", ");
}

// Sections always present in every report (required strings on the schema).
// If any of these have prose, they MUST have at least one claim covering
// them. ourPlayers / theirPlayers are optional and only require coverage
// when they hold non-trivial notes.
const ALWAYS_PRESENT_SECTIONS: readonly ClaimSection[] = [
  "intro",
  "tossDecision",
  "overallStrategy",
  "keyMatchups",
  "tactics",
  "conclusion",
];

/**
 * Search every analytical section for `claim.text`. Returns the section in
 * which the text appears (preferring the model-declared one when it matches,
 * for stability), or `null` if the text isn't a substring of any section's
 * prose.
 *
 * The model's `claim.section` is treated as a hint, not a contract — we've
 * seen the analyst tag claims with sections it never actually wrote prose
 * into (e.g. "ourPlayers" when ourPlayers is omitted entirely). Auto-locating
 * the actual section is more robust than asking the model to be perfect.
 */
function locateClaimSection(
  claim: ClaimRecord,
  proseBySection: Map<ClaimSection, string>,
): ClaimSection | null {
  const needle = normaliseForMatch(claim.text);
  if (needle.length === 0) return null;

  // Cheap path: trust the model's tag if it's actually correct.
  const declared = proseBySection.get(claim.section);
  if (declared && declared.length > 0 && declared.includes(needle)) {
    return claim.section;
  }

  // Otherwise scan every section in canonical order. First match wins.
  // In practice claim text is one sentence and unlikely to appear in two
  // sections; if it does, the canonical-order tiebreak is deterministic.
  for (const section of ANALYTICAL_SECTIONS) {
    if (section === claim.section) continue;
    const prose = proseBySection.get(section);
    if (prose && prose.length > 0 && prose.includes(needle)) return section;
  }
  return null;
}

/**
 * Structural validator — runs AFTER Zod-parsing the analyst output. Zod
 * confirms shape; this layer enforces the cross-field invariants Zod can't
 * express, but treats individual claims as droppable rather than blowing
 * up the whole report.
 *
 * Per-claim rules:
 *   1. Every cited evidenceId resolves to a real EvidenceRecord. Fabricated
 *      ids are stripped; the claim survives if at least one resolves. If
 *      every cited id is fabricated, the claim is dropped.
 *   2. Mechanics claims (isMechanics:true) must cite at least one
 *      captain_fact / club_fact. Otherwise dropped — the prose was
 *      already sitting under unsupportable mechanics advice and the
 *      caller excises it.
 *   3. claim.text must appear as a substring of SOME section's prose.
 *      We auto-correct claim.section to where the text actually lives,
 *      so the model's section tag is a hint not a hard contract.
 *
 * Coverage (every section with prose has at least one claim) is downgraded
 * to a warning — the model can game it anyway by adding a cheap claim
 * per section, and forcing a retry on coverage rarely improves grounding.
 *
 * Hard failure surfaces only at the call site, when zero claims survive.
 */
export function validateClaims(
  output: AnalystOutput,
  evidence: EvidenceRecord[],
): ValidationResult {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const claims: ClaimRecord[] = [];
  const drops: ClaimDrop[] = [];
  const sectionsWithClaim = new Set<ClaimSection>();

  const proseBySection = new Map<ClaimSection, string>();
  for (const section of ANALYTICAL_SECTIONS) {
    proseBySection.set(
      section,
      normaliseForMatch(sectionProse(output.content, section)),
    );
  }

  for (const claim of output.claims) {
    const validEvidenceIds = claim.evidenceIds.filter((id) =>
      evidenceById.has(id),
    );
    const locatedIn = locateClaimSection(claim, proseBySection);

    if (validEvidenceIds.length === 0) {
      drops.push({ claim, reason: "no_evidence", locatedIn });
      continue;
    }

    if (locatedIn === null) {
      drops.push({ claim, reason: "text_not_found", locatedIn: null });
      continue;
    }

    if (claim.isMechanics) {
      const hasFact = validEvidenceIds.some((id) => {
        const record = evidenceById.get(id);
        return record
          ? MECHANICS_CAPABLE_CLAIM_TYPES.has(record.claimType)
          : false;
      });
      if (!hasFact) {
        drops.push({ claim, reason: "mechanics_unsupported", locatedIn });
        continue;
      }
    }

    claims.push({
      ...claim,
      section: locatedIn,
      evidenceIds: validEvidenceIds,
    });
    sectionsWithClaim.add(locatedIn);
  }

  const uncovered: ClaimSection[] = [];
  for (const section of ANALYTICAL_SECTIONS) {
    const prose = proseBySection.get(section) ?? "";
    if (prose.length === 0) continue;
    if (
      ALWAYS_PRESENT_SECTIONS.includes(section) &&
      !sectionsWithClaim.has(section)
    ) {
      uncovered.push(section);
    } else if (!sectionsWithClaim.has(section)) {
      // Optional sections (ourPlayers, theirPlayers) with prose but no
      // claim — still worth flagging so it shows up in telemetry, just
      // not as a hard error.
      uncovered.push(section);
    }
  }

  return { claims, drops, uncovered };
}

function deriveReferences(evidence: EvidenceRecord[]): ScoutReportReference[] {
  // Dedupe on URL. Label uses the source-type + a short hint so the references
  // page reads naturally.
  const seen = new Map<string, ScoutReportReference>();
  for (const e of evidence) {
    if (!e.sourceUrl) continue;
    if (seen.has(e.sourceUrl)) continue;
    const label = (() => {
      switch (e.sourceType) {
        case "play_cricket":
          return e.context && "matchDate" in e.context && e.context.matchDate
            ? `Play Cricket — ${String(e.context.matchDate)}`
            : "Play Cricket";
        case "weather":
          return "Weather forecast";
        case "fact":
          return "Recorded fact source";
        case "db":
          return "Local DB query";
      }
    })();
    seen.set(e.sourceUrl, { label, url: e.sourceUrl });
  }
  return Array.from(seen.values());
}

/**
 * Phase 2 — synthesise the report content + claim registry from the
 * researcher's evidence packet. No tools. One retry on validation failure
 * with the validator errors fed back into the prompt; fail loud after that.
 */
export async function analyseScoutEvidence(
  deps: AnalystDeps,
  scope: AnalystScope,
  evidence: EvidenceRecord[],
): Promise<AnalystOutput> {
  const resolved = resolveModel(
    deps.config.SCOUT_PROVIDER_ANALYST,
    deps.config.SCOUT_MODEL_ANALYST,
  );

  // Analyst gets the entire evidence packet up front — there's nothing to
  // discover or plan iteratively. Disable DeepSeek's thinking mode so we
  // skip a multi-minute reasoning pass that adds little for a
  // structured-extraction task.
  const providerOptions = deepseekFastProviderOptions(resolved.provider);

  const today = new Date();
  const todayDisplay = today.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const scopeBlock = `MATCH SCOPE:
- matchId: ${scope.matchId}
- ourTeam: ${scope.ourTeam}
- opposition: ${scope.opposition}
- homeAway: ${scope.homeAway}
- matchDate: ${scope.matchDate}
- competition: ${scope.competition ?? "(not specified)"}
- intent: ${scope.intent ?? "(general scout)"}

Today is ${todayDisplay}.`;

  const evidenceBlock = `EVIDENCE PACKET (${evidence.length} records):
${JSON.stringify(evidence, null, 2)}`;

  const runOnce = async (extra: string, attempt: number): Promise<string> => {
    const stepStart = Date.now();
    deps.logger?.info(
      {
        matchId: scope.matchId,
        attempt,
        evidenceCount: evidence.length,
        timeoutMs: deps.config.SCOUT_ANALYST_TIMEOUT_MS,
      },
      "scout_analyst_started",
    );
    try {
      const result = await generateText({
        model: resolved.model,
        system: ANALYST_PROMPT,
        prompt: `${scopeBlock}\n\n${evidenceBlock}${extra ? `\n\n${extra}` : ""}\n\nProduce the JSON object now.`,
        providerOptions,
        // Per-phase wall-clock cap. Analyst is one tool-less generateText
        // call, but the prompt carries the entire evidence packet inline so
        // the model's processing time scales with packet size.
        abortSignal: AbortSignal.timeout(deps.config.SCOUT_ANALYST_TIMEOUT_MS),
      });
      const ms = Date.now() - stepStart;
      deps.logger?.info(
        { matchId: scope.matchId, attempt, ms },
        "scout_analyst_step_done",
      );
      deps.onAttempt?.({ attempt, ms, ok: true });
      return result.text;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      const ms = Date.now() - stepStart;
      deps.logger?.error(
        { matchId: scope.matchId, attempt, err, isTimeout, ms },
        "scout_analyst_step_failed",
      );
      deps.onAttempt?.({ attempt, ms, ok: false });
      if (isTimeout) {
        throw new Error(
          `Analyst phase timed out after ${deps.config.SCOUT_ANALYST_TIMEOUT_MS}ms on attempt ${attempt}.`,
          { cause: err },
        );
      }
      throw err;
    }
  };

  const parseAndValidate = (
    raw: string,
  ): { ok: true; output: AnalystOutput } | { ok: false; reason: string } => {
    let json: unknown;
    try {
      json = JSON.parse(extractJson(raw));
    } catch (err) {
      return {
        ok: false,
        reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // Strict-parse `content` (the report itself — every section matters)
    // and best-effort each `claims[i]` independently. A single malformed
    // claim (e.g. an unknown `section` value the model invented) drops
    // that claim with a logged warning rather than failing the whole
    // attempt, which would force a full retry and another run of the
    // 1k-token prompt.
    const looseSchema = z.object({
      content: scoutReportContentSchema,
      claims: z.array(z.unknown()).min(1),
    });
    const looseParsed = looseSchema.safeParse(json);
    if (!looseParsed.success) {
      return {
        ok: false,
        reason: `Schema validation error: ${looseParsed.error.message}`,
      };
    }

    const validClaims: ClaimRecord[] = [];
    const droppedShape: Array<{ index: number; reason: string }> = [];
    looseParsed.data.claims.forEach((c, i) => {
      const r = claimRecordSchema.safeParse(c);
      if (r.success) {
        validClaims.push(r.data);
      } else {
        droppedShape.push({ index: i, reason: r.error.message });
      }
    });

    if (droppedShape.length > 0) {
      deps.logger?.warn(
        {
          matchId: scope.matchId,
          dropped: droppedShape.slice(0, 10),
          totalDropped: droppedShape.length,
          totalClaims: looseParsed.data.claims.length,
        },
        "scout_analyst_dropped_malformed_claims",
      );
    }

    if (validClaims.length === 0) {
      return {
        ok: false,
        reason: `All ${droppedShape.length} claims failed shape validation. First error: ${droppedShape[0]?.reason ?? "(none)"}`,
      };
    }

    const result = validateClaims(
      { content: looseParsed.data.content, claims: validClaims },
      evidence,
    );

    if (result.claims.length === 0) {
      return {
        ok: false,
        reason: `All ${validClaims.length} claims dropped during validation: ${summariseDrops(result.drops)}`,
      };
    }

    // Excise prose for any drop where we located the text. Mechanics drops
    // and no-evidence drops both ship unsupportable sentences; pulling them
    // out of the prose stops them from showing up in the PDF without a
    // citation chip pointing at real evidence. text_not_found drops have
    // no excisable target by definition (the text wasn't anywhere) — they
    // shed only the registry entry.
    let mutatedContent = looseParsed.data.content;
    for (const drop of result.drops) {
      if (drop.locatedIn !== null) {
        mutatedContent = exciseClaimFromContent(mutatedContent, {
          ...drop.claim,
          section: drop.locatedIn,
        });
      }
    }

    if (result.drops.length > 0) {
      deps.logger?.warn(
        {
          matchId: scope.matchId,
          drops: result.drops.map((d) => ({
            id: d.claim.id,
            reason: d.reason,
            declaredSection: d.claim.section,
            locatedIn: d.locatedIn,
            text: d.claim.text,
            evidenceIds: d.claim.evidenceIds,
          })),
        },
        "scout_analyst_dropped_claims",
      );
    }
    if (result.uncovered.length > 0) {
      deps.logger?.warn(
        {
          matchId: scope.matchId,
          uncovered: result.uncovered,
        },
        "scout_analyst_uncovered_sections",
      );
    }

    return {
      ok: true,
      output: { content: mutatedContent, claims: result.claims },
    };
  };

  const startedAt = Date.now();
  const firstRaw = await runOnce("", 1);
  const firstResult = parseAndValidate(firstRaw);

  let output: AnalystOutput;
  if (firstResult.ok) {
    output = firstResult.output;
  } else {
    deps.logger?.warn(
      {
        matchId: scope.matchId,
        attempt: 1,
        reason: firstResult.reason,
      },
      "scout_analyst_failed_retrying",
    );
    const retryRaw = await runOnce(
      `Your previous output failed validation. Errors:\n${firstResult.reason}\n\nReturn corrected JSON ONLY — no prose, no fences.`,
      2,
    );
    const retryResult = parseAndValidate(retryRaw);
    if (!retryResult.ok) {
      throw new Error(
        `Analyst output failed validation twice. Last error: ${retryResult.reason}`,
      );
    }
    output = retryResult.output;
  }

  // Auto-fill references from evidence URLs. Whatever the analyst put in
  // content.references is discarded — see the prompt's "no fabricated
  // references" rule.
  output.content.references = deriveReferences(evidence);

  deps.logger?.info(
    {
      matchId: scope.matchId,
      claims: output.claims.length,
      references: output.content.references.length,
      ms: Date.now() - startedAt,
    },
    "scout_analyst_done",
  );

  return output;
}
