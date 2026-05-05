import type { ScoutReportContent } from "@percy-main/shared";
import { describe, expect, it } from "vitest";
import { validateClaims, type AnalystOutput } from "./analyst.ts";
import {
  type ClaimRecord,
  type EvidenceClaimType,
  type EvidenceRecord,
} from "./evidence.ts";

// ── Test fixtures ──────────────────────────────────────────────────────────

const baseContent: ScoutReportContent = {
  intro: "Tynemouth at home in NTCL Premier — strong opposition.",
  weather: undefined,
  tossDecision:
    "Bat first if dry; their seamers are toughest with the new ball.",
  overallStrategy:
    "Bat positively, then bowl tight lines through their middle order.",
  keyMatchups:
    "Smith bowls full and straight to Dance who has been bowled in 5 of 8 dismissals.",
  tactics:
    "Open with our quicks for six overs, then bring on spin from the river end. Squeeze runs in the middle.",
  conclusion: "Stay positive, back the plan.",
  references: [],
};

function makeEvidence(
  id: string,
  claimType: EvidenceClaimType = "db_aggregate",
): EvidenceRecord {
  return {
    id,
    sourceType:
      claimType === "captain_fact" || claimType === "club_fact" ? "fact" : "db",
    sourceRef: `ref:${id}`,
    claimType,
    content: `Some evidence for ${id}`,
    confidence: 4,
    permanence: "seasonal",
    retrievedAt: new Date().toISOString(),
  };
}

function makeClaim(overrides: Partial<ClaimRecord>): ClaimRecord {
  return {
    id: "c1",
    section: "tactics",
    text: "Open with our quicks",
    isMechanics: false,
    evidenceIds: ["e1"],
    ...overrides,
  };
}

// ── happy path ─────────────────────────────────────────────────────────────

describe("validateClaims — happy path", () => {
  it("keeps a claim whose text and evidence both resolve", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c1",
          section: "tactics",
          text: "Open with our quicks",
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.drops).toEqual([]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].section).toBe("tactics");
    expect(result.claims[0].evidenceIds).toEqual(["e1"]);
  });
});

// ── auto-relocate ──────────────────────────────────────────────────────────

describe("validateClaims — auto-relocate section", () => {
  it("rewrites section when the model tags the wrong one but the text is in another section (the bug from the prod log: claim tagged ourPlayers but text actually lives in tactics)", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c1",
          section: "ourPlayers", // model lied
          text: "Open with our quicks",
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.drops).toEqual([]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].section).toBe("tactics");
  });

  it("preserves the declared section when it actually matches", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c1",
          section: "intro",
          text: "Tynemouth at home",
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.claims[0].section).toBe("intro");
  });
});

// ── text not findable ──────────────────────────────────────────────────────

describe("validateClaims — text not found", () => {
  it("drops a claim whose text isn't in any section", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c_bogus",
          section: "tactics",
          text: "this exact phrase appears nowhere in the report",
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.claims).toEqual([]);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].reason).toBe("text_not_found");
    expect(result.drops[0].locatedIn).toBeNull();
  });
});

// ── fabricated evidence ────────────────────────────────────────────────────

describe("validateClaims — fabricated evidence", () => {
  it("strips fabricated evidenceIds but keeps the claim if at least one resolves", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c1",
          section: "tactics",
          text: "Open with our quicks",
          evidenceIds: ["e1", "e_fake", "e_also_fake"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.drops).toEqual([]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].evidenceIds).toEqual(["e1"]);
  });

  it("drops a claim whose every evidenceId is fabricated", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c_unsupported",
          section: "tactics",
          text: "Open with our quicks",
          evidenceIds: ["e_fake_a", "e_fake_b"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.claims).toEqual([]);
    expect(result.drops[0].reason).toBe("no_evidence");
    // text was findable, so caller can excise the prose
    expect(result.drops[0].locatedIn).toBe("tactics");
  });
});

// ── mechanics rule ─────────────────────────────────────────────────────────

describe("validateClaims — mechanics rule", () => {
  it("drops a mechanics claim with no fact-typed evidence", () => {
    const evidence = [makeEvidence("e1", "db_aggregate")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c_mech",
          section: "keyMatchups",
          text: "Smith bowls full and straight",
          isMechanics: true,
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.claims).toEqual([]);
    expect(result.drops[0].reason).toBe("mechanics_unsupported");
    expect(result.drops[0].locatedIn).toBe("keyMatchups");
  });

  it("keeps a mechanics claim backed by a captain_fact", () => {
    const evidence = [
      makeEvidence("e1", "db_aggregate"),
      makeEvidence("e_fact", "captain_fact"),
    ];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c_mech",
          section: "keyMatchups",
          text: "Smith bowls full and straight",
          isMechanics: true,
          evidenceIds: ["e1", "e_fact"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.drops).toEqual([]);
    expect(result.claims).toHaveLength(1);
  });
});

// ── coverage ───────────────────────────────────────────────────────────────

describe("validateClaims — coverage", () => {
  it("flags sections with prose but no claim — does NOT fail", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        // Only covers tactics; intro / tossDecision / overallStrategy /
        // keyMatchups / conclusion all have prose but no claim.
        makeClaim({
          id: "c1",
          section: "tactics",
          text: "Open with our quicks",
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.claims).toHaveLength(1);
    expect(result.uncovered).toContain("intro");
    expect(result.uncovered).toContain("tossDecision");
    expect(result.uncovered).toContain("overallStrategy");
    expect(result.uncovered).toContain("keyMatchups");
    expect(result.uncovered).toContain("conclusion");
    expect(result.uncovered).not.toContain("tactics");
  });

  it("does not flag empty optional sections (ourPlayers / theirPlayers absent)", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c1",
          section: "tactics",
          text: "Open with our quicks",
          evidenceIds: ["e1"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.uncovered).not.toContain("ourPlayers");
    expect(result.uncovered).not.toContain("theirPlayers");
  });
});

// ── all dropped ────────────────────────────────────────────────────────────

describe("validateClaims — total breakdown", () => {
  it("returns empty claims when every claim drops, leaving the caller to hard-fail", () => {
    const evidence = [makeEvidence("e1")];
    const output: AnalystOutput = {
      content: baseContent,
      claims: [
        makeClaim({
          id: "c_bad1",
          text: "phrase not in any section",
          evidenceIds: ["e1"],
        }),
        makeClaim({
          id: "c_bad2",
          text: "another phrase not in any section",
          evidenceIds: ["e_fake"],
        }),
      ],
    };

    const result = validateClaims(output, evidence);

    expect(result.claims).toEqual([]);
    expect(result.drops).toHaveLength(2);
  });
});
