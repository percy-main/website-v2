import {
  scoutReportContentSchema,
  type ScoutReportContent,
  type ScoutReportReference,
} from "@percy-main/shared";
import { generateText } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Config } from "../../../config.ts";
import { resolveModel } from "../provider.ts";
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

const analystOutputSchema = z.object({
  content: scoutReportContentSchema,
  claims: z.array(claimRecordSchema).min(1),
});

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

The validator parses your output, then for each ClaimRecord:
  - looks up the prose for ClaimRecord.section in your content
  - confirms ClaimRecord.text appears in that prose as a case-insensitive substring (whitespace is collapsed)
  - confirms every evidenceId resolves to a real EvidenceRecord from the packet
  - confirms isMechanics:true claims cite at least one captain_fact / club_fact

Then it does a coverage pass: every section that contains analytical prose MUST have at least one ClaimRecord pointing at it. If you write tactical sentences in tactics but register no ClaimRecord with section:"tactics", validation fails.

Hard rules — these are not negotiable:

1. EVIDENCE-ONLY. You may only state things the evidence packet supports. If you cannot point to one or more EvidenceRecord ids that ground a claim, do not write the claim. The evidence packet is finite and may be thin — if it is, the report is thin. Do NOT fill gaps with general cricket knowledge or model priors.

2. CLAIMS REGISTRY IS COMPLETE AND SECTION-TAGGED. Every analytical sentence in content (intro, tossDecision, overallStrategy, keyMatchups, tactics, conclusion, and any non-empty ourPlayers[].notes / theirPlayers[].notes) needs a ClaimRecord with the correct section value. The text field must be a verbatim substring of that section's prose so the validator can locate it. Captions, stat labels, names, and direct factual statements about the match scope (which match, date, competition) do NOT need ClaimRecords. Anything analytical does.

3. MECHANICS RULE. A claim is "mechanics" if it describes line, length, movement, swing, footwork, shot selection, field placement, captaincy, wicketkeeping, run-up, pace, or grip. For mechanics claims, isMechanics MUST be true, AND at least one cited evidence MUST have claimType "captain_fact" or "club_fact". Stats, scorecards, and dismissal patterns CANNOT back mechanics claims — those are evidence about output, not about how the player operates.
   GOOD: "Dance has been bowled or LBW in 5 of 8 dismissals — bowl straight at him." (NOT mechanics — tactical recommendation supported by dismissal_pattern.)
   GOOD: "Dance bowls full and straight per the captain's note (fact:abc); his 5/27 last week is consistent with that." (Mechanics — backed by a captain_fact.)
   BAD:  "Dance's 5-for came from hitting a full length." (Mechanics with stats-only evidence — REJECTED.)

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

interface ValidationFailure {
  reason: string;
  details: string[];
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
 * Structural validators — run AFTER Zod-parsing the analyst output. Zod
 * confirms shape; this layer enforces the cross-field invariants Zod can't
 * express:
 *
 *   1. every claim resolves to real evidence (no fabricated ids) — must-fix
 *   2. mechanics claims cite fact-typed evidence — SOFT: ids are returned
 *      in droppedClaimIds for the caller to filter, the request does NOT
 *      fail. Saw this twice in prod (analyst tagged isMechanics:true on
 *      pc_aggregate / weather-backed claims) — the right move is to drop
 *      the [N] chip rather than blow up the whole report. Coverage credit
 *      for the dropped claim's section is preserved, so the prose stays
 *      in the report just without a citation chip pointing at unsupportable
 *      evidence.
 *   3. each claim's text appears as a substring of the prose in its declared
 *      section — must-fix
 *   4. every section with non-trivial prose has at least one claim covering
 *      it — must-fix (catches "wrote analytical prose but didn't register
 *      any claims for it" — the main grounding-contract loophole)
 *
 * Returns { failure, droppedClaimIds }. failure is null when only soft
 * drops happened. The caller filters droppedClaimIds out of output.claims.
 */
function validateClaims(
  output: AnalystOutput,
  evidence: EvidenceRecord[],
): { failure: ValidationFailure | null; droppedClaimIds: string[] } {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const details: string[] = [];
  const droppedClaimIds: string[] = [];

  // Pre-compute normalised prose per section once — coverage check below
  // reads the same map.
  const proseBySection = new Map<ClaimSection, string>();
  for (const section of ANALYTICAL_SECTIONS) {
    proseBySection.set(
      section,
      normaliseForMatch(sectionProse(output.content, section)),
    );
  }

  // Track which sections have at least one claim — used for the coverage
  // pass after the per-claim loop.
  const sectionsWithClaim = new Set<ClaimSection>();

  for (const claim of output.claims) {
    const resolved = claim.evidenceIds.map((id) => ({
      id,
      record: evidenceById.get(id),
    }));
    const missing = resolved.filter((r) => !r.record).map((r) => r.id);
    if (missing.length > 0) {
      details.push(
        `Claim "${claim.id}" cites unknown evidence ids: [${missing.join(", ")}]. Every evidenceId must match an existing EvidenceRecord.id from the packet.`,
      );
      continue;
    }

    if (claim.isMechanics) {
      const hasFact = resolved.some(
        (r) =>
          r.record && MECHANICS_CAPABLE_CLAIM_TYPES.has(r.record.claimType),
      );
      if (!hasFact) {
        // Soft drop: caller will filter this claim from output.claims.
        // The prose stays in the report (its section still gets coverage
        // credit below); we just remove the [N] chip that pointed at
        // evidence which can't actually back a mechanics claim.
        droppedClaimIds.push(claim.id);
      }
    }

    // Substring check: claim.text must appear in its declared section.
    const sectionText = proseBySection.get(claim.section) ?? "";
    const needle = normaliseForMatch(claim.text);
    if (sectionText.length === 0) {
      details.push(
        `Claim "${claim.id}" declares section "${claim.section}" but that section has no prose in the report. Move the claim to a section that contains its text, or remove the claim.`,
      );
    } else if (needle.length > 0 && !sectionText.includes(needle)) {
      details.push(
        `Claim "${claim.id}" declares section "${claim.section}" but its text was not found in that section's prose. Either copy a verbatim sub-phrase into the claim's text, or move the claim to the correct section.`,
      );
    } else {
      sectionsWithClaim.add(claim.section);
    }
  }

  // Coverage pass: every section with non-trivial prose must have at least
  // one valid claim covering it. Empty sections (ourPlayers / theirPlayers
  // with no notes) are exempt.
  for (const section of ANALYTICAL_SECTIONS) {
    const prose = proseBySection.get(section) ?? "";
    if (prose.length === 0) continue;
    const required =
      ALWAYS_PRESENT_SECTIONS.includes(section) || prose.length > 0;
    if (required && !sectionsWithClaim.has(section)) {
      details.push(
        `Section "${section}" has analytical prose but no ClaimRecord covers it. Every analytical sentence MUST be backed by a registered claim — add at least one ClaimRecord with section:"${section}" pointing at the evidence that grounds it.`,
      );
    }
  }

  if (details.length === 0) return { failure: null, droppedClaimIds };
  return {
    failure: {
      reason: `${details.length} claim(s) failed validation`,
      details,
    },
    droppedClaimIds,
  };
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
  // structured-extraction task. Anthropic has no equivalent toggle, so the
  // providerOptions block is empty when provider !== deepseek.
  //
  // Mirrors the type pattern in agent.ts — generateText's providerOptions
  // is typed as a deep alias (SharedV3ProviderOptions) not exported from the
  // public "ai" entrypoint. A JSONValue-tree shape is sufficient and avoids
  // reaching into a transitive dep.
  type JsonValue =
    | string
    | number
    | boolean
    | null
    | { [key: string]: JsonValue }
    | JsonValue[];
  const providerOptions: Record<
    string,
    Record<string, JsonValue>
  > = resolved.provider === "deepseek"
    ? { deepseek: { thinking: { type: "disabled" } } }
    : {};

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
    const parsed = analystOutputSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        reason: `Schema validation error: ${parsed.error.message}`,
      };
    }
    const { failure, droppedClaimIds } = validateClaims(parsed.data, evidence);
    if (droppedClaimIds.length > 0) {
      const droppedClaims = parsed.data.claims.filter((c) =>
        droppedClaimIds.includes(c.id),
      );
      // Excise the dropped claim's text from its section's prose BEFORE
      // we filter it out of claims — otherwise the unsupported sentence
      // ships in the PDF without a citation chip. Each excise is in-place
      // on a copy of content; iterate so multiple drops in the same
      // section compose correctly.
      let mutatedContent = parsed.data.content;
      for (const claim of droppedClaims) {
        mutatedContent = exciseClaimFromContent(mutatedContent, claim);
      }
      parsed.data.content = mutatedContent;
      parsed.data.claims = parsed.data.claims.filter(
        (c) => !droppedClaimIds.includes(c.id),
      );
      deps.logger?.warn(
        {
          matchId: scope.matchId,
          droppedClaimIds,
          droppedClaims: droppedClaims.map((c) => ({
            id: c.id,
            section: c.section,
            text: c.text,
            evidenceIds: c.evidenceIds,
          })),
        },
        "scout_analyst_dropped_unsupported_mechanics_claims",
      );
    }
    if (failure) {
      return {
        ok: false,
        reason: `${failure.reason}:\n- ${failure.details.join("\n- ")}`,
      };
    }
    return { ok: true, output: parsed.data };
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
