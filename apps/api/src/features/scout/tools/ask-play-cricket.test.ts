import { describe, expect, it } from "vitest";
import { extractJsonCandidate } from "./ask-play-cricket.ts";

describe("extractJsonCandidate", () => {
  it("returns naked JSON unchanged", () => {
    const raw = '{"data":{"id":1}}';
    const r = extractJsonCandidate(raw);
    expect(r.extraction).toBe("naked");
    expect(JSON.parse(r.candidate)).toEqual({ data: { id: 1 } });
  });

  it("strips a leading + trailing ```json fence with surrounding whitespace", () => {
    const raw = '```json\n{"data":{"id":1}}\n```';
    const r = extractJsonCandidate(raw);
    expect(r.extraction).toBe("fenced");
    expect(JSON.parse(r.candidate)).toEqual({ data: { id: 1 } });
  });

  it("extracts JSON from a chatty reply with surrounding prose (the prod failure mode)", () => {
    const raw = `Perfect! I found the match. Here's the fixture information:

\`\`\`json
{
  "data": {
    "matchId": 7262921,
    "matchDate": "09/05/2026"
  }
}
\`\`\`

The match is on **9 May 2026**.`;
    const r = extractJsonCandidate(raw);
    expect(r.extraction).toBe("fenced");
    expect(JSON.parse(r.candidate)).toEqual({
      data: { matchId: 7262921, matchDate: "09/05/2026" },
    });
  });

  it("uses the LAST fenced block when the reply contains scratch JSON earlier", () => {
    const raw = `Initial guess:
\`\`\`json
{"wrong":true}
\`\`\`
Wait — actually:
\`\`\`json
{"data":{"correct":true}}
\`\`\`
That's better.`;
    const r = extractJsonCandidate(raw);
    expect(r.extraction).toBe("fenced");
    expect(JSON.parse(r.candidate)).toEqual({ data: { correct: true } });
  });

  it("falls back to first-{ to last-} when there are no fences", () => {
    const raw = 'Here you go: {"data":[1,2,3]} that\'s all.';
    const r = extractJsonCandidate(raw);
    expect(r.extraction).toBe("braces");
    expect(JSON.parse(r.candidate)).toEqual({ data: [1, 2, 3] });
  });

  it("returns the raw trim when there's no JSON at all (caller will throw on parse)", () => {
    const raw = "I have no idea what you want.";
    const r = extractJsonCandidate(raw);
    expect(r.extraction).toBe("naked");
    expect(r.candidate).toBe("I have no idea what you want.");
  });
});
