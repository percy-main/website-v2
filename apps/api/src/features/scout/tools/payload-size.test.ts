import { describe, expect, it } from "vitest";
import { approxJsonBytes } from "./payload-size.ts";

// Belt-and-braces: for normal data the function should match
// JSON.stringify(x).length. Anywhere it diverges (escapes, BigInt,
// cycles) is documented in the source header.
describe("approxJsonBytes — equivalence with JSON.stringify().length", () => {
  it.each([
    null,
    true,
    false,
    0,
    -1,
    3.14,
    1.5e-10,
    "",
    "hello",
    "with spaces and digits 123",
    [],
    [1, 2, 3],
    [null, true, "x"],
    {},
    { a: 1 },
    { name: "Smith", runs: 42, balls: 60 },
    [
      { name: "A", runs: 50 },
      { name: "B", runs: 30 },
    ],
    {
      innings: [
        {
          team: "Percy Main",
          runs: 200,
          bat: [
            { name: "A", runs: 50, balls: 60 },
            { name: "B", runs: 30, balls: 40 },
          ],
        },
      ],
    },
  ])("matches JSON.stringify().length for %j", (value) => {
    expect(approxJsonBytes(value)).toBe(JSON.stringify(value).length);
  });
});

describe("approxJsonBytes — JSON.stringify quirks", () => {
  it("encodes NaN as null (4 bytes)", () => {
    expect(approxJsonBytes(NaN)).toBe(4);
    expect(approxJsonBytes(Infinity)).toBe(4);
    expect(approxJsonBytes(-Infinity)).toBe(4);
  });

  it("encodes undefined / function / symbol as null inside arrays", () => {
    const arr = [undefined, () => 0, Symbol("x")];
    expect(approxJsonBytes(arr)).toBe(JSON.stringify(arr).length);
  });

  it("omits undefined / function / symbol values from objects", () => {
    const obj = { a: 1, b: undefined, c: () => 0, d: Symbol("x"), e: 2 };
    expect(approxJsonBytes(obj)).toBe(JSON.stringify(obj).length);
  });

  it("encodes a bare undefined as null (telemetry never throws)", () => {
    // JSON.stringify(undefined) returns the string undefined, not a JSON
    // null. We treat it as null for telemetry: ensures the function is
    // total over `unknown` and never returns NaN.
    expect(approxJsonBytes(undefined)).toBe(4);
  });
});

describe("approxJsonBytes — defensive behaviour", () => {
  it("returns finite for cyclic objects (does not stack-overflow)", () => {
    // JSON.stringify throws TypeError; we return a finite number so a
    // telemetry log line can never break a chat turn.
    interface Cyclic {
      a: number;
      self?: Cyclic;
    }
    const cyclic: Cyclic = { a: 1 };
    cyclic.self = cyclic;
    const bytes = approxJsonBytes(cyclic);
    expect(Number.isFinite(bytes)).toBe(true);
    expect(bytes).toBeGreaterThan(0);
  });

  it("returns 0 for BigInt instead of throwing", () => {
    expect(() => approxJsonBytes(123n)).not.toThrow();
    expect(approxJsonBytes(123n)).toBe(0);
    // Inside a structure, the value contributes 0 but the structure
    // overhead remains.
    expect(approxJsonBytes({ a: 1, b: 123n })).toBeGreaterThan(0);
  });

  it("counts a repeated object (DAG, not cycle) as null on second visit", () => {
    // Documented under-count vs. JSON.stringify, which inlines both
    // copies. Acceptable for our payloads (parsed-JSON trees never share
    // refs); locked down here so the divergence is intentional.
    const shared = { x: 1 };
    const root = { left: shared, right: shared };
    const stringifyLen = JSON.stringify(root).length;
    const approx = approxJsonBytes(root);
    expect(approx).toBeLessThan(stringifyLen);
    // Second visit costs 4 bytes ("null") instead of 7 ({"x":1}); diff = 3.
    expect(stringifyLen - approx).toBe(3);
  });
});

describe("approxJsonBytes — hot-path scale", () => {
  it("handles a Play-Cricket-shaped payload with hundreds of nodes", () => {
    // Roughly the shape of a single match_detail response: 2 innings × 11
    // bat rows × ~10 fields, plus bowl rows, plus FoW. Builds ~500 nodes.
    const innings = Array.from({ length: 2 }, (_, ii) => ({
      team_batting_name: `Team ${ii}`,
      innings_number: ii + 1,
      runs: "200",
      wickets: "10",
      overs: "45.0",
      bat: Array.from({ length: 11 }, (_, bi) => ({
        position: String(bi + 1),
        batsman_name: `Batter ${bi}`,
        how_out: "caught",
        fielder_name: "Fielder",
        bowler_name: "Bowler",
        runs: String(bi * 10),
        balls: String(bi * 12),
        fours: String(bi),
        sixes: "0",
      })),
      bowl: Array.from({ length: 7 }, (_, oi) => ({
        bowler_name: `Bowler ${oi}`,
        overs: "8.0",
        maidens: "1",
        runs: "30",
        wickets: "1",
        wides: "1",
        no_balls: "0",
      })),
      fow: Array.from({ length: 10 }, (_, fi) => ({
        runs: String(fi * 20),
        wickets: fi + 1,
        batsman_out_name: `Batter ${fi}`,
      })),
    }));
    const payload = { match_details: [{ id: 12345, innings }] };

    expect(approxJsonBytes(payload)).toBe(JSON.stringify(payload).length);
  });
});
