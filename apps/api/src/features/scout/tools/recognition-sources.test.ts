import { describe, expect, it, vi } from "vitest";
import type { FaceDetector } from "./face-detection.ts";
import {
  buildSearchQueries,
  classifySourceType,
  createRecognitionSourcesTool,
  isClubOwnedSocial,
  isPhotolessUrl,
  looksLikeLoginWall,
  scoreCandidate,
  smartSnippet,
  type RecognitionSourcesExtractedPage,
  type RecognitionSourcesResult,
  type RecognitionSourcesSearchHit,
  type RecognitionWebSearchClient,
} from "./recognition-sources.ts";

const opts = {
  toolCallId: "test-call",
  messages: [],
  abortSignal: undefined,
} as unknown as Parameters<
  NonNullable<
    ReturnType<
      typeof createRecognitionSourcesTool
    >["find_player_photo_sources"]["execute"]
  >
>[1];

function makeSearch(
  responses: Record<string, RecognitionSourcesSearchHit[]>,
  extracted: RecognitionSourcesExtractedPage[] = [],
): RecognitionWebSearchClient {
  const byUrl = new Map(extracted.map((p) => [p.url, p]));
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async search(query) {
      return responses[query] ?? [];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async extract(urls) {
      return urls
        .map((u) => byUrl.get(u))
        .filter((p): p is RecognitionSourcesExtractedPage => Boolean(p));
    },
  };
}

function makeSearchAll(
  hits: RecognitionSourcesSearchHit[],
  extracted: RecognitionSourcesExtractedPage[] = [],
): RecognitionWebSearchClient {
  const byUrl = new Map(extracted.map((p) => [p.url, p]));
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async search() {
      return hits;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async extract(urls) {
      return urls
        .map((u) => byUrl.get(u))
        .filter((p): p is RecognitionSourcesExtractedPage => Boolean(p));
    },
  };
}

describe("buildSearchQueries", () => {
  it("emits a stable core set of queries with name+club quoted", () => {
    const queries = buildSearchQueries({
      playerName: "Ravi Patel",
      clubName: "Backworth CC",
      maxResults: 8,
    });
    expect(queries).toContain('"Ravi Patel" "Backworth CC" cricket');
    expect(queries).toContain(
      'site:play-cricket.com "Ravi Patel" "Backworth CC"',
    );
    expect(queries).toContain('"Ravi Patel" "Backworth CC" "match report"');
  });

  it("appends a team-narrowing query when teamName is given", () => {
    const queries = buildSearchQueries({
      playerName: "Dan Smith",
      clubName: "Tynemouth",
      teamName: "1st XI",
      maxResults: 8,
    });
    expect(queries).toContain('"Dan Smith" "Tynemouth" "1st XI"');
  });

  it("uses a profile URL directly when provided", () => {
    const queries = buildSearchQueries({
      playerName: "Liam Brown",
      clubName: "Morpeth",
      playCricketProfileUrl:
        "https://morpeth.play-cricket.com/website/players/123",
      maxResults: 8,
    });
    expect(queries).toContain(
      "https://morpeth.play-cricket.com/website/players/123",
    );
  });

  it("falls back to id-anchored search when no URL is supplied", () => {
    const queries = buildSearchQueries({
      playerName: "Liam Brown",
      clubName: "Morpeth",
      playCricketPlayerId: "12345",
      maxResults: 8,
    });
    expect(queries).toContain('site:play-cricket.com "Liam Brown" 12345');
  });
});

describe("classifySourceType", () => {
  it("classifies Play-Cricket subdomains as play-cricket-profile", () => {
    expect(
      classifySourceType(
        "https://percymain.play-cricket.com/website/players/678",
        "Percy Main",
      ),
    ).toBe("play-cricket-profile");
  });

  it("classifies common public socials as public-social-post", () => {
    expect(
      classifySourceType("https://www.facebook.com/cricketclub/posts/123", "X"),
    ).toBe("public-social-post");
    expect(
      classifySourceType("https://twitter.com/PercyMainCC/status/1", "X"),
    ).toBe("public-social-post");
    expect(classifySourceType("https://x.com/PercyMainCC", "X")).toBe(
      "public-social-post",
    );
  });

  it("classifies known league host fragments as league-site", () => {
    expect(classifySourceType("https://www.ntcl.co.uk/division/4", "X")).toBe(
      "league-site",
    );
  });

  it("classifies club-name slug matches as club-website", () => {
    expect(
      classifySourceType(
        "https://percymaincc.co.uk/team/1stxi",
        "Percy Main CC",
      ),
    ).toBe("club-website");
  });

  it("falls back to other when no rule fires", () => {
    expect(
      classifySourceType("https://somerandomblog.example/cricket", "Backworth"),
    ).toBe("other");
  });

  it("does NOT classify look-alike domains as trusted (label-boundary match)", () => {
    // CodeQL "Incomplete URL substring sanitization" — `host.endsWith` would
    // wrongly accept these; the strict label-boundary check rejects them.
    expect(
      classifySourceType(
        "https://evilplay-cricket.com/website/players/1",
        "Percy Main",
      ),
    ).not.toBe("play-cricket-profile");
    expect(
      classifySourceType("https://attacker-ntcl.co.uk/division/4", "X"),
    ).not.toBe("league-site");
    expect(
      classifySourceType("https://fake-bbc.co.uk/sport/cricket", "X"),
    ).not.toBe("local-news");
  });

  it("Play-Cricket recognition path requires a segment boundary (not /player_stats)", () => {
    // /player_stats/... is the season-stats page, NOT a profile page.
    // Without the segment boundary on PLAY_CRICKET_RECOGNITION_PATH this
    // would have scored as a profile-style hit. Confirm it doesn't.
    expect(
      scoreCandidate({
        hit: {
          url: "https://percymain.play-cricket.com/player_stats/batting/12345",
          title: "Stats page",
          snippet: "",
        },
        sourceType: "play-cricket-profile",
        playerName: "Some Player",
        clubName: "Some CC",
      }).confidence,
    ).not.toBe("high");
  });

  it("DOES classify legitimate subdomains as trusted", () => {
    expect(
      classifySourceType(
        "https://percymain.play-cricket.com/website/players/1",
        "Percy Main",
      ),
    ).toBe("play-cricket-profile");
    expect(classifySourceType("https://www.ntcl.co.uk/div/4", "X")).toBe(
      "league-site",
    );
  });
});

describe("isPhotolessUrl", () => {
  it("drops Play-Cricket scorecard URLs", () => {
    expect(
      isPhotolessUrl("https://www.play-cricket.com/website/results/5627546"),
    ).toBe(true);
    expect(
      isPhotolessUrl(
        "https://www.play-cricket.com/website/results/3527407/print",
      ),
    ).toBe(true);
  });

  it("keeps Play-Cricket team and profile pages", () => {
    expect(
      isPhotolessUrl("https://rocknorthumberland.play-cricket.com/Teams/95668"),
    ).toBe(false);
    expect(
      isPhotolessUrl("https://percymain.play-cricket.com/website/players/678"),
    ).toBe(false);
  });

  it("ignores non-Play-Cricket hosts", () => {
    expect(isPhotolessUrl("https://example.com/results/123")).toBe(false);
  });
});

describe("looksLikeLoginWall", () => {
  it("detects Facebook login-wall content", () => {
    const wall = `# Rock Cricket Club | Facebook
[Log In](https://www.facebook.com/login/...)
Log In
[Forgot Account?](https://www.facebook.com/recover/...)
Email or mobile number`;
    expect(looksLikeLoginWall(wall)).toBe(true);
  });

  it("does not falsely flag genuine content that mentions 'log in' once", () => {
    const real = "Match recap from the club's public group: 3-11 from Parky.";
    expect(looksLikeLoginWall(real)).toBe(false);
  });

  it("handles undefined / empty content", () => {
    expect(looksLikeLoginWall(undefined)).toBe(false);
    expect(looksLikeLoginWall("")).toBe(false);
  });
});

describe("smartSnippet", () => {
  it("centres the slice on the first occurrence of an anchor", () => {
    const content =
      "Page chrome and nav... " +
      "lots of boilerplate ".repeat(40) +
      "Thomas Parkinson bowled a beauty to dismiss the opener — top spell." +
      " more chrome ".repeat(40);
    const out = smartSnippet(content, ["Thomas Parkinson"]);
    expect(out).toContain("Thomas Parkinson bowled");
    expect(out?.startsWith("…")).toBe(true);
    expect(out?.endsWith("…")).toBe(true);
  });

  it("falls back to first 500 chars when no anchor appears", () => {
    const content = "Just chrome and nav, nothing about the player here.";
    const out = smartSnippet(content, ["Someone Else"]);
    expect(out).toBe(content);
  });

  it("returns undefined for empty/undefined input", () => {
    expect(smartSnippet(undefined, ["x"])).toBeUndefined();
    expect(smartSnippet("", ["x"])).toBeUndefined();
  });
});

describe("isClubOwnedSocial", () => {
  it("treats a club-titled Facebook group as club-owned", () => {
    expect(
      isClubOwnedSocial(
        "https://www.facebook.com/groups/174184335514/posts/12345/",
        "Rock Cricket Club - Facebook",
        "Rock CC",
      ),
    ).toBe(true);
  });

  it("does not treat a third-party post mentioning the club as club-owned", () => {
    expect(
      isClubOwnedSocial(
        "https://www.facebook.com/some.user/posts/12345",
        "Saturday derby — Rock CC played well",
        "Rock CC",
      ),
    ).toBe(false);
  });

  it("recognises a club-slugged social handle as club-owned", () => {
    expect(
      isClubOwnedSocial(
        "https://twitter.com/percymaincc",
        "Percy Main CC (@percymaincc)",
        "Percy Main CC",
      ),
    ).toBe(true);
  });
});

describe("scoreCandidate", () => {
  const baseHit = (overrides: Partial<RecognitionSourcesSearchHit> = {}) => ({
    url: "https://example.com/",
    title: "",
    snippet: "",
    ...overrides,
  });

  it("scores a Play-Cricket profile page that names the player as high", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://percymain.play-cricket.com/website/players/678",
        title: "Ravi Patel — Player Profile",
      }),
      sourceType: "play-cricket-profile",
      playerName: "Ravi Patel",
      clubName: "Percy Main",
    });
    expect(result.confidence).toBe("high");
    expect(result.warnings).toEqual([]);
  });

  it("scores a club-site title that names player+club as high", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://backworthcc.co.uk/squad/dan-smith",
        title: "Dan Smith — Backworth CC 1st XI",
      }),
      sourceType: "club-website",
      playerName: "Dan Smith",
      clubName: "Backworth CC",
    });
    expect(result.confidence).toBe("high");
  });

  it("scores a match report naming player+club as medium with a warning", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://chroniclelive.co.uk/sport/cricket/dan-smith-stars",
        title: "Backworth claim derby spoils",
        snippet:
          "Dan Smith led Backworth CC with 76, anchoring the chase against Percy Main.",
      }),
      sourceType: "local-news",
      playerName: "Dan Smith",
      clubName: "Backworth CC",
    });
    expect(result.confidence).toBe("medium");
    expect(result.warnings).not.toEqual([]);
  });

  it("scores a vague match-club mention without player as low", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://example.com/post/123",
        title: "Backworth CC photos from Saturday",
        snippet: "Some photos from the weekend.",
      }),
      sourceType: "other",
      playerName: "Mark Jones",
      clubName: "Backworth CC",
    });
    expect(result.confidence).toBe("low");
    expect(result.warnings).not.toEqual([]);
  });

  it("scores initials-only mentions as low (won't credit ambiguous surname-only hits)", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://backworthcc.co.uk/news/match-report",
        title: "Match Report",
        snippet:
          "J. Smith top-scored for Backworth CC with 54 in their win over Tynemouth.",
      }),
      sourceType: "club-website",
      playerName: "James Smith",
      clubName: "Backworth CC",
    });
    // Deliberately conservative — "J. Smith" + surname alone could be Jamie / Joe / James
    // Smith. We require ≥2 of the supplied name's tokens to credit player presence,
    // so this scores low and carries a warning.
    expect(result.confidence).toBe("low");
    expect(result.warnings).not.toEqual([]);
  });

  it("credits full-name snippet matches as medium when the title doesn't label", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://backworthcc.co.uk/news/match-report",
        title: "Match Report",
        snippet:
          "James Smith top-scored for Backworth CC with 54 in their win over Tynemouth.",
      }),
      sourceType: "club-website",
      playerName: "James Smith",
      clubName: "Backworth CC",
    });
    // HIGH requires a labelled portrait or a title that names both player+club —
    // a snippet-only match is "named in context, image unlabelled" = medium.
    expect(result.confidence).toBe("medium");
  });

  it("scores a club-owned Facebook group that names the player as high", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://www.facebook.com/groups/174184335514/posts/10173898929480515/",
        title: "Rock Cricket Club - Facebook",
        snippet:
          "Thomas Parkinson (now edging ever closer to that 400-wicket milestone)",
      }),
      extracted: {
        url: "https://www.facebook.com/groups/174184335514/posts/10173898929480515/",
        content:
          "Match report: Thomas Parkinson took 3-11 for Rock CC against Mitford...",
        images: ["https://scontent.fakecdn.com/photo1.jpg"],
      },
      sourceType: "public-social-post",
      playerName: "Thomas Parkinson",
      clubName: "Rock CC",
    });
    expect(result.confidence).toBe("high");
    expect(result.imageUrl).toContain("photo1.jpg");
    expect(result.warnings).toEqual([]);
  });

  it("uses extracted content to find the player when the search snippet missed them", () => {
    const result = scoreCandidate({
      hit: baseHit({
        url: "https://rocknorthumberland.play-cricket.com/Teams/95668",
        title: "1st XI - Rock CC, Northumberland - Play-Cricket",
        snippet: "League standings and recent results...",
      }),
      extracted: {
        url: "https://rocknorthumberland.play-cricket.com/Teams/95668",
        content:
          "Squad: Joe Ferry, Thomas Parkinson, Daniel Hodgson, George Cockayne...",
        images: ["https://play-cricket.com/photo-tp.jpg"],
      },
      sourceType: "play-cricket-profile",
      playerName: "Thomas Parkinson",
      clubName: "Rock CC",
    });
    expect(result.confidence).toBe("high");
  });
});

describe("find_player_photo_sources execute", () => {
  it("returns ok with sorted candidates when at least one is high/medium", async () => {
    const search = makeSearchAll([
      {
        url: "https://percymain.play-cricket.com/website/players/678",
        title: "Ravi Patel — Player Profile",
      },
      {
        url: "https://example.com/some-other",
        title: "Unrelated cricket page",
      },
    ]);
    const tools = createRecognitionSourcesTool({ search });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Ravi Patel",
        clubName: "Percy Main",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.candidates[0].confidence).toBe("high");
      expect(result.candidates[0].pageUrl).toContain("play-cricket.com");
    }
  });

  it("returns only-low-confidence WITH candidates when every candidate scores low", async () => {
    const search = makeSearchAll([
      {
        url: "https://example.com/post/123",
        title: "Photos from Saturday",
        snippet: "Some photos from the weekend.",
      },
      {
        url: "https://example.com/post/456",
        title: "Another photo dump",
        snippet: "More photos.",
      },
    ]);
    const tools = createRecognitionSourcesTool({ search });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Mark Jones",
        clubName: "Backworth CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    expect(result.status).toBe("only-low-confidence");
    // Critical: low-confidence candidates are still surfaced — the captain
    // would rather have unverified leads than nothing.
    if (result.status !== "only-low-confidence") return;
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.confidence === "low")).toBe(true);
  });

  it("returns no-reliable-source when search yields nothing", async () => {
    const search = makeSearchAll([]);
    const tools = createRecognitionSourcesTool({ search });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Nobody",
        clubName: "Nowhere CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    expect(result.status).toBe("no-reliable-source");
  });

  it("dedupes identical URLs across queries", async () => {
    const sharedHit: RecognitionSourcesSearchHit = {
      url: "https://percymain.play-cricket.com/website/players/678",
      title: "Ravi Patel",
    };
    const search = makeSearch({
      '"Ravi Patel" "Percy Main" cricket': [sharedHit],
      'site:play-cricket.com "Ravi Patel" "Percy Main"': [sharedHit],
      '"Ravi Patel" "Percy Main" "match report"': [sharedHit],
    });
    const tools = createRecognitionSourcesTool({ search });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Ravi Patel",
        clubName: "Percy Main",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(1);
  });

  it("logs the fan-out, dedup, extract, and final summary; records per-query errors", async () => {
    interface LogEntry {
      level: string;
      obj: Record<string, unknown>;
      msg: string;
    }
    const entries: LogEntry[] = [];
    const stub =
      (level: string) => (obj: Record<string, unknown>, msg: string) => {
        entries.push({ level, obj, msg });
      };
    const logger = {
      info: stub("info"),
      debug: stub("debug"),
      warn: stub("warn"),
      error: stub("error"),
      trace: stub("trace"),
      fatal: stub("fatal"),
      // child / level / silent satisfy the FastifyBaseLogger contract — unused.
      child: () => logger,
      level: "info",
      silent: () => undefined,
    } as unknown as Parameters<
      typeof createRecognitionSourcesTool
    >[0]["logger"];

    // One query succeeds, one throws — both should be logged.
    let callIndex = 0;
    const search: Parameters<typeof createRecognitionSourcesTool>[0]["search"] =
      {
        // eslint-disable-next-line @typescript-eslint/require-await
        async search() {
          const i = callIndex++;
          if (i === 0) {
            return [
              {
                url: "https://www.facebook.com/groups/123/posts/abc/",
                title: "Some CC - Facebook",
                snippet: "...",
              },
            ];
          }
          if (i === 1) throw new Error("network blew up");
          return [];
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async extract(urls) {
          return urls.map((u) => ({ url: u, content: "", images: [] }));
        },
      };

    const tools = createRecognitionSourcesTool({ search, logger });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 5,
      },
      opts,
    );

    // Start log
    expect(
      entries.find(
        (e) => e.msg === "scout recognition: starting" && e.level === "info",
      ),
    ).toBeTruthy();
    // Per-query error log carries the error details
    const queryFailed = entries.find(
      (e) => e.msg === "scout recognition: query failed",
    );
    expect(queryFailed?.level).toBe("warn");
    expect(queryFailed?.obj.err).toMatchObject({ message: "network blew up" });
    // Final summary includes status + byConfidence breakdown
    const done = entries.find((e) => e.msg === "scout recognition: done");
    expect(done).toBeTruthy();
    expect(done?.obj.byConfidence).toBeDefined();
  });

  it("logs an extract failure at warn without throwing", async () => {
    interface LogEntry {
      level: string;
      obj: Record<string, unknown>;
      msg: string;
    }
    const entries: LogEntry[] = [];
    const stub =
      (level: string) => (obj: Record<string, unknown>, msg: string) => {
        entries.push({ level, obj, msg });
      };
    const logger = {
      info: stub("info"),
      debug: stub("debug"),
      warn: stub("warn"),
      error: stub("error"),
      trace: stub("trace"),
      fatal: stub("fatal"),
      child: () => logger,
      level: "info",
      silent: () => undefined,
    } as unknown as Parameters<
      typeof createRecognitionSourcesTool
    >[0]["logger"];

    const search: Parameters<typeof createRecognitionSourcesTool>[0]["search"] =
      {
        // eslint-disable-next-line @typescript-eslint/require-await
        async search() {
          return [
            {
              url: "https://www.example.com/page",
              title: "Some CC page",
              snippet: "Some Player content",
            },
          ];
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async extract() {
          throw new Error("extract API down");
        },
      };

    const tools = createRecognitionSourcesTool({ search, logger });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 5,
      },
      opts,
    )) as RecognitionSourcesResult;
    // Should NOT throw — extract failure degrades gracefully.
    expect(result).toBeDefined();
    const extractFailed = entries.find(
      (e) => e.msg === "scout recognition: extract failed",
    );
    expect(extractFailed?.level).toBe("warn");
    expect(extractFailed?.obj.err).toMatchObject({
      message: "extract API down",
    });
  });

  it("attaches a login-wall warning + name-anchored snippet to walled FB candidates", async () => {
    // Tavily returns useful metadata (imageUrl) but the extracted content
    // is just the FB login UI. The candidate should still surface, with an
    // explicit warning that the captain has to view the page themselves.
    // The snippet should NOT be the login-wall boilerplate — it should be
    // sliced around the player or club name when they appear deeper in the
    // extracted text.
    const url = "https://www.facebook.com/groups/174184335514/posts/abc/";
    const loginWallContent =
      `# Rock Cricket Club | Facebook
[Log In](https://www.facebook.com/login/device-based/regular/login/)
Log In
[Forgot Account?](https://www.facebook.com/recover/initiate)
Email or mobile number ` +
      `nav chrome `.repeat(60) +
      `Match recap: Thomas Parkinson took 3-11 against Mitford for Rock CC.` +
      ` more chrome `.repeat(60);

    const search = makeSearchAll(
      [
        {
          url,
          title: "Rock Cricket Club - Facebook",
          snippet: "Thomas Parkinson (now edging ever closer to 400 wickets)",
        },
      ],
      [
        {
          url,
          content: loginWallContent,
          images: ["https://scontent.fb.com/photo1.jpg"],
        },
      ],
    );
    const tools = createRecognitionSourcesTool({ search });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Thomas Parkinson",
        clubName: "Rock CC",
        maxResults: 5,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");
    const candidate = result.candidates[0];
    // Login-wall warning surfaced
    expect(candidate.warnings?.some((w) => w.includes("login wall"))).toBe(
      true,
    );
    // Snippet is the player-anchored slice, not the login-wall boilerplate
    expect(candidate.contextSnippet).toContain("Thomas Parkinson took 3-11");
    expect(candidate.contextSnippet).not.toMatch(/Log In|Forgot Account/);
    // Image URL still surfaced from extract
    expect(candidate.imageUrl).toContain("photo1.jpg");
  });

  it("demotes candidates with definitive-zero faces to page-only (keeps page link, drops imageUrl)", async () => {
    const search = makeSearchAll(
      [
        {
          // Has imageUrl + faces detected → kept
          url: "https://www.facebook.com/groups/123/posts/abc/",
          title: "Some CC - Facebook",
          snippet: "Some Player named in post",
        },
        {
          // Has imageUrl but face detector returns [] → dropped
          url: "https://example.com/team-logo.png",
          title: "Some CC logo page",
          snippet: "Some Player joined Some CC",
        },
        {
          // No imageUrl → kept (page-only lead is still useful)
          url: "https://example.com/squad-page",
          title: "Some CC squad page",
          snippet: "Some Player in the lineup",
        },
      ],
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          content: "Match recap: Some Player took 3-11 for Some CC.",
          images: ["https://scontent.fb.com/photo1.jpg"],
        },
        {
          url: "https://example.com/team-logo.png",
          content: "Some Player joined Some CC last season.",
          images: ["https://example.com/logo.png"],
        },
        {
          url: "https://example.com/squad-page",
          content: "Some Player in the lineup at Some CC.",
          images: [],
        },
      ],
    );
    // Face detector returns faces for the FB photo, nothing for the logo.
    const faceDetector: FaceDetector = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async detectAndCrop(imageUrl) {
        if (imageUrl.includes("photo1.jpg")) {
          return [
            { url: "https://signed.s3/face1.jpg", width: 256, height: 256 },
          ];
        }
        return []; // logo.png — no faces
      },
    };
    const tools = createRecognitionSourcesTool({ search, faceDetector });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");

    const urls = result.candidates.map((c) => c.pageUrl);
    // All three candidates SURVIVE — page-only leads are still useful.
    expect(urls).toContain("https://www.facebook.com/groups/123/posts/abc/");
    expect(urls).toContain("https://example.com/squad-page");
    expect(urls).toContain("https://example.com/team-logo.png");

    // The FB candidate has faces + imageUrl.
    const fb = result.candidates.find((c) => c.pageUrl.endsWith("/posts/abc/"));
    expect(fb?.faces).toHaveLength(1);
    expect(fb?.imageUrl).toBeDefined();

    // The team-logo candidate had its only image return [] — demoted to page-only.
    const logo = result.candidates.find((c) =>
      c.pageUrl.endsWith("/team-logo.png"),
    );
    expect(logo?.imageUrl).toBeUndefined();
    expect(logo?.faces).toBeUndefined();
  });

  it("tries multiple extracted images per candidate; promotes the first one with faces", async () => {
    // Page returns [logo, hero-photo] — face detector says no faces on
    // the logo, yes on the photo. The candidate should be kept with
    // imageUrl promoted to the photo URL (not the logo).
    const search = makeSearchAll(
      [
        {
          url: "https://example.com/squad-page",
          title: "Some CC squad",
          snippet: "Some Player at Some CC",
        },
      ],
      [
        {
          url: "https://example.com/squad-page",
          content: "Some Player in the lineup at Some CC.",
          images: [
            "https://example.com/logo.png",
            "https://example.com/hero-photo.jpg",
          ],
        },
      ],
    );
    const faceDetector: FaceDetector = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async detectAndCrop(imageUrl) {
        if (imageUrl.includes("hero-photo")) {
          return [
            { url: "https://signed.s3/face1.jpg", width: 256, height: 256 },
          ];
        }
        return []; // logo — definitive zero
      },
    };
    const tools = createRecognitionSourcesTool({ search, faceDetector });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");

    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    // imageUrl was promoted from logo → hero-photo.
    expect(c.imageUrl).toBe("https://example.com/hero-photo.jpg");
    expect(c.faces).toHaveLength(1);
  });

  it("keeps imageUrl when face detection is inconclusive across all images (mixed nulls)", async () => {
    const search = makeSearchAll(
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          title: "Some CC - Facebook",
          snippet: "Some Player named",
        },
      ],
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          content: "Some Player at Some CC.",
          images: ["https://scontent.fb.com/photo1.jpg"],
        },
      ],
    );
    const faceDetector: FaceDetector = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async detectAndCrop() {
        return null; // couldn't tell
      },
    };
    const tools = createRecognitionSourcesTool({ search, faceDetector });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");
    const c = result.candidates[0];
    // Inconclusive — keep imageUrl, no faces. Falls through to render_image.
    expect(c.imageUrl).toBe("https://scontent.fb.com/photo1.jpg");
    expect(c.faces).toBeUndefined();
  });

  it("demotes every imageUrl candidate to page-only when face detector definitively rejects every image", async () => {
    const search = makeSearchAll(
      [
        {
          url: "https://example.com/logo1.png",
          title: "Some CC logo",
          snippet: "Some Player at Some CC",
        },
        {
          url: "https://example.com/logo2.png",
          title: "Some CC banner",
          snippet: "Some Player at Some CC",
        },
      ],
      [
        {
          url: "https://example.com/logo1.png",
          content: "Some Player at Some CC.",
          images: ["https://example.com/logo1.png"],
        },
        {
          url: "https://example.com/logo2.png",
          content: "Some Player at Some CC.",
          images: ["https://example.com/logo2.png"],
        },
      ],
    );
    const faceDetector: FaceDetector = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async detectAndCrop() {
        return [];
      },
    };
    const tools = createRecognitionSourcesTool({ search, faceDetector });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");
    // Both candidates survive as page-only — they scored medium on title/
    // snippet match and remain a useful "look at this page" lead even
    // when face detection confirmed the only extracted image is a logo.
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.imageUrl === undefined)).toBe(true);
    expect(result.candidates.every((c) => c.faces === undefined)).toBe(true);
  });

  it("invokes faceDetector for every candidate with an imageUrl and attaches the crops", async () => {
    const search = makeSearchAll(
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          title: "Some CC - Facebook",
          snippet: "Some Player named in the post",
        },
        {
          url: "https://example.com/no-image-page",
          title: "Some CC squad page",
          snippet: "Some Player in the lineup",
        },
      ],
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          content: "Match recap: Some Player took 3-11 for Some CC.",
          images: ["https://scontent.fb.com/photo1.jpg"],
        },
        {
          url: "https://example.com/no-image-page",
          content: "Some Player joined Some CC last season.",
          // No images surfaced → candidate.imageUrl undefined → no face call.
          images: [],
        },
      ],
    );
    // eslint-disable-next-line @typescript-eslint/require-await
    const detect = vi.fn(async (imageUrl: string) => {
      if (imageUrl.includes("photo1.jpg")) {
        return [
          {
            url: "https://signed.s3/face1.jpg",
            width: 256,
            height: 256,
          },
          {
            url: "https://signed.s3/face2.jpg",
            width: 256,
            height: 240,
          },
        ];
      }
      return [];
    });
    const faceDetector: FaceDetector = { detectAndCrop: detect };

    const tools = createRecognitionSourcesTool({ search, faceDetector });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 5,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");

    // Face detector was only called for the candidate WITH an imageUrl.
    const calledUrls = detect.mock.calls.map((c) => c[0]);
    expect(calledUrls).toEqual(["https://scontent.fb.com/photo1.jpg"]);

    // The candidate now carries its detected face crops.
    const isFbCandidate = (pageUrl: string) =>
      new URL(pageUrl).hostname === "www.facebook.com";
    const fbCandidate = result.candidates.find((c) => isFbCandidate(c.pageUrl));
    expect(fbCandidate?.faces).toHaveLength(2);
    expect(fbCandidate?.faces?.[0].url).toBe("https://signed.s3/face1.jpg");

    // The candidate WITHOUT an imageUrl has no faces field set.
    const otherCandidate = result.candidates.find(
      (c) => !isFbCandidate(c.pageUrl),
    );
    expect(otherCandidate?.faces).toBeUndefined();
  });

  it("degrades silently when face detection throws — candidate still surfaces without faces", async () => {
    const search = makeSearchAll(
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          title: "Some CC - Facebook",
          snippet: "Some Player named in the post",
        },
      ],
      [
        {
          url: "https://www.facebook.com/groups/123/posts/abc/",
          content: "Match recap: Some Player took 3-11 for Some CC.",
          images: ["https://scontent.fb.com/photo1.jpg"],
        },
      ],
    );
    const faceDetector: FaceDetector = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async detectAndCrop() {
        throw new Error("rekognition exploded");
      },
    };
    const tools = createRecognitionSourcesTool({ search, faceDetector });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Some Player",
        clubName: "Some CC",
        maxResults: 5,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");
    // Tool didn't throw, candidate still listed, just no faces attached.
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].faces).toBeUndefined();
  });

  // Regression: this is the exact shape of hits the user reported during dogfooding.
  // The agent was returning all-medium with multiple useless scorecard URLs in the mix.
  // After fixing scoring + scorecard filtering, club-owned FB + Play-Cricket team page
  // both score high and scorecards drop entirely.
  it("upgrades club-owned FB + PC team page to high and drops scorecard URLs (Thomas Parkinson regression)", async () => {
    const search = makeSearchAll(
      [
        {
          url: "https://www.facebook.com/groups/174184335514/posts/10173898929480515/",
          title: "Rock Cricket Club - Facebook",
          snippet:
            "Thomas Parkinson (now edging ever closer to that 400-wicket milestone) ... Rock CC's finest",
        },
        {
          url: "https://www.facebook.com/groups/174184335514/",
          title: "Rock Cricket Club | Facebook",
          snippet:
            "Thomas Parkinson matched him with 3 for 11 — tight, controlled, and relentless.",
        },
        {
          url: "https://rocknorthumberland.play-cricket.com/Teams/95668",
          title: "1st XI - Rock CC, Northumberland - Play-Cricket",
          snippet: "Thomas Parkinson. LEAGUE. LEAGUE COMPETITIONS.",
        },
        // Scorecards — should be filtered out before scoring
        {
          url: "https://www.play-cricket.com/website/results/5627546",
          title: "rock cc, northumberland - Play-Cricket",
          snippet: "8, 0, 0, 12.50. Thomas Parkinson. not out. ...",
        },
        {
          url: "https://www.play-cricket.com/website/results/3527407/print",
          title: "Rock CC, Northumberland - Play-Cricket",
          snippet: "Batting; Thomas Parkinson, lbw, b Stuart Rosser; ...",
        },
      ],
      [
        {
          url: "https://www.facebook.com/groups/174184335514/posts/10173898929480515/",
          content:
            "Match recap: Thomas Parkinson took 3-11 against Mitford for Rock CC, edging ever closer to 400 wickets...",
          images: [
            "https://scontent.fb.com/parkinson-bowling.jpg",
            "https://scontent.fb.com/team-photo.jpg",
          ],
        },
        {
          url: "https://www.facebook.com/groups/174184335514/",
          content: "Rock Cricket Club - public group page about the club.",
          images: ["https://scontent.fb.com/cover.jpg"],
        },
        {
          url: "https://rocknorthumberland.play-cricket.com/Teams/95668",
          content:
            "Squad list: Joe Ferry, Thomas Parkinson, Daniel Hodgson, George Cockayne. Rock CC 1st XI.",
          images: ["https://play-cricket.com/parkinson-tp.jpg"],
        },
      ],
    );
    const tools = createRecognitionSourcesTool({ search });
    const exec = tools.find_player_photo_sources.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        playerName: "Thomas Parkinson",
        clubName: "Rock CC",
        maxResults: 8,
      },
      opts,
    )) as RecognitionSourcesResult;
    if (result.status !== "ok") throw new Error("expected ok");
    // No scorecard URLs survived
    expect(
      result.candidates.every((c) => !c.pageUrl.includes("/results/")),
    ).toBe(true);
    // At least one high-confidence candidate
    expect(result.candidates.some((c) => c.confidence === "high")).toBe(true);
    // Highest-confidence candidate carries an image URL
    expect(result.candidates[0].imageUrl).toBeTruthy();
  });
});
