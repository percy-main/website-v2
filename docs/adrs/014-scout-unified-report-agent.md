# ADR 014: Scout report pipeline — unified agent + tool-driven structured output

## Status

Accepted

## Context

The first version of the Scout report pipeline (`generate_report` → ECS / in-process worker → PDF) was a three-phase split:

1. **Researcher** — runs an AI SDK loop with tools (`ask_db`, `pc_*`, `weather_get`, `fact_retrieve`) and emits each piece of data as an `EvidenceRecord` via a `record_evidence` tool. Anchored on a hard prompt rule: no analysis, no narrative, only data.
2. **Analyst** — receives the evidence packet, no tools, generates a `ScoutReportContent` JSON object plus a parallel `ClaimRecord` registry citing evidence ids.
3. **Render** — rasterises charts, runs the `@react-pdf/renderer` layout in a worker thread.

The split was justified at the time by a separation-of-concerns argument (fact gathering vs. synthesis) and made it possible to enforce a hard mechanics-grounding validator: every analytical sentence had to cite at least one evidence record, and "mechanics" claims (line, length, footwork, etc.) had to cite a `captain_fact` / `club_fact` rather than stats.

In practice, three problems showed up:

- **The wall is artificial.** Real scouting analysis is iterative — you start synthesising, realise you need more data, fetch more, refine. The researcher had to gather speculatively for an unknown analyst, leading to imbalanced packets (too many `pc_match` records, no league table, no answer to the matchup that mattered). The analyst then couldn't ask follow-up questions because it had no tools.
- **The JSON-output contract on the analyst was fragile.** DeepSeek (the analyst model) consistently prefaced its final message with prose ("Now let me…", "Let me check one more thing…"), causing the brittle JSON parser to fail. The retry path with feedback was hit-or-miss, and a second failure killed the report entirely.
- **The validator was costly relative to what it bought.** The mechanics rule fired soft drops on edge cases without giving the user obviously better grounding — and the underlying "don't invent line/length" guidance was already in the system prompt. The hard claim-registry contract added prompt complexity (~200 tokens per phase) and ~1k LOC of validator + accumulator code for marginal gain.

## Decision

Collapse the researcher and analyst into a single **report agent** that has the full tool surface (data-gathering plus structured-output tools) and runs as one AI SDK loop. The PDF render stays in its own worker thread (unchanged).

Architecture:

- **Tool-driven structured output.** Sections are written via dedicated tools (`set_intro`, `set_toss_decision`, `set_overall_strategy`, `set_key_matchups`, `set_tactics`, `set_conclusion`, `set_weather`, `set_league_table`, `add_our_player`, `add_their_player`, `chart_render`). Each tool's input is Zod-validated server-side, so a bad value fails one tool call rather than blowing up an end-of-run JSON parse. The agent's final assistant message is discarded — output flows entirely through the accumulator.
- **References from `cite_*` calls, not `record_evidence`.** `cite_match` and `cite_player_stats` (already used in chat mode for inline citation chips) gain a `CitationAccumulator` accumulator wiring in report mode that captures URLs server-side. The references page is built from the accumulator's snapshot at the end of the run. No more `record_evidence` machinery.
- **No claim registry, no mechanics validator.** The grounding guidance stays in the prompt (`GROUNDING_RULES` block — line/length/footwork are off-limits without a recorded fact), but no code enforces it. We accept this looseness as a deliberate trade against the validator's complexity and false-positive rate.
- **Wall-clock as the budget, no step cap.** The agent loop has only a 500-step in-code sanity backstop; the real budget is `SCOUT_REPORT_TIMEOUT_MS` (default 30 minutes). Step caps are a flawed proxy for the wall-clock cost we actually care about, especially with DeepSeek's auto-cache making cached steps near-free.
- **No retry on missing sections.** If the agent finishes without calling all six required `set_*` tools, the report fails loudly. A 30-minute loop that never called `set_intro` doesn't get saved by a re-prompt without context — and passing the prior call's tool-result history into a second `generateText` would cost as much as the original.
- **Schema validation as a guardrail.** `accumulator.toContent()` runs `scoutReportContentSchema.safeParse()` before returning success. This catches model-violating limits (max 15 players, max 4 charts per section, min field lengths) so a runaway `add_their_player` loop fails the report rather than reaching the renderer.

## Why these choices

**One loop matches how scouting actually works.** Gather → analyse → realise a gap → gather more → resynthesise is the natural flow. Separating it into two phases meant the researcher had to gather speculatively and the analyst had to live with whatever it got — exactly the failure modes we kept hitting.

**Tool-driven output beats end-of-run JSON for chat models.** A chat model's natural shape is "a sequence of tool calls and short text"; the JSON-output contract was fighting that. Structured outputs as tool calls play to the model's actual strengths and validate piecewise: a bad `add_our_player` call fails one player, not the whole report.

**Soft validator was net negative.** The hard contract (`isMechanics: true` claims must cite `captain_fact` / `club_fact`) was sound in principle but soft-dropped enough valid claims and silently passed enough invalid ones that the user couldn't trust either signal. Prompt-level guidance with no code-level enforcement is more honest about what the system actually does.

**Wall-clock is the real cost.** With DeepSeek auto-cache, cheap cached steps (`pc_match_summary` re-fetches, projection widening) cost basically nothing. The expensive steps are reasoning passes. A step cap clamps both indiscriminately; a wall-clock budget bounds the actual wallet impact directly.

**Hard-fail rather than retry on missing sections.** The retry path in v1 was always close to a Hail Mary — the second attempt restarted with no access to what the first one had fetched. Either we feed the first attempt's full message history forward (expensive, doubles the wall-clock budget the worker hard-kill is sized for) or we accept that incomplete runs fail. Failing loudly is simpler and the captain can re-trigger.

**FE pipeline card collapses to one box.** Three phases were never something the user could act on; they were operator telemetry. With one loop there's nothing meaningful to render but a spinner and elapsed time.

## Rejected alternatives

- **Keep the two phases, fix the JSON parsing.** Considered. Doesn't address the iterative-analysis problem, and the JSON parser keeps fighting the model's natural shape on every new release.
- **Tool-call output for the analyst, keep the researcher.** Half-measure. Analyst's tool calls would still be working from a frozen evidence packet without the option to fetch follow-ups, leaving the speculative-gathering problem in place.
- **Drop `record_evidence` but keep the claim-registry validator over chat-history tool calls.** Considered. The validator would have to scan the AI SDK's `result.steps[].content` for cite calls and pair them with assistant prose — fragile, and still soft-validates (drops claims) rather than hard-fails. Net negative on complexity vs. value.
- **Pass attempt-1 messages forward into a retry on missing sections.** Considered. Doubles the wall-clock budget for the recovery path (which then has to be reflected in the worker's hard-kill margin), and the failure mode it addresses (model finishes the loop without calling `set_intro`) is rare enough that hard-failing is the simpler discipline.

## Consequences

- ~1500 LOC removed (`analyst.ts`, `researcher.ts`, `evidence.ts`, `record-evidence.ts`, the validator, the claim-registry, three-phase pipeline state, `ask_play_cricket` sub-agent).
- Reports take a similar wall-clock time to v1 in the median case but recover better from "needed more data than the researcher gathered" cases, since there's no longer a hard wall between gather and synthesise.
- Mechanics-grounding is now prompt-only. We accept the looser contract; if invented mechanics ship in a real report we revisit (likely as a regex-based post-hoc check on `keyMatchups` / player notes).
- `scout_report.phases` JSONB column dropped (migration `2026-05-06T09:53:28.991Z.ts`); status enum collapses to `queued | generating | rendering | ready | failed`.

## Related

- [ADR 013](./013-scout-fact-rag.md) — Scout fact RAG (still load-bearing; `fact_retrieve` is one of the report agent's data tools).
