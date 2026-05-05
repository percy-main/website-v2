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
  claimRecordSchema,
  MECHANICS_CAPABLE_CLAIM_TYPES,
  type ClaimRecord,
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

export interface AnalystDeps {
  config: Config;
  logger?: FastifyBaseLogger;
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
  text: string,                        // the claim verbatim from your prose, so a reviewer can locate it
  isMechanics: boolean,                // see "Mechanics rule" below
  evidenceIds: string[]                // ids of EvidenceRecords backing this claim — at least one
}

Hard rules — these are not negotiable:

1. EVIDENCE-ONLY. You may only state things the evidence packet supports. If you cannot point to one or more EvidenceRecord ids that ground a claim, do not write the claim. The evidence packet is finite and may be thin — if it is, the report is thin. Do NOT fill gaps with general cricket knowledge or model priors.

2. CLAIMS REGISTRY IS COMPLETE. Every analytical sentence in content (intro, tossDecision, overallStrategy, keyMatchups, tactics, conclusion, ourPlayers[].notes, theirPlayers[].notes) needs a corresponding ClaimRecord with at least one evidenceId. Captions, stat labels, names, and direct factual statements about the match scope (which match, which date, which competition) do NOT need ClaimRecords. Anything analytical does.

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

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
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
 * Structural validators — run AFTER Zod-parsing the analyst output. Zod
 * confirms shape; this layer enforces the cross-field invariants Zod can't
 * express (every claim resolves to real evidence; mechanics claims have
 * fact-typed evidence).
 *
 * Returns null on success, or a ValidationFailure with human-readable
 * details that get fed back to the analyst on the retry.
 */
function validateClaims(
  output: AnalystOutput,
  evidence: EvidenceRecord[],
): ValidationFailure | null {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const details: string[] = [];

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
        const cited = resolved
          .map((r) => `${r.id}=${r.record?.claimType ?? "?"}`)
          .join(", ");
        details.push(
          `Claim "${claim.id}" is tagged isMechanics:true but is backed only by [${cited}] — at least one evidence with claimType "captain_fact" or "club_fact" is required for mechanics claims. Either tag isMechanics:false (if it's actually a tactical/output claim from stats), or omit the claim if the captain hasn't recorded a fact about it.`,
        );
      }
    }
  }

  if (details.length === 0) return null;
  return {
    reason: `${details.length} claim(s) failed validation`,
    details,
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
      deps.logger?.info(
        {
          matchId: scope.matchId,
          attempt,
          ms: Date.now() - stepStart,
        },
        "scout_analyst_step_done",
      );
      return result.text;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      deps.logger?.error(
        {
          matchId: scope.matchId,
          attempt,
          err,
          isTimeout,
          ms: Date.now() - stepStart,
        },
        "scout_analyst_step_failed",
      );
      if (isTimeout) {
        throw new Error(
          `Analyst phase timed out after ${deps.config.SCOUT_ANALYST_TIMEOUT_MS}ms on attempt ${attempt}.`,
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
    const claimError = validateClaims(parsed.data, evidence);
    if (claimError) {
      return {
        ok: false,
        reason: `${claimError.reason}:\n- ${claimError.details.join("\n- ")}`,
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
