import { describe, expect, it } from "vitest";
import { buildOgHtmlPage, buildSvg, type OgMatchData } from "./service.ts";

const baseMatchData: OgMatchData = {
  teamName: "Percy Main 1st XI",
  oppositionName: "Tynemouth 1st XI",
  matchDate: "15/06/2025",
  matchTime: "13:00",
  outcome: "W",
  resultDescription: "Percy Main won by 5 wickets",
  competitionName: "NTCL Division 1",
  innings: [
    {
      teamName: "Tynemouth 1st XI",
      runs: 185,
      wickets: 10,
      allOut: true,
      declared: false,
    },
    {
      teamName: "Percy Main 1st XI",
      runs: 186,
      wickets: 5,
      allOut: false,
      declared: false,
    },
  ],
  topBatter: { name: "J Smith", runs: 72, notOut: true },
  topBowler: { name: "A Jones", wickets: 4, runs: 32 },
  sponsor: null,
};

describe("buildSvg", () => {
  it("generates valid SVG with match data", () => {
    const svg = buildSvg(baseMatchData);

    expect(svg).toContain("<svg");
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain("Percy Main 1st XI");
    expect(svg).toContain("Tynemouth 1st XI");
    expect(svg).toContain("WON");
    expect(svg).toContain("185");
    expect(svg).toContain("186/5");
    expect(svg).toContain("J Smith 72*");
    expect(svg).toContain("A Jones 4/32");
  });

  it("handles match with no innings", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      innings: [],
      outcome: "A",
      resultDescription: "Match abandoned",
      topBatter: null,
      topBowler: null,
    };

    const svg = buildSvg(data);

    expect(svg).toContain("ABANDONED");
    expect(svg).not.toContain("•");
  });

  it("handles single innings", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      innings: [
        {
          teamName: "Percy Main 1st XI",
          runs: 200,
          wickets: 6,
          allOut: false,
          declared: false,
        },
      ],
    };

    const svg = buildSvg(data);

    expect(svg).toContain("200/6");
  });

  it("handles declared innings", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      innings: [
        {
          teamName: "Percy Main 1st XI",
          runs: 250,
          wickets: 5,
          allOut: false,
          declared: true,
        },
        {
          teamName: "Tynemouth 1st XI",
          runs: 180,
          wickets: 10,
          allOut: true,
          declared: false,
        },
      ],
    };

    const svg = buildSvg(data);

    expect(svg).toContain("250/5d");
    expect(svg).toContain("180");
  });

  it("escapes XML special characters in team names", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      teamName: "Team & <Club>",
      oppositionName: 'Opp "Team"',
    };

    const svg = buildSvg(data);

    expect(svg).toContain("Team &amp; &lt;Club&gt;");
    expect(svg).toContain("Opp &quot;Team&quot;");
    // Should be valid XML (no raw & or < in text content)
    expect(svg).not.toMatch(/(?<!&amp;)&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("handles no outcome", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      outcome: null,
    };

    const svg = buildSvg(data);

    // Should not contain an outcome badge rect
    expect(svg).not.toContain("WON");
    expect(svg).not.toContain("LOST");
  });

  it("handles only top batter, no top bowler", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      topBowler: null,
    };

    const svg = buildSvg(data);

    expect(svg).toContain("J Smith 72*");
    expect(svg).not.toContain("•");
  });

  it("does not show * for dismissed batters", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      topBatter: { name: "J Smith", runs: 72, notOut: false },
    };

    const svg = buildSvg(data);

    expect(svg).toContain("J Smith 72");
    expect(svg).not.toContain("J Smith 72*");
  });

  it("handles only top bowler, no top batter", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      topBatter: null,
    };

    const svg = buildSvg(data);

    expect(svg).toContain("A Jones 4/32");
    expect(svg).not.toContain("•");
  });

  it("shows formatted date and time for future matches", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      innings: [],
      outcome: null,
      matchTime: "13:00",
      matchDate: "12/06/2026",
      topBatter: null,
      topBowler: null,
    };

    const svg = buildSvg(data);

    expect(svg).toContain("Friday 12th June 2026 - 1pm");
  });

  it("shows date without time when time is not available", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      innings: [],
      outcome: null,
      matchTime: null,
      matchDate: "12/06/2026",
      topBatter: null,
      topBowler: null,
    };

    const svg = buildSvg(data);

    expect(svg).toContain("Friday 12th June 2026");
    expect(svg).not.toContain(" - ");
  });

  it("shows sponsor name in footer when sponsored", () => {
    const data: OgMatchData = {
      ...baseMatchData,
      sponsor: { name: "Acme Corp", logoUrl: null },
    };

    const svg = buildSvg(data);

    expect(svg).toContain("Sponsored by");
    expect(svg).toContain("Acme Corp");
    expect(svg).not.toContain("Percy Main Cricket");
  });

  it("shows club name in footer when not sponsored", () => {
    const svg = buildSvg(baseMatchData);

    expect(svg).toContain("Percy Main Cricket");
    expect(svg).not.toContain("Sponsored by");
  });
});

describe("buildOgHtmlPage", () => {
  it("generates HTML with correct meta tags", () => {
    const html = buildOgHtmlPage(
      "https://percymain.org",
      "https://api.percymain.org",
      "12345",
      "Match Result — Percy Main Cricket & Sports Club",
    );

    expect(html).toContain('og:title" content="Match Result');
    expect(html).toContain(
      'og:image" content="https://api.percymain.org/api/og/game/12345"',
    );
    expect(html).toContain('og:image:width" content="1200"');
    expect(html).toContain('og:image:height" content="630"');
    expect(html).toContain(
      'og:url" content="https://percymain.org/calendar/game/12345"',
    );
    expect(html).toContain('twitter:card" content="summary_large_image"');
    expect(html).toContain('twitter:image"');
    expect(html).toContain(
      'http-equiv="refresh" content="0;url=https://percymain.org/calendar/game/12345?og=1"',
    );
    // og:url should be the canonical URL without bypass param
    expect(html).not.toContain(
      'og:url" content="https://percymain.org/calendar/game/12345?og=1"',
    );
  });

  it("escapes special characters in title", () => {
    const html = buildOgHtmlPage(
      "https://percymain.org",
      "https://api.percymain.org",
      "123",
      "Percy Main & Friends <test>",
    );

    expect(html).toContain("Percy Main &amp; Friends &lt;test&gt;");
  });

  it("appends extra query params to the bypass redirect URL", () => {
    const html = buildOgHtmlPage(
      "https://percymain.org",
      "https://api.percymain.org",
      "12345",
      "Match",
      { bbb: "1" },
    );

    expect(html).toContain(
      'http-equiv="refresh" content="0;url=https://percymain.org/calendar/game/12345?og=1&amp;bbb=1"',
    );
    // canonical og:url should still not include the bypass or extras
    expect(html).toContain(
      'og:url" content="https://percymain.org/calendar/game/12345"',
    );
  });

  it("drops the og key from extra params", () => {
    const html = buildOgHtmlPage(
      "https://percymain.org",
      "https://api.percymain.org",
      "12345",
      "Match",
      { og: "should-not-double-up", bbb: "1" },
    );

    expect(html).toContain(
      'http-equiv="refresh" content="0;url=https://percymain.org/calendar/game/12345?og=1&amp;bbb=1"',
    );
  });
});
