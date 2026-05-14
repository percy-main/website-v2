import { tool } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { FaceDetector } from "./face-detection.ts";

/**
 * Player photo recognition-source discovery — light-touch contract stub.
 *
 * This is NOT facial recognition and NOT private-social scraping. The tool
 * exists so a captain can find PUBLIC, LABELLED pages that may help them
 * recognise an opposition player before a match (e.g. their own Play-Cricket
 * profile, a club website squad page, a public match report that names them
 * and runs photos from that match). The tool returns CANDIDATE PUBLIC
 * SOURCES — not identifications.
 *
 * The execute body is intentionally a stub: the contract, agent-facing
 * rules, and confidence model are defined here so the design is reviewable
 * and the eventual implementation has guardrails to thread through. The
 * tool is NOT wired into `agent.ts` until a real web-search dependency is
 * picked — see `docs/adrs/042-scout-recognition-sources.md` for the
 * decision record, rejected alternatives, and rollout plan.
 *
 * When wiring up:
 *  - inject a `WebSearchClient` that returns public results only (no
 *    logged-in/private endpoints).
 *  - implement source-type classification + confidence scoring per the
 *    rules in this file's tool description.
 *  - ALWAYS pass-through source URLs; never re-host images.
 *  - register the tool in `createScoutAgent` for chat / scout modes only
 *    (debrief is a structured interview — out of place there).
 */

export const recognitionSourceTypeSchema = z.enum([
  "play-cricket-profile",
  "club-website",
  "public-social-post",
  "league-site",
  "local-news",
  "other",
]);

export const recognitionConfidenceSchema = z.enum(["high", "medium", "low"]);

export const detectedFaceCropSchema = z.object({
  url: z
    .url()
    .describe(
      "Signed S3 URL to the cropped face thumbnail (JPEG, max 320px wide).",
    ),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type DetectedFaceCrop = z.infer<typeof detectedFaceCropSchema>;

export const playerPhotoSourceCandidateSchema = z.object({
  playerName: z
    .string()
    .min(1)
    .describe(
      "The named player this candidate is being suggested for. Echoes the tool input — not extracted from the page.",
    ),
  pageUrl: z
    .url()
    .describe(
      "Public URL of the SOURCE PAGE. Prefer this over imageUrl — readers should land on the original page (which carries the label) rather than a rehosted image.",
    ),
  imageUrl: z
    .url()
    .optional()
    .describe(
      "Optional direct image URL when the source clearly exposes one (e.g. Play-Cricket profile_image, og:image on a public news article). Never store or rehost.",
    ),
  sourceTitle: z.string().optional(),
  sourceType: recognitionSourceTypeSchema,
  date: z
    .string()
    .optional()
    .describe(
      "When the page/post was published, ISO date if known. Display-only — older posts are weaker recognition aids.",
    ),
  contextSnippet: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Short verbatim quote from the page that ties the player to the image (e.g. caption, paragraph naming them). Display-only.",
    ),
  confidence: recognitionConfidenceSchema,
  reasons: z
    .array(z.string())
    .min(1)
    .describe(
      "Why this confidence level was assigned — short bullets the captain can read. See confidence model in the tool description.",
    ),
  warnings: z
    .array(z.string())
    .optional()
    .describe(
      "Caveats the captain should see alongside the source (e.g. 'team photo — multiple players visible, not individually labelled').",
    ),
  faces: z
    .array(detectedFaceCropSchema)
    .optional()
    .describe(
      "Face crops detected in the source image, each as a signed S3 URL to a JPEG thumbnail. Empty / omitted when face detection skipped or found nothing.",
    ),
});

export type PlayerPhotoSourceCandidate = z.infer<
  typeof playerPhotoSourceCandidateSchema
>;

export const recognitionSourcesResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    candidates: z.array(playerPhotoSourceCandidateSchema),
    notes: z
      .array(z.string())
      .optional()
      .describe(
        "Optional operator notes (e.g. 'all candidates were low confidence; consider broadening knownTeams').",
      ),
  }),
  z.object({
    status: z.literal("no-reliable-source"),
    message: z.string(),
  }),
  z.object({
    status: z.literal("only-low-confidence"),
    candidates: z.array(playerPhotoSourceCandidateSchema),
    message: z.string(),
  }),
]);

export type RecognitionSourcesResult = z.infer<
  typeof recognitionSourcesResultSchema
>;

export interface RecognitionSourcesSearchHit {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface RecognitionSourcesExtractedPage {
  url: string;
  /** Full extracted page text (markdown / plain). May be empty when extraction failed. */
  content: string;
  /** Image URLs surfaced from the page, if any. */
  images?: string[];
}

/**
 * Web-search + content-extract abstraction. Tavily is the chosen provider
 * — see ADR 042 — but the tool depends on this interface (not Tavily
 * directly) so a future provider swap doesn't ripple into the agent layer.
 * Implementations must return public results only — no logged-in
 * endpoints, no private social scraping.
 */
export interface RecognitionWebSearchClient {
  search(
    query: string,
    opts?: { maxResults?: number },
  ): Promise<RecognitionSourcesSearchHit[]>;
  /** Fetch + parse a batch of URLs and return their page content + images. */
  extract(urls: string[]): Promise<RecognitionSourcesExtractedPage[]>;
}

export interface RecognitionSourcesToolDeps {
  search: RecognitionWebSearchClient;
  /** Optional face-detection pipeline. When present, every candidate with
   *  an imageUrl is processed (fetch → Rekognition → sharp crops → S3
   *  upload) and the resulting signed crop URLs are attached to the
   *  candidate as `faces[]`. Best-effort — failures degrade silently to
   *  the candidate without faces. */
  faceDetector?: FaceDetector;
  logger?: FastifyBaseLogger;
}

function describeError(err: unknown): {
  message: string;
  status?: number;
  name?: string;
} {
  if (err instanceof Error) {
    const status = (err as unknown as { status?: unknown }).status;
    return {
      name: err.name,
      message: err.message,
      status: typeof status === "number" ? status : undefined,
    };
  }
  return { message: String(err) };
}

const TOOL_DESCRIPTION = `Find PUBLIC sources that may help the captain RECOGNISE a named opposition player before a match. This is recognition-source discovery — it returns candidate public pages (Play-Cricket profile, club site, public match report, league page, local news). It is NOT facial recognition, NOT identity verification, and NOT a way to identify a person from an uploaded photo.

WHEN TO CALL:
- The captain asks about recognising opposition players ("can you help me spot their opener?", "any public photos of their no.3?", "build a recognition pack for Saturday").
- You're producing a scouting report or matchday pack and you've already picked 2–4 key opposition players to talk about; one optional 'Recognition Sources' section per player is fine.

WHEN NOT TO CALL:
- The captain uploaded a photo and asks "who is this?" — refuse politely (failure wording below).
- The question is about a Percy Main player.
- The question doesn't require recognition at all (form, stats, tactics).

INPUT GUIDANCE:
- playerName must be the player's full name as it appears on Play-Cricket / scorecards. Avoid initials-only.
- clubName is the OPPOSITION club. teamName is optional and only narrows when there are multiple sides (e.g. "1st XI").
- Pass playCricketPlayerId or playCricketProfileUrl whenever you have one — that lets the tool resolve a high-confidence Play-Cricket profile photo directly.
- knownTeams is for players who turn out for more than one club; helps disambiguate when the name is common.

CONFIDENCE MODEL — the tool returns one of three levels per candidate, and you must surface the level (not just the link):
- high — image is on the named player's own Play-Cricket profile, OR a portrait/profile photo on a public page is directly labelled with their name.
- medium — a public article or post names the player AND contains relevant match/team imagery, but the image itself isn't individually labelled. (Example: a match report names them as top scorer and shows photos from that match.)
- low — page mentions the player and club context, but image association is unclear or multiple players could plausibly match.

REPORTING RULES (when you write the captain back):
- Group candidates by player. Show confidence FIRST, then the source link, then a one-line reason.
- Surface up to ~5 candidates per player. ALWAYS include any HIGH/MEDIUM. If LOW candidates were also returned, list 2–3 of the most plausible ones with their warnings — the captain would rather see them with caveats than have them silently dropped.
- DO NOT claim a person is pictured unless the source clearly labels them.
- For medium / low results, include the warning that came back from the tool verbatim.
- Prefer pageUrl over imageUrl in your prose — the captain should land on the source page, not a raw image.
- Do not embed image galleries; one thumbnail per player at most is acceptable when the source clearly exposes a public image URL.

WORDING — use:
"possible public source", "recognition source", "candidate image", "candidate source", "not verified", "the source does not clearly label the player", "the page may contain a relevant photo".

WORDING — avoid:
"I identified this player", "this is definitely him", "face match", "profiled", "dossier", "surveillance", "I found his face".

FAILURE / DEGRADED STATES — handle each as follows:
- status="no-reliable-source": no candidates exist. Render the supplied message and STOP — there's nothing to surface.
- status="only-low-confidence": candidates exist but none cleared HIGH/MEDIUM. STILL LIST THEM. Render the supplied message, then list up to 5 candidates with their LOW labels and warnings — the captain would rather have unverified leads to chase than nothing at all. Do not promote LOW into stronger language.

If the captain asks for face recognition or identification from an uploaded image, do NOT call this tool. Reply:
"I can't identify a player from appearance or match a face to online images. I can help find public, labelled sources for named players instead — give me the player's name and club and I'll see what's out there."

PRIVACY GUARDRAILS (the tool enforces these; do not try to talk around them):
- Public sources only. No logged-in endpoints, no private accounts, no scraping behind paywalls or logins.
- Source URLs always present. Never claim a source without showing where it came from.
- No facial recognition, no appearance-based identity inference.
- No permanent storage or rehosting of images.
- Low-confidence results are never presented as verified.`;

export const recognitionSourcesInputSchema = z.object({
  playerName: z
    .string()
    .min(1)
    .describe(
      "Full name of the OPPOSITION player to look for. Match the spelling on Play-Cricket / scorecards.",
    ),
  clubName: z
    .string()
    .min(1)
    .describe("Opposition club name as it appears on Play-Cricket."),
  teamName: z
    .string()
    .optional()
    .describe(
      "Optional team within the club — '1st XI', '2nd XI', etc. Narrows when the same name plays for multiple sides.",
    ),
  playCricketPlayerId: z
    .string()
    .optional()
    .describe(
      "Play-Cricket player_id (a.k.a. member_id) if you already have it from a pc_* tool response. Lets the tool resolve a high-confidence profile photo directly.",
    ),
  playCricketProfileUrl: z
    .url()
    .optional()
    .describe(
      "Public Play-Cricket profile URL if known. Same effect as playCricketPlayerId.",
    ),
  knownTeams: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      "Other clubs/teams the same name has played for, when known. Helps disambiguate common names.",
    ),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(8)
    .describe(
      "Soft cap on candidates returned. Default 8 — enough for one player; bump for a 'recognition pack' of several players.",
    ),
});

export type RecognitionSourcesInput = z.infer<
  typeof recognitionSourcesInputSchema
>;

// Per-search-query cap; we fan out a small number of queries and then dedupe.
const PER_QUERY_MAX_RESULTS = 6;

export function buildSearchQueries(input: RecognitionSourcesInput): string[] {
  const name = input.playerName.trim();
  const club = input.clubName.trim();
  const queries: string[] = [
    `"${name}" "${club}" cricket`,
    `site:play-cricket.com "${name}" "${club}"`,
    `"${name}" "${club}" "match report"`,
  ];
  if (input.teamName) {
    queries.push(`"${name}" "${club}" "${input.teamName.trim()}"`);
  }
  if (input.playCricketProfileUrl) {
    // Asking the search engine for the profile URL anchors a high-confidence
    // hit when the page is indexed; we don't bypass search because the
    // page may not exist / may have moved.
    queries.push(input.playCricketProfileUrl);
  } else if (input.playCricketPlayerId) {
    queries.push(
      `site:play-cricket.com "${name}" ${input.playCricketPlayerId}`,
    );
  }
  return queries;
}

const PLAY_CRICKET_HOST = "play-cricket.com";
const PUBLIC_SOCIAL_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "linkedin.com",
  "www.linkedin.com",
]);
// Hostnames (NOT substring fragments) that classify as league or news
// sites. We match strictly: the URL's host must be exactly one of these,
// or a subdomain (label-boundary aware). Substring matches are unsafe —
// `evil-ntcl.co.uk` shouldn't be treated as the league.
const KNOWN_LEAGUE_HOSTS = ["ntcl.co.uk", "ecb.co.uk"];
const KNOWN_NEWS_HOSTS = [
  "bbc.co.uk",
  "bbc.com",
  "chroniclelive.co.uk",
  "journallive.co.uk",
  "thenorthernecho.co.uk",
  "thejournal.co.uk",
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Strict host suffix match — `host` is either exactly `domain` or ends with
 * `.domain` (a subdomain). Uses the label boundary so `evil-domain.com`
 * doesn't match `domain.com`. Prefer this over `host.endsWith(domain)`
 * everywhere we're trying to identify a trusted source.
 */
function hostMatches(host: string, domain: string): boolean {
  if (!host) return false;
  if (host === domain) return true;
  return host.endsWith(`.${domain}`);
}

function hostMatchesAny(
  host: string,
  domains: readonly string[],
): boolean {
  return domains.some((d) => hostMatches(host, d));
}

// Play-Cricket URL paths that carry a recognition-useful page (profile,
// team/squad, members). Scorecard / results pages are excluded — they're
// pure tables with no portraits. Keep these case-insensitive.
const PLAY_CRICKET_RECOGNITION_PATH = /\/(players?|profiles?|member|teams?)/i;
const PLAY_CRICKET_PHOTOLESS_PATH = /\/(results|matches|scorecards?)\//i;

export function isPhotolessUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!hostMatches(host, PLAY_CRICKET_HOST)) return false;
  return PLAY_CRICKET_PHOTOLESS_PATH.test(pathnameOf(url));
}

// Markers that strongly indicate the page Tavily extracted is a login wall
// rather than real content. FB / IG / LinkedIn all serve these UIs to
// unauthenticated requesters; the captain has to view the page in a browser
// where they're logged into the platform.
const LOGIN_WALL_MARKERS = [
  "log in",
  "forgot account",
  "forgot password",
  "create new account",
  "email or mobile number",
  "sign up to continue",
];

export function looksLikeLoginWall(content: string | undefined): boolean {
  if (!content) return false;
  const preview = content.toLowerCase().slice(0, 2000);
  let hits = 0;
  for (const m of LOGIN_WALL_MARKERS) {
    if (preview.includes(m)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

/** Pick a content slice around the first occurrence of any anchor string
 *  (typically the player or club name). When no anchor appears in the
 *  content, fall back to the first 500 chars — better than nothing. */
export function smartSnippet(
  content: string | undefined,
  anchors: string[],
  window = 250,
): string | undefined {
  if (!content) return undefined;
  const lower = content.toLowerCase();
  for (const anchor of anchors) {
    if (!anchor) continue;
    const idx = lower.indexOf(anchor.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - window);
      const end = Math.min(content.length, idx + anchor.length + window);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < content.length ? "…" : "";
      return prefix + content.slice(start, end).trim() + suffix;
    }
  }
  return content.slice(0, 500);
}

export function classifySourceType(
  url: string,
  clubName: string,
): z.infer<typeof recognitionSourceTypeSchema> {
  const host = hostnameOf(url);
  const path = pathnameOf(url);
  if (hostMatches(host, PLAY_CRICKET_HOST)) {
    return "play-cricket-profile";
  }
  if (PUBLIC_SOCIAL_HOSTS.has(host)) {
    return "public-social-post";
  }
  if (hostMatchesAny(host, KNOWN_LEAGUE_HOSTS)) {
    return "league-site";
  }
  if (hostMatchesAny(host, KNOWN_NEWS_HOSTS)) {
    return "local-news";
  }
  // Heuristic: domain or path mentions the club's name (slugged) → club website.
  const slug = clubName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (slug.length > 3 && (host.includes(slug) || path.includes(slug))) {
    return "club-website";
  }
  return "other";
}

/**
 * "Club-owned social" = a Facebook group/page (or other social profile)
 * that IS the club itself, as opposed to a third-party post that
 * incidentally mentions the club. Two structural signals:
 *  - Facebook /groups/ or /pages/ paths are organizational by design.
 *  - The page title contains the club name (allowing CC ↔ Cricket Club).
 * Combined, those almost always identify the club's own page. A captain
 * landing on the club's own social can browse its public photo album.
 */
export function isClubOwnedSocial(
  url: string,
  title: string | undefined,
  clubName: string,
): boolean {
  const host = hostnameOf(url);
  const path = pathnameOf(url);
  const slug = clubName.toLowerCase().replace(/[^a-z0-9]+/g, "");

  const isFbStructural =
    (host === "www.facebook.com" ||
      host === "facebook.com" ||
      host === "m.facebook.com") &&
    /^\/(groups|pages)\//.test(path);
  if (isFbStructural) return clubAppearsInText(clubName, title);

  // Other public socials: rely on the URL handle matching the club slug
  // (instagram.com/<handle>, twitter.com/<handle>, etc.).
  if (PUBLIC_SOCIAL_HOSTS.has(host) && slug.length > 3) {
    return path.toLowerCase().includes(slug);
  }
  return false;
}

function tokeniseName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.replace(/[^a-z0-9'-]/g, ""))
    .filter((s) => s.length > 1);
}

function nameAppearsInText(name: string, text: string | undefined): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  if (haystack.includes(name.toLowerCase())) return true;
  // Fallback: at least 2 of the player's name tokens appear (handles "J. Smith" vs "James Smith").
  const tokens = tokeniseName(name);
  if (tokens.length < 2) return false;
  const hits = tokens.filter((t) => haystack.includes(t));
  return hits.length >= 2;
}

function clubAppearsInText(club: string, text: string | undefined): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  if (haystack.includes(club.toLowerCase())) return true;
  // Strip a trailing "CC" / "Cricket Club" and try again — match-report copy often omits the suffix.
  const stripped = club
    .toLowerCase()
    .replace(/\bcricket club\b/g, "")
    .replace(/\bcc\b/g, "")
    .trim();
  return stripped.length > 0 && haystack.includes(stripped);
}

export interface ScoringInput {
  hit: RecognitionSourcesSearchHit;
  extracted?: RecognitionSourcesExtractedPage;
  sourceType: z.infer<typeof recognitionSourceTypeSchema>;
  playerName: string;
  clubName: string;
}

export interface ScoredCandidate {
  confidence: z.infer<typeof recognitionConfidenceSchema>;
  reasons: string[];
  warnings: string[];
  /** Best image URL from the extracted page, if any. */
  imageUrl?: string;
}

/** Lightweight proximity check: do the player and club tokens co-occur within
 *  `window` characters of each other in the body? Used to discriminate
 *  "page IS about this player at this club" from "page mentions them both
 *  in unrelated paragraphs". */
function namedTogether(
  name: string,
  club: string,
  body: string,
  window = 240,
): boolean {
  const haystack = body.toLowerCase();
  const nameIdx = haystack.indexOf(name.toLowerCase());
  if (nameIdx < 0) return false;
  const clubLower = club.toLowerCase();
  const stripped = clubLower
    .replace(/\bcricket club\b/g, "")
    .replace(/\bcc\b/g, "")
    .trim();
  const idxs = [haystack.indexOf(clubLower)];
  if (stripped.length > 0) idxs.push(haystack.indexOf(stripped));
  return idxs.some((i) => i >= 0 && Math.abs(i - nameIdx) <= window);
}

export function scoreCandidate(input: ScoringInput): ScoredCandidate {
  const { hit, extracted, sourceType, playerName, clubName } = input;
  // Treat the extracted page content (when present) as the primary haystack;
  // fall back to the search snippet otherwise. Cap to keep proximity checks
  // affordable on big pages.
  const body = (extracted?.content ?? hit.snippet ?? "").slice(0, 8000);
  const images = extracted?.images ?? [];
  const firstImage = images[0];

  const titleHasName = nameAppearsInText(playerName, hit.title);
  const titleHasClub = clubAppearsInText(clubName, hit.title);
  const bodyHasName = nameAppearsInText(playerName, body);
  const bodyHasClub = clubAppearsInText(clubName, body);
  const path = pathnameOf(hit.url);
  const playerClubClose = namedTogether(playerName, clubName, body);
  const clubOwned = isClubOwnedSocial(hit.url, hit.title, clubName);

  // HIGH — Play-Cricket profile/team/squad page that names the player.
  const isPlayCricketRecognitionPage =
    sourceType === "play-cricket-profile" &&
    PLAY_CRICKET_RECOGNITION_PATH.test(path);
  if (isPlayCricketRecognitionPage && (titleHasName || bodyHasName)) {
    return {
      confidence: "high",
      reasons: [
        "Play-Cricket profile / squad page that names the player — typically carries a labelled portrait.",
      ],
      warnings: [],
      imageUrl: firstImage,
    };
  }

  // HIGH — club's own public social page/group that names the player.
  if (clubOwned && (titleHasName || bodyHasName)) {
    const hasImages = images.length > 0;
    return {
      confidence: "high",
      reasons: [
        hasImages
          ? "Source is the club's own public social page/group; the player is named in a post and the page exposes photos to browse."
          : "Source is the club's own public social page/group and names the player in a post.",
      ],
      warnings: hasImages
        ? []
        : [
            "Photos sit on the page but aren't individually labelled with the player's name.",
          ],
      imageUrl: firstImage,
    };
  }

  // HIGH — title directly labels a portrait/profile-style page with the player's name AND club.
  if (titleHasName && titleHasClub && sourceType !== "public-social-post") {
    return {
      confidence: "high",
      reasons: ["Source page title names the player and the club directly."],
      warnings: [],
      imageUrl: firstImage,
    };
  }

  // MEDIUM — page text names the player AND club close together (proximity-checked).
  if (playerClubClose) {
    return {
      confidence: "medium",
      reasons: [
        "Page names the player and the club together in context, but the image itself isn't individually labelled.",
      ],
      warnings: [
        "Not verified — the source does not clearly label any single photo with the player's name.",
      ],
      imageUrl: firstImage,
    };
  }

  // MEDIUM (fallback) — both appear on the page but not close. Useful for
  // long club pages where the squad list and post bodies live apart.
  if ((titleHasName || bodyHasName) && (titleHasClub || bodyHasClub)) {
    return {
      confidence: "medium",
      reasons: [
        "Page mentions both the player and the club, but in separate sections.",
      ],
      warnings: [
        "Not verified — the source does not clearly label any single photo with the player's name.",
      ],
      imageUrl: firstImage,
    };
  }

  // LOW — only one of player/club mentioned (or only loose match).
  return {
    confidence: "low",
    reasons: [
      titleHasName || bodyHasName
        ? "Page mentions the player, but the club context is unclear or multiple players could match."
        : titleHasClub || bodyHasClub
          ? "Page mentions the club but does not clearly name this player."
          : "Page matched the search query loosely — neither player nor club appears clearly in the page content.",
    ],
    warnings: ["Treat this as an unverified recognition source only."],
    imageUrl: firstImage,
  };
}

const CONFIDENCE_RANK: Record<
  z.infer<typeof recognitionConfidenceSchema>,
  number
> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function createRecognitionSourcesTool(deps: RecognitionSourcesToolDeps) {
  return {
    find_player_photo_sources: tool({
      description: TOOL_DESCRIPTION,
      inputSchema: recognitionSourcesInputSchema,
      execute: async (input): Promise<RecognitionSourcesResult> => {
        const TOOL = "find_player_photo_sources";
        const log = deps.logger;
        log?.info(
          {
            tool: TOOL,
            playerName: input.playerName,
            clubName: input.clubName,
            teamName: input.teamName,
            hasProfileUrl: Boolean(input.playCricketProfileUrl),
            hasPlayerId: Boolean(input.playCricketPlayerId),
            maxResults: input.maxResults,
          },
          "scout recognition: starting",
        );

        const queries = buildSearchQueries(input);
        log?.debug(
          { tool: TOOL, queryCount: queries.length },
          "scout recognition: fan-out",
        );

        const hitGroups = await Promise.all(
          queries.map((q) =>
            deps.search.search(q, { maxResults: PER_QUERY_MAX_RESULTS }).then(
              (hits) => {
                log?.debug(
                  { tool: TOOL, query: q, hits: hits.length },
                  "scout recognition: query ok",
                );
                return hits;
              },
              (err: unknown) => {
                log?.warn(
                  { tool: TOOL, query: q, err: describeError(err) },
                  "scout recognition: query failed",
                );
                return [] as RecognitionSourcesSearchHit[];
              },
            ),
          ),
        );

        // Dedup by URL and drop known-photo-less paths (Play-Cricket
        // scorecards, etc.) before paying for content extraction.
        const byUrl = new Map<string, RecognitionSourcesSearchHit>();
        let droppedPhotoLess = 0;
        for (const group of hitGroups) {
          for (const hit of group) {
            if (isPhotolessUrl(hit.url)) {
              droppedPhotoLess++;
              continue;
            }
            if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit);
          }
        }
        log?.debug(
          {
            tool: TOOL,
            rawHits: hitGroups.reduce((n, g) => n + g.length, 0),
            dedupedUrls: byUrl.size,
            droppedPhotoLess,
          },
          "scout recognition: dedup",
        );

        // Extract page content + images for the top candidates so scoring
        // sees what's actually on the page, not just the search snippet.
        // We extract more than maxResults so we have headroom to drop weak
        // hits after re-scoring. Tavily caps a single extract batch at 20.
        const extractBudget = Math.min(20, Math.max(input.maxResults + 4, 8));
        const urlsToExtract = Array.from(byUrl.keys()).slice(0, extractBudget);
        let extractedByUrl = new Map<string, RecognitionSourcesExtractedPage>();
        try {
          const pages = await deps.search.extract(urlsToExtract);
          extractedByUrl = new Map(pages.map((p) => [p.url, p]));
          log?.debug(
            {
              tool: TOOL,
              requested: urlsToExtract.length,
              extracted: pages.length,
              withImages: pages.filter((p) => (p.images?.length ?? 0) > 0)
                .length,
            },
            "scout recognition: extract ok",
          );
        } catch (err) {
          // Extract is best-effort. If it fails wholesale we still score
          // against search snippets — the result will just be weaker.
          log?.warn(
            {
              tool: TOOL,
              requested: urlsToExtract.length,
              err: describeError(err),
            },
            "scout recognition: extract failed",
          );
        }

        const candidates: PlayerPhotoSourceCandidate[] = [];
        let loginWalled = 0;
        for (const hit of byUrl.values()) {
          const sourceType = classifySourceType(hit.url, input.clubName);
          const extracted = extractedByUrl.get(hit.url);
          const walled = looksLikeLoginWall(extracted?.content);
          if (walled) loginWalled++;

          const scored = scoreCandidate({
            hit,
            extracted,
            sourceType,
            playerName: input.playerName,
            clubName: input.clubName,
          });

          // Pick a snippet centred on the player/club name when the
          // extracted content contains them — far more useful than the
          // first 500 chars when the page leads with chrome / nav / login
          // boilerplate.
          const richSnippet =
            extracted?.content && extracted.content.length > 0
              ? smartSnippet(extracted.content, [
                  input.playerName,
                  input.clubName,
                ])
              : hit.snippet?.slice(0, 500);

          // Login-wall extractions still carry useful signals (image URLs,
          // page metadata in the title) so we keep the candidate, but we
          // add an explicit warning so the captain knows the prose summary
          // can't show what the page actually contains.
          const warnings = [...scored.warnings];
          if (walled) {
            warnings.push(
              "This page sits behind a login wall — open it in a browser where you're signed into the platform to see the post and any photos.",
            );
          }

          candidates.push({
            playerName: input.playerName,
            pageUrl: hit.url,
            imageUrl: scored.imageUrl,
            sourceTitle: hit.title || undefined,
            sourceType,
            date: hit.publishedAt,
            contextSnippet: richSnippet,
            confidence: scored.confidence,
            reasons: scored.reasons,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
        }
        if (loginWalled > 0) {
          log?.info(
            { tool: TOOL, loginWalled },
            "scout recognition: candidates behind login walls",
          );
        }

        candidates.sort(
          (a, b) =>
            CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence],
        );
        const top = candidates.slice(0, input.maxResults);

        // Face detection pass — fire after sort/slice so we only spend
        // Rekognition + S3 on candidates the agent will actually surface.
        //
        // Tri-state semantics from FaceDetector.detectAndCrop:
        //   FaceCrop[] non-empty → attach faces to candidate, keep
        //   []                   → definitive zero; candidate's imageUrl
        //                          is a logo / banner / non-photo. DROP
        //                          (mark in droppedUrls). The pageUrl
        //                          stays useful but the imageUrl doesn't,
        //                          so the candidate has no recognition
        //                          value left.
        //   null                 → couldn't tell (detector latched off /
        //                          fetch failed / Rekognition errored).
        //                          KEEP the candidate as-is — leaving it
        //                          to the agent / render_image fallback.
        //
        // Candidates with NO imageUrl at all are page-only leads — always
        // keep, never run face detection on them.
        let topAfterFaces = top;
        if (deps.faceDetector) {
          const detector = deps.faceDetector;
          const droppedUrls = new Set<string>();
          await Promise.all(
            top.map(async (candidate) => {
              if (!candidate.imageUrl) return;
              const result = await detector
                .detectAndCrop(candidate.imageUrl)
                .catch(() => null);
              if (result === null) return;
              if (result.length === 0) {
                droppedUrls.add(candidate.pageUrl);
                return;
              }
              candidate.faces = result;
            }),
          );
          topAfterFaces = top.filter((c) => !droppedUrls.has(c.pageUrl));
          const totalFaces = topAfterFaces.reduce(
            (n, c) => n + (c.faces?.length ?? 0),
            0,
          );
          log?.info(
            {
              tool: TOOL,
              candidatesWithFaces: topAfterFaces.filter(
                (c) => (c.faces?.length ?? 0) > 0,
              ).length,
              droppedNoFaces: droppedUrls.size,
              totalFaces,
            },
            "scout recognition: face detection complete",
          );
        }

        const finalCandidates = topAfterFaces;
        const byConfidence = {
          high: finalCandidates.filter((c) => c.confidence === "high").length,
          medium: finalCandidates.filter((c) => c.confidence === "medium")
            .length,
          low: finalCandidates.filter((c) => c.confidence === "low").length,
        };

        if (finalCandidates.length === 0) {
          log?.info(
            { tool: TOOL, status: "no-reliable-source", byConfidence },
            "scout recognition: done",
          );
          return {
            status: "no-reliable-source",
            message:
              "No reliable public photo source found. I found some pages mentioning the player, but none clearly associated them with an image.",
          };
        }
        const hasHighOrMedium = byConfidence.high + byConfidence.medium > 0;
        if (!hasHighOrMedium) {
          log?.info(
            { tool: TOOL, status: "only-low-confidence", byConfidence },
            "scout recognition: done",
          );
          return {
            status: "only-low-confidence",
            candidates: finalCandidates,
            message:
              "Only low-confidence matches found. Listing them anyway — none clearly label the player in an image, so each is worth a look but treat as unverified.",
          };
        }
        log?.info(
          { tool: TOOL, status: "ok", byConfidence },
          "scout recognition: done",
        );
        return { status: "ok", candidates: finalCandidates };
      },
    }),
  };
}

export type RecognitionSourcesTools = ReturnType<
  typeof createRecognitionSourcesTool
>;
