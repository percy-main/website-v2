# ADR 042: Scout player recognition — public-source discovery, not facial recognition

**Date:** 2026-05-14
**Status:** Accepted

## Decision

Scout will get a new tool, `find_player_photo_sources`, that helps a captain find PUBLIC, LABELLED pages which may help them recognise a named opposition player before a match. The tool returns CANDIDATE PUBLIC SOURCES (Play-Cricket profile, club website squad pages, public match reports, league sites, local press, public club social posts) with a per-candidate confidence level. It does NOT do facial recognition, does NOT identify a person from an uploaded image, and does NOT scrape private or logged-in content.

A contract stub is in `apps/api/src/features/scout/tools/recognition-sources.ts`, and the web-search provider is **Tavily** (REST client at `apps/api/src/features/scout/tools/tavily.ts`, API key under `TAVILY_API_KEY`). The tool is NOT yet wired into `agent.ts` — the `execute` body still needs to land, plus the system-prompt rules. This ADR exists to lock the framing before that wiring happens.

## Problem

Captains regularly ask "what does their no.3 look like, so I can spot him on Saturday?" Today they answer it themselves: a manual Google search, the opposition's club site, a public Play-Cricket profile, a public match report. The information is usually findable in 30–60 seconds, but the work is repetitive and the captain has to know which corners of the web to look in. Scout already does the analogous job for stats and form — pulling together what's publicly out there — so doing the same for recognition is a natural extension.

The risk is that "find me photos of opposition players" tips into a different product if it's not framed tightly: facial recognition, private-social scraping, identity-based profiling. Those are things the club explicitly does not want to build, and the privacy posture of the rest of the codebase (read-only `scout_member` view, redacted PII, strict ADR-led data handling) would be incoherent if Scout suddenly grew that surface. The decision below pins the framing so an implementer six months from now doesn't quietly cross the line.

## Options considered

1. **Public-source discovery (chosen).** Search public web for pages that label the named player, return candidate source URLs with confidence levels, hard guardrails against private content. Captain interprets the results.
2. **Facial recognition over uploaded images.** Captain uploads a team photo or a still; Scout matches faces against an indexed corpus and names people.
3. **Private-social scraping.** Crawl Facebook / Instagram / X for the player's posts, harvest tagged photos, present them.
4. **Do nothing.** Captains continue to Google manually.

## Rationale

Option 1 is the only one that fits both the club's privacy posture and what captains actually need at our level. The captain doesn't need a verified identity match — they need "a couple of public pages that probably show this person, ranked by how sure we are". Public-source discovery delivers exactly that, in the same shape as Scout's existing tools (Play-Cricket lookups, weather, knowledge base): it surfaces what's findable, cites it, and lets the human decide.

The framing matters as much as the implementation. The tool contract carries:

- **Source URLs always.** Every candidate includes a `pageUrl`; prose must prefer the source page over a raw image.
- **A three-tier confidence model.** `high` only when the source clearly labels the named player on a portrait-style page (e.g. their own Play-Cricket profile). `medium` when the source names them and contains relevant match imagery but doesn't label the individual photo. `low` when the page mentions them but the image association is unclear — and `low` must NEVER be presented as verified.
- **Failure-state wording baked in.** When results are thin, the tool returns one of `no-reliable-source` / `only-low-confidence` / `unavailable`, each with prescribed prose the agent renders verbatim. That stops the model from upgrading weak results into stronger language.
- **Refusal copy for uploaded images.** If a captain uploads a photo and asks "who is this?", the agent refuses with a fixed line: "I can't identify a player from appearance or match a face to online images." The tool doesn't accept image input at all.
- **No rehosting.** The tool emits URLs; it doesn't copy images into our S3.

These are encoded in the tool description so they're load-bearing on the agent (the model reads the description and is constrained by the output schema), not just operator notes that drift over time.

## Rejected alternatives

- **Facial recognition over uploaded images.** Rejected on three grounds. (a) Legal/regulatory: facial recognition systems trigger UK GDPR Article 9 special-category data handling and would require a DPIA, a lawful basis, and a retention/erasure regime we are not equipped to operate as a volunteer-run club. (b) Vendor cost and quality: the credible providers (AWS Rekognition, Azure Face) require enrolment of a labelled corpus to be useful; building and maintaining that corpus is precisely the work we want to avoid. (c) Mission drift: even if the technical and legal pieces were solved, the resulting tool is no longer "help me recognise an opposition player before Saturday" — it's a person-identification system, which is a different product with different stakeholders. Would only become attractive if a league-wide, opt-in, properly governed system existed upstream; not on our roadmap.

- **Private-social scraping.** Rejected. Scraping logged-in or private content violates the platforms' terms, exposes the club to takedown / legal risk for negligible incremental signal, and would normalise a posture ("we look at what we can find about people on social, even if it's not public") that we explicitly don't want. The public-source path covers the genuinely useful cases (public posts, public match reports, public profiles) without this trade-off. Would only become attractive if a platform shipped an official, public, captain-style discovery API — vanishingly unlikely.

- **Do nothing.** The captain's manual workflow works, but it's friction every week and it duplicates what Scout already does for stats. The marginal cost of doing this once, well, and behind a hard guardrail is small.

## Confidence model (detail)

The tool's output uses three levels. The model is encoded in `recognitionConfidenceSchema` in the tool file and in the tool description so the agent picks it up at call time:

- **high** — image is on the named player's own Play-Cricket profile, OR a portrait/profile photo on a public page is directly labelled with their name.
- **medium** — a public article or post names the player AND contains relevant match/team imagery, but the image itself isn't individually labelled. Example: a match report names them as top scorer and shows photos from that match.
- **low** — the page mentions the player and club context, but image association is unclear or multiple players could plausibly match.

`low` candidates always carry a `warnings` array spelling out why they're weak ("team photo — multiple players visible, not individually labelled"). The agent is instructed to surface those verbatim.

## Source-type taxonomy

`recognitionSourceTypeSchema` enumerates the values the classifier emits per candidate. Search strategy prioritises in roughly this order:

1. `play-cricket-profile` — strongest signal when present.
2. `club-website` — squad / player pages on the opposition's own site.
3. `league-site` — published team lists, league handbooks with player photos.
4. `local-news` — public press coverage of matches or awards.
5. `public-social-post` — public-only, never private accounts or groups.
6. `other` — anything else that passes the public-only filter.

## Where the tool sits in Scout

When wired, it registers in `chat` and `scout` modes only — debrief is a structured post-match interview and a recognition tool would derail it. The intended report integration is one optional `Recognition Sources` section per scouted player, beneath the existing tactical analysis — never the report's headline content.

## Web-search provider

**Tavily** — REST search + extract API, Bearer-token auth, two POST endpoints. Picked because (a) it's a search API explicitly built for LLM agents (clean JSON results, no HTML scraping), (b) auth and call shape are simple enough that no SDK dependency is needed (see `tavily.ts`), (c) Tavily's `/extract` endpoint reliably reads JS-heavy pages (Facebook groups, club Wix sites) that a hand-rolled fetch would choke on, (d) free tier is generous enough for our usage. API key required: `TAVILY_API_KEY`. The tool depends on `RecognitionWebSearchClient` rather than Tavily directly (search + extract methods), so a future provider swap stays a one-file change.

## Two-pass flow

Initial dogfooding showed that snippet-only scoring under-credited the most useful sources — e.g. a club's own public Facebook group post that named a player would land as `medium` because the search snippet didn't itself describe an image. Fix: after the search fan-out, the tool runs a second `extract` pass on the top candidates (bounded by `maxResults + 4`, capped at Tavily's 20-URL batch limit). The extracted page content + image URLs become the primary scoring haystack; the original search snippet is the fallback when extraction fails. This unlocks:

- **Club-owned social → high.** A Facebook `/groups/` or `/pages/` URL whose title contains the club name AND whose extracted content names the player → high, with the first extracted image surfaced on the candidate.
- **Play-Cricket squad / team pages → high.** Pages under `/Teams/`, `/players/`, `/profile/`, `/member/` paths that name the player → high.
- **Scorecard URLs are dropped, not scored.** `play-cricket.com/website/results/...` paths carry no portraits — they're pure scorecard tables. Filtering them before extraction saves API spend and stops the agent surfacing useless links.
- **Proximity-checked medium.** Page text where the player and club names appear within ~240 characters of each other counts as "page is about this player at this club"; otherwise it's a looser mention and the candidate scores lower.

## Rollout

1. Tool contract + Tavily client + this ADR land first (done in this change).
2. Implement the `execute` body in `recognition-sources.ts`, including source-type classification and confidence scoring.
3. Wire into `createScoutAgent` for `chat` and `scout` modes; add a `RECOGNITION_SOURCES_RULES` block to the system prompt that mirrors the tool description.
4. Update the user-facing `docs/admin/scout.mdx` once the feature is live.
5. Monitor: log per-call result-type distribution; if `low` dominates, retune scoring before widening rollout.

## Open questions

- Whether to emit citations through the existing `cite_*` pipeline so recognition sources appear in the Sources panel alongside match / fact citations, or to keep them in a dedicated section. Lean toward the latter — recognition sources are about "where to look", not "what grounds the claim".
- Whether the tool should accept (and honour) an environment-level allowlist of search domains for clubs in our league. Probably yes — narrows results and removes a class of false positives.
